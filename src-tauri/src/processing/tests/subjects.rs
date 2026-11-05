use crate::processing::identifiers::{normalize_asl_run_id, normalize_asl_run_id_opt};
use crate::processing::subjects::*;
use std::fs;

// -------------------------------------------------------------------------
// list_subjects
// -------------------------------------------------------------------------

#[test]
fn list_subjects_bids_direct_scans_project_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let perf = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), Some("bids".to_string()))
        .expect("list_subjects should succeed for BIDS-direct");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].subject_session, "sub-01_1");
    assert_eq!(subjects[0].session, "1");
}

#[test]
fn list_subjects_returns_empty_when_rawdata_missing() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert!(subjects.is_empty());
}

#[test]
fn list_subjects_returns_subjects_with_sessions() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("anat")).unwrap();
    fs::write(
        rawdata
            .join("sub-001")
            .join("ses-01")
            .join("anat")
            .join("sub-001_ses-01_T1w.nii.gz"),
        b"fake",
    )
    .unwrap();
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("perf")).unwrap();
    fs::write(
        rawdata
            .join("sub-001")
            .join("ses-01")
            .join("perf")
            .join("sub-001_ses-01_asl.nii.gz"),
        b"fake",
    )
    .unwrap();
    fs::create_dir_all(rawdata.join("sub-002").join("ses-02")).unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 2);

    let sub001 = subjects.iter().find(|s| s.subject == "001").unwrap();
    assert_eq!(sub001.session, "01");
    assert_eq!(sub001.subject_session, "sub-001_01");
    assert!(sub001.has_structural);
    assert!(sub001.has_asl);

    let sub002 = subjects.iter().find(|s| s.subject == "002").unwrap();
    assert_eq!(sub002.session, "02");
    assert!(!sub002.has_structural);
    assert!(!sub002.has_asl);
}

#[test]
fn list_subjects_skips_non_sub_directories() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    fs::create_dir_all(rawdata.join("sub-001").join("ses-01")).unwrap();
    fs::create_dir_all(rawdata.join("README")).unwrap();
    fs::create_dir_all(rawdata.join("dataset")).unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].subject, "001");
}

#[test]
fn list_subjects_cross_sectional_defaults_session_to_1() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    let sub01 = &subjects[0];
    assert_eq!(sub01.subject, "01");
    assert_eq!(sub01.session, "1");
    assert_eq!(sub01.subject_session, "sub-01_1");
    assert!(sub01.has_asl);
    assert_eq!(sub01.asl_runs, vec!["1"]);
}

#[test]
fn list_subjects_parses_run_entities_from_filenames() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-2_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-2_asl.json"), b"{}").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-5_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-5_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["2", "5"]);
}

#[test]
fn list_subjects_normalizes_zero_padded_bids_run_to_exploreasl_legacy() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["1"]);
}

#[test]
fn list_subjects_normalizes_non_numeric_run_to_default() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_run-pre_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_run-pre_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects[0].asl_runs, vec!["1"]);
}

#[test]
fn normalize_asl_run_id_matches_exploreasl_str2num() {
    assert_eq!(normalize_asl_run_id("01"), "1");
    assert_eq!(normalize_asl_run_id("ASL_01"), "1");
    assert_eq!(normalize_asl_run_id("2"), "2");
    assert_eq!(normalize_asl_run_id(""), "1");
    assert_eq!(normalize_asl_run_id("pre"), "1");
    assert_eq!(normalize_asl_run_id_opt(None), "1");
}

#[test]
fn list_subjects_asl_run_default_when_no_run_entity() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let rawdata = root.join("rawdata");
    let perf = rawdata.join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

    let subjects = list_subjects(root.to_string_lossy().to_string(), None)
        .expect("list_subjects should succeed");

    assert_eq!(subjects.len(), 1);
    assert_eq!(subjects[0].asl_runs, vec!["1"]);
}
