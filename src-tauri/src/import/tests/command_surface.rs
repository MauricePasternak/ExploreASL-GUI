#[test]
fn public_import_command_surface_has_only_run_scoped_authority() {
    let source = include_str!("../../bindings.rs");
    let handler = source
        .split("collect_commands![")
        .nth(1)
        .and_then(|value| value.split("])").next())
        .expect("shared Tauri/Specta command collection");
    for command in [
        "reserve_import_run",
        "get_active_import_run",
        "attach_import_run",
        "launch_import_run",
        "cancel_import_run",
        "reconcile_import_result",
        "read_import_status",
    ] {
        assert!(
            handler.contains(command),
            "missing import command {command}"
        );
    }
    for obsolete in [
        "acknowledge_import_run",
        "run_import_pipeline",
        "clean_import_status",
        "move_import_output",
        "run_post_processing",
        "complete_import",
        "cancel_import_by_pid",
    ] {
        assert!(
            !handler.contains(obsolete),
            "obsolete public import command: {obsolete}"
        );
    }
    let commands = include_str!("../commands.rs");
    assert!(!commands.contains("project_root:"));
    assert!(!commands.contains("staging_root:"));
    assert!(!commands.contains("child_pid:"));
    assert!(!commands.contains("subject_results:"));
}
