use crate::import_relocation::{
    RelocationFailurePoint, RelocationSubjectStatus, inject_relocation_failure, recover, relocate,
    transaction_test_fingerprint,
};
use std::fs;
use tempfile::tempdir;

use super::common::{bound_plan, write_old_and_staged};

#[test]
fn activation_recovery_resolves_every_interrupted_subject_phase() {
    for (point, expected_file, expected_contents) in [
        (
            RelocationFailurePoint::InterruptAfterCandidateReady,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterBackupIntent,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterBackupOperation,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterBackup,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterInstallIntent,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterInstallOperation,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterInstall,
            "old.nii",
            "old",
        ),
        (
            RelocationFailurePoint::InterruptAfterCommit,
            "new.nii",
            "new",
        ),
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("interrupt-{point:?}"));
        let _failure = inject_relocation_failure(point);

        let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("simulated interruption");
        assert!(error.to_string().contains("interruption"));
        assert!(
            project
                .join(crate::import_relocation::JOURNAL_FILE)
                .exists()
        );

        recover(&project).expect("activation recovery");
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A").join(expected_file)).unwrap(),
            expected_contents,
            "interruption point {point:?}"
        );
    }
}

#[test]
fn recovery_accepts_every_subject_candidate_preparation_crash_boundary() {
    for point in [
        RelocationFailurePoint::InterruptAfterCandidateReservationIntent,
        RelocationFailurePoint::InterruptAfterCandidateReservationOperation,
        RelocationFailurePoint::InterruptAfterCandidateReserved,
        RelocationFailurePoint::InterruptAfterCandidatePopulationIntent,
        RelocationFailurePoint::InterruptAfterCandidatePopulationOperation,
        RelocationFailurePoint::InterruptAfterCandidateReady,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("prepare-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("simulated candidate preparation crash");
        let summary = recover(&project).expect("candidate crash recovery");

        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old",
            "boundary {point:?}"
        );
        let reserved_wrappers = fs::read_dir(project.join("rawdata"))
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("easl-relocation")
            })
            .count();
        if point == RelocationFailurePoint::InterruptAfterCandidateReservationOperation {
            assert_eq!(reserved_wrappers, 1);
            assert!(!summary.cleanup_errors.is_empty());
        } else {
            assert_eq!(reserved_wrappers, 0);
        }
    }
}

#[test]
fn reservation_intent_unknown_subject_wrappers_do_not_block_or_get_deleted() {
    for (case, marker) in [
        ("empty", None),
        ("partial-marker", Some(false)),
        ("marker-only", Some(true)),
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("subject-intent-{case}"));
        {
            let _failure = inject_relocation_failure(
                RelocationFailurePoint::InterruptAfterCandidateReservationIntent,
            );
            relocate(&plan, 1, &staging, &["A".to_string()], false, false)
                .expect_err("reservation intent crash");
        }
        let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
        let journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
        let candidate = project.join(
            journal["subjects"][0]["artifacts"][0]["candidate"]
                .as_str()
                .unwrap(),
        );
        let token = journal["subjects"][0]["artifacts"][0]["reservationToken"]
            .as_str()
            .unwrap();
        fs::create_dir(&candidate).unwrap();
        if let Some(complete) = marker {
            fs::write(
                candidate.join(".easl-reservation"),
                if complete { token } else { &token[..8] },
            )
            .unwrap();
        }

        let state = crate::app_state::AppState::default();
        let summary = crate::visualization::set_active_project_impl(
            project.to_string_lossy().to_string(),
            &state,
        )
        .expect("authoritative old state permits activation");

        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
        assert!(!journal_path.exists());
        assert_eq!(
            state.active_project_root.lock().unwrap().as_deref(),
            Some(fs::canonicalize(&project).unwrap().as_path())
        );
        assert!(
            candidate.exists(),
            "reservation-intent wrapper must be preserved regardless of marker state"
        );
        assert!(!summary.cleanup_errors.is_empty());
    }
}

#[test]
fn reservation_intent_unknown_dataset_wrappers_do_not_block_or_get_deleted() {
    for (case, marker) in [
        ("empty", None),
        ("partial-marker", Some(false)),
        ("marker-only", Some(true)),
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("dataset-intent-{case}"));
        {
            let _failure = inject_relocation_failure(
                RelocationFailurePoint::InterruptAfterDatasetReservationIntent,
            );
            relocate(&plan, 1, &staging, &["A".to_string()], false, false)
                .expect_err("dataset reservation intent crash");
        }
        let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
        let journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
        let candidate = project.join(journal["dataset"]["candidate"].as_str().unwrap());
        let token = journal["dataset"]["reservationToken"].as_str().unwrap();
        fs::create_dir(&candidate).unwrap();
        if let Some(complete) = marker {
            fs::write(
                candidate.join(".easl-reservation"),
                if complete { token } else { &token[..8] },
            )
            .unwrap();
        }

        let state = crate::app_state::AppState::default();
        let summary = crate::visualization::set_active_project_impl(
            project.to_string_lossy().to_string(),
            &state,
        )
        .expect("dataset intent recovery permits activation");

        assert!(!project.join("rawdata/dataset_description.json").exists());
        assert!(!journal_path.exists());
        assert_eq!(
            state.active_project_root.lock().unwrap().as_deref(),
            Some(fs::canonicalize(&project).unwrap().as_path())
        );
        assert!(
            candidate.exists(),
            "reservation-intent wrapper must be preserved regardless of marker state"
        );
        assert!(!summary.cleanup_errors.is_empty());
    }
}

#[test]
fn reservation_intent_unknown_wrapper_preserves_authoritative_subject_absence() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).unwrap();
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).unwrap();
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").unwrap();
    let plan = bound_plan(&project, &["A"], "subject-intent-absent");
    {
        let _failure = inject_relocation_failure(
            RelocationFailurePoint::InterruptAfterCandidateReservationIntent,
        );
        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("reservation intent crash");
    }
    let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
    let journal: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    let candidate = project.join(
        journal["subjects"][0]["artifacts"][0]["candidate"]
            .as_str()
            .unwrap(),
    );
    fs::create_dir_all(&candidate).unwrap();

    let state = crate::app_state::AppState::default();
    let summary = crate::visualization::set_active_project_impl(
        project.to_string_lossy().to_string(),
        &state,
    )
    .expect("prior absence permits activation");

    assert!(!project.join("rawdata/sub-A").exists());
    assert!(candidate.exists(), "unknown wrapper must not be deleted");
    assert!(!summary.cleanup_errors.is_empty());
    assert!(!journal_path.exists());
}

#[test]
fn payload_and_wrapper_fsync_failures_leave_recoverable_journal_states() {
    for point in [
        RelocationFailurePoint::PayloadParentSync,
        RelocationFailurePoint::PayloadRenameSourceSync,
        RelocationFailurePoint::PayloadRenameDestinationSync,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("fsync-{point:?}"));
        let _failure = inject_relocation_failure(point);

        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("fsync failure returns structured rollback");

        assert_eq!(
            outcome.subjects[0].status,
            RelocationSubjectStatus::RolledBack
        );
        assert!(
            !project
                .join(crate::import_relocation::JOURNAL_FILE)
                .exists()
        );
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
    }

    for point in [
        RelocationFailurePoint::PayloadParentSync,
        RelocationFailurePoint::PayloadRenameSourceSync,
        RelocationFailurePoint::PayloadRenameDestinationSync,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("dataset-fsync-{point:?}"));
        {
            let _failure = inject_relocation_failure(point);
            relocate(&plan, 1, &staging, &["A".to_string()], false, false)
                .expect_err("dataset fsync failure leaves recovery journal");
        }

        assert!(
            project
                .join(crate::import_relocation::JOURNAL_FILE)
                .exists()
        );
        let summary = recover(&project).expect("dataset fsync journal is recoverable");
        assert!(summary.cleanup_errors.is_empty());
        assert!(!project.join("rawdata/dataset_description.json").exists());
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
        assert!(
            !project
                .join(crate::import_relocation::JOURNAL_FILE)
                .exists()
        );
    }

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "wrapper-delete-fsync");
    let _failure = inject_relocation_failure(RelocationFailurePoint::WrapperDeleteParentSync);
    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect("commit remains authoritative with cleanup pending");
    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert!(
        project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );
    recover(&project).expect("cleanup resumes from consistent journal");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
}

#[test]
fn recovery_accepts_every_dataset_candidate_preparation_crash_boundary() {
    for point in [
        RelocationFailurePoint::InterruptAfterDatasetReservationIntent,
        RelocationFailurePoint::InterruptAfterDatasetReservationOperation,
        RelocationFailurePoint::InterruptAfterDatasetReserved,
        RelocationFailurePoint::InterruptAfterDatasetPopulationIntent,
        RelocationFailurePoint::InterruptAfterDatasetPopulationOperation,
        RelocationFailurePoint::InterruptAfterDatasetCandidateReady,
        RelocationFailurePoint::InterruptAfterDatasetInstallIntent,
        RelocationFailurePoint::InterruptAfterDatasetInstallOperation,
        RelocationFailurePoint::InterruptAfterDatasetInstall,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("dataset-prepare-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("simulated dataset preparation crash");
        recover(&project).expect("dataset candidate crash recovery");

        assert!(!project.join("rawdata/dataset_description.json").exists());
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old",
            "boundary {point:?}"
        );
    }
}

#[test]
fn subject_rollback_replays_every_pre_and_post_operation_crash_state() {
    for point in [
        RelocationFailurePoint::InterruptRollbackAfterIntent,
        RelocationFailurePoint::InterruptRollbackAfterDestinationRemoval,
        RelocationFailurePoint::InterruptRollbackAfterBackupRestore,
        RelocationFailurePoint::InterruptRollbackAfterCandidateCleanup,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let old_lock = crate::import::import_lock_dir_for_relocation(&project, "A");
        fs::create_dir_all(&old_lock).unwrap();
        fs::write(old_lock.join("old.status"), "old lock").unwrap();
        let new_lock = crate::import::import_lock_dir_for_relocation(&staging, "A");
        fs::create_dir_all(&new_lock).unwrap();
        fs::write(new_lock.join("new.status"), "new lock").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("rollback-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("simulated rollback crash");
        recover(&project).expect("idempotent multi-artifact rollback");

        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old",
            "boundary {point:?}"
        );
        assert_eq!(
            fs::read_to_string(old_lock.join("old.status")).unwrap(),
            "old lock"
        );
        assert!(!old_lock.join("new.status").exists());
    }
}

#[test]
fn dataset_rollback_replays_every_pre_and_post_operation_crash_state() {
    for point in [
        RelocationFailurePoint::InterruptDatasetRollbackAfterIntent,
        RelocationFailurePoint::InterruptDatasetRollbackAfterDestinationRemoval,
        RelocationFailurePoint::InterruptDatasetRollbackAfterCandidateCleanup,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(project.join("rawdata/sub-A")).unwrap();
        fs::write(project.join("rawdata/sub-A/old.nii"), "old").unwrap();
        let staging = project.join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-A")).unwrap();
        fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("dataset-rollback-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("simulated dataset rollback crash");
        recover(&project).expect("idempotent dataset rollback");

        assert!(!project.join("rawdata/dataset_description.json").exists());
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
    }
}

#[test]
fn activation_recovery_rolls_back_orphaned_dataset_install() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-interruption");
    let _failure = inject_relocation_failure(RelocationFailurePoint::InterruptAfterDatasetInstall);

    relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("dataset interruption");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/dataset_description.json")).unwrap(),
        "staged"
    );

    let summary = recover(&project).expect("dataset recovery");
    assert_eq!(summary.restored_subjects, ["A"]);
    assert!(!project.join("rawdata/dataset_description.json").exists());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn recovery_refuses_substituted_candidate_reserved_content() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "reserved-substitution");
    let candidate = project.join("rawdata/.sub-A.easl-relocation-reservedsubstitution-A-candidate");
    let _failure =
        inject_relocation_failure(RelocationFailurePoint::InterruptAfterCandidateReserved);

    relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("reserved interruption");
    fs::remove_dir_all(&candidate).unwrap();
    fs::create_dir(&candidate).unwrap();

    assert!(recover(&project).is_err());
    assert!(
        candidate.is_dir(),
        "substituted empty directory must remain"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn recovery_refuses_substituted_dataset_candidate_reserved_content() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-reserved-substitution");
    let candidate = project.join(
        "rawdata/.dataset_description.json.easl-relocation-datasetreservedsubstitution-run-candidate",
    );
    let _failure = inject_relocation_failure(RelocationFailurePoint::InterruptAfterDatasetReserved);

    relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("dataset reserved interruption");
    fs::remove_dir_all(&candidate).unwrap();
    fs::write(&candidate, "").unwrap();

    assert!(recover(&project).is_err());
    assert_eq!(fs::read_to_string(&candidate).unwrap(), "");
    assert!(!project.join("rawdata/dataset_description.json").exists());
}

#[test]
fn recovery_preflights_later_missing_destination_and_backup_before_mutating_a() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::create_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::write(project.join("rawdata/sub-B/old.nii"), "old B").unwrap();
    fs::create_dir_all(staging.join("rawdata/sub-B")).unwrap();
    fs::write(staging.join("rawdata/sub-B/new.nii"), "new B").unwrap();
    let plan = bound_plan(&project, &["A", "B"], "preflight-recovery");
    {
        let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);
        relocate(
            &plan,
            1,
            &staging,
            &["A".to_string(), "B".to_string()],
            false,
            false,
        )
        .unwrap();
    }
    let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
    let mut journal: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    journal["terminalOutcome"] = serde_json::Value::Null;
    for index in 0..2 {
        journal["subjects"][index]["phase"] = "planned".into();
        journal["subjects"][index]["artifacts"][0]["phase"] = "candidateReserved".into();
        let relative = journal["subjects"][index]["artifacts"][0]["candidate"]
            .as_str()
            .unwrap();
        let candidate = project.join(relative);
        fs::create_dir_all(&candidate).unwrap();
        journal["subjects"][index]["artifacts"][0]["candidateFingerprint"] =
            transaction_test_fingerprint(&candidate).unwrap().into();
    }
    let candidate_a = project.join(
        journal["subjects"][0]["artifacts"][0]["candidate"]
            .as_str()
            .unwrap(),
    );
    let backup_a = project.join(
        journal["subjects"][0]["artifacts"][0]["backup"]
            .as_str()
            .unwrap(),
    );
    fs::remove_dir_all(project.join("rawdata/sub-A")).unwrap();
    fs::rename(&backup_a, project.join("rawdata/sub-A")).unwrap();
    let backup_b = project.join(
        journal["subjects"][1]["artifacts"][0]["backup"]
            .as_str()
            .unwrap(),
    );
    fs::remove_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::remove_dir_all(backup_b).unwrap();
    fs::write(&journal_path, serde_json::to_vec_pretty(&journal).unwrap()).unwrap();

    assert!(recover(&project).is_err());
    assert!(
        candidate_a.exists(),
        "A must not mutate before B preflight fails"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}
