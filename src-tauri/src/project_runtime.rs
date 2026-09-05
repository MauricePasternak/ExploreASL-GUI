use crate::app_state::AppState;
use crate::import::{ImportLifecycle, RESERVED_IMPORT_PID, stop_import_pid_for_exit};
use crate::process_control::{
    force_kill_process, process_exists, send_termination_signal, validate_process_id,
    validate_process_ids,
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
    shutdown_import_with(state, stop_import_pid_for_exit)
}

fn shutdown_import_with<Stop>(state: &AppState, mut stop_import: Stop) -> ResourceShutdown
where
    Stop: FnMut(&AppState, u32) -> Result<(), String>,
{
    let (lifecycle, pid) = match state.import_state.lock() {
        Ok(import_state) => (import_state.lifecycle, import_state.child_pid),
        Err(_) => return ResourceShutdown::failure("Import state lock was poisoned"),
    };

    match (lifecycle, pid) {
        (_, None) => ResourceShutdown::success(),
        (ImportLifecycle::Preparing, Some(RESERVED_IMPORT_PID)) => {
            ResourceShutdown::failure("Import is still preparing and could not be stopped")
        }
        (_, Some(pid)) => match validate_process_id(pid).and_then(|()| stop_import(state, pid)) {
            Ok(()) => ResourceShutdown::success(),
            Err(error) => ResourceShutdown::failure(error),
        },
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
        && !matches!(
            import_state.lifecycle,
            ImportLifecycle::Preparing | ImportLifecycle::Running
        )
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
mod tests {
    use super::*;
    use crate::import::ImportLifecycle;
    use crate::processing::{ProcessState, ProcessingLifecycle, ProcessingRun};
    use std::cell::Cell;
    use std::path::PathBuf;
    use std::sync::mpsc;

    fn run(root: &str, lifecycle: ProcessingLifecycle) -> ProcessingRun {
        let mut run = ProcessingRun::new(
            "run-1".to_string(),
            PathBuf::from(root),
            vec!["structural".to_string()],
            vec!["sub-001_01".to_string()],
        );
        run.lifecycle = lifecycle;
        run
    }

    #[test]
    fn shutdown_releases_preparing_and_terminal_run_records() {
        for lifecycle in [
            ProcessingLifecycle::Preparing,
            ProcessingLifecycle::Completed,
            ProcessingLifecycle::Failed,
        ] {
            let state = AppState::default();
            state.processing_state.lock().unwrap().current_run = Some(run("/project", lifecycle));
            let result = shutdown_project_runtime_impl(&state);
            assert!(result.success);
            assert!(state.processing_state.lock().unwrap().current_run.is_none());
        }
    }

    #[test]
    fn watcher_shutdown_joins_thread_and_releases_watcher_owned_run() {
        let state = AppState::default();
        let (stop_tx, stop_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let _ = stop_rx.recv();
        });
        let mut processing_run = run("/project-a", ProcessingLifecycle::Running);
        processing_run.watcher_owned = true;
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state.current_run = Some(processing_run);
        processing_state.watcher_run_id = Some("run-1".to_string());
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(handle);
        drop(processing_state);

        let result = shutdown_project_runtime_impl(&state);
        assert!(result.success);
        let processing_state = state.processing_state.lock().unwrap();
        assert!(processing_state.watcher_stop.is_none());
        assert!(processing_state.watcher_handle.is_none());
        assert!(processing_state.current_run.is_none());
    }

    #[test]
    fn worker_failure_retains_run_ownership_for_retry() {
        let state = AppState::default();
        state.processing_state.lock().unwrap().current_run =
            Some(run("/project-a", ProcessingLifecycle::Running));
        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::failure("worker termination failed"),
            |_| ResourceShutdown::success(),
        );
        assert!(!result.success);
        assert_eq!(
            state
                .processing_state
                .lock()
                .unwrap()
                .current_run
                .as_ref()
                .unwrap()
                .project_root,
            PathBuf::from("/project-a")
        );
    }

    #[test]
    fn watcher_failure_retains_run_ownership_for_retry() {
        let state = AppState::default();
        state.processing_state.lock().unwrap().current_run =
            Some(run("/project-a", ProcessingLifecycle::Running));
        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::failure("watcher join failed"),
        );
        assert!(!result.success);
        assert!(state.processing_state.lock().unwrap().current_run.is_some());
    }

    #[test]
    fn pending_launch_failure_shutdown_releases_processing_ownership() {
        let state = AppState::default();
        let mut pending = run("/project-a", ProcessingLifecycle::Running);
        pending.pending_launch_failure = Some("worker 2 spawn failed".to_string());
        state.processing_state.lock().unwrap().current_run = Some(pending);

        let result = shutdown_project_runtime_impl(&state);
        assert!(result.success);
        assert!(state.processing_state.lock().unwrap().current_run.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn invalid_worker_pid_fails_without_process_operations_and_retains_ownership() {
        let state = AppState::default();
        let mut processing_run = run("/project-a", ProcessingLifecycle::Running);
        processing_run.workers.insert(u32::MAX);
        state.processing_state.lock().unwrap().current_run = Some(processing_run);
        let existence_called = Cell::new(false);
        let signal_called = Cell::new(false);
        let force_called = Cell::new(false);

        let result = shutdown_project_runtime_with(
            &state,
            |_| ResourceShutdown::success(),
            |state| {
                shutdown_workers_with(
                    state,
                    |_| {
                        existence_called.set(true);
                        Ok(true)
                    },
                    |_| {
                        signal_called.set(true);
                        Ok(())
                    },
                    |_| {
                        force_called.set(true);
                        Ok(())
                    },
                )
            },
            |_| ResourceShutdown::success(),
        );

        assert!(!result.success);
        assert!(!result.processing_workers.success);
        assert!(
            result
                .processing_workers
                .error
                .unwrap()
                .contains("exceeds the Unix positive PID range")
        );
        assert!(!existence_called.get());
        assert!(!signal_called.get());
        assert!(!force_called.get());
        let processing_state = state.processing_state.lock().unwrap();
        assert_eq!(
            processing_state
                .current_run
                .as_ref()
                .unwrap()
                .workers
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            vec![u32::MAX]
        );
    }

    #[cfg(unix)]
    #[test]
    fn invalid_import_pid_fails_without_stop_call_and_retains_ownership() {
        let state = AppState::default();
        {
            let mut import_state = state.import_state.lock().unwrap();
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(u32::MAX);
            import_state.project_root = PathBuf::from("/project-a");
        }
        let stop_called = Cell::new(false);

        let result = shutdown_project_runtime_with(
            &state,
            |state| {
                shutdown_import_with(state, |_, _| {
                    stop_called.set(true);
                    Ok(())
                })
            },
            |_| ResourceShutdown::success(),
            |_| ResourceShutdown::success(),
        );

        assert!(!result.success);
        assert!(!result.import_process.success);
        assert!(
            result
                .import_process
                .error
                .unwrap()
                .contains("exceeds the Unix positive PID range")
        );
        assert!(!stop_called.get());
        let import_state = state.import_state.lock().unwrap();
        assert_eq!(import_state.child_pid, Some(u32::MAX));
        assert_eq!(import_state.project_root, PathBuf::from("/project-a"));
        assert_eq!(import_state.lifecycle, ImportLifecycle::Running);
    }

    #[cfg(unix)]
    #[test]
    fn pending_launch_failure_shutdown_reaps_live_worker_and_supervisor() {
        let state = AppState::default();
        let mut child = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .expect("sleep worker should spawn");
        let pid = child.id();
        let supervisor = thread::spawn(move || {
            let _ = child.wait();
        });
        let mut pending = run("/project-a", ProcessingLifecycle::Running);
        pending.workers.insert(pid);
        pending.pending_launch_failure = Some("worker 2 spawn failed".to_string());
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state.current_run = Some(pending);
        processing_state
            .worker_supervisors
            .push(crate::processing::WorkerSupervisor {
                run_id: "run-1".to_string(),
                handle: supervisor,
            });
        drop(processing_state);

        let result = shutdown_project_runtime_impl(&state);
        assert!(result.success, "{result:?}");
        let processing_state = state.processing_state.lock().unwrap();
        assert!(processing_state.current_run.is_none());
        assert!(processing_state.worker_supervisors.is_empty());
        assert!(!process_exists(pid).expect("owned child existence check should succeed"));
    }

    #[test]
    fn process_state_retains_run_not_pid_or_project_fields() {
        let state = ProcessState::default();
        assert!(state.current_run.is_none());
        assert!(state.watcher_run_id.is_none());
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
        assert_eq!(json["importProcess"]["error"], "cannot stop import");
        assert_eq!(json["processingWorkers"]["success"], true);
        assert_eq!(json["lockWatcher"]["success"], true);
    }

    #[test]
    fn preparing_import_failure_retains_import_ownership_for_retry() {
        let state = AppState::default();
        let mut import_state = state.import_state.lock().unwrap();
        import_state.child_pid = Some(RESERVED_IMPORT_PID);
        import_state.project_root = PathBuf::from("/project-a");
        drop(import_state);
        let result = shutdown_project_runtime_impl(&state);
        assert!(!result.success);
        assert_eq!(
            state.import_state.lock().unwrap().project_root,
            PathBuf::from("/project-a")
        );
    }

    #[test]
    fn terminal_import_shutdown_releases_retained_ownership() {
        let state = AppState::default();
        let mut import_state = state.import_state.lock().unwrap();
        import_state.lifecycle = ImportLifecycle::Terminal;
        import_state.project_root = PathBuf::from("/project-a");
        drop(import_state);
        assert!(shutdown_project_runtime_impl(&state).success);
        assert_eq!(
            state.import_state.lock().unwrap().lifecycle,
            ImportLifecycle::Idle
        );
    }
}
