use super::common::*;
use crate::processing::runs::{
    attach_run_impl, completed_population_run_root, fail_processing_run_impl,
    finalize_processing_run_impl, finalizing_run_root, get_active_run_impl, preparing_run_root,
    record_worker_exit, reserve_processing_run_impl,
};
use crate::processing::types::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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

// -------------------------------------------------------------------------
// ProcessState defaults for watcher_stop
// -------------------------------------------------------------------------

#[test]
fn process_state_default_has_no_watcher_stop() {
    let state = ProcessState::default();
    assert!(state.watcher_stop.is_none());
    assert!(state.watcher_handle.is_none());
}
