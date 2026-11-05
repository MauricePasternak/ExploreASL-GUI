use super::common::*;
use crate::processing::locks::*;
use std::fs;

// -------------------------------------------------------------------------
// determine_status
// -------------------------------------------------------------------------

#[test]
fn determine_status_returns_pending_when_no_status_files() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();

    let (status, steps, locked) = determine_status(dir);
    assert_eq!(status, "pending");
    assert!(steps.is_empty());
    assert!(!locked);
}

#[test]
fn determine_status_returns_complete_when_ready_file_exists() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, locked) = determine_status(dir);
    assert_eq!(status, "complete");
    assert!(steps.contains(&"060_Segment_T1w".to_string()));
    assert!(!locked);
}

#[test]
fn determine_status_returns_incomplete_when_status_files_without_ready() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("070_SkullStrip_T1w.status"), "").unwrap();

    let (status, steps, locked) = determine_status(dir);
    assert_eq!(status, "incomplete");
    assert_eq!(steps.len(), 2);
    assert!(!locked);
}

#[test]
fn determine_status_detects_locked_directory() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    fs::create_dir_all(dir.join("locked")).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();

    let (status, steps, locked) = determine_status(dir);
    assert_eq!(status, "incomplete");
    assert!(locked);
    assert!(steps.contains(&"060_Segment_T1w".to_string()));
}

#[test]
fn determine_status_complete_overrides_locked() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    fs::create_dir_all(dir.join("locked")).unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, locked) = determine_status(dir);
    assert_eq!(status, "complete");
    assert!(!locked);
    assert!(steps.contains(&"060_Segment_T1w".to_string()));
    assert!(!steps.contains(&"999_ready".to_string()));
}

#[test]
fn determine_status_returns_steps_in_sorted_order() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    fs::write(dir.join("100_VisualQC_Structural.status"), "").unwrap();
    fs::write(dir.join("010_LinearReg_T1w2MNI.status"), "").unwrap();
    fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(dir.join("030_FLAIR_BiasfieldCorrection.status"), "").unwrap();
    fs::write(dir.join("999_ready.status"), "").unwrap();

    let (status, steps, _) = determine_status(dir);
    assert_eq!(status, "complete");
    assert_eq!(
        steps,
        vec![
            "010_LinearReg_T1w2MNI",
            "030_FLAIR_BiasfieldCorrection",
            "060_Segment_T1w",
            "100_VisualQC_Structural",
        ]
    );
}

// -------------------------------------------------------------------------
// read_lock_status
// -------------------------------------------------------------------------

#[test]
fn read_lock_status_returns_empty_when_lock_dir_missing() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    assert!(statuses.is_empty());
}

#[test]
fn read_lock_status_parses_all_modules() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    create_lock_tree(root);

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let structural = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_Structural")
        .expect("structural status should exist");
    assert_eq!(structural.subject_session, "sub-001_01");
    assert_eq!(structural.status, "complete");
    assert!(!structural.locked);

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL")
        .expect("asl status should exist");
    assert_eq!(asl.subject_session, "sub-001_01");
    assert_eq!(asl.status, "incomplete");
    assert!(asl.locked);
    assert_eq!(asl.run, Some("1".to_string()));

    let pop = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_Population")
        .expect("population status should exist");
    assert_eq!(pop.status, "complete");
    assert!(pop.subject_session.is_empty());
}

#[test]
fn read_lock_status_detects_outdated_status() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let lock = root.join("derivatives").join("ExploreASL").join("lock");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    let struct_ready = struct_sub.join("999_ready.status");

    let asl_run = lock
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&asl_run).unwrap();
    let asl_ready = asl_run.join("999_ready.status");

    fs::write(&asl_ready, "").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(15));
    fs::write(&struct_ready, "").unwrap();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
        .expect("asl status should exist");
    assert_eq!(asl.status, "outdated");
}

#[test]
fn read_lock_status_detects_outdated_status_from_logs_only() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let lock = root.join("derivatives").join("ExploreASL").join("lock");
    let log_dir = root.join("derivatives").join("ExploreASL").join("log");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    let struct_ready = struct_sub.join("999_ready.status");

    fs::create_dir_all(&log_dir).unwrap();
    let asl_log = log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log");
    fs::write(&asl_log, "success log with no issues").unwrap();

    std::thread::sleep(std::time::Duration::from_millis(15));
    fs::write(&struct_ready, "").unwrap();

    let statuses = read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

    let asl = statuses
        .iter()
        .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
        .expect("asl status should exist");
    assert_eq!(asl.status, "outdated");
    assert_eq!(asl.run, Some("1".to_string()));
}
