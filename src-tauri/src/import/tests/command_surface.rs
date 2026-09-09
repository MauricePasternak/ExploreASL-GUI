#[test]
fn public_import_command_surface_has_only_run_scoped_authority() {
    let source = include_str!("../../lib.rs");
    let handler = source
        .split(".invoke_handler")
        .nth(1)
        .and_then(|value| value.split(".register_uri_scheme_protocol").next())
        .expect("Tauri command handler");
    for command in [
        "reserve_import_run",
        "get_active_import_run",
        "attach_import_run",
        "launch_import_run",
        "cancel_import_run",
        "acknowledge_import_run",
        "read_import_status",
    ] {
        assert!(
            handler.contains(command),
            "missing import command {command}"
        );
    }
    for obsolete in [
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
