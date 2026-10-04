//! Processing completion timestamps from ExploreASL lock files and logs.
use super::{
    locks::lock_module_roots,
    logs::{check_log_for_error, exploreasl_log_dirs},
};
use std::path::{Path, PathBuf};

pub(crate) fn completion_from_lock_or_log(
    lock_roots: &[PathBuf],
    log_dirs: &[PathBuf],
    subject_session: &str,
    module: &str,
    run: Option<&str>,
) -> Option<std::time::SystemTime> {
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

    let log_name = match run {
        Some(r) => format!("{}_{}_ASL_{}.log", module, subject_session, r),
        None if subject_session.is_empty() => format!("{}.log", module),
        None => format!("{}_{}.log", module, subject_session),
    };
    for log_dir in log_dirs {
        let log_file = log_dir.join(&log_name);
        if !log_file.is_file() {
            continue;
        }
        if check_log_for_error(&log_file) {
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

pub(crate) fn get_structural_completion_time(
    project_root: &Path,
    subject_session: &str,
) -> Option<std::time::SystemTime> {
    let lock_roots = lock_module_roots(project_root, "xASL_module_Structural");
    let log_dirs = exploreasl_log_dirs(project_root);
    completion_from_lock_or_log(
        &lock_roots,
        &log_dirs,
        subject_session,
        "xASL_module_Structural",
        None,
    )
}

pub(crate) fn get_asl_completion_time(
    project_root: &Path,
    subject_session: &str,
    run: &str,
) -> Option<std::time::SystemTime> {
    let lock_roots = lock_module_roots(project_root, "xASL_module_ASL");
    let log_dirs = exploreasl_log_dirs(project_root);
    completion_from_lock_or_log(
        &lock_roots,
        &log_dirs,
        subject_session,
        "xASL_module_ASL",
        Some(run),
    )
}

pub(crate) fn get_population_completion_time(project_root: &Path) -> Option<std::time::SystemTime> {
    let lock_roots = lock_module_roots(project_root, "xASL_module_Population");
    let log_dirs = exploreasl_log_dirs(project_root);
    for lock_root in &lock_roots {
        let ready = lock_root
            .join("xASL_module_Population")
            .join("999_ready.status");
        if let Ok(metadata) = std::fs::metadata(&ready)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }
    for log_dir in &log_dirs {
        let log_file = log_dir.join("xASL_module_Population.log");
        if log_file.is_file()
            && !check_log_for_error(&log_file)
            && let Ok(metadata) = std::fs::metadata(&log_file)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }
    None
}
