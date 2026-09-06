use super::output::{
    contains_portable_subject, owned_subject_spelling, validate_owned_subjects,
    validate_preserved_subjects_are_disjoint, validate_subject_components,
};
use super::relocation;
use super::relocation::RelocationPlan;
use super::staging;
use super::types::{ImportCommandError, ImportLifecycle, ImportPrepareComplete, ImportState};
use super::validation::{rollback_preparation_failure, validate_import_not_running};
use crate::app_state::AppState;
use crate::error::MutexExt;
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub(crate) const RESERVED_IMPORT_PID: u32 = 0;

pub(super) fn plan_import_relocation_for_state(
    state: &AppState,
    subject_list: &[String],
) -> AnyResult<RelocationPlan> {
    validate_subject_components(subject_list)?;
    let root = state
        .active_project_root
        .lock_or_bail("Active project state")?
        .clone()
        .context("No active project root")?;
    let sequence = state
        .relocation_plan_sequence
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let plan_id = format!("relocation-{}-{timestamp}-{sequence}", std::process::id());
    let plan = relocation::create_plan(&root, subject_list, plan_id.clone())?;
    state
        .relocation_plans
        .lock_or_bail("Relocation plan state")?
        .insert(plan_id, plan.clone());
    Ok(plan)
}

#[cfg(test)]
pub(super) fn reserve_import_state(
    state: &AppState,
    staging_root: PathBuf,
    project_root: PathBuf,
    run_request_id: String,
    subject_list: Vec<String>,
) -> AnyResult<u64> {
    let mut import_state = state.import_state.lock_or_bail("Import state")?;
    validate_import_not_running(&import_state)?;
    *import_state = ImportState::new(staging_root, project_root, subject_list);
    import_state.run_request_id = run_request_id;
    let generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    import_state.ownership_generation = generation;
    import_state.lifecycle = ImportLifecycle::Preparing;
    import_state.child_pid = Some(RESERVED_IMPORT_PID);

    Ok(generation)
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ImportReservation {
    pub(super) generation: u64,
    pub(super) preserved_subjects: Vec<String>,
}

pub(super) fn validate_terminal_import_ownership(
    import_state: &ImportState,
    active_project_root: &Path,
    expected_staging_root: &Path,
) -> AnyResult<()> {
    if import_state.project_root.as_os_str().is_empty()
        || import_state.staging_root.as_os_str().is_empty()
    {
        bail!("No active import ownership");
    }
    if import_state.lifecycle != ImportLifecycle::Terminal {
        bail!("Import process has not reached terminal state");
    }
    if fs::canonicalize(&import_state.project_root).with_context(|| {
        format!(
            "Failed to canonicalize import project root {}",
            import_state.project_root.display()
        )
    })? != active_project_root
    {
        bail!("Import ownership does not match the active project root");
    }
    if import_state.staging_root != expected_staging_root {
        bail!("Import ownership has a malformed staging root");
    }
    if let Ok(metadata) = fs::symlink_metadata(expected_staging_root)
        && metadata.file_type().is_symlink()
    {
        bail!("Import ownership staging root must not be a symlink");
    }
    if expected_staging_root.exists()
        && fs::canonicalize(expected_staging_root).with_context(|| {
            format!(
                "Failed to canonicalize import staging root {}",
                expected_staging_root.display()
            )
        })? != expected_staging_root
    {
        bail!("Import ownership staging root is not canonical");
    }
    Ok(())
}

pub(super) fn reserve_import_state_for_run(
    state: &AppState,
    staging_root: PathBuf,
    project_root: PathBuf,
    run_request_id: String,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    relocation_plan_id: String,
) -> AnyResult<ImportReservation> {
    // Hold active-project and import ownership locks through authorization and
    // replacement. The project transition uses the active-project lock, while
    // the supervisor uses import ownership, so neither can interleave here.
    let active_project_root_guard = state
        .active_project_root
        .lock_or_bail("Active project state")?;
    let active_project_root = active_project_root_guard
        .as_ref()
        .context("No active project root")?;
    let active_project_root = fs::canonicalize(active_project_root).with_context(|| {
        format!(
            "Failed to canonicalize active project root {}",
            active_project_root.display()
        )
    })?;
    let expected_staging_root = active_project_root.join(staging::STAGING_DIRECTORY);
    if project_root != active_project_root || staging_root != expected_staging_root {
        bail!("Compiled staging plan does not match the active project root");
    }

    let mut import_state = state.import_state.lock_or_bail("Import state")?;
    validate_import_not_running(&import_state)?;

    let requested_preserved_subjects = subjects_to_preserve.unwrap_or_default();
    let mut preserved_subjects = requested_preserved_subjects.clone();
    if !preserved_subjects.is_empty() {
        validate_subject_components(&preserved_subjects)?;
        validate_preserved_subjects_are_disjoint(&subject_list, &preserved_subjects)?;
        validate_terminal_import_ownership(
            &import_state,
            &active_project_root,
            &expected_staging_root,
        )?;
        validate_owned_subjects(&import_state.subject_list, &preserved_subjects)?;
        if preserved_subjects
            .iter()
            .any(|subject| contains_portable_subject(&import_state.failed_subjects, subject))
        {
            bail!("Retry preserve subjects include a failed subject");
        }
        validate_owned_subjects(&import_state.succeeded_subjects, &preserved_subjects)?;
        preserved_subjects = requested_preserved_subjects
            .iter()
            .map(|subject| {
                owned_subject_spelling(&import_state.subject_list, subject)
                    .expect("validated preserved subject")
                    .to_string()
            })
            .collect();
    }

    *import_state = ImportState::new(staging_root, project_root, subject_list);
    import_state.relocation_plan_id = Some(relocation_plan_id);
    import_state.run_request_id = run_request_id;
    let generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    import_state.ownership_generation = generation;
    import_state.lifecycle = ImportLifecycle::Preparing;
    import_state.child_pid = Some(RESERVED_IMPORT_PID);

    Ok(ImportReservation {
        generation,
        preserved_subjects,
    })
}

pub(super) fn validate_relocation_plan_for_run(
    state: &AppState,
    plan_id: &str,
    project_root: &Path,
    subjects: &[String],
) -> AnyResult<()> {
    let plans = state
        .relocation_plans
        .lock_or_bail("Relocation plan state")?;
    let plan = plans
        .get(plan_id)
        .context("Confirmed relocation plan is unavailable")?;
    relocation::validate_plan_scope(plan, project_root, subjects)
}

pub(super) fn bind_relocation_plan_for_run(
    state: &AppState,
    plan_id: &str,
    project_root: &Path,
    subjects: &[String],
    generation: u64,
) -> AnyResult<()> {
    let mut plans = state
        .relocation_plans
        .lock_or_bail("Relocation plan state")?;
    let plan = plans
        .get_mut(plan_id)
        .context("Confirmed relocation plan is unavailable")?;
    relocation::bind_plan(plan, project_root, subjects, generation)
}

pub(super) fn clear_reserved_import(state: &AppState, generation: u64) {
    if let Ok(mut import_state) = state.import_state.lock()
        && import_state.ownership_generation == generation
        && import_state.lifecycle == ImportLifecycle::Preparing
    {
        *import_state = ImportState::default();
    }
}

pub(super) fn rollback_reserved_preparation_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: String,
) -> String {
    clear_reserved_import(state, generation);
    rollback_preparation_failure(staging_root, error)
}

pub(super) fn rollback_reserved_operational_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: anyhow::Error,
) -> ImportCommandError {
    ImportCommandError::from(rollback_reserved_preparation_failure(
        state,
        generation,
        staging_root,
        format!("{error:#}"),
    ))
}

pub(super) fn rollback_process_spawn_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    process_name: &str,
    executable_path: &str,
    error: std::io::Error,
) -> ImportCommandError {
    let message = if error.kind() == std::io::ErrorKind::NotFound {
        format!("{process_name} executable not found: {executable_path}")
    } else {
        format!("Failed to spawn {process_name} import process: {error}")
    };
    ImportCommandError::from(rollback_reserved_preparation_failure(
        state,
        generation,
        staging_root,
        message,
    ))
}

pub(super) fn cleanup_after_prepare_event_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: String,
) -> String {
    if clear_matching_import(state, generation) {
        rollback_preparation_failure(staging_root, error)
    } else {
        error
    }
}

pub(super) fn set_reserved_import_pid(
    state: &AppState,
    generation: u64,
    child_pid: u32,
) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Preparing
        || import_state.child_pid != Some(RESERVED_IMPORT_PID)
    {
        return Err(
            "Import state changed before process tracking could be established".to_string(),
        );
    }

    import_state.child_pid = Some(child_pid);
    import_state.lifecycle = ImportLifecycle::Running;
    Ok(())
}

pub(super) fn clear_matching_import(state: &AppState, generation: u64) -> bool {
    if let Ok(mut import_state) = state.import_state.lock()
        && import_state.ownership_generation == generation
    {
        *import_state = ImportState::default();
        return true;
    }
    false
}

pub(super) fn emit_prepare_complete_for_running_import<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    generation: u64,
    child_pid: u32,
) -> Result<bool, String> {
    let import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Running
        || import_state.child_pid != Some(child_pid)
    {
        return Ok(false);
    }

    // Keep ownership locked through emission so a replacement reservation cannot
    // receive this generation's readiness notification.
    app.emit(
        "ImportPrepareComplete",
        ImportPrepareComplete {
            run_request_id: import_state.run_request_id.clone(),
            ownership_generation: generation,
        },
    )
    .map_err(|error| format!("Failed to emit ImportPrepareComplete: {error}"))?;
    Ok(true)
}

pub(super) fn set_import_supervisor_handle(
    state: &AppState,
    generation: u64,
    child_pid: u32,
    supervisor_handle: thread::JoinHandle<()>,
) -> Result<(), (String, thread::JoinHandle<()>)> {
    let mut import_state = match state.import_state.lock() {
        Ok(import_state) => import_state,
        Err(_) => {
            return Err((
                "Import state lock was poisoned".to_string(),
                supervisor_handle,
            ));
        }
    };

    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Running
        || import_state.child_pid != Some(child_pid)
    {
        return Err((
            format!(
                "Import state changed before supervisor tracking could be established for PID {child_pid}"
            ),
            supervisor_handle,
        ));
    }

    import_state.supervisor_handle = Some(supervisor_handle);
    Ok(())
}

pub(super) fn mark_import_terminal_if_matches(
    state: &mut ImportState,
    generation: u64,
    child_pid: u32,
) -> bool {
    if state.ownership_generation == generation
        && state.lifecycle == ImportLifecycle::Running
        && state.child_pid == Some(child_pid)
    {
        state.child_pid = None;
        state.lifecycle = ImportLifecycle::Terminal;
        true
    } else {
        false
    }
}
