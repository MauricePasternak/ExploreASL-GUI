#[cfg(test)]
mod tests {
  use crate::import::{
    authorize_stop_import_pid, clean_import_status_paths, cleanup_after_prepare_event_failure,
    cleanup_staging_root, clear_import_child_pid_if_matches, copy_lock_files_paths,
    find_executable_on_path, mark_import_termination_requested, move_import_output_paths,
    reserve_import_state, rollback_preparation_failure, should_emit_matlab_exit_error,
    take_matching_supervisor_handle, validate_import_not_running, validate_matlab_executable,
    validate_non_empty_inputs, validate_project_root_for_staging, validate_staging_root,
    validate_subject_components, AppState, ImportState, MatlabExitError, StagingEntry,
    RESERVED_IMPORT_PID,
  };
  use std::fs;
  use std::path::PathBuf;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn unique_temp_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock should be after unix epoch")
      .as_nanos();

    std::env::temp_dir().join(format!("exploreasl-gui-{name}-{suffix}"))
  }

  #[test]
  fn import_state_new_tracks_roots_and_subjects() {
    let staging_root = PathBuf::from("/tmp/project/.easl_staging");
    let project_root = PathBuf::from("/tmp/project");
    let subject_list = vec!["sub-001".to_string(), "sub-002".to_string()];

    let state = ImportState::new(
      staging_root.clone(),
      project_root.clone(),
      subject_list.clone(),
    );

    assert_eq!(state.child_pid, None);
    assert_eq!(state.staging_root, staging_root);
    assert_eq!(state.project_root, project_root);
    assert!(state.failed_subjects.is_empty());
    assert!(state.succeeded_subjects.is_empty());
    assert_eq!(state.subject_list, subject_list);
    assert!(state.supervisor_handle.is_none());
  }

  #[test]
  fn cleanup_staging_root_removes_existing_directory() {
    let staging_root = unique_temp_path("staging-cleanup");
    fs::create_dir_all(staging_root.join("sourcedata"))
      .expect("test staging directory should be created");
    fs::write(staging_root.join("sourcedata").join("marker.txt"), "stale")
      .expect("test marker should be written");

    cleanup_staging_root(&staging_root).expect("cleanup should remove staging root");

    assert!(!staging_root.exists());
  }

  #[test]
  fn validate_staging_root_requires_easl_staging_leaf() {
    let invalid_root = PathBuf::from("/tmp/project/rawdata");

    let error =
      validate_staging_root(&invalid_root).expect_err("non-staging root should be rejected");

    assert_eq!(
      error,
      "staging_root must end with .easl_staging: /tmp/project/rawdata"
    );
  }

  #[test]
  fn validate_staging_root_accepts_easl_staging_leaf() {
    let staging_root = PathBuf::from("/tmp/project/.easl_staging");

    validate_staging_root(&staging_root)
      .expect("staging root ending in .easl_staging should be accepted");
  }

  #[test]
  fn staging_entry_deserializes_frontend_source_path_and_converts_to_symlink_entry() {
    let entry: StagingEntry = serde_json::from_value(serde_json::json!({
        "subject": "sub-001",
        "session": "01",
        "run": "01",
        "modality": "ASL4D",
        "sourcePath": "/dicom/sub-001/asl"
    }))
    .expect("frontend staging entry should deserialize");

    let symlink_entry = entry.into_symlink_entry();

    assert_eq!(symlink_entry.subject, "sub-001");
    assert_eq!(symlink_entry.session, "01");
    assert_eq!(symlink_entry.run, "01");
    assert_eq!(symlink_entry.modality, "ASL4D");
    assert_eq!(symlink_entry.source_path, "/dicom/sub-001/asl");
  }

  #[test]
  fn rollback_preparation_failure_removes_partial_staging_and_preserves_error() {
    let staging_root = unique_temp_path("staging-rollback");
    fs::create_dir_all(staging_root.join("sourcedata").join("sub-001"))
      .expect("partial staging directory should be created");
    fs::write(
      staging_root
        .join("sourcedata")
        .join("sub-001")
        .join("marker.txt"),
      "partial",
    )
    .expect("partial staging marker should be written");

    let error = rollback_preparation_failure(&staging_root, "config write failed".to_string());

    assert_eq!(error, "config write failed");
    assert!(!staging_root.exists());
  }

  #[test]
  fn cleanup_after_prepare_event_failure_clears_reserved_state_and_removes_staging() {
    let app_state = AppState::default();
    let staging_root = unique_temp_path("prepare-event-failure");
    fs::create_dir_all(staging_root.join("sourcedata").join("sub-001"))
      .expect("prepared staging directory should be created");
    reserve_import_state(
      &app_state,
      staging_root.clone(),
      staging_root
        .parent()
        .expect("staging root should have parent")
        .to_path_buf(),
      vec!["sub-001".to_string()],
    )
    .expect("import state should be reserved");

    let error = cleanup_after_prepare_event_failure(
      &app_state,
      &staging_root,
      "Failed to emit ImportPrepareComplete: closed".to_string(),
    );

    assert_eq!(error, "Failed to emit ImportPrepareComplete: closed");
    assert!(!staging_root.exists());
    let state = app_state
      .import_state
      .lock()
      .expect("import state lock should be available");
    assert_eq!(state.child_pid, None);
  }

  #[test]
  fn validate_non_empty_inputs_rejects_empty_staging_entries_before_mutation() {
    let error = validate_non_empty_inputs(&[], &["sub-001".to_string()])
      .expect_err("empty staging entries should be rejected");

    assert_eq!(
      error,
      "staging_entries must contain at least one staging entry"
    );
  }

  #[test]
  fn validate_non_empty_inputs_rejects_empty_subject_list_before_mutation() {
    let entries = vec![StagingEntry {
      subject: "sub-001".to_string(),
      session: "01".to_string(),
      run: "01".to_string(),
      modality: "ASL4D".to_string(),
      source_path: "/dicom/sub-001/asl".to_string(),
    }];

    let error =
      validate_non_empty_inputs(&entries, &[]).expect_err("empty subject list should be rejected");

    assert_eq!(error, "subject_list must contain at least one subject");
  }

  #[test]
  fn validate_matlab_executable_rejects_missing_path_like_value() {
    let missing = unique_temp_path("missing-matlab").join("matlab");

    let error = validate_matlab_executable(&missing.to_string_lossy())
      .expect_err("missing matlab path should be rejected");

    assert!(error.contains("MATLAB executable not found"));
  }

  #[test]
  fn validate_matlab_executable_rejects_directory_path() {
    let matlab_dir = unique_temp_path("matlab-dir");
    fs::create_dir_all(&matlab_dir).expect("test matlab dir should be created");

    let error = validate_matlab_executable(&matlab_dir.to_string_lossy())
      .expect_err("directory should not be accepted as matlab executable");

    assert!(error.contains("MATLAB path is not a file"));

    let _ = fs::remove_dir_all(matlab_dir);
  }

  #[cfg(unix)]
  #[test]
  fn validate_matlab_executable_rejects_non_executable_file() {
    use std::os::unix::fs::PermissionsExt;

    let matlab = unique_temp_path("matlab-non-executable");
    fs::write(&matlab, "#!/bin/sh\n").expect("test matlab file should be written");
    fs::set_permissions(&matlab, fs::Permissions::from_mode(0o644))
      .expect("test matlab permissions should be set");

    let error = validate_matlab_executable(&matlab.to_string_lossy())
      .expect_err("non-executable matlab file should be rejected");

    assert!(error.contains("MATLAB executable is not executable"));

    let _ = fs::remove_file(matlab);
  }

  #[cfg(unix)]
  #[test]
  fn validate_matlab_executable_accepts_executable_file() {
    use std::os::unix::fs::PermissionsExt;

    let matlab = unique_temp_path("matlab-executable");
    fs::write(&matlab, "#!/bin/sh\n").expect("test matlab file should be written");
    fs::set_permissions(&matlab, fs::Permissions::from_mode(0o755))
      .expect("test matlab permissions should be set");

    let validated = validate_matlab_executable(&matlab.to_string_lossy())
      .expect("executable matlab file should be accepted");

    assert_eq!(validated, matlab.to_string_lossy());

    let _ = fs::remove_file(matlab);
  }

  #[test]
  fn find_executable_on_path_accepts_bare_command_from_supplied_path() {
    let bin_dir = unique_temp_path("matlab-path-bin");
    fs::create_dir_all(&bin_dir).expect("test bin dir should be created");
    let matlab = bin_dir.join("matlab");
    fs::write(&matlab, "#!/bin/sh\n").expect("test matlab command should be written");

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      fs::set_permissions(&matlab, fs::Permissions::from_mode(0o755))
        .expect("test matlab command permissions should be set");
    }

    let found = find_executable_on_path("matlab", &bin_dir.to_string_lossy())
      .expect("bare matlab command should be found on supplied PATH");

    assert_eq!(found, matlab);

    let _ = fs::remove_dir_all(bin_dir);
  }

  #[test]
  fn validate_import_not_running_rejects_active_child_pid() {
    let mut state = ImportState::new(
      PathBuf::from("/tmp/project/.easl_staging"),
      PathBuf::from("/tmp/project"),
      vec!["sub-001".to_string()],
    );
    state.child_pid = Some(42);

    let error = validate_import_not_running(&state)
      .expect_err("active import pid should reject a new import");

    assert_eq!(error, "An import is already running with process PID 42");
  }

  #[test]
  fn clear_import_child_pid_if_matches_only_clears_matching_pid() {
    let mut state = ImportState::new(
      PathBuf::from("/tmp/project/.easl_staging"),
      PathBuf::from("/tmp/project"),
      vec!["sub-001".to_string()],
    );
    state.child_pid = Some(42);

    clear_import_child_pid_if_matches(&mut state, 7);
    assert_eq!(state.child_pid, Some(42));

    clear_import_child_pid_if_matches(&mut state, 42);
    assert_eq!(state.child_pid, None);
  }

  #[test]
  fn authorize_stop_import_pid_rejects_no_active_import() {
    let state = AppState::default();

    let error = authorize_stop_import_pid(&state, 42)
      .expect_err("stop should reject when no import is active");

    assert_eq!(error, "No import process is currently running");
  }

  #[test]
  fn authorize_stop_import_pid_rejects_reserved_import_pid() {
    let state = AppState::default();
    {
      let mut import_state = state
        .import_state
        .lock()
        .expect("import state lock should be available");
      import_state.child_pid = Some(RESERVED_IMPORT_PID);
    }

    let error = authorize_stop_import_pid(&state, RESERVED_IMPORT_PID)
      .expect_err("reserved import PID must not be signaled");

    assert_eq!(error, "Import is still preparing and cannot be stopped yet");
  }

  #[test]
  fn authorize_stop_import_pid_rejects_mismatched_pid() {
    let state = AppState::default();
    {
      let mut import_state = state
        .import_state
        .lock()
        .expect("import state lock should be available");
      import_state.child_pid = Some(42);
    }

    let error = authorize_stop_import_pid(&state, 7)
      .expect_err("stop should reject PIDs not owned by import state");

    assert_eq!(error, "Requested PID 7 does not match active import PID 42");
  }

  #[test]
  fn authorize_stop_import_pid_accepts_matching_active_pid() {
    let state = AppState::default();
    {
      let mut import_state = state
        .import_state
        .lock()
        .expect("import state lock should be available");
      import_state.child_pid = Some(42);
    }

    authorize_stop_import_pid(&state, 42).expect("matching import PID should be accepted");
  }

  #[test]
  fn validate_subject_components_rejects_path_traversal_and_separators() {
    for invalid_subject in ["", ".", "..", "../evil", "evil/subject", "evil\\subject"] {
      let error = validate_subject_components(&[invalid_subject.to_string()])
        .expect_err("invalid subject path component should be rejected");

      assert!(error.contains("Invalid subject"));
    }
  }

  #[test]
  fn validate_subject_components_accepts_single_path_components() {
    validate_subject_components(&["BADDIE_ses-01_run-1".to_string()])
      .expect("single path component subject should be accepted");
  }

  #[test]
  fn validate_project_root_for_staging_rejects_mismatched_roots() {
    let staging_root = unique_temp_path("root-mismatch-staging").join(".easl_staging");
    let project_root = unique_temp_path("root-mismatch-project");
    fs::create_dir_all(&staging_root).expect("staging root should be created");
    fs::create_dir_all(&project_root).expect("project root should be created");

    let error = validate_project_root_for_staging(&staging_root, &project_root)
      .expect_err("project root must be the staging parent");

    assert!(error.contains("project_root must be the parent of staging_root"));

    let _ = fs::remove_dir_all(
      staging_root
        .parent()
        .expect("staging root should have parent"),
    );
    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn validate_project_root_for_staging_accepts_staging_parent() {
    let project_root = unique_temp_path("root-match-project");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(&staging_root).expect("staging root should be created");

    validate_project_root_for_staging(&staging_root, &project_root)
      .expect("project root parent should be accepted");

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_rejects_project_root_mismatch_before_deleting_outputs() {
    let project_root = unique_temp_path("move-mismatch-project");
    let staging_parent = unique_temp_path("move-mismatch-staging-parent");
    let staging_root = staging_parent.join(".easl_staging");
    fs::create_dir_all(&staging_root).expect("staging root should be created");
    fs::create_dir_all(project_root.join("rawdata")).expect("project rawdata should be created");
    fs::write(project_root.join("rawdata").join("keep.txt"), "keep")
      .expect("project marker should be written");

    let error = move_import_output_paths(&staging_root, &project_root, None, false)
      .expect_err("mismatched project root should be rejected");

    assert!(error.contains("project_root must be the parent of staging_root"));
    assert_eq!(
      fs::read_to_string(project_root.join("rawdata").join("keep.txt"))
        .expect("project marker should remain"),
      "keep"
    );

    let _ = fs::remove_dir_all(project_root);
    let _ = fs::remove_dir_all(staging_parent);
  }

  #[test]
  fn copy_lock_files_rejects_project_root_mismatch_before_writing_staging() {
    let project_root = unique_temp_path("copy-mismatch-project");
    let staging_parent = unique_temp_path("copy-mismatch-staging-parent");
    let staging_root = staging_parent.join(".easl_staging");
    fs::create_dir_all(&staging_root).expect("staging root should be created");
    write_status_files(&project_root, "BADDIE");

    let error = copy_lock_files_paths(&project_root, &staging_root, &["BADDIE".to_string()])
      .expect_err("mismatched project root should be rejected");

    assert!(error.contains("project_root must be the parent of staging_root"));
    assert!(!import_lock_dir(&staging_root, "BADDIE").exists());

    let _ = fs::remove_dir_all(project_root);
    let _ = fs::remove_dir_all(staging_parent);
  }

  #[test]
  fn clean_import_status_rejects_traversal_subjects() {
    let staging_root = unique_temp_path("clean-traversal").join(".easl_staging");

    let error = clean_import_status_paths(&staging_root, &["../evil".to_string()])
      .expect_err("traversal subject should be rejected");

    assert!(error.contains("Invalid subject"));
  }

  #[test]
  fn copy_lock_files_rejects_traversal_subjects() {
    let project_root = unique_temp_path("copy-traversal-project");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(&staging_root).expect("staging root should be created");

    let error = copy_lock_files_paths(&project_root, &staging_root, &["evil/subject".to_string()])
      .expect_err("separator subject should be rejected");

    assert!(error.contains("Invalid subject"));

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_partial_rejects_traversal_subjects() {
    let project_root = unique_temp_path("move-partial-traversal");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(&staging_root).expect("staging root should be created");

    let error = move_import_output_paths(
      &staging_root,
      &project_root,
      Some(&["..".to_string()]),
      false,
    )
    .expect_err("partial move should reject traversal subjects");

    assert!(error.contains("Invalid subject"));

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn intentional_termination_suppresses_matlab_exit_error_once() {
    let mut state = ImportState::new(
      PathBuf::from("/tmp/project/.easl_staging"),
      PathBuf::from("/tmp/project"),
      vec!["sub-001".to_string()],
    );
    state.child_pid = Some(42);
    mark_import_termination_requested(&mut state, 42);

    assert!(!should_emit_matlab_exit_error(&mut state, 42, false));
    assert!(should_emit_matlab_exit_error(&mut state, 42, false));
  }

  #[test]
  fn supervisor_handle_cleanup_preserves_termination_intent_until_exit_decision() {
    let state = AppState::default();
    {
      let mut import_state = state
        .import_state
        .lock()
        .expect("import state lock should be available");
      import_state.child_pid = Some(42);
      mark_import_termination_requested(&mut import_state, 42);
    }

    let handle = take_matching_supervisor_handle(&state, 42);
    assert!(handle.is_none());

    let mut import_state = state
      .import_state
      .lock()
      .expect("import state lock should be available");
    assert_eq!(import_state.child_pid, None);
    assert_eq!(import_state.termination_requested_for, Some(42));
    assert!(!should_emit_matlab_exit_error(&mut import_state, 42, false));
    assert_eq!(import_state.termination_requested_for, None);
  }

  #[test]
  fn successful_matlab_exit_does_not_emit_exit_error() {
    let mut state = ImportState::new(
      PathBuf::from("/tmp/project/.easl_staging"),
      PathBuf::from("/tmp/project"),
      vec!["sub-001".to_string()],
    );

    assert!(!should_emit_matlab_exit_error(&mut state, 42, true));
  }

  fn import_lock_dir(root: &std::path::Path, subject: &str) -> PathBuf {
    root
      .join("derivatives")
      .join("ExploreASL")
      .join("lock")
      .join("xASL_module_Import")
      .join(subject)
      .join("xASL_module_Import")
  }

  fn write_status_files(root: &std::path::Path, subject: &str) {
    let lock_dir = import_lock_dir(root, subject);
    fs::create_dir_all(&lock_dir).expect("lock dir should be created");
    for file_name in [
      "010_DCM2NII.status",
      "020_NII2BIDS.status",
      "999_ready.status",
    ] {
      fs::write(lock_dir.join(file_name), file_name).expect("status file should be written");
    }
  }

  #[test]
  fn clean_import_status_removes_only_expected_status_files_and_ignores_missing() {
    let staging_root = unique_temp_path("clean-import-status");
    write_status_files(&staging_root, "BADDIE");
    let lock_dir = import_lock_dir(&staging_root, "BADDIE");
    fs::write(lock_dir.join("keep.status"), "keep").expect("extra file should be written");

    clean_import_status_paths(
      &staging_root,
      &["BADDIE".to_string(), "MISSING".to_string()],
    )
    .expect("cleaning import statuses should succeed");

    assert!(!lock_dir.join("010_DCM2NII.status").exists());
    assert!(!lock_dir.join("020_NII2BIDS.status").exists());
    assert!(!lock_dir.join("999_ready.status").exists());
    assert_eq!(
      fs::read_to_string(lock_dir.join("keep.status")).expect("extra file should remain"),
      "keep"
    );

    let _ = fs::remove_dir_all(staging_root);
  }

  #[test]
  fn copy_lock_files_copies_expected_status_files_and_creates_destination_dirs() {
    let project_root = unique_temp_path("copy-lock-project");
    let staging_root = project_root.join(".easl_staging");
    write_status_files(&project_root, "BADDIE");

    copy_lock_files_paths(&project_root, &staging_root, &["BADDIE".to_string()])
      .expect("lock files should be copied");

    let staging_lock_dir = import_lock_dir(&staging_root, "BADDIE");
    for file_name in [
      "010_DCM2NII.status",
      "020_NII2BIDS.status",
      "999_ready.status",
    ] {
      assert_eq!(
        fs::read_to_string(staging_lock_dir.join(file_name))
          .expect("copied status file should exist"),
        file_name
      );
    }

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_full_success_replaces_project_outputs_and_removes_staging() {
    let project_root = unique_temp_path("move-full-project");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(project_root.join("rawdata").join("old"))
      .expect("old project rawdata should be created");
    fs::create_dir_all(project_root.join("derivatives").join("old"))
      .expect("old project derivatives should be created");
    fs::create_dir_all(staging_root.join("rawdata").join("sub-BADDIE"))
      .expect("staging rawdata should be created");
    fs::write(
      staging_root
        .join("rawdata")
        .join("sub-BADDIE")
        .join("asl.nii"),
      "asl",
    )
    .expect("staging rawdata file should be written");
    write_status_files(&staging_root, "BADDIE");
    fs::write(staging_root.join("sourcestructure.json"), "{}")
      .expect("sourcestructure should be written");
    fs::write(staging_root.join("studyPar.json"), "{}").expect("studyPar should be written");

    move_import_output_paths(&staging_root, &project_root, None, false)
      .expect("full move should succeed");

    assert!(project_root
      .join("rawdata")
      .join("sub-BADDIE")
      .join("asl.nii")
      .exists());
    assert!(import_lock_dir(&project_root, "BADDIE")
      .join("010_DCM2NII.status")
      .exists());
    assert!(!project_root.join("rawdata").join("old").exists());
    assert!(!project_root.join("derivatives").join("old").exists());
    assert!(!staging_root.exists());

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_full_success_debug_preserves_staging_and_copies_configs() {
    let project_root = unique_temp_path("move-full-debug-project");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(staging_root.join("rawdata")).expect("staging rawdata should exist");
    fs::create_dir_all(staging_root.join("derivatives")).expect("staging derivatives should exist");
    fs::write(
      staging_root.join("sourcestructure.json"),
      "{\"source\":true}",
    )
    .expect("sourcestructure should be written");
    fs::write(staging_root.join("studyPar.json"), "{\"study\":true}")
      .expect("studyPar should be written");

    move_import_output_paths(&staging_root, &project_root, None, true)
      .expect("debug full move should succeed");

    assert!(staging_root.exists());
    assert_eq!(
      fs::read_to_string(
        project_root
          .join("derivatives")
          .join("ExploreASL_GUI")
          .join("sourcestructure.json")
      )
      .expect("sourcestructure config should be copied"),
      "{\"source\":true}"
    );
    assert_eq!(
      fs::read_to_string(
        project_root
          .join("derivatives")
          .join("ExploreASL_GUI")
          .join("studyPar.json")
      )
      .expect("studyPar config should be copied"),
      "{\"study\":true}"
    );

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_partial_success_copies_succeeded_subject_artifacts_only() {
    let project_root = unique_temp_path("move-partial-project");
    let staging_root = project_root.join(".easl_staging");
    fs::create_dir_all(staging_root.join("rawdata").join("sub-BADDIE"))
      .expect("succeeded rawdata should exist");
    fs::create_dir_all(staging_root.join("rawdata").join("sub-FAILED"))
      .expect("failed rawdata should exist");
    fs::write(
      staging_root
        .join("rawdata")
        .join("sub-BADDIE")
        .join("asl.nii"),
      "asl",
    )
    .expect("succeeded rawdata should be written");
    fs::write(
      staging_root
        .join("rawdata")
        .join("dataset_description.json"),
      "{\"Name\":\"Study\"}",
    )
    .expect("dataset description should be written");
    write_status_files(&staging_root, "BADDIE");
    write_status_files(&staging_root, "FAILED");
    let log_dir = staging_root
      .join("derivatives")
      .join("ExploreASL")
      .join("log");
    fs::create_dir_all(&log_dir).expect("log dir should exist");
    fs::write(log_dir.join("import_sub-BADDIE.log"), "ok").expect("matching log should exist");
    fs::write(log_dir.join("import_sub-FAILED.log"), "bad").expect("other log should exist");

    move_import_output_paths(
      &staging_root,
      &project_root,
      Some(&["BADDIE".to_string()]),
      false,
    )
    .expect("partial move should succeed");

    assert!(staging_root.exists());
    assert!(project_root
      .join("rawdata")
      .join("sub-BADDIE")
      .join("asl.nii")
      .exists());
    assert!(!project_root.join("rawdata").join("sub-FAILED").exists());
    assert_eq!(
      fs::read_to_string(
        project_root
          .join("rawdata")
          .join("dataset_description.json")
      )
      .expect("dataset description should be copied"),
      "{\"Name\":\"Study\"}"
    );
    assert!(import_lock_dir(&project_root, "BADDIE")
      .join("999_ready.status")
      .exists());
    assert!(!import_lock_dir(&project_root, "FAILED").exists());
    assert!(project_root
      .join("derivatives")
      .join("ExploreASL")
      .join("log")
      .join("import_sub-BADDIE.log")
      .exists());
    assert!(!project_root
      .join("derivatives")
      .join("ExploreASL")
      .join("log")
      .join("import_sub-FAILED.log")
      .exists());

    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn move_import_output_rejects_destructive_delete_outside_easl_staging_leaf() {
    let project_root = unique_temp_path("move-safety-project");
    let unsafe_staging_root = project_root.join("not-staging");

    let error = move_import_output_paths(&unsafe_staging_root, &project_root, None, false)
      .expect_err("non .easl_staging roots should be rejected");

    assert!(error.contains("staging_root must end with .easl_staging"));
    let _ = fs::remove_dir_all(project_root);
  }

  #[test]
  fn matlab_exit_error_serializes_exit_code() {
    let value = serde_json::to_value(MatlabExitError { exit_code: 42 })
      .expect("MatlabExitError should serialize");

    assert_eq!(value, serde_json::json!({ "exitCode": 42 }));
  }
}
