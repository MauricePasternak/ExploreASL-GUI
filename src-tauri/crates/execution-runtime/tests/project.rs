use easl_execution_runtime::project::ActiveProject;

#[test]
fn active_project_retains_canonical_directory_identity() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let project = ActiveProject::open(&root).unwrap();
    assert_eq!(project.root(), root);
    project.verify_root_identity().unwrap();
}

#[cfg(unix)]
#[test]
fn active_project_rejects_path_replacement() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let project = ActiveProject::open(&root).unwrap();
    std::fs::rename(&root, workspace.path().join("moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert!(project.verify_root_identity().is_err());
}
