use crate::app_state::AppState;
use crate::import::ImportLifecycle;
use crate::process_control::{
    force_kill_process, process_exists, send_termination_signal, validate_process_ids,
};
use serde::Serialize;
use std::thread;
use std::time::{Duration, Instant};
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

fn shutdown_import(state: &AppState) -> ResourceShutdown {
    let (lifecycle, run_id, handle) = match state.import_state.lock() {
        Ok(mut run) => {
            let handle = if matches!(
                run.lifecycle,
                ImportLifecycle::Finalizing | ImportLifecycle::Cancelling
            ) {
                run.supervisor_handle.take()
            } else {
                None
            };
            (run.lifecycle, run.run_id.clone(), handle)
        }
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };
    if let Some(handle) = handle
        && handle.join().is_err()
    {
        return ResourceShutdown::failure("Import supervisor failed during shutdown");
    }
    if matches!(
        lifecycle,
        ImportLifecycle::Preparing | ImportLifecycle::Running
    ) && let Err(error) = crate::import::stop_import_run_for_state(state, &run_id)
    {
        return ResourceShutdown::failure(error);
    }
    let settled = match state.import_state.lock() {
        Ok(run) => {
            (run.lifecycle.is_terminal() || run.lifecycle == ImportLifecycle::Idle)
                && run.child_pid.is_none()
                && run.supervisor_handle.is_none()
        }
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };
    if settled {
        ResourceShutdown::success()
    } else {
        ResourceShutdown::failure("Import finalization or cancellation did not settle")
    }
}

fn shutdown_workers(state: &AppState) -> ResourceShutdown {
    shutdown_workers_with(
        state,
        process_exists,
        send_termination_signal,
        force_kill_process,
    )
}

fn shutdown_workers_with<Exists, Signal, Force>(
    state: &AppState,
    mut process_exists: Exists,
    mut send_termination_signal: Signal,
    mut force_kill_process: Force,
) -> ResourceShutdown
where
    Exists: FnMut(u32) -> Result<bool, String>,
    Signal: FnMut(u32) -> Result<(), String>,
    Force: FnMut(u32) -> Result<(), String>,
{
    let pids: Vec<u32> = match state.processing_state.lock() {
        Ok(processing_state) => processing_state
            .current_run
            .as_ref()
            .map(|run| run.workers.iter().copied().collect())
            .unwrap_or_default(),
        Err(_) => return ResourceShutdown::failure("Processing state lock was poisoned"),
    };
    if let Err(error) = validate_process_ids(&pids) {
        return ResourceShutdown::failure(format!("Invalid processing worker state: {error}"));
    }

    for &pid in &pids {
        match process_exists(pid) {
            Ok(false) => {}
            Ok(true) => {
                if let Err(error) = send_termination_signal(pid) {
                    match process_exists(pid) {
                        Ok(false) => continue,
                        Ok(true) => {
                            return ResourceShutdown::failure(format!(
                                "Failed to request processing worker {pid} termination: {error}"
                            ));
                        }
                        Err(check_error) => {
                            return ResourceShutdown::failure(format!(
                                "Failed to request processing worker {pid} termination: {error}; \
                                 subsequent existence check failed: {check_error}"
                            ));
                        }
                    }
                }
            }
            Err(error) => return ResourceShutdown::failure(error),
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let mut any_running = false;
        for &pid in &pids {
            match process_exists(pid) {
                Ok(exists) => any_running |= exists,
                Err(error) => return ResourceShutdown::failure(error),
            }
        }
        if !any_running || Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    for &pid in &pids {
        match process_exists(pid) {
            Ok(false) => {}
            Ok(true) => {
                if let Err(error) = force_kill_process(pid) {
                    return ResourceShutdown::failure(format!(
                        "Failed to force-stop processing worker {pid}: {error}"
                    ));
                }
            }
            Err(error) => return ResourceShutdown::failure(error),
        }
    }

    let force_deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let mut any_running = false;
        for &pid in &pids {
            match process_exists(pid) {
                Ok(exists) => any_running |= exists,
                Err(error) => return ResourceShutdown::failure(error),
            }
        }
        if !any_running || Instant::now() >= force_deadline {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    let mut remaining = Vec::new();
    for &pid in &pids {
        match process_exists(pid) {
            Ok(true) => remaining.push(pid),
            Ok(false) => {}
            Err(error) => return ResourceShutdown::failure(error),
        }
    }
    if !remaining.is_empty() {
        return ResourceShutdown::failure(format!(
            "Processing workers could not be confirmed stopped: {remaining:?}"
        ));
    }

    let supervisors = match state.processing_state.lock() {
        Ok(mut processing_state) => {
            if let Some(run) = processing_state.current_run.as_mut() {
                run.workers.clear();
            }
            std::mem::take(&mut processing_state.worker_supervisors)
        }
        Err(_) => return ResourceShutdown::failure("Processing state lock was poisoned"),
    };
    if supervisors
        .into_iter()
        .any(|supervisor| supervisor.handle.join().is_err())
    {
        return ResourceShutdown::failure("Processing worker supervisor failed during shutdown");
    }
    ResourceShutdown::success()
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
    {
        processing_state.current_run = None;
        processing_state.watcher_run_id = None;
    }
}

pub fn shutdown_project_runtime_impl(state: &AppState) -> ProjectRuntimeShutdown {
    // Keep the active native root stable until every matching worker/watcher is
    // confirmed stopped. set/clear_active_project take the same gate.
    let _transition = match state.project_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return ProjectRuntimeShutdown {
                success: false,
                import_process: ResourceShutdown::failure("Project transition lock was poisoned"),
                processing_workers: ResourceShutdown::failure(
                    "Project transition lock was poisoned",
                ),
                lock_watcher: ResourceShutdown::failure("Project transition lock was poisoned"),
            };
        }
    };
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
