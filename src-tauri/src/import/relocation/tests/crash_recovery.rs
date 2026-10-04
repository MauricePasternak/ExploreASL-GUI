use crate::import_relocation::{
    RelocationFailurePoint, inject_relocation_failure, recover, relocate,
};
use std::fs;
use tempfile::tempdir;

use super::common::{bound_plan, write_old_and_staged};

#[test]
fn activation_recovery_resolves_every_interrupted_rawdata_phase() {
    for (point, expected_file, expected_contents) in [
        (
            RelocationFailurePoint::InterruptAfterCandidatePopulationOperation,
            "old.nii",
            "old",
        ),
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
        let workspace = tempdir().unwrap();
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("interrupt-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".into()], false, false)
            .expect_err("simulated interruption");
        recover(&project).expect("activation recovery");
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A").join(expected_file)).unwrap(),
            expected_contents,
            "interruption point {point:?}"
        );
    }
}

#[test]
fn activation_cleans_an_owned_candidate_left_before_ready_checkpoint() {
    let workspace = tempdir().unwrap();
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    let plan = bound_plan(&project, &["A"], "candidate-before-ready");
    {
        let _failure = inject_relocation_failure(
            RelocationFailurePoint::InterruptAfterCandidatePopulationOperation,
        );
        relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
    }

    let state = crate::app::state::AppState::default();
    let summary = crate::project::lifecycle::set_active_project_impl(
        project.to_string_lossy().to_string(),
        &state,
    )
    .expect("activation recovery");

    assert_eq!(summary.restored_subjects, ["A"]);
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn activation_rolls_back_uncommitted_dataset_description() {
    let workspace = tempdir().unwrap();
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-install");
    {
        let _failure = inject_relocation_failure(
            RelocationFailurePoint::InterruptAfterDatasetInstallOperation,
        );
        relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
    }

    let state = crate::app::state::AppState::default();
    crate::project::lifecycle::set_active_project_impl(
        project.to_string_lossy().to_string(),
        &state,
    )
    .expect("dataset recovery");

    assert!(!project.join("rawdata/dataset_description.json").exists());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}

#[test]
fn activation_restores_authoritative_subject_absence() {
    let workspace = tempdir().unwrap();
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).unwrap();
    let staging = project.join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-A")).unwrap();
    fs::write(staging.join("rawdata/sub-A/new.nii"), "new").unwrap();
    let plan = bound_plan(&project, &["A"], "subject-absent");
    {
        let _failure = inject_relocation_failure(RelocationFailurePoint::InterruptAfterInstall);
        relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
    }

    let state = crate::app::state::AppState::default();
    crate::project::lifecycle::set_active_project_impl(
        project.to_string_lossy().to_string(),
        &state,
    )
    .expect("absence recovery");

    assert!(!project.join("rawdata/sub-A").exists());
}

#[test]
fn rawdata_rollback_replays_each_interruption_boundary() {
    for point in [
        RelocationFailurePoint::InterruptRollbackAfterIntent,
        RelocationFailurePoint::InterruptRollbackAfterDestinationRemoval,
        RelocationFailurePoint::InterruptRollbackAfterBackupRestore,
        RelocationFailurePoint::InterruptRollbackAfterCandidateCleanup,
    ] {
        let workspace = tempdir().unwrap();
        let project = workspace.path().join("project");
        let staging = write_old_and_staged(&project, "A");
        let plan = bound_plan(&project, &["A"], &format!("rollback-{point:?}"));
        let _failure = inject_relocation_failure(point);

        relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
        recover(&project).expect("idempotent rawdata rollback");
        assert_eq!(
            fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
            "old"
        );
    }
}

#[test]
fn recovery_preflights_all_subjects_before_mutation() {
    let workspace = tempdir().unwrap();
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::create_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::write(project.join("rawdata/sub-B/old.nii"), "old B").unwrap();
    fs::create_dir_all(staging.join("rawdata/sub-B")).unwrap();
    fs::write(staging.join("rawdata/sub-B/new.nii"), "new B").unwrap();
    let plan = bound_plan(&project, &["A", "B"], "preflight-recovery");
    {
        let _failure = inject_relocation_failure(RelocationFailurePoint::Cleanup);
        relocate(&plan, 1, &staging, &["A".into(), "B".into()], false, false).unwrap();
    }
    let journal_path = project.join(crate::import_relocation::JOURNAL_FILE);
    let mut journal: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    journal["terminalOutcome"] = serde_json::Value::Null;
    journal["subjects"][0]["phase"] = "planned".into();
    journal["subjects"][0]["rawdata"]["phase"] = "rolledBack".into();
    journal["subjects"][0]["derivedReconciled"] = false.into();
    journal["subjects"][1]["phase"] = "planned".into();
    journal["subjects"][1]["rawdata"]["phase"] = "rolledBack".into();
    journal["subjects"][1]["derivedReconciled"] = false.into();
    fs::remove_dir_all(project.join("rawdata/sub-B")).unwrap();
    fs::write(&journal_path, serde_json::to_vec_pretty(&journal).unwrap()).unwrap();

    assert!(recover(&project).is_err());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/new.nii")).unwrap(),
        "new"
    );
}

#[test]
fn dataset_rollback_replays_destination_removal_and_candidate_cleanup() {
    for initial in [
        RelocationFailurePoint::InterruptAfterDatasetInstallIntent,
        RelocationFailurePoint::InterruptAfterDatasetInstallOperation,
        RelocationFailurePoint::InterruptAfterDatasetInstall,
    ] {
        for rollback in [
            RelocationFailurePoint::InterruptDatasetRollbackAfterIntent,
            RelocationFailurePoint::InterruptDatasetRollbackAfterDestinationRemoval,
            RelocationFailurePoint::InterruptDatasetRollbackAfterCandidateCleanup,
            RelocationFailurePoint::ParentSync,
        ] {
            if initial == RelocationFailurePoint::InterruptAfterDatasetInstallIntent
                && rollback
                    == RelocationFailurePoint::InterruptDatasetRollbackAfterDestinationRemoval
            {
                continue;
            }
            let workspace = tempdir().unwrap();
            let project = workspace.path().join("project");
            let staging = write_old_and_staged(&project, "A");
            fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
            let plan = bound_plan(&project, &["A"], "dataset-rollback-replay");
            {
                let _failure = inject_relocation_failure(initial);
                relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
            }
            {
                let _failure = inject_relocation_failure(rollback);
                recover(&project).expect_err("rollback interruption");
            }

            recover(&project).expect("resume dataset rollback");
            assert!(!project.join("rawdata/dataset_description.json").exists());
            assert_eq!(
                fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
                "old"
            );
            assert!(staging.exists());
            assert!(
                !project
                    .join(crate::import_relocation::JOURNAL_FILE)
                    .exists()
            );
        }
    }
}

#[test]
fn dataset_rollback_recovers_a_partial_copy_without_a_ready_fingerprint() {
    let workspace = tempdir().unwrap();
    let project = workspace.path().join("project");
    let staging = write_old_and_staged(&project, "A");
    fs::write(staging.join("rawdata/dataset_description.json"), "dataset").unwrap();
    let plan = bound_plan(&project, &["A"], "dataset-partial");
    {
        let _failure = inject_relocation_failure(RelocationFailurePoint::FileSync);
        relocate(&plan, 1, &staging, &["A".into()], false, false).unwrap_err();
    }
    {
        let _failure =
            inject_relocation_failure(RelocationFailurePoint::InterruptDatasetRollbackAfterIntent);
        recover(&project).unwrap_err();
    }
    let journal: serde_json::Value = serde_json::from_slice(
        &fs::read(project.join(crate::import_relocation::JOURNAL_FILE)).unwrap(),
    )
    .unwrap();
    assert_eq!(journal["dataset"]["phase"], "rollbackIntent");
    assert!(journal["dataset"]["fingerprint"].is_null());
    let candidate = project.join(journal["dataset"]["candidate"].as_str().unwrap());
    assert!(candidate.exists());

    recover(&project).expect("partial dataset candidate remains transaction-owned");

    assert!(!candidate.exists());
    assert!(!project.join("rawdata/dataset_description.json").exists());
    assert_eq!(
        fs::read_to_string(project.join("rawdata/sub-A/old.nii")).unwrap(),
        "old"
    );
}
