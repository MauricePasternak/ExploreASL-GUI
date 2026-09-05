use super::types::{
    ProcessState, ProcessingLifecycle, ProcessingRun, ProcessingRunSnapshot,
    ProcessingTerminalResult,
};
use crate::app_state::AppState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::State;

static NEXT_PROCESSING_RUN_ID: AtomicU64 = AtomicU64::new(1);

fn active_project_root(state: &AppState) -> Result<PathBuf, String> {
    let root = lock_state(&state.active_project_root, "Active project state")?
        .clone()
        .ok_or_else(|| "No active project".to_string())?;
    root.canonicalize().map_err(|error| {
        format!(
            "Failed to canonicalize active project root {}: {error}",
            root.display()
        )
    })
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

fn next_run_id() -> String {
    format!(
        "processing-run-{}",
        NEXT_PROCESSING_RUN_ID.fetch_add(1, Ordering::Relaxed)
    )
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

pub(crate) fn reserve_processing_run_impl(
    state: &AppState,
    selected_modules: Vec<String>,
    selected_subject_sessions: Vec<String>,
) -> Result<ProcessingRunSnapshot, String> {
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;

    if processing_state.watcher_run_id.is_some()
        || processing_state.watcher_stop.is_some()
        || processing_state.watcher_handle.is_some()
    {
        return Err("A lock watcher already owns processing state".to_string());
    }
    if let Some(run) = &processing_state.current_run
        && !run.lifecycle.is_terminal()
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

#[tauri::command]
pub fn reserve_processing_run(
    state: State<'_, AppState>,
    selected_modules: Vec<String>,
    selected_subject_sessions: Vec<String>,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    reserve_processing_run_impl(&state, selected_modules, selected_subject_sessions)
}

pub(crate) fn fail_processing_run_impl(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    {
        let project_root = active_project_root(state)?;
        let mut processing_state = lock_processing_state(state)?;
        let run = matching_run(&mut processing_state, &project_root, run_id)?;
        if run.lifecycle != ProcessingLifecycle::Preparing {
            return Err(format!(
                "Processing run {run_id} cannot fail preparation from {:?}",
                run.lifecycle
            ));
        }
    }

    // Preparation failure is a public renderer operation, separate from
    // post-spawn launch failure recording. Release exact-run watcher ownership
    // before making the record terminal and replaceable.
    super::watcher::stop_watch_lock_dir_impl(state, run_id)?;
    super::pipeline::reap_completed_worker_supervisors(state, run_id)?;

    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;
    let run = matching_run(&mut processing_state, &project_root, run_id)?;
    if run.lifecycle != ProcessingLifecycle::Preparing {
        return Err(format!(
            "Processing run {run_id} cannot fail preparation from {:?}",
            run.lifecycle
        ));
    }
    run.transition(ProcessingLifecycle::Failed)?;
    Ok(run.snapshot())
}

/// Record a launch failure without abandoning workers already registered for
/// this run. This function deliberately never waits on worker supervisors:
/// `run_pipeline` holds the project transition gate, while a supervisor needs
/// only the processing-state lock to reap and mutate worker membership.
pub(crate) fn record_launch_failure_impl(
    state: &AppState,
    run_id: &str,
    error: String,
) -> Result<ProcessingRunSnapshot, String> {
    let should_stop_watcher = {
        let project_root = active_project_root(state)?;
        let mut processing_state = lock_processing_state(state)?;
        let run = matching_run(&mut processing_state, &project_root, run_id)?;
        match run.lifecycle {
            ProcessingLifecycle::Preparing => {
                run.transition(ProcessingLifecycle::Failed)?;
                true
            }
            ProcessingLifecycle::Running if run.workers.is_empty() => {
                // The first native spawn error identifies the failed launch.
                // A renderer catch can race this path; retain that evidence
                // rather than replacing it with a less-specific second report.
                run.pending_launch_failure.get_or_insert(error);
                run.transition(ProcessingLifecycle::Failed)?;
                true
            }
            ProcessingLifecycle::Running => {
                run.pending_launch_failure.get_or_insert(error);
                return Ok(run.snapshot());
            }
            ProcessingLifecycle::Finalizing if run.workers.is_empty() => {
                // Final worker exit can win the state lock after a later spawn
                // already failed. Launch failure remains authoritative: this
                // run never reached its requested worker set.
                run.pending_launch_failure.get_or_insert(error);
                run.transition(ProcessingLifecycle::Failed)?;
                true
            }
            _ => {
                return Err(format!(
                    "Processing run {run_id} cannot fail from {:?}",
                    run.lifecycle
                ));
            }
        }
    };

    if should_stop_watcher {
        // No worker remains. Watcher stop releases its lock before a terminal
        // record can be replaced; supervisor handles are reaped nonblocking.
        super::watcher::stop_watch_lock_dir_impl(state, run_id)?;
        super::pipeline::reap_completed_worker_supervisors(state, run_id)?;
    }
    attach_run_impl(state, run_id)
}

#[tauri::command]
pub fn fail_processing_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    fail_processing_run_impl(&state, &run_id)
}

pub(crate) fn finalize_processing_run_impl(
    state: &AppState,
    run_id: &str,
    outcome: ProcessingTerminalResult,
) -> Result<ProcessingRunSnapshot, String> {
    {
        let project_root = active_project_root(state)?;
        let mut processing_state = lock_processing_state(state)?;
        let run = matching_run(&mut processing_state, &project_root, run_id)?;
        if run.lifecycle != ProcessingLifecycle::Finalizing {
            return Err(format!(
                "Processing run {run_id} cannot finalize from {:?}",
                run.lifecycle
            ));
        }
    }
    // A terminal record may be replaced only after its watcher has stopped.
    // Keep Finalizing ownership actionable if stop/join fails.
    super::watcher::stop_watch_lock_dir_impl(state, run_id)?;
    // A Finalizing run has no owned workers. Reap only handles already proven
    // complete; never wait under a project-transition command.
    super::pipeline::reap_completed_worker_supervisors(state, run_id)?;
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;
    let run = matching_run(&mut processing_state, &project_root, run_id)?;
    let lifecycle = if run.pending_launch_failure.is_some() {
        ProcessingLifecycle::Failed
    } else {
        match outcome {
            ProcessingTerminalResult::Completed => ProcessingLifecycle::Completed,
            ProcessingTerminalResult::Failed => ProcessingLifecycle::Failed,
            ProcessingTerminalResult::Cancelled | ProcessingTerminalResult::Interrupted => {
                return Err("Finalization outcome must be Completed or Failed".to_string());
            }
        }
    };
    run.transition(lifecycle)?;
    Ok(run.snapshot())
}

#[tauri::command]
pub fn finalize_processing_run(
    state: State<'_, AppState>,
    run_id: String,
    outcome: ProcessingTerminalResult,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    finalize_processing_run_impl(&state, &run_id, outcome)
}

pub(crate) fn get_active_run_impl(
    state: &AppState,
) -> Result<Option<ProcessingRunSnapshot>, String> {
    let project_root = active_project_root(state)?;
    let processing_state = lock_processing_state(state)?;
    Ok(processing_state.current_run.as_ref().and_then(|run| {
        (!run.lifecycle.is_terminal() && run.belongs_to(&project_root)).then(|| run.snapshot())
    }))
}

#[tauri::command]
pub fn get_active_run(state: State<'_, AppState>) -> Result<Option<ProcessingRunSnapshot>, String> {
    get_active_run_impl(&state)
}

pub(crate) fn attach_run_impl(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;
    Ok(matching_run(&mut processing_state, &project_root, run_id)?.snapshot())
}

#[tauri::command]
pub fn attach_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    attach_run_impl(&state, &run_id)
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

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct LaunchAuthority {
    pub project_root: PathBuf,
    pub b_process: Vec<bool>,
    pub subject_regexp: String,
}

pub(crate) fn validate_launch_request(
    state: &AppState,
    run_id: &str,
    requested_b_process: &[bool],
    workers: u32,
) -> Result<LaunchAuthority, String> {
    let project_root = active_project_root(state)?;
    let processing_state = lock_processing_state(state)?;
    let run = processing_state
        .current_run
        .as_ref()
        .ok_or_else(|| "No processing run is active".to_string())?;
    if !run.belongs_to(&project_root) || run.run_id != run_id {
        return Err(
            "Processing run ID is obsolete, unknown, or belongs to another project".to_string(),
        );
    }
    if run.lifecycle != ProcessingLifecycle::Preparing {
        return Err(format!(
            "Processing run {run_id} must be Preparing, found {:?}",
            run.lifecycle
        ));
    }
    let b_process = selected_modules_to_b_process(&run.selected_modules)?;
    if requested_b_process != b_process {
        return Err("Selected modules do not match the processing reservation".to_string());
    }
    if workers == 0 {
        return Err("workers must be at least 1".to_string());
    }
    if processing_state
        .watcher_run_id
        .as_deref()
        .is_some_and(|owner| owner != run_id)
    {
        return Err("Lock watcher belongs to another processing run".to_string());
    }
    Ok(LaunchAuthority {
        project_root,
        b_process,
        subject_regexp: selected_subject_sessions_regexp(&run.selected_subject_sessions),
    })
}

/// Read-only command admission. Call before routing any later validation or
/// launch error into run-owned failure recording. Stale and wrong-state IPC
/// must not alter healthy run evidence.
pub(crate) fn validate_launch_admission(state: &AppState, run_id: &str) -> Result<(), String> {
    let project_root = active_project_root(state)?;
    let mut processing_state = lock_processing_state(state)?;
    let run = matching_run(&mut processing_state, &project_root, run_id)?;
    if run.lifecycle != ProcessingLifecycle::Preparing {
        return Err(format!(
            "Processing run {run_id} must be Preparing, found {:?}",
            run.lifecycle
        ));
    }
    Ok(())
}

pub(crate) fn record_worker_exit(
    processing_state: &mut ProcessState,
    run_id: &str,
    pid: u32,
    exit_code: i32,
) -> bool {
    let Some(run) = processing_state.current_run.as_mut() else {
        return false;
    };
    if run.run_id != run_id || !run.workers.remove(&pid) {
        return false;
    }
    run.exit_evidence
        .push(super::types::WorkerExitEvidence { pid, exit_code });
    if run.lifecycle == ProcessingLifecycle::Running && run.workers.is_empty() {
        let terminal = if run.pending_launch_failure.is_some() {
            ProcessingLifecycle::Failed
        } else {
            ProcessingLifecycle::Finalizing
        };
        let _ = run.transition(terminal);
    }
    true
}

#[derive(Debug)]
pub(crate) struct WatcherAdmission {
    pub lock_root: PathBuf,
    pub snapshot: ProcessingRunSnapshot,
    pub already_owned: bool,
}

pub(crate) fn validate_watcher_request(
    state: &AppState,
    run_id: &str,
) -> Result<WatcherAdmission, String> {
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

/// Return a root only while the exact native reservation remains in Preparing.
/// Callers that mutate project files must take `AppState::project_transition`
/// first, then use this instead of accepting a renderer-supplied root.
pub(crate) fn preparing_run_root(state: &AppState, run_id: &str) -> Result<PathBuf, String> {
    let (processing_state, project_root) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_ref()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Preparing {
        return Err(format!(
            "Processing run {run_id} must be Preparing, found {:?}",
            run.lifecycle
        ));
    }
    Ok(project_root)
}

pub(crate) fn finalizing_run_root(state: &AppState, run_id: &str) -> Result<PathBuf, String> {
    let (processing_state, project_root) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_ref()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Finalizing {
        return Err(format!(
            "Processing run {run_id} must be Finalizing, found {:?}",
            run.lifecycle
        ));
    }
    Ok(project_root)
}

pub(crate) fn completed_population_run_root(
    state: &AppState,
    run_id: &str,
) -> Result<PathBuf, String> {
    let (processing_state, project_root) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_ref()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Completed
        || !run
            .selected_modules
            .iter()
            .any(|module| module == "population")
    {
        return Err(format!(
            "Processing run {run_id} is not a completed Population run"
        ));
    }
    Ok(project_root)
}
