use super::*;

#[test]
fn second_launch_only_targets_existing_main_window() {
    let app = tauri::test::mock_builder()
        .manage(crate::app::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
        .build()
        .unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let state = app.state::<crate::app::state::AppState>();
    crate::project::ownership::own_project(&state, project_root.path());
    let active_before = crate::project::ownership::active(&state).unwrap();

    assert!(handle_second_instance(
        &app.handle().clone(),
        &["exploreasl_gui".into(), "project.easl".into()],
        "/ignored/cwd",
    ));
    assert_eq!(
        state.active_project_root.lock().unwrap().as_deref(),
        Some(project_root.path())
    );
    assert!(std::sync::Arc::ptr_eq(
        &active_before,
        &crate::project::ownership::active(&state).unwrap()
    ));
}
