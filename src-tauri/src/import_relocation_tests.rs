#[cfg(test)]
mod tests {
    use crate::import_relocation::{
        RelocationFailurePoint, RelocationSubjectStatus, bind_plan, create_plan,
        inject_relocation_failure, inventory_subject, plan_relocation, recover, relocate,
        transaction_test_fingerprint, validate_plan_scope,
    };
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn planner_reports_empty_and_populated_project_relative_subject_inventories() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(&project).expect("project");

        let empty = plan_relocation(&project, &["A".to_string()]).expect("empty plan");
        assert!(empty.subjects[0].entries.is_empty());

        fs::create_dir_all(project.join("rawdata/sub-A/ses-01")).expect("rawdata");
        fs::write(project.join("rawdata/sub-A/ses-01/asl.nii"), "old").expect("file");
        fs::create_dir_all(project.join("rawdata/sub-A/ses-02")).expect("extra session");
        fs::write(project.join("rawdata/sub-A/obsolete.json"), "old").expect("extra file");
        let inventory = inventory_subject(&project, "A").expect("inventory");

        assert_eq!(inventory.sessions, vec!["ses-01", "ses-02"]);
        assert!(
            inventory
                .entries
                .iter()
                .all(|entry| !std::path::Path::new(&entry.path).is_absolute())
        );
        assert!(
            inventory
                .entries
                .iter()
                .any(|entry| entry.path == "rawdata/sub-A/obsolete.json")
        );
        assert!(
            inventory
                .entries
                .iter()
                .any(|entry| entry.path == "rawdata/sub-A/ses-02")
        );
    }

    #[test]
    fn planner_fingerprint_is_deterministic_and_detects_logs_and_locks() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(project.join("rawdata/sub-A")).expect("rawdata");
        fs::write(project.join("rawdata/sub-A/image.nii"), "old").expect("rawdata file");
        fs::create_dir_all(project.join("derivatives/ExploreASL/log")).expect("log dir");
        fs::write(
            project.join("derivatives/ExploreASL/log/import_sub-A.log"),
            "log",
        )
        .expect("log");
        fs::create_dir_all(
            project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-A_ses-01"),
        )
        .expect("legacy lock");

        let first = inventory_subject(&project, "A").expect("first");
        let second = inventory_subject(&project, "A").expect("second");
        assert_eq!(first.fingerprint, second.fingerprint);
        assert!(
            first
                .entries
                .iter()
                .any(|entry| entry.path.contains("import_sub-A.log"))
        );
        assert!(
            first
                .entries
                .iter()
                .any(|entry| entry.path.contains("BIDS2Legacy/sub-A_ses-01"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn planner_rejects_symlink_entries_and_unsafe_project_roots() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        fs::create_dir_all(project.join("rawdata/sub-A")).expect("rawdata");
        symlink("/etc/passwd", project.join("rawdata/sub-A/escape")).expect("symlink");
        assert!(inventory_subject(&project, "A").is_err());
        assert!(plan_relocation(&workspace.path().join("missing"), &["A".to_string()]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn planner_rejects_symlink_and_special_rawdata_ancestors() {
        use std::os::unix::fs::symlink;
        use std::process::Command;

        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let external = workspace.path().join("external");
        fs::create_dir_all(external.join("sub-A")).unwrap();
        fs::create_dir_all(&project).unwrap();
        symlink(&external, project.join("rawdata")).unwrap();
        assert!(inventory_subject(&project, "A").is_err());

        fs::remove_file(project.join("rawdata")).unwrap();
        assert!(
            Command::new("mkfifo")
                .arg(project.join("rawdata"))
                .status()
                .unwrap()
                .success()
        );
        assert!(inventory_subject(&project, "A").is_err());
    }

    #[test]
    fn plan_rejects_foreign_scope_and_stale_destination_before_relocation() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        let foreign = workspace.path().join("foreign");
        fs::create_dir_all(project.join("rawdata/sub-A")).expect("project rawdata");
        fs::write(project.join("rawdata/sub-A/old.nii"), "old").expect("old");
        fs::create_dir_all(&foreign).expect("foreign");
        let plan = create_plan(&project, &["A".to_string()], "plan-a".to_string()).expect("plan");

        assert!(validate_plan_scope(&plan, &foreign, &["A".to_string()]).is_err());
        assert!(validate_plan_scope(&plan, &project, &["B".to_string()]).is_err());

        let mut bound = plan.clone();
        bind_plan(&mut bound, &project, &["A".to_string()], 7).expect("bind");
        fs::write(project.join("rawdata/sub-A/changed.nii"), "changed").expect("change");
        let staging = project.join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
        fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new");
        let error = relocate(&bound, 7, &staging, &["A".to_string()], false, false)
            .expect_err("stale plan");
        assert!(error.contains("stale"));
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).expect("old"),
            "old"
        );
        assert!(staging.join("rawdata/sub-A/new.nii").exists());
    }

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

        let outcome =
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate");
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
        let outcome =
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

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
        let _failure =
            inject_relocation_failure(RelocationFailurePoint::SubstituteAfterCandidateReady);

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
        let legacy =
            project.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-A_ses-01");
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
            fs::create_dir_all(project.join(format!("rawdata/sub-{subject}")))
                .expect("old rawdata");
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
        let mut plan =
            create_plan(&project, &["A".to_string()], "absent".to_string()).expect("plan");
        bind_plan(&mut plan, &project, &["A".to_string()], 1).expect("bind");
        let staging = project.join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-A")).expect("staging");
        fs::write(staging.join("rawdata/sub-A/new.nii"), "new").expect("new rawdata");

        let _failure = inject_relocation_failure(RelocationFailurePoint::CandidateInstall);
        let outcome =
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

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

        let outcome =
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("relocate");

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
            fs::read_to_string(project.join("rawdata/dataset_description.json"))
                .expect("description"),
            "new description"
        );
    }

    #[test]
    fn relocation_uses_only_native_succeeded_subjects_from_the_confirmed_plan() {
        let workspace = tempdir().expect("workspace");
        let project = workspace.path().join("project");
        for subject in ["A", "B"] {
            fs::create_dir_all(project.join(format!("rawdata/sub-{subject}")))
                .expect("old rawdata");
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

        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("relocate A only");

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

        let outcome =
            relocate(&plan, 1, &staging, &["A".to_string()], false, false).expect("outcome");

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

    fn bound_plan(
        project: &std::path::Path,
        subjects: &[&str],
        id: &str,
    ) -> crate::import_relocation::RelocationPlan {
        let subjects = subjects
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>();
        let mut plan = create_plan(project, &subjects, id.to_string()).expect("plan");
        bind_plan(&mut plan, project, &subjects, 1).expect("bind");
        plan
    }

    fn write_old_and_staged(project: &std::path::Path, subject: &str) -> std::path::PathBuf {
        fs::create_dir_all(project.join(format!("rawdata/sub-{subject}"))).expect("old rawdata");
        fs::write(
            project.join(format!("rawdata/sub-{subject}/old.nii")),
            "old",
        )
        .expect("old file");
        let staging = project.join(".easl_staging");
        fs::create_dir_all(staging.join(format!("rawdata/sub-{subject}"))).expect("staged rawdata");
        fs::write(
            staging.join(format!("rawdata/sub-{subject}/new.nii")),
            "new",
        )
        .expect("new file");
        staging
    }

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
        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("nonempty rawdata");
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

        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("collision outcome");

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

        let outcome = relocate(&plan, 1, &staging, &["A".to_string()], false, false)
            .expect("collision outcome");

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
            assert!(error.contains("interruption"));
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

            let state = crate::import::AppState::default();
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

            let state = crate::import::AppState::default();
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

        let state = crate::import::AppState::default();
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
        let _failure =
            inject_relocation_failure(RelocationFailurePoint::InterruptAfterDatasetInstall);

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
        let candidate =
            project.join("rawdata/.sub-A.easl-relocation-reservedsubstitution-A-candidate");
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
        let _failure =
            inject_relocation_failure(RelocationFailurePoint::InterruptAfterDatasetReserved);

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

        assert!(error.contains("collision"));
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
        assert!(error.contains("journal-cleanup"));
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
}
