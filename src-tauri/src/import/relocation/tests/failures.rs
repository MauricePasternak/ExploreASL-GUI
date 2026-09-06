use crate::import_relocation::{
    RelocationFailurePoint, RelocationSubjectStatus, inject_relocation_failure, recover, relocate,
};
use std::fs;
use tempfile::tempdir;

use super::common::{bound_plan, write_old_and_staged};

#[test]
fn missing_empty_and_nonempty_rawdata_have_explicit_safe_outcomes() {
    for (id, create_empty, expected) in [
        ("missing-raw", false, "Missing staged rawdata"),
        ("empty-raw", true, "Empty staged rawdata"),
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
        fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
        let plan = bound_plan(&project, &["A"], id);
        let staging = project.join(".easl_staging");
        fs::create_dir_all(&staging).expect("staging");
        if create_empty {
            fs::create_dir_all(staging.join("rawdata/sub-A")).expect("empty rawdata");
        }

        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("structured rawdata failure");
        assert_eq!(
            outcome.subjects[0].status,
            RelocationSubjectStatus::RolledBack
        );
        assert_eq!(outcome.subjects[0].phase, "candidatePreparation");
        assert!(
            outcome.subjects[0]
                .message
                .as_deref()
                .unwrap_or_default()
                .contains(expected)
        );
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
    }

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "nonempty-raw");
    let outcome =
        relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("nonempty rawdata");
    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
}

#[test]
fn injected_enospc_is_actionable_and_preserves_destination() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "no-space");
    let _failure = inject_relocation_failure(RelocationFailurePoint::InsufficientSpace);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect("structured ENOSPC failure");

    let message = outcome.subjects[0].message.as_deref().unwrap_or_default();
    assert!(message.contains("Insufficient space"));
    assert!(message.contains("os error"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn no_replace_backup_collision_never_overwrites_or_deletes_concurrent_path() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "backup-race");
    let backup = project.join("rawdata/.sub-A.easl-relocation-backuprace-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::BackupCollision);

    let outcome =
        relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("collision outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    assert_eq!(outcome.subjects[0].phase, "recovery");
    assert!(
        outcome.subjects[0]
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("backup failed")
    );
    let frontend: serde_json::Value = serde_json::to_value(&outcome).unwrap();
    assert_eq!(frontend["subjects"][0]["status"], "recoveryRequired");
    assert_eq!(frontend["subjects"][0]["phase"], "recovery");
    assert_eq!(fs::read_to_string(&backup).unwrap(), "concurrent-unowned");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn no_replace_install_collision_preserves_concurrent_destination_and_backup() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "install-race");
    let backup = project.join("rawdata/.sub-A.easl-relocation-installrace-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::InstallCollision);

    let outcome =
        relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("collision outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A")).unwrap(),
        "concurrent-unowned"
    );
    assert_eq!(fs::read_to_string(backup.join("old.nii")).unwrap(), "old");
    assert!(
        recover(&project).is_err(),
        "ambiguous evidence must block activation"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A")).unwrap(),
        "concurrent-unowned"
    );
    assert_eq!(fs::read_to_string(backup.join("old.nii")).unwrap(), "old");
}

#[test]
fn backups_survive_until_terminal_outcome_is_durable_and_recovery_accepts_cleaned_backups() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "outcome-order");
    let backup = project.join("rawdata/.sub-A.easl-relocation-outcomeorder-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::OutcomePersist);

    let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("outcome persistence failure");
    assert!(error.contains("outcome-persist"));
    assert!(
        backup.exists(),
        "backup must precede durable terminal outcome cleanup"
    );
    let journal: serde_json::Value = serde_json::from_slice(
        &fs::read(project.join(crate::import_relocation::JOURNAL_FILE)).unwrap(),
    )
    .unwrap();
    assert!(journal["terminalOutcome"].is_null());

    recover(&project).expect("recover committed journal");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
    assert!(!backup.exists());
}

#[test]
fn committed_destination_change_blocks_cleanup_and_preserves_old_backup() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "committed-change");
    let backup = project.join("rawdata/.sub-A.easl-relocation-committedchange-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::InterruptAfterCommit);

    relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("crash after durable commit");
    fs::write(project.join("rawdata/sub-A/new.nii"), "external change").unwrap();

    assert!(recover(&project).is_err());
    assert_eq!(fs::read_to_string(backup.join("old.nii")).unwrap(), "old");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "external change"
    );
}
