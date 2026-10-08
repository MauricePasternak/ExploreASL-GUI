use crate::project::source_paths::{PathOwnership, inspect_source_path_impl};
use std::fs;
use tempfile::tempdir;

#[test]
fn classifies_internal_and_external_directories() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let internal = project.join("sourcedata");
    let external = workspace.path().join("external");
    fs::create_dir_all(&internal).expect("internal source");
    fs::create_dir_all(&external).expect("external source");

    let internal_result = inspect_source_path_impl(&project, &internal).expect("inspect internal");
    assert_eq!(internal_result.ownership, PathOwnership::Internal);
    assert_eq!(
        internal_result.project_relative_path.as_deref(),
        Some("./sourcedata")
    );
    assert!(internal_result.exists);
    assert!(internal_result.readable);

    let external_result = inspect_source_path_impl(&project, &external).expect("inspect external");
    assert_eq!(external_result.ownership, PathOwnership::External);
    assert_eq!(external_result.project_relative_path, None);
}

#[test]
fn classifies_missing_paths_without_guessing_ownership() {
    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    fs::create_dir_all(&project).expect("project");

    let result = inspect_source_path_impl(&project, &workspace.path().join("missing"))
        .expect("inspect missing");
    assert_eq!(result.ownership, PathOwnership::Missing);
    assert!(!result.exists);
    assert!(!result.readable);
    assert_eq!(result.project_relative_path, None);
}

#[cfg(unix)]
#[test]
fn symlink_escaping_project_is_external() {
    use std::os::unix::fs::symlink;

    let workspace = tempdir().expect("workspace");
    let project = workspace.path().join("project");
    let external = workspace.path().join("external");
    let linked = project.join("linked-source");
    fs::create_dir_all(&project).expect("project");
    fs::create_dir_all(&external).expect("external source");
    symlink(&external, &linked).expect("symlink");

    let result = inspect_source_path_impl(&project, &linked).expect("inspect symlink");
    assert_eq!(result.ownership, PathOwnership::External);
    assert_eq!(result.absolute_path, external.canonicalize().unwrap());
    assert!(
        inspect_source_path_impl(&project, std::path::Path::new("linked-source")).is_err(),
        "saved project-relative references cannot escape through a symlink"
    );
}
