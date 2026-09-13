use crate::processing::transaction::LaunchTransaction;
use std::fs;

#[test]
fn planner_selects_only_native_launch_artifacts_and_rejects_symlinks() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let structural =
        exploreasl.join("lock/xASL_module_Structural/sub-001_01/xASL_module_Structural");
    fs::create_dir_all(structural.join("locked")).unwrap();
    fs::create_dir_all(exploreasl.join("log")).unwrap();
    fs::write(exploreasl.join("dataPar.json"), b"old-data-par").unwrap();
    fs::write(structural.join("step.status"), b"status").unwrap();
    fs::write(
        exploreasl.join("log/xASL_module_Structural_sub-001_01.log"),
        b"log",
    )
    .unwrap();
    fs::write(
        exploreasl.join("log/xASL_module_ASL_sub-001_01.log"),
        b"unselected",
    )
    .unwrap();
    fs::write(
        exploreasl.join("log/xASL_module_Structural_notes.log"),
        b"not-a-subject-log",
    )
    .unwrap();
    fs::write(root.join("participants.tsv"), b"participants").unwrap();

    let transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[true, false, false],
        r"^(?:sub\-001_01)$",
        false,
    )
    .unwrap();
    assert!(
        transaction
            .targets()
            .contains(&exploreasl.join("dataPar.json"))
    );
    assert!(transaction.targets().contains(&structural.join("locked")));
    assert!(
        transaction
            .targets()
            .contains(&structural.join("step.status"))
    );
    assert!(
        transaction
            .targets()
            .contains(&exploreasl.join("log/xASL_module_Structural_sub-001_01.log"))
    );
    assert!(
        !transaction
            .targets()
            .contains(&exploreasl.join("log/xASL_module_ASL_sub-001_01.log"))
    );
    assert!(
        !transaction
            .targets()
            .contains(&exploreasl.join("log/xASL_module_Structural_notes.log"))
    );
    assert!(
        !transaction
            .targets()
            .contains(&root.join("participants.tsv"))
    );

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            root.join("participants.tsv"),
            structural.join("unsafe.status"),
        )
        .unwrap();
        assert!(LaunchTransaction::plan(&root, "run-2", &[true, false, false], "", false).is_err());
    }
}

#[test]
fn preparation_and_rollback_restore_exact_bytes_and_prior_absence() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let log = exploreasl.join("log/xASL_module_ASL_sub-001_01.log");
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(&log, [0, 1, 2, 255]).unwrap();

    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[false, true, false], "", false).unwrap();
    transaction.prepare(b"new-data-par").unwrap();
    assert_eq!(
        fs::read(exploreasl.join("dataPar.json")).unwrap(),
        b"new-data-par"
    );
    assert!(!log.exists());
    transaction.rollback().unwrap();
    assert_eq!(fs::read(&log).unwrap(), [0, 1, 2, 255]);
    assert!(!exploreasl.join("dataPar.json").exists());
    transaction.rollback().unwrap();
}

#[test]
fn planner_clears_stale_locks_in_unselected_modules() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let selected_status = root.join(
        "derivatives/ExploreASL/lock/xASL_module_Structural/sub-001_01/xASL_module_Structural/step.status",
    );
    let unselected_locked = root.join(
        "derivatives/ExploreASL/lock/xASL_module_ASL/sub-002_01/xASL_module_ASL_ASL_1/locked",
    );
    fs::create_dir_all(selected_status.parent().unwrap()).unwrap();
    fs::create_dir_all(&unselected_locked).unwrap();
    fs::write(&selected_status, b"selected").unwrap();

    let transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[true, false, false],
        r"^(?:sub\-001_01)$",
        false,
    )
    .unwrap();

    assert!(transaction.targets().contains(&selected_status));
    assert!(transaction.targets().contains(&unselected_locked));
}

#[test]
fn planner_selects_only_matching_logs_for_alphanumeric_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let log_dir = root.join("derivatives/ExploreASL/log");
    let selected = log_dir.join("xASL_module_Structural_sub-001_visitA.log");
    let unrelated = log_dir.join("xASL_module_Structural_sub-002_visitB.log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(&selected, b"selected").unwrap();
    fs::write(&unrelated, b"unrelated").unwrap();

    let transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[true, false, false],
        r"^sub-001_visitA$",
        false,
    )
    .unwrap();

    assert!(transaction.targets().contains(&selected));
    assert!(!transaction.targets().contains(&unrelated));
}

#[cfg(unix)]
#[test]
fn planner_rejects_dangling_data_par_symlink_without_following_it() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let data_par = root.join("derivatives/ExploreASL/dataPar.json");
    fs::create_dir_all(data_par.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(root.join("outside-target"), &data_par).unwrap();

    assert!(LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).is_err());
    assert!(
        fs::symlink_metadata(data_par)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[cfg(unix)]
#[test]
fn preparation_refuses_data_par_symlink_introduced_after_planning() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(root.join("derivatives/ExploreASL")).unwrap();
    let outside = root.join("outside-target");
    fs::write(&outside, b"outside").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).unwrap();
    let data_par = root.join("derivatives/ExploreASL/dataPar.json");
    std::os::unix::fs::symlink(&outside, &data_par).unwrap();

    assert!(transaction.prepare(b"must-not-write").is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"outside");
    assert!(transaction.rollback().is_ok());
    assert_eq!(fs::read(&outside).unwrap(), b"outside");
}

#[test]
fn preparation_preserves_regular_data_par_replacement_introduced_after_planning() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    fs::create_dir_all(root.join("derivatives/ExploreASL")).unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).unwrap();
    let data_par = root.join("derivatives/ExploreASL/dataPar.json");
    fs::write(&data_par, b"external").unwrap();

    assert!(transaction.prepare(b"must-not-write").is_err());
    transaction.rollback().unwrap();
    assert_eq!(fs::read(data_par).unwrap(), b"external");
}

#[test]
fn prepare_failure_after_data_par_install_restores_the_prior_state() {
    for (name, prior) in [("absent", None), ("existing", Some(b"old-data".as_slice()))] {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().join(name);
        let data_par = root.join("derivatives/ExploreASL/dataPar.json");
        fs::create_dir_all(data_par.parent().unwrap()).unwrap();
        if let Some(prior) = prior {
            fs::write(&data_par, prior).unwrap();
        }
        let mut transaction =
            LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).unwrap();

        crate::processing::journal::inject_fault("afterInstall");
        let error = transaction.prepare(b"new-data").unwrap_err();
        assert!(error.to_string().contains("afterInstall"));
        assert_eq!(fs::read(&data_par).unwrap(), b"new-data");
        transaction.rollback().unwrap();
        match prior {
            Some(prior) => assert_eq!(fs::read(&data_par).unwrap(), prior),
            None => assert!(!data_par.exists()),
        }
    }
}

#[test]
fn planner_covers_native_scope_and_rejects_unsupported_selected_entries() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let lock = exploreasl.join("lock");
    let structural = lock.join("xASL_module_Structural/sub-001_01/xASL_module_Structural");
    let asl = lock.join("xASL_module_ASL/sub-001_01/xASL_module_ASL_ASL_1");
    let population = lock.join("xASL_module_Population/xASL_module_Population");
    let bids = lock.join("xASL_module_BIDS2Legacy");
    fs::create_dir_all(structural.join("locked")).unwrap();
    fs::create_dir_all(asl.join("locked")).unwrap();
    fs::create_dir_all(&population).unwrap();
    fs::create_dir_all(bids.join("sub-001_01")).unwrap();
    fs::create_dir_all(bids.join("sub-002_01")).unwrap();
    fs::create_dir_all(exploreasl.join("log")).unwrap();
    fs::write(structural.join("struct.status"), b"struct").unwrap();
    fs::write(asl.join("asl.status"), b"asl").unwrap();
    fs::write(population.join("population.status"), b"population").unwrap();
    fs::write(
        exploreasl.join("log/xASL_module_Structural_sub-001_01.log"),
        b"s",
    )
    .unwrap();
    fs::write(exploreasl.join("log/xASL_module_ASL_sub-001_01.log"), b"a").unwrap();
    fs::write(exploreasl.join("log/xASL_module_Population.log"), b"p").unwrap();

    let transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[true, false, false],
        r"^sub\-001_01$",
        true,
    )
    .unwrap();
    assert!(
        transaction
            .targets()
            .contains(&structural.join("struct.status"))
    );
    assert!(!transaction.targets().contains(&asl.join("asl.status")));
    assert!(
        !transaction
            .targets()
            .contains(&population.join("population.status"))
    );
    assert!(transaction.targets().contains(&structural.join("locked")));
    assert!(transaction.targets().contains(&asl.join("locked")));
    assert!(transaction.targets().contains(&bids.join("sub-001_01")));
    assert!(!transaction.targets().contains(&bids.join("sub-002_01")));
    assert!(
        transaction
            .targets()
            .contains(&exploreasl.join("log/xASL_module_Structural_sub-001_01.log"))
    );
    assert!(
        !transaction
            .targets()
            .contains(&exploreasl.join("log/xASL_module_ASL_sub-001_01.log"))
    );

    fs::remove_file(structural.join("struct.status")).unwrap();
    fs::create_dir(structural.join("struct.status")).unwrap();
    assert!(LaunchTransaction::plan(&root, "run-2", &[true, false, false], "", false).is_err());
}

#[test]
fn prepare_rollback_matrix_preserves_entry_bytes_types_and_non_goals() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let lock = exploreasl.join("lock");
    let structural = lock.join("xASL_module_Structural/sub-001_01/xASL_module_Structural");
    let asl = lock.join("xASL_module_ASL/sub-001_01/xASL_module_ASL_ASL_1");
    let population = lock.join("xASL_module_Population/xASL_module_Population");
    let bids = lock.join("xASL_module_BIDS2Legacy");
    let log = exploreasl.join("log");
    fs::create_dir_all(structural.join("locked")).unwrap();
    fs::create_dir_all(asl.join("locked")).unwrap();
    fs::create_dir_all(&population).unwrap();
    fs::create_dir_all(bids.join("sub-001_01")).unwrap();
    fs::create_dir_all(bids.join("sub-002_01")).unwrap();
    fs::create_dir_all(&log).unwrap();
    fs::write(exploreasl.join("dataPar.json"), [0, 255, 4]).unwrap();
    fs::write(structural.join("struct.status"), [1, 2]).unwrap();
    fs::write(asl.join("asl.status"), [3, 4]).unwrap();
    fs::write(population.join("population.status"), [5, 6]).unwrap();
    fs::write(log.join("xASL_module_Structural_sub-001_01.log"), [7, 8]).unwrap();
    fs::write(log.join("xASL_module_ASL_sub-001_01.log"), [9, 10]).unwrap();
    fs::write(root.join("participants.tsv"), b"participants").unwrap();
    fs::create_dir_all(exploreasl.join("Population")).unwrap();
    fs::write(exploreasl.join("Population/project.json"), b"metadata").unwrap();
    fs::create_dir_all(root.join("cache")).unwrap();
    fs::write(root.join("cache/warmup"), b"cache").unwrap();
    fs::create_dir_all(exploreasl.join("ASL/sub-001_01")).unwrap();
    fs::write(exploreasl.join("ASL/sub-001_01/qCBF.nii"), b"scientific").unwrap();

    let mut transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[true, false, false],
        r"^sub\-001_01$",
        true,
    )
    .unwrap();
    transaction.prepare(b"new").unwrap();
    assert_eq!(fs::read(exploreasl.join("dataPar.json")).unwrap(), b"new");
    assert!(!structural.join("struct.status").exists());
    assert!(!structural.join("locked").exists());
    assert!(!asl.join("locked").exists());
    assert!(!bids.join("sub-001_01").exists());
    assert!(bids.join("sub-002_01").exists());
    assert!(asl.join("asl.status").exists());
    assert!(population.join("population.status").exists());
    assert!(root.join("participants.tsv").exists());
    assert!(exploreasl.join("Population/project.json").exists());
    assert!(root.join("cache/warmup").exists());
    assert!(exploreasl.join("ASL/sub-001_01/qCBF.nii").exists());
    transaction.rollback().unwrap();
    assert_eq!(
        fs::read(exploreasl.join("dataPar.json")).unwrap(),
        [0, 255, 4]
    );
    assert_eq!(fs::read(structural.join("struct.status")).unwrap(), [1, 2]);
    assert!(structural.join("locked").is_dir());
    assert!(asl.join("locked").is_dir());
    assert!(bids.join("sub-001_01").is_dir());
    assert_eq!(
        fs::read(log.join("xASL_module_Structural_sub-001_01.log")).unwrap(),
        [7, 8]
    );
    assert_eq!(
        fs::read(root.join("participants.tsv")).unwrap(),
        b"participants"
    );
    assert_eq!(
        fs::read(exploreasl.join("Population/project.json")).unwrap(),
        b"metadata"
    );
    assert_eq!(fs::read(root.join("cache/warmup")).unwrap(), b"cache");
    assert_eq!(
        fs::read(exploreasl.join("ASL/sub-001_01/qCBF.nii")).unwrap(),
        b"scientific"
    );
}

#[test]
fn rollback_retains_evidence_on_unsafe_and_partial_restoration_then_retries() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let log = exploreasl.join("log/xASL_module_ASL_sub-001_01.log");
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(exploreasl.join("dataPar.json"), b"old-data").unwrap();
    fs::write(&log, b"old-log").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[false, true, false], "", false).unwrap();
    transaction.prepare(b"new-data").unwrap();
    fs::write(&log, b"external-log").unwrap();
    assert!(transaction.rollback().is_err());
    assert_eq!(fs::read(&log).unwrap(), b"external-log");
    assert_eq!(
        fs::read(exploreasl.join("dataPar.json")).unwrap(),
        b"new-data"
    );
    fs::remove_file(&log).unwrap();
    transaction.rollback().unwrap();
    assert_eq!(fs::read(&log).unwrap(), b"old-log");
    transaction.rollback().unwrap();
}

#[cfg(unix)]
#[test]
fn rollback_refuses_symbolic_link_replacement_and_retries_after_removal() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let log = root.join("derivatives/ExploreASL/log/xASL_module_ASL_sub-001_01.log");
    let outside = root.join("outside");
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(&log, b"old-log").unwrap();
    fs::write(&outside, b"outside").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[false, true, false], "", false).unwrap();
    transaction.prepare(b"new-data").unwrap();

    std::os::unix::fs::symlink(&outside, &log).unwrap();
    assert!(transaction.rollback().is_err());
    assert!(fs::symlink_metadata(&log).unwrap().file_type().is_symlink());
    assert_eq!(fs::read(&outside).unwrap(), b"outside");

    fs::remove_file(&log).unwrap();
    transaction.rollback().unwrap();
    assert_eq!(fs::read(&log).unwrap(), b"old-log");
}

#[test]
fn commit_is_one_shot_and_leaves_prepared_state_authoritative() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let data_par = root.join("derivatives/ExploreASL/dataPar.json");
    fs::create_dir_all(data_par.parent().unwrap()).unwrap();
    fs::write(&data_par, b"old").unwrap();
    let unrelated = root.join("unrelated");
    fs::write(&unrelated, b"unchanged").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).unwrap();
    transaction.prepare(b"new").unwrap();
    transaction.commit().unwrap();
    assert_eq!(fs::read(&data_par).unwrap(), b"new");
    assert_eq!(fs::read(&unrelated).unwrap(), b"unchanged");
    assert!(transaction.commit().is_err());
    assert!(transaction.rollback().is_err());
    assert_eq!(fs::read(&data_par).unwrap(), b"new");
}

#[test]
fn partial_commit_cleanup_cannot_route_back_to_incomplete_rollback() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let data_par = root.join("derivatives/ExploreASL/dataPar.json");
    fs::create_dir_all(data_par.parent().unwrap()).unwrap();
    fs::write(&data_par, b"old").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[true, false, false], "", false).unwrap();
    transaction.prepare(b"new").unwrap();

    transaction.commit().unwrap();
    crate::processing::journal::inject_fault("afterOwnedRemoval");
    assert!(transaction.cleanup().is_err());
    assert_eq!(fs::read(&data_par).unwrap(), b"new");
    assert!(transaction.rollback().is_err());
    transaction.cleanup().unwrap();
    assert!(
        !root
            .join("derivatives/ExploreASL/.launch-transaction-run-1")
            .exists()
    );
    assert_eq!(fs::read(&data_par).unwrap(), b"new");
}

#[test]
fn selected_population_artifacts_join_the_manifest_and_commit_without_backup_leak() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    let population = exploreasl.join("lock/xASL_module_Population/xASL_module_Population");
    let log = exploreasl.join("log/xASL_module_Population.log");
    fs::create_dir_all(&population).unwrap();
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(population.join("population.status"), b"status").unwrap();
    fs::write(&log, b"log").unwrap();
    let mut transaction = LaunchTransaction::plan(
        &root,
        "run-1",
        &[false, false, true],
        r"^sub-001_01$",
        false,
    )
    .unwrap();
    assert!(
        transaction
            .targets()
            .contains(&population.join("population.status"))
    );
    assert!(transaction.targets().contains(&log));
    transaction.prepare(b"new").unwrap();
    assert!(!population.join("population.status").exists());
    assert!(!log.exists());
    transaction.commit().unwrap();
    assert!(!exploreasl.join(".launch-transaction-run-1").exists());
}

#[test]
fn rollback_restores_absent_lock_root_without_removing_external_parent_entries() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    fs::create_dir_all(&exploreasl).unwrap();
    fs::write(exploreasl.join("unrelated.txt"), b"keep").unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[false, true, false], "", false).unwrap();
    transaction.prepare(b"new").unwrap();
    assert!(exploreasl.join("lock").is_dir());
    transaction.rollback().unwrap();
    assert!(!exploreasl.join("lock").exists());
    assert!(!exploreasl.join("dataPar.json").exists());
    assert_eq!(fs::read(exploreasl.join("unrelated.txt")).unwrap(), b"keep");
}

#[test]
fn rollback_preserves_foreign_lock_entry_and_retains_ownership_for_retry() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    let exploreasl = root.join("derivatives/ExploreASL");
    fs::create_dir_all(&exploreasl).unwrap();
    let mut transaction =
        LaunchTransaction::plan(&root, "run-1", &[false, true, false], "", false).unwrap();
    transaction.prepare(b"new").unwrap();

    let foreign = exploreasl.join("lock/foreign.txt");
    fs::write(&foreign, b"keep").unwrap();

    assert!(transaction.rollback().is_err());
    assert_eq!(fs::read(&foreign).unwrap(), b"keep");
    assert!(transaction.prepare(b"replacement").is_err());

    fs::remove_file(&foreign).unwrap();
    transaction.rollback().unwrap();
    assert!(!exploreasl.join("lock").exists());
    assert!(!exploreasl.join("dataPar.json").exists());
}

#[test]
fn rollback_preserves_foreign_regular_installed_replacement() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path();
    fs::create_dir_all(root.join("derivatives/ExploreASL")).unwrap();
    let mut transaction =
        LaunchTransaction::plan(root, "run-foreign", &[true, false, false], "", false).unwrap();
    transaction.prepare(b"owned").unwrap();
    let destination = root.join("derivatives/ExploreASL/dataPar.json");
    fs::remove_file(&destination).unwrap();
    fs::write(&destination, b"foreign").unwrap();
    assert!(
        transaction.rollback().is_err(),
        "foreign replacement must block rollback"
    );
    assert_eq!(fs::read(destination).unwrap(), b"foreign");
}

#[test]
fn unmapped_legacy_quarantine_blocks_new_launch() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path();
    let legacy = root.join("derivatives/ExploreASL/.launch-transaction-old/backups");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join("0"), b"unknown").unwrap();
    assert!(LaunchTransaction::plan(root, "run-new", &[true, false, false], "", false).is_err());
    assert_eq!(fs::read(legacy.join("0")).unwrap(), b"unknown");
}
