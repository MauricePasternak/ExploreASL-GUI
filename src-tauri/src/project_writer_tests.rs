use crate::project_writer::{
    FailurePoint, WriteErrorCategory, atomic_write_project_for_test, cleanup_project_temps,
};
use std::fs;
use tempfile::tempdir;

fn project_path() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempdir().expect("temporary project directory");
    let project = dir.path().join("project.easl");
    (dir, project)
}

#[test]
fn creates_primary_without_backup() {
    let (_dir, project) = project_path();

    atomic_write_project_for_test(&project, b"new", false, None).expect("write new project");

    assert_eq!(fs::read(&project).unwrap(), b"new");
    assert!(!project.with_extension("easl.bak").exists());
}

#[test]
fn replacement_keeps_previous_primary_as_backup() {
    let (_dir, project) = project_path();
    fs::write(&project, b"old").unwrap();

    atomic_write_project_for_test(&project, b"new", false, None).expect("replace project");

    assert_eq!(fs::read(&project).unwrap(), b"new");
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        b"old"
    );
}

#[test]
fn canonical_project_bytes_survive_create_open_save_and_reopen() {
    let (_dir, project) = project_path();
    let original = br#"{
  "schemaVersion": 1,
  "projectMeta": {
    "id": "project-1",
    "name": "Original",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "lastOpened": "2026-09-01T00:00:00.000Z",
    "currentPhase": "import",
    "dataSource": "dicom"
  },
  "uiState": {},
  "mappingState": {},
  "dataPar": {}
}"#;

    atomic_write_project_for_test(&project, original, false, None).expect("create project");
    let mut opened: serde_json::Value =
        serde_json::from_slice(&fs::read(&project).unwrap()).expect("open created project");
    opened["projectMeta"]["name"] = "Updated".into();
    let updated = serde_json::to_vec_pretty(&opened).expect("serialize updated project");

    atomic_write_project_for_test(&project, &updated, false, None).expect("save project");
    let reopened: serde_json::Value =
        serde_json::from_slice(&fs::read(&project).unwrap()).expect("reopen saved project");

    assert_eq!(reopened["schemaVersion"], 1);
    assert_eq!(reopened["projectMeta"]["name"], "Updated");
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        original
    );
}

#[test]
fn every_interruption_leaves_complete_old_or_new_bytes() {
    for (failure, expected_category) in [
        (FailurePoint::TempCreate, WriteErrorCategory::TemporaryWrite),
        (FailurePoint::TempWrite, WriteErrorCategory::TemporaryWrite),
        (FailurePoint::TempSync, WriteErrorCategory::FileFlush),
        (FailurePoint::BackupRotation, WriteErrorCategory::Backup),
        (FailurePoint::BackupSync, WriteErrorCategory::Backup),
        (
            FailurePoint::PrimaryReplace,
            WriteErrorCategory::PrimaryReplacement,
        ),
        (
            FailurePoint::DirectorySync,
            WriteErrorCategory::DurabilityUncertain,
        ),
    ] {
        let (_dir, project) = project_path();
        fs::write(&project, b"old").unwrap();

        let error = atomic_write_project_for_test(&project, b"new", false, Some(failure))
            .expect_err("injected operation must fail");

        assert_eq!(
            error.category, expected_category,
            "unexpected category for {failure:?}"
        );
        let candidates = [project.clone(), project.with_extension("easl.bak")];
        assert!(
            candidates
                .iter()
                .any(|path| fs::read(path).is_ok_and(|b| b == b"old" || b == b"new"))
        );
    }
}

#[test]
fn unsupported_directory_sync_succeeds_with_reduced_durability() {
    let (_dir, project) = project_path();

    let outcome = atomic_write_project_for_test(
        &project,
        b"new",
        false,
        Some(FailurePoint::DirectorySyncUnsupported),
    )
    .expect("unsupported directory sync must not fail the write");

    assert!(!outcome.directory_sync_supported);
    assert_eq!(fs::read(project).unwrap(), b"new");
}

#[test]
fn recovery_preservation_does_not_rotate_malformed_primary_over_backup() {
    let (_dir, project) = project_path();
    fs::write(&project, b"malformed").unwrap();
    fs::write(project.with_extension("easl.bak"), b"known-good").unwrap();

    atomic_write_project_for_test(&project, b"repaired", true, None).expect("repair primary");

    assert_eq!(fs::read(&project).unwrap(), b"repaired");
    assert_eq!(
        fs::read(project.with_extension("easl.bak")).unwrap(),
        b"known-good"
    );
}

#[test]
fn removes_only_writer_owned_stale_temps_after_success() {
    let (dir, project) = project_path();
    let stale = dir.path().join(".project.easl.atomic-stale.tmp");
    let unrelated = dir.path().join(".project.easl.tmp");
    fs::write(&stale, b"stale").unwrap();
    fs::write(&unrelated, b"keep").unwrap();

    atomic_write_project_for_test(&project, b"new", false, None).expect("write project");

    assert!(!stale.exists());
    assert!(unrelated.exists());
}

#[test]
fn open_time_cleanup_removes_only_writer_owned_stale_temps() {
    let (dir, project) = project_path();
    let stale = dir.path().join(".project.easl.atomic-abandoned.tmp");
    let unrelated = dir.path().join(".other.easl.atomic-abandoned.tmp");
    fs::write(&stale, b"stale").unwrap();
    fs::write(&unrelated, b"keep").unwrap();

    cleanup_project_temps(project.to_string_lossy().into_owned());

    assert!(!stale.exists());
    assert!(unrelated.exists());
}
