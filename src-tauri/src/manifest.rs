use anyhow::{Result as AnyResult, bail};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::matlab::probe_matlab_version;
use crate::processing::runs::{
    completed_population_run_root, lock_processing_state, lock_project_transition,
    preparing_run_root,
};
use crate::processing::{completion_from_lock_or_log, lock_module_roots, normalize_asl_run_id};
use crate::tracing::CommandTrace;

#[path = "manifest_tests.rs"]
#[cfg(test)]
mod manifest_tests;

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentVersions {
    pub explore_asl: String,
    pub matlab: String,
}

fn read_exploreasl_version_file(explore_asl_path: &Path) -> AnyResult<String> {
    let entries = fs::read_dir(explore_asl_path)?;
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(version) = file_name.strip_prefix("VERSION_")
            && !version.is_empty()
        {
            return Ok(version.to_string());
        }
    }
    bail!("no VERSION_* file found")
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

fn modified_epoch_millis(path: &Path) -> Option<i64> {
    path.metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

/// Capture is correlated to a current Preparing Population reservation. Holding
/// the native transition gate makes a delayed response fail rather than being
/// attributed to a replacement project/run by the renderer.
#[tauri::command]
pub fn capture_environment_versions_for_run(
    state: tauri::State<'_, crate::app_state::AppState>,
    run_id: String,
    explore_asl_path: String,
    matlab_path: String,
) -> Result<EnvironmentVersions, String> {
    let _transition = lock_project_transition(&state)?;
    let _root = preparing_run_root(&state, &run_id)?;
    let selected_population = lock_processing_state(&state)?
        .current_run
        .as_ref()
        .is_some_and(|run| {
            run.selected_modules
                .iter()
                .any(|module| module == "population")
        });
    if !selected_population {
        return Err(format!(
            "Processing run {run_id} does not select Population"
        ));
    }
    let result = capture_environment_versions_impl(explore_asl_path, matlab_path);
    let _root = preparing_run_root(&state, &run_id)?;
    Ok(result)
}

pub(crate) fn read_population_ready_mtime_impl(project_root: &Path) -> Option<i64> {
    let p = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Population")
        .join("xASL_module_Population")
        .join("999_ready.status");

    modified_epoch_millis(&p)
}

#[tauri::command]
pub fn read_population_ready_mtime_for_run(
    state: tauri::State<'_, crate::app_state::AppState>,
    run_id: String,
) -> Result<Option<i64>, String> {
    let _transition = lock_project_transition(&state)?;
    let root = completed_population_run_root(&state, &run_id)?;
    Ok(read_population_ready_mtime_impl(&root))
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
            let run = normalize_asl_run_id(run_str);
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
                    let run = normalize_asl_run_id(run_str);
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
