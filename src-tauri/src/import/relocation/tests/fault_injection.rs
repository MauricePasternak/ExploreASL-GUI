use super::*;

#[test]
fn labels_match_fault_contract() {
    let cases = [
        (FaultPoint::CandidateCreate, "candidate-create"),
        (FaultPoint::RecursiveCopy, "recursive-copy"),
        (FaultPoint::FileSync, "file-sync"),
        (FaultPoint::ParentSync, "parent-sync"),
        (FaultPoint::HashVerification, "hash-verification"),
        (FaultPoint::SourceMutation, "source-mutation"),
        (FaultPoint::JournalPersist, "journal-persist"),
        (FaultPoint::DestinationBackup, "destination-backup"),
        (FaultPoint::CandidateInstall, "candidate-install"),
        (FaultPoint::AncillaryInstall, "ancillary-install"),
        (FaultPoint::InsufficientSpace, "insufficient-space"),
        (FaultPoint::BackupCollision, "backup-collision"),
        (FaultPoint::InstallCollision, "install-collision"),
        (FaultPoint::DatasetInstall, "dataset-install"),
        (FaultPoint::DatasetCollision, "dataset-collision"),
        (FaultPoint::OutcomePersist, "outcome-persist"),
        (FaultPoint::Cleanup, "cleanup"),
        (FaultPoint::JournalCleanup, "journal-cleanup"),
        (FaultPoint::Rollback, "rollback"),
        (
            FaultPoint::InterruptAfterDatasetInstall,
            "interrupt-after-dataset-install",
        ),
        (
            FaultPoint::InterruptAfterDatasetReserved,
            "interrupt-after-dataset-reserved",
        ),
        (
            FaultPoint::InterruptAfterCandidateReserved,
            "interrupt-after-candidate-reserved",
        ),
        (
            FaultPoint::InterruptAfterCandidateReservationIntent,
            "interrupt-after-candidate-reservation-intent",
        ),
        (
            FaultPoint::InterruptAfterCandidateReservationOperation,
            "interrupt-after-candidate-reservation-operation",
        ),
        (
            FaultPoint::InterruptAfterCandidatePopulationIntent,
            "interrupt-after-candidate-population-intent",
        ),
        (
            FaultPoint::InterruptAfterCandidatePopulationOperation,
            "interrupt-after-candidate-population-operation",
        ),
        (
            FaultPoint::InterruptAfterDatasetReservationIntent,
            "interrupt-after-dataset-reservation-intent",
        ),
        (
            FaultPoint::InterruptAfterDatasetReservationOperation,
            "interrupt-after-dataset-reservation-operation",
        ),
        (
            FaultPoint::InterruptAfterDatasetPopulationIntent,
            "interrupt-after-dataset-population-intent",
        ),
        (
            FaultPoint::InterruptAfterDatasetPopulationOperation,
            "interrupt-after-dataset-population-operation",
        ),
        (
            FaultPoint::InterruptAfterDatasetCandidateReady,
            "interrupt-after-dataset-candidate-ready",
        ),
        (
            FaultPoint::InterruptAfterDatasetInstallIntent,
            "interrupt-after-dataset-install-intent",
        ),
        (
            FaultPoint::InterruptAfterDatasetInstallOperation,
            "interrupt-after-dataset-install-operation",
        ),
        (
            FaultPoint::InterruptAfterCandidateReady,
            "interrupt-after-candidate-ready",
        ),
        (
            FaultPoint::InterruptAfterBackupIntent,
            "interrupt-after-backup-intent",
        ),
        (
            FaultPoint::InterruptAfterBackupOperation,
            "interrupt-after-backup-operation",
        ),
        (FaultPoint::InterruptAfterBackup, "interrupt-after-backup"),
        (
            FaultPoint::InterruptAfterInstallIntent,
            "interrupt-after-install-intent",
        ),
        (
            FaultPoint::InterruptAfterInstallOperation,
            "interrupt-after-install-operation",
        ),
        (FaultPoint::InterruptAfterInstall, "interrupt-after-install"),
        (FaultPoint::InterruptAfterCommit, "interrupt-after-commit"),
        (
            FaultPoint::SubstituteAfterCandidateReady,
            "substitute-after-candidate-ready",
        ),
        (
            FaultPoint::SubstituteAfterInstall,
            "substitute-after-install",
        ),
        (
            FaultPoint::SubstituteDatasetAfterCandidateReady,
            "substitute-dataset-after-candidate-ready",
        ),
        (
            FaultPoint::SubstituteDatasetAfterInstall,
            "substitute-dataset-after-install",
        ),
        (
            FaultPoint::InterruptRollbackAfterIntent,
            "interrupt-rollback-after-intent",
        ),
        (
            FaultPoint::InterruptRollbackAfterDestinationRemoval,
            "interrupt-rollback-after-destination-removal",
        ),
        (
            FaultPoint::InterruptRollbackAfterBackupRestore,
            "interrupt-rollback-after-backup-restore",
        ),
        (
            FaultPoint::InterruptRollbackAfterCandidateCleanup,
            "interrupt-rollback-after-candidate-cleanup",
        ),
        (
            FaultPoint::InterruptDatasetRollbackAfterIntent,
            "interrupt-dataset-rollback-after-intent",
        ),
        (
            FaultPoint::InterruptDatasetRollbackAfterDestinationRemoval,
            "interrupt-dataset-rollback-after-destination-removal",
        ),
        (
            FaultPoint::InterruptDatasetRollbackAfterCandidateCleanup,
            "interrupt-dataset-rollback-after-candidate-cleanup",
        ),
        (FaultPoint::PayloadParentSync, "payload-parent-sync"),
        (
            FaultPoint::PayloadRenameSourceSync,
            "payload-rename-source-sync",
        ),
        (
            FaultPoint::PayloadRenameDestinationSync,
            "payload-rename-destination-sync",
        ),
        (
            FaultPoint::WrapperDeleteParentSync,
            "wrapper-delete-parent-sync",
        ),
    ];

    for (point, expected) in cases {
        assert_eq!(point.label(), expected);
    }
}

#[test]
fn injected_failures_are_one_shot_and_keep_exact_messages() {
    let _guard = inject_relocation_failure(FaultPoint::CandidateCreate);

    assert_eq!(
        fail(FaultPoint::CandidateCreate)
            .expect_err("injected failure")
            .to_string(),
        "Injected relocation failure at candidate-create"
    );
    assert!(fail(FaultPoint::CandidateCreate).is_ok());

    let _guard = inject_relocation_failure(FaultPoint::InterruptAfterCommit);
    assert_eq!(
        interrupt(FaultPoint::InterruptAfterCommit)
            .expect_err("interruption")
            .to_string(),
        "Injected relocation interruption at interrupt-after-commit"
    );
    assert!(interrupt(FaultPoint::InterruptAfterCommit).is_ok());
}

#[test]
fn dropping_guard_clears_unconsumed_fault() {
    let guard = inject_relocation_failure(FaultPoint::CandidateCreate);
    drop(guard);

    assert!(!take(FaultPoint::CandidateCreate));
}

#[test]
fn rollback_detection_does_not_consume_fault() {
    let _guard = inject_relocation_failure(FaultPoint::InterruptRollbackAfterIntent);

    assert!(rollback_interruption_is_armed());
    assert!(rollback_interruption_is_armed());
    assert!(take(FaultPoint::InterruptRollbackAfterIntent));
    assert!(!rollback_interruption_is_armed());
}
