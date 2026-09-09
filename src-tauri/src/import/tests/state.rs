use crate::app_state::AppState;
use crate::import::journal::record_path;
use crate::import::relocation;
use crate::import::staging::STAGING_DIRECTORY;
use crate::import::state::{
    acknowledge_import_run_for_state, admit_reserved_import_launch, attach_import_run_for_state,
    get_active_import_run_for_state, persist, plan_import_relocation_for_state,
    reserve_import_run_for_state,
};
use crate::import::types::{ImportExitEvidence, ImportLifecycle, ImportTerminalResult};
use std::fs;
use std::path::{Path, PathBuf};

fn active_state(root: &Path) -> AppState {
    let state = AppState::default();
    *state.active_project_root.lock().unwrap() = Some(root.to_path_buf());
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
    *state.active_project_root.lock().unwrap() = Some(project_b.path().canonicalize().unwrap());

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
