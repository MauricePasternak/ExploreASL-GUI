//! ExploreASL processing lock status and watcher path parsing.
use super::completion::{
    get_asl_completion_time, get_population_completion_time, get_structural_completion_time,
};
use super::identifiers::normalize_asl_run_id;
use super::logs::find_asl_runs_from_logs;
use super::types::{LockCreated, ParsedLockComponents, StatusFileCreated, SubjectModuleStatus};
use crate::error::IntoCommandResult;
use crate::tracing::CommandTrace;
use anyhow::{Context, Result as AnyResult};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[tauri::command]
pub fn read_lock_status(project_root: String) -> Result<Vec<SubjectModuleStatus>, String> {
    read_lock_status_impl(project_root).into_command_result()
}

fn read_lock_status_impl(project_root: String) -> AnyResult<Vec<SubjectModuleStatus>> {
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
        for entry in
            std::fs::read_dir(&structural_lock).context("Failed to read structural lock")?
        {
            let entry = entry.context("Failed to read entry")?;
            if !entry.file_type().is_ok_and(|ft| ft.is_dir()) {
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
        for entry in std::fs::read_dir(&asl_lock).context("Failed to read ASL lock")? {
            let entry = entry.context("Failed to read entry")?;
            if !entry.file_type().is_ok_and(|ft| ft.is_dir()) {
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

        if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
            for run_entry in entries.flatten() {
                if run_entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                    let run_name = run_entry.file_name().to_string_lossy().to_string();
                    if let Some(run_str) = run_name.strip_prefix("xASL_module_ASL_ASL_") {
                        let (mut status, completed_steps, locked) =
                            determine_status(&run_entry.path());
                        let run = Some(normalize_asl_run_id(run_str));

                        if let Some(ref r) = run {
                            processed_runs.insert(r.clone());
                            if let Some(st) = structural_time
                                && let Some(at) = get_asl_completion_time(&root, subject_session, r)
                                && st > at
                            {
                                status = "outdated".to_string();
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

        // Discover runs from logs that might have been cleared
        let runs_from_logs = find_asl_runs_from_logs(&root, subject_session);
        for run in runs_from_logs {
            if processed_runs.contains(&run) {
                continue;
            }
            if let Some(st) = structural_time
                && let Some(at) = get_asl_completion_time(&root, subject_session, &run)
                && st > at
            {
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
    let pop_time = get_population_completion_time(&root);

    if let Some(pt) = pop_time {
        let mut is_outdated = false;
        for ss in &subject_sessions {
            if let Some(st) = get_structural_completion_time(&root, ss)
                && st > pt
            {
                is_outdated = true;
                break;
            }
            let runs = find_asl_runs_from_logs(&root, ss);
            let mut all_runs = runs;
            let asl_subject_dir = lock_root.join("xASL_module_ASL").join(ss);
            if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
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
            for run in all_runs {
                if let Some(at) = get_asl_completion_time(&root, ss, &run)
                    && at > pt
                {
                    is_outdated = true;
                    break;
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

pub(crate) fn determine_status(dir: &Path) -> (String, Vec<String>, bool) {
    let mut has_status = false;
    let mut has_ready = false;
    let mut locked = false;
    let mut completed_steps = Vec::new();

    if dir.join("locked").exists() {
        locked = true;
    }

    for entry in WalkDir::new(dir).min_depth(1).into_iter().flatten() {
        let path = entry.path();
        if path.is_file()
            && let Some(file_name) = path.file_name().and_then(|f| f.to_str())
            && file_name.ends_with(".status")
        {
            has_status = true;
            let step_name = file_name.trim_end_matches(".status").to_string();
            if step_name == "999_ready" {
                has_ready = true;
            } else {
                completed_steps.push(step_name);
            }
        }
    }

    if has_ready {
        locked = false;
    }

    completed_steps.sort();

    let status = if has_ready {
        "complete".to_string()
    } else if has_status {
        "incomplete".to_string()
    } else {
        "pending".to_string()
    };
    (status, completed_steps, locked)
}

pub(crate) fn lock_module_roots(project_root: &Path, module: &str) -> [PathBuf; 2] {
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

fn parse_lock_components(lock_root: &Path, path: &Path) -> Option<ParsedLockComponents> {
    let relative = path.strip_prefix(lock_root).ok()?;
    let parts: Vec<&str> = relative.iter().map(|p| p.to_str().unwrap_or("")).collect();
    let module = parts.first()?.to_string();

    let (subject_session, run) = match module.as_str() {
        "xASL_module_Structural" => {
            if parts.len() < 4 {
                return None;
            }
            (Some(parts[1].to_string()), None)
        }
        "xASL_module_ASL" => {
            if parts.len() < 4 {
                return None;
            }
            let run = parts[2]
                .strip_prefix("xASL_module_ASL_ASL_")
                .map(normalize_asl_run_id);
            (Some(parts[1].to_string()), run)
        }
        "xASL_module_Population" => (None, None),
        _ => return None,
    };

    Some(ParsedLockComponents {
        module,
        subject_session,
        run,
    })
}

pub(crate) fn parse_lock_path(
    lock_root: &Path,
    path: &Path,
    run_id: &str,
) -> Option<StatusFileCreated> {
    let components = parse_lock_components(lock_root, path)?;
    let file_name = path.file_name()?.to_str().unwrap_or("");
    if !file_name.ends_with(".status") {
        return None;
    }

    Some(StatusFileCreated {
        run_id: run_id.to_string(),
        module: components.module,
        subject_session: components.subject_session,
        step_code: file_name.trim_end_matches(".status").to_string(),
        run: components.run,
    })
}

pub(crate) fn parse_lock_dir_path(
    lock_root: &Path,
    path: &Path,
    run_id: &str,
) -> Option<LockCreated> {
    let components = parse_lock_components(lock_root, path)?;
    Some(LockCreated {
        run_id: run_id.to_string(),
        module: components.module,
        subject_session: components.subject_session,
        run: components.run,
    })
}
