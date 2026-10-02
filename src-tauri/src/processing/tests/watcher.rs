use super::common::*;
use crate::processing::runs::{reserve_processing_run_impl, validate_watcher_request};
use crate::processing::types::*;
use crate::processing::utils::{parse_lock_dir_path, parse_lock_path};
use crate::processing::watcher::stop_watch_lock_dir_impl;
use std::fs;
use std::sync::mpsc;

#[test]
fn processing_events_require_and_serialize_immutable_run_ids() {
    let status = StatusFileCreated {
        run_id: "run-1".to_string(),
        module: "structural".to_string(),
        subject_session: Some("sub-001_01".to_string()),
        step_code: "060_Segment_T1w".to_string(),
        run: None,
    };
    let lock_created = LockCreated {
        run_id: "run-1".to_string(),
        module: "asl".to_string(),
        subject_session: Some("sub-001_01".to_string()),
        run: Some("1".to_string()),
    };
    let lock_removed = LockRemoved {
        run_id: "run-1".to_string(),
        module: "population".to_string(),
        subject_session: None,
        run: None,
    };
    for event in [
        serde_json::to_value(status).unwrap(),
        serde_json::to_value(lock_created).unwrap(),
        serde_json::to_value(lock_removed).unwrap(),
    ] {
        assert_eq!(event["runId"], "run-1");
        assert!(event.get("run_id").is_none());
    }
}

#[test]
fn watcher_admission_and_delayed_path_events_keep_bound_run_identity() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let first = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let admission = validate_watcher_request(&state, &first.run_id).unwrap();
    assert_eq!(
        admission.lock_root,
        root.canonicalize()
            .unwrap()
            .join("derivatives/ExploreASL/lock")
    );
    state.processing_state.lock().unwrap().watcher_run_id = Some(first.run_id.clone());
    assert!(
        validate_watcher_request(&state, &first.run_id)
            .unwrap()
            .already_owned
    );
    assert!(validate_watcher_request(&state, "unknown").is_err());
    state.processing_state.lock().unwrap().watcher_run_id = None;
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Completed;
    assert!(validate_watcher_request(&state, &first.run_id).is_err());

    let lock_root = root.join("derivatives/ExploreASL/lock");
    let asl_path =
        lock_root.join("xASL_module_ASL/sub-001_01/xASL_module_ASL_ASL_02/020_RealignASL.status");
    let population_path =
        lock_root.join("xASL_module_Population/xASL_module_Population/999_ready.status");
    let delayed_asl = parse_lock_path(&lock_root, &asl_path, &first.run_id).unwrap();
    let delayed_population = parse_lock_path(&lock_root, &population_path, &first.run_id).unwrap();
    assert_eq!(delayed_asl.run_id, first.run_id);
    assert_eq!(delayed_asl.run, Some("2".to_string()));
    assert_eq!(delayed_population.run_id, first.run_id);
    assert_eq!(delayed_population.subject_session, None);
}

#[test]
fn watcher_control_is_same_run_idempotent_and_run_scoped() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || {
        let _ = stop_rx.recv();
    });
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state.watcher_run_id = Some(reserved.run_id.clone());
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(handle);
        processing_state.current_run.as_mut().unwrap().watcher_owned = true;
    }
    assert!(
        validate_watcher_request(&state, &reserved.run_id)
            .unwrap()
            .already_owned
    );
    assert!(stop_watch_lock_dir_impl(&state, "other-run").is_err());
    assert!(
        state
            .processing_state
            .lock()
            .unwrap()
            .watcher_handle
            .is_some()
    );
    stop_watch_lock_dir_impl(&state, &reserved.run_id).unwrap();
    let processing_state = state.processing_state.lock().unwrap();
    assert!(processing_state.watcher_handle.is_none());
    assert!(processing_state.watcher_stop.is_none());
    assert!(processing_state.watcher_run_id.is_none());
    assert!(!processing_state.current_run.as_ref().unwrap().watcher_owned);
}

#[test]
fn watcher_stop_reaps_an_already_exited_thread_after_stop_channel_disconnects() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    drop(stop_rx);
    let handle = std::thread::spawn(|| {});
    handle.thread().unpark();
    while !handle.is_finished() {
        std::thread::yield_now();
    }
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state.watcher_run_id = Some(reserved.run_id.clone());
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(handle);
        processing_state.current_run.as_mut().unwrap().watcher_owned = true;
    }

    stop_watch_lock_dir_impl(&state, &reserved.run_id).unwrap();
    let processing_state = state.processing_state.lock().unwrap();
    assert!(processing_state.watcher_run_id.is_none());
    assert!(processing_state.watcher_stop.is_none());
    assert!(processing_state.watcher_handle.is_none());
    assert!(!processing_state.current_run.as_ref().unwrap().watcher_owned);
}

// -------------------------------------------------------------------------
// EventKind matching
// -------------------------------------------------------------------------

#[test]
fn parse_lock_paths_work_regardless_of_create_kind() {
    let temp = std::env::temp_dir();
    let lock_root = temp.join("test").join("lock");
    let path = lock_root
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural")
        .join("060_Segment_T1w.status");
    let result = parse_lock_path(&lock_root, &path, "run-1");
    assert!(result.is_some());
    let event = result.unwrap();
    assert_eq!(event.module, "xASL_module_Structural");
    assert_eq!(event.subject_session, Some("sub-001_01".to_string()));
    assert_eq!(event.step_code, "060_Segment_T1w");

    let asl_path = lock_root
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1")
        .join("020_RealignASL.status");
    let asl_result = parse_lock_path(&lock_root, &asl_path, "run-1");
    assert!(asl_result.is_some());
    let asl_event = asl_result.unwrap();
    assert_eq!(asl_event.module, "xASL_module_ASL");
    assert_eq!(asl_event.subject_session, Some("sub-001_01".to_string()));
    assert_eq!(asl_event.step_code, "020_RealignASL");
    assert_eq!(asl_event.run, Some("1".to_string()));

    let lock_event = parse_lock_dir_path(
        &lock_root,
        &asl_path.parent().unwrap().join("locked"),
        "run-1",
    )
    .unwrap();
    assert_eq!(lock_event.module, asl_event.module);
    assert_eq!(lock_event.subject_session, asl_event.subject_session);
    assert_eq!(lock_event.run, asl_event.run);
}

#[test]
fn watcher_admission_rejects_existing_nonterminal_run_during_shutdown() {
    let root = tempfile::tempdir().unwrap();
    let state = state_with_active_project(root.path());
    let reserved = reserve_processing_run_impl(&state, vec!["population".into()], vec![]).unwrap();
    state
        .runtime_shutdown_in_progress
        .store(true, std::sync::atomic::Ordering::Release);
    assert!(
        validate_watcher_request(&state, &reserved.run_id)
            .unwrap_err()
            .contains("shutdown")
    );
    assert!(!root.path().join("derivatives/ExploreASL/lock").exists());
}
