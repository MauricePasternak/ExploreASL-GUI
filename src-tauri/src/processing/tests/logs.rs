use super::common::unique_temp_path;
use crate::processing::locks::determine_status;
use crate::processing::logs::{check_log_for_error, is_mutex_related_line};
use crate::processing::logs::{list_module_logs, read_module_logs};
use std::fs;

#[test]
fn mutex_log_errors_do_not_mask_real_errors() {
    assert!(is_mutex_related_line(
        "ERROR: mutex is locked for subject sub-001"
    ));
    assert!(!is_mutex_related_line("ERROR: file not found"));

    let root = unique_temp_path("log-errors");
    fs::create_dir_all(&root).unwrap();
    let log = root.join("worker.log");
    fs::write(&log, "ERROR: mutex is locked\n").unwrap();
    assert!(!check_log_for_error(&log));
    fs::write(&log, "ERROR: mutex is locked\nERROR: file not found\n").unwrap();
    assert!(check_log_for_error(&log));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn mutex_detection_accepts_case_and_whitespace_but_rejects_unrelated_errors() {
    assert!(is_mutex_related_line("  mutex is locked"));
    assert!(is_mutex_related_line("Mutex is locked"));
    assert!(!is_mutex_related_line("Error processing subject"));
    assert!(!is_mutex_related_line("some normal log line"));
}

#[test]
fn log_error_detection_handles_empty_and_real_error_only_logs() {
    let root = unique_temp_path("log-error-matrix");
    fs::create_dir_all(&root).unwrap();
    let log = root.join("worker.log");
    fs::write(&log, "").unwrap();
    assert!(!check_log_for_error(&log));
    fs::write(
        &log,
        "INFO: starting\nERROR: file not found /data/sub-001.nii\n",
    )
    .unwrap();
    assert!(check_log_for_error(&log));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn ready_status_remains_complete_with_mutex_log_entry() {
    let root = unique_temp_path("ready-mutex");
    let lock = root.join("lock");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("999_ready.status"), "").unwrap();
    let log = root.join("worker.log");
    fs::write(&log, "ERROR: mutex is locked\n").unwrap();

    assert_eq!(determine_status(&lock).0, "complete");
    assert!(!check_log_for_error(&log));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn incomplete_and_never_run_statuses_do_not_turn_mutex_only_logs_into_errors() {
    let root = unique_temp_path("incomplete-mutex");
    let lock = root.join("lock");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("060_Segment_T1w.status"), "").unwrap();
    let log = root.join("worker.log");
    fs::write(&log, "ERROR: mutex is locked for subject sub-001\n").unwrap();

    assert_eq!(determine_status(&lock).0, "incomplete");
    assert!(!check_log_for_error(&log));
    fs::remove_file(lock.join("060_Segment_T1w.status")).unwrap();
    assert_eq!(determine_status(&lock).0, "pending");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn module_log_commands_find_and_read_staging_import_logs() {
    let root = unique_temp_path("staging-import-logs");
    let log_dir = root.join(".easl_staging/derivatives/ExploreASL/log");
    fs::create_dir_all(&log_dir).unwrap();
    let filename = "xASL_module_Import_sub-001Philips.log";
    fs::write(log_dir.join(filename), "import log body").unwrap();

    let logs = list_module_logs(root.to_string_lossy().to_string()).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].module, "import");
    assert_eq!(logs[0].subject_session, "sub-001Philips");
    let contents = read_module_logs(
        root.to_string_lossy().to_string(),
        "sub-001Philips".to_string(),
        "import".to_string(),
    )
    .unwrap();
    assert_eq!(contents[filename], "import log body");
    fs::remove_dir_all(root).unwrap();
}
