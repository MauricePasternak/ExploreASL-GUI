use super::types::SubjectModuleStatus;
use super::utils::{
    check_log_for_error, determine_status, exploreasl_log_dirs, find_asl_runs_from_logs,
    get_asl_completion_time, get_structural_completion_time, module_index_to_name,
    normalize_asl_run_id,
};
use crate::tracing::CommandTrace;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[tauri::command]
pub fn read_lock_status(project_root: String) -> Result<Vec<SubjectModuleStatus>, String> {
    let trace = CommandTrace::new("read_lock_status");
    trace.arg("project_root", &project_root);

    let root = PathBuf::from(project_root);
    let lock_root = root.join("derivatives").join("ExploreASL").join("lock");
    if !lock_root.exists() {
        trace.success(&Vec::<SubjectModuleStatus>::new());
        return Ok(Vec::new());
    }

    let mut statuses = Vec::new();
    let mut subject_sessions = std::collections::HashSet::new();

    // Structural module
    let structural_lock = lock_root.join("xASL_module_Structural");
    if structural_lock.exists() {
        for entry in std::fs::read_dir(&structural_lock)
            .map_err(|e| format!("Failed to read structural lock: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let subject_session = entry.file_name().to_string_lossy().to_string();
            subject_sessions.insert(subject_session.clone());

            let module_lock = entry.path().join("xASL_module_Structural");
            if module_lock.exists() {
                let (status, completed_steps, locked) = determine_status(&module_lock);
                let bids2legacy_exists = lock_root
                    .join("xASL_module_BIDS2Legacy")
                    .join(&subject_session)
                    .exists();
                statuses.push(SubjectModuleStatus {
                    subject_session,
                    module_name: "xASL_module_Structural".to_string(),
                    run: None,
                    status,
                    completed_steps,
                    locked,
                    bids2legacy_exists: Some(bids2legacy_exists),
                });
            }
        }
    }

    // ASL module
    let asl_lock = lock_root.join("xASL_module_ASL");
    if asl_lock.exists() {
        for entry in
            std::fs::read_dir(&asl_lock).map_err(|e| format!("Failed to read ASL lock: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let subject_session = entry.file_name().to_string_lossy().to_string();
            subject_sessions.insert(subject_session);
        }
    }

    // Check ASL status for all subject sessions
    for subject_session in &subject_sessions {
        let structural_time = get_structural_completion_time(&root, subject_session);
        let asl_subject_dir = lock_root.join("xASL_module_ASL").join(subject_session);

        let mut processed_runs = std::collections::HashSet::new();

        if asl_subject_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
                for run_entry in entries.flatten() {
                    if run_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        let run_name = run_entry.file_name().to_string_lossy().to_string();
                        if run_name.starts_with("xASL_module_ASL_ASL_") {
                            let (mut status, completed_steps, locked) =
                                determine_status(&run_entry.path());
                            let run = run_name
                                .strip_prefix("xASL_module_ASL_ASL_")
                                .map(normalize_asl_run_id);

                            if let Some(ref r) = run {
                                processed_runs.insert(r.clone());
                                if let Some(st) = structural_time {
                                    if let Some(at) =
                                        get_asl_completion_time(&root, subject_session, r)
                                    {
                                        if st > at {
                                            status = "outdated".to_string();
                                        }
                                    }
                                }
                            }

                            let bids2legacy_exists = lock_root
                                .join("xASL_module_BIDS2Legacy")
                                .join(subject_session)
                                .exists();
                            statuses.push(SubjectModuleStatus {
                                subject_session: subject_session.clone(),
                                module_name: "xASL_module_ASL".to_string(),
                                run,
                                status,
                                completed_steps,
                                locked,
                                bids2legacy_exists: Some(bids2legacy_exists),
                            });
                        }
                    }
                }
            }
        }

        // Discover runs from logs that might have been cleared
        let runs_from_logs = find_asl_runs_from_logs(&root, subject_session);
        for run in runs_from_logs {
            if processed_runs.contains(&run) {
                continue;
            }
            if let Some(st) = structural_time {
                if let Some(at) = get_asl_completion_time(&root, subject_session, &run) {
                    if st > at {
                        let bids2legacy_exists = lock_root
                            .join("xASL_module_BIDS2Legacy")
                            .join(subject_session)
                            .exists();
                        statuses.push(SubjectModuleStatus {
                            subject_session: subject_session.clone(),
                            module_name: "xASL_module_ASL".to_string(),
                            run: Some(run),
                            status: "outdated".to_string(),
                            completed_steps: Vec::new(),
                            locked: false,
                            bids2legacy_exists: Some(bids2legacy_exists),
                        });
                    }
                }
            }
        }
    }

    // Population module
    let population_lock = lock_root.join("xASL_module_Population");
    let mut pop_status = "pending".to_string();
    let mut pop_completed_steps = Vec::new();
    let mut pop_locked = false;

    if population_lock.exists() {
        let module_lock = population_lock.join("xASL_module_Population");
        if module_lock.exists() {
            let (status, completed_steps, locked) = determine_status(&module_lock);
            pop_status = status;
            pop_completed_steps = completed_steps;
            pop_locked = locked;
        }
    }

    // Check if Population is outdated
    let mut pop_time = None;
    let pop_ready_file = lock_root
        .join("xASL_module_Population")
        .join("xASL_module_Population")
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&pop_ready_file) {
        if let Ok(mtime) = metadata.modified() {
            pop_time = Some(mtime);
        }
    }
    if pop_time.is_none() {
        let log_dirs = exploreasl_log_dirs(&root);
        for log_dir in log_dirs {
            let log_file = log_dir.join("xASL_module_Population.log");
            if log_file.is_file() && !check_log_for_error(&log_file) {
                if let Ok(metadata) = std::fs::metadata(&log_file) {
                    if let Ok(mtime) = metadata.modified() {
                        pop_time = Some(mtime);
                        break;
                    }
                }
            }
        }
    }

    if let Some(pt) = pop_time {
        let mut is_outdated = false;
        for ss in &subject_sessions {
            if let Some(st) = get_structural_completion_time(&root, ss) {
                if st > pt {
                    is_outdated = true;
                    break;
                }
            }
            let runs = find_asl_runs_from_logs(&root, ss);
            let mut all_runs = runs;
            let asl_subject_dir = lock_root.join("xASL_module_ASL").join(ss);
            if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("xASL_module_ASL_ASL_") {
                        if let Some(run_str) = name.strip_prefix("xASL_module_ASL_ASL_") {
                            let run = normalize_asl_run_id(run_str);
                            if !all_runs.contains(&run) {
                                all_runs.push(run);
                            }
                        }
                    }
                }
            }
            for run in all_runs {
                if let Some(at) = get_asl_completion_time(&root, ss, &run) {
                    if at > pt {
                        is_outdated = true;
                        break;
                    }
                }
            }
            if is_outdated {
                break;
            }
        }
        if is_outdated {
            pop_status = "outdated".to_string();
        }
    }

    if population_lock.exists() || pop_status == "outdated" {
        statuses.push(SubjectModuleStatus {
            subject_session: String::new(),
            module_name: "xASL_module_Population".to_string(),
            run: None,
            status: pop_status,
            completed_steps: pop_completed_steps,
            locked: pop_locked,
            bids2legacy_exists: None,
        });
    }

    trace.success(&statuses);
    Ok(statuses)
}

pub(crate) fn clear_stale_lock_dirs(lock_root: &Path, b_process: &[bool]) -> Result<(), String> {
    for (i, &enabled) in b_process.iter().enumerate() {
        if !enabled {
            continue;
        }
        clear_module_locked_dirs(lock_root, module_index_to_name(i))?;
    }
    Ok(())
}

fn clear_module_locked_dirs(lock_root: &Path, module_name: &str) -> Result<(), String> {
    let module_lock = lock_root.join(module_name);
    if !module_lock.exists() {
        return Ok(());
    }
    for entry in WalkDir::new(&module_lock).min_depth(1) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.file_type().is_dir() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n == "locked")
                .unwrap_or(false)
            {
                if let Err(e) = fs::remove_dir_all(path) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!(
                            "Failed to clear stale locked dir {}: {}",
                            path.display(),
                            e
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn clear_stale_locks(project_root: String) -> Result<(), String> {
    let lock_root = PathBuf::from(&project_root)
        .join("derivatives")
        .join("ExploreASL")
        .join("lock");
    if !lock_root.exists() {
        return Ok(());
    }
    for module_name in &[
        "xASL_module_Structural",
        "xASL_module_ASL",
        "xASL_module_Population",
    ] {
        clear_module_locked_dirs(&lock_root, module_name)?;
    }
    Ok(())
}

pub(crate) fn delete_bids2legacy_locks(
    project_root: &Path,
    subject_regexp: &str,
) -> Result<(), String> {
    let lock_root = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock");
    let bids2legacy_dir = lock_root.join("xASL_module_BIDS2Legacy");
    if !bids2legacy_dir.exists() {
        return Ok(());
    }

    let subject_re = if subject_regexp.is_empty() {
        None
    } else {
        Some(
            regex::Regex::new(subject_regexp)
                .map_err(|e| format!("Invalid subject regexp '{}': {}", subject_regexp, e))?,
        )
    };

    for entry in fs::read_dir(&bids2legacy_dir).map_err(|e| {
        format!(
            "Failed to read BIDS2Legacy lock dir {}: {}",
            bids2legacy_dir.display(),
            e
        )
    })? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let subject_session_name = entry.file_name().to_string_lossy().to_string();

        if let Some(ref re) = subject_re {
            if !re.is_match(&subject_session_name) {
                continue;
            }
        }

        if let Err(e) = fs::remove_dir_all(entry.path()) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "Failed to delete BIDS2Legacy lock dir {}: {}",
                    entry.path().display(),
                    e
                ));
            }
        }
    }

    Ok(())
}

pub(crate) fn delete_status_files_for_modules(
    project_root: &Path,
    b_process: &[bool],
    subject_regexp: &str,
) -> Result<(), String> {
    let lock_root = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock");
    if !lock_root.exists() {
        return Ok(());
    }

    let subject_re = if subject_regexp.is_empty() {
        None
    } else {
        Some(
            regex::Regex::new(subject_regexp)
                .map_err(|e| format!("Invalid subject regexp '{}': {}", subject_regexp, e))?,
        )
    };

    for (i, &enabled) in b_process.iter().enumerate() {
        if !enabled {
            continue;
        }
        let module_name = module_index_to_name(i);
        let module_lock_dir = lock_root.join(module_name);
        if !module_lock_dir.exists() {
            continue;
        }

        if module_name == "xASL_module_Population" {
            let pop_dir = module_lock_dir.join(module_name);
            if pop_dir.exists() {
                delete_status_files_in_dir(&pop_dir)?;
            }
            continue;
        }

        for entry in fs::read_dir(&module_lock_dir).map_err(|e| {
            format!(
                "Failed to read lock dir {}: {}",
                module_lock_dir.display(),
                e
            )
        })? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let subject_name = entry.file_name().to_string_lossy().to_string();

            if let Some(ref re) = subject_re {
                if !re.is_match(&subject_name) {
                    continue;
                }
            }

            if module_name == "xASL_module_ASL" {
                for run_entry in fs::read_dir(entry.path())
                    .map_err(|e| format!("Failed to read ASL subject lock dir: {}", e))?
                {
                    let run_entry =
                        run_entry.map_err(|e| format!("Failed to read run entry: {}", e))?;
                    if !run_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        continue;
                    }
                    let run_name = run_entry.file_name().to_string_lossy().to_string();
                    if run_name.starts_with("xASL_module_ASL_ASL_") {
                        delete_status_files_in_dir(&run_entry.path())?;
                    }
                }
            } else {
                let subject_module_dir = entry.path().join(module_name);
                if subject_module_dir.exists() {
                    delete_status_files_in_dir(&subject_module_dir)?;
                }
            }
        }
    }

    Ok(())
}

fn delete_status_files_in_dir(dir: &Path) -> Result<(), String> {
    for entry in WalkDir::new(dir).min_depth(1) {
        let entry = entry.map_err(|e| format!("WalkDir error: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
                if file_name.ends_with(".status") {
                    match fs::remove_file(path) {
                        Ok(()) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(e) => {
                            return Err(format!(
                                "Failed to delete status file {}: {}",
                                path.display(),
                                e
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
