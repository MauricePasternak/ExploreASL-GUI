use super::journal::{load_record, record_from_state, remove_record, write_record};
use super::output::{validate_preserved_subjects_are_disjoint, validate_subject_components};
use super::relocation;
use super::relocation::RelocationPlan;
use super::staging;
use super::types::{
    ImportCommandError, ImportLifecycle, ImportRunSnapshot, ImportState, ImportStructuredError,
    ImportTerminalResult, now_ms,
};
use super::validation::rollback_preparation_failure;
use crate::app_state::AppState;
use crate::error::MutexExt;
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

pub(crate) const RESERVED_IMPORT_PID: u32 = 0;

pub(crate) fn persist(state: &ImportState) -> AnyResult<()> {
    write_record(&state.project_root, &record_from_state(state)?)
}

pub(super) fn active_project_root(state: &AppState) -> AnyResult<PathBuf> {
    let root = state
        .active_project_root
        .lock_or_bail("Active project state")?
        .clone()
        .context("No active project root")?;
    fs::canonicalize(root).context("Failed to canonicalize active project root")
}

/// Recover only durable authority.  No OS process is adopted after a native
/// restart: Preparing/Running become Interrupted even if stale locks exist.
pub(crate) fn recover_import_run_for_project(
    state: &AppState,
    project_root: &Path,
) -> AnyResult<Option<ImportRunSnapshot>> {
    let Some(record) = load_record(project_root)? else {
        return Ok(None);
    };
    if record.acknowledged {
        remove_record(project_root)?;
        return Ok(None);
    }
    let snapshot = record.snapshot;
    let mut run = ImportState::new(
        project_root.join(&record.staging_relative_path),
        project_root.to_path_buf(),
        snapshot.selected_subjects.clone(),
    );
    run.run_id = snapshot.run_id;
    run.lifecycle = snapshot.lifecycle;
    run.ownership_generation = snapshot.ownership_generation;
    run.profile_id = snapshot.profile_id;
    run.created_at_ms = snapshot.created_at_ms;
    run.updated_at_ms = snapshot.updated_at_ms;
    run.exit_evidence = snapshot.exit_evidence;
    run.subject_outcomes = snapshot.subject_outcomes;
    run.relocation_outcome = snapshot.relocation_outcome;
    run.error = snapshot.error;
    run.terminal_result = snapshot.terminal_result;
    run.staging_generation = record.staging_generation;
    run.preserved_subjects = record.preserved_subjects;
    run.preserve_staging = record.preserve_staging;
    run.relocation_plan_id = record.relocation_plan_id;
    run.relocation_plan = record.relocation_plan.map(|mut plan| {
        plan.project_root = project_root.to_path_buf();
        plan.project_identity = super::relocation::project_identity(project_root);
        plan.bound_generation = Some(run.ownership_generation);
        plan
    });
    run.acknowledged = false;
    if matches!(
        run.lifecycle,
        ImportLifecycle::Preparing | ImportLifecycle::Running | ImportLifecycle::Cancelling
    ) {
        run.lifecycle = ImportLifecycle::Interrupted;
        run.terminal_result = Some(ImportTerminalResult::Interrupted);
        run.error = Some(ImportStructuredError {
            code: "interrupted".to_string(),
            message: "Native import supervisor was not available after restart".to_string(),
            subject: None,
            staging_issues: None,
        });
        run.updated_at_ms = now_ms();
        for subject in &run.subject_list {
            if !run
                .subject_outcomes
                .iter()
                .any(|outcome| outcome.subject == *subject)
            {
                run.subject_outcomes
                    .push(super::types::ImportSubjectOutcome {
                        subject: subject.clone(),
                        outcome: super::types::ImportSubjectOutcomeKind::Interrupted,
                        ready_lock_verified: false,
                        rawdata_verified: false,
                        committed: false,
                        error: None,
                    });
            }
        }
        for outcome in &mut run.subject_outcomes {
            if !outcome.committed {
                outcome.outcome = super::types::ImportSubjectOutcomeKind::Interrupted;
            }
        }
        persist(&run)?;
    }
    let previous = {
        let mut current = state.import_state.lock_or_bail("Import state")?;
        std::mem::replace(&mut *current, run)
    };
    if snapshot.lifecycle == ImportLifecycle::Finalizing {
        // Relocation recovery runs before this function. Re-enter native
        // finalization from its durable exit/verification checkpoints.
        if let Err(error) =
            super::pipeline::resume_finalizing_import(state, snapshot.ownership_generation)
        {
            *state.import_state.lock_or_bail("Import state")? = previous;
            return Err(error);
        }
    }
    let run = state.import_state.lock_or_bail("Import state")?;
    Ok((!run.run_id.is_empty() && !run.acknowledged).then(|| run.snapshot()))
}

pub(super) fn reserve_import_run_for_state(
    state: &AppState,
    subject_list: Vec<String>,
    relocation_plan_id: String,
    profile_id: String,
    subjects_to_preserve: Vec<String>,
    preserve_staging: bool,
) -> AnyResult<ImportRunSnapshot> {
    validate_subject_components(&subject_list)?;
    if subject_list.is_empty() {
        bail!("At least one subject must be selected");
    }
    if relocation_plan_id.trim().is_empty() {
        bail!("Confirmed relocation plan is required");
    }
    if profile_id.trim().is_empty() {
        bail!("Execution profile identity is required");
    }
    let project_root = active_project_root(state)?;
    validate_relocation_plan_for_run(state, &relocation_plan_id, &project_root, &subject_list)?;
    let relocation_plan = state
        .relocation_plans
        .lock_or_bail("Relocation plan state")?
        .get(&relocation_plan_id)
        .cloned()
        .context("Confirmed relocation plan is unavailable")?;
    validate_subject_components(&subjects_to_preserve)?;
    validate_preserved_subjects_are_disjoint(&subject_list, &subjects_to_preserve)?;
    for subject in &subjects_to_preserve {
        if !super::status::is_committed_import_subject(&project_root, subject)? {
            bail!("Retry preserve subject is not a verified committed project artifact: {subject}");
        }
    }
    let mut import_state = state.import_state.lock_or_bail("Import state")?;
    if !matches!(import_state.lifecycle, ImportLifecycle::Idle) {
        bail!("A non-acknowledged import run already owns this project");
    }
    let staging_root = project_root.join(staging::STAGING_DIRECTORY);
    let mut run = ImportState::new(staging_root, project_root, subject_list);
    run.run_id = format!("import-run-{}", uuid::Uuid::new_v4());
    run.profile_id = profile_id;
    run.relocation_plan_id = Some(relocation_plan_id);
    run.relocation_plan = Some(relocation_plan);
    run.preserved_subjects = subjects_to_preserve;
    run.preserve_staging = preserve_staging;
    run.ownership_generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    run.lifecycle = ImportLifecycle::Preparing;
    run.updated_at_ms = now_ms();
    // Write-ahead: no staging mutation has occurred at this point.
    persist(&run)?;
    let snapshot = run.snapshot();
    *import_state = run;
    Ok(snapshot)
}

pub(super) fn attach_import_run_for_state(
    state: &AppState,
    run_id: &str,
) -> AnyResult<ImportRunSnapshot> {
    let project_root = active_project_root(state)?;
    let import_state = state.import_state.lock_or_bail("Import state")?;
    if import_state.run_id != run_id
        || import_state.project_root != project_root
        || import_state.acknowledged
    {
        bail!("Import run ID is obsolete, unknown, or belongs to another project");
    }
    Ok(import_state.snapshot())
}

pub(super) fn get_active_import_run_for_state(
    state: &AppState,
) -> AnyResult<Option<ImportRunSnapshot>> {
    let project_root = active_project_root(state)?;
    let import_state = state.import_state.lock_or_bail("Import state")?;
    Ok((!import_state.run_id.is_empty()
        && !import_state.acknowledged
        && import_state.project_root == project_root)
        .then(|| import_state.snapshot()))
}

pub(super) fn acknowledge_import_run_for_state(state: &AppState, run_id: &str) -> AnyResult<()> {
    let project_root = active_project_root(state)?;
    let mut import_state = state.import_state.lock_or_bail("Import state")?;
    if import_state.run_id != run_id || import_state.project_root != project_root {
        bail!("Import run ID is obsolete, unknown, or belongs to another project");
    }
    if import_state.acknowledged {
        remove_record(&project_root)?;
        return Ok(());
    }
    if !import_state.lifecycle.is_terminal() {
        bail!("Only a terminal import run can be acknowledged");
    }
    if import_state
        .relocation_outcome
        .as_ref()
        .is_some_and(|outcome| {
            outcome.subjects.iter().any(|subject| {
                subject.status == super::relocation::RelocationSubjectStatus::RecoveryRequired
            })
        })
        || project_root
            .join(super::relocation::JOURNAL_FILE)
            .try_exists()
            .context("Failed to inspect relocation recovery evidence")?
    {
        bail!("Import run still has unresolved relocation recovery evidence");
    }
    // Keep the terminal record byte-for-byte replayable until retirement
    // succeeds. Persisting `acknowledged: true` first would turn a failed
    // removal into a non-replayable record on both this process and restart.
    remove_record(&project_root)?;
    let acknowledged = ImportState {
        run_id: run_id.to_string(),
        project_root,
        acknowledged: true,
        ..ImportState::default()
    };
    *import_state = acknowledged;
    Ok(())
}

pub(super) fn admit_reserved_import_launch(
    state: &AppState,
    run_id: &str,
    staging_root: &Path,
    project_root: &Path,
    subjects: &[String],
    relocation_plan_id: &str,
    profile_id: &str,
) -> AnyResult<ImportReservation> {
    let active_root = active_project_root(state)?;
    if project_root != active_root || staging_root != active_root.join(staging::STAGING_DIRECTORY) {
        bail!("Compiled staging plan does not match the active project root");
    }
    validate_relocation_plan_for_run(state, relocation_plan_id, project_root, subjects)?;
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.run_id != run_id
        || run.lifecycle != ImportLifecycle::Preparing
        // Admission is one-shot.  The reservation marker is private native
        // state, but prevents a second launch from racing the first before it
        // has transitioned to Running.
        || run.child_pid.is_some()
        || run.project_root != active_root
        || run.subject_list != subjects
        || run.relocation_plan_id.as_deref() != Some(relocation_plan_id)
        || run.profile_id != profile_id
    {
        bail!("Import run is obsolete or is not eligible for launch");
    }
    // The durable Preparing checkpoint already exists.  Binding the relocation
    // plan does not mutate staging and retains this exact ownership generation.
    run.updated_at_ms = now_ms();
    let generation = run.ownership_generation;
    if let Some(plan) = run.relocation_plan.as_mut() {
        super::relocation::bind_plan(plan, project_root, subjects, generation)?;
    }
    run.child_pid = Some(RESERVED_IMPORT_PID);
    persist(&run)?;
    Ok(ImportReservation {
        generation: run.ownership_generation,
        preserved_subjects: run.preserved_subjects.clone(),
    })
}

pub(super) fn fail_admitted_preparation(
    state: &AppState,
    generation: u64,
    message: String,
) -> AnyResult<ImportRunSnapshot> {
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Preparing {
        bail!("Import reservation is obsolete");
    }
    run.transition(ImportLifecycle::Failed)
        .map_err(anyhow::Error::msg)?;
    run.error = Some(ImportStructuredError {
        code: "launch".to_string(),
        message,
        subject: None,
        staging_issues: None,
    });
    run.terminal_result = Some(ImportTerminalResult::Failed);
    persist(&run)?;
    Ok(run.snapshot())
}

pub(super) fn fail_preparing_run_for_id(
    state: &AppState,
    run_id: &str,
    error: ImportStructuredError,
) -> AnyResult<Option<ImportRunSnapshot>> {
    let project_root = active_project_root(state)?;
    let generation = {
        let run = state.import_state.lock_or_bail("Import state")?;
        if run.run_id != run_id
            || run.project_root != project_root
            || run.lifecycle != ImportLifecycle::Preparing
        {
            return Ok(None);
        }
        run.ownership_generation
    };
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Preparing {
        return Ok(None);
    }
    run.transition(ImportLifecycle::Failed)
        .map_err(anyhow::Error::msg)?;
    run.error = Some(error);
    run.terminal_result = Some(ImportTerminalResult::Failed);
    persist(&run)?;
    Ok(Some(run.snapshot()))
}

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

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ImportReservation {
    pub(super) generation: u64,
    pub(super) preserved_subjects: Vec<String>,
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

pub(super) fn rollback_reserved_preparation_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: String,
) -> String {
    let durable_error = fail_admitted_preparation(state, generation, error.clone())
        .err()
        .map(|failure| {
            format!("; additionally failed to persist terminal import result: {failure:#}")
        })
        .unwrap_or_default();
    rollback_preparation_failure(staging_root, format!("{error}{durable_error}"))
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
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && !run.lifecycle.is_terminal()
    {
        run.child_pid = None;
        run.lifecycle = ImportLifecycle::Failed;
        run.terminal_result = Some(ImportTerminalResult::Failed);
        run.error = Some(ImportStructuredError {
            code: "launch".to_string(),
            message: error.clone(),
            subject: None,
            staging_issues: None,
        });
        run.updated_at_ms = now_ms();
        let _ = persist(&run);
    }
    rollback_preparation_failure(staging_root, error)
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
    let prior_lifecycle = import_state.lifecycle;
    let prior_updated_at = import_state.updated_at_ms;
    import_state
        .transition(ImportLifecycle::Running)
        .map_err(|error| format!("Failed to transition import run: {error}"))?;
    if let Err(error) = persist(&import_state) {
        import_state.lifecycle = prior_lifecycle;
        import_state.updated_at_ms = prior_updated_at;
        import_state.child_pid = Some(RESERVED_IMPORT_PID);
        return Err(format!("Failed to persist running import run: {error:#}"));
    }
    Ok(())
}

pub(super) fn emit_running_snapshot<R: Runtime>(
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
    app.emit("import-run-snapshot", import_state.snapshot())
        .map_err(|error| format!("Failed to emit running import snapshot: {error}"))?;
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
