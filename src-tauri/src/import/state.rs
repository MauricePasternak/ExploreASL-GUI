use super::journal::{
    exact_record_is_visible, load_record, record_from_state, remove_record, write_record,
};
use super::output::{validate_preserved_subjects_are_disjoint, validate_subject_components};
use super::relocation;
use super::relocation::RelocationPlan;
use super::staging;
use super::types::{
    ImportLifecycle, ImportRunSnapshot, ImportState, ImportStructuredError, ImportTerminalResult,
    now_ms,
};
use crate::app_state::AppState;
use crate::error::MutexExt;
use anyhow::{Context, Result as AnyResult, bail};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;
use tauri::{AppHandle, Emitter, Runtime};

const RESERVATION_DURABILITY_UNCERTAIN: &str = "reservation_durability_uncertain";

pub(super) fn reservation_durability_is_uncertain(state: &ImportState) -> bool {
    state
        .error
        .as_ref()
        .is_some_and(|error| error.code == RESERVATION_DURABILITY_UNCERTAIN)
}

pub(crate) fn persist(state: &ImportState) -> AnyResult<()> {
    if reservation_durability_is_uncertain(state) {
        bail!(
            "Import reservation durability uncertain; retained ownership cannot be durably rewritten"
        );
    }
    write_record(&state.project_root, &record_from_state(state)?)
}

pub(super) fn active_project_root(state: &AppState) -> AnyResult<PathBuf> {
    Ok(crate::project_ownership::active(state)
        .map_err(anyhow::Error::msg)?
        .root()
        .to_path_buf())
}

/// Import recovery never adopts an OS process or infers ownership from scientific status locks.
#[cfg(test)]
pub(crate) fn recover_import_run_for_project(
    state: &AppState,
    project_root: &Path,
) -> AnyResult<Option<ImportRunSnapshot>> {
    recover_processing_before_import(project_root)?;
    recover_import_run_after_processing_recovery(state, project_root)
}

pub(crate) fn recover_import_run_after_processing_recovery(
    state: &AppState,
    project_root: &Path,
) -> AnyResult<Option<ImportRunSnapshot>> {
    let Some(record) = load_record(project_root)? else {
        return Ok(None);
    };
    if record.acknowledged {
        if record
            .snapshot
            .relocation_outcome
            .as_ref()
            .is_some_and(|outcome| {
                outcome.subjects.iter().any(|subject| {
                    subject.status == super::relocation::RelocationSubjectStatus::RecoveryRequired
                })
            })
        {
            bail!("Acknowledged import still has unresolved cleanup evidence");
        }
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
    run.confirmation_required = snapshot.confirmation_required;
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
        run.confirmation_required = true;
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
    let _transition = state
        .project_transition
        .lock_or_bail("Project transition")?;
    crate::project_ownership::ensure_processing_released(state).map_err(anyhow::Error::msg)?;
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
    let mut relocation_plans = state
        .relocation_plans
        .lock_or_bail("Relocation plan state")?;
    let (plan_key, pending_plan) = relocation_plans
        .get_key_value(&relocation_plan_id)
        .context("Confirmed relocation plan is unavailable")?;
    if plan_key != &pending_plan.plan_id {
        bail!("Confirmed relocation plan identity is inconsistent");
    }
    relocation::validate_plan_scope(pending_plan, &project_root, &subject_list)?;
    let generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let mut relocation_plan = pending_plan.clone();
    relocation::bind_plan(
        &mut relocation_plan,
        &project_root,
        &subject_list,
        generation,
    )?;
    let staging_root = project_root.join(staging::STAGING_DIRECTORY);
    let mut run = ImportState::new(staging_root, project_root, subject_list);
    run.run_id = format!("import-run-{}", uuid::Uuid::new_v4());
    run.profile_id = profile_id;
    run.relocation_plan_id = Some(relocation_plan_id.clone());
    run.relocation_plan = Some(relocation_plan);
    run.preserved_subjects = subjects_to_preserve;
    run.preserve_staging = preserve_staging;
    run.ownership_generation = generation;
    run.lifecycle = ImportLifecycle::Preparing;
    run.updated_at_ms = now_ms();
    let previous = std::mem::replace(&mut *import_state, run);
    // Write-ahead: no staging mutation has occurred at this point.
    let expected_record = record_from_state(&import_state)?;
    if let Err(write_error) = write_record(&import_state.project_root, &expected_record) {
        let details = match exact_record_is_visible(&import_state.project_root, &expected_record) {
            Ok(false) => {
                *import_state = previous;
                return Err(write_error);
            }
            Ok(true) => format!("Record write failed: {write_error:#}"),
            Err(visibility_error) => format!(
                "Record write failed: {write_error:#}; visible authority could not be reconciled: {visibility_error:#}"
            ),
        };
        relocation_plans.remove(&relocation_plan_id);
        let message = format!(
            "Import reservation durability uncertain; ownership retained in native memory; no staging or process launch is allowed. Close and reopen the project to recover the interrupted reservation before retrying. {details}"
        );
        import_state.error = Some(ImportStructuredError {
            code: RESERVATION_DURABILITY_UNCERTAIN.to_string(),
            message: message.clone(),
            subject: None,
            staging_issues: None,
        });
        bail!(message);
    }
    relocation_plans.remove(&relocation_plan_id);
    let snapshot = import_state.snapshot();
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
    let _transition = state
        .project_transition
        .lock_or_bail("Project transition")?;
    let ownership = crate::project_ownership::active(state).map_err(anyhow::Error::msg)?;
    let project_root = ownership.root().to_path_buf();
    let mut import_state = state.import_state.lock_or_bail("Import state")?;
    if import_state.run_id != run_id || import_state.project_root != project_root {
        bail!("Import run ID is obsolete, unknown, or belongs to another project");
    }
    if reservation_durability_is_uncertain(&import_state) {
        bail!(
            "Import reservation durability uncertain; retained ownership cannot be acknowledged or rewritten"
        );
    }
    if import_state.acknowledged {
        remove_record(&project_root)?;
        return Ok(());
    }
    if !import_state.lifecycle.is_terminal() {
        bail!("Only a terminal import run can be acknowledged");
    }
    if import_state.confirmation_required {
        bail!("Import interruption requires confirmation that external worker stopped");
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

pub(super) fn confirm_import_worker_stopped_for_state(
    state: &AppState,
    run_id: &str,
) -> AnyResult<ImportRunSnapshot> {
    let project_root = active_project_root(state)?;
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.run_id != run_id
        || run.project_root != project_root
        || run.lifecycle != ImportLifecycle::Interrupted
        || !run.confirmation_required
    {
        bail!("Import interruption confirmation is stale or unavailable");
    }
    let updated_at_ms = run.updated_at_ms;
    run.confirmation_required = false;
    run.updated_at_ms = now_ms();
    if let Err(error) = persist(&run) {
        run.confirmation_required = true;
        run.updated_at_ms = updated_at_ms;
        return Err(error);
    }
    Ok(run.snapshot())
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
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if reservation_durability_is_uncertain(&run) {
        bail!(
            "Import reservation durability uncertain; ownership retained; no staging or process launch is allowed"
        );
    }
    if run.run_id != run_id
        || run.lifecycle != ImportLifecycle::Preparing
        // Admission is one-shot.  The reservation marker is private native
        // state, but prevents a second launch from racing the first before it
        // has transitioned to Running.
        || run.launch_in_progress
        || run.project_root != active_root
        || run.subject_list != subjects
        || run.relocation_plan_id.as_deref() != Some(relocation_plan_id)
        || run.profile_id != profile_id
    {
        bail!("Import run is obsolete or is not eligible for launch");
    }
    let plan = run
        .relocation_plan
        .as_ref()
        .context("Reserved import run lacks a relocation plan")?;
    if plan.plan_id != relocation_plan_id {
        bail!("Reserved import relocation plan identity is inconsistent");
    }
    super::relocation::validate_bound_plan(plan, project_root, subjects, run.ownership_generation)?;
    run.launch_in_progress = true;
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
    if reservation_durability_is_uncertain(&run) {
        bail!(
            "Import reservation durability uncertain; retained ownership cannot be failed or rewritten"
        );
    }
    if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Preparing {
        bail!("Import reservation is obsolete");
    }
    let prior = run.snapshot();
    run.transition(ImportLifecycle::Failed)
        .map_err(anyhow::Error::msg)?;
    run.error = Some(ImportStructuredError {
        code: "launch".to_string(),
        message,
        subject: None,
        staging_issues: None,
    });
    run.terminal_result = Some(ImportTerminalResult::Failed);
    if let Err(error) = persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.error = prior.error;
        run.terminal_result = prior.terminal_result;
        return Err(error);
    }
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
            || reservation_durability_is_uncertain(&run)
        {
            return Ok(None);
        }
        run.ownership_generation
    };
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || run.lifecycle != ImportLifecycle::Preparing
        || run.launch_in_progress
        || run.cancellation.is_some()
        || reservation_durability_is_uncertain(&run)
    {
        return Ok(None);
    }
    let prior = run.snapshot();
    run.transition(ImportLifecycle::Failed)
        .map_err(anyhow::Error::msg)?;
    run.error = Some(error);
    run.terminal_result = Some(ImportTerminalResult::Failed);
    if let Err(error) = persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.error = prior.error;
        run.terminal_result = prior.terminal_result;
        return Err(error);
    }
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

pub(super) fn set_reserved_import_running(state: &AppState, generation: u64) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Preparing
        || !import_state.launch_in_progress
        || reservation_durability_is_uncertain(&import_state)
    {
        return Err(
            "Import state changed before process tracking could be established".to_string(),
        );
    }

    let prior_lifecycle = import_state.lifecycle;
    let prior_updated_at = import_state.updated_at_ms;
    import_state
        .transition(ImportLifecycle::Running)
        .map_err(|error| format!("Failed to transition import run: {error}"))?;
    if let Err(error) = persist(&import_state) {
        import_state.lifecycle = prior_lifecycle;
        import_state.updated_at_ms = prior_updated_at;
        return Err(format!("Failed to persist running import run: {error:#}"));
    }
    Ok(())
}

pub(super) fn emit_running_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    generation: u64,
) -> Result<bool, String> {
    let import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Running
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
        || !matches!(
            import_state.lifecycle,
            ImportLifecycle::Running | ImportLifecycle::Cancelling
        )
    {
        return Err((
            format!(
                "Import state changed before supervisor tracking could be established for generation {generation}"
            ),
            supervisor_handle,
        ));
    }

    import_state.supervisor_handle = Some(supervisor_handle);
    Ok(())
}

/// Processing recovery runs before any BIDS/import recovery mutation.
pub(crate) fn recover_processing_before_import(root: &Path) -> AnyResult<()> {
    crate::processing::recovery::validate(root)?;
    crate::processing::recovery::settle(root, true)?;
    Ok(())
}
