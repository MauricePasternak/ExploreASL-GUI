use crate::{
    app::state::AppState,
    project::lifecycle::{clear_active_project_impl, set_active_project_impl},
};

#[test]
fn processing_admission_requires_native_capability() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::default();
    *state.active_project_root.lock().unwrap() = Some(root.path().canonicalize().unwrap());
    assert!(
        crate::processing::runs::reserve_processing_run_impl(&state, vec!["asl".into()], vec![])
            .is_err()
    );
}

#[test]
fn candidate_capability_acquisition_is_read_only() {
    let root = tempfile::tempdir().unwrap();
    crate::project::ownership::ActiveProject::open(root.path()).unwrap();
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

    crate::project::ownership::for_setup(&AppState::default(), root.path()).unwrap();
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn same_root_reuses_capability_and_switch_replaces_it() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let state = AppState::default();
    set_active_project_impl(first.path().display().to_string(), &state).unwrap();
    let original = crate::project::ownership::active(&state).unwrap();

    set_active_project_impl(first.path().display().to_string(), &state).unwrap();
    assert!(std::sync::Arc::ptr_eq(
        &original,
        &crate::project::ownership::active(&state).unwrap()
    ));

    set_active_project_impl(second.path().display().to_string(), &state).unwrap();
    assert_eq!(
        crate::project::ownership::active(&state).unwrap().root(),
        second.path()
    );
    assert!(!std::sync::Arc::ptr_eq(
        &original,
        &crate::project::ownership::active(&state).unwrap()
    ));
}

#[test]
fn shutdown_retains_active_capability_until_clear() {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::default();
    set_active_project_impl(root.path().display().to_string(), &state).unwrap();
    assert!(crate::project::lifecycle::shutdown_project_runtime_impl(&state).success);
    assert!(crate::project::ownership::active(&state).is_ok());
    crate::project::persistence::atomic_write_project_for_state(
        &state,
        &root.path().join("project.easl"),
        b"{}",
        false,
    )
    .unwrap();
    clear_active_project_impl(&state).unwrap();
    assert!(crate::project::ownership::active(&state).is_err());
}

#[test]
fn candidate_writes_precede_activation_without_replacing_active_root() {
    let active = tempfile::tempdir().unwrap();
    let candidate = tempfile::tempdir().unwrap();
    let state = AppState::default();
    set_active_project_impl(active.path().display().to_string(), &state).unwrap();
    let project = candidate.path().join("project.easl");
    crate::project::persistence::atomic_write_project_for_state(&state, &project, b"{}", false)
        .unwrap();
    crate::project::persistence::cleanup_project_temps_for_state(&state, &project).unwrap();
    assert_eq!(
        crate::project::ownership::active(&state).unwrap().root(),
        active.path()
    );
    assert_eq!(std::fs::read(project).unwrap(), b"{}");
}

#[test]
fn stale_native_root_rejects_mutation_and_active_setup_rejects_execution() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let state = AppState::default();
    set_active_project_impl(root.path().display().to_string(), &state).unwrap();
    crate::processing::runs::reserve_processing_run_impl(&state, vec!["asl".into()], vec![])
        .unwrap();
    assert!(crate::project::ownership::for_setup(&state, root.path()).is_err());
    assert!(crate::project::ownership::for_setup(&state, other.path()).is_ok());
    *state.active_project_root.lock().unwrap() = Some(other.path().to_path_buf());
    assert!(
        crate::processing::runs::reserve_processing_run_impl(&state, vec!["asl".into()], vec![])
            .is_err()
    );
}

#[cfg(unix)]
#[test]
fn renamed_active_root_cannot_authorize_replacement_directory() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let state = AppState::default();
    set_active_project_impl(root.display().to_string(), &state).unwrap();
    std::fs::rename(&root, workspace.path().join("moved-project")).unwrap();
    std::fs::create_dir(&root).unwrap();
    let result = crate::project::persistence::atomic_write_project_for_state(
        &state,
        &root.join("project.easl"),
        b"{}",
        false,
    );
    assert!(result.is_err());
    assert!(!root.join("project.easl").exists());
}

#[test]
fn active_project_retains_canonical_directory_identity() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let canonical_root = root.canonicalize().unwrap();
    let project = crate::project::ownership::ActiveProject::open(&root).unwrap();
    assert_eq!(project.root(), canonical_root);
    project.verify_root_identity().unwrap();

    #[cfg(unix)]
    {
        let symlink = workspace.path().join("symlink_project");
        std::os::unix::fs::symlink(&root, &symlink).unwrap();
        let sym_project = crate::project::ownership::ActiveProject::open(&symlink).unwrap();
        assert_eq!(sym_project.root(), canonical_root);
        sym_project.verify_root_identity().unwrap();
    }
}

#[cfg(unix)]
#[test]
fn active_project_rejects_path_replacement() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("project");
    std::fs::create_dir(&root).unwrap();
    let project = crate::project::ownership::ActiveProject::open(&root).unwrap();
    std::fs::rename(&root, workspace.path().join("moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert!(project.verify_root_identity().is_err());
}
