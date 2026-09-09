use super::*;
use crate::import::{ImportLifecycle, RESERVED_IMPORT_PID};
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
    let workspace = tempfile::tempdir().unwrap();
    {
        let mut import_state = state.import_state.lock().unwrap();
        import_state.run_id = "import-run-1".to_string();
        import_state.profile_id = "profile-1".to_string();
        import_state.staging_generation = "staging-gen-1".to_string();
        import_state.subject_list = vec!["sub-01".to_string()];
        import_state.lifecycle = ImportLifecycle::Running;
        import_state.child_pid = Some(u32::MAX);
        import_state.project_root = workspace.path().to_path_buf();
    }

    let result = shutdown_project_runtime_with(
        &state,
        shutdown_import,
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
    let import_state = state.import_state.lock().unwrap();
    assert_eq!(import_state.child_pid, Some(u32::MAX));
    assert_eq!(import_state.project_root, workspace.path().to_path_buf());
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
fn terminal_import_shutdown_retains_unacknowledged_replay() {
    let state = AppState::default();
    let mut import_state = state.import_state.lock().unwrap();
    import_state.lifecycle = ImportLifecycle::Completed;
    import_state.project_root = PathBuf::from("/project-a");
    drop(import_state);
    assert!(shutdown_project_runtime_impl(&state).success);
    assert_eq!(
        state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Completed
    );
}

#[test]
fn shutdown_waits_for_native_finalization_before_succeeding() {
    let state = std::sync::Arc::new(AppState::default());
    let worker_state = state.clone();
    let handle = thread::spawn(move || {
        thread::sleep(Duration::from_millis(20));
        worker_state.import_state.lock().unwrap().lifecycle = ImportLifecycle::Completed;
    });
    {
        let mut run = state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Finalizing;
        run.run_id = "import-run-1".to_string();
        run.supervisor_handle = Some(handle);
    }

    let result = shutdown_project_runtime_impl(&state);

    assert!(result.success, "{result:?}");
    assert_eq!(
        state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Completed
    );
}
