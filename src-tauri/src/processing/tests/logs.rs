use super::common::*;
use crate::processing::logs::*;
use crate::processing::utils::{check_log_for_error, determine_status, is_mutex_related_line};
use std::fs;

#[test]
fn is_mutex_related_line_detects_mutex_message() {
    assert!(is_mutex_related_line(
        "ERROR: mutex is locked for subject sub-001"
    ));
    assert!(is_mutex_related_line("  mutex is locked"));
    assert!(is_mutex_related_line("Mutex is locked"));
}

#[test]
fn is_mutex_related_line_rejects_normal_errors() {
    assert!(!is_mutex_related_line("ERROR: file not found"));
    assert!(!is_mutex_related_line("Error processing subject"));
    assert!(!is_mutex_related_line("some normal log line"));
}

#[test]
fn check_log_for_error_returns_false_for_mutex_only_errors() {
    let dir = unique_temp_path("mutex-only");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: retrying\n",
    )
    .unwrap();
    assert!(!check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_true_for_real_errors() {
    let dir = unique_temp_path("real-error");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(
        &log,
        "INFO: starting\nERROR: file not found /data/sub-001.nii\n",
    )
    .unwrap();
    assert!(check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_true_when_mixed_mutex_and_real_errors() {
    let dir = unique_temp_path("mixed-errors");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(&log, "ERROR: mutex is locked\nERROR: file not found\n").unwrap();
    assert!(check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn check_log_for_error_returns_false_for_empty_log() {
    let dir = unique_temp_path("empty-log");
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("test.log");
    fs::write(&log, "").unwrap();
    assert!(!check_log_for_error(&log));
    let _ = fs::remove_dir_all(dir);
}

// -------------------------------------------------------------------------
// Error determination: 999_ready.status + mutex interaction
// -------------------------------------------------------------------------

#[test]
fn error_detection_ready_status_no_mutex_not_errored() {
    let dir = unique_temp_path("ready-no-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(lock_dir.join("999_ready.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(&log, "INFO: starting\nINFO: completed successfully\n").unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "complete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_ready_status_with_mutex_not_errored() {
    let dir = unique_temp_path("ready-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(lock_dir.join("999_ready.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: completed\n",
    )
    .unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "complete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_no_ready_status_with_mutex_is_errored() {
    let dir = unique_temp_path("no-ready-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(
        &log,
        "INFO: starting\nERROR: mutex is locked for subject sub-001\n",
    )
    .unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "incomplete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_no_ready_status_no_mutex_is_errored() {
    let dir = unique_temp_path("no-ready-no-mutex");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();
    fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

    let log = dir.join("log");
    fs::write(&log, "INFO: starting\nINFO: processing...\n").unwrap();

    let (status, _, _) = determine_status(&lock_dir);
    let has_error = check_log_for_error(&log);
    assert_eq!(status, "incomplete");
    assert!(!has_error);

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn error_detection_never_run_not_errored() {
    let dir = unique_temp_path("never-run");
    let lock_dir = dir.join("lock");
    fs::create_dir_all(&lock_dir).unwrap();

    let (status, steps, _) = determine_status(&lock_dir);
    assert_eq!(status, "pending");
    assert!(steps.is_empty());

    let _ = fs::remove_dir_all(dir);
}

// -------------------------------------------------------------------------
// delete_module_log_files
// -------------------------------------------------------------------------

#[test]
fn delete_module_log_files_removes_structural_log_for_matching_subject() {
    let root = unique_temp_path("del-log-structural");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("xASL_module_Structural_sub-001_01.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_Structural_sub-002_01.log"),
        "old log",
    )
    .unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_removes_all_asl_runs_for_matching_subject() {
    let root = unique_temp_path("del-log-asl-runs");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-001_01_ASL_2.log"),
        "old log",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-002_01_ASL_1.log"),
        "old log",
    )
    .unwrap();

    delete_module_log_files(&root, &[false, true, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists()
    );
    assert!(
        !log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_2.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_ASL_sub-002_01_ASL_1.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_respects_subject_regexp_filter() {
    let root = unique_temp_path("del-log-regexp");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-002_01.log"), "old").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_preserves_non_log_files() {
    let root = unique_temp_path("del-log-nonlog");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("bids_report_sub-001_ses-01.json"), "{}").unwrap();
    fs::write(log_dir.join("import_summary_sub-001.csv"), "csv").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(log_dir.join("bids_report_sub-001_ses-01.json").exists());
    assert!(log_dir.join("import_summary_sub-001.csv").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_skips_disabled_modules() {
    let root = unique_temp_path("del-log-skip");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"), "old").unwrap();

    delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

    assert!(
        !log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );
    assert!(
        log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_handles_missing_log_dir() {
    let root = unique_temp_path("del-log-missing");

    let result = delete_module_log_files(&root, &[true, false, false], "^sub-001_01$");

    assert!(result.is_ok());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_module_log_files_deletes_population_log() {
    let root = unique_temp_path("del-log-pop");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(log_dir.join("xASL_module_Population.log"), "old").unwrap();
    fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();

    delete_module_log_files(&root, &[false, false, true], "^sub-001_01$").unwrap();

    assert!(!log_dir.join("xASL_module_Population.log").exists());
    assert!(
        log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists()
    );

    let _ = fs::remove_dir_all(root);
}

// -------------------------------------------------------------------------
// list_module_logs / read_module_logs
// -------------------------------------------------------------------------

#[test]
fn list_module_logs_finds_import_logs_in_staging_when_project_log_dir_missing() {
    let root = unique_temp_path("import-staging-logs");
    let staging_log = root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&staging_log).unwrap();
    fs::write(
        staging_log.join("xASL_module_Import_sub-001Philips.log"),
        "ExploreASL import output",
    )
    .unwrap();

    let logs = list_module_logs(root.to_string_lossy().to_string())
        .expect("list_module_logs should succeed");

    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].module, "import");
    assert_eq!(logs[0].subject_session, "sub-001Philips");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn read_module_logs_reads_import_logs_from_staging() {
    let root = unique_temp_path("read-import-staging-logs");
    let staging_log = root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&staging_log).unwrap();
    fs::write(
        staging_log.join("xASL_module_Import_sub-001Philips.log"),
        "import log body",
    )
    .unwrap();

    let content = read_module_logs(
        root.to_string_lossy().to_string(),
        "sub-001Philips".to_string(),
        "import".to_string(),
    )
    .expect("read_module_logs should succeed");

    assert_eq!(
        content["xASL_module_Import_sub-001Philips.log"],
        "import log body"
    );

    let _ = fs::remove_dir_all(root);
}
