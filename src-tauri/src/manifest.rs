use std::path::{Path, PathBuf};

use crate::processing::{completion_from_lock_or_log, lock_module_roots, normalize_asl_run_id};
use crate::tracing::CommandTrace;

#[path = "manifest_tests.rs"]
#[cfg(test)]
mod manifest_tests;

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
