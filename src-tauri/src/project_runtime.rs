use crate::app_state::AppState;
use crate::import::ImportLifecycle;
use serde::Serialize;
use tauri::State;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceShutdown {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ResourceShutdown {
    fn success() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

fn shutdown_import(state: &AppState) -> ResourceShutdown {
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
    shutdown_project_runtime_with(state, shutdown_import, shutdown_workers, shutdown_watcher)
}

fn shutdown_project_runtime_with<Import, Workers, Watcher>(
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
pub fn shutdown_project_runtime(state: State<'_, AppState>) -> ProjectRuntimeShutdown {
    shutdown_project_runtime_impl(&state)
}

#[cfg(test)]
#[path = "project_runtime_tests.rs"]
mod tests;
