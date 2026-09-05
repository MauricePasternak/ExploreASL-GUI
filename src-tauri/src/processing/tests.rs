use super::locks::*;
use super::logs::*;
use super::pipeline::*;
use super::reports::*;
use super::runs::{
    attach_run_impl, completed_population_run_root, fail_processing_run_impl,
    finalize_processing_run_impl, finalizing_run_root, get_active_run_impl, preparing_run_root,
    record_launch_failure_impl, record_worker_exit, reserve_processing_run_impl,
    validate_launch_request, validate_watcher_request,
};
use super::subjects::*;
use super::types::*;
use super::utils::*;
use super::watcher::stop_watch_lock_dir_impl;
use crate::execution_profile::{ExecutionProfile, InternalValidation, get_exploreasl_version};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[test]
fn processing_lifecycle_transition_table_enforces_protocol() {
    use ProcessingLifecycle::*;

    let legal = [
        (Preparing, Running),
        (Preparing, Failed),
        (Running, Finalizing),
        (Running, Cancelling),
        (Running, Failed),
        (Running, Interrupted),
        (Cancelling, Cancelled),
        (Cancelling, Failed),
        (Finalizing, Completed),
        (Finalizing, Failed),
    ];
    for (from, to) in legal {
        assert!(
            validate_processing_transition(from, to).is_ok(),
            "{from:?} -> {to:?}"
        );
    }

    for from in [
        Preparing,
        Running,
        Finalizing,
        Cancelling,
        Completed,
        Failed,
        Cancelled,
        Interrupted,
    ] {
        for to in [
            Preparing,
            Running,
            Finalizing,
            Cancelling,
            Completed,
            Failed,
            Cancelled,
            Interrupted,
        ] {
            let expected = legal.contains(&(from, to));
            assert_eq!(
                validate_processing_transition(from, to).is_ok(),
                expected,
                "{from:?} -> {to:?}"
            );
        }
    }
}

#[test]
fn processing_run_snapshot_serializes_authoritative_camel_case_fields() {
    let mut run = ProcessingRun::new(
        "run-42".to_string(),
        PathBuf::from("/canonical/project"),
        vec!["structural".to_string(), "asl".to_string()],
        vec!["sub-001_01".to_string()],
    );
    run.start_time = 1_700_000_000_000;
    run.workers.extend([101, 202]);
    run.exit_evidence.push(WorkerExitEvidence {
        pid: 99,
        exit_code: 1,
    });
    run.watcher_owned = true;
    run.transition(ProcessingLifecycle::Failed).unwrap();

    let json = serde_json::to_value(run.snapshot()).unwrap();
    assert_eq!(json["runId"], "run-42");
    assert_eq!(json["lifecycle"], "failed");
    assert_eq!(json["projectRoot"], "/canonical/project");
    assert_eq!(
        json["selectedModules"],
        serde_json::json!(["structural", "asl"])
    );
    assert_eq!(
        json["selectedSubjectSessions"],
        serde_json::json!(["sub-001_01"])
    );
    assert_eq!(json["startTime"], 1_700_000_000_000_u64);
    assert_eq!(json["workers"], serde_json::json!([101, 202]));
    assert_eq!(json["exitEvidence"][0]["exitCode"], 1);
    assert_eq!(json["watcherOwned"], true);
    assert_eq!(json["terminalResult"], "failed");
}

fn state_with_active_project(root: &Path) -> Arc<crate::app_state::AppState> {
    let state = Arc::new(crate::app_state::AppState::default());
    *state.active_project_root.lock().unwrap() = Some(root.canonicalize().unwrap());
    state
}

fn invoke_launch_expected_before_profile_validation(
    state: &crate::app_state::AppState,
    run_id: &str,
    b_process: &[bool],
    workers: u32,
) -> Result<ProcessingRunSnapshot, String> {
    let profile = crate::execution_profile::ExecutionProfile::Matlab {
        id: "unused".to_string(),
        label: "Unused".to_string(),
        matlab_path: "/unused/matlab".to_string(),
        explore_asl_path: "/unused/ExploreASL".to_string(),
        explore_asl_version: None,
    };
    run_pipeline_with(
        state,
        run_id,
        &profile,
        "must-not-be-written",
        b_process,
        workers,
        "",
        false,
        |_| panic!("request must resolve before profile validation"),
        |_, _, _| panic!("request cannot warm MCR"),
        |_| -> Result<(u32, ()), String> { panic!("request cannot spawn") },
        |_, _, ()| panic!("request cannot supervise"),
        || panic!("request cannot stagger"),
        |()| panic!("request cannot terminate a child"),
    )
}

#[test]
fn processing_reservation_is_atomic_and_never_mutates_rejected_fixture() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let sentinel = root.join("sentinel.txt");
    fs::write(&sentinel, "unchanged").unwrap();
    let state = state_with_active_project(&root);

    let first = reserve_processing_run_impl(
        &state,
        vec!["structural".to_string()],
        vec!["sub-001_01".to_string()],
    )
    .unwrap();
    assert_eq!(first.lifecycle, ProcessingLifecycle::Preparing);
    assert_eq!(
        first.project_root,
        root.canonicalize().unwrap().to_string_lossy()
    );

    let before = fs::read(&sentinel).unwrap();
    let concurrent = Arc::clone(&state);
    let rejected = std::thread::spawn(move || {
        reserve_processing_run_impl(&concurrent, vec!["asl".to_string()], vec![])
    })
    .join()
    .unwrap();
    assert!(rejected.is_err());
    assert_eq!(fs::read(&sentinel).unwrap(), before);

    let no_active = crate::app_state::AppState::default();
    assert!(reserve_processing_run_impl(&no_active, vec!["asl".to_string()], vec![]).is_err());

    {
        let mut processing_state = state.processing_state.lock().unwrap();
        processing_state
            .current_run
            .as_mut()
            .unwrap()
            .transition(ProcessingLifecycle::Failed)
            .unwrap();
    }
    let replacement = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    assert_ne!(replacement.run_id, first.run_id);

    state.processing_state.lock().unwrap().watcher_run_id = Some("foreign-run".to_string());
    assert!(reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).is_err());
    assert_eq!(fs::read(&sentinel).unwrap(), before);
}

#[test]
fn processing_run_protocol_integrates_concurrent_reservation_early_exit_and_attachment() {
    fn tree_bytes(root: &Path) -> Vec<(PathBuf, Option<Vec<u8>>)> {
        let mut entries = walkdir::WalkDir::new(root)
            .into_iter()
            .map(|entry| {
                let entry = entry.unwrap();
                let relative = entry.path().strip_prefix(root).unwrap().to_path_buf();
                let contents = entry
                    .file_type()
                    .is_file()
                    .then(|| fs::read(entry.path()).unwrap());
                (relative, contents)
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        entries
    }

    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let lock_dir = root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(root.join("sentinel.txt"), "unchanged").unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "status").unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "log").unwrap();
    let before = tree_bytes(&root);
    let state = state_with_active_project(&root);

    let barrier = Arc::new(std::sync::Barrier::new(3));
    let starts = ["structural", "asl"].map(|module| {
        let state = Arc::clone(&state);
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            reserve_processing_run_impl(
                &state,
                vec![module.to_string()],
                vec!["sub-001_01".to_string()],
            )
        })
    });
    barrier.wait();
    let results = starts.map(|start| start.join().unwrap());
    let mut reservations = results
        .iter()
        .filter_map(|result| result.as_ref().ok())
        .collect::<Vec<_>>();
    assert_eq!(
        reservations.len(),
        1,
        "exactly one concurrent start reserves"
    );
    assert!(
        results.iter().any(Result::is_err),
        "one concurrent start rejects"
    );
    assert_eq!(
        tree_bytes(&root),
        before,
        "rejected reservation mutates no fixture path"
    );

    let reserved = reservations.pop().unwrap();
    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.insert(4242);
        run.transition(ProcessingLifecycle::Running).unwrap();
        assert!(record_worker_exit(
            &mut processing_state,
            &reserved.run_id,
            4242,
            0
        ));
    }

    // Models the final supervisor completing before the launch response crosses IPC.
    let attached = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(attached.lifecycle, ProcessingLifecycle::Finalizing);
    assert!(
        attached.workers.is_empty(),
        "attachment cannot re-add an exited PID"
    );
    assert_eq!(
        attached.exit_evidence,
        vec![WorkerExitEvidence {
            pid: 4242,
            exit_code: 0
        }]
    );
    assert_eq!(
        get_active_run_impl(&state).unwrap().unwrap().lifecycle,
        ProcessingLifecycle::Finalizing
    );
}

#[test]
fn run_scoped_preparation_and_finalization_roots_reject_stale_identity_before_mutation() {
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
        vec!["population".to_string()],
        vec!["sub-001_01".to_string()],
    )
    .unwrap();

    assert_eq!(
        preparing_run_root(&state, &reserved.run_id).unwrap(),
        root.canonicalize().unwrap()
    );
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Running;
    assert!(preparing_run_root(&state, &reserved.run_id).is_err());
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), "unchanged");

    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Finalizing;
    assert_eq!(
        finalizing_run_root(&state, &reserved.run_id).unwrap(),
        root.canonicalize().unwrap()
    );
    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(finalizing_run_root(&state, &reserved.run_id).is_err());
    assert!(completed_population_run_root(&state, &reserved.run_id).is_err());
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), "unchanged");
}

#[test]
fn run_scoped_failure_and_finalization_reject_stale_foreign_and_wrong_states() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let other_root = workspace.path().join("other-project");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&other_root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();

    assert!(fail_processing_run_impl(&state, "stale-run").is_err());
    let failed = fail_processing_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(failed.lifecycle, ProcessingLifecycle::Failed);
    assert!(fail_processing_run_impl(&state, &reserved.run_id).is_err());
    assert!(
        finalize_processing_run_impl(
            &state,
            &reserved.run_id,
            ProcessingTerminalResult::Completed
        )
        .is_err()
    );

    let finalizing = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Finalizing;
    let completed = finalize_processing_run_impl(
        &state,
        &finalizing.run_id,
        ProcessingTerminalResult::Completed,
    )
    .unwrap();
    assert_eq!(completed.lifecycle, ProcessingLifecycle::Completed);
    assert!(
        finalize_processing_run_impl(&state, &finalizing.run_id, ProcessingTerminalResult::Failed)
            .is_err()
    );

    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(fail_processing_run_impl(&state, &finalizing.run_id).is_err());
}

#[test]
fn public_preparation_failure_rejects_running_and_finalizing_without_mutation() {
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

    let running_before = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert!(fail_processing_run_impl(&state, &reserved.run_id).is_err());
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap(),
        running_before
    );

    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.workers.clear();
        run.transition(ProcessingLifecycle::Finalizing).unwrap();
    }
    let finalizing_before = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert!(fail_processing_run_impl(&state, &reserved.run_id).is_err());
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap(),
        finalizing_before
    );
}

#[test]
fn run_discovery_and_attachment_are_observational_and_ownership_checked() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let other_root = workspace.path().join("other-project");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&other_root).unwrap();
    let state = state_with_active_project(&root);
    assert!(get_active_run_impl(&state).unwrap().is_none());

    let reserved = reserve_processing_run_impl(&state, vec!["asl".to_string()], vec![]).unwrap();
    assert_eq!(
        get_active_run_impl(&state).unwrap().unwrap().run_id,
        reserved.run_id
    );
    let attached_preparing = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(attached_preparing.lifecycle, ProcessingLifecycle::Preparing);

    {
        let mut processing_state = state.processing_state.lock().unwrap();
        let run = processing_state.current_run.as_mut().unwrap();
        run.lifecycle = ProcessingLifecycle::Running;
        run.workers.extend([10, 11]);
        run.workers.remove(&10);
        run.exit_evidence.push(WorkerExitEvidence {
            pid: 10,
            exit_code: 0,
        });
    }
    let early_exit = attach_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(early_exit.workers, vec![11]);
    assert_eq!(
        early_exit.exit_evidence,
        vec![WorkerExitEvidence {
            pid: 10,
            exit_code: 0
        }]
    );

    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Finalizing;
    assert_eq!(
        get_active_run_impl(&state).unwrap().unwrap().lifecycle,
        ProcessingLifecycle::Finalizing
    );
    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Completed;
    assert!(get_active_run_impl(&state).unwrap().is_none());
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap().lifecycle,
        ProcessingLifecycle::Completed
    );
    assert!(attach_run_impl(&state, "obsolete").is_err());

    *state.active_project_root.lock().unwrap() = Some(other_root.canonicalize().unwrap());
    assert!(get_active_run_impl(&state).unwrap().is_none());
    assert!(attach_run_impl(&state, &reserved.run_id).is_err());
}

#[test]
fn native_run_command_payloads_use_camel_case_snapshots() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(&root).unwrap();
    let state = state_with_active_project(&root);
    let reserved = reserve_processing_run_impl(
        &state,
        vec!["structural".to_string()],
        vec!["sub-001_01".to_string()],
    )
    .unwrap();
    let attached = attach_run_impl(&state, &reserved.run_id).unwrap();
    let json = serde_json::to_value(attached).unwrap();
    assert!(json.get("runId").is_some());
    assert!(json.get("selectedModules").is_some());
    assert!(json.get("selectedSubjectSessions").is_some());
    assert!(json.get("run_id").is_none());
    let failed = fail_processing_run_impl(&state, &reserved.run_id).unwrap();
    assert_eq!(
        failed.terminal_result,
        Some(ProcessingTerminalResult::Failed)
    );
}

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
    let worker = WorkerExited {
        run_id: "run-1".to_string(),
        pid: 99,
        exit_code: 0,
    };
    for event in [
        serde_json::to_value(status).unwrap(),
        serde_json::to_value(lock_created).unwrap(),
        serde_json::to_value(lock_removed).unwrap(),
        serde_json::to_value(worker).unwrap(),
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

fn unique_temp_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("exploreasl-gui-proc-{name}-{suffix}"))
}

// -------------------------------------------------------------------------
// module_index_to_name
// -------------------------------------------------------------------------

#[test]
fn module_index_to_name_maps_0_to_structural() {
    assert_eq!(module_index_to_name(0), "xASL_module_Structural");
}

#[test]
fn module_index_to_name_maps_1_to_asl() {
    assert_eq!(module_index_to_name(1), "xASL_module_ASL");
}

#[test]
fn module_index_to_name_maps_2_to_population() {
    assert_eq!(module_index_to_name(2), "xASL_module_Population");
}

#[test]
#[should_panic(expected = "Invalid module index")]
fn module_index_to_name_panics_on_invalid_index() {
    module_index_to_name(3);
}

// -------------------------------------------------------------------------
// is_mutex_related_line / check_log_for_error
// -------------------------------------------------------------------------

#[test]
fn is_mutex_related_line_detects_mutex_message() {
    assert!(is_mutex_related_line(
        "ERROR: mutex is locked for subject sub-001"
    ));
    assert!(is_mutex_related_line("  mutex is locked"));
    assert!(is_mutex_related_line("Mutex is locked"));
}

#[test]
fn is_mutex_related_line_rejects_normal_errors() {
    assert!(!is_mutex_related_line("ERROR: file not found"));
    assert!(!is_mutex_related_line("Error processing subject"));
    assert!(!is_mutex_related_line("some normal log line"));
}

#[test]
fn check_log_for_error_returns_false_for_mutex_only_errors() {
    let dir = unique_temp_path("mutex-only");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: retrying\n",
    )
    .unwrap();
    assert!(!check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_true_for_real_errors() {
    let dir = unique_temp_path("real-error");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(
        &log,
        "INFO: starting\nERROR: file not found /data/sub-001.nii\n",
    )
    .unwrap();
    assert!(check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_true_when_mixed_mutex_and_real_errors() {
    let dir = unique_temp_path("mixed-errors");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(&log, "ERROR: mutex is locked\nERROR: file not found\n").unwrap();
    assert!(check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_false_for_empty_log() {
    let dir = unique_temp_path("empty-log");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(&log, "").unwrap();
    assert!(!check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

// -------------------------------------------------------------------------
// Error determination: 999_ready.status + mutex interaction
// -------------------------------------------------------------------------

#[test]
fn error_detection_ready_status_no_mutex_not_errored() {
    let dir = unique_temp_path("ready-no-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(lock_dir.join("999_ready.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(&log, "INFO: starting\nINFO: completed successfully\n").unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "complete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_ready_status_with_mutex_not_errored() {
    let dir = unique_temp_path("ready-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(lock_dir.join("999_ready.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: completed\n",
    )
    .unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "complete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_no_ready_status_with_mutex_is_errored() {
    let dir = unique_temp_path("no-ready-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\n",
    )
    .unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "incomplete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_no_ready_status_no_mutex_is_errored() {
    let dir = unique_temp_path("no-ready-no-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(&log, "INFO: starting\nINFO: processing...\n").unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "incomplete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_never_run_not_errored() {
    let dir = unique_temp_path("never-run");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();

    let (status, steps, _) = determine_status(&lock_dir);
    assert_eq!(status, "pending");
    assert!(steps.is_empty());

    let _ = fs::remove_dir_all(dir);
}

// -------------------------------------------------------------------------
// list_subjects
// -------------------------------------------------------------------------

#[test]
fn list_subjects_bids_direct_scans_project_root() {
    let root = unique_temp_path("list-bids-root");
    let perf = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), Some("bids".to_string()))
        .expect("list_subjects should succeed for BIDS-direct");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].subject_session, "sub-01_1");
    assert_eq!(subjects[0].session, "1");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_returns_empty_when_rawdata_missing() {
    let root = unique_temp_path("no-rawdata");
    fs::create_dir_all(&root).expect("test root should be created");

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert!(subjects.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_returns_subjects_with_sessions() {
    let root = unique_temp_path("list-subjects");
    let rawdata = root.join("rawdata");
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("anat")).unwrap();
    fs::write(
        rawdata
            .join("sub-001")
            .join("ses-01")
            .join("anat")
            .join("sub-001_ses-01_T1w.nii.gz"),
        b"fake",
    )
    .unwrap();
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("perf")).unwrap();
    fs::write(
        rawdata
            .join("sub-001")
            .join("ses-01")
            .join("perf")
            .join("sub-001_ses-01_asl.nii.gz"),
        b"fake",
    )
    .unwrap();
    fs::create_dir_all(rawdata.join("sub-002").join("ses-02")).unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 2);

    let sub001 = subjects.iter().find(|s| s.subject == "001").unwrap();
    assert_eq!(sub001.session, "01");
    assert_eq!(sub001.subject_session, "sub-001_01");
    assert!(sub001.has_structural);
    assert!(sub001.has_asl);

    let sub002 = subjects.iter().find(|s| s.subject == "002").unwrap();
    assert_eq!(sub002.session, "02");
    assert!(!sub002.has_structural);
    assert!(!sub002.has_asl);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_skips_non_sub_directories() {
    let root = unique_temp_path("list-skip");
    let rawdata = root.join("rawdata");
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01")).unwrap();
    fs::create_dir_all(rawdata.join("README")).unwrap();
    fs::create_dir_all(rawdata.join("dataset")).unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].subject, "001");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_cross_sectional_defaults_session_to_1() {
    let root = unique_temp_path("cross-sectional");
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    let sub01 = &subjects[0];
    assert_eq!(sub01.subject, "01");
    assert_eq!(sub01.session, "1");
    assert_eq!(sub01.subject_session, "sub-01_1");
    assert!(sub01.has_asl);
    assert_eq!(sub01.asl_runs, vec!["1"]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_parses_run_entities_from_filenames() {
    let root = unique_temp_path("run-entities");
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-2_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-2_asl.json"), b"{}").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-5_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-5_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["2", "5"]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_normalizes_zero_padded_bids_run_to_exploreasl_legacy() {
    let root = unique_temp_path("run-padded");
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["1"]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn list_subjects_normalizes_non_numeric_run_to_default() {
    let root = unique_temp_path("run-alpha");
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-pre_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-pre_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects[0].asl_runs, vec!["1"]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn normalize_asl_run_id_matches_exploreasl_str2num() {
    assert_eq!(normalize_asl_run_id("01"), "1");
    assert_eq!(normalize_asl_run_id("ASL_01"), "1");
    assert_eq!(normalize_asl_run_id("2"), "2");
    assert_eq!(normalize_asl_run_id(""), "1");
    assert_eq!(normalize_asl_run_id("pre"), "1");
    assert_eq!(normalize_asl_run_id_opt(None), "1");
}

#[test]
fn list_subjects_asl_run_default_when_no_run_entity() {
    let root = unique_temp_path("default-run");
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["1"]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn test_subject_info_serialization_casing() {
    let info = SubjectInfo {
        subject_session: "sub-001_01".to_string(),
        subject: "001".to_string(),
        session: "01".to_string(),
        has_structural: true,
        has_asl: true,
        asl_runs: vec!["1".to_string(), "2".to_string()],
    };
    let json = serde_json::to_string(&info).unwrap();
    assert!(json.contains(r#""hasASL":true"#));
    assert!(!json.contains(r#""hasAsl""#));
    assert!(json.contains(r#""subjectSession":"sub-001_01""#));
    assert!(json.contains(r#""aslRuns":["1","2"]"#));
}

// -------------------------------------------------------------------------
// determine_status
// -------------------------------------------------------------------------

#[test]
fn determine_status_returns_pending_when_no_status_files() {
    let dir = unique_temp_path("det-pending");
    fs::create_dir_all(&dir).unwrap();

    let (status, steps, locked) = determine_status(&dir);
    assert_eq!(status, "pending");
    assert!(steps.is_empty());
    assert!(!locked);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn determine_status_returns_complete_when_ready_file_exists() {
    let dir = unique_temp_path("det-complete");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, locked) = determine_status(&dir);
    assert_eq!(status, "complete");
    assert!(steps.contains(&"060_Segment_T1w".to_string()));
    assert!(!locked);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn determine_status_returns_incomplete_when_status_files_without_ready() {
    let dir = unique_temp_path("det-incomplete");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("070_SkullStrip_T1w.status"), "").unwrap();

    let (status, steps, locked) = determine_status(&dir);
    assert_eq!(status, "incomplete");
    assert_eq!(steps.len(), 2);
    assert!(!locked);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn determine_status_detects_locked_directory() {
    let dir = unique_temp_path("det-locked");
    fs::create_dir_all(dir.join("locked")).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();

    let (status, steps, locked) = determine_status(&dir);
    assert_eq!(status, "incomplete");
    assert!(locked);
    assert!(steps.contains(&"060_Segment_T1w".to_string()));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn determine_status_complete_overrides_locked() {
    let dir = unique_temp_path("det-complete-locked");
    fs::create_dir_all(dir.join("locked")).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, locked) = determine_status(&dir);
    assert_eq!(status, "complete");
    assert!(!locked);
    assert!(steps.contains(&"060_Segment_T1w".to_string()));
    assert!(!steps.contains(&"999_ready".to_string()));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn determine_status_returns_steps_in_sorted_order() {
    let dir = unique_temp_path("det-sorted");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("100_VisualQC_Structural.status"), "").unwrap();
    fs::write(dir.join("010_LinearReg_T1w2MNI.status"), "").unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("030_FLAIR_BiasfieldCorrection.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, _) = determine_status(&dir);
    assert_eq!(status, "complete");
    assert_eq!(
        steps,
        vec![
            "010_LinearReg_T1w2MNI",
            "030_FLAIR_BiasfieldCorrection",
            "060_Segment_T1w",
            "100_VisualQC_Structural",
        ]
    );

    let _ = fs::remove_dir_all(dir);
}

// -------------------------------------------------------------------------
// read_lock_status
// -------------------------------------------------------------------------

fn create_lock_tree(root: &Path) {
    let lock = root.join("derivatives").join("ExploreASL").join("lock");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    fs::write(struct_sub.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(struct_sub.join("999_ready.status"), "").unwrap();

    let asl_run = lock
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(asl_run.join("locked")).unwrap();
    fs::write(asl_run.join("ASL.status"), "").unwrap();

    let pop = lock
        .join("xASL_module_Population")
        .join("xASL_module_Population");
    fs::create_dir_all(&pop).unwrap();
    fs::write(pop.join("999_ready.status"), "").unwrap();
}

#[test]
fn read_lock_status_returns_empty_when_lock_dir_missing() {
    let root = unique_temp_path("no-lock");
    fs::create_dir_all(&root).unwrap();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    assert!(statuses.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn read_lock_status_parses_all_modules() {
    let root = unique_temp_path("lock-all-modules");
    create_lock_tree(&root);

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let structural = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_Structural")
        .expect("structural status should exist");
    assert_eq!(structural.subject_session, "sub-001_01");
    assert_eq!(structural.status, "complete");
    assert!(!structural.locked);

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL")
        .expect("asl status should exist");
    assert_eq!(asl.subject_session, "sub-001_01");
    assert_eq!(asl.status, "incomplete");
    assert!(asl.locked);
    assert_eq!(asl.run, Some("1".to_string()));

    let pop = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_Population")
        .expect("population status should exist");
    assert_eq!(pop.status, "complete");
    assert!(pop.subject_session.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn read_lock_status_detects_outdated_status() {
    let root = unique_temp_path("outdated-status");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    let struct_ready = struct_sub.join("999_ready.status");

    let asl_run = lock
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&asl_run).unwrap();
    let asl_ready = asl_run.join("999_ready.status");

    fs::write(&asl_ready, "").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(15));
    fs::write(&struct_ready, "").unwrap();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
        .expect("asl status should exist");
    assert_eq!(asl.status, "outdated");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn read_lock_status_detects_outdated_status_from_logs_only() {
    let root = unique_temp_path("outdated-status-logs");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    let struct_ready = struct_sub.join("999_ready.status");

    fs::create_dir_all(&log_dir).unwrap();
    let asl_log = log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log");
    fs::write(&asl_log, "success log with no issues").unwrap();

    std::thread::sleep(std::time::Duration::from_millis(15));
    fs::write(&struct_ready, "").unwrap();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
        .expect("asl status should exist");
    assert_eq!(asl.status, "outdated");
    assert_eq!(asl.run, Some("1".to_string()));

    let _ = fs::remove_dir_all(root);
}

// -------------------------------------------------------------------------
// clear_stale_lock_dirs
// -------------------------------------------------------------------------

#[test]
fn clear_stale_lock_dirs_removes_only_locked_subdirs_preserves_status_files() {
    let lock_root = unique_temp_path("clear-locked-only");
    let module_dir = lock_root
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(module_dir.join("locked")).unwrap();
    fs::write(module_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(module_dir.join("999_ready.status"), "").unwrap();

    let asl_module = lock_root
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(asl_module.join("locked")).unwrap();
    fs::write(asl_module.join("ASL.status"), "").unwrap();

    clear_stale_lock_dirs(&lock_root, &[true, false, false]).unwrap();

    assert!(!module_dir.join("locked").exists());
    assert!(module_dir.join("060_Segment_T1w.status").exists());
    assert!(module_dir.join("999_ready.status").exists());
    assert!(module_dir.exists());
    assert!(asl_module.join("locked").exists());
    assert!(asl_module.join("ASL.status").exists());

    let _ = fs::remove_dir_all(lock_root);
}

#[test]
fn clear_stale_lock_dirs_removes_locked_in_population_module() {
    let lock_root = unique_temp_path("clear-pop-locked");
    let pop_dir = lock_root
        .join("xASL_module_Population")
        .join("xASL_module_Population");
    fs::create_dir_all(pop_dir.join("locked")).unwrap();
    fs::write(pop_dir.join("999_ready.status"), "").unwrap();

    clear_stale_lock_dirs(&lock_root, &[false, false, true]).unwrap();

    assert!(!pop_dir.join("locked").exists());
    assert!(pop_dir.join("999_ready.status").exists());
    assert!(pop_dir.exists());

    let _ = fs::remove_dir_all(lock_root);
}

#[test]
fn clear_stale_lock_dirs_handles_nested_asl_runs() {
    let lock_root = unique_temp_path("clear-asl-locked");
    let run_dir = lock_root
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(run_dir.join("locked")).unwrap();
    fs::write(run_dir.join("ASL.status"), "").unwrap();

    clear_stale_lock_dirs(&lock_root, &[false, true, false]).unwrap();

    assert!(!run_dir.join("locked").exists());
    assert!(run_dir.join("ASL.status").exists());

    let _ = fs::remove_dir_all(lock_root);
}

// -------------------------------------------------------------------------
// delete_status_files_for_modules
// -------------------------------------------------------------------------

#[test]
fn delete_status_files_removes_only_status_files_in_matching_subjects() {
    let root = unique_temp_path("del-status");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");
    let module_dir = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&module_dir).unwrap();
    fs::write(module_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(module_dir.join("999_ready.status"), "").unwrap();
    fs::write(module_dir.join("keep.txt"), "data").unwrap();

    delete_status_files_for_modules(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(!module_dir.join("060_Segment_T1w.status").exists());
    assert!(!module_dir.join("999_ready.status").exists());
    assert!(module_dir.join("keep.txt").exists());

    let _ = fs::remove_dir_all(root);
}

// -------------------------------------------------------------------------
// ProcessState defaults for watcher_stop
// -------------------------------------------------------------------------

#[test]
fn process_state_default_has_no_watcher_stop() {
    let state = ProcessState::default();
    assert!(state.watcher_stop.is_none());
    assert!(state.watcher_handle.is_none());
}

// -------------------------------------------------------------------------
// EventKind matching
// -------------------------------------------------------------------------

#[test]
fn parse_lock_path_works_regardless_of_create_kind() {
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
}

#[test]
fn delete_status_files_respects_subject_regexp_filter() {
    let root = unique_temp_path("del-regexp");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");

    let dir_001 = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&dir_001).unwrap();
    fs::write(dir_001.join("step.status"), "").unwrap();

    let dir_002 = lock
        .join("xASL_module_Structural")
        .join("sub-002_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&dir_002).unwrap();
    fs::write(dir_002.join("step.status"), "").unwrap();

    delete_status_files_for_modules(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(!dir_001.join("step.status").exists());
    assert!(dir_002.join("step.status").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_status_files_removes_asl_status_files() {
    let root = unique_temp_path("del-asl-status");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");
    let run_dir = lock
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&run_dir).unwrap();
    fs::write(run_dir.join("020_RealignASL.status"), "").unwrap();
    fs::write(run_dir.join("999_ready.status"), "").unwrap();
    fs::write(run_dir.join("keep.txt"), "data").unwrap();

    delete_status_files_for_modules(&root, &[false, true, false], "^sub-001_01$").unwrap();

    assert!(!run_dir.join("020_RealignASL.status").exists());
    assert!(!run_dir.join("999_ready.status").exists());
    assert!(run_dir.join("keep.txt").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_status_files_removes_population_status_files() {
    let root = unique_temp_path("del-pop-status");
    let lock = root.join("derivatives").join("ExploreASL").join("lock");
    let pop_dir = lock
        .join("xASL_module_Population")
        .join("xASL_module_Population");
    fs::create_dir_all(&pop_dir).unwrap();
    fs::write(pop_dir.join("010_CreatePopulationTemplates.status"), "").unwrap();
    fs::write(pop_dir.join("999_ready.status"), "").unwrap();
    fs::write(pop_dir.join("keep.txt"), "data").unwrap();

    delete_status_files_for_modules(&root, &[false, false, true], "^sub-.*$").unwrap();

    assert!(
        !pop_dir
            .join("010_CreatePopulationTemplates.status")
            .exists()
    );
    assert!(!pop_dir.join("999_ready.status").exists());
    assert!(pop_dir.join("keep.txt").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_bids2legacy_locks_removes_only_matching_subjects() {
    let root = unique_temp_path("del-bids2legacy");
    let bids2legacy_dir = root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_BIDS2Legacy");

    let sub1_dir = bids2legacy_dir.join("sub-001_01");
    let sub2_dir = bids2legacy_dir.join("sub-002_01");

    fs::create_dir_all(&sub1_dir).unwrap();
    fs::create_dir_all(&sub2_dir).unwrap();

    fs::write(sub1_dir.join("010_BIDS2LEGACY.status"), "").unwrap();
    fs::write(sub2_dir.join("010_BIDS2LEGACY.status"), "").unwrap();

    delete_bids2legacy_locks(&root, "^(sub-001_01)$").unwrap();

    assert!(!sub1_dir.exists());
    assert!(sub2_dir.exists());
    assert!(sub2_dir.join("010_BIDS2LEGACY.status").exists());

    let _ = fs::remove_dir_all(root);
}

// -------------------------------------------------------------------------
// delete_module_log_files
// -------------------------------------------------------------------------

#[test]
fn delete_module_log_files_removes_structural_log_for_matching_subject() {
    let root = unique_temp_path("del-log-structural");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("xASL_module_Structural_sub-001_01.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_Structural_sub-002_01.log"),
        "old log",
    )
    .unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_removes_all_asl_runs_for_matching_subject() {
    let root = unique_temp_path("del-log-asl-runs");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-001_01_ASL_2.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-002_01_ASL_1.log"),
        "old log",
    )
    .unwrap();

    delete_module_log_files(&root, &[false, true, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists()
    );
    assert!(
        !log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_2.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_ASL_sub-002_01_ASL_1.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_respects_subject_regexp_filter() {
    let root = unique_temp_path("del-log-regexp");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-002_01.log"), "old").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_preserves_non_log_files() {
    let root = unique_temp_path("del-log-nonlog");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("bids_report_sub-001_ses-01.json"), "{}").unwrap();
    fs::write(log_dir.join("import_summary_sub-001.csv"), "csv").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(log_dir.join("bids_report_sub-001_ses-01.json").exists());
    assert!(log_dir.join("import_summary_sub-001.csv").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_skips_disabled_modules() {
    let root = unique_temp_path("del-log-skip");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"), "old").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_handles_missing_log_dir() {
    let root = unique_temp_path("del-log-missing");

    let result = delete_module_log_files(&root, &[true, false, false], "^sub-001_01$");

    assert!(result.is_ok());

    let _ = fs::remove_dir_all(root);
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

#[test]
fn delete_module_log_files_deletes_population_log() {
    let root = unique_temp_path("del-log-pop");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Population.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();

    delete_module_log_files(&root, &[false, false, true], "^sub-001_01$").unwrap();

    assert!(!log_dir.join("xASL_module_Population.log").exists());
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
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

// -------------------------------------------------------------------------
// list_module_logs / read_module_logs
// -------------------------------------------------------------------------

#[test]
fn list_module_logs_finds_import_logs_in_staging_when_project_log_dir_missing() {
    let root = unique_temp_path("import-staging-logs");
    let staging_log = root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&staging_log).unwrap();
    fs::write(
        staging_log.join("xASL_module_Import_sub-001Philips.log"),
        "ExploreASL import output",
    )
    .unwrap();

    let logs = list_module_logs(root.to_string_lossy().to_string())
        .expect("list_module_logs should succeed");

    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].module, "import");
    assert_eq!(logs[0].subject_session, "sub-001Philips");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn read_module_logs_reads_import_logs_from_staging() {
    let root = unique_temp_path("read-import-staging-logs");
    let staging_log = root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&staging_log).unwrap();
    fs::write(
        staging_log.join("xASL_module_Import_sub-001Philips.log"),
        "import log body",
    )
    .unwrap();

    let content = read_module_logs(
        root.to_string_lossy().to_string(),
        "sub-001Philips".to_string(),
        "import".to_string(),
    )
    .expect("read_module_logs should succeed");

    assert_eq!(
        content["xASL_module_Import_sub-001Philips.log"],
        "import log body"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn test_list_subject_reports_and_read_report_image() {
    let root = unique_temp_path("test-qc-reports");
    let derivatives = root
        .join("derivatives")
        .join("ExploreASL")
        .join("Population");

    let t1_dir = derivatives.join("T1Check");
    let asl_dir = derivatives.join("ASLCheck");
    let m0_dir = derivatives.join("M0Reg_ASL");

    fs::create_dir_all(&t1_dir).unwrap();
    fs::create_dir_all(&asl_dir).unwrap();
    fs::create_dir_all(&m0_dir).unwrap();

    fs::write(
        t1_dir.join("Tra_Seg_rT1_sub-001Philips_01_rc2T1_sub-001Philips_01.jpg"),
        b"structural_axial_bytes",
    )
    .unwrap();
    fs::write(
        t1_dir.join("Cor_Seg_rT1_sub-001Philips_01_rc2T1_sub-001Philips_01.jpg"),
        b"structural_coronal_bytes",
    )
    .unwrap();

    fs::write(
        asl_dir.join("Tra_Reg_qCBF_sub-001Philips_01_ASL_1_PV_pWM_sub-001Philips_01_Contour.jpg"),
        b"asl_run1_axial_bytes",
    )
    .unwrap();
    fs::write(
        asl_dir.join("Cor_Reg_qCBF_sub-001Philips_01_ASL_1_PV_pWM_sub-001Philips_01_Contour.jpg"),
        b"asl_run1_coronal_bytes",
    )
    .unwrap();

    fs::write(
        m0_dir.join(
            "Tra_Reg_noSmooth_M0_sub-001Philips_01_ASL_1_PV_pGM_sub-001Philips_01_Contour.jpg",
        ),
        b"m0_run1_axial_bytes",
    )
    .unwrap();
    fs::write(
        m0_dir.join(
            "Cor_Reg_noSmooth_M0_sub-001Philips_01_ASL_1_PV_pGM_sub-001Philips_01_Contour.jpg",
        ),
        b"m0_run1_coronal_bytes",
    )
    .unwrap();

    let list = list_subject_reports(root.to_string_lossy().to_string())
        .expect("list_subject_reports should succeed");

    assert_eq!(list.len(), 3);

    let struct_entry = list.iter().find(|x| x.module == "structural").unwrap();
    assert_eq!(struct_entry.subject_session, "sub-001Philips_01");
    assert_eq!(struct_entry.run, None);

    let asl_entry = list.iter().find(|x| x.module == "asl").unwrap();
    assert_eq!(asl_entry.subject_session, "sub-001Philips_01");
    assert_eq!(asl_entry.run, Some("1".to_string()));

    let m0_entry = list.iter().find(|x| x.module == "m0").unwrap();
    assert_eq!(m0_entry.subject_session, "sub-001Philips_01");
    assert_eq!(m0_entry.run, Some("1".to_string()));

    let img_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "axial".to_string(),
    )
    .expect("read structural axial should succeed");
    assert_eq!(img_bytes, b"structural_axial_bytes");

    let img_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "coronal".to_string(),
    )
    .expect("read structural coronal should succeed");
    assert_eq!(img_bytes_cor, b"structural_coronal_bytes");

    let asl_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "asl".to_string(),
        Some("1".to_string()),
        "axial".to_string(),
    )
    .expect("read asl axial should succeed");
    assert_eq!(asl_bytes, b"asl_run1_axial_bytes");

    let asl_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "asl".to_string(),
        Some("1".to_string()),
        "coronal".to_string(),
    )
    .expect("read asl coronal should succeed");
    assert_eq!(asl_bytes_cor, b"asl_run1_coronal_bytes");

    let m0_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "m0".to_string(),
        Some("1".to_string()),
        "axial".to_string(),
    )
    .expect("read m0 axial should succeed");
    assert_eq!(m0_bytes, b"m0_run1_axial_bytes");

    let m0_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "m0".to_string(),
        Some("1".to_string()),
        "coronal".to_string(),
    )
    .expect("read m0 coronal should succeed");
    assert_eq!(m0_bytes_cor, b"m0_run1_coronal_bytes");

    let err = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-nonexistent_01".to_string(),
        "structural".to_string(),
        None,
        "axial".to_string(),
    );
    assert!(err.is_err());
    assert!(err.unwrap_err().contains("Report image not found"));

    let err_view = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "sagittal".to_string(),
    );
    assert!(err_view.is_err());
    assert!(err_view.unwrap_err().contains("Unknown view type"));

    let _ = fs::remove_dir_all(root);
}
