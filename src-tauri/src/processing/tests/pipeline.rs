use super::common::*;
use crate::execution_profile::{ExecutionProfile, InternalValidation, get_exploreasl_version};
use crate::processing::pipeline::*;
use crate::processing::runs::{
    attach_run_impl, record_launch_failure_impl, record_worker_exit, reserve_processing_run_impl,
    validate_launch_request,
};
use crate::processing::types::*;
use crate::processing::watcher::stop_watch_lock_dir_impl;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[test]
fn launch_admission_derives_reserved_work_before_any_pipeline_mutation() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let other_root = workspace.path().join("other-project");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&other_root).unwrap();
    let sentinel = root.join("sentinel");
    fs::write(&sentinel, "unchanged").unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(
        &state,
        vec!["structural".to_string(), "asl".to_string()],
        vec!["sub-001_01".to_string()],
    )
    .unwrap();

    let authority =
        validate_launch_request(&state, &reserved.run_id, &[true, true, false], 2).unwrap();
    assert_eq!(authority.project_root, root.canonicalize().unwrap());
    assert_eq!(authority.subject_regexp, r"^(?:sub\-001_01)$");
    assert!(validate_launch_request(&state, "missing", &[true, true, false], 2).is_err());
    assert!(validate_launch_request(&state, &reserved.run_id, &[true, false, false], 2).is_err());
    assert!(validate_launch_request(&state, &reserved.run_id, &[true, true, false], 0).is_err());
    assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");

    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Running;
    assert!(validate_launch_request(&state, &reserved.run_id, &[true, true, false], 2).is_err());
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Failed;
    let replacement = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    assert!(validate_launch_request(&state, &reserved.run_id, &[true, true, false], 2).is_err());

    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(
        validate_launch_request(&state, &replacement.run_id, &[false, true, false], 1).is_err()
    );
    assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
}

#[test]
fn rejected_launch_admission_never_records_failure_or_mutates_files() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let other_root = workspace.path().join("other-project");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&other_root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let before = attach_run_impl(&state, &reserved.run_id).unwrap();

    assert!(
        invoke_launch_expected_before_profile_validation(
            &state,
            "stale-run",
            &[false, true, false],
            1,
        )
        .is_err()
    );
    assert_eq!(attach_run_impl(&state, &reserved.run_id).unwrap(), before);

    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(
        invoke_launch_expected_before_profile_validation(
            &state,
            &reserved.run_id,
            &[false, true, false],
            1,
        )
        .is_err()
    );
    assert_eq!(
        state
            .processing_state
            .lock()
            .unwrap()
            .current_run
            .as_ref()
            .unwrap()
            .snapshot(),
        before
    );
    assert!(!root.join("derivatives").exists());
    assert!(!other_root.join("derivatives").exists());

    let state_without_run = state_with_active_project(&root);
    assert!(
        invoke_launch_expected_before_profile_validation(
            &state_without_run,
            "missing-run",
            &[false, true, false],
            1,
        )
        .is_err()
    );
    assert!(
        state_without_run
            .processing_state
            .lock()
            .unwrap()
            .current_run
            .is_none()
    );
    assert!(!root.join("derivatives").exists());
}

#[test]
fn matching_preparing_launch_validation_errors_fail_only_that_reservation() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let invalid_workers =
        reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();

    assert!(
        invoke_launch_expected_before_profile_validation(
            &state,
            &invalid_workers.run_id,
            &[false, true, false],
            0,
        )
        .is_err()
    );
    assert_eq!(
        attach_run_impl(&state, &invalid_workers.run_id)
            .unwrap()
            .lifecycle,
        ProcessingLifecycle::Failed
    );

    let mismatched_work =
        reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    assert!(
        invoke_launch_expected_before_profile_validation(
            &state,
            &mismatched_work.run_id,
            &[true, false, false],
            1,
        )
        .is_err()
    );
    assert_eq!(
        attach_run_impl(&state, &mismatched_work.run_id)
            .unwrap()
            .lifecycle,
        ProcessingLifecycle::Failed
    );
    assert!(!root.join("derivatives").exists());
}

#[test]
fn worker_supervision_retains_exit_evidence_and_cannot_mutate_replacement() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.lifecycle = ProcessingLifecycle::Running;
        run.workers.extend([11, 22, 33]);
        assert!(record_worker_exit(
            &mut processing_state,
            &reserved.run_id,
            22,
            1
        ));
        assert_eq!(
            processing_state.current_run.as_ref().unwrap().workers,
            [11, 33].into()
        );
        assert_eq!(
            processing_state.current_run.as_ref().unwrap().lifecycle,
            ProcessingLifecycle::Running
        );
        assert!(record_worker_exit(
            &mut processing_state,
            &reserved.run_id,
            11,
            0
        ));
        assert!(record_worker_exit(
            &mut processing_state,
            &reserved.run_id,
            33,
            0
        ));
        let run = processing_state.current_run.as_ref().unwrap();
        assert!(run.workers.is_empty());
        assert_eq!(run.lifecycle, ProcessingLifecycle::Finalizing);
        assert_eq!(run.exit_evidence.len(), 3);
        run.snapshot()
    };
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .transition(ProcessingLifecycle::Completed)
        .unwrap();
    let replacement =
        reserve_processing_run_impl(&state, vec!["structural".to_string()], vec![]).unwrap();
    let (stop_tx, stop_rx) = mpsc::channel();
    let watcher = std::thread::spawn(move || {
        let _ = stop_rx.recv();
    });
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(999);
        run.transition(ProcessingLifecycle::Running).unwrap();
        run.watcher_owned = true;
        processing_state.watcher_run_id = Some(replacement.run_id.clone());
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(watcher);
    }
    assert!(!complete_supervised_worker(
        &state,
        &reserved.run_id,
        999,
        1
    ));
    assert_eq!(
        state
            .processing_state
            .lock()
            .unwrap()
            .current_run
            .as_ref()
            .unwrap()
            .run_id,
        replacement.run_id
    );
    let replacement_snapshot = attach_run_impl(&state, &replacement.run_id).unwrap();
    assert_eq!(replacement_snapshot.workers, vec![999]);
    assert!(replacement_snapshot.watcher_owned);
    stop_watch_lock_dir_impl(&state, &replacement.run_id).unwrap();
}

#[test]
fn partial_launch_failure_never_waits_on_live_supervisor_and_fails_after_last_exit() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let (watcher_stop_tx, watcher_stop_rx) = mpsc::channel();
    let watcher_handle = std::thread::spawn(move || {
        let _ = watcher_stop_rx.recv();
    });
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state.watcher_run_id = Some(reserved.run_id.clone());
        processing_state.watcher_stop = Some(watcher_stop_tx);
        processing_state.watcher_handle = Some(watcher_handle);
        processing_state.current_run.as_mut().unwrap().watcher_owned = true;
    }

    let (release_tx, release_rx) = mpsc::channel();
    let mut release_rx = Some(release_rx);
    let supervisor_state = Arc::clone(&state);
    let supervisor_run_id = reserved.run_id.clone();
    let started = Instant::now();
    let _transition = state.project_transition.lock().unwrap();
    let launch_error = launch_worker_set(
        &state,
        &reserved.run_id,
        2,
        |worker, _| {
            if worker == 1 {
                Ok((4242, ()))
            } else {
                Err("Failed to spawn MATLAB worker 2".to_string())
            }
        },
        move |run_id, pid, ()| {
            let state = Arc::clone(&supervisor_state);
            let expected_run_id = supervisor_run_id.clone();
            let release_rx = release_rx.take().expect("only worker 1 is supervised");
            WorkerSupervisor {
                run_id,
                handle: std::thread::spawn(move || {
                    let _ = release_rx.recv();
                    complete_supervised_worker(&state, &expected_run_id, pid, 0);
                }),
            }
        },
        || {},
        |()| {},
    )
    .unwrap_err();
    assert!(
        started.elapsed() < Duration::from_millis(250),
        "partial launch failure waited on a live supervisor"
    );
    assert!(launch_error.contains("use Kill to stop it"));
    drop(_transition);

    let retained = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(retained.lifecycle, ProcessingLifecycle::Running);
    assert_eq!(retained.workers, vec![4242]);
    assert_eq!(
        retained.pending_launch_failure.as_deref(),
        Some("Failed to spawn MATLAB worker 2")
    );
    assert!(retained.watcher_owned);
    let duplicate = record_launch_failure_impl(
        &state,
        &reserved.run_id,
        "generic renderer launch failure".to_string(),
    )
    .unwrap();
    assert_eq!(
        duplicate.pending_launch_failure.as_deref(),
        Some("Failed to spawn MATLAB worker 2")
    );

    release_tx.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    let failed = loop {
        let snapshot = attach_run_impl(&state, &reserved.run_id).unwrap();
        if snapshot.lifecycle == ProcessingLifecycle::Failed && !snapshot.watcher_owned {
            break snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "supervisor did not finish launch failure"
        );
        std::thread::yield_now();
    };
    assert_eq!(failed.lifecycle, ProcessingLifecycle::Failed);
    assert_eq!(
        failed.terminal_result,
        Some(ProcessingTerminalResult::Failed)
    );
    assert!(failed.workers.is_empty());
    assert_eq!(
        failed.exit_evidence,
        vec![WorkerExitEvidence {
            pid: 4242,
            exit_code: 0
        }]
    );

    reap_completed_worker_supervisors(&state, &reserved.run_id).unwrap();
    assert!(
        state
            .processing_state
            .lock()
            .unwrap()
            .worker_supervisors
            .is_empty()
    );

    // The surviving worker is gone, so terminal ownership is replaceable even
    // though failure evidence remains inspectable until this reservation wins.
    let replacement = reserve_processing_run_impl(&state, vec!["structural".to_string()], vec![])
        .expect("terminal partial launch failure must not block a later run");
    assert_ne!(replacement.run_id, reserved.run_id);
}

#[test]
fn first_launch_failure_is_terminal_but_staggered_early_exit_stops_next_spawn() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let first = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let failed = record_launch_failure_impl(
        &state,
        &first.run_id,
        "Failed to spawn MATLAB worker 1".to_string(),
    )
    .unwrap();
    assert_eq!(failed.lifecycle, ProcessingLifecycle::Failed);
    assert!(failed.workers.is_empty());

    let second = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let spawn_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count_for_spawn = Arc::clone(&spawn_count);
    let supervisor_state = Arc::clone(&state);
    let supervisor_run_id = second.run_id.clone();
    let stagger_state = Arc::clone(&state);
    let stagger_run_id = second.run_id.clone();
    let terminated = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let terminated_child = Arc::clone(&terminated);
    let _transition = state.project_transition.lock().unwrap();
    let post_stagger = launch_worker_set(
        &state,
        &second.run_id,
        2,
        move |_, _| {
            let spawned = count_for_spawn.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok((1234 + spawned as u32, ()))
        },
        move |run_id, pid, ()| {
            let state = Arc::clone(&supervisor_state);
            let expected_run_id = supervisor_run_id.clone();
            WorkerSupervisor {
                run_id,
                handle: std::thread::spawn(move || {
                    complete_supervised_worker(&state, &expected_run_id, pid, 0);
                }),
            }
        },
        move || {
            let deadline = Instant::now() + Duration::from_secs(1);
            while attach_run_impl(&stagger_state, &stagger_run_id)
                .unwrap()
                .lifecycle
                != ProcessingLifecycle::Finalizing
            {
                assert!(
                    Instant::now() < deadline,
                    "first worker did not exit during stagger"
                );
                std::thread::yield_now();
            }
        },
        move |()| {
            terminated_child.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .unwrap();
    drop(_transition);
    assert_eq!(post_stagger.lifecycle, ProcessingLifecycle::Finalizing);
    assert!(post_stagger.workers.is_empty());
    assert_eq!(post_stagger.exit_evidence[0].pid, 1234);
    assert_eq!(spawn_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(terminated.load(std::sync::atomic::Ordering::SeqCst), 0);
    reap_completed_worker_supervisors(&state, &second.run_id).unwrap();
}

#[test]
fn launch_failure_wins_when_last_worker_exit_reaches_finalizing_first() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(11);
        run.transition(ProcessingLifecycle::Running).unwrap();
        assert!(record_worker_exit(
            &mut processing_state,
            &reserved.run_id,
            11,
            0
        ));
    }
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap().lifecycle,
        ProcessingLifecycle::Finalizing
    );

    let failed = record_launch_failure_impl(
        &state,
        &reserved.run_id,
        "Failed to spawn MATLAB worker 2".to_string(),
    )
    .unwrap();
    assert_eq!(failed.lifecycle, ProcessingLifecycle::Failed);
    assert_eq!(
        failed.terminal_result,
        Some(ProcessingTerminalResult::Failed)
    );
    assert_eq!(
        failed.pending_launch_failure.as_deref(),
        Some("Failed to spawn MATLAB worker 2")
    );
    assert_eq!(failed.exit_evidence[0].pid, 11);
}

#[test]
fn child_crossing_spawn_registration_boundary_is_terminated_and_never_owned() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(41);
        run.transition(ProcessingLifecycle::Running).unwrap();
    }
    let exit_state = Arc::clone(&state);
    let exit_run_id = reserved.run_id.clone();
    let terminated = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let terminated_child = Arc::clone(&terminated);
    let snapshot = launch_worker_set(
        &state,
        &reserved.run_id,
        1,
        move |_, _| {
            assert!(record_worker_exit(
                &mut exit_state.processing_state.lock().unwrap(),
                &exit_run_id,
                41,
                0
            ));
            Ok((42, ()))
        },
        |_, _, ()| panic!("unregistrable child must not be supervised"),
        || {},
        move |()| {
            terminated_child.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .unwrap();

    assert_eq!(snapshot.lifecycle, ProcessingLifecycle::Finalizing);
    assert!(snapshot.workers.is_empty());
    assert_eq!(snapshot.exit_evidence[0].pid, 41);
    assert_eq!(terminated.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        state
            .processing_state
            .lock()
            .unwrap()
            .worker_supervisors
            .is_empty()
    );
}

#[test]
fn pending_launch_failure_remains_cancellable_and_cancellation_releases_watcher() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let (stop_tx, stop_rx) = mpsc::channel();
    let watcher = std::thread::spawn(move || {
        let _ = stop_rx.recv();
    });
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(55);
        run.transition(ProcessingLifecycle::Running).unwrap();
        run.pending_launch_failure = Some("worker 2 spawn failed".to_string());
        run.watcher_owned = true;
        processing_state.watcher_run_id = Some(reserved.run_id.clone());
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(watcher);
    }

    assert_eq!(
        begin_cancellation(&state, &reserved.run_id).unwrap(),
        vec![55]
    );
    assert!(record_worker_exit(
        &mut state.processing_state.lock().unwrap(),
        &reserved.run_id,
        55,
        0
    ));
    let cancelled = complete_cancellation(&state, &reserved.run_id).unwrap();
    assert_eq!(cancelled.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(!cancelled.watcher_owned);
    assert!(reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).is_ok());
}

#[test]
fn invalid_launch_profile_fails_only_matching_preparing_run() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let invalid = crate::execution_profile::ExecutionProfile::Matlab {
        id: "invalid".to_string(),
        label: "Invalid".to_string(),
        matlab_path: "not-a-matlab-executable".to_string(),
        explore_asl_path: "not-an-exploreasl-directory".to_string(),
        explore_asl_version: None,
    };
    assert!(
        run_pipeline_with(
            &state,
            &reserved.run_id,
            &invalid,
            "{}",
            &[false, true, false],
            1,
            "",
            false,
            ExecutionProfile::validate,
            |_, _, _| panic!("invalid MATLAB profile cannot warm MCR"),
            |_| -> Result<(u32, ()), String> {
                panic!("invalid profile cannot reach process spawn")
            },
            |_, _, ()| panic!("invalid profile cannot install supervisor"),
            || panic!("one-worker launch cannot stagger"),
            |()| panic!("invalid profile cannot own child"),
        )
        .is_err()
    );
    assert_eq!(
        state
            .processing_state
            .lock()
            .unwrap()
            .current_run
            .as_ref()
            .unwrap()
            .lifecycle,
        ProcessingLifecycle::Failed
    );
}

#[test]
fn duplicate_launch_rejects_running_run_without_failure_evidence_or_mutation() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(4242);
        run.transition(ProcessingLifecycle::Running).unwrap();
    }
    let before = attach_run_impl(&state, &reserved.run_id).unwrap();
    let profile = crate::execution_profile::ExecutionProfile::Matlab {
        id: "unused".to_string(),
        label: "Unused".to_string(),
        matlab_path: "/unused/matlab".to_string(),
        explore_asl_path: "/unused/ExploreASL".to_string(),
        explore_asl_version: None,
    };

    let error = run_pipeline_with(
        &state,
        &reserved.run_id,
        &profile,
        "corrupt",
        &[false, true, false],
        1,
        "",
        false,
        |_| panic!("wrong-state launch must reject before profile validation"),
        |_, _, _| panic!("wrong-state launch cannot warm MCR"),
        |_| -> Result<(u32, ()), String> { panic!("wrong-state launch cannot spawn") },
        |_, _, ()| panic!("wrong-state launch cannot supervise"),
        || panic!("wrong-state launch cannot stagger"),
        |()| panic!("wrong-state launch cannot terminate a child"),
    )
    .unwrap_err();
    assert!(error.contains("must be Preparing"));
    assert_eq!(attach_run_impl(&state, &reserved.run_id).unwrap(), before);
    assert!(!root.join("derivatives").exists());

    assert!(record_worker_exit(
        &mut state.processing_state.lock().unwrap(),
        &reserved.run_id,
        4242,
        0
    ));
    let finalizing = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(finalizing.lifecycle, ProcessingLifecycle::Finalizing);
    assert!(finalizing.pending_launch_failure.is_none());
}

#[test]
fn run_scoped_launch_preserves_matlab_and_apptainer_worker_arguments() {
    let batch = build_matlab_processing_batch(
        Path::new("/tools/ExploreASL"),
        Path::new("/data/project"),
        "1,0,1",
        2,
        4,
    );
    assert_eq!(
        batch,
        "addpath('/tools/ExploreASL'); ExploreASL('/data/project', 0, [1,0,1], 0, 2, 4)"
    );
    assert_eq!(
        build_apptainer_processing_args(
            Path::new("/data/project"),
            Path::new("/images/exploreasl.sif"),
            "1,0,1",
            2,
            4,
        )[10..],
        ["0", "1,0,1", "0", "2", "4"]
    );
}

#[test]
fn matlab_run_pipeline_harness_preserves_dispatch_rerun_stagger_and_snapshot() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(
        &state,
        vec!["structural".to_string(), "asl".to_string()],
        vec!["sub-001_01".to_string()],
    )
    .unwrap();
    let canonical_root = root.canonicalize().unwrap();
    let bids2legacy = canonical_root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    let matching_lock = bids2legacy.join("sub-001_01");
    let retained_lock = bids2legacy.join("sub-002_01");
    fs::create_dir_all(&matching_lock).unwrap();
    fs::create_dir_all(&retained_lock).unwrap();

    let events = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let validation_events = Arc::clone(&events);
    let spawn_events = Arc::clone(&events);
    let supervisor_events = Arc::clone(&events);
    let stagger_events = Arc::clone(&events);
    let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
    let spawned_commands = Arc::clone(&commands);
    let exploreasl_path = canonical_root.join("fake-ExploreASL");
    let expected_exploreasl_path = exploreasl_path.clone();
    let snapshot = run_pipeline_with(
        &state,
        &reserved.run_id,
        &ExecutionProfile::Matlab {
            id: "matlab-test".to_string(),
            label: "MATLAB test".to_string(),
            matlab_path: "unused-by-injected-validation".to_string(),
            explore_asl_path: "unused-by-injected-validation".to_string(),
            explore_asl_version: Some("1.11.0".to_string()),
        },
        r#"{"x":{"test":true}}"#,
        &[true, true, false],
        2,
        "caller-value-is-not-authoritative",
        true,
        move |profile| {
            assert!(matches!(profile, ExecutionProfile::Matlab { .. }));
            validation_events
                .lock()
                .unwrap()
                .push("validate-matlab".to_string());
            InternalValidation {
                valid: true,
                errors: vec![],
                explore_asl_version: Some("1.11.0".to_string()),
                matlab_path: Some("/injected/matlab".to_string()),
                explore_asl_path: Some(exploreasl_path.clone()),
                apptainer_path: None,
                sif_path: None,
            }
        },
        |_, _, _| panic!("MATLAB dispatch must not warm Apptainer MCR"),
        move |command| {
            let worker = match &command {
                ProcessingWorkerCommand::Matlab { worker, .. } => *worker,
                ProcessingWorkerCommand::Apptainer { .. } => panic!("wrong profile dispatch"),
            };
            spawn_events.lock().unwrap().push(format!("spawn-{worker}"));
            spawned_commands.lock().unwrap().push(command);
            Ok((8100 + worker as u32, ()))
        },
        move |run_id, pid, ()| {
            supervisor_events
                .lock()
                .unwrap()
                .push(format!("supervise-{}", pid - 8100));
            WorkerSupervisor {
                run_id,
                handle: std::thread::spawn(|| {}),
            }
        },
        move || stagger_events.lock().unwrap().push("stagger".to_string()),
        |()| panic!("registered test child must not be terminated"),
    )
    .unwrap();

    assert_eq!(
        events.lock().unwrap().as_slice(),
        [
            "validate-matlab",
            "spawn-1",
            "supervise-1",
            "stagger",
            "spawn-2",
            "supervise-2",
        ]
    );
    assert_eq!(
        commands.lock().unwrap().as_slice(),
        [
            ProcessingWorkerCommand::Matlab {
                executable: "/injected/matlab".to_string(),
                batch: format!(
                    "addpath('{}'); ExploreASL('{}', 0, [1,1,0], 0, 1, 2)",
                    expected_exploreasl_path.display(),
                    canonical_root.display()
                ),
                worker: 1,
            },
            ProcessingWorkerCommand::Matlab {
                executable: "/injected/matlab".to_string(),
                batch: format!(
                    "addpath('{}'); ExploreASL('{}', 0, [1,1,0], 0, 2, 2)",
                    expected_exploreasl_path.display(),
                    canonical_root.display()
                ),
                worker: 2,
            },
        ]
    );
    assert_eq!(snapshot.run_id, reserved.run_id);
    assert_eq!(snapshot.lifecycle, ProcessingLifecycle::Running);
    assert_eq!(snapshot.workers, vec![8101, 8102]);
    assert!(snapshot.exit_evidence.is_empty());
    assert_eq!(
        fs::read_to_string(canonical_root.join("derivatives/ExploreASL/dataPar.json")).unwrap(),
        r#"{"x":{"test":true}}"#
    );
    assert!(!matching_lock.exists());
    assert!(retained_lock.exists());
}

#[test]
fn apptainer_run_pipeline_harness_preserves_dispatch_rerun_stagger_and_snapshot() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(
        &state,
        vec!["asl".to_string()],
        vec!["sub-003_02".to_string()],
    )
    .unwrap();
    let canonical_root = root.canonicalize().unwrap();
    let retained_lock =
        canonical_root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-003_02");
    fs::create_dir_all(&retained_lock).unwrap();
    let sif_path = canonical_root.join("fake-image.sif");
    let expected_sif_path = sif_path.clone();

    let events = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let validation_events = Arc::clone(&events);
    let warm_events = Arc::clone(&events);
    let spawn_events = Arc::clone(&events);
    let supervisor_events = Arc::clone(&events);
    let stagger_events = Arc::clone(&events);
    let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
    let spawned_commands = Arc::clone(&commands);
    let expected_root_for_warm = canonical_root.clone();
    let expected_sif_for_warm = sif_path.clone();
    let snapshot = run_pipeline_with(
        &state,
        &reserved.run_id,
        &ExecutionProfile::Apptainer {
            id: "apptainer-test".to_string(),
            label: "Apptainer test".to_string(),
            sif_path: "unused-by-injected-validation".to_string(),
            apptainer_path: "unused-by-injected-validation".to_string(),
            explore_asl_version: Some("1.11.0".to_string()),
        },
        "{}",
        &[false, true, false],
        2,
        "caller-value-is-not-authoritative",
        false,
        move |profile| {
            assert!(matches!(profile, ExecutionProfile::Apptainer { .. }));
            validation_events
                .lock()
                .unwrap()
                .push("validate-apptainer".to_string());
            InternalValidation {
                valid: true,
                errors: vec![],
                explore_asl_version: Some("1.11.0".to_string()),
                matlab_path: None,
                explore_asl_path: None,
                apptainer_path: Some("/injected/apptainer".to_string()),
                sif_path: Some(sif_path.clone()),
            }
        },
        move |executable, image, project| {
            assert_eq!(executable, "/injected/apptainer");
            assert_eq!(image, expected_sif_for_warm);
            assert_eq!(project, expected_root_for_warm);
            warm_events.lock().unwrap().push("warm-mcr".to_string());
            Ok(())
        },
        move |command| {
            let worker = match &command {
                ProcessingWorkerCommand::Apptainer { worker, .. } => *worker,
                ProcessingWorkerCommand::Matlab { .. } => panic!("wrong profile dispatch"),
            };
            spawn_events.lock().unwrap().push(format!("spawn-{worker}"));
            spawned_commands.lock().unwrap().push(command);
            Ok((8200 + worker as u32, ()))
        },
        move |run_id, pid, ()| {
            supervisor_events
                .lock()
                .unwrap()
                .push(format!("supervise-{}", pid - 8200));
            WorkerSupervisor {
                run_id,
                handle: std::thread::spawn(|| {}),
            }
        },
        move || stagger_events.lock().unwrap().push("stagger".to_string()),
        |()| panic!("registered test child must not be terminated"),
    )
    .unwrap();

    assert_eq!(
        events.lock().unwrap().as_slice(),
        [
            "validate-apptainer",
            "warm-mcr",
            "spawn-1",
            "supervise-1",
            "stagger",
            "spawn-2",
            "supervise-2",
        ]
    );
    let expected_args = |worker: usize| {
        vec![
            "exec".to_string(),
            "--cleanenv".to_string(),
            "--writable-tmpfs".to_string(),
            "--bind".to_string(),
            format!("{}:/data", canonical_root.display()),
            expected_sif_path.display().to_string(),
            "/bin/bash".to_string(),
            "/opt/xasl/xASL_latest/run_xASL_latest.sh".to_string(),
            "/opt/mcr/v97/".to_string(),
            "/data".to_string(),
            "0".to_string(),
            "0,1,0".to_string(),
            "0".to_string(),
            worker.to_string(),
            "2".to_string(),
        ]
    };
    assert_eq!(
        commands.lock().unwrap().as_slice(),
        [
            ProcessingWorkerCommand::Apptainer {
                executable: "/injected/apptainer".to_string(),
                args: expected_args(1),
                worker: 1,
            },
            ProcessingWorkerCommand::Apptainer {
                executable: "/injected/apptainer".to_string(),
                args: expected_args(2),
                worker: 2,
            },
        ]
    );
    assert_eq!(snapshot.run_id, reserved.run_id);
    assert_eq!(snapshot.lifecycle, ProcessingLifecycle::Running);
    assert_eq!(snapshot.workers, vec![8201, 8202]);
    assert!(snapshot.exit_evidence.is_empty());
    assert!(
        retained_lock.exists(),
        "rerun_bids2legacy=false must preserve lock"
    );
}

#[test]
fn cancellation_is_run_scoped_and_waits_for_authoritative_reap() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let other_root = workspace.path().join("other-project");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&other_root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Running;
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .workers
        .extend([41, 42]);
    assert_eq!(
        begin_cancellation(&state, &reserved.run_id).unwrap(),
        vec![41, 42]
    );
    assert_eq!(
        state
            .processing_state
            .lock()
            .unwrap()
            .current_run
            .as_ref()
            .unwrap()
            .lifecycle,
        ProcessingLifecycle::Cancelling
    );
    let cancelling = cancelling_snapshot(&state, &reserved.run_id).unwrap();
    assert_eq!(cancelling.run_id, reserved.run_id);
    assert_eq!(cancelling.lifecycle, ProcessingLifecycle::Cancelling);
    assert_eq!(cancelling.workers, vec![41, 42]);
    assert!(begin_cancellation(&state, &reserved.run_id).is_err());
    assert!(record_worker_exit(
        &mut state.processing_state.lock().unwrap(),
        &reserved.run_id,
        41,
        0
    ));
    let cancelled = complete_cancellation(&state, &reserved.run_id).unwrap();
    assert_eq!(cancelled.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(complete_cancellation(&state, &reserved.run_id).is_err());

    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(begin_cancellation(&state, &reserved.run_id).is_err());
}

#[test]
fn cancellation_rejects_pid_zero_before_entering_cancelling() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.lifecycle = ProcessingLifecycle::Running;
        run.workers.insert(0);
    }

    assert_eq!(
        begin_cancellation(&state, &reserved.run_id).unwrap_err(),
        "PID 0 is not a valid child process ID"
    );
    let retained = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(retained.lifecycle, ProcessingLifecycle::Running);
    assert_eq!(retained.workers, vec![0]);
}

#[test]
fn cancellation_term_error_after_exit_is_treated_as_disappearance() {
    let mut existence_checks = 0;
    let mut term_calls = 0;
    terminate_worker_processes_with(
        &[41],
        Duration::ZERO,
        |_| {
            existence_checks += 1;
            Ok(existence_checks == 1)
        },
        |_| {
            term_calls += 1;
            Err("TERM ESRCH".to_string())
        },
        |_| panic!("disappeared worker must not be force-killed"),
        |_| {},
    )
    .unwrap();
    assert_eq!(term_calls, 1);
}

#[test]
fn disappeared_worker_supervisor_is_joined_before_cancelled_transition() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    let (release_tx, release_rx) = mpsc::channel();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(44);
        run.transition(ProcessingLifecycle::Running).unwrap();
        let supervisor_state = Arc::clone(&state);
        let supervisor_run_id = reserved.run_id.clone();
        processing_state.worker_supervisors.push(WorkerSupervisor {
            run_id: reserved.run_id.clone(),
            handle: std::thread::spawn(move || {
                release_rx.recv().unwrap();
                complete_supervised_worker(&supervisor_state, &supervisor_run_id, 44, 0);
            }),
        });
    }
    let pids = begin_cancellation(&state, &reserved.run_id).unwrap();
    let mut existence_checks = 0;
    let mut release_tx = Some(release_tx);

    terminate_worker_processes_with(
        &pids,
        Duration::ZERO,
        |_| {
            existence_checks += 1;
            Ok(existence_checks == 1)
        },
        |_| {
            release_tx.take().unwrap().send(()).unwrap();
            Err("TERM ESRCH".to_string())
        },
        |_| panic!("disappeared worker must not be force-killed"),
        |_| {},
    )
    .unwrap();
    join_worker_supervisors(&state, &reserved.run_id).unwrap();
    let cancelled = complete_cancellation(&state, &reserved.run_id).unwrap();

    assert_eq!(cancelled.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(cancelled.workers.is_empty());
    assert_eq!(
        cancelled.exit_evidence,
        vec![WorkerExitEvidence {
            pid: 44,
            exit_code: 0
        }]
    );
    assert!(
        state
            .processing_state
            .lock()
            .unwrap()
            .worker_supervisors
            .is_empty()
    );
}

#[test]
fn cancellation_force_kill_error_after_exit_is_treated_as_disappearance() {
    let mut existence_checks = 0;
    let mut force_calls = 0;
    terminate_worker_processes_with(
        &[42],
        Duration::ZERO,
        |_| {
            existence_checks += 1;
            Ok(existence_checks <= 3)
        },
        |_| Ok(()),
        |_| {
            force_calls += 1;
            Err("KILL ESRCH".to_string())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(force_calls, 1);
}

#[test]
fn live_signal_failure_retains_actionable_cancelling_ownership() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(43);
        run.transition(ProcessingLifecycle::Running).unwrap();
    }
    let pids = begin_cancellation(&state, &reserved.run_id).unwrap();

    let error = terminate_worker_processes_with(
        &pids,
        Duration::ZERO,
        |_| Ok(true),
        |_| Err("permission denied".to_string()),
        |_| panic!("TERM failure must return before force kill"),
        |_| {},
    )
    .unwrap_err();
    assert!(error.contains("permission denied"));
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap().lifecycle,
        ProcessingLifecycle::Cancelling
    );
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap().workers,
        vec![43]
    );
}

#[test]
fn cancellation_helper_rejects_pid_zero_before_any_operation() {
    let operations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let exists_operations = Arc::clone(&operations);
    let term_operations = Arc::clone(&operations);
    let force_operations = Arc::clone(&operations);
    let sleep_operations = Arc::clone(&operations);
    let error = terminate_worker_processes_with(
        &[0],
        Duration::ZERO,
        move |_| {
            exists_operations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(false)
        },
        move |_| {
            term_operations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        },
        move |_| {
            force_operations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        },
        move |_| {
            sleep_operations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .unwrap_err();
    assert_eq!(error, "PID 0 is not a valid child process ID");
    assert_eq!(operations.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn apptainer_processing_args_bind_project_root_to_data() {
    let args = build_apptainer_processing_args(
        PathBuf::from("/data/project").as_path(),
        PathBuf::from("/images/exploreasl.sif").as_path(),
        "[1,0,1]",
        2,
        4,
    );

    assert_eq!(
        args,
        vec![
            "exec",
            "--cleanenv",
            "--writable-tmpfs",
            "--bind",
            "/data/project:/data",
            "/images/exploreasl.sif",
            "/bin/bash",
            "/opt/xasl/xASL_latest/run_xASL_latest.sh",
            "/opt/mcr/v97/",
            "/data",
            "0",
            "[1,0,1]",
            "0",
            "2",
            "4",
        ]
    );
}

// -------------------------------------------------------------------------
// get_exploreasl_version
// -------------------------------------------------------------------------

#[test]
fn get_exploreasl_version_finds_version_file() {
    let root = unique_temp_path("version-find");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_1.11.0"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, Some("1.11.0".to_string()));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_finds_beta_version() {
    let root = unique_temp_path("version-beta");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, Some("2.0.0_BETA".to_string()));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_returns_none_when_no_version_file() {
    let root = unique_temp_path("version-none");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("ExploreASL.m"), "").unwrap();
    fs::write(root.join("README.md"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, None);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_returns_none_when_dir_missing() {
    let root = unique_temp_path("version-missing");

    let version = get_exploreasl_version(&root);

    assert_eq!(version, None);
}

#[test]
fn get_exploreasl_version_returns_first_when_multiple() {
    let root = unique_temp_path("version-multi");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_1.11.0"), "").unwrap();
    fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert!(version == Some("1.11.0".to_string()) || version == Some("2.0.0_BETA".to_string()));

    let _ = fs::remove_dir_all(root);
}
