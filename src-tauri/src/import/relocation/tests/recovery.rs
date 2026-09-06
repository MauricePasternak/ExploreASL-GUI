use crate::import_relocation::{
    RelocationFailurePoint, RelocationSubjectStatus, inject_relocation_failure, recover, relocate,
};
use std::fs;
use tempfile::tempdir;

use super::common::{bound_plan, write_old_and_staged};

#[test]
fn cleanup_only_failure_keeps_terminal_journal_then_activation_finishes_cleanup() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(
        staging.join("rawdata/dataset_description.json"),
        "description",
    )
    .unwrap();
    let plan = bound_plan(&project, &["A"], "cleanup-recovery");
    let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], true, false)
        .expect("durable committed outcome");
    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert!(!outcome.staging_cleanup_complete);
    let journal: serde_json::Value = serde_json::from_slice(
        &fs::read(project.join(crate::import_relocation::JOURNAL_FILE)).unwrap(),
    )
    .unwrap();
    assert!(journal["terminalOutcome"].is_object());

    let summary = recover(&project).expect("cleanup recovery");
    assert_eq!(summary.preserved_subjects, ["A"]);
    assert!(summary.cleanup_errors.is_empty());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/dataset_description.json")).unwrap(),
        "description"
    );
}

#[test]
fn all_run_records_are_preflighted_before_any_subject_candidate_or_backup_mutation() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::create_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::write(project.join("rawdata/sub-B/old.nii"), "old B").unwrap();
    fs::create_dir_all(staging.join("rawdata/sub-B")).unwrap();
    fs::write(staging.join("rawdata/sub-B/new.nii"), "new B").unwrap();
    let plan = bound_plan(&project, &["A", "B"], "preflight-all");
    let collision = project.join("rawdata/.sub-B.easl-relocation-preflightall-B-backup");
    fs::write(&collision, "foreign").unwrap();

    let error = relocate(
        &plan,
        1,
        &staging,
        &["A".to_string(), "B".to_string()],
        false,
        false,
    )
    .expect_err("later record collision");

    assert!(error.to_string().contains("collision"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
    assert!(!project.join("rawdata/sub-A/new.nii").exists());
    assert_eq!(fs::read_to_string(&collision).unwrap(), "foreign");
    assert!(
        !project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );
}

#[test]
fn existing_dataset_description_is_never_overwritten() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(project.join("rawdata/dataset_description.json"), "existing").unwrap();
    fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-existing");

    relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        fs::read_to_string(project.join("rawdata/dataset_description.json")).unwrap(),
        "existing"
    );
}

#[test]
fn concurrent_dataset_description_create_wins_without_overwrite() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-race");
    let _failure = inject_relocation_failure(RelocationFailurePoint::DatasetCollision);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/dataset_description.json")).unwrap(),
        "concurrent-unowned"
    );
}

#[test]
fn dataset_creation_rolls_back_when_no_subject_commits() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).unwrap();
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").unwrap();
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).unwrap();
    fs::write(staging.join("rawdata/dataset_description.json"), "staged").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-rollback");

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert!(!project.join("rawdata/dataset_description.json").exists());
}

#[test]
fn terminal_journal_recovers_after_backups_were_already_cleaned() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "journal-cleanup");
    let backup = project.join("rawdata/.sub-A.easl-relocation-journalcleanup-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::JournalCleanup);

    let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("journal cleanup failure");
    assert!(error.to_string().contains("journal-cleanup"));
    assert!(
        !backup.exists(),
        "terminal cleanup removed proven backup first"
    );
    assert!(
        project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );

    let summary = recover(&project).expect("terminal cleanup recovery");
    assert_eq!(summary.preserved_subjects, ["A"]);
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
    assert!(
        !project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );
}

#[test]
fn recovery_preserves_earlier_commit_and_restores_later_interruption() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::create_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::write(project.join("rawdata/sub-B/old.nii"), "old B").unwrap();
    fs::create_dir_all(project.join("rawdata/sub-C")).unwrap();
    fs::write(project.join("rawdata/sub-C/old.nii"), "old C").unwrap();
    fs::create_dir_all(staging.join("rawdata/sub-C")).unwrap();
    fs::write(staging.join("rawdata/sub-C/new.nii"), "new C").unwrap();
    let plan = bound_plan(&project, &["A", "B", "C"], "mixed-recovery");
    let _failure = inject_relocation_failure(RelocationFailurePoint::Rollback);

    let outcome = relocate(
        &plan,
        1,
        &staging,
        &["A".to_string(), "B".to_string(), "C".to_string()],
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(
        outcome.subjects[1].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    assert_eq!(
        outcome.subjects[2].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    assert_eq!(outcome.subjects[2].phase, "notAttempted");

    let summary = recover(&project).expect("mixed recovery");
    assert_eq!(summary.preserved_subjects, ["A"]);
    assert_eq!(summary.restored_subjects, ["B", "C"]);
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-B/old.nii")).unwrap(),
        "old B"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-C/old.nii")).unwrap(),
        "old C"
    );
}

#[test]
fn recovery_restores_prior_destination_absence() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).unwrap();
    let staging = project.join(".easl_staging");
    fs::create_dir_all(&staging).unwrap();
    let plan = bound_plan(&project, &["A"], "absent-recovery");
    let _failure = inject_relocation_failure(RelocationFailurePoint::Rollback);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();
    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    recover(&project).expect("absence recovery");
    assert!(!project.join("rawdata/sub-A").exists());
}

#[test]
fn recovery_without_a_journal_is_a_nonmutating_noop() {
    let workspace = tempdir().expect("workspace");
    fs::write(workspace.path().join("sentinel"), "keep").unwrap();

    let summary = recover(workspace.path()).expect("no-journal recovery");

    assert!(summary.preserved_subjects.is_empty());
    assert!(summary.restored_subjects.is_empty());
    assert!(summary.cleaned_subjects.is_empty());
    assert!(summary.cleanup_errors.is_empty());
    assert_eq!(
        fs::read_to_string(workspace.path().join("sentinel")).unwrap(),
        "keep"
    );
}

#[test]
fn recovery_cleanup_failure_is_warning_with_authoritative_new_state() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "cleanup-warning");
    {
        let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);
        relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();
    }
    let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);

    let summary = recover(&project).expect("cleanup warning does not block authority");

    assert_eq!(summary.preserved_subjects, ["A"]);
    assert_eq!(summary.cleanup_errors.len(), 1);
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
    assert!(
        project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );
}

#[test]
fn malformed_and_foreign_journals_block_before_any_recovery_mutation() {
    for foreign_identity in [true, false] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], "unsafe-journal");
        {
            let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();
        }
        let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
        assert_eq!(journal["version"], 2);
        if foreign_identity {
            journal["projectIdentity"] = "foreign".into();
        } else {
            journal["subjects"][0]["artifacts"][0]["destination"] = "../escape".into();
        }
        fs::write(&journal_path, serde_json::to_vec_pretty(&journal).unwrap()).unwrap();
        let destination_before = fs::read(project.join("rawdata/sub-A/new.nii")).unwrap();

        assert!(recover(&project).is_err());
        assert_eq!(
            fs::read(project.join("rawdata/sub-A/new.nii")).unwrap(),
            destination_before
        );
    }
}
