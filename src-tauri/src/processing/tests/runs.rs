use super::common::*;
use crate::processing::runs::{attach_run_impl, get_active_run_impl, reserve_processing_run_impl};
use crate::processing::types::*;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[test]
fn processing_lifecycle_transition_table_enforces_protocol() {
    use ProcessingLifecycle::*;

    let legal = [
        (Preparing, Running),
        (Preparing, Cancelling),
        (Preparing, Failed),
        (Preparing, Interrupted),
        (Running, Finalizing),
        (Running, Cancelling),
        (Running, Failed),
        (Running, Interrupted),
        (Cancelling, Cancelled),
        (Cancelling, Failed),
        (Cancelling, Interrupted),
        (Finalizing, Completed),
        (Finalizing, Failed),
        (Finalizing, Cancelling),
        (Finalizing, Interrupted),
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
    assert!(json.get("workers").is_none());
    assert!(json.get("exitEvidence").is_none());
    assert!(json.get("watcherOwned").is_none());
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

    let no_active = crate::app::state::AppState::default();
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
fn matching_run_for_active_project_rejects_stale_identity_before_mutation() {
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

    state
        .processing_state
        .lock()
        .unwrap()
        .current_run
        .as_mut()
        .unwrap()
        .lifecycle = ProcessingLifecycle::Finalizing;
    assert_eq!(
        crate::processing::runs::matching_run_for_active_project(&state, &reserved.run_id)
            .unwrap()
            .1,
        root.canonicalize().unwrap()
    );
    crate::project::ownership_tests::own_project(&state, &other_root.canonicalize().unwrap());
    assert!(
        crate::processing::runs::matching_run_for_active_project(&state, &reserved.run_id).is_err()
    );
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), "unchanged");
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
    }
    assert_eq!(
        attach_run_impl(&state, &reserved.run_id).unwrap().lifecycle,
        ProcessingLifecycle::Running
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

    crate::project::ownership_tests::own_project(&state, &other_root.canonicalize().unwrap());
    assert!(get_active_run_impl(&state).unwrap().is_none());
    assert!(attach_run_impl(&state, &reserved.run_id).is_err());
}

#[test]
fn process_state_default_has_no_watcher_stop() {
    let state = ProcessState::default();
    assert!(state.watcher_stop.is_none());
    assert!(state.watcher_handle.is_none());
}
