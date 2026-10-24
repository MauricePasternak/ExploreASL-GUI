use crate::processing::{
    journal::{self, LaunchJournal, Phase},
    transaction::LaunchTransaction,
};
use std::fs;
use uuid::Uuid;

fn setup() -> (tempfile::TempDir, Uuid) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir_all(temp.path().join("derivatives/ExploreASL/log")).unwrap();
    fs::write(
        temp.path().join("derivatives/ExploreASL/dataPar.json"),
        b"old",
    )
    .unwrap();
    fs::write(
        temp.path()
            .join("derivatives/ExploreASL/log/xASL_module_Population.log"),
        b"old-log",
    )
    .unwrap();
    fs::write(temp.path().join("scientific.nii"), b"science").unwrap();
    (temp, Uuid::new_v4())
}

#[test]
fn journal_reopens_every_precommit_mutation_boundary_and_restores_exact_state() {
    for fault in [
        "beforeRecordWrite",
        "afterRecordReplace",
        "afterRecordWrite",
        "beforeRename",
        "afterRename",
        "beforeInstall",
        "afterInstall",
    ] {
        let (temp, run_id) = setup();
        let mut transaction = LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        journal::inject_fault(fault);
        assert!(transaction.prepare(b"new").is_err(), "{fault}");
        drop(transaction);
        if fault != "beforeRecordWrite" {
            let mut reopened = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
            reopened.rollback().unwrap();
            drop(reopened);
            let mut reopened = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
            reopened.rollback().unwrap();
            assert_eq!(reopened.phase(), Phase::RolledBack);
        }
        assert_eq!(
            fs::read(temp.path().join("derivatives/ExploreASL/dataPar.json")).unwrap(),
            b"old",
            "{fault}"
        );
        assert_eq!(
            fs::read(
                temp.path()
                    .join("derivatives/ExploreASL/log/xASL_module_Population.log")
            )
            .unwrap(),
            b"old-log",
            "{fault}"
        );
        assert_eq!(
            fs::read(temp.path().join("scientific.nii")).unwrap(),
            b"science"
        );
    }
}
#[test]
fn committed_launch_preserves_outputs_and_requires_cleanup() {
    for replace in [false, true] {
        let (temp, run_id) = setup();
        let mut transaction = LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        transaction.prepare(b"new").unwrap();
        transaction.commit().unwrap();
        let candidate = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/runs/{run_id}/candidate-0"
        ));
        assert!(
            !candidate.exists(),
            "install witness must retire before execution"
        );
        let data_par = temp.path().join("derivatives/ExploreASL/dataPar.json");
        if replace {
            fs::remove_file(&data_par).unwrap();
        }
        // ExploreASL rewrites dataPar in place; replacement must also survive.
        fs::write(&data_par, b"engine configuration").unwrap();
        assert!(transaction.rollback().is_err());
        drop(transaction);
        let mut reopened = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
        reopened.cleanup().unwrap();
        assert_eq!(
            fs::read(temp.path().join("derivatives/ExploreASL/dataPar.json")).unwrap(),
            b"engine configuration"
        );
        assert_eq!(
            fs::read(temp.path().join("scientific.nii")).unwrap(),
            b"science"
        );
    }
}

#[test]
fn commit_and_cleanup_preserve_foreign_install_witnesses() {
    for replace in [false, true] {
        let (temp, run_id) = setup();
        let mut transaction = LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        transaction.prepare(b"new").unwrap();
        let candidate = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/runs/{run_id}/candidate-0"
        ));
        let bytes = if replace {
            // Same bytes on a different inode are still a foreign replacement.
            fs::remove_file(&candidate).unwrap();
            b"new".as_slice()
        } else {
            b"foreign".as_slice()
        };
        fs::write(&candidate, bytes).unwrap();
        assert!(transaction.commit().is_err());
        assert_eq!(fs::read(&candidate).unwrap(), bytes);
        let mut reopened = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
        assert_eq!(reopened.phase(), Phase::ExecutionCommitted);
        assert!(reopened.rollback().is_err());
        assert!(reopened.cleanup().is_err());
        assert_eq!(fs::read(&candidate).unwrap(), bytes);
        assert_eq!(
            fs::read(temp.path().join("scientific.nii")).unwrap(),
            b"science"
        );
    }
}

#[test]
fn interrupted_witness_retirement_reopens_as_committed_cleanup_only() {
    for fault in ["afterOwnedRemoval", "afterExecutionCommit"] {
        let (temp, run_id) = setup();
        let mut transaction = LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        transaction.prepare(b"new").unwrap();
        journal::inject_fault(fault);
        assert!(transaction.commit().is_err(), "{fault}");
        drop(transaction);
        let mut reopened = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
        assert_eq!(reopened.phase(), Phase::ExecutionCommitted);
        assert!(reopened.rollback().is_err());
        reopened.cleanup().unwrap();
        assert_eq!(reopened.phase(), Phase::Cleaned);
        assert_eq!(
            fs::read(temp.path().join("derivatives/ExploreASL/dataPar.json")).unwrap(),
            b"new"
        );
        assert_eq!(
            fs::read(temp.path().join("scientific.nii")).unwrap(),
            b"science"
        );
    }
}
#[test]
fn manifest_rejects_relative_out_of_namespace_paths_and_invalid_backup_mapping() {
    for kind in ["destination", "backup", "version"] {
        let (temp, run_id) = setup();
        let mut transaction = LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        transaction.prepare(b"new").unwrap();
        drop(transaction);
        let path = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/runs/{}/launch.json",
            run_id
        ));
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match kind {
            "destination" => manifest["entries"][0]["destination"] = "participants.tsv".into(),
            "backup" => {
                manifest["entries"][0]["backup"] = "derivatives/ExploreASL_GUI/foreign".into()
            }
            _ => manifest["version"] = 99.into(),
        }
        let bytes = serde_json::to_vec(&manifest).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(LaunchJournal::reopen(temp.path(), &run_id.to_string()).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            fs::read(temp.path().join("scientific.nii")).unwrap(),
            b"science"
        );
    }
}

#[test]
fn guardian_era_manifest_is_rejected_with_guidance_and_preserved() {
    let (temp, run_id) = setup();
    let mut transaction = LaunchTransaction::plan(
        temp.path(),
        &run_id.to_string(),
        &[false, false, true],
        "",
        false,
    )
    .unwrap();
    transaction.prepare(b"new").unwrap();
    drop(transaction);
    let path = temp.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/runs/{run_id}/launch.json"
    ));
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["version"] = serde_json::json!(1);
    manifest["attempt"] = serde_json::json!({"legacy": true});
    let bytes = serde_json::to_vec(&manifest).unwrap();
    fs::write(&path, &bytes).unwrap();

    let error = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Guardian-era processing launch journal")
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn quarantine_rejects_scientific_descendants_and_preserves_unknown_bytes() {
    let (temp, run_id) = setup();
    let scientific = temp
        .path()
        .join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-001_01/scientific.nii");
    fs::create_dir_all(scientific.parent().unwrap()).unwrap();
    fs::write(&scientific, b"science").unwrap();
    assert!(
        LaunchTransaction::plan(
            temp.path(),
            &run_id.to_string(),
            &[false, false, true],
            "",
            true
        )
        .is_err()
    );
    assert_eq!(fs::read(scientific).unwrap(), b"science");
}

#[test]
fn partially_removed_owned_backup_tree_retries_and_preserves_unknown_children() {
    let (temp, run_id) = setup();
    let target = temp
        .path()
        .join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/sub-001_01");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("100_a.status"), b"a").unwrap();
    fs::write(target.join("200_b.status"), b"b").unwrap();
    let mut journal = LaunchJournal::new(temp.path(), &run_id.to_string(), &[target]).unwrap();
    journal.prepare(&[]).unwrap();
    journal.commit().unwrap();
    let backup = temp.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/runs/{}/backups/0",
        run_id
    ));
    journal::inject_fault("afterOwnedRemoval");
    assert!(journal.cleanup().is_err());
    drop(journal);
    let mut journal = LaunchJournal::reopen(temp.path(), &run_id.to_string()).unwrap();
    fs::write(backup.join("foreign.status"), b"foreign").unwrap();
    assert!(journal.cleanup().is_err());
    assert_eq!(fs::read(backup.join("foreign.status")).unwrap(), b"foreign");
    assert_eq!(fs::read(backup.join("200_b.status")).unwrap(), b"b");
    fs::remove_file(backup.join("foreign.status")).unwrap();
    journal.cleanup().unwrap();
    assert!(!backup.exists());
    assert_eq!(journal.phase(), Phase::Cleaned);
}

#[test]
fn compaction_validates_settled_manifest_mappings_and_evidence() {
    for kind in ["destination", "backup", "evidence"] {
        let (temp, run_id) = setup();
        let target = temp.path().join("derivatives/ExploreASL/dataPar.json");
        let mut journal = LaunchJournal::new(temp.path(), &run_id.to_string(), &[target]).unwrap();
        journal.prepare(&[]).unwrap();
        journal.rollback().unwrap();
        let path = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/runs/{}/launch.json",
            run_id
        ));
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match kind {
            "destination" => value["entries"][0][kind] = "participants.tsv".into(),
            "backup" => value["entries"][0][kind] = "foreign".into(),
            _ => value["entries"][0]["prior"]["digest"] = "invalid".into(),
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(
            journal::compaction_state(temp.path(), run_id).is_err(),
            "{kind}"
        );
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
}

#[test]
fn copied_unresolved_journal_rejects_foreign_directory_identity() {
    let (original, run_id) = setup();
    let copied = tempfile::tempdir().unwrap();
    let mut journal = LaunchJournal::new(original.path(), &run_id.to_string(), &[]).unwrap();
    journal.prepare(&[]).unwrap();
    for entry in walkdir::WalkDir::new(original.path()).min_depth(1) {
        let entry = entry.unwrap();
        let target = copied
            .path()
            .join(entry.path().strip_prefix(original.path()).unwrap());
        if entry.file_type().is_dir() {
            fs::create_dir(&target).unwrap();
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
    assert!(LaunchJournal::reopen(copied.path(), &run_id.to_string()).is_err());
    assert!(copied.path().join("derivatives/ExploreASL/lock").is_dir());
}

#[test]
fn confirmed_reopen_rebinds_a_copied_unresolved_journal() {
    let (original, run_id) = setup();
    let copied = tempfile::tempdir().unwrap();
    let mut journal = LaunchJournal::new(original.path(), &run_id.to_string(), &[]).unwrap();
    journal.prepare(&[]).unwrap();
    drop(journal);
    for entry in walkdir::WalkDir::new(original.path()).min_depth(1) {
        let entry = entry.unwrap();
        let target = copied
            .path()
            .join(entry.path().strip_prefix(original.path()).unwrap());
        if entry.file_type().is_dir() {
            fs::create_dir_all(target).unwrap();
        } else {
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::copy(entry.path(), target).unwrap();
        }
    }

    assert!(LaunchJournal::reopen(copied.path(), &run_id.to_string()).is_err());
    LaunchJournal::reopen_confirmed(copied.path(), &run_id.to_string()).unwrap();
}
