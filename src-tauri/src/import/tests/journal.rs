use crate::import::journal::{
    ImportRunRecord, RecordFaultPoint, checkpoint_relocation_outcome, fail_next_record_removal,
    inject_fault, load_record, record_from_state, record_path, remove_record,
    swap_record_parent_before_publish, validate_record, validate_relocation_recovery_authority,
    write_record,
};
use crate::import::relocation::{
    RelocationEntry, RelocationEntryKind, RelocationOutcome, RelocationPlan,
    RelocationSubjectStatus, SubjectInventory, SubjectRelocationOutcome, project_identity,
};
use crate::import::{
    ImportExitEvidence, ImportLifecycle, ImportState, ImportSubjectOutcome,
    ImportSubjectOutcomeKind,
};
use std::fs;
use std::path::Path;

fn run(root: &Path) -> ImportState {
    let mut run = ImportState::new(
        root.join(".easl_staging"),
        root.to_path_buf(),
        vec!["ONE".to_string()],
    );
    run.run_id = "import-run-1".to_string();
    run.profile_id = "profile-1".to_string();
    run.ownership_generation = 7;
    run.lifecycle = ImportLifecycle::Preparing;
    run
}

#[test]
fn record_round_trip_is_strict_relative_and_path_free() {
    let temp = tempfile::tempdir().unwrap();
    let record = record_from_state(&run(temp.path())).unwrap();
    write_record(temp.path(), &record).unwrap();
    assert_eq!(
        load_record(temp.path()).unwrap().unwrap().snapshot.run_id,
        "import-run-1"
    );
    let encoded = serde_json::to_string(&record).unwrap();
    assert!(!encoded.contains(&temp.path().display().to_string()));
    let malformed = encoded.trim_end_matches('}').to_string() + ",\"unknown\":true}";
    assert!(serde_json::from_str::<ImportRunRecord>(&malformed).is_err());

    let mut nested: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    nested["snapshot"]["unknownAuthority"] = serde_json::json!(true);
    assert!(serde_json::from_value::<ImportRunRecord>(nested).is_err());
}

#[test]
fn guardian_bound_experimental_record_is_rejected_but_released_field_absent_record_loads() {
    let temp = tempfile::tempdir().unwrap();
    let released = record_from_state(&run(temp.path())).unwrap();
    let mut guardian_bound = serde_json::to_value(&released).unwrap();
    guardian_bound["containment"] = serde_json::json!({"legacy": true});
    guardian_bound["snapshot"]
        .as_object_mut()
        .unwrap()
        .remove("confirmationRequired");
    let bytes = serde_json::to_vec_pretty(&guardian_bound).unwrap();
    let path = record_path(temp.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, &bytes).unwrap();

    let error = load_record(temp.path()).unwrap_err().to_string();
    assert!(error.contains("compatible checkpoint build"));
    assert_eq!(fs::read(&path).unwrap(), bytes);

    let mut released_value = serde_json::to_value(&released).unwrap();
    released_value["snapshot"]
        .as_object_mut()
        .unwrap()
        .remove("confirmationRequired");
    fs::write(&path, serde_json::to_vec_pretty(&released_value).unwrap()).unwrap();
    assert!(load_record(temp.path()).unwrap().is_some());
    assert!(validate_record(&released, temp.path()).is_ok());
}

#[test]
fn record_round_trip_preserves_all_recovery_checkpoints_and_rejects_each_authority_violation() {
    let temp = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(temp.path());
    record.preserved_subjects = vec!["TWO".to_string()];
    record.snapshot.relocation_outcome = Some(committed_outcome());
    record.snapshot.lifecycle = ImportLifecycle::Completed;
    record.snapshot.terminal_result = Some(crate::import::types::ImportTerminalResult::Completed);
    record.snapshot.subject_outcomes[0].outcome = ImportSubjectOutcomeKind::Committed;
    record.snapshot.subject_outcomes[0].committed = true;
    write_record(temp.path(), &record).unwrap();
    assert_eq!(
        load_record(temp.path()).unwrap().unwrap().snapshot,
        record.snapshot
    );

    let mut invalid = Vec::new();
    let mut r = record.clone();
    r.version = 99;
    invalid.push(r);
    let mut r = record.clone();
    r.project_identity = "other-project".into();
    invalid.push(r);
    let mut r = record.clone();
    r.staging_relative_path = "/absolute".into();
    invalid.push(r);
    let mut r = record.clone();
    r.snapshot.selected_subjects = vec!["..".into()];
    invalid.push(r);
    let mut r = record.clone();
    r.staging_generation = String::new(); // allowed before preparation, not terminal
    r.snapshot.lifecycle = ImportLifecycle::Finalizing;
    r.snapshot.terminal_result = None;
    invalid.push(r);
    let mut r = record.clone();
    r.snapshot.exit_evidence = None;
    invalid.push(r);
    let mut r = record.clone();
    r.snapshot.confirmation_required = true;
    invalid.push(r);
    let mut r = record.clone();
    r.acknowledged = true;
    r.snapshot.lifecycle = ImportLifecycle::Running;
    r.snapshot.terminal_result = None;
    invalid.push(r);
    let mut r = record.clone();
    r.snapshot.subject_outcomes[0].subject = "FOREIGN".into();
    invalid.push(r);
    for invalid_record in invalid {
        assert!(validate_record(&invalid_record, temp.path()).is_err());
    }
}

#[test]
fn failed_replacement_preserves_prior_valid_record() {
    let temp = tempfile::tempdir().unwrap();
    let record = record_from_state(&run(temp.path())).unwrap();
    write_record(temp.path(), &record).unwrap();
    let mut invalid = record.clone();
    invalid.snapshot.run_id = "../unsafe".to_string();
    assert!(write_record(temp.path(), &invalid).is_err());
    assert_eq!(
        load_record(temp.path()).unwrap().unwrap().snapshot.run_id,
        "import-run-1"
    );
}

#[cfg(unix)]
#[test]
fn record_publish_component_swap_never_writes_foreign_parent() {
    let project = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    let prior = record_from_state(&run(project.path())).unwrap();
    write_record(project.path(), &prior).unwrap();
    fs::write(foreign.path().join("import-run.json"), b"foreign").unwrap();
    let mut replacement = prior.clone();
    replacement.snapshot.profile_id = "replacement".to_string();
    swap_record_parent_before_publish(project.path().to_path_buf(), foreign.path().to_path_buf());

    assert!(write_record(project.path(), &replacement).is_err());
    assert_eq!(
        fs::read(foreign.path().join("import-run.json")).unwrap(),
        b"foreign"
    );
}

#[test]
fn atomic_write_failures_preserve_the_authoritative_visible_record_and_foreign_temps() {
    for point in [
        RecordFaultPoint::CandidateCreate,
        RecordFaultPoint::Write,
        RecordFaultPoint::Flush,
        RecordFaultPoint::Verification,
        RecordFaultPoint::Rename,
        RecordFaultPoint::ParentSync,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let prior = record_from_state(&run(temp.path())).unwrap();
        write_record(temp.path(), &prior).unwrap();
        let foreign_temp = record_path(temp.path())
            .parent()
            .unwrap()
            .join(".import-run.json.foreign.tmp");
        fs::write(&foreign_temp, "foreign").unwrap();
        let mut replacement = prior.clone();
        replacement.snapshot.profile_id = "profile-2".to_string();
        inject_fault(point);

        let error = write_record(temp.path(), &replacement).unwrap_err();
        if point == RecordFaultPoint::ParentSync {
            assert!(error.to_string().contains("uncertain durability"));
        }
        assert_eq!(
            load_record(temp.path())
                .unwrap()
                .unwrap()
                .snapshot
                .profile_id,
            if point == RecordFaultPoint::ParentSync {
                "profile-2"
            } else {
                "profile-1"
            },
            "{point:?}"
        );
        assert_eq!(fs::read_to_string(foreign_temp).unwrap(), "foreign");
    }
}

fn finalizing_record(root: &Path) -> ImportRunRecord {
    let mut state = run(root);
    state.run_id = format!("import-run-{}", uuid::Uuid::new_v4());
    state.lifecycle = ImportLifecycle::Finalizing;
    state.staging_generation = "generation-1".to_string();
    state.exit_evidence = Some(ImportExitEvidence {
        exit_code: 0,
        successful: true,
    });
    state.subject_outcomes = vec![ImportSubjectOutcome {
        subject: "ONE".to_string(),
        outcome: ImportSubjectOutcomeKind::Verified,
        ready_lock_verified: true,
        rawdata_verified: true,
        committed: false,
        error: None,
    }];
    state.relocation_plan_id = Some("plan-1".to_string());
    state.relocation_plan = Some(RelocationPlan {
        plan_id: "plan-1".to_string(),
        subjects: vec![SubjectInventory {
            subject: "ONE".to_string(),
            entries: Vec::new(),
            file_count: 0,
            byte_total: 0,
            sessions: Vec::new(),
            fingerprint: "subject-fingerprint".to_string(),
        }],
        fingerprint: "plan-fingerprint".to_string(),
        project_root: root.to_path_buf(),
        project_identity: project_identity(root),
        bound_generation: Some(7),
    });
    record_from_state(&state).unwrap()
}

fn committed_outcome() -> RelocationOutcome {
    RelocationOutcome {
        plan_id: "plan-1".to_string(),
        generation: 7,
        subjects: vec![SubjectRelocationOutcome {
            subject: "ONE".to_string(),
            status: RelocationSubjectStatus::Committed,
            phase: "committed".to_string(),
            message: None,
        }],
        staging_cleanup_complete: true,
    }
}

#[test]
fn malformed_record_matrix_fails_closed() {
    let temp = tempfile::tempdir().unwrap();
    let valid = finalizing_record(temp.path());
    let mut cases = Vec::new();
    let mut record = valid.clone();
    record.version += 1;
    cases.push(record);
    let mut record = valid.clone();
    record.project_identity = "foreign".to_string();
    cases.push(record);
    let mut record = valid.clone();
    record.staging_relative_path = "../escape".to_string();
    cases.push(record);
    let mut record = valid.clone();
    record.snapshot.selected_subjects.clear();
    cases.push(record);
    let mut record = valid.clone();
    record.snapshot.selected_subjects.push("ONE".to_string());
    cases.push(record);
    let mut record = valid.clone();
    record.snapshot.exit_evidence = None;
    cases.push(record);
    let mut record = valid.clone();
    record.snapshot.subject_outcomes[0].committed = true;
    cases.push(record);
    let mut record = valid.clone();
    record.relocation_plan.as_mut().unwrap().subjects[0]
        .entries
        .push(RelocationEntry {
            path: "rawdata/sub-OTHER/scan.nii".to_string(),
            kind: RelocationEntryKind::File,
            bytes: 1,
        });
    cases.push(record);
    for record in cases {
        assert!(validate_record(&record, temp.path()).is_err());
    }
}

#[test]
fn relocation_checkpoint_is_exact_and_idempotent_before_journal_cleanup() {
    let temp = tempfile::tempdir().unwrap();
    write_record(temp.path(), &finalizing_record(temp.path())).unwrap();
    let outcome = committed_outcome();
    checkpoint_relocation_outcome(temp.path(), &outcome).unwrap();
    checkpoint_relocation_outcome(temp.path(), &outcome).unwrap();
    assert_eq!(
        load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .relocation_outcome,
        Some(outcome.clone())
    );
    let mut foreign = outcome;
    foreign.generation += 1;
    assert!(checkpoint_relocation_outcome(temp.path(), &foreign).is_err());
}

#[test]
fn terminal_cleanup_recovery_accepts_only_the_same_cross_journal_outcome() {
    let temp = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(temp.path());
    let outcome = committed_outcome();
    record.snapshot.relocation_outcome = Some(outcome.clone());
    record.snapshot.lifecycle = ImportLifecycle::Failed;
    record.snapshot.terminal_result = Some(crate::import::types::ImportTerminalResult::Failed);
    write_record(temp.path(), &record).unwrap();

    validate_relocation_recovery_authority(
        temp.path(),
        outcome.generation,
        &outcome.plan_id,
        Some(&outcome),
    )
    .unwrap();
    checkpoint_relocation_outcome(temp.path(), &outcome).unwrap();

    let mut changed = outcome;
    changed.staging_cleanup_complete = false;
    assert!(
        validate_relocation_recovery_authority(
            temp.path(),
            changed.generation,
            &changed.plan_id,
            Some(&changed),
        )
        .is_err()
    );
}

#[test]
fn relocation_recovery_preserves_checkpointed_pending_derived_outcome() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("rawdata/sub-ONE")).unwrap();
    fs::write(root.join("rawdata/sub-ONE/old.nii"), "old").unwrap();
    let staging = root.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
    fs::write(staging.join("rawdata/sub-ONE/new.nii"), "new").unwrap();
    let staged_lock = crate::import::status::import_lock_dir(&staging, "ONE");
    fs::create_dir_all(&staged_lock).unwrap();
    fs::write(staged_lock.join("new.status"), "new lock").unwrap();

    let mut plan =
        crate::import::relocation::create_plan(root, &["ONE".to_string()], "plan-1".to_string())
            .unwrap();
    crate::import::relocation::bind_plan(&mut plan, root, &["ONE".to_string()], 7).unwrap();
    let mut record = finalizing_record(root);
    record.relocation_plan = Some(plan.clone());
    write_record(root, &record).unwrap();

    let pending = {
        let _failure = crate::import::relocation::inject_relocation_failure(
            crate::import::relocation::RelocationFailurePoint::AncillaryInstall,
        );
        crate::import::relocation::relocate(&plan, 7, &staging, &["ONE".to_string()], false, false)
            .unwrap()
    };
    assert_eq!(pending.subjects[0].phase, "derivedReconciliation");
    assert!(pending.subjects[0].message.is_some());

    record = load_record(root).unwrap().unwrap();
    record.snapshot.relocation_outcome = Some(pending.clone());
    record.snapshot.lifecycle = ImportLifecycle::Failed;
    record.snapshot.terminal_result = Some(crate::import::types::ImportTerminalResult::Failed);
    write_record(root, &record).unwrap();

    let summary = crate::import::relocation::recover(root).unwrap();

    assert!(summary.cleanup_errors.is_empty());
    assert!(!root.join(crate::import::relocation::JOURNAL_FILE).exists());
    assert_eq!(
        load_record(root)
            .unwrap()
            .unwrap()
            .snapshot
            .relocation_outcome,
        Some(pending)
    );
    assert_eq!(
        fs::read_to_string(crate::import::status::import_lock_dir(root, "ONE").join("new.status"))
            .unwrap(),
        "new lock"
    );
}

#[test]
fn activation_checkpoints_committed_rawdata_despite_persistent_derived_cleanup_failure() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("rawdata/sub-ONE")).unwrap();
    fs::write(root.join("rawdata/sub-ONE/old.nii"), "old").unwrap();
    let staging = root.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
    fs::write(staging.join("rawdata/sub-ONE/new.nii"), "new").unwrap();
    fs::write(
        staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
        "generation-1",
    )
    .unwrap();
    let staged_lock = crate::import::status::import_lock_dir(&staging, "ONE");
    fs::create_dir_all(&staged_lock).unwrap();
    fs::write(staged_lock.join("999_ready.status"), "ready").unwrap();
    let derived_parent = root.join("derivatives/ExploreASL/log");
    fs::create_dir_all(derived_parent.parent().unwrap()).unwrap();
    fs::write(&derived_parent, "unrelated obstruction").unwrap();
    let mut plan =
        crate::import::relocation::create_plan(root, &["ONE".into()], "plan-1".into()).unwrap();
    crate::import::relocation::bind_plan(&mut plan, root, &["ONE".into()], 7).unwrap();
    let mut record = finalizing_record(root);
    record.relocation_plan = Some(plan.clone());
    write_record(root, &record).unwrap();
    {
        let _failure = crate::import::relocation::inject_relocation_failure(
            crate::import::relocation::RelocationFailurePoint::InterruptAfterCommit,
        );
        crate::import::relocation::relocate(&plan, 7, &staging, &["ONE".into()], true, false)
            .unwrap_err();
    }
    assert!(
        load_record(root)
            .unwrap()
            .unwrap()
            .snapshot
            .relocation_outcome
            .is_none()
    );
    let installed_mtime = fs::metadata(root.join("rawdata/sub-ONE/new.nii"))
        .unwrap()
        .modified()
        .unwrap();
    let state = crate::app_state::AppState::default();

    let summary =
        crate::project_runtime::set_active_project_impl(root.display().to_string(), &state)
            .expect("committed custody permits activation despite cleanup warning");

    assert_eq!(summary.preserved_subjects, ["ONE"]);
    assert!(
        summary
            .cleanup_errors
            .iter()
            .any(|error| error.contains("Derived artifact reconciliation remains pending"))
    );
    assert_eq!(
        crate::project_ownership::active(&state).unwrap().root(),
        root
    );
    let terminal = load_record(root).unwrap().unwrap().snapshot;
    assert_eq!(terminal.lifecycle, ImportLifecycle::Failed);
    assert!(terminal.subject_outcomes[0].committed);
    assert!(
        terminal
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("reconciliation remains pending")
    );
    assert_eq!(
        terminal.relocation_outcome.as_ref().unwrap().subjects[0].phase,
        "derivedReconciliation"
    );
    assert!(staging.exists());
    assert!(root.join(crate::import::relocation::JOURNAL_FILE).exists());
    assert_eq!(
        fs::read_to_string(&derived_parent).unwrap(),
        "unrelated obstruction"
    );
    assert_eq!(
        fs::read_to_string(root.join("rawdata/sub-ONE/new.nii")).unwrap(),
        "new"
    );
    assert!(!root.join("rawdata/sub-ONE/old.nii").exists());

    // Retry cleanup without rewriting the durable historical failure.
    drop(state);
    let state = crate::app_state::AppState::default();
    let summary =
        crate::project_runtime::set_active_project_impl(root.display().to_string(), &state)
            .unwrap();
    assert!(!summary.cleanup_errors.is_empty());
    assert_eq!(load_record(root).unwrap().unwrap().snapshot, terminal);
    fs::remove_file(&derived_parent).unwrap();
    drop(state);
    let state = crate::app_state::AppState::default();
    {
        let _failure = crate::import::relocation::inject_relocation_failure(
            crate::import::relocation::RelocationFailurePoint::JournalPersist,
        );
        let summary =
            crate::project_runtime::set_active_project_impl(root.display().to_string(), &state)
                .unwrap();
        assert!(summary.cleanup_errors.iter().any(|error| error.contains("Failed to checkpoint derived artifact reconciliation")));
    }
    assert_eq!(load_record(root).unwrap().unwrap().snapshot, terminal);
    let pending: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join(crate::import::relocation::JOURNAL_FILE)).unwrap(),
    )
    .unwrap();
    assert_eq!(
        pending["terminalOutcome"],
        serde_json::to_value(&terminal.relocation_outcome).unwrap()
    );
    drop(state);
    let state = crate::app_state::AppState::default();
    let summary =
        crate::project_runtime::set_active_project_impl(root.display().to_string(), &state)
            .unwrap();
    assert!(summary.cleanup_errors.is_empty());
    assert!(!root.join(crate::import::relocation::JOURNAL_FILE).exists());
    assert!(staging.exists());
    assert_eq!(load_record(root).unwrap().unwrap().snapshot, terminal);
    assert_eq!(
        fs::metadata(root.join("rawdata/sub-ONE/new.nii"))
            .unwrap()
            .modified()
            .unwrap(),
        installed_mtime
    );
}

#[test]
fn finalization_after_relocation_cleanup_uses_checkpoint_without_staging() {
    let temp = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(temp.path());
    record.snapshot.relocation_outcome = Some(committed_outcome());
    write_record(temp.path(), &record).unwrap();
    let state = crate::app_state::AppState::default();

    let snapshot = crate::import::state::recover_import_run_for_project(&state, temp.path())
        .unwrap()
        .unwrap();

    assert_eq!(snapshot.lifecycle, ImportLifecycle::Completed);
    assert_eq!(
        snapshot.subject_outcomes[0].outcome,
        ImportSubjectOutcomeKind::Committed
    );
    assert!(snapshot.subject_outcomes[0].committed);
    assert!(!temp.path().join(".easl_staging").exists());
}

#[test]
fn debug_preservation_allows_completed_replay_without_staging_cleanup() {
    let temp = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(temp.path());
    let mut outcome = committed_outcome();
    outcome.staging_cleanup_complete = false;
    record.snapshot.relocation_outcome = Some(outcome);
    record.preserve_staging = true;
    fs::create_dir(temp.path().join(".easl_staging")).unwrap();
    fs::write(temp.path().join(".easl_staging/diagnostic.txt"), "keep").unwrap();
    fs::write(temp.path().join(".easl_staging/studyPar.json"), "{}").unwrap();
    fs::write(temp.path().join(".easl_staging/sourcestructure.json"), "{}").unwrap();
    write_record(temp.path(), &record).unwrap();
    let state = crate::app_state::AppState::default();

    let snapshot = crate::import::state::recover_import_run_for_project(&state, temp.path())
        .unwrap()
        .unwrap();

    assert_eq!(snapshot.lifecycle, ImportLifecycle::Completed);
    assert!(temp.path().join(".easl_staging/diagnostic.txt").is_file());
    assert!(
        temp.path()
            .join("derivatives/ExploreASL_GUI/studyPar.json")
            .is_file()
    );
    assert!(load_record(temp.path()).unwrap().unwrap().preserve_staging);
}

#[test]
fn impossible_exit_and_completed_subject_evidence_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(temp.path());
    record.snapshot.exit_evidence.as_mut().unwrap().successful = false;
    assert!(validate_record(&record, temp.path()).is_err());

    let mut record = finalizing_record(temp.path());
    record.snapshot.relocation_outcome = Some(committed_outcome());
    record.snapshot.lifecycle = ImportLifecycle::Completed;
    record.snapshot.terminal_result = Some(crate::import::types::ImportTerminalResult::Completed);
    assert!(validate_record(&record, temp.path()).is_err());
}

#[test]
fn recovery_matrix_blocks_legacy_orphans_and_replays_terminal_records() {
    for lifecycle in [
        ImportLifecycle::Preparing,
        ImportLifecycle::Running,
        ImportLifecycle::Cancelling,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut record = record_from_state(&run(temp.path())).unwrap();
        record.snapshot.lifecycle = lifecycle;
        if matches!(
            lifecycle,
            ImportLifecycle::Running | ImportLifecycle::Cancelling
        ) {
            record.staging_generation = "generation-1".to_string();
        }
        write_record(temp.path(), &record).unwrap();
        let state = crate::app_state::AppState::default();
        let recovered = crate::import::state::recover_import_run_for_project(&state, temp.path())
            .unwrap()
            .unwrap();
        assert_eq!(recovered.lifecycle, ImportLifecycle::Interrupted);
        assert!(recovered.confirmation_required);
    }

    let temp = tempfile::tempdir().unwrap();
    let mut state_record = run(temp.path());
    state_record.staging_generation = "generation-1".to_string();
    state_record.lifecycle = ImportLifecycle::Interrupted;
    state_record.terminal_result = Some(crate::import::types::ImportTerminalResult::Interrupted);
    write_record(temp.path(), &record_from_state(&state_record).unwrap()).unwrap();
    let state = crate::app_state::AppState::default();
    let first = crate::import::state::recover_import_run_for_project(&state, temp.path())
        .unwrap()
        .unwrap();
    let second = crate::import::state::recover_import_run_for_project(&state, temp.path())
        .unwrap()
        .unwrap();
    assert_eq!(first, second);

    for (lifecycle, terminal_result) in [
        (
            ImportLifecycle::Failed,
            crate::import::types::ImportTerminalResult::Failed,
        ),
        (
            ImportLifecycle::Cancelled,
            crate::import::types::ImportTerminalResult::Cancelled,
        ),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut terminal = run(temp.path());
        terminal.lifecycle = lifecycle;
        terminal.terminal_result = Some(terminal_result.clone());
        terminal.subject_outcomes = vec![ImportSubjectOutcome {
            subject: "ONE".to_string(),
            outcome: if lifecycle == ImportLifecycle::Cancelled {
                ImportSubjectOutcomeKind::Cancelled
            } else {
                ImportSubjectOutcomeKind::Failed
            },
            ready_lock_verified: false,
            rawdata_verified: false,
            committed: false,
            error: None,
        }];
        let expected = terminal.snapshot();
        write_record(temp.path(), &record_from_state(&terminal).unwrap()).unwrap();
        let state = crate::app_state::AppState::default();
        let replay = crate::import::state::recover_import_run_for_project(&state, temp.path())
            .unwrap()
            .unwrap();
        assert_eq!(replay, expected, "{lifecycle:?}");
    }
}

#[test]
fn recovery_matrix_leaves_missing_records_alone_and_fails_closed_on_foreign_or_unsafe_authority() {
    let missing = tempfile::tempdir().unwrap();
    let state = crate::app_state::AppState::default();
    assert_eq!(
        crate::import::state::recover_import_run_for_project(&state, missing.path()).unwrap(),
        None
    );
    assert!(!record_path(missing.path()).exists());
    assert!(!missing.path().join(".easl_staging").exists());

    let foreign = tempfile::tempdir().unwrap();
    let mut record = record_from_state(&run(foreign.path())).unwrap();
    record.project_identity = "foreign-project".to_string();
    // Write raw malformed authority to exercise activation's load/validate
    // boundary rather than only the codec in isolation.
    let path = record_path(foreign.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
    let sentinel = foreign.path().join("project-output-unchanged");
    fs::write(&sentinel, "keep").unwrap();
    assert!(
        crate::import::state::recover_import_run_for_project(
            &crate::app_state::AppState::default(),
            foreign.path()
        )
        .is_err()
    );
    assert_eq!(fs::read_to_string(sentinel).unwrap(), "keep");
}

#[test]
fn finalizing_marker_mismatch_fails_without_relocation_or_deletion() {
    let temp = tempfile::tempdir().unwrap();
    let staging = temp.path().join(".easl_staging");
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join("diagnostic.txt"), "retain").unwrap();
    write_record(temp.path(), &finalizing_record(temp.path())).unwrap();
    let state = crate::app_state::AppState::default();

    let recovered = crate::import::state::recover_import_run_for_project(&state, temp.path())
        .unwrap()
        .unwrap();

    assert_eq!(recovered.lifecycle, ImportLifecycle::Failed);
    assert_eq!(
        recovered.subject_outcomes[0].error.as_ref().unwrap().code,
        "stagingGeneration"
    );
    assert!(staging.join("diagnostic.txt").exists());
    assert!(
        !temp
            .path()
            .join(crate::import::relocation::JOURNAL_FILE)
            .exists()
    );
}

#[test]
fn recovery_resumes_verification_and_relocation_checkpoints_then_replays_terminal_exactly() {
    fn write_fresh_evidence(root: &Path) {
        let staging = root.join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
        fs::write(
            staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
            "generation-1",
        )
        .unwrap();
        fs::write(staging.join("rawdata/sub-ONE/scan.nii"), "nii").unwrap();
        let lock = crate::import::status::import_lock_dir(&staging, "ONE");
        fs::create_dir_all(&lock).unwrap();
        fs::write(lock.join("999_ready.status"), "ready").unwrap();
    }

    fn relocatable_record(root: &Path) -> ImportRunRecord {
        let mut record = finalizing_record(root);
        let mut plan = crate::import::relocation::create_plan(
            root,
            &["ONE".to_string()],
            "plan-1".to_string(),
        )
        .unwrap();
        crate::import::relocation::bind_plan(&mut plan, root, &["ONE".to_string()], 7).unwrap();
        record.relocation_plan = Some(plan);
        record
    }

    // Exit-only Finalizing checkpoint re-verifies and relocates.
    let exit_only = tempfile::tempdir().unwrap();
    let mut record = relocatable_record(exit_only.path());
    record.snapshot.subject_outcomes.clear();
    write_record(exit_only.path(), &record).unwrap();
    write_fresh_evidence(exit_only.path());
    assert_eq!(
        load_record(exit_only.path())
            .unwrap()
            .unwrap()
            .relocation_plan
            .unwrap()
            .fingerprint,
        crate::import::relocation::create_plan(
            exit_only.path(),
            &["ONE".to_string()],
            "current".to_string(),
        )
        .unwrap()
        .fingerprint
    );
    let state = crate::app_state::AppState::default();
    let terminal = crate::import::state::recover_import_run_for_project(&state, exit_only.path())
        .unwrap()
        .unwrap();
    assert_eq!(
        terminal.lifecycle,
        ImportLifecycle::Completed,
        "{terminal:?}"
    );
    assert!(exit_only.path().join("rawdata/sub-ONE/scan.nii").is_file());

    // Verification checkpoint resumes relocation rather than trusting only
    // the staged ready path.
    let verified = tempfile::tempdir().unwrap();
    write_record(verified.path(), &relocatable_record(verified.path())).unwrap();
    write_fresh_evidence(verified.path());
    let state = crate::app_state::AppState::default();
    let terminal = crate::import::state::recover_import_run_for_project(&state, verified.path())
        .unwrap()
        .unwrap();
    assert_eq!(terminal.lifecycle, ImportLifecycle::Completed);
    assert!(terminal.subject_outcomes[0].committed);

    // Relocation checkpoint resumes terminal publication even after
    // staging cleanup; repeated recovery is replay-only.
    let relocated = tempfile::tempdir().unwrap();
    let mut record = finalizing_record(relocated.path());
    record.snapshot.relocation_outcome = Some(committed_outcome());
    write_record(relocated.path(), &record).unwrap();
    let state = crate::app_state::AppState::default();
    let first = crate::import::state::recover_import_run_for_project(&state, relocated.path())
        .unwrap()
        .unwrap();
    let second = crate::import::state::recover_import_run_for_project(&state, relocated.path())
        .unwrap()
        .unwrap();
    assert_eq!(first.lifecycle, ImportLifecycle::Completed);
    assert_eq!(first, second);
    assert_eq!(
        load_record(relocated.path()).unwrap().unwrap().snapshot,
        first
    );
}

#[test]
fn relocation_journal_disagreement_fails_before_output_mutation() {
    let temp = tempfile::tempdir().unwrap();
    write_record(temp.path(), &finalizing_record(temp.path())).unwrap();
    let sentinel = temp.path().join("project-output");
    fs::write(&sentinel, "unchanged").unwrap();

    assert!(validate_relocation_recovery_authority(temp.path(), 8, "plan-1", None).is_err());
    assert!(validate_relocation_recovery_authority(temp.path(), 7, "foreign-plan", None).is_err());
    assert_eq!(fs::read_to_string(sentinel).unwrap(), "unchanged");
    assert_eq!(
        load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .lifecycle,
        ImportLifecycle::Finalizing
    );
}

#[cfg(unix)]
#[test]
fn symlinked_record_blocks_recovery_without_following_target() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let path = record_path(temp.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let target = temp.path().join("outside.json");
    fs::write(&target, "outside").unwrap();
    symlink(&target, &path).unwrap();
    assert!(load_record(temp.path()).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "outside");
}

#[cfg(unix)]
#[test]
fn symlinked_record_parent_blocks_all_record_operations() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), temp.path().join("derivatives")).unwrap();
    let record = record_from_state(&run(temp.path())).unwrap();

    assert!(write_record(temp.path(), &record).is_err());
    assert!(load_record(temp.path()).is_err());
    assert!(remove_record(temp.path()).is_err());
    assert!(
        !outside
            .path()
            .join("ExploreASL_GUI/import-run.json")
            .exists()
    );
}

#[test]
fn acknowledgement_record_removal_failure_retains_replayable_memory_and_record() {
    let temp = tempfile::tempdir().unwrap();
    let mut run = run(temp.path());
    run.staging_generation = "generation-1".to_string();
    run.lifecycle = ImportLifecycle::Interrupted;
    run.terminal_result = Some(crate::import::types::ImportTerminalResult::Interrupted);
    write_record(temp.path(), &record_from_state(&run).unwrap()).unwrap();
    let state = crate::app_state::AppState::default();
    crate::project_ownership_tests::own_project(&state, temp.path());
    *state.import_state.lock().unwrap() = run;
    fail_next_record_removal();

    assert!(
        crate::import::state::acknowledge_import_run_for_state(&state, "import-run-1").is_err()
    );
    assert!(!state.import_state.lock().unwrap().acknowledged);
    assert!(!load_record(temp.path()).unwrap().unwrap().acknowledged);
    assert_eq!(
        crate::import::state::get_active_import_run_for_state(&state)
            .unwrap()
            .unwrap()
            .run_id,
        "import-run-1"
    );
}
