use super::*;
use std::fs;
use tempfile::TempDir;

// ---- is_subject_dir / is_session_dir ----

#[test]
fn test_is_subject_dir_true() {
    assert!(is_subject_dir("sub-001"));
    assert!(is_subject_dir("sub-01"));
    assert!(is_subject_dir("sub-CONTROL"));
}

#[test]
fn test_is_subject_dir_false() {
    assert!(!is_subject_dir("derivatives"));
    assert!(!is_subject_dir("sourcedata"));
    assert!(!is_subject_dir("ses-01"));
    assert!(!is_subject_dir("README.md"));
}

#[test]
fn test_is_session_dir_true() {
    assert!(is_session_dir("ses-01"));
    assert!(is_session_dir("ses-baseline"));
}

#[test]
fn test_is_session_dir_false() {
    assert!(!is_session_dir("sub-01"));
    assert!(!is_session_dir("perf"));
    assert!(!is_session_dir("anat"));
}

// ---- resolve_sessions ----

#[test]
fn test_resolve_sessions_cross_sectional_default() {
    // ds000240 style: sub-01/perf/ with no ses-* dirs
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("perf")).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_label, "1");
    assert!(!sessions[0].has_explicit_session);
}

#[test]
fn test_resolve_sessions_explicit_ses01() {
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("ses-01")).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_label, "01");
    assert!(sessions[0].has_explicit_session);
}

#[test]
fn test_resolve_sessions_non_numeric_baseline() {
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("ses-baseline")).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_label, "baseline");
    assert!(sessions[0].has_explicit_session);
}

#[test]
fn test_resolve_sessions_longitudinal() {
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("ses-01")).unwrap();
    fs::create_dir(sub_dir.join("ses-02")).unwrap();

    let mut sessions = resolve_sessions(&sub_dir);
    sessions.sort_by(|a, b| a.session_label.cmp(&b.session_label));
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].session_label, "01");
    assert_eq!(sessions[1].session_label, "02");
    assert!(sessions.iter().all(|s| s.has_explicit_session));
}

#[test]
fn test_resolve_sessions_cross_sectional_anat_only() {
    // No ses-* dirs, but has anat/ directly
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("anat")).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_label, "1");
    assert!(!sessions[0].has_explicit_session);
}

#[test]
fn test_resolve_sessions_explicit_ses1() {
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();
    fs::create_dir(sub_dir.join("ses-1")).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_label, "1");
    assert!(sessions[0].has_explicit_session);
}

#[test]
fn test_resolve_sessions_no_perf_no_anat_no_ses() {
    // Empty subject dir: no ses, no perf, no anat
    let tmp = TempDir::new().unwrap();
    let sub_dir = tmp.path().join("sub-01");
    fs::create_dir(&sub_dir).unwrap();

    let sessions = resolve_sessions(&sub_dir);
    assert!(sessions.is_empty());
}
