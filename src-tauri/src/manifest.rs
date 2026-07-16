use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::matlab::probe_matlab_version;
use crate::tracing::CommandTrace;

#[path = "manifest_tests.rs"]
#[cfg(test)]
mod manifest_tests;

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentVersions {
    pub explore_asl: String,
    pub matlab: String,
}

fn read_exploreasl_version_file(explore_asl_path: &Path) -> Result<String, String> {
    let entries = fs::read_dir(explore_asl_path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(version) = file_name.strip_prefix("VERSION_")
            && !version.is_empty()
        {
            return Ok(version.to_string());
        }
    }
    Err("no VERSION_* file found".to_string())
}

fn capture_environment_versions_impl(
    explore_asl_path: String,
    matlab_path: String,
) -> EnvironmentVersions {
    let explore_asl = read_exploreasl_version_file(&PathBuf::from(explore_asl_path.trim()))
        .unwrap_or_else(|_| "unknown".to_string());
    let matlab = if matlab_path.trim().is_empty() {
        "unknown".to_string()
    } else {
        probe_matlab_version(&PathBuf::from(matlab_path.trim()))
            .unwrap_or_else(|_| "unknown".to_string())
    };

    EnvironmentVersions {
        explore_asl,
        matlab,
    }
}

#[tauri::command]
pub async fn capture_environment_versions(
    explore_asl_path: String,
    matlab_path: String,
) -> EnvironmentVersions {
    let trace = CommandTrace::new("capture_environment_versions");
    trace.arg("explore_asl_path", &explore_asl_path);
    trace.arg("matlab_path", &matlab_path);

    let result = tauri::async_runtime::spawn_blocking(move || {
        capture_environment_versions_impl(explore_asl_path, matlab_path)
    })
    .await
    .unwrap_or_else(|_| EnvironmentVersions {
        explore_asl: "unknown".to_string(),
        matlab: "unknown".to_string(),
    });

    trace.success(&result);
    result
}

#[tauri::command]
pub fn read_population_ready_mtime(project_root: String) -> Option<i64> {
    let trace = CommandTrace::new("read_population_ready_mtime");
    trace.arg("project_root", &project_root);

    let p = PathBuf::from(&project_root)
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Population")
        .join("xASL_module_Population")
        .join("999_ready.status");

    let result = p.metadata().ok().and_then(|m| {
        m.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        })
    });

    trace.success(&result);
    result
}

#[tauri::command]
pub async fn read_prior_modules_mtimes(
    project_root: String,
    subject_sessions: Vec<String>,
) -> std::collections::HashMap<String, Option<i64>> {
    let trace = CommandTrace::new("read_prior_modules_mtimes");
    trace.arg("project_root", &project_root);
    trace.arg("subject_sessions_count", subject_sessions.len());

    let root = PathBuf::from(project_root);
    let result = tauri::async_runtime::spawn_blocking(move || {
        read_prior_modules_mtimes_impl(&root, &subject_sessions)
    })
    .await
    .unwrap_or_default();

    trace.success(&result);
    result
}

/// Sync core: returns the maximum completion mtime (ms since epoch) of the
/// prior modules (Structural + all ASL runs) for each requested subject session.
/// Scans both the canonical `derivatives/ExploreASL` tree and the
/// `.easl_staging/derivatives/ExploreASL` tree for lock ready files and logs.
/// Log directories are scanned exactly once and grouped by subject session to
/// keep the per-subject lookup O(1) rather than O(total log entries).
fn read_prior_modules_mtimes_impl(
    project_root: &Path,
    subject_sessions: &[String],
) -> std::collections::HashMap<String, Option<i64>> {
    use std::collections::HashMap;
    use std::time::SystemTime;

    let mut result: HashMap<String, Option<i64>> = HashMap::new();
    if subject_sessions.is_empty() {
        return result;
    }

    let log_dirs = crate::processing::exploreasl_log_dirs(project_root);

    // Scan every log directory once, grouping ASL run log filenames by subject
    // session. Each entry maps subject_session -> set of normalized run ids that
    // appear in the log tree. Avoids re-iterating the whole log dir per subject.
    let mut runs_by_subject: HashMap<String, Vec<String>> = HashMap::new();
    for log_dir in &log_dirs {
        let entries = match std::fs::read_dir(log_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            // Format: xASL_module_ASL_<subject_session>_ASL_<run>.log
            let Some(rest) = name.strip_prefix("xASL_module_ASL_") else {
                continue;
            };
            let Some((ss_part, run_part)) = rest.rsplit_once("_ASL_") else {
                continue;
            };
            let Some(run_str) = run_part.strip_suffix(".log") else {
                continue;
            };
            let run = crate::processing::normalize_asl_run_id(run_str);
            let bucket = runs_by_subject.entry(ss_part.to_string()).or_default();
            if !bucket.contains(&run) {
                bucket.push(run);
            }
        }
    }

    let struct_lock_roots = lock_module_roots(project_root, "xASL_module_Structural");
    let asl_lock_roots = lock_module_roots(project_root, "xASL_module_ASL");

    for ss in subject_sessions {
        let mut max_time: Option<SystemTime> = None;

        // Structural completion: ready file in either lock tree, else log fallback.
        if let Some(st) = completion_from_lock_or_log(
            &struct_lock_roots,
            &log_dirs,
            ss,
            "xASL_module_Structural",
            None,
        ) {
            max_time = Some(st);
        }

        // ASL runs: scan both lock trees for run subdirs first. Only fall back to
        // log-discovered runs when the lock trees yielded none for this subject.
        let mut all_runs: Vec<String> = Vec::new();
        for lock_root in &asl_lock_roots {
            let asl_subject_dir = lock_root.join(ss);
            let entries = match std::fs::read_dir(&asl_subject_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(run_str) = name.strip_prefix("xASL_module_ASL_ASL_") {
                    let run = crate::processing::normalize_asl_run_id(run_str);
                    if !all_runs.contains(&run) {
                        all_runs.push(run);
                    }
                }
            }
        }
        if all_runs.is_empty()
            && let Some(log_runs) = runs_by_subject.get(ss)
        {
            all_runs.extend(log_runs.iter().cloned());
        }

        for run in &all_runs {
            if let Some(at) = completion_from_lock_or_log(
                &asl_lock_roots,
                &log_dirs,
                ss,
                "xASL_module_ASL",
                Some(run),
            ) {
                match max_time {
                    Some(mt) if at > mt => max_time = Some(at),
                    None => max_time = Some(at),
                    _ => {}
                }
            }
        }

        let mtime_ms = max_time.and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        });
        result.insert(ss.clone(), mtime_ms);
    }

    result
}

/// Returns the two candidate lock roots (`derivatives/ExploreASL/lock/<module>`
/// and `.easl_staging/derivatives/ExploreASL/lock/<module>`) for a given module.
fn lock_module_roots(project_root: &Path, module: &str) -> [PathBuf; 2] {
    [
        project_root
            .join("derivatives")
            .join("ExploreASL")
            .join("lock")
            .join(module),
        project_root
            .join(".easl_staging")
            .join("derivatives")
            .join("ExploreASL")
            .join("lock")
            .join(module),
    ]
}

/// Resolves the completion time for one module/subject/run by checking the
/// `999_ready.status` file in each lock root first, then falling back to the
/// matching log file in any of the log directories. Logs with detected errors
/// are skipped. `run` is `Some(run_id)` for ASL modules, `None` for Structural.
fn completion_from_lock_or_log(
    lock_roots: &[PathBuf],
    log_dirs: &[PathBuf],
    subject_session: &str,
    module: &str,
    run: Option<&str>,
) -> Option<std::time::SystemTime> {
    // Lock ready file: <lock_root>/<subject_session>/<module_dir>/999_ready.status
    // where <module_dir> is the module name plus an ASL run suffix for ASL.
    let module_dir = match run {
        Some(r) => format!("{}_ASL_{}", module, r),
        None => module.to_string(),
    };
    for lock_root in lock_roots {
        let ready = lock_root
            .join(subject_session)
            .join(&module_dir)
            .join("999_ready.status");
        if let Ok(metadata) = std::fs::metadata(&ready)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }

    // Log fallback: <log_dir>/<module>_<subject_session>[_ASL_<run>].log
    let log_name = match run {
        Some(r) => format!("{}_{}_ASL_{}.log", module, subject_session, r),
        None => format!("{}_{}.log", module, subject_session),
    };
    for log_dir in log_dirs {
        let log_file = log_dir.join(&log_name);
        if !log_file.is_file() {
            continue;
        }
        if crate::processing::check_log_for_error(&log_file) {
            continue;
        }
        if let Ok(metadata) = std::fs::metadata(&log_file)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }
    None
}
