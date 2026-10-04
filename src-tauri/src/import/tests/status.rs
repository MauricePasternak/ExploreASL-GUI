use crate::app::state::AppState;
use crate::import::status::{
    import_lock_dir, is_committed_import_subject, read_import_status_for_state,
    read_import_status_impl,
};
use crate::import::types::ImportSubjectStatusKind;
use std::fs;
use std::path::{Path, PathBuf};

fn status_root(root: &Path, subject: &str) -> PathBuf {
    let lock = import_lock_dir(root, subject);
    fs::create_dir_all(&lock).unwrap();
    lock
}

#[test]
fn committed_audit_requires_ready_lock_and_nonempty_rawdata() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let one = status_root(root, "ONE");
    fs::write(one.join("999_ready.status"), "ready").unwrap();
    fs::create_dir_all(root.join("rawdata/sub-ONE")).unwrap();
    fs::write(root.join("rawdata/sub-ONE/asl.nii"), "nii").unwrap();
    let two = status_root(root, "TWO");
    fs::write(two.join("010_DCM2NII.status"), "partial").unwrap();
    let three = status_root(root, "THREE");
    fs::write(three.join("999_ready.status"), "dangling").unwrap();

    let statuses = read_import_status_impl(root.to_path_buf()).unwrap();
    assert!(statuses.iter().any(|entry| {
        entry.subject == "ONE" && matches!(entry.status, ImportSubjectStatusKind::Completed)
    }));
    for subject in ["TWO", "THREE"] {
        assert!(statuses.iter().any(|entry| {
            entry.subject == subject && matches!(entry.status, ImportSubjectStatusKind::Failed)
        }));
    }
    assert!(is_committed_import_subject(root, "ONE").unwrap());
    assert!(!is_committed_import_subject(root, "THREE").unwrap());
}

#[test]
fn absent_evidence_returns_no_false_completion() {
    let temp = tempfile::tempdir().unwrap();
    assert!(
        read_import_status_impl(temp.path().to_path_buf())
            .unwrap()
            .is_empty()
    );
}

#[cfg(unix)]
#[test]
fn audit_rejects_symlinked_roots_and_marks_special_subject_entries_failed() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("derivatives/ExploreASL/lock")).unwrap();
    symlink(
        root.join("outside"),
        root.join("derivatives/ExploreASL/lock/xASL_module_Import"),
    )
    .unwrap();
    assert!(read_import_status_impl(root.to_path_buf()).is_err());
}

#[test]
fn state_owned_audit_rejects_missing_active_project() {
    assert!(read_import_status_for_state(&AppState::default()).is_err());
}

#[test]
fn active_root_audit_classifies_ready_dangling_partial_absent_and_special_entries() {
    let temp = tempfile::tempdir().unwrap();
    let state = AppState::default();
    crate::project::ownership_tests::own_project(&state, temp.path());
    let complete = status_root(temp.path(), "COMPLETE");
    fs::write(complete.join("999_ready.status"), "ready").unwrap();
    fs::create_dir_all(temp.path().join("rawdata/sub-COMPLETE")).unwrap();
    fs::write(temp.path().join("rawdata/sub-COMPLETE/asl.nii"), "data").unwrap();
    let dangling = status_root(temp.path(), "DANGLING");
    fs::write(dangling.join("999_ready.status"), "ready").unwrap();
    let partial = status_root(temp.path(), "PARTIAL");
    fs::write(partial.join("020_NII2BIDS.status"), "partial").unwrap();
    fs::create_dir_all(
        temp.path()
            .join("derivatives/ExploreASL/lock/xASL_module_Import/SPECIAL"),
    )
    .unwrap();
    fs::write(
        temp.path()
            .join("derivatives/ExploreASL/lock/xASL_module_Import/SPECIAL/xASL_module_Import"),
        "not a dir",
    )
    .unwrap();
    let actual = read_import_status_for_state(&state).unwrap();
    assert!(
        actual
            .iter()
            .any(|s| s.subject == "COMPLETE"
                && matches!(s.status, ImportSubjectStatusKind::Completed))
    );
    for subject in ["DANGLING", "PARTIAL", "SPECIAL"] {
        assert!(
            actual.iter().any(
                |s| s.subject == subject && matches!(s.status, ImportSubjectStatusKind::Failed)
            ),
            "{subject}"
        );
    }
    assert!(!actual.iter().any(|s| s.subject == "ABSENT"));
}
