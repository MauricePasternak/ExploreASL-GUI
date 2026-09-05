#[cfg(test)]
mod tests {
    use crate::execution_profile::ExecutionProfile;
    use crate::import::{
        AppState, ImportCommandError, ImportLifecycle, ImportPrepareComplete,
        ImportRawEventPayload, ImportState, ImportStructuredEventPayload, MatlabExitError,
        RESERVED_IMPORT_PID, StagingEntry, authorize_stop_import_pid, build_apptainer_import_args,
        canonicalize_import_event_subject, clean_import_status_for_state,
        clean_import_status_paths, cleanup_after_prepare_event_failure, cleanup_staging_root,
        clear_matching_termination_intent, clear_reserved_import, copy_lock_files_for_state,
        copy_lock_files_paths, find_executable_on_path, mark_import_terminal_if_matches,
        mark_import_termination_requested, move_import_output_for_state, move_import_output_paths,
        normalize_staging_subject_spelling, record_import_results, reserve_import_state,
        reserve_import_state_for_run, rollback_preparation_failure, rollback_process_spawn_failure,
        run_import_pipeline, set_reserved_import_pid, should_emit_matlab_exit_error,
        start_supervisor_or_reap, stop_import_pid_with, take_matching_supervisor_handle,
        validate_import_not_running, validate_matlab_executable, validate_non_empty_inputs,
        validate_project_root_for_staging, validate_staging_root, validate_subject_components,
        validate_subject_scope,
    };
    use crate::import_parser::ImportStructuredEvent;
    use std::cell::Cell;
    use std::fs;
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::process::Command;
    use std::sync::{Arc, Barrier, mpsc};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::Manager;
    use tempfile::tempdir;

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!("exploreasl-gui-{name}-{suffix}"))
    }

    #[test]
    fn import_state_new_tracks_roots_and_subjects() {
        let temp = std::env::temp_dir();
        let staging_root = temp.join("project").join(".easl_staging");
        let project_root = temp.join("project");
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
        let temp = std::env::temp_dir();
        let invalid_root = temp.join("project").join("rawdata");

        let error =
            validate_staging_root(&invalid_root).expect_err("non-staging root should be rejected");

        assert_eq!(
            error,
            format!(
                "staging_root must end with .easl_staging: {}",
                invalid_root.display()
            )
        );
    }

    #[test]
    fn validate_staging_root_accepts_easl_staging_leaf() {
        let staging_root = std::env::temp_dir().join("project").join(".easl_staging");

        validate_staging_root(&staging_root)
            .expect("staging root ending in .easl_staging should be accepted");
    }

    #[test]
    fn staging_entry_deserializes_frontend_provenance() {
        let entry: StagingEntry = serde_json::from_value(serde_json::json!({
            "subject": "sub-001",
            "session": "01",
            "run": "01",
            "runAlias": "ASL1",
            "modality": "ASL4D",
            "originalSubject": "sub-001",
            "originalSession": "01",
            "originalRun": "01",
            "sourcePath": "/dicom/sub-001/asl"
        }))
        .expect("frontend staging entry should deserialize");

        assert_eq!(entry.subject, "sub-001");
        assert_eq!(entry.run_alias, "ASL1");
        assert_eq!(entry.original_subject, "sub-001");
        assert_eq!(entry.source_path, "/dicom/sub-001/asl");
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
    fn cleanup_after_spawned_prepare_event_failure_clears_matching_running_state_and_staging() {
        let app_state = AppState::default();
        let staging_root = unique_temp_path("prepare-event-failure");
        fs::create_dir_all(staging_root.join("sourcedata").join("sub-001"))
            .expect("prepared staging directory should be created");
        let generation = reserve_import_state(
            &app_state,
            staging_root.clone(),
            staging_root
                .parent()
                .expect("staging root should have parent")
                .to_path_buf(),
            "request-a".to_string(),
            vec!["sub-001".to_string()],
        )
        .expect("import state should be reserved");
        set_reserved_import_pid(&app_state, generation, 4242)
            .expect("spawned child should atomically enter running ownership");

        let error = cleanup_after_prepare_event_failure(
            &app_state,
            generation,
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
        assert!(state.staging_root.as_os_str().is_empty());
        assert!(state.project_root.as_os_str().is_empty());
        assert!(state.subject_list.is_empty());
    }

    #[test]
    fn readiness_failure_cleanup_never_clears_or_deletes_replacement_ownership() {
        let app_state = AppState::default();
        let old_staging = unique_temp_path("old-prepare-event");
        let replacement_staging = unique_temp_path("replacement-prepare-event");
        fs::create_dir_all(&old_staging).expect("old staging");
        fs::create_dir_all(&replacement_staging).expect("replacement staging");
        fs::write(old_staging.join("old.txt"), "old").expect("old marker");
        fs::write(replacement_staging.join("new.txt"), "new").expect("new marker");

        let old_generation = reserve_import_state(
            &app_state,
            old_staging.clone(),
            old_staging.parent().expect("project root").to_path_buf(),
            "request-old".to_string(),
            vec!["OLD".to_string()],
        )
        .expect("old reservation");
        set_reserved_import_pid(&app_state, old_generation, 41).expect("old running state");
        {
            let mut state = app_state.import_state.lock().expect("state lock");
            assert!(mark_import_terminal_if_matches(
                &mut state,
                old_generation,
                41
            ));
        }
        let replacement_generation = reserve_import_state(
            &app_state,
            replacement_staging.clone(),
            replacement_staging
                .parent()
                .expect("project root")
                .to_path_buf(),
            "request-new".to_string(),
            vec!["NEW".to_string()],
        )
        .expect("replacement reservation");

        let error = cleanup_after_prepare_event_failure(
            &app_state,
            old_generation,
            &old_staging,
            "old readiness event failed".to_string(),
        );

        assert_eq!(error, "old readiness event failed");
        assert_eq!(
            app_state
                .import_state
                .lock()
                .expect("state lock")
                .ownership_generation,
            replacement_generation
        );
        assert!(old_staging.join("old.txt").exists());
        assert!(replacement_staging.join("new.txt").exists());
    }

    #[test]
    fn stale_generation_cannot_record_results_for_replacement_ownership() {
        let mut state = ImportState::new(
            PathBuf::from("/replacement/.easl_staging"),
            PathBuf::from("/replacement"),
            vec!["NEW".to_string()],
        );
        state.ownership_generation = 2;
        state.lifecycle = ImportLifecycle::Running;
        state.child_pid = Some(42);

        assert!(!record_import_results(
            &mut state,
            1,
            &ImportStructuredEvent::ImportFailed {
                subject: "NEW".to_string(),
                step: "DCM2NII".to_string(),
                message: "old generation".to_string(),
            },
        ));
        assert!(state.failed_subjects.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn closed_readiness_gate_terminates_and_reaps_spawned_child() {
        let mut child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("test child should spawn");
        let (sender, receiver) = mpsc::channel();
        drop(sender);

        assert!(!start_supervisor_or_reap(&mut child, receiver));
        assert!(child.try_wait().expect("reaped child status").is_some());
    }

    #[test]
    fn clearing_pre_spawn_reservation_releases_all_owned_import_fields_for_retry() {
        let state = AppState::default();
        let staging_root = unique_temp_path("reserved-retry");
        let generation = reserve_import_state(
            &state,
            staging_root.clone(),
            staging_root.parent().expect("parent").to_path_buf(),
            "request-a".to_string(),
            vec!["A01".to_string()],
        )
        .expect("reserve");

        clear_reserved_import(&state, generation);
        reserve_import_state(
            &state,
            staging_root.clone(),
            staging_root.parent().expect("parent").to_path_buf(),
            "request-b".to_string(),
            vec!["A01".to_string()],
        )
        .expect("corrected retry reserves again");
    }

    #[test]
    fn apptainer_spawn_failure_rolls_back_prepared_tree_and_reservation() {
        let state = AppState::default();
        let staging_root = unique_temp_path("apptainer-spawn-rollback");
        fs::create_dir_all(staging_root.join("sourcedata")).expect("prepared tree");
        fs::write(staging_root.join("sourcedata/sentinel.dcm"), "prepared").expect("sentinel");
        let generation = reserve_import_state(
            &state,
            staging_root.clone(),
            staging_root.parent().expect("project root").to_path_buf(),
            "request-a".to_string(),
            vec!["A01".to_string()],
        )
        .expect("reserve import state");

        let error = rollback_process_spawn_failure(
            &state,
            generation,
            &staging_root,
            "Apptainer",
            "/missing/apptainer",
            std::io::Error::new(std::io::ErrorKind::NotFound, "missing"),
        );

        assert!(matches!(error, ImportCommandError::Operational { .. }));
        assert!(!staging_root.exists());
        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.child_pid, None);
        assert!(import_state.staging_root.as_os_str().is_empty());
        assert!(import_state.project_root.as_os_str().is_empty());
        assert!(import_state.subject_list.is_empty());
    }

    #[test]
    fn import_command_error_serializes_tagged_preflight_and_operational_variants() {
        let preflight = serde_json::to_value(ImportCommandError::Preflight { issues: vec![] })
            .expect("preflight serializes");
        let operational = serde_json::to_value(ImportCommandError::Operational {
            message: "legacy-compatible message".to_string(),
        })
        .expect("operational serializes");

        assert_eq!(
            preflight,
            serde_json::json!({ "kind": "preflight", "issues": [] })
        );
        assert_eq!(
            operational,
            serde_json::json!({ "kind": "operational", "message": "legacy-compatible message" })
        );
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
            run_alias: "ASL1".to_string(),
            modality: "ASL4D".to_string(),
            original_subject: "sub-001".to_string(),
            original_session: "01".to_string(),
            original_run: "01".to_string(),
            source_path: "/dicom/sub-001/asl".to_string(),
        }];

        let error = validate_non_empty_inputs(&entries, &[])
            .expect_err("empty subject list should be rejected");

        assert_eq!(error, "subject_list must contain at least one subject");
    }

    fn scoped_entry(subject: &str, source_path: &str) -> StagingEntry {
        StagingEntry {
            subject: subject.to_string(),
            session: "01".to_string(),
            run: "01".to_string(),
            run_alias: "ASL_1".to_string(),
            modality: "ASL4D".to_string(),
            original_subject: subject.to_string(),
            original_session: "01".to_string(),
            original_run: "01".to_string(),
            source_path: source_path.to_string(),
        }
    }

    #[test]
    fn subject_scope_accepts_multiple_entries_per_declared_subject() {
        let entries = vec![
            scoped_entry("A", "/source/A/asl"),
            scoped_entry("A", "/source/A/m0"),
            scoped_entry("B", "/source/B/asl"),
        ];

        validate_subject_scope(&entries, &["A".to_string(), "B".to_string()])
            .expect("distinct staging subjects match the declared subject set");
    }

    #[test]
    fn subject_scope_rejects_undeclared_staging_subjects() {
        let entries = vec![
            scoped_entry("A", "/source/A/asl"),
            scoped_entry("EXTRA", "/source/extra/asl"),
        ];

        let error = validate_subject_scope(&entries, &["A".to_string(), "MISSING".to_string()])
            .expect_err("undeclared staging subject should be rejected");

        assert!(error.contains("undeclared staging subjects: EXTRA"));
        assert!(error.contains("declared subjects without staging entries: MISSING"));
    }

    #[test]
    fn subject_scope_rejects_declared_subjects_without_entries() {
        let entries = vec![scoped_entry("A", "/source/A/asl")];

        let error = validate_subject_scope(&entries, &["A".to_string(), "MISSING".to_string()])
            .expect_err("declared subject without entries should be rejected");

        assert!(error.contains("declared subjects without staging entries: MISSING"));
    }

    #[test]
    fn subject_scope_uses_portable_case_and_unicode_comparison() {
        let entries = vec![
            scoped_entry("subjecta", "/source/a/asl"),
            scoped_entry("Straße", "/source/strasse/asl"),
        ];

        validate_subject_scope(&entries, &["SUBJECTA".to_string(), "STRASSE".to_string()])
            .expect("portable-equivalent subject spellings should agree");
    }

    #[test]
    fn import_results_use_owned_spelling_for_portable_equivalent_parser_subjects() {
        let mut state = ImportState::new(
            PathBuf::from("/project/.easl_staging"),
            PathBuf::from("/project"),
            vec!["SubjectA".to_string(), "Straße".to_string()],
        );

        assert!(record_import_results(
            &mut state,
            0,
            &ImportStructuredEvent::SubjectComplete {
                subject: "subjecta".to_string(),
                duration_secs: 1,
            },
        ));
        assert!(record_import_results(
            &mut state,
            0,
            &ImportStructuredEvent::SubjectComplete {
                subject: "STRASSE".to_string(),
                duration_secs: 1,
            },
        ));

        assert_eq!(state.succeeded_subjects, ["SubjectA", "Straße"]);
    }

    #[test]
    fn structured_events_expose_canonical_owned_subject_spelling() {
        for mut event in [
            ImportStructuredEvent::SubjectStart {
                subject: "subjecta".to_string(),
                step: "DCM2NII".to_string(),
            },
            ImportStructuredEvent::Dcm2NiiStatus {
                subject: "STRASSE".to_string(),
                exit_code: 0,
            },
        ] {
            assert!(canonicalize_import_event_subject(
                &mut event,
                &["SubjectA".to_string(), "Straße".to_string()],
            ));
            let subject = match event {
                ImportStructuredEvent::SubjectStart { subject, .. }
                | ImportStructuredEvent::Dcm2NiiStatus { subject, .. } => subject,
                _ => unreachable!(),
            };
            assert!(subject == "SubjectA" || subject == "Straße");
        }
    }

    #[test]
    fn relocation_uses_canonical_owned_spelling_after_portable_result_matches() {
        for (canonical, parsed) in [("SubjectA", "subjecta"), ("Straße", "STRASSE")] {
            let workspace = tempdir().expect("workspace");
            let project_root = workspace.path().join("project");
            let state = state_with_active_project(&project_root);
            let staging_root = project_root.join(".easl_staging");
            fs::create_dir_all(staging_root.join(format!("rawdata/sub-{canonical}"))).unwrap();
            fs::write(
                staging_root.join(format!("rawdata/sub-{canonical}/new.nii")),
                "new",
            )
            .unwrap();
            set_import_ownership(&state, &project_root, &[canonical], &[], &[]);
            assert!(record_import_results(
                &mut state.import_state.lock().unwrap(),
                0,
                &ImportStructuredEvent::SubjectComplete {
                    subject: parsed.to_string(),
                    duration_secs: 1,
                },
            ));

            let outcome = move_import_output_for_state(&state, true, false).unwrap();

            assert_eq!(outcome.subjects[0].subject, canonical);
            assert_eq!(
                fs::read_to_string(project_root.join(format!("rawdata/sub-{canonical}/new.nii")))
                    .unwrap(),
                "new"
            );
            let subject_directories = fs::read_dir(project_root.join("rawdata"))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
                .filter(|name| name.starts_with("sub-"))
                .collect::<Vec<_>>();
            assert_eq!(subject_directories, [format!("sub-{canonical}")]);
        }
    }

    #[test]
    fn canonical_owned_subject_spelling_flows_through_staging_and_relocation() {
        for (canonical, entry_spelling) in [("SubjectA", "subjecta"), ("STRASSE", "Straße")] {
            let workspace = tempdir().expect("workspace");
            let project_root = workspace.path().join("project");
            let source = workspace.path().join("source.nii");
            fs::create_dir_all(&project_root).unwrap();
            fs::write(&source, "source").unwrap();
            let state = state_with_active_project(&project_root);
            let entry = scoped_entry(entry_spelling, source.to_string_lossy().as_ref());

            let normalized = normalize_staging_subject_spelling(
                std::slice::from_ref(&entry),
                &[canonical.to_string()],
            )
            .expect("portable subject normalization");
            assert_eq!(normalized[0].subject, canonical);
            assert_eq!(normalized[0].original_subject, entry.original_subject);
            assert_eq!(normalized[0].source_path, entry.source_path);
            let compiled = crate::import::staging::compile_staging_plan(
                Some(fs::canonicalize(&project_root).unwrap()),
                &normalized,
            )
            .expect("compiled canonical staging plan");
            crate::import::staging::execute_compiled_staging_plan(&compiled).unwrap();
            assert!(
                compiled.records[0].destination.starts_with(
                    project_root
                        .join(".easl_staging/sourcedata")
                        .join(canonical)
                )
            );

            let staging_root = project_root.join(".easl_staging");
            fs::create_dir_all(staging_root.join(format!("rawdata/sub-{canonical}"))).unwrap();
            fs::write(
                staging_root.join(format!("rawdata/sub-{canonical}/new.nii")),
                "new",
            )
            .unwrap();
            set_import_ownership(&state, &project_root, &[canonical], &[], &[]);
            assert!(record_import_results(
                &mut state.import_state.lock().unwrap(),
                0,
                &ImportStructuredEvent::SubjectComplete {
                    subject: entry_spelling.to_string(),
                    duration_secs: 1,
                },
            ));
            let outcome = move_import_output_for_state(&state, true, false).unwrap();
            assert_eq!(outcome.subjects[0].subject, canonical);
            assert!(
                project_root
                    .join(format!("rawdata/sub-{canonical}/new.nii"))
                    .exists()
            );
        }
    }

    #[test]
    fn canonical_staging_normalization_rejects_portable_duplicate_declarations() {
        let entry = scoped_entry("subjecta", "/source.nii");
        assert!(
            normalize_staging_subject_spelling(
                &[entry],
                &["SubjectA".to_string(), "subjecta".to_string()],
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_pipeline_stages_and_relocates_with_declared_canonical_subject_spelling() {
        use std::os::unix::fs::PermissionsExt;

        for (canonical, entry_spelling) in [("SubjectA", "subjecta"), ("STRASSE", "Straße")] {
            let workspace = tempdir().expect("workspace");
            let project_root = workspace.path().join("project");
            let source = workspace.path().join("source.nii");
            let fake_matlab = workspace.path().join("matlab");
            let exploreasl = workspace.path().join("ExploreASL");
            fs::create_dir_all(&project_root).unwrap();
            fs::create_dir_all(&exploreasl).unwrap();
            fs::write(&source, "source").unwrap();
            fs::write(exploreasl.join("ExploreASL.m"), "% fake").unwrap();
            fs::write(
                &fake_matlab,
                format!(
                    "#!/bin/sh\nmkdir -p \"{}/.easl_staging/rawdata/sub-{}\"\nprintf new > \"{}/.easl_staging/rawdata/sub-{}/new.nii\"\nprintf '%s\\n' 'Subject: {}, Module: Import' 'Job-iteration 1 stopped at now and took 1 seconds' 'xASL_module_Import completed 100%'\n",
                    project_root.display(),
                    canonical,
                    project_root.display(),
                    canonical,
                    canonical,
                ),
            )
            .unwrap();
            let mut permissions = fs::metadata(&fake_matlab).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&fake_matlab, permissions).unwrap();

            let app = tauri::test::mock_builder()
                .manage(AppState::default())
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .expect("test app");
            let state = app.state::<AppState>();
            let canonical_root = fs::canonicalize(&project_root).unwrap();
            *state.active_project_root.lock().unwrap() = Some(canonical_root.clone());
            let plan_id = format!("canonical-pipeline-{canonical}");
            let plan = crate::import_relocation::create_plan(
                &canonical_root,
                &[canonical.to_string()],
                plan_id.clone(),
            )
            .unwrap();
            state
                .relocation_plans
                .lock()
                .unwrap()
                .insert(plan_id.clone(), plan);
            let entry = scoped_entry(entry_spelling, source.to_string_lossy().as_ref());

            let pid = run_import_pipeline(
                app.handle().clone(),
                state.clone(),
                vec![entry.clone()],
                serde_json::json!({}),
                serde_json::json!({}),
                ExecutionProfile::Matlab {
                    id: "fake".to_string(),
                    label: "Fake MATLAB".to_string(),
                    matlab_path: fake_matlab.to_string_lossy().to_string(),
                    explore_asl_path: exploreasl.to_string_lossy().to_string(),
                    explore_asl_version: None,
                },
                vec![canonical.to_string()],
                None,
                format!("canonical-run-{canonical}"),
                plan_id,
            )
            .expect("pipeline starts");

            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if state.import_state.lock().unwrap().lifecycle == ImportLifecycle::Terminal {
                    break;
                }
                assert!(Instant::now() < deadline, "fake import did not terminate");
                std::thread::sleep(Duration::from_millis(10));
            }
            let generation = state.import_state.lock().unwrap().ownership_generation;
            take_matching_supervisor_handle(&state, generation, pid)
                .expect("supervisor handle")
                .join()
                .unwrap();

            let staging_root = canonical_root.join(".easl_staging");
            assert!(
                staging_root
                    .join("sourcedata")
                    .join(canonical)
                    .join("01/01/ASL4D/source.nii")
                    .exists()
            );
            assert!(
                !staging_root
                    .join("sourcedata")
                    .join(entry_spelling)
                    .exists()
            );
            assert_eq!(
                state.import_state.lock().unwrap().succeeded_subjects,
                [canonical]
            );

            let outcome = move_import_output_for_state(&state, true, false).unwrap();
            assert_eq!(outcome.subjects[0].subject, canonical);
            assert_eq!(
                fs::read_to_string(canonical_root.join(format!("rawdata/sub-{canonical}/new.nii")))
                    .unwrap(),
                "new"
            );
            assert_eq!(entry.original_subject, entry_spelling);
            assert_eq!(entry.source_path, source.to_string_lossy());
        }
    }

    #[test]
    fn run_import_pipeline_rejects_subject_scope_mismatch_before_mutation_or_spawn() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        fs::write(staging_root.join("sentinel.txt"), "unchanged")
            .expect("staging sentinel should be written");

        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build");
        let state = app.state::<AppState>();
        *state
            .active_project_root
            .lock()
            .expect("active project lock") =
            Some(fs::canonicalize(&project_root).expect("project root should canonicalize"));
        set_import_ownership(&state, &project_root, &["PREVIOUS"], &[], &["PREVIOUS"]);

        let error = run_import_pipeline(
            app.handle().clone(),
            state,
            vec![scoped_entry("EXTRA", "/source/extra/asl")],
            serde_json::json!({}),
            serde_json::json!({}),
            ExecutionProfile::Matlab {
                id: "unused".to_string(),
                label: "Unused".to_string(),
                matlab_path: "unused".to_string(),
                explore_asl_path: "unused".to_string(),
                explore_asl_version: None,
            },
            vec!["SELECTED".to_string()],
            None,
            "request-scope-mismatch".to_string(),
            "unused-plan".to_string(),
        )
        .expect_err("scope mismatch should reject the command");

        match error {
            ImportCommandError::Operational { message } => {
                assert!(message.contains("undeclared staging subjects: EXTRA"));
                assert!(message.contains("declared subjects without staging entries: SELECTED"));
            }
            ImportCommandError::Preflight { .. } => panic!("scope mismatch is an input error"),
        }
        let state = app.state::<AppState>();
        let import_state = state.import_state.lock().expect("import state lock");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
        assert_eq!(import_state.child_pid, None);
        assert_eq!(import_state.subject_list, ["PREVIOUS"]);
        drop(import_state);
        assert_eq!(
            fs::read_to_string(staging_root.join("sentinel.txt"))
                .expect("staging sentinel should remain"),
            "unchanged"
        );
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
        let temp = std::env::temp_dir();
        let mut state = ImportState::new(
            temp.join("project").join(".easl_staging"),
            temp.join("project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);
        state.lifecycle = ImportLifecycle::Running;

        let error = validate_import_not_running(&state)
            .expect_err("active import pid should reject a new import");

        assert_eq!(error, "An import is already running with process PID 42");
    }

    #[test]
    fn mark_import_terminal_if_matches_only_changes_matching_generation_and_pid() {
        let temp = std::env::temp_dir();
        let mut state = ImportState::new(
            temp.join("project").join(".easl_staging"),
            temp.join("project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);
        state.lifecycle = ImportLifecycle::Running;
        state.ownership_generation = 4;

        assert!(!mark_import_terminal_if_matches(&mut state, 3, 42));
        assert_eq!(state.child_pid, Some(42));

        assert!(!mark_import_terminal_if_matches(&mut state, 4, 7));
        assert!(mark_import_terminal_if_matches(&mut state, 4, 42));
        assert_eq!(state.child_pid, None);
        assert_eq!(state.lifecycle, ImportLifecycle::Terminal);
        assert_eq!(state.project_root, temp.join("project"));
        assert_eq!(
            state.staging_root,
            temp.join("project").join(".easl_staging")
        );
        assert_eq!(state.subject_list, vec!["sub-001"]);
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
            import_state.lifecycle = ImportLifecycle::Preparing;
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
            import_state.lifecycle = ImportLifecycle::Running;
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
            import_state.lifecycle = ImportLifecycle::Running;
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
        fs::create_dir_all(project_root.join("rawdata"))
            .expect("project rawdata should be created");
        fs::write(project_root.join("rawdata").join("keep.txt"), "keep")
            .expect("project marker should be written");

        let error = move_import_output_paths(&staging_root, &project_root, &[], false, false)
            .expect_err("mismatched project root should be rejected");

        assert!(format!("{error:#}").contains("project_root must be the parent of staging_root"));
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

        assert!(format!("{error:#}").contains("project_root must be the parent of staging_root"));
        assert!(!import_lock_dir(&staging_root, "BADDIE").exists());

        let _ = fs::remove_dir_all(project_root);
        let _ = fs::remove_dir_all(staging_parent);
    }

    #[test]
    fn clean_import_status_rejects_traversal_subjects() {
        let staging_root = unique_temp_path("clean-traversal").join(".easl_staging");

        let error = clean_import_status_paths(&staging_root, &["../evil".to_string()])
            .expect_err("traversal subject should be rejected");

        assert!(format!("{error:#}").contains("Invalid subject"));
    }

    #[test]
    fn copy_lock_files_rejects_traversal_subjects() {
        let project_root = unique_temp_path("copy-traversal-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");

        let error =
            copy_lock_files_paths(&project_root, &staging_root, &["evil/subject".to_string()])
                .expect_err("separator subject should be rejected");

        assert!(format!("{error:#}").contains("Invalid subject"));

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
            &["..".to_string()],
            false,
            false,
        )
        .expect_err("partial move should reject traversal subjects");

        assert!(format!("{error:#}").contains("Invalid subject"));

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn intentional_termination_suppresses_matlab_exit_error_once() {
        let temp = std::env::temp_dir();
        let mut state = ImportState::new(
            temp.join("project").join(".easl_staging"),
            temp.join("project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);
        mark_import_termination_requested(&mut state, 42);

        assert!(!should_emit_matlab_exit_error(&mut state, 42, false));
        assert!(should_emit_matlab_exit_error(&mut state, 42, false));
    }

    #[test]
    fn stop_outcome_keeps_intent_only_after_successful_signal_and_exit_confirmation() {
        let state = AppState::default();
        {
            let mut import_state = state.import_state.lock().expect("import state");
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(42);
            import_state.ownership_generation = 9;
        }

        let error = stop_import_pid_with(
            &state,
            42,
            |_| Err("signal failed".to_string()),
            |_| unreachable!("force kill must not run after a failed initial signal"),
            |_, _| unreachable!("wait must not run after a failed initial signal"),
        )
        .expect_err("failed signal leaves no termination intent");
        assert_eq!(error, "signal failed");
        let mut import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.termination_requested_for, None);
        assert!(should_emit_matlab_exit_error(&mut import_state, 42, false));
        drop(import_state);

        stop_import_pid_with(&state, 42, |_| Ok(()), |_| Ok(()), |_, _| Ok(true))
            .expect("confirmed stop retains intent for the supervisor exit decision");
        let mut import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.termination_requested_for, Some(42));
        assert!(!should_emit_matlab_exit_error(&mut import_state, 42, false));
    }

    #[test]
    fn stop_timeout_force_kill_failure_and_final_timeout_clear_matching_intent() {
        let run_failed_stop = |force_kill: Box<dyn FnOnce(u32) -> Result<(), String>>,
                               wait_for_exit: Box<
            dyn FnMut(u32, std::time::Duration) -> Result<bool, String>,
        >| {
            let state = AppState::default();
            {
                let mut import_state = state.import_state.lock().expect("import state");
                import_state.lifecycle = ImportLifecycle::Running;
                import_state.child_pid = Some(42);
                import_state.ownership_generation = 9;
            }

            assert!(
                stop_import_pid_with(&state, 42, |_| Ok(()), force_kill, wait_for_exit).is_err()
            );
            let mut import_state = state.import_state.lock().expect("import state");
            assert_eq!(import_state.termination_requested_for, None);
            assert!(should_emit_matlab_exit_error(&mut import_state, 42, false));
        };

        run_failed_stop(
            Box::new(|_| Err("SIGKILL failed".to_string())),
            Box::new(|_, _| Ok(false)),
        );
        run_failed_stop(Box::new(|_| Ok(())), Box::new(|_, _| Ok(false)));
    }

    #[test]
    fn stop_sigterm_timeout_then_successful_force_kill_suppresses_exit_error_once() {
        let state = AppState::default();
        {
            let mut import_state = state.import_state.lock().expect("import state");
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(42);
            import_state.ownership_generation = 9;
        }
        let mut wait_count = 0;

        stop_import_pid_with(
            &state,
            42,
            |_| Ok(()),
            |_| Ok(()),
            |_, _| {
                wait_count += 1;
                Ok(wait_count == 2)
            },
        )
        .expect("force kill confirms the timed-out Stop request");

        let mut import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.termination_requested_for, Some(42));
        assert!(!should_emit_matlab_exit_error(&mut import_state, 42, false));
        assert!(should_emit_matlab_exit_error(&mut import_state, 42, false));
    }

    #[cfg(unix)]
    #[test]
    fn invalid_import_pid_fails_without_signaling_and_retains_ownership() {
        let state = AppState::default();
        {
            let mut import_state = state.import_state.lock().expect("import state");
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(u32::MAX);
            import_state.project_root = PathBuf::from("/project-a");
        }
        let signal_called = Cell::new(false);
        let force_called = Cell::new(false);
        let wait_called = Cell::new(false);

        let error = stop_import_pid_with(
            &state,
            u32::MAX,
            |_| {
                signal_called.set(true);
                Ok(())
            },
            |_| {
                force_called.set(true);
                Ok(())
            },
            |_, _| {
                wait_called.set(true);
                Ok(true)
            },
        )
        .expect_err("invalid PID must fail before process operations");

        assert!(error.contains("exceeds the Unix positive PID range"));
        assert!(!signal_called.get());
        assert!(!force_called.get());
        assert!(!wait_called.get());
        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.child_pid, Some(u32::MAX));
        assert_eq!(import_state.project_root, PathBuf::from("/project-a"));
        assert_eq!(import_state.lifecycle, ImportLifecycle::Running);
    }

    #[test]
    fn failed_stop_never_clears_a_replacement_generation_intent() {
        let state = AppState::default();
        let mut import_state = state.import_state.lock().expect("import state");
        import_state.lifecycle = ImportLifecycle::Running;
        import_state.child_pid = Some(43);
        import_state.ownership_generation = 10;
        import_state.termination_requested_for = Some(43);

        clear_matching_termination_intent(&mut import_state, 9, 42);

        assert_eq!(import_state.termination_requested_for, Some(43));
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
            import_state.lifecycle = ImportLifecycle::Running;
            mark_import_termination_requested(&mut import_state, 42);
        }

        let handle = take_matching_supervisor_handle(&state, 0, 42);
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
        let temp = std::env::temp_dir();
        let mut state = ImportState::new(
            temp.join("project").join(".easl_staging"),
            temp.join("project"),
            vec!["sub-001".to_string()],
        );

        assert!(!should_emit_matlab_exit_error(&mut state, 42, true));
    }

    fn import_lock_dir(root: &std::path::Path, subject: &str) -> PathBuf {
        root.join("derivatives")
            .join("ExploreASL")
            .join("lock")
            .join("xASL_module_Import")
            .join(subject)
            .join("xASL_module_Import")
    }

    fn bids2legacy_lock_dir(root: &std::path::Path, subject_session: &str) -> PathBuf {
        root.join("derivatives")
            .join("ExploreASL")
            .join("lock")
            .join("xASL_module_BIDS2Legacy")
            .join(subject_session)
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

    fn state_with_active_project(project_root: &std::path::Path) -> AppState {
        fs::create_dir_all(project_root).expect("project root should be created");
        let state = AppState::default();
        *state
            .active_project_root
            .lock()
            .expect("active root lock should be available") =
            Some(fs::canonicalize(project_root).expect("project root should canonicalize"));
        state
    }

    fn set_import_ownership(
        state: &AppState,
        project_root: &std::path::Path,
        subject_list: &[&str],
        failed_subjects: &[&str],
        succeeded_subjects: &[&str],
    ) {
        let project_root =
            fs::canonicalize(project_root).expect("project root should canonicalize");
        let mut import_state = ImportState::new(
            project_root.join(".easl_staging"),
            project_root,
            subject_list
                .iter()
                .map(|subject| (*subject).to_string())
                .collect(),
        );
        import_state.failed_subjects = failed_subjects
            .iter()
            .map(|subject| (*subject).to_string())
            .collect();
        import_state.succeeded_subjects = succeeded_subjects
            .iter()
            .map(|subject| (*subject).to_string())
            .collect();
        let plan_id = "test-owned-plan".to_string();
        let mut plan = crate::import_relocation::create_plan(
            &import_state.project_root,
            &import_state.subject_list,
            plan_id.clone(),
        )
        .expect("test relocation plan");
        crate::import_relocation::bind_plan(
            &mut plan,
            &import_state.project_root,
            &import_state.subject_list,
            0,
        )
        .expect("bind test relocation plan");
        import_state.relocation_plan_id = Some(plan_id.clone());
        *state
            .import_state
            .lock()
            .expect("import state lock should be available") = import_state;
        state
            .relocation_plans
            .lock()
            .expect("plan state")
            .insert(plan_id, plan);
    }

    fn set_import_lifecycle(state: &AppState, lifecycle: ImportLifecycle, pid: u32) {
        let mut import_state = state.import_state.lock().expect("import state lock");
        import_state.lifecycle = lifecycle;
        import_state.child_pid = match lifecycle {
            ImportLifecycle::Preparing => Some(RESERVED_IMPORT_PID),
            ImportLifecycle::Running => Some(pid),
            ImportLifecycle::Idle | ImportLifecycle::Terminal => None,
        };
    }

    #[test]
    fn post_processing_commands_reject_without_an_active_project_root() {
        let state = AppState::default();

        assert!(clean_import_status_for_state(&state).is_err());
        assert!(move_import_output_for_state(&state, false, false).is_err());
        assert!(copy_lock_files_for_state(&state, &["GOOD".to_string()]).is_err());
    }

    #[test]
    fn post_processing_commands_reject_without_import_ownership() {
        let workspace = tempdir().expect("workspace should be created");
        let state = state_with_active_project(&workspace.path().join("project"));

        assert!(clean_import_status_for_state(&state).is_err());
        assert!(move_import_output_for_state(&state, false, false).is_err());
        assert!(copy_lock_files_for_state(&state, &["GOOD".to_string()]).is_err());
    }

    #[test]
    fn post_processing_commands_reject_foreign_import_ownership_without_mutation() {
        let workspace = tempdir().expect("workspace should be created");
        let active_project = workspace.path().join("active-project");
        let foreign_project = workspace.path().join("foreign-project");
        let state = state_with_active_project(&active_project);
        fs::create_dir_all(foreign_project.join(".easl_staging")).expect("foreign staging");
        set_import_ownership(&state, &foreign_project, &["GOOD"], &["GOOD"], &["GOOD"]);

        let foreign_staging = foreign_project.join(".easl_staging");
        write_status_files(&foreign_staging, "GOOD");
        fs::create_dir_all(foreign_staging.join("rawdata").join("sub-GOOD"))
            .expect("foreign rawdata");
        fs::write(
            foreign_staging
                .join("rawdata")
                .join("sub-GOOD")
                .join("foreign.dcm"),
            "foreign staging sentinel",
        )
        .expect("foreign staging sentinel");
        fs::create_dir_all(foreign_project.join("rawdata")).expect("foreign project rawdata");
        fs::write(
            foreign_project.join("rawdata").join("sentinel.txt"),
            "foreign project sentinel",
        )
        .expect("foreign project sentinel");
        write_status_files(&foreign_project, "GOOD");

        assert!(clean_import_status_for_state(&state).is_err());
        assert!(move_import_output_for_state(&state, false, false).is_err());
        assert!(copy_lock_files_for_state(&state, &["GOOD".to_string()]).is_err());

        assert_eq!(
            fs::read_to_string(import_lock_dir(&foreign_staging, "GOOD").join("999_ready.status"))
                .expect("foreign lock sentinel should remain"),
            "999_ready.status"
        );
        assert_eq!(
            fs::read_to_string(
                foreign_staging
                    .join("rawdata")
                    .join("sub-GOOD")
                    .join("foreign.dcm"),
            )
            .expect("foreign staging sentinel should remain"),
            "foreign staging sentinel"
        );
        assert_eq!(
            fs::read_to_string(foreign_project.join("rawdata").join("sentinel.txt"))
                .expect("foreign project sentinel should remain"),
            "foreign project sentinel"
        );
    }

    #[test]
    fn post_processing_commands_reject_malformed_owned_staging_root() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        set_import_ownership(&state, &project_root, &["GOOD"], &["GOOD"], &["GOOD"]);
        let sentinel = project_root.join("foreign-staging").join("sentinel.txt");
        fs::create_dir_all(sentinel.parent().expect("sentinel parent")).expect("sentinel parent");
        fs::write(&sentinel, "foreign sentinel").expect("sentinel should be written");
        state
            .import_state
            .lock()
            .expect("import state lock should be available")
            .staging_root = sentinel.parent().expect("sentinel parent").to_path_buf();

        assert!(clean_import_status_for_state(&state).is_err());
        assert!(move_import_output_for_state(&state, false, false).is_err());
        assert!(copy_lock_files_for_state(&state, &["GOOD".to_string()]).is_err());
        assert_eq!(
            fs::read_to_string(sentinel).expect("sentinel should remain"),
            "foreign sentinel"
        );
    }

    #[test]
    fn post_processing_commands_use_owned_native_roots_and_results() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        set_import_ownership(
            &state,
            &project_root,
            &["GOOD", "FAILED"],
            &["FAILED"],
            &["GOOD"],
        );
        write_status_files(&staging_root, "FAILED");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-GOOD"))
            .expect("staged good rawdata");
        fs::write(
            staging_root
                .join("rawdata")
                .join("sub-GOOD")
                .join("image.nii"),
            "owned output",
        )
        .expect("staged output should be written");
        write_status_files(&staging_root, "GOOD");

        clean_import_status_for_state(&state).expect("owned failed status cleanup should succeed");
        assert!(
            !import_lock_dir(&staging_root, "FAILED")
                .join("999_ready.status")
                .exists()
        );

        move_import_output_for_state(&state, false, false)
            .expect("owned output relocation should succeed");
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("rawdata")
                    .join("sub-GOOD")
                    .join("image.nii")
            )
            .expect("owned output should be relocated"),
            "owned output"
        );

        copy_lock_files_for_state(&state, &["GOOD".to_string()])
            .expect("owned retry lock copy should succeed");
        assert!(
            import_lock_dir(&staging_root, "GOOD")
                .join("999_ready.status")
                .exists()
        );
    }

    #[test]
    fn post_processing_rejects_preterminal_imports_even_with_partial_results() {
        for lifecycle in [ImportLifecycle::Preparing, ImportLifecycle::Running] {
            let workspace = tempdir().expect("workspace should be created");
            let project_root = workspace.path().join("project");
            let state = state_with_active_project(&project_root);
            let staging_root = project_root.join(".easl_staging");
            fs::create_dir_all(staging_root.join("rawdata").join("sub-A")).expect("staging output");
            fs::write(
                staging_root
                    .join("rawdata")
                    .join("sub-A")
                    .join("sentinel.txt"),
                "A",
            )
            .expect("staging sentinel");
            write_status_files(&staging_root, "A");
            set_import_ownership(&state, &project_root, &["A", "B"], &["B"], &["A"]);
            set_import_lifecycle(&state, lifecycle, 42);

            assert!(
                clean_import_status_for_state(&state).is_err(),
                "{lifecycle:?}"
            );
            assert!(
                move_import_output_for_state(&state, false, true).is_err(),
                "{lifecycle:?}"
            );
            assert!(
                copy_lock_files_for_state(&state, &["A".to_string()]).is_err(),
                "{lifecycle:?}"
            );
            assert_eq!(
                fs::read_to_string(
                    staging_root
                        .join("rawdata")
                        .join("sub-A")
                        .join("sentinel.txt")
                )
                .expect("preterminal move must preserve staging"),
                "A"
            );
            assert!(
                import_lock_dir(&staging_root, "A")
                    .join("999_ready.status")
                    .exists(),
                "preterminal status cleanup must not mutate"
            );
        }
    }

    #[test]
    fn terminal_transition_allows_post_processing_before_terminal_event_delivery() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-A")).expect("staging output");
        fs::write(
            staging_root.join("rawdata").join("sub-A").join("image.nii"),
            "A",
        )
        .expect("staging output");
        set_import_ownership(&state, &project_root, &["A"], &[], &["A"]);
        {
            let mut import_state = state.import_state.lock().expect("import state");
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(42);
            assert!(mark_import_terminal_if_matches(&mut import_state, 0, 42));
        }

        move_import_output_for_state(&state, false, false)
            .expect("terminal state permits frontend post-processing invoke");
        assert!(
            project_root
                .join("rawdata")
                .join("sub-A")
                .join("image.nii")
                .exists()
        );
    }

    #[test]
    fn successful_terminal_cleanup_resets_full_import_ownership() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-A")).expect("staging output");
        fs::write(
            staging_root.join("rawdata").join("sub-A").join("image.nii"),
            "A",
        )
        .expect("staging output");
        set_import_ownership(&state, &project_root, &["A"], &[], &["A"]);

        move_import_output_for_state(&state, false, true).expect("terminal cleanup should succeed");

        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Idle);
        assert_eq!(import_state.child_pid, None);
        assert_eq!(import_state.ownership_generation, 0);
        assert!(import_state.project_root.as_os_str().is_empty());
        assert!(import_state.staging_root.as_os_str().is_empty());
        assert!(import_state.subject_list.is_empty());
        assert!(import_state.failed_subjects.is_empty());
        assert!(import_state.succeeded_subjects.is_empty());
    }

    #[test]
    fn debug_terminal_relocation_retains_ownership_for_inspection() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-A")).expect("staging output");
        fs::write(
            staging_root.join("rawdata").join("sub-A").join("image.nii"),
            "A",
        )
        .expect("staging output");
        fs::write(staging_root.join("sourcestructure.json"), "source config").unwrap();
        fs::write(staging_root.join("studyPar.json"), "study config").unwrap();
        set_import_ownership(&state, &project_root, &["A"], &[], &["A"]);

        move_import_output_for_state(&state, true, true)
            .expect("debug relocation should preserve ownership");

        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
        assert_eq!(
            import_state.project_root,
            fs::canonicalize(&project_root).unwrap()
        );
        assert_eq!(import_state.succeeded_subjects, ["A"]);
        assert!(staging_root.exists());
        assert_eq!(
            fs::read_to_string(
                project_root.join("derivatives/ExploreASL_GUI/sourcestructure.json")
            )
            .unwrap(),
            "source config"
        );
        assert_eq!(
            fs::read_to_string(project_root.join("derivatives/ExploreASL_GUI/studyPar.json"))
                .unwrap(),
            "study config"
        );
    }

    #[test]
    fn debug_config_copy_failure_is_visible_and_retains_terminal_ownership() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata/sub-A")).expect("staging output");
        fs::write(staging_root.join("rawdata/sub-A/image.nii"), "new").unwrap();
        fs::write(staging_root.join("sourcestructure.json"), "source config").unwrap();
        let blocked_destination =
            project_root.join("derivatives/ExploreASL_GUI/sourcestructure.json");
        fs::create_dir_all(&blocked_destination).unwrap();
        set_import_ownership(&state, &project_root, &["A"], &[], &["A"]);

        let error = move_import_output_for_state(&state, true, true)
            .expect_err("debug config copy failure must be surfaced");

        assert!(format!("{error:#}").contains("Failed to copy import config"));
        assert_eq!(
            fs::read_to_string(project_root.join("rawdata/sub-A/image.nii")).unwrap(),
            "new"
        );
        assert!(staging_root.exists());
        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
        assert_eq!(import_state.succeeded_subjects, ["A"]);
    }

    #[test]
    fn debug_all_failed_run_does_not_copy_configs() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging output");
        fs::write(staging_root.join("sourcestructure.json"), "source config").unwrap();
        fs::write(staging_root.join("studyPar.json"), "study config").unwrap();
        set_import_ownership(&state, &project_root, &["A"], &["A"], &[]);

        let outcome = move_import_output_for_state(&state, true, true)
            .expect("no succeeded subjects should be a nonmutating outcome");

        assert!(outcome.subjects.is_empty());
        assert!(!project_root.join("derivatives/ExploreASL_GUI").exists());
        assert!(staging_root.exists());
        let import_state = state.import_state.lock().expect("import state");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
        assert_eq!(import_state.failed_subjects, ["A"]);
    }

    #[test]
    fn activation_and_relocation_share_transition_exclusion_without_deadlock() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = Arc::new(state_with_active_project(&project_root));
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata/sub-A")).unwrap();
        fs::write(staging_root.join("rawdata/sub-A/new.nii"), "new").unwrap();
        set_import_ownership(&state, &project_root, &["A"], &[], &["A"]);
        let transition = state.project_transition.lock().unwrap();
        let (sender, receiver) = mpsc::channel();
        let start = Arc::new(Barrier::new(3));

        let relocation_state = Arc::clone(&state);
        let relocation_sender = sender.clone();
        let relocation_start = Arc::clone(&start);
        let relocation = std::thread::spawn(move || {
            relocation_start.wait();
            relocation_sender
                .send(
                    move_import_output_for_state(&relocation_state, true, false)
                        .map(|_| ())
                        .map_err(|error| format!("{error:#}")),
                )
                .unwrap();
        });
        let activation_state = Arc::clone(&state);
        let activation_root = project_root.to_string_lossy().to_string();
        let activation_start = Arc::clone(&start);
        let activation = std::thread::spawn(move || {
            activation_start.wait();
            sender
                .send(
                    crate::visualization::set_active_project_impl(
                        activation_root,
                        &activation_state,
                    )
                    .map(|_| ()),
                )
                .unwrap();
        });

        start.wait();
        assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
        drop(transition);
        receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        relocation.join().unwrap();
        activation.join().unwrap();
        assert_eq!(
            fs::read_to_string(project_root.join("rawdata/sub-A/new.nii")).unwrap(),
            "new"
        );
    }

    #[test]
    fn terminal_ownership_is_replaced_and_late_generation_cannot_mutate_new_import() {
        let state = AppState::default();
        let root = unique_temp_path("generation-replacement");
        let staging_root = root.join(".easl_staging");
        let first_generation = reserve_import_state(
            &state,
            staging_root.clone(),
            root.clone(),
            "request-first".to_string(),
            vec!["A".to_string()],
        )
        .expect("first reservation");
        {
            let mut import_state = state.import_state.lock().expect("import state");
            import_state.lifecycle = ImportLifecycle::Running;
            import_state.child_pid = Some(41);
            assert!(mark_import_terminal_if_matches(
                &mut import_state,
                first_generation,
                41
            ));
        }
        let second_generation = reserve_import_state(
            &state,
            staging_root,
            root,
            "request-second".to_string(),
            vec!["B".to_string()],
        )
        .expect("terminal ownership permits replacement");
        assert!(second_generation > first_generation);

        let mut import_state = state.import_state.lock().expect("import state");
        import_state.lifecycle = ImportLifecycle::Running;
        import_state.child_pid = Some(42);
        assert!(!mark_import_terminal_if_matches(
            &mut import_state,
            first_generation,
            41
        ));
        assert_eq!(import_state.ownership_generation, second_generation);
        assert_eq!(import_state.lifecycle, ImportLifecycle::Running);
        assert_eq!(import_state.child_pid, Some(42));
        assert_eq!(import_state.subject_list, ["B"]);
    }

    #[test]
    fn retry_preserve_authorization_rejects_unowned_failed_and_traversal_subjects_before_mutation()
    {
        let workspace = tempdir().expect("workspace");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging");
        fs::write(staging_root.join("sentinel.txt"), "unchanged").expect("sentinel");
        set_import_ownership(
            &state,
            &project_root,
            &["GOOD", "FAILED"],
            &["FAILED"],
            &["GOOD"],
        );

        for subjects in [
            vec!["UNKNOWN".to_string()],
            vec!["FAILED".to_string()],
            vec!["../escape".to_string()],
        ] {
            assert!(
                reserve_import_state_for_run(
                    &state,
                    staging_root.clone(),
                    fs::canonicalize(&project_root).expect("project"),
                    "retry".to_string(),
                    vec!["FAILED".to_string()],
                    Some(subjects),
                    "test-plan".to_string(),
                )
                .is_err()
            );
            let import_state = state.import_state.lock().expect("import state");
            assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
            assert_eq!(import_state.succeeded_subjects, ["GOOD"]);
            drop(import_state);
            assert_eq!(
                fs::read_to_string(staging_root.join("sentinel.txt")).expect("sentinel"),
                "unchanged"
            );
        }
    }

    #[test]
    fn retry_preserve_authorization_rejects_exact_and_portable_run_subject_overlap_before_replacement()
     {
        let workspace = tempdir().expect("workspace");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging");
        fs::write(staging_root.join("sentinel.txt"), "unchanged").expect("sentinel");
        set_import_ownership(&state, &project_root, &["GOOD", "FAILED"], &[], &["GOOD"]);

        for (run_subject, preserved_subject) in [("GOOD", "GOOD"), ("good", "GOOD")] {
            let error = reserve_import_state_for_run(
                &state,
                staging_root.clone(),
                fs::canonicalize(&project_root).expect("project"),
                "retry".to_string(),
                vec![run_subject.to_string()],
                Some(vec![preserved_subject.to_string()]),
                "test-plan".to_string(),
            )
            .expect_err("a preserved subject cannot be selected for rerun");
            assert_eq!(
                format!("{error:#}"),
                "Retry preserve subjects overlap subjects selected for import"
            );
            let import_state = state.import_state.lock().expect("import state");
            assert_eq!(import_state.lifecycle, ImportLifecycle::Terminal);
            assert_eq!(import_state.subject_list, ["GOOD", "FAILED"]);
            assert_eq!(import_state.succeeded_subjects, ["GOOD"]);
            drop(import_state);
            assert_eq!(
                fs::read_to_string(staging_root.join("sentinel.txt")).expect("sentinel"),
                "unchanged"
            );
        }
    }

    #[test]
    fn retry_preserve_authorization_rejects_foreign_and_nonterminal_ownership_before_replacement() {
        let workspace = tempdir().expect("workspace");
        let active_project = workspace.path().join("active-project");
        let foreign_project = workspace.path().join("foreign-project");
        let state = state_with_active_project(&active_project);
        let active_staging = active_project.join(".easl_staging");
        let foreign_staging = foreign_project.join(".easl_staging");
        fs::create_dir_all(&foreign_staging).expect("foreign staging");
        fs::write(foreign_staging.join("sentinel.txt"), "foreign").expect("sentinel");
        set_import_ownership(&state, &foreign_project, &["GOOD"], &[], &["GOOD"]);

        assert!(
            reserve_import_state_for_run(
                &state,
                active_staging.clone(),
                fs::canonicalize(&active_project).expect("active project"),
                "retry".to_string(),
                vec!["GOOD".to_string()],
                Some(vec!["GOOD".to_string()]),
                "test-plan".to_string(),
            )
            .is_err()
        );
        assert_eq!(
            fs::read_to_string(foreign_staging.join("sentinel.txt")).expect("sentinel"),
            "foreign"
        );
        assert_eq!(
            state
                .import_state
                .lock()
                .expect("import state")
                .project_root,
            fs::canonicalize(&foreign_project).expect("foreign project")
        );

        set_import_ownership(&state, &active_project, &["GOOD"], &[], &["GOOD"]);
        set_import_lifecycle(&state, ImportLifecycle::Running, 42);
        assert!(
            reserve_import_state_for_run(
                &state,
                active_staging,
                fs::canonicalize(&active_project).expect("active project"),
                "retry".to_string(),
                vec!["GOOD".to_string()],
                Some(vec!["GOOD".to_string()]),
                "test-plan".to_string(),
            )
            .is_err()
        );
        assert_eq!(
            state.import_state.lock().expect("import state").lifecycle,
            ImportLifecycle::Running
        );
    }

    #[test]
    fn disjoint_partial_success_retry_copies_only_authorized_native_success_locks_after_recreation()
    {
        let workspace = tempdir().expect("workspace");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging");
        fs::write(staging_root.join("old.txt"), "old staging").expect("sentinel");
        write_status_files(&project_root, "GOOD");
        set_import_ownership(
            &state,
            &project_root,
            &["GOOD", "FAILED"],
            &["FAILED"],
            &["GOOD"],
        );

        let reservation = reserve_import_state_for_run(
            &state,
            staging_root.clone(),
            fs::canonicalize(&project_root).expect("project"),
            "retry".to_string(),
            vec!["FAILED".to_string()],
            Some(vec!["GOOD".to_string()]),
            "test-plan".to_string(),
        )
        .expect("terminal native success authorizes preservation");

        cleanup_staging_root(&staging_root).expect("recreate staging");
        copy_lock_files_paths(
            &project_root,
            &staging_root,
            &reservation.preserved_subjects,
        )
        .expect("copy only authorized locks");
        assert!(
            import_lock_dir(&staging_root, "GOOD")
                .join("999_ready.status")
                .exists()
        );
        assert!(!import_lock_dir(&staging_root, "FAILED").exists());
        let import_state = state.import_state.lock().expect("new ownership");
        assert_eq!(import_state.lifecycle, ImportLifecycle::Preparing);
        assert_eq!(import_state.subject_list, ["FAILED"]);
        assert!(import_state.succeeded_subjects.is_empty());
    }

    #[test]
    fn post_processing_commands_reject_traversal_and_non_owned_subjects() {
        let workspace = tempdir().expect("workspace should be created");
        let project_root = workspace.path().join("project");
        let state = state_with_active_project(&project_root);
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        fs::write(staging_root.join("sentinel.txt"), "owned sentinel")
            .expect("staging sentinel should be written");

        set_import_ownership(&state, &project_root, &["GOOD"], &["../FOREIGN"], &[]);
        assert!(clean_import_status_for_state(&state).is_err());

        set_import_ownership(&state, &project_root, &["GOOD"], &[], &["../FOREIGN"]);
        assert!(move_import_output_for_state(&state, false, false).is_err());

        set_import_ownership(&state, &project_root, &["GOOD"], &[], &["GOOD"]);
        assert!(copy_lock_files_for_state(&state, &["../FOREIGN".to_string()]).is_err());
        assert!(copy_lock_files_for_state(&state, &["OTHER".to_string()]).is_err());
        assert_eq!(
            fs::read_to_string(staging_root.join("sentinel.txt"))
                .expect("staging sentinel should remain"),
            "owned sentinel"
        );
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
    fn move_import_output_full_success_merges_subject_output_and_preserves_processing_derivatives()
    {
        let project_root = unique_temp_path("move-full-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(project_root.join("rawdata").join("sub-OTHER"))
            .expect("other subject rawdata should exist");
        fs::write(
            project_root
                .join("rawdata")
                .join("sub-OTHER")
                .join("keep.nii"),
            "keep",
        )
        .expect("other subject rawdata file should be written");
        fs::create_dir_all(
            project_root
                .join("derivatives")
                .join("ExploreASL")
                .join("Population")
                .join("Stats"),
        )
        .expect("processing stats should exist");
        fs::write(
            project_root
                .join("derivatives")
                .join("ExploreASL")
                .join("Population")
                .join("Stats")
                .join("CBF.tsv"),
            "cbf",
        )
        .expect("processing stats file should be written");
        fs::create_dir_all(bids2legacy_lock_dir(&project_root, "sub-BADDIE_01"))
            .expect("BIDS2Legacy lock for imported subject session should exist");
        fs::create_dir_all(bids2legacy_lock_dir(&project_root, "sub-BADDIE_02"))
            .expect("BIDS2Legacy lock for second imported subject session should exist");
        fs::create_dir_all(bids2legacy_lock_dir(&project_root, "sub-OTHER_01"))
            .expect("BIDS2Legacy lock for other subject should exist");
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

        move_import_output_paths(
            &staging_root,
            &project_root,
            &["BADDIE".to_string()],
            false,
            true,
        )
        .expect("full move should succeed");

        assert!(
            project_root
                .join("rawdata")
                .join("sub-BADDIE")
                .join("asl.nii")
                .exists()
        );
        assert!(
            import_lock_dir(&project_root, "BADDIE")
                .join("010_DCM2NII.status")
                .exists()
        );
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("rawdata")
                    .join("sub-OTHER")
                    .join("keep.nii")
            )
            .expect("other subject rawdata should remain"),
            "keep"
        );
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("derivatives")
                    .join("ExploreASL")
                    .join("Population")
                    .join("Stats")
                    .join("CBF.tsv")
            )
            .expect("processing stats should remain"),
            "cbf"
        );
        assert!(!bids2legacy_lock_dir(&project_root, "sub-BADDIE_01").exists());
        assert!(!bids2legacy_lock_dir(&project_root, "sub-BADDIE_02").exists());
        assert!(bids2legacy_lock_dir(&project_root, "sub-OTHER_01").exists());
        assert!(!staging_root.exists());

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_full_success_debug_preserves_staging_and_copies_configs() {
        let project_root = unique_temp_path("move-full-debug-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-BADDIE"))
            .expect("staging rawdata should exist");
        fs::write(
            staging_root
                .join("rawdata")
                .join("sub-BADDIE")
                .join("asl.nii"),
            "asl",
        )
        .expect("staged rawdata");
        fs::create_dir_all(staging_root.join("derivatives"))
            .expect("staging derivatives should exist");
        fs::write(
            staging_root.join("sourcestructure.json"),
            "{\"source\":true}",
        )
        .expect("sourcestructure should be written");
        fs::write(staging_root.join("studyPar.json"), "{\"study\":true}")
            .expect("studyPar should be written");

        move_import_output_paths(
            &staging_root,
            &project_root,
            &["BADDIE".to_string()],
            true,
            true,
        )
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
            &["BADDIE".to_string()],
            false,
            false,
        )
        .expect("partial move should succeed");

        assert!(staging_root.exists());
        assert!(
            project_root
                .join("rawdata")
                .join("sub-BADDIE")
                .join("asl.nii")
                .exists()
        );
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
        assert!(
            import_lock_dir(&project_root, "BADDIE")
                .join("999_ready.status")
                .exists()
        );
        assert!(!import_lock_dir(&project_root, "FAILED").exists());
        assert!(
            project_root
                .join("derivatives")
                .join("ExploreASL")
                .join("log")
                .join("import_sub-BADDIE.log")
                .exists()
        );
        assert!(
            !project_root
                .join("derivatives")
                .join("ExploreASL")
                .join("log")
                .join("import_sub-FAILED.log")
                .exists()
        );

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_rejects_destructive_delete_outside_easl_staging_leaf() {
        let project_root = unique_temp_path("move-safety-project");
        let unsafe_staging_root = project_root.join("not-staging");

        let error = move_import_output_paths(
            &unsafe_staging_root,
            &project_root,
            &["BADDIE".to_string()],
            false,
            false,
        )
        .expect_err("non .easl_staging roots should be rejected");

        assert!(format!("{error:#}").contains("staging_root must end with .easl_staging"));
        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn matlab_exit_error_serializes_exit_code() {
        let value = serde_json::to_value(MatlabExitError {
            exit_code: 42,
            run_request_id: "request-42".to_string(),
            ownership_generation: 7,
        })
        .expect("MatlabExitError should serialize");

        assert_eq!(
            value,
            serde_json::json!({
                "exitCode": 42,
                "runRequestId": "request-42",
                "ownershipGeneration": 7,
            })
        );
    }

    #[test]
    fn import_event_payloads_serialize_request_and_ownership_correlation() {
        let readiness = serde_json::to_value(ImportPrepareComplete {
            run_request_id: "request-42".to_string(),
            ownership_generation: 7,
        })
        .expect("readiness should serialize");
        let raw = serde_json::to_value(ImportRawEventPayload {
            line: "MATLAB output".to_string(),
            run_request_id: "request-42".to_string(),
            ownership_generation: 7,
        })
        .expect("raw event should serialize");
        let structured = serde_json::to_value(ImportStructuredEventPayload {
            event: ImportStructuredEvent::SubjectStart {
                subject: "GOOD".to_string(),
                step: "DCM2NII".to_string(),
            },
            run_request_id: "request-42".to_string(),
            ownership_generation: 7,
        })
        .expect("structured event should serialize");

        for payload in [readiness, raw, structured] {
            assert_eq!(payload["runRequestId"], "request-42");
            assert_eq!(payload["ownershipGeneration"], 7);
        }
    }

    #[test]
    fn apptainer_import_args_bind_staging_root_to_data() {
        let args = build_apptainer_import_args(
            PathBuf::from("/data/project/.easl_staging").as_path(),
            PathBuf::from("/images/exploreasl.sif").as_path(),
        );

        assert_eq!(
            args,
            vec![
                "exec",
                "--cleanenv",
                "--writable-tmpfs",
                "--bind",
                "/data/project/.easl_staging:/data",
                "/images/exploreasl.sif",
                "/bin/bash",
                "/opt/xasl/xASL_latest/run_xASL_latest.sh",
                "/opt/mcr/v97/",
                "/data",
                "[1,1,0]",
                "0",
            ]
        );
    }
}
