use super::*;
use crate::import::ImportLifecycle;
use crate::processing::{ProcessState, ProcessingLifecycle, ProcessingRun};
use std::path::PathBuf;
use std::sync::mpsc;
use std::{thread, time::Duration};

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
fn shutdown_releases_settled_unpinned_terminal_run_records() {
    for lifecycle in [ProcessingLifecycle::Completed, ProcessingLifecycle::Failed] {
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
    let mut processing_run = run("/project-a", ProcessingLifecycle::Completed);
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
fn shutdown_without_owned_resources_succeeds() {
    let state = AppState::default();
    assert!(shutdown_project_runtime_impl(&state).success);
    assert!(state.processing_state.lock().unwrap().current_run.is_none());
}

#[cfg(unix)]
#[test]
fn unmanaged_import_fails_shutdown_and_retains_ownership() {
    let state = AppState::default();
    let workspace = tempfile::tempdir().unwrap();
    crate::project_ownership_tests::own_project(&state, workspace.path());
    {
        let mut import_state = state.import_state.lock().unwrap();
        import_state.run_id = "import-run-1".to_string();
        import_state.profile_id = "profile-1".to_string();
        import_state.staging_generation = "staging-gen-1".to_string();
        import_state.subject_list = vec!["sub-01".to_string()];
        import_state.lifecycle = ImportLifecycle::Running;

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
            .contains("external-stop confirmation")
    );
    let import_state = state.import_state.lock().unwrap();
    assert!(import_state.cancellation.is_none());
    assert_eq!(import_state.project_root, workspace.path().to_path_buf());
    assert_eq!(import_state.lifecycle, ImportLifecycle::Cancelling);
}

#[cfg(unix)]
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
fn native_exit_decision_covers_idle_success_intercepted_success_and_failure() {
    for (import, processing, expected) in [
        (Ok(false), Ok(false), NativeExitDecision::Allow),
        (Ok(true), Ok(false), NativeExitDecision::PreventThenExit),
        (
            Err("cannot stop import".to_string()),
            Ok(false),
            NativeExitDecision::Prevent,
        ),
    ] {
        assert_eq!(native_exit_decision(&import, &processing), expected);
    }
}

#[test]
fn preparing_import_failure_retains_import_ownership_for_retry() {
    let state = AppState::default();
    let mut import_state = state.import_state.lock().unwrap();
    import_state.launch_in_progress = true;
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

#[test]
fn shutdown_reservation_blocks_idle_project_replacement_without_holding_transition_lock() {
    let state = std::sync::Arc::new(AppState::default());
    let root = tempfile::tempdir().unwrap();
    let replacement = tempfile::tempdir().unwrap();
    crate::project_ownership_tests::own_project(&state, root.path());
    let (stop, stopped) = mpsc::channel();
    let (entered, observed) = mpsc::channel();
    let (release, wait_release) = mpsc::channel();
    {
        let mut processing = state.processing_state.lock().unwrap();
        processing.watcher_stop = Some(stop);
        processing.watcher_handle = Some(thread::spawn(move || {
            stopped.recv().unwrap();
            entered.send(()).unwrap();
            wait_release.recv().unwrap();
        }));
    }
    let stopping = state.clone();
    let shutdown = thread::spawn(move || shutdown_project_runtime_impl(&stopping));
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(state.project_transition.try_lock().is_ok());
    let error = crate::visualization::set_active_project_impl(
        replacement.path().display().to_string(),
        &state,
    )
    .unwrap_err();
    assert!(error.contains("shutdown"));
    assert!(
        crate::visualization::clear_active_project_impl(&state)
            .unwrap_err()
            .contains("shutdown")
    );
    assert!(
        crate::project_ownership::for_setup(&state, replacement.path())
            .unwrap_err()
            .contains("shutdown")
    );
    assert_eq!(
        crate::project_ownership::active(&state).unwrap().root(),
        root.path()
    );
    release.send(()).unwrap();
    assert!(shutdown.join().unwrap().success);
    assert!(
        !state
            .runtime_shutdown_in_progress
            .load(std::sync::atomic::Ordering::Acquire)
    );
    crate::visualization::set_active_project_impl(replacement.path().display().to_string(), &state)
        .unwrap();
}
