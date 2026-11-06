use super::types::{
    ProcessState, ProcessingLifecycle, ProcessingRun, ProcessingRunSnapshot,
    ProcessingTerminalResult,
};
use crate::app::state::AppState;
use crate::error::{CommandError, IntoCommandResult};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

fn active_project_root(state: &AppState) -> Result<PathBuf, String> {
    Ok(crate::project::ownership::active(state)?
        .root()
        .to_path_buf())
}

fn lock_state<'a, T>(mutex: &'a Mutex<T>, state_name: &str) -> Result<MutexGuard<'a, T>, String> {
    mutex
        .lock()
        .map_err(|_| format!("{state_name} lock was poisoned"))
}

pub(crate) fn lock_processing_state(
    state: &AppState,
) -> Result<MutexGuard<'_, ProcessState>, String> {
    lock_state(&state.processing_state, "Processing state")
}

pub(crate) fn lock_project_transition(state: &AppState) -> Result<MutexGuard<'_, ()>, String> {
    lock_state(&state.project_transition, "Project transition")
}

#[cfg(test)]
fn next_run_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn matching_run<'a>(
    processing_state: &'a mut ProcessState,
    project_root: &std::path::Path,
    run_id: &str,
) -> Result<&'a mut ProcessingRun, String> {
    let run = processing_state
        .current_run
        .as_mut()
        .ok_or_else(|| "No processing run is active".to_string())?;
    if !run.belongs_to(project_root) {
        return Err("Processing run belongs to a different project".to_string());
    }
    if run.run_id != run_id {
        return Err("Processing run ID is obsolete or unknown".to_string());
    }
    Ok(run)
}

#[cfg(test)]
pub(crate) fn reserve_processing_run_impl(
    state: &AppState,
    selected_modules: Vec<String>,
    selected_subject_sessions: Vec<String>,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(state)?;
    crate::project::ownership::ensure_import_released(state)?;
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;

    if processing_state.watcher_run_id.is_some()
        || processing_state.watcher_stop.is_some()
        || processing_state.watcher_handle.is_some()
    {
        return Err("A lock watcher already owns processing state".to_string());
    }
    if let Some(run) = &processing_state.current_run
        && (!run.lifecycle.is_terminal() || run.unacknowledged())
    {
        return Err(format!(
            "Processing run {} is still {:?}",
            run.run_id, run.lifecycle
        ));
    }

    let run = ProcessingRun::new(
        next_run_id(),
        project_root,
        selected_modules,
        selected_subject_sessions,
    );
    let snapshot = run.snapshot();
    processing_state.current_run = Some(run);
    Ok(snapshot)
}

pub(crate) fn reserve_request_impl(
    state: &AppState,
    mut request: super::record::ProcessingRequest,
    admission: super::record::ProcessingAdmission,
) -> Result<super::record::ProcessingReservation, String> {
    let _transition = lock_project_transition(state)?;
    crate::project::ownership::ensure_import_released(state)?;
    let project_root = active_project_root(state)?;
    let mut processing = lock_processing_state(state)?;
    let admitted_root = admission
        .project_root
        .canonicalize()
        .map_err(|error| format!("Invalid processing admission root: {error}"))?;
    if admitted_root != project_root {
        return Err("Processing admission root differs from active native project".into());
    }
    request.canonicalize().map_err(|e| e.to_string())?;
    if request.project_id
        != super::record::current_project_id(&project_root).map_err(|e| e.to_string())?
    {
        return Err("Processing request identifies a different project".into());
    }
    if let Some(replay) = super::record::lookup_request(&project_root, request.request_id)
        .map_err(|e| e.to_string())?
    {
        if replay.request_digest
            != super::record::request_digest(&request).map_err(|e| e.to_string())?
        {
            return Err("Processing request identity reused with different content".into());
        }
        let replay = acknowledge_locked(
            &project_root,
            &mut processing,
            replay.run_id,
            replay.terminal_revision,
        )?;
        return Ok(super::record::ProcessingReservation::Historical { replay });
    }
    request.project_root = project_root.clone();
    // Duplicate replies never replace a newer in-memory execution.
    if let Some(existing) =
        super::record::read(&project_root, request.request_id).map_err(|e| e.to_string())?
    {
        if !existing
            .request
            .same_content(&request)
            .map_err(|e| e.to_string())?
        {
            return Err("Processing request identity reused with different content".into());
        }
        if existing.acknowledged {
            let replay = acknowledge_locked(
                &project_root,
                &mut processing,
                existing.run_id,
                existing
                    .terminal_revision
                    .ok_or("Missing terminal revision")?,
            )?;
            return Ok(super::record::ProcessingReservation::Historical { replay });
        }
        return Ok(super::record::ProcessingReservation::Current {
            snapshot: existing.snapshot(),
        });
    }
    // Only fresh admission needs complete accepted choices. Exact retries and
    // historical sparse records above retain their original request contract.
    {
        let config = state
            .project_config
            .lock()
            .map_err(|_| "Project configuration lock was poisoned")?;
        let active = config
            .active
            .as_ref()
            .filter(|active| active.ownership.root() == project_root)
            .ok_or("No accepted configuration for processing")?;
        request
            .validate_switch_choices(&active.document.data_par)
            .map_err(|error| error.to_string())?;
    }
    // Resume durable acknowledgement before replacement, including unlink
    // uncertainty that left only the in-memory terminal pin.
    if let Some(current) = super::record::records(&project_root)
        .map_err(|e| e.to_string())?
        .pop()
    {
        if current.acknowledged {
            acknowledge_locked(
                &project_root,
                &mut processing,
                current.run_id,
                current
                    .terminal_revision
                    .ok_or("Missing terminal revision")?,
            )?;
        }
    } else if let Some(record) = processing
        .current_run
        .as_ref()
        .and_then(|run| run.durable.as_ref())
        && let Some(replay) =
            super::record::lookup_run(&project_root, record.run_id).map_err(|e| e.to_string())?
    {
        acknowledge_locked(
            &project_root,
            &mut processing,
            replay.run_id,
            replay.terminal_revision,
        )?;
    }
    if processing.cancellation.is_some()
        || processing.launch_in_progress
        || processing
            .supervisor_handle
            .as_ref()
            .is_some_and(|h| !h.is_finished())
        || processing
            .current_run
            .as_ref()
            .is_some_and(|r| !r.lifecycle.is_terminal() || r.unacknowledged())
        || processing.watcher_run_id.is_some()
        || processing.watcher_stop.is_some()
        || processing.watcher_handle.is_some()
    {
        return Err("Processing runtime still owns execution artifacts".into());
    }
    let record = super::record::admit(&project_root, request).map_err(|e| e.to_string())?;
    let snapshot = record.snapshot();
    log::info!(
        "[PROCESSING] run={} reserved workers={} targets={}",
        record.run_id,
        record.request.workers,
        record.expected_targets.len()
    );
    processing.current_run = Some(ProcessingRun::from_record(record));
    Ok(super::record::ProcessingReservation::Current { snapshot })
}
#[tauri::command]
#[specta::specta]
pub fn reserve_processing_run(
    state: State<'_, AppState>,
    request: super::record::ProcessingRequest,
    admission: super::record::ProcessingAdmission,
) -> Result<super::record::ProcessingReservation, CommandError> {
    reserve_request_impl(&state, request, admission).into_command_result()
}
#[tauri::command]
#[specta::specta]
pub fn acknowledge_processing_run(
    state: State<'_, AppState>,
    run_id: uuid::Uuid,
    terminal_revision: u64,
) -> Result<super::record::HistoricalReplayEnvelope, CommandError> {
    super::pipeline::reap_finished_supervisor(&state)?;
    let _transition = lock_project_transition(&state)?;
    let root = active_project_root(&state)?;
    let mut processing = lock_processing_state(&state)?;
    let replay = acknowledge_locked(&root, &mut processing, run_id, terminal_revision)?;
    let live_owner = processing.cancellation.is_some() || processing.launch_in_progress;
    drop(processing);
    // Exact historical acknowledgement is read-only while another run owns
    // execution. Its retirement already happened; next admission retries limits.
    if live_owner {
        return Ok(replay);
    }
    Ok(replay)
}

/// Accepts only the currently interrupted durable record. No persisted process
/// identity is consulted or signalled; confirmation authorizes journal policy.
pub(crate) fn confirm_processing_workers_stopped_impl(
    state: &AppState,
    run_id: uuid::Uuid,
    revision: u64,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(state)?;
    let root = active_project_root(state)?;
    let previous = super::record::records(&root)
        .map_err(|e| e.to_string())?
        .pop()
        .ok_or("No current processing run")?;
    if previous.run_id != run_id
        || previous.revision != revision
        || previous.available_action != super::record::AvailableAction::ConfirmStopped
    {
        return Err("Stale or foreign processing confirmation".into());
    }
    // A missing journal is already-cleaned authority, not a reason to strand an
    // exact Interrupted record. Existing journals select the only allowed
    // mutation: rollback before commit, cleanup after commit.
    if super::recovery::journal_exists(&previous).map_err(|e| e.to_string())? {
        let mut transaction =
            super::transaction::LaunchTransaction::reopen_confirmed(&root, &run_id.to_string())
                .map_err(|e| e.to_string())?;
        if previous.execution_committed {
            if transaction.cleanup_pending() {
                transaction.cleanup().map_err(|e| e.to_string())?;
            }
        } else if transaction.rollback_pending() {
            transaction.rollback().map_err(|e| e.to_string())?;
        }
    }
    let mut next = previous.clone();
    next.revision += 1;
    next.lifecycle = ProcessingLifecycle::Interrupted;
    next.available_action = super::record::AvailableAction::Acknowledge;
    next.terminal_revision = Some(next.revision);
    next.terminal_summary = Some(super::record::ProcessingTerminalSummary {
        result: ProcessingTerminalResult::Interrupted,
        execution_committed: next.execution_committed,
        population_completed: false,
        profile_id: next.request.execution_profile.id().into(),
        explore_asl_version: next.versions.as_ref().map(|v| v.explore_asl.clone()),
    });
    super::record::persist(&next, Some(&previous)).map_err(|e| e.to_string())?;
    let mut processing = lock_processing_state(state)?;
    processing.current_run = Some(ProcessingRun::from_record(next));
    Ok(processing.current_run.as_ref().unwrap().snapshot())
}
#[tauri::command]
#[specta::specta]
pub fn confirm_processing_workers_stopped(
    state: State<'_, AppState>,
    run_id: uuid::Uuid,
    revision: u64,
) -> Result<ProcessingRunSnapshot, CommandError> {
    confirm_processing_workers_stopped_impl(&state, run_id, revision).into_command_result()
}

pub(crate) fn acknowledge_locked(
    root: &std::path::Path,
    processing: &mut ProcessState,
    run_id: uuid::Uuid,
    terminal_revision: u64,
) -> Result<super::record::HistoricalReplayEnvelope, String> {
    if processing.current_run.as_ref().is_some_and(|r| {
        r.run_id == run_id.to_string()
            && (processing.cancellation.is_some()
                || processing.launch_in_progress
                || r.watcher_owned)
    }) || processing.watcher_run_id.as_deref() == Some(&run_id.to_string())
    {
        return Err("Processing resources remain unsettled".into());
    }
    if let Some(record) = super::record::records(root)
        .map_err(|e| e.to_string())?
        .pop()
        .filter(|r| r.run_id == run_id)
    {
        if !record.lifecycle.is_terminal() || record.terminal_revision != Some(terminal_revision) {
            return Err("Stale processing terminal revision".into());
        }
        super::recovery::cleanup_archive(&record)
            .map_err(|e| format!("Processing archive cleanup requires retry: {e:#}"))?;
    }
    let replay =
        super::record::acknowledge(root, run_id, terminal_revision).map_err(|e| e.to_string())?;
    if processing
        .current_run
        .as_ref()
        .is_some_and(|run| run.run_id == run_id.to_string())
    {
        processing.current_run = None;
    }
    Ok(replay)
}

pub(crate) fn get_active_run_impl(
    state: &AppState,
) -> Result<Option<ProcessingRunSnapshot>, String> {
    let project_root = active_project_root(state)?;
    let processing_state = lock_processing_state(state)?;
    if let Some(run) = processing_state.current_run.as_ref().filter(|r| {
        (!r.lifecycle.is_terminal() || r.unacknowledged()) && r.belongs_to(&project_root)
    }) {
        return Ok(Some(run.snapshot()));
    }
    Ok(super::record::records(&project_root)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|r| !r.acknowledged)
        .map(|r| r.snapshot()))
}

#[tauri::command]
#[specta::specta]
pub fn get_active_run(
    state: State<'_, AppState>,
) -> Result<Option<ProcessingRunSnapshot>, CommandError> {
    get_active_run_impl(&state).into_command_result()
}

pub(crate) fn attach_run_impl(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    super::pipeline::reconcile_idle(state, run_id).map_err(|e| e.to_string())?;
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;
    Ok(matching_run(&mut processing_state, &project_root, run_id)?.snapshot())
}

#[tauri::command]
#[specta::specta]
pub fn attach_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, CommandError> {
    attach_run_impl(&state, &run_id).into_command_result()
}

pub(crate) fn selected_modules_to_b_process(
    selected_modules: &[String],
) -> Result<Vec<bool>, String> {
    let mut b_process = vec![false; 3];
    for module in selected_modules {
        match module.as_str() {
            "structural" => b_process[0] = true,
            "asl" => b_process[1] = true,
            "population" => b_process[2] = true,
            _ => return Err(format!("Unknown selected processing module: {module}")),
        }
    }
    if b_process.iter().any(|selected| *selected) {
        Ok(b_process)
    } else {
        Err("At least one processing module must be selected".to_string())
    }
}

pub(crate) fn selected_subject_sessions_regexp(selected_subject_sessions: &[String]) -> String {
    if selected_subject_sessions.is_empty() {
        return "^sub-.*$".to_string();
    }
    let values = selected_subject_sessions
        .iter()
        .map(|subject_session| regex::escape(subject_session))
        .collect::<Vec<_>>()
        .join("|");
    format!("^(?:{values})$")
}

#[derive(Debug)]
pub(crate) struct WatcherAdmission {
    pub lock_root: PathBuf,
    pub snapshot: ProcessingRunSnapshot,
    pub already_owned: bool,
}

/// Resource admission caller holds project_transition through watcher installation.
pub(crate) fn validate_watcher_request(
    state: &AppState,
    run_id: &str,
) -> Result<WatcherAdmission, String> {
    crate::project::ownership::ensure_not_shutting_down(state)?;
    let (processing_state, project_root) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_ref()
        .expect("matching run exists");
    if run.lifecycle.is_terminal() {
        return Err(format!("Processing run {run_id} is terminal"));
    }
    if let Some(owner) = processing_state.watcher_run_id.as_deref()
        && owner != run_id
    {
        return Err("Lock watcher belongs to another processing run".to_string());
    }
    if processing_state.watcher_run_id.is_none()
        && (processing_state.watcher_stop.is_some() || processing_state.watcher_handle.is_some())
    {
        return Err("A lock watcher has inconsistent ownership state".to_string());
    }
    Ok(WatcherAdmission {
        lock_root: project_root
            .join("derivatives")
            .join("ExploreASL")
            .join("lock"),
        snapshot: run.snapshot(),
        already_owned: processing_state.watcher_run_id.is_some(),
    })
}

pub(crate) fn matching_run_for_active_project<'a>(
    state: &'a AppState,
    run_id: &str,
) -> Result<(std::sync::MutexGuard<'a, ProcessState>, PathBuf), String> {
    let project_root = active_project_root(state)?;
    let processing_state = lock_processing_state(state)?;
    let current = processing_state
        .current_run
        .as_ref()
        .ok_or_else(|| "No processing run is active".to_string())?;
    if !current.belongs_to(&project_root) || current.run_id != run_id {
        return Err(
            "Processing run ID is obsolete, unknown, or belongs to another project".to_string(),
        );
    }
    Ok((processing_state, project_root))
}
