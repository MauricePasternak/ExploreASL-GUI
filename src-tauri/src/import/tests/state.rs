use crate::app_state::AppState;
use crate::import::journal::{
    RecordFaultPoint, exact_record_is_visible, inject_fault, load_record, record_from_state,
    record_path, write_record,
};
use crate::import::relocation;
use crate::import::staging::STAGING_DIRECTORY;
use crate::import::state::{
    acknowledge_import_run_for_state, admit_reserved_import_launch, attach_import_run_for_state,
    get_active_import_run_for_state, persist, plan_import_relocation_for_state,
    reserve_import_run_for_state,
};
use crate::import::types::{
    ImportExitEvidence, ImportLifecycle, ImportState, ImportTerminalResult,
};
use std::fs;
use std::path::{Path, PathBuf};

fn active_state(root: &Path) -> AppState {
    let state = AppState::default();
    crate::project_ownership_tests::own_project(&state, root);
    state
}

#[test]
fn reservation_is_mutation_free_and_blocks_duplicate_or_changed_scope() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id.clone(),
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    assert_eq!(snapshot.lifecycle, ImportLifecycle::Preparing);
    assert!(!temp.path().join(STAGING_DIRECTORY).exists());
    assert!(record_path(temp.path()).is_file());

    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id,
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_err()
    );
    assert_eq!(
        get_active_import_run_for_state(&state)
            .unwrap()
            .unwrap()
            .run_id,
        snapshot.run_id
    );
    assert_eq!(
        attach_import_run_for_state(&state, &snapshot.run_id)
            .unwrap()
            .selected_subjects,
        vec!["ONE"]
    );
    assert!(attach_import_run_for_state(&state, "obsolete").is_err());
}

#[test]
fn reservation_rename_failure_leaves_idle_authority_and_allows_retry() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    inject_fault(RecordFaultPoint::Rename);

    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id.clone(),
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_err()
    );
    assert_eq!(
        state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Idle
    );
    assert!(get_active_import_run_for_state(&state).unwrap().is_none());
    assert!(!record_path(temp.path()).exists());
    assert!(!temp.path().join(STAGING_DIRECTORY).exists());

    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id,
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_ok()
    );
}

#[test]
fn reservation_parent_sync_failure_retains_uncertain_ownership_and_recovers_interrupted() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    inject_fault(RecordFaultPoint::ParentSync);

    let error = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id.clone(),
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap_err();
    assert!(error.to_string().contains("durability uncertain"));
    assert!(error.to_string().contains("ownership retained"));

    let visible = load_record(temp.path()).unwrap().unwrap();
    let live = state.import_state.lock().unwrap();
    let mut expected = record_from_state(&live).unwrap();
    expected.snapshot.error = None;
    assert_eq!(
        serde_json::to_value(&visible).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert_eq!(visible.snapshot.lifecycle, ImportLifecycle::Preparing);
    assert_eq!(visible.snapshot.error, None);
    assert_eq!(live.run_id, visible.snapshot.run_id);
    assert_eq!(
        live.ownership_generation,
        visible.snapshot.ownership_generation
    );
    assert_eq!(live.project_root, temp.path());
    assert_eq!(live.subject_list, visible.snapshot.selected_subjects);
    assert_eq!(live.profile_id, visible.snapshot.profile_id);
    assert_eq!(
        serde_json::to_value(&live.relocation_plan).unwrap(),
        serde_json::to_value(&visible.relocation_plan).unwrap()
    );
    assert_eq!(
        live.error.as_ref().map(|error| error.code.as_str()),
        Some("reservation_durability_uncertain")
    );
    assert!(!crate::import::pipeline::should_stop_import_for_exit(&live));
    let run_id = live.run_id.clone();
    drop(live);

    let record_before = fs::read(record_path(temp.path())).unwrap();
    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id.clone(),
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_err()
    );
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);

    let launch_error = crate::import::commands::settle_launch_result(
        &state,
        &run_id,
        Err(crate::import::types::ImportCommandError::Operational {
            message: "launch stayed blocked".to_string(),
        }),
    )
    .unwrap_err();
    assert_eq!(launch_error.to_string(), "launch stayed blocked");
    assert_eq!(
        state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Preparing
    );
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);

    let admission_error = admit_reserved_import_launch(
        &state,
        &run_id,
        &temp.path().join(STAGING_DIRECTORY),
        temp.path(),
        &["ONE".to_string()],
        &plan.plan_id,
        "profile-1",
    )
    .unwrap_err();
    assert!(admission_error.to_string().contains("durability uncertain"));
    assert!(crate::import::stop_import_run_for_state(&state, &run_id).is_err());
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);
    assert!(acknowledge_import_run_for_state(&state, &run_id).is_err());
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);
    assert!(!temp.path().join(STAGING_DIRECTORY).exists());

    let recovered_state = active_state(temp.path());
    let recovered =
        crate::import::state::recover_import_run_for_project(&recovered_state, temp.path())
            .unwrap()
            .unwrap();
    assert_eq!(recovered.run_id, run_id);
    assert_eq!(recovered.lifecycle, ImportLifecycle::Interrupted);
    assert!(recovered.confirmation_required);
}

#[test]
fn exact_visibility_rejects_conflicting_valid_record_without_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    let expected = load_record(temp.path()).unwrap().unwrap();
    let mut conflicting = expected.clone();
    conflicting.snapshot.profile_id = "profile-2".to_string();
    write_record(temp.path(), &conflicting).unwrap();
    let visible_bytes = fs::read(record_path(temp.path())).unwrap();

    assert!(exact_record_is_visible(temp.path(), &expected).is_err());
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), visible_bytes);
}

#[test]
fn unacknowledged_terminal_run_reserves_exclusive_authority_without_any_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let first = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    {
        let mut run = state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Interrupted;
        run.terminal_result = Some(ImportTerminalResult::Interrupted);
        persist(&run).unwrap();
    }
    let record_before = fs::read(record_path(temp.path())).unwrap();
    let entries_before = walk_relative(temp.path());
    let replacement_plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();

    let error = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        replacement_plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap_err();

    assert!(error.to_string().contains("non-acknowledged"));
    assert_eq!(state.import_state.lock().unwrap().run_id, first.run_id);
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);
    assert_eq!(walk_relative(temp.path()), entries_before);
}

fn walk_relative(root: &Path) -> Vec<PathBuf> {
    fn visit(root: &Path, path: &Path, entries: &mut Vec<PathBuf>) {
        let Ok(children) = fs::read_dir(path) else {
            return;
        };
        for child in children {
            let child = child.unwrap().path();
            entries.push(child.strip_prefix(root).unwrap().to_path_buf());
            if child.is_dir() {
                visit(root, &child, entries);
            }
        }
    }
    let mut entries = Vec::new();
    visit(root, root, &mut entries);
    entries.sort();
    entries
}

#[test]
fn attachment_is_read_only_for_every_visible_lifecycle_and_rejects_foreign_or_retired_runs() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();

    for lifecycle in [
        ImportLifecycle::Preparing,
        ImportLifecycle::Running,
        ImportLifecycle::Finalizing,
        ImportLifecycle::Cancelling,
        ImportLifecycle::Completed,
        ImportLifecycle::Failed,
        ImportLifecycle::Cancelled,
        ImportLifecycle::Interrupted,
    ] {
        {
            let mut run = state.import_state.lock().unwrap();
            run.lifecycle = lifecycle;
            run.terminal_result = lifecycle.is_terminal().then(|| match lifecycle {
                ImportLifecycle::Completed => ImportTerminalResult::Completed,
                ImportLifecycle::Failed => ImportTerminalResult::Failed,
                ImportLifecycle::Cancelled => ImportTerminalResult::Cancelled,
                ImportLifecycle::Interrupted => ImportTerminalResult::Interrupted,
                _ => unreachable!("guarded terminal lifecycle"),
            });
            if lifecycle == ImportLifecycle::Finalizing {
                run.exit_evidence = Some(ImportExitEvidence {
                    exit_code: 0,
                    successful: true,
                });
            }
        }
        let before = state.import_state.lock().unwrap().snapshot();
        assert_eq!(
            attach_import_run_for_state(&state, &snapshot.run_id).unwrap(),
            before
        );
        assert_eq!(
            get_active_import_run_for_state(&state).unwrap(),
            Some(before)
        );
    }
    {
        let mut run = state.import_state.lock().unwrap();
        run.acknowledged = true;
    }
    assert!(get_active_import_run_for_state(&state).unwrap().is_none());
    assert!(attach_import_run_for_state(&state, &snapshot.run_id).is_err());
    assert!(attach_import_run_for_state(&state, "foreign-run").is_err());
}

#[test]
fn discovery_and_attachment_distinguish_absent_and_true_foreign_project_ownership() {
    let project_a = tempfile::tempdir().unwrap();
    let project_b = tempfile::tempdir().unwrap();
    let state = active_state(project_a.path());
    assert_eq!(get_active_import_run_for_state(&state).unwrap(), None);
    assert!(attach_import_run_for_state(&state, "missing").is_err());

    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    crate::project_ownership_tests::own_project(&state, &project_b.path().canonicalize().unwrap());

    assert_eq!(get_active_import_run_for_state(&state).unwrap(), None);
    assert!(attach_import_run_for_state(&state, &snapshot.run_id).is_err());
    assert_eq!(
        state.import_state.lock().unwrap().project_root,
        project_a.path()
    );
    assert!(!record_path(project_b.path()).exists());
}

#[test]
fn concurrent_reservation_admission_is_single_winner_and_rejection_is_filesystem_free() {
    use std::sync::{Arc, Barrier};

    let temp = tempfile::tempdir().unwrap();
    let state = Arc::new(active_state(temp.path()));
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let state = state.clone();
        let barrier = barrier.clone();
        let plan_id = plan.plan_id.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            reserve_import_run_for_state(
                &state,
                vec!["ONE".to_string()],
                plan_id,
                "profile-1".to_string(),
                Vec::new(),
                false,
            )
        }));
    }
    barrier.wait();
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    assert!(!temp.path().join(STAGING_DIRECTORY).exists());
    let admitted = results.into_iter().find_map(Result::ok).unwrap();
    assert_eq!(
        get_active_import_run_for_state(&state)
            .unwrap()
            .unwrap()
            .run_id,
        admitted.run_id
    );
}

#[test]
fn launch_admission_is_one_shot_and_rejects_changed_or_foreign_scope_without_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id.clone(),
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    let staging = temp.path().join(STAGING_DIRECTORY);
    assert!(
        admit_reserved_import_launch(
            &state,
            &snapshot.run_id,
            &staging,
            temp.path(),
            &["ONE".to_string()],
            &plan.plan_id,
            "different-profile",
        )
        .is_err()
    );
    assert!(
        admit_reserved_import_launch(
            &state,
            &snapshot.run_id,
            &staging,
            temp.path(),
            &["ONE".to_string()],
            &plan.plan_id,
            "profile-1",
        )
        .is_ok()
    );
    let record_before = fs::read(record_path(temp.path())).unwrap();
    for (root, subjects) in [
        (temp.path(), vec!["TWO".to_string()]),
        (foreign.path(), vec!["ONE".to_string()]),
    ] {
        assert!(
            admit_reserved_import_launch(
                &state,
                &snapshot.run_id,
                &root.join(STAGING_DIRECTORY),
                root,
                &subjects,
                &plan.plan_id,
                "profile-1",
            )
            .is_err()
        );
    }
    // The repeated exact request is also rejected and no staging/project
    // filesystem mutation has occurred beyond the durable reservation.
    assert!(
        admit_reserved_import_launch(
            &state,
            &snapshot.run_id,
            &staging,
            temp.path(),
            &["ONE".to_string()],
            &plan.plan_id,
            "profile-1",
        )
        .is_err()
    );
    assert_eq!(fs::read(record_path(temp.path())).unwrap(), record_before);
    assert!(!staging.exists());
}

#[test]
fn acknowledgement_is_terminal_exact_idempotent_and_required_for_replacement() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    assert!(acknowledge_import_run_for_state(&state, &snapshot.run_id).is_err());
    assert!(acknowledge_import_run_for_state(&state, "stale").is_err());
    {
        let mut run = state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Interrupted;
        run.terminal_result = Some(ImportTerminalResult::Interrupted);
        persist(&run).unwrap();
    }
    acknowledge_import_run_for_state(&state, &snapshot.run_id).unwrap();
    acknowledge_import_run_for_state(&state, &snapshot.run_id).unwrap();
    assert!(get_active_import_run_for_state(&state).unwrap().is_none());
    assert!(!record_path(temp.path()).exists());

    let next = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            next.plan_id,
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_ok()
    );
}

#[test]
fn unresolved_relocation_evidence_blocks_acknowledgement() {
    let temp = tempfile::tempdir().unwrap();
    let state = active_state(temp.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
    let snapshot = reserve_import_run_for_state(
        &state,
        vec!["ONE".to_string()],
        plan.plan_id,
        "profile-1".to_string(),
        Vec::new(),
        false,
    )
    .unwrap();
    {
        let mut run = state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Failed;
        run.terminal_result = Some(ImportTerminalResult::Failed);
        persist(&run).unwrap();
    }
    fs::write(temp.path().join(relocation::JOURNAL_FILE), "recovery").unwrap();
    assert!(acknowledge_import_run_for_state(&state, &snapshot.run_id).is_err());
    assert_eq!(
        get_active_import_run_for_state(&state)
            .unwrap()
            .unwrap()
            .run_id,
        snapshot.run_id
    );
}

fn cross_workflow_admission(import_first: bool) {
    for phase in 0..4 {
        let root = tempfile::tempdir().unwrap();
        let state = active_state(root.path());
        let plan = plan_import_relocation_for_state(&state, &["ONE".to_string()]).unwrap();
        let reserve_import = || {
            reserve_import_run_for_state(
                &state,
                vec!["ONE".into()],
                plan.plan_id.clone(),
                "profile".into(),
                vec![],
                false,
            )
        };
        let reserve_processing = || {
            crate::processing::runs::reserve_processing_run_impl(&state, vec!["asl".into()], vec![])
        };
        if import_first {
            reserve_import().unwrap();
            state.import_state.lock().unwrap().lifecycle = [
                ImportLifecycle::Preparing,
                ImportLifecycle::Running,
                ImportLifecycle::Finalizing,
                ImportLifecycle::Cancelling,
            ][phase];
            assert!(
                reserve_processing().is_err(),
                "processing must reject import ownership"
            );
        } else {
            reserve_processing().unwrap();
            use crate::processing::ProcessingLifecycle;
            state
                .processing_state
                .lock()
                .unwrap()
                .current_run
                .as_mut()
                .unwrap()
                .lifecycle = [
                ProcessingLifecycle::Preparing,
                ProcessingLifecycle::Running,
                ProcessingLifecycle::Finalizing,
                ProcessingLifecycle::Cancelling,
            ][phase];
            assert!(
                reserve_import().is_err(),
                "import must reject processing ownership"
            );
        }
    }
}

#[test]
fn processing_admission_rejects_import_execution_phases() {
    cross_workflow_admission(true);
}
#[test]
fn import_admission_rejects_processing_execution_phases() {
    cross_workflow_admission(false);
}

#[test]
fn import_admission_requires_held_native_ownership() {
    let root = tempfile::tempdir().unwrap();
    let state = active_state(root.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".into()]).unwrap();
    state.active_project.lock().unwrap().take();
    assert!(
        reserve_import_run_for_state(
            &state,
            vec!["ONE".into()],
            plan.plan_id,
            "profile".into(),
            vec![],
            false
        )
        .is_err()
    );
    assert!(!record_path(root.path()).exists());
}

#[test]
fn concurrent_import_processing_admission_has_one_winner() {
    let root = tempfile::tempdir().unwrap();
    let state = active_state(root.path());
    let plan = plan_import_relocation_for_state(&state, &["ONE".into()]).unwrap();
    let barrier = std::sync::Barrier::new(2);
    let (import, processing) = std::thread::scope(|scope| {
        let import = scope.spawn(|| {
            barrier.wait();
            reserve_import_run_for_state(
                &state,
                vec!["ONE".into()],
                plan.plan_id,
                "profile".into(),
                vec![],
                false,
            )
        });
        let processing = scope.spawn(|| {
            barrier.wait();
            crate::processing::runs::reserve_processing_run_impl(&state, vec!["asl".into()], vec![])
        });
        (import.join().unwrap(), processing.join().unwrap())
    });
    assert_ne!(import.is_ok(), processing.is_ok());
}

#[test]
fn interruption_confirmation_is_exact_and_rolls_back_when_persistence_fails() {
    let root = tempfile::tempdir().unwrap();
    let state = active_state(root.path());
    let mut run = ImportState::new(
        root.path().join(".easl_staging"),
        root.path().to_path_buf(),
        vec!["ONE".into()],
    );
    run.run_id = "import-run-interrupted".into();
    run.profile_id = "profile".into();
    run.lifecycle = ImportLifecycle::Interrupted;
    run.terminal_result = Some(crate::import::ImportTerminalResult::Interrupted);
    run.confirmation_required = true;
    crate::import::journal::write_record(
        root.path(),
        &crate::import::journal::record_from_state(&run).unwrap(),
    )
    .unwrap();
    *state.import_state.lock().unwrap() = run;

    assert!(
        crate::import::state::confirm_import_worker_stopped_for_state(&state, "stale").is_err()
    );
    crate::import::journal::fail_next_record_write();
    assert!(
        crate::import::state::confirm_import_worker_stopped_for_state(
            &state,
            "import-run-interrupted"
        )
        .is_err()
    );
    assert!(state.import_state.lock().unwrap().confirmation_required);

    let confirmed = crate::import::state::confirm_import_worker_stopped_for_state(
        &state,
        "import-run-interrupted",
    )
    .unwrap();
    assert!(!confirmed.confirmation_required);
    assert!(
        crate::import::state::confirm_import_worker_stopped_for_state(
            &state,
            "import-run-interrupted"
        )
        .is_err()
    );
}
