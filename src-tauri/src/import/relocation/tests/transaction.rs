use crate::import_relocation::{
    RelocationFailurePoint, RelocationSubjectStatus, bind_plan, create_plan,
    inject_relocation_failure, recover, relocate,
};
use std::fs;
use tempfile::tempdir;

use super::common::{bound_plan, write_old_and_staged};

#[test]
fn relocation_replaces_whole_subject_and_preserves_other_subjects() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A/ses-01")).expect("old session");
    fs::create_dir_all(project.join("rawdata/sub-A/ses-02")).expect("obsolete session");
    fs::write(project.join("rawdata/sub-A/ses-01/old.nii"), "old").expect("old");
    fs::write(project.join("rawdata/sub-A/ses-02/old.nii"), "obsolete").expect("obsolete");
    fs::create_dir_all(project.join("rawdata/sub-B")).expect("other");
    fs::write(project.join("rawdata/sub-B/keep.nii"), "keep").expect("keep");
    let mut plan =
        create_plan(&project, &["A".to_string()], "plan-replace".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A/ses-01")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/ses-01/new.nii"), "new").expect("new");

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate");
    assert_eq!(
        outcome.subjects[0].status,
        crate::import_relocation::RelocationSubjectStatus::Committed
    );
    assert!(!project.join("rawdata/sub-A/ses-02").exists());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/ses-01/new.nii")).expect("new"),
        "new"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-B/keep.nii")).expect("keep"),
        "keep"
    );
}

#[test]
fn injected_candidate_and_swap_failures_restore_the_complete_old_subject() {
    for point in [
        RelocationFailurePoint::CandidateCreate,
        RelocationFailurePoint::RecursiveCopy,
        RelocationFailurePoint::FileSync,
        RelocationFailurePoint::ParentSync,
        RelocationFailurePoint::HashVerification,
        RelocationFailurePoint::SourceMutation,
        RelocationFailurePoint::JournalPersist,
        RelocationFailurePoint::DestinationBackup,
        RelocationFailurePoint::CandidateInstall,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
        fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old rawdata");
        let mut plan =
            create_plan(&project, &["A".to_string()], format!("plan-{point:?}")).expect("plan");
        bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
        let staging = project.join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging rawdata");
        fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");

        let _failure = inject_relocation_failure(point);
        let result = relocate(&plan, 1, &staging, &["A".to_string()], false, false);
        if let Ok(outcome) = result {
            assert_eq!(
                outcome.subjects[0].status,
                RelocationSubjectStatus::RolledBack
            );
        } else if project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
        {
            recover(&project).expect("recover failure before subject mutation");
        }
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old rawdata"),
            "old",
            "failure point {point:?}"
        );
        assert!(!project.join("rawdata/sub-A/new.nii").exists());
        assert!(staging.join("rawdata/sub-A/new.nii").exists());
        assert!(
            fs::read_dir(project.join("rawdata"))
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("easl-relocation")),
            "provisional transaction paths must be cleaned for {point:?}"
        );
    }
}

#[test]
fn ancillary_install_failure_rolls_back_rawdata_and_lock_together() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old rawdata");
    let old_lock = crate::import::import_lock_dir_for_relocation(&project, "A");
    fs::create_dir_all(&old_lock).expect("old lock");
    fs::write(old_lock.join("old.status"), "old lock").expect("old lock file");
    let mut plan =
        create_plan(&project, &["A".to_string()], "ancillary-plan".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging rawdata");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");
    let new_lock = crate::import::import_lock_dir_for_relocation(&staging, "A");
    fs::create_dir_all(&new_lock).expect("new lock");
    fs::write(new_lock.join("new.status"), "new lock").expect("new lock file");

    let _failure = inject_relocation_failure(RelocationFailurePoint::AncillaryInstall);
    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
    assert_eq!(
        fs::read_to_string(old_lock.join("old.status")).expect("old lock"),
        "old lock"
    );
    assert!(!old_lock.join("new.status").exists());
}

#[test]
fn candidate_ready_substitution_never_commits_or_deletes_foreign_content() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "candidate-ready-substitution");
    let _failure = inject_relocation_failure(RelocationFailurePoint::SubstituteAfterCandidateReady);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_ne!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
    let candidate =
        project.join("rawdata/.sub-A.easl-relocation-candidatereadysubstitution-A-candidate");
    assert!(candidate.join("foreign").exists());
}

#[test]
fn installed_substitution_before_commit_preserves_backup_and_requires_recovery() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "installed-substitution");
    let backup = project.join("rawdata/.sub-A.easl-relocation-installedsubstitution-A-backup");
    let _failure = inject_relocation_failure(RelocationFailurePoint::SubstituteAfterInstall);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RecoveryRequired
    );
    assert!(backup.join("old.nii").exists());
    assert!(project.join("rawdata/sub-A/foreign").exists());
}

#[test]
fn dataset_candidate_and_installed_substitutions_are_never_accepted() {
    for point in [
        RelocationFailurePoint::SubstituteDatasetAfterCandidateReady,
        RelocationFailurePoint::SubstituteDatasetAfterInstall,
    ] {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
        let plan = bound_plan(&project, &["A"], &format!("dataset-substitute-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect_err("dataset substitution must stop relocation");

        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
        assert!(recover(&project).is_err());
    }
}

#[test]
fn rolled_back_outcome_preserves_original_failure_phase() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "failure-phase");
    let _failure = inject_relocation_failure(RelocationFailurePoint::CandidateInstall);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert_eq!(outcome.subjects[0].phase, "install");
    let frontend: serde_json::Value = serde_json::to_value(&outcome).unwrap();
    assert_eq!(frontend["subjects"][0]["status"], "rolledBack");
    assert_eq!(frontend["subjects"][0]["phase"], "install");
}

#[test]
fn stale_journal_temp_never_blocks_a_new_unique_write() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "stale-temp");
    let stale = project.join(".easl_import_relocation.json.staletemp.1.tmp");
    fs::write(&stale, "unowned stale temp").unwrap();

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(fs::read_to_string(&stale).unwrap(), "unowned stale temp");
}

#[test]
fn late_raw_install_failure_rolls_back_logs_locks_and_legacy_custody() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let old_lock = crate::import::import_lock_dir_for_relocation(&project, "A");
    fs::create_dir_all(&old_lock).unwrap();
    fs::write(old_lock.join("old.status"), "old lock").unwrap();
    let new_lock = crate::import::import_lock_dir_for_relocation(&staging, "A");
    fs::create_dir_all(&new_lock).unwrap();
    fs::write(new_lock.join("new.status"), "new lock").unwrap();
    let logs = project.join("derivatives/ExploreASL/log");
    let staged_logs = staging.join("derivatives/ExploreASL/log");
    fs::create_dir_all(&logs).unwrap();
    fs::create_dir_all(&staged_logs).unwrap();
    fs::write(logs.join("import_sub-A.log"), "old log").unwrap();
    fs::write(staged_logs.join("import_sub-A.log"), "new log").unwrap();
    let legacy = project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-A_ses-01");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join("locked"), "old legacy").unwrap();
    let plan = bound_plan(&project, &["A"], "ancillary-late-rollback");
    let _failure = inject_relocation_failure(RelocationFailurePoint::CandidateInstall);

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).unwrap();

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert_eq!(
        fs::read_to_string(old_lock.join("old.status")).unwrap(),
        "old lock"
    );
    assert!(!old_lock.join("new.status").exists());
    assert_eq!(
        fs::read_to_string(logs.join("import_sub-A.log")).unwrap(),
        "old log"
    );
    assert_eq!(
        fs::read_to_string(legacy.join("locked")).unwrap(),
        "old legacy"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn later_subject_failure_preserves_earlier_commit_and_leaves_later_subjects_untouched() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    for subject in ["A", "B", "C"] {
        fs::create_dir_all(project.join(format!("rawdata/sub-{subject}"))).expect("old rawdata");
        fs::write(
            project.join(format!("rawdata/sub-{subject}/old.nii")),
            format!("old {subject}"),
        )
        .expect("old file");
    }
    let mut plan = create_plan(
        &project,
        &["A".to_string(), "B".to_string()],
        "multi-subject-plan".to_string(),
    )
    .expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string(), "B".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("A staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new A").expect("A new file");
    // B is owned as succeeded but has no staged rawdata, so it must roll back without
    // reaching C or erasing A's durable commit.

    let outcome = relocate(
        &plan,
        1,
        &staging,
        &["A".to_string(), "B".to_string()],
        false,
        false,
    )
    .expect("outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(
        outcome.subjects[1].status,
        RelocationSubjectStatus::RolledBack
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).expect("A new"),
        "new A"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-B/old.nii")).expect("B old"),
        "old B"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-C/old.nii")).expect("C old"),
        "old C"
    );
    assert!(staging.join("rawdata/sub-A/new.nii").exists());
    assert!(staging.join("rawdata/sub-A/new.nii").exists());
}

#[test]
fn unowned_reserved_candidate_collision_preserves_destination() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old rawdata");
    let mut plan =
        create_plan(&project, &["A".to_string()], "collision".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    fs::create_dir_all(project.join("rawdata/.sub-A.easl-relocation-collision-A-candidate"))
        .expect("collision");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");

    let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("preflight collision");

    assert!(error.contains("collision"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
    assert!(
        project
            .join("rawdata/.sub-A.easl-relocation-collision-A-candidate")
            .exists()
    );
}

#[test]
fn install_failure_restores_destination_absence_when_no_prior_subject_exists() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).expect("project");
    let mut plan = create_plan(&project, &["A".to_string()], "absent".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");

    let _failure = inject_relocation_failure(RelocationFailurePoint::CandidateInstall);
    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert!(!project.join("rawdata/sub-A").exists());
    assert!(staging.join("rawdata/sub-A/new.nii").exists());
}

#[test]
fn relocation_updates_only_subject_ancillary_artifacts_and_preserves_processing_data() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old rawdata");
    let old_lock = crate::import::import_lock_dir_for_relocation(&project, "A");
    fs::create_dir_all(&old_lock).expect("old lock");
    fs::write(old_lock.join("old.status"), "old").expect("old lock file");
    let logs = project.join("derivatives/ExploreASL/log");
    fs::create_dir_all(&logs).expect("logs");
    fs::write(logs.join("import_sub-A.log"), "old log").expect("old log");
    fs::write(logs.join("import_sub-B.log"), "keep log").expect("other log");
    let legacy = project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    fs::create_dir_all(legacy.join("sub-A_ses-01")).expect("legacy A");
    fs::create_dir_all(legacy.join("sub-B_ses-01")).expect("legacy B");
    let processing = project.join("derivatives/ExploreASL/Structural/keep.txt");
    fs::create_dir_all(processing.parent().expect("processing parent")).expect("processing");
    fs::write(&processing, "keep processing").expect("processing file");
    let mut plan = create_plan(
        &project,
        &["A".to_string()],
        "ancillary-success".to_string(),
    )
    .expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging rawdata");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");
    fs::write(
        staging.join("rawdata/dataset_description.json"),
        "new description",
    )
    .expect("dataset description");
    let new_lock = crate::import::import_lock_dir_for_relocation(&staging, "A");
    fs::create_dir_all(&new_lock).expect("new lock");
    fs::write(new_lock.join("new.status"), "new").expect("new lock file");
    let staged_logs = staging.join("derivatives/ExploreASL/log");
    fs::create_dir_all(&staged_logs).expect("staging logs");
    fs::write(staged_logs.join("import_sub-A.log"), "new log").expect("new log");

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::Committed
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).expect("new"),
        "new"
    );
    assert_eq!(
        fs::read_to_string(new_lock.join("new.status")).expect("new lock"),
        "new"
    );
    assert_eq!(
        fs::read_to_string(logs.join("import_sub-A.log")).expect("new log"),
        "new log"
    );
    assert_eq!(
        fs::read_to_string(logs.join("import_sub-B.log")).expect("other log"),
        "keep log"
    );
    assert!(!legacy.join("sub-A_ses-01").exists());
    assert!(legacy.join("sub-B_ses-01").exists());
    assert_eq!(
        fs::read_to_string(&processing).expect("processing"),
        "keep processing"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/dataset_description.json")).expect("description"),
        "new description"
    );
}

#[test]
fn relocation_uses_only_native_succeeded_subjects_from_the_confirmed_plan() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    for subject in ["A", "B"] {
        fs::create_dir_all(project.join(format!("rawdata/sub-{subject}"))).expect("old rawdata");
        fs::write(
            project.join(format!("rawdata/sub-{subject}/old.nii")),
            "old",
        )
        .expect("old file");
    }
    let mut plan = create_plan(
        &project,
        &["A".to_string(), "B".to_string()],
        "succeeded-only".to_string(),
    )
    .expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string(), "B".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("A staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new A").expect("A file");
    fs::create_dir_all(staging.join("rawdata/sub-B")).expect("partial B staging");
    fs::write(staging.join("rawdata/sub-B/partial.nii"), "partial").expect("B file");

    let outcome =
        relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate A only");

    assert_eq!(outcome.subjects.len(), 1);
    assert_eq!(outcome.subjects[0].subject, "A");
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).expect("A"),
        "new A"
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-B/old.nii")).expect("B"),
        "old"
    );
    assert!(staging.join("rawdata/sub-B/partial.nii").exists());
}

#[test]
fn log_subject_matching_does_not_treat_sub_ab_as_sub_a() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
    let mut plan =
        create_plan(&project, &["A".to_string()], "exact-log".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new");
    let logs = staging.join("derivatives/ExploreASL/log");
    fs::create_dir_all(&logs).expect("logs");
    fs::write(logs.join("import_sub-AB.log"), "B log").expect("B log");

    relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate");

    assert!(
        !project
            .join("derivatives/ExploreASL/log/import_sub-AB.log")
            .exists()
    );
}

#[cfg(unix)]
#[test]
fn relocation_rejects_symlink_path_components_before_destination_mutation() {
    use std::os::unix::fs::symlink;

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
    let mut plan = create_plan(
        &project,
        &["A".to_string()],
        "symlink-component".to_string(),
    )
    .expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    let staged_rawdata = project.join("staged-rawdata");
    fs::create_dir_all(staged_rawdata.join("sub-A")).expect("staged rawdata");
    fs::write(staged_rawdata.join("sub-A/new.nii"), "new").expect("new");
    fs::create_dir_all(&staging).expect("staging");
    symlink(&staged_rawdata, staging.join("rawdata")).expect("rawdata symlink");

    let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("symlink component must block relocation");

    assert!(error.contains("Symlink"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
}

#[cfg(unix)]
#[test]
fn relocation_rejects_special_source_entries_without_touching_destination() {
    use std::process::Command;

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
    let mut plan =
        create_plan(&project, &["A".to_string()], "special-entry".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    let fifo = staging.join("rawdata/sub-A/unsupported.fifo");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo")
            .success()
    );

    let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

    assert_eq!(
        outcome.subjects[0].status,
        RelocationSubjectStatus::RolledBack
    );
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
}

#[test]
fn dataset_description_failure_happens_before_any_subject_commit() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(project.join("rawdata/sub-A")).expect("old rawdata");
    fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
    let mut plan =
        create_plan(&project, &["A".to_string()], "dataset-before".to_string()).expect("plan");
    bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new");
    fs::write(
        staging.join("rawdata/dataset_description.json"),
        "description",
    )
    .expect("description");
    let _failure = inject_relocation_failure(RelocationFailurePoint::DatasetInstall);

    let error = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
        .expect_err("dataset failure");

    assert!(error.contains("Dataset description"));
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
        "old"
    );
    assert!(
        project
            .join(crate::import_relocation::JOURNAL_FILE)
            .exists()
    );
    recover(&project).expect("dataset orphan recovery");
    assert!(!project.join("rawdata/dataset_description.json").exists());
}
