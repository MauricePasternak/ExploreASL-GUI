//! Activate/close projects and coordinate shutdown and ordered feature recovery.
use crate::app::state::AppState;
use crate::error::CommandError;
use crate::import::ImportLifecycle;
use anyhow::{Context, Result as AnyResult};
use serde::Serialize;
use tauri::State;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResourceShutdown {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ResourceShutdown {
    pub(crate) fn success() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    pub(crate) fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeShutdown {
    pub success: bool,
    pub import_process: ResourceShutdown,
    pub processing_workers: ResourceShutdown,
    pub lock_watcher: ResourceShutdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeExitDecision {
    Allow,
    Prevent,
    PreventThenExit,
}

pub(crate) fn native_exit_decision(
    import: &Result<bool, String>,
    processing: &Result<bool, String>,
) -> NativeExitDecision {
    if import.is_err() || processing.is_err() {
        NativeExitDecision::Prevent
    } else if import.as_ref().is_ok_and(|active| *active)
        || processing.as_ref().is_ok_and(|active| *active)
    {
        NativeExitDecision::PreventThenExit
    } else {
        NativeExitDecision::Allow
    }
}

#[cfg(test)]
pub fn set_active_project_impl(
    root_path: String,
    state: &crate::app::state::AppState,
) -> Result<crate::import::relocation::RelocationRecoverySummary, String> {
    set_active_project_inner(root_path, state).map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
fn set_active_project_inner(
    root_path: String,
    state: &crate::app::state::AppState,
) -> AnyResult<crate::import::relocation::RelocationRecoverySummary> {
    let _transition = lock_state(
        &state.project_transition,
        Some("Project transition lock was poisoned"),
    )?;
    set_active_project_locked(root_path, state)
}

/// Root-capability regression fixtures exercise recovery without configuration.
#[cfg(test)]
pub(crate) fn set_active_project_locked(
    root_path: String,
    state: &crate::app::state::AppState,
) -> AnyResult<crate::import::relocation::RelocationRecoverySummary> {
    set_active_project_with_config_locked(root_path, state, None)
}

pub(crate) fn set_active_project_with_config_locked(
    root_path: String,
    state: &crate::app::state::AppState,
    mut configuration: Option<crate::project::config::ActiveProjectConfig>,
) -> AnyResult<crate::import::relocation::RelocationRecoverySummary> {
    ensure_processing_runtime_released(state)?;
    let path = std::fs::canonicalize(&root_path)
        .inspect_err(|error| log::error!("set_active_project failed canonicalizing: {error}"))
        .context("Invalid project path")?;
    let ownership =
        crate::project::ownership::for_root(state, &path).map_err(anyhow::Error::msg)?;
    crate::import::recover_processing_before_import(&path)?;
    // BIDS setup recovery is separate from import relocation. A pending setup
    // transaction must settle before this root is made observable as active.
    crate::project::setup::recover_root_after_processing_recovery(&ownership)?;
    // Recovery must finish before this candidate can become observable through
    // active-root IPC or frontend hydration.
    let recovery = crate::import::relocation::recover(&path)?;
    // Recovery temporarily installs candidate import state for native
    // finalization. Retain the previous state until every admission gate and
    // root publication succeeds; a rejected candidate must remain retryable.
    let (previous_import, previous_processing) = {
        let mut import = lock_state(&state.import_state, None)?;
        let mut processing = lock_state(&state.processing_state, None)?;
        (
            std::mem::take(&mut *import),
            std::mem::take(&mut *processing),
        )
    };
    let activation = (|| -> AnyResult<()> {
        crate::import::recover_import_run_after_processing_recovery(state, &path)?;
        let record = crate::processing::record::records(&path)?.pop();
        lock_state(&state.processing_state, None)?.current_run = record
            .filter(|r| !r.acknowledged)
            .map(crate::processing::ProcessingRun::from_record);
        if let Some(configuration) = &mut configuration {
            configuration.ownership = ownership.clone();
            crate::project::config::reconcile_candidate_locked(state, configuration)?;
        }
        replace_active_project_state(state, Some(ownership.clone()), configuration)
    })();
    if let Err(error) = activation {
        let mut import = lock_state(&state.import_state, None)?;
        let mut processing = lock_state(&state.processing_state, None)?;
        *import = previous_import;
        *processing = previous_processing;
        return Err(error);
    }
    Ok(recovery)
}

pub fn clear_active_project_impl(state: &crate::app::state::AppState) -> Result<(), String> {
    clear_active_project_inner(state).map_err(|error| format!("{error:#}"))
}

fn clear_active_project_inner(state: &crate::app::state::AppState) -> AnyResult<()> {
    let _transition = lock_state(
        &state.project_transition,
        Some("Project transition lock was poisoned"),
    )?;
    ensure_processing_runtime_released(state)?;
    replace_active_project_state(state, None, None)
}

/// Direct active-root IPC must not bypass project-runtime shutdown. Frontend
/// transitions drain/stop first; callers that skip that contract fail closed.
pub(crate) fn ensure_processing_runtime_released(
    state: &crate::app::state::AppState,
) -> AnyResult<()> {
    if lock_state(&state.project_config, None)?
        .active
        .as_ref()
        .is_some_and(|active| {
            active.accepted_revision != active.persisted_revision || active.recovered_from_backup
        })
    {
        anyhow::bail!("Accepted project configuration must be saved before replacement or clear");
    }
    crate::project::ownership::ensure_import_released(state).map_err(anyhow::Error::msg)?;
    crate::project::ownership::ensure_processing_released(state).map_err(anyhow::Error::msg)
}

fn replace_active_project_state(
    state: &crate::app::state::AppState,
    ownership: Option<std::sync::Arc<crate::project::ownership::ActiveProject>>,
    configuration: Option<crate::project::config::ActiveProjectConfig>,
) -> AnyResult<()> {
    // Obtain every fallible state guard before publishing any replacement.
    let mut config = lock_state(&state.project_config, None)?;
    let mut root = lock_state(&state.active_project_root, None)?;
    let mut active = lock_state(&state.active_project, None)?;
    let mut data = lock_state(&state.active_data, None)?;
    *root = ownership.as_ref().map(|lease| lease.root().to_path_buf());
    *active = ownership;
    *data = None;
    config.generation = configuration
        .as_ref()
        .map_or(config.generation + 1, |accepted| accepted.generation);
    config.active = configuration;
    Ok(())
}

fn lock_state<'a, T>(
    mutex: &'a std::sync::Mutex<T>,
    poison_message: Option<&str>,
) -> AnyResult<std::sync::MutexGuard<'a, T>> {
    mutex.lock().map_err(|error| {
        anyhow::anyhow!(
            poison_message
                .map(str::to_owned)
                .unwrap_or_else(|| error.to_string())
        )
    })
}

#[tauri::command]
#[specta::specta]
pub fn clear_active_project(
    state: State<'_, crate::app::state::AppState>,
) -> Result<(), CommandError> {
    let _trace = crate::tracing::CommandTrace::new("clear_active_project");
    log::info!("clear_active_project");
    clear_active_project_impl(&state)?;
    log::info!("clear_active_project success");
    Ok(())
}

pub(crate) fn shutdown_import(state: &AppState) -> ResourceShutdown {
    let (lifecycle, run_id) = match state.import_state.lock() {
        Ok(run) => (run.lifecycle, run.run_id.clone()),
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };
    if matches!(
        lifecycle,
        ImportLifecycle::Preparing | ImportLifecycle::Running | ImportLifecycle::Cancelling
    ) && let Err(error) = crate::import::stop_import_run_for_state(state, &run_id)
    {
        return ResourceShutdown::failure(error);
    }
    let handle = match state.import_state.lock() {
        Ok(mut run) => run.supervisor_handle.take(),
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };
    if let Some(handle) = handle
        && handle.join().is_err()
    {
        return ResourceShutdown::failure("Import supervisor failed during shutdown");
    }
    match state.import_state.lock() {
        Ok(run)
            if (run.lifecycle.is_terminal() || run.lifecycle == ImportLifecycle::Idle)
                && run.cancellation.is_none()
                && !run.launch_in_progress
                && run.supervisor_handle.is_none() =>
        {
            ResourceShutdown::success()
        }
        _ => ResourceShutdown::failure("Import finalization or cancellation did not settle"),
    }
}

fn shutdown_workers(state: &AppState) -> ResourceShutdown {
    let run_id = match state.processing_state.lock() {
        Ok(processing) => processing
            .current_run
            .as_ref()
            .filter(|r| !r.lifecycle.is_terminal())
            .map(|r| r.run_id.clone()),
        Err(_) => return ResourceShutdown::failure("Processing state lock was poisoned"),
    };
    if let Some(run_id) = run_id {
        match crate::processing::pipeline::stop_for_state(state, &run_id) {
            Ok(snapshot) if snapshot.lifecycle.is_terminal() => {}
            Ok(_) => return ResourceShutdown::failure("Processing cleanup remains unresolved"),
            Err(error) => return ResourceShutdown::failure(error),
        }
    }
    match crate::processing::pipeline::reap_supervisor(state) {
        Ok(()) => ResourceShutdown::success(),
        Err(error) => ResourceShutdown::failure(error),
    }
}

fn shutdown_watcher(state: &AppState) -> ResourceShutdown {
    let (stop, handle) = match state.processing_state.lock() {
        Ok(mut processing_state) => (
            processing_state.watcher_stop.take(),
            processing_state.watcher_handle.take(),
        ),
        Err(_) => return ResourceShutdown::failure("Processing state lock was poisoned"),
    };

    if let Some(sender) = stop
        && sender.send(()).is_err()
        && handle.as_ref().is_some_and(|thread| !thread.is_finished())
    {
        if let Ok(mut processing_state) = state.processing_state.lock() {
            processing_state.watcher_handle = handle;
        }
        return ResourceShutdown::failure("Lock watcher stop request failed");
    }

    if let Some(handle) = handle
        && handle.join().is_err()
    {
        return ResourceShutdown::failure("Lock watcher thread failed during shutdown");
    }
    ResourceShutdown::success()
}

fn finalize_ownership(state: &AppState, result: &ProjectRuntimeShutdown) {
    if result.import_process.success
        && let Ok(mut import_state) = state.import_state.lock()
        && import_state.lifecycle == ImportLifecycle::Idle
    {
        *import_state = crate::import::ImportState::default();
    }
    if result.processing_workers.success
        && result.lock_watcher.success
        && let Ok(mut processing_state) = state.processing_state.lock()
        && processing_state
            .current_run
            .as_ref()
            .is_none_or(|run| !run.unacknowledged())
    {
        processing_state.current_run = None;
        processing_state.watcher_run_id = None;
    }
}

pub fn shutdown_project_runtime_impl(state: &AppState) -> ProjectRuntimeShutdown {
    struct ShutdownReservation<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for ShutdownReservation<'_> {
        fn drop(&mut self) {
            self.0.store(false, std::sync::atomic::Ordering::Release);
        }
    }
    let admission = (|| -> Result<ShutdownReservation<'_>, String> {
        let _transition = state
            .project_transition
            .lock()
            .map_err(|_| "Project transition lock was poisoned")?;
        if state
            .runtime_shutdown_in_progress
            .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            return Err("Project runtime shutdown is already in progress".into());
        }
        Ok(ShutdownReservation(&state.runtime_shutdown_in_progress))
    })();
    let _reservation = match admission {
        Ok(reservation) => reservation,
        Err(error) => {
            return ProjectRuntimeShutdown {
                success: false,
                import_process: ResourceShutdown::failure(&error),
                processing_workers: ResourceShutdown::failure(&error),
                lock_watcher: ResourceShutdown::failure(error),
            };
        }
    };
    // Domain reservations retain in-process ownership while stop waits. Never
    // hold transition mutex across process or supervisor completion.
    let mut result =
        shutdown_project_runtime_with(state, shutdown_import, shutdown_workers, shutdown_watcher);
    if result.success
        && let Err(error) = crate::project::config::reconcile_settled_for_state(state)
    {
        result.success = false;
        result.import_process =
            ResourceShutdown::failure(format!("Native result reconciliation failed: {error:#}"));
    }
    result
}

pub(crate) fn shutdown_project_runtime_with<Import, Workers, Watcher>(
    state: &AppState,
    import: Import,
    workers: Workers,
    watcher: Watcher,
) -> ProjectRuntimeShutdown
where
    Import: FnOnce(&AppState) -> ResourceShutdown,
    Workers: FnOnce(&AppState) -> ResourceShutdown,
    Watcher: FnOnce(&AppState) -> ResourceShutdown,
{
    let import_process = import(state);
    let processing_workers = workers(state);
    let lock_watcher = watcher(state);
    let success = import_process.success && processing_workers.success && lock_watcher.success;
    let result = ProjectRuntimeShutdown {
        success,
        import_process,
        processing_workers,
        lock_watcher,
    };
    finalize_ownership(state, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn shutdown_project_runtime(state: State<'_, AppState>) -> ProjectRuntimeShutdown {
    shutdown_project_runtime_impl(&state)
}
