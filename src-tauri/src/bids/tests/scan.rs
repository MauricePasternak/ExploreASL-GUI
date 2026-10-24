use super::*;
use std::fs;
use tempfile::TempDir;

fn create_cross_sectional_dataset(root: &Path) {
    let sub = root.join("sub-01");
    let perf = sub.join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
    fs::write(
        perf.join("sub-01_aslcontext.tsv"),
        b"volume_type\ncontrol\nlabel\n",
    )
    .unwrap();

    let sub2 = root.join("sub-02");
    let perf2 = sub2.join("perf");
    fs::create_dir_all(&perf2).unwrap();
    fs::write(perf2.join("sub-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf2.join("sub-02_asl.json"), b"{}").unwrap();
}

fn create_longitudinal_dataset(root: &Path) {
    let ses1_perf = root.join("sub-01").join("ses-01").join("perf");
    let ses2_perf = root.join("sub-01").join("ses-02").join("perf");
    fs::create_dir_all(&ses1_perf).unwrap();
    fs::create_dir_all(&ses2_perf).unwrap();
    fs::write(ses1_perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(ses1_perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();
    fs::write(ses2_perf.join("sub-01_ses-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(ses2_perf.join("sub-01_ses-02_asl.json"), b"{}").unwrap();
}

#[test]
fn test_parse_bids_structure_cross_sectional_default_session() {
    let tmp = TempDir::new().unwrap();
    create_cross_sectional_dataset(tmp.path());

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    assert_eq!(subjects.len(), 2);

    let sub01 = subjects
        .iter()
        .find(|s| s.subject_label == "sub-01")
        .unwrap();
    assert_eq!(sub01.sessions.len(), 1);
    assert_eq!(sub01.sessions[0].session_label, "1");
    assert!(!sub01.sessions[0].has_explicit_session);
    assert!(sub01.sessions[0].has_perf);
    assert_eq!(sub01.sessions[0].asl_files.len(), 1);
}

#[test]
fn test_parse_bids_structure_longitudinal_sessions() {
    let tmp = TempDir::new().unwrap();
    create_longitudinal_dataset(tmp.path());

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    assert_eq!(subjects.len(), 1);

    let sub01 = &subjects[0];
    assert_eq!(sub01.sessions.len(), 2);

    let labels: Vec<&str> = sub01
        .sessions
        .iter()
        .map(|s| s.session_label.as_str())
        .collect();
    assert!(labels.contains(&"01"));
    assert!(labels.contains(&"02"));
    assert!(sub01.sessions.iter().all(|s| s.has_explicit_session));
}

#[test]
fn test_parse_bids_structure_explicit_ses1() {
    // Phase 11.3 edge case: explicit `ses-1` directory —
    // `has_explicit_session = true` while `session_label = "1"`.
    let tmp = TempDir::new().unwrap();
    let perf = tmp.path().join("sub-01").join("ses-1").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-1_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-1_asl.json"), b"{}").unwrap();

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    assert_eq!(subjects.len(), 1);
    // parse_bids_structure stores the directory name including the
    // `sub-` prefix; the frontend strips it via stripSubjectPrefix when
    // emitting SubjectRow.subject.
    assert_eq!(subjects[0].subject_label, "sub-01");
    assert_eq!(subjects[0].sessions.len(), 1);
    assert_eq!(subjects[0].sessions[0].session_label, "1");
    assert!(subjects[0].sessions[0].has_explicit_session);
    assert!(subjects[0].sessions[0].has_perf);
}

#[test]
fn test_parse_bids_structure_subject_anat_inherited_by_session() {
    let tmp = TempDir::new().unwrap();
    let anat = tmp.path().join("sub-01").join("anat");
    fs::create_dir_all(&anat).unwrap();
    fs::write(anat.join("sub-01_T1w.nii.gz"), b"fake").unwrap();

    let perf = tmp.path().join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    let session = &subjects[0].sessions[0];
    assert!(session.has_anat);
    assert_eq!(session.anat_files.len(), 1);
    assert!(session.anat_files[0].contains("_T1w.nii.gz"));
}

#[test]
fn test_parse_bids_structure_skips_non_sub_dirs() {
    let tmp = TempDir::new().unwrap();

    fs::create_dir(tmp.path().join("derivatives")).unwrap();
    fs::create_dir(tmp.path().join("sourcedata")).unwrap();
    fs::create_dir(tmp.path().join("notes")).unwrap();
    fs::create_dir(tmp.path().join("rawdata")).unwrap();

    create_cross_sectional_dataset(tmp.path());

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    assert_eq!(subjects.len(), 2);
    assert!(subjects.iter().all(|s| s.subject_label.starts_with("sub-")));
}

#[test]
fn test_parse_bids_structure_with_m0_file() {
    let tmp = TempDir::new().unwrap();
    let perf = tmp.path().join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
    fs::write(perf.join("sub-01_m0scan.nii.gz"), b"fake").unwrap();

    let subjects = parse_bids_structure(tmp.path()).unwrap();
    assert_eq!(subjects.len(), 1);
    assert!(subjects[0].sessions[0].has_m0);
}

#[test]
fn test_extract_run_label_present() {
    assert_eq!(
        extract_run_label("sub-01_run-2_asl.nii.gz"),
        Some("2".to_string())
    );
    assert_eq!(
        extract_run_label("sub-01_ses-01_run-01_asl.json"),
        Some("01".to_string())
    );
}

#[test]
fn test_extract_run_label_absent() {
    assert_eq!(extract_run_label("sub-01_asl.nii.gz"), None);
}

#[test]
fn test_extract_acquisition_label() {
    assert_eq!(
        extract_acquisition_label("sub-01_acq-highres_asl.nii.gz"),
        Some("highres".to_string())
    );
    assert_eq!(extract_acquisition_label("sub-01_asl.nii.gz"), None);
}
