use crate::import::{AppState, RESERVED_IMPORT_PID, stop_import_pid_for_exit};
use crate::processing::{force_kill_process, process_exists, send_termination_signal};
use serde::Serialize;
use std::path::PathBuf;
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
    let pid = match state.import_state.lock() {
        Ok(import_state) => import_state.child_pid,
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };

    match pid {
        None => ResourceShutdown::success(),
        Some(RESERVED_IMPORT_PID) => {
            ResourceShutdown::failure("Import is still preparing and could not be stopped")
        }
        Some(pid) => match stop_import_pid_for_exit(state, pid) {
            Ok(()) => ResourceShutdown::success(),
            Err(error) => ResourceShutdown::failure(error),
        },
    }
}

fn shutdown_workers(state: &AppState) -> ResourceShutdown {
    let pids = match state.processing_state.lock() {
        Ok(processing_state) => processing_state.worker_pids.clone(),
        Err(_) => return ResourceShutdown::failure("Processing state lock was poisoned"),
    };
    if pids.is_empty() {
        return ResourceShutdown::success();
    }

    for &pid in &pids {
        if process_exists(pid)
            && let Err(error) = send_termination_signal(pid)
        {
            if !process_exists(pid) {
                continue;
            }
            return ResourceShutdown::failure(format!(
                "Failed to request processing worker {pid} termination: {error}"
            ));
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while pids.iter().any(|&pid| process_exists(pid)) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }

    for &pid in &pids {
        if process_exists(pid)
            && let Err(error) = force_kill_process(pid)
        {
            return ResourceShutdown::failure(format!(
                "Failed to force-stop processing worker {pid}: {error}"
            ));
        }
    }

    let force_deadline = Instant::now() + Duration::from_secs(1);
    while pids.iter().any(|&pid| process_exists(pid)) && Instant::now() < force_deadline {
        thread::sleep(Duration::from_millis(100));
    }

    let remaining = pids
        .iter()
        .copied()
        .filter(|&pid| process_exists(pid))
        .collect::<Vec<_>>();
    if let Ok(mut processing_state) = state.processing_state.lock() {
        processing_state
            .worker_pids
            .retain(|pid| remaining.contains(pid));
    }
    if remaining.is_empty() {
        ResourceShutdown::success()
    } else {
        ResourceShutdown::failure(format!(
            "Processing workers could not be confirmed stopped: {remaining:?}"
        ))
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
        && import_state.child_pid.is_none()
    {
        import_state.project_root = PathBuf::new();
        import_state.staging_root = PathBuf::new();
    }
    if result.processing_workers.success
        && result.lock_watcher.success
        && let Ok(mut processing_state) = state.processing_state.lock()
    {
        processing_state.project_root = PathBuf::new();
    }
}

pub fn shutdown_project_runtime_impl(state: &AppState) -> ProjectRuntimeShutdown {
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
mod tests {
    use super::*;
    use crate::processing::ProcessState;
    use std::sync::mpsc;

    #[test]
    fn absent_resources_succeed_and_release_ownership() {
        let state = AppState::default();
        state.import_state.lock().unwrap().project_root = PathBuf::from("/project");
        state.processing_state.lock().unwrap().project_root = PathBuf::from("/project");

        let result = shutdown_project_runtime_impl(&state);

        assert!(result.success);
        assert!(result.import_process.success);
        assert!(result.processing_workers.success);
        assert!(result.lock_watcher.success);
        assert!(
            state
                .import_state
                .lock()
                .unwrap()
                .project_root
                .as_os_str()
                .is_empty()
        );
        assert!(
            state
                .processing_state
                .lock()
                .unwrap()
                .project_root
                .as_os_str()
                .is_empty()
        );
    }

    #[test]
    fn preparing_import_failure_retains_project_ownership_for_retry() {
        let state = AppState::default();
        {
            let mut import_state = state.import_state.lock().unwrap();
            import_state.child_pid = Some(RESERVED_IMPORT_PID);
            import_state.project_root = PathBuf::from("/project-a");
        }

        let result = shutdown_project_runtime_impl(&state);

        assert!(!result.success);
        assert!(!result.import_process.success);
        assert_eq!(
            state.import_state.lock().unwrap().project_root,
            PathBuf::from("/project-a")
        );
        assert_eq!(
            state.import_state.lock().unwrap().child_pid,
            Some(RESERVED_IMPORT_PID)
        );
    }

    #[test]
    fn watcher_shutdown_joins_thread_and_releases_processing_ownership() {
        let state = AppState::default();
        let (stop_tx, stop_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let _ = stop_rx.recv();
        });
        {
            let mut processing_state = state.processing_state.lock().unwrap();
            processing_state.project_root = PathBuf::from("/project-a");
            processing_state.watcher_stop = Some(stop_tx);
            processing_state.watcher_handle = Some(handle);
        }

        let result = shutdown_project_runtime_impl(&state);

        assert!(result.success);
        let processing_state = state.processing_state.lock().unwrap();
        assert!(processing_state.watcher_stop.is_none());
        assert!(processing_state.watcher_handle.is_none());
        assert!(processing_state.project_root.as_os_str().is_empty());
    }

    #[test]
    fn ownership_type_records_worker_and_watcher_project() {
        let state = ProcessState {
            project_root: PathBuf::from("/project-a"),
            ..ProcessState::default()
        };
        assert_eq!(state.project_root, PathBuf::from("/project-a"));
    }

    #[test]
    fn import_failure_retains_import_ownership_while_partial_success_releases_processing() {
        let state = AppState::default();
        state.import_state.lock().unwrap().project_root = PathBuf::from("/project-a");
        state.processing_state.lock().unwrap().project_root = PathBuf::from("/project-a");

        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::failure("import termination failed"),
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::success(),
        );

        assert!(!result.success);
        assert_eq!(
            state.import_state.lock().unwrap().project_root,
            PathBuf::from("/project-a")
        );
        assert!(
            state
                .processing_state
                .lock()
                .unwrap()
                .project_root
                .as_os_str()
                .is_empty()
        );
    }

    #[test]
    fn worker_failure_retains_processing_ownership_for_retry() {
        let state = AppState::default();
        state.processing_state.lock().unwrap().project_root = PathBuf::from("/project-a");

        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::failure("worker termination failed"),
            |_| ResourceShutdown::success(),
        );

        assert!(!result.success);
        assert_eq!(
            state.processing_state.lock().unwrap().project_root,
            PathBuf::from("/project-a")
        );
    }

    #[test]
    fn watcher_failure_retains_processing_ownership_for_retry() {
        let state = AppState::default();
        state.processing_state.lock().unwrap().project_root = PathBuf::from("/project-a");

        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::failure("watcher join failed"),
        );

        assert!(!result.success);
        assert_eq!(
            state.processing_state.lock().unwrap().project_root,
            PathBuf::from("/project-a")
        );
    }

    #[test]
    fn shutdown_result_serializes_command_contract_in_camel_case() {
        let result = ProjectRuntimeShutdown {
            success: false,
            import_process: ResourceShutdown::failure("cannot stop import"),
            processing_workers: ResourceShutdown::success(),
            lock_watcher: ResourceShutdown::success(),
        };

        let json = serde_json::to_value(result).expect("shutdown result should serialize");
        assert_eq!(json["success"], false);
        assert_eq!(json["importProcess"]["success"], false);
        assert_eq!(json["importProcess"]["error"], "cannot stop import");
        assert_eq!(json["processingWorkers"]["success"], true);
        assert!(json["processingWorkers"].get("error").is_none());
        assert_eq!(json["lockWatcher"]["success"], true);
    }
}
