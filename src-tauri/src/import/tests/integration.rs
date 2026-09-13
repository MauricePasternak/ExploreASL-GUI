#[cfg(test)]
mod tests {
    use crate::import::validation::validate_non_empty_inputs;
    use crate::import::{
        ImportCommandError, ImportLifecycle, ImportRunSnapshot, ImportState, ImportSubjectOutcome,
        ImportSubjectOutcomeKind, ImportTerminalResult, StagingEntry, cleanup_staging_root,
        rollback_preparation_failure, validate_staging_root, validate_subject_components,
        validate_subject_scope,
    };
    use std::path::PathBuf;

    #[test]
    fn lifecycle_transition_table_rejects_illegal_and_terminal_mutations() {
        let legal = [
            (ImportLifecycle::Preparing, ImportLifecycle::Running),
            (ImportLifecycle::Preparing, ImportLifecycle::Failed),
            (ImportLifecycle::Preparing, ImportLifecycle::Cancelling),
            (ImportLifecycle::Preparing, ImportLifecycle::Interrupted),
            (ImportLifecycle::Running, ImportLifecycle::Finalizing),
            (ImportLifecycle::Running, ImportLifecycle::Cancelling),
            (ImportLifecycle::Running, ImportLifecycle::Interrupted),
            (ImportLifecycle::Finalizing, ImportLifecycle::Completed),
            (ImportLifecycle::Finalizing, ImportLifecycle::Failed),
            (ImportLifecycle::Finalizing, ImportLifecycle::Cancelled),
            (ImportLifecycle::Cancelling, ImportLifecycle::Running),
            (ImportLifecycle::Cancelling, ImportLifecycle::Cancelled),
            (ImportLifecycle::Cancelling, ImportLifecycle::Failed),
        ];
        let states = [
            ImportLifecycle::Idle,
            ImportLifecycle::Preparing,
            ImportLifecycle::Running,
            ImportLifecycle::Finalizing,
            ImportLifecycle::Completed,
            ImportLifecycle::Failed,
            ImportLifecycle::Cancelling,
            ImportLifecycle::Cancelled,
            ImportLifecycle::Interrupted,
        ];
        for from in states {
            for to in states {
                assert_eq!(
                    from.can_transition_to(to),
                    legal.contains(&(from, to)),
                    "{from:?} -> {to:?}"
                );
            }
        }
        for terminal in [
            ImportLifecycle::Completed,
            ImportLifecycle::Failed,
            ImportLifecycle::Cancelled,
            ImportLifecycle::Interrupted,
        ] {
            assert!(!terminal.can_transition_to(ImportLifecycle::Preparing));
            assert!(terminal.is_terminal());
        }
        assert!(!ImportLifecycle::Running.can_transition_to(ImportLifecycle::Completed));
        assert!(!ImportLifecycle::Preparing.can_transition_to(ImportLifecycle::Finalizing));
    }

    #[test]
    fn snapshots_are_camel_case_and_do_not_leak_roots_or_pids() {
        let mut state = ImportState::new(
            PathBuf::from("/secret/.easl_staging"),
            PathBuf::from("/secret"),
            vec!["ONE".to_string()],
        );
        state.run_id = "import-run-1".to_string();
        state.profile_id = "profile-1".to_string();
        state.ownership_generation = 3;
        state.lifecycle = ImportLifecycle::Completed;
        state.terminal_result = Some(ImportTerminalResult::Completed);
        state.exit_evidence = Some(crate::import::ImportExitEvidence {
            exit_code: 0,
            successful: true,
        });
        state.error = Some(crate::import::ImportStructuredError {
            code: "verification".to_string(),
            message: "diagnostic only".to_string(),
            subject: Some("ONE".to_string()),
            staging_issues: None,
        });
        state.subject_outcomes = vec![ImportSubjectOutcome {
            subject: "ONE".to_string(),
            outcome: ImportSubjectOutcomeKind::Committed,
            ready_lock_verified: true,
            rawdata_verified: true,
            committed: true,
            error: None,
        }];
        let value = serde_json::to_value(state.snapshot()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "runId": "import-run-1", "lifecycle": "completed", "ownershipGeneration": 3,
                "profileId": "profile-1", "selectedSubjects": ["ONE"],
                "createdAtMs": state.created_at_ms, "updatedAtMs": state.updated_at_ms,
                "exitEvidence": { "exitCode": 0, "successful": true },
                "subjectOutcomes": [{ "subject": "ONE", "outcome": "committed", "readyLockVerified": true, "rawdataVerified": true, "committed": true }],
                "error": { "code": "verification", "message": "diagnostic only", "subject": "ONE" },
                "terminalResult": "completed", "confirmationRequired": false
            })
        );
        let json = value.to_string();
        for private in [
            "/secret",
            "projectRoot",
            "stagingRoot",
            "childPid",
            "pid",
            "supervisorHandle",
        ] {
            assert!(
                !json.contains(private),
                "private snapshot field leaked: {private}"
            );
        }
    }

    #[test]
    fn snapshot_terminal_result_matches_lifecycle() {
        let snapshot = ImportRunSnapshot {
            run_id: "import-run-1".to_string(),
            lifecycle: ImportLifecycle::Interrupted,
            ownership_generation: 1,
            profile_id: "profile".to_string(),
            selected_subjects: vec!["ONE".to_string()],
            created_at_ms: 1,
            updated_at_ms: 2,
            exit_evidence: None,
            subject_outcomes: vec![],
            relocation_outcome: None,
            error: None,
            terminal_result: Some(ImportTerminalResult::Interrupted),
            confirmation_required: true,
        };
        assert_eq!(
            snapshot.terminal_result,
            Some(ImportTerminalResult::Interrupted)
        );
    }

    #[test]
    fn staging_cleanup_validation_and_rollback_preserve_prior_safety_contracts() {
        let temp = tempfile::tempdir().unwrap();
        let staging = temp.path().join(".easl_staging");
        std::fs::create_dir_all(staging.join("sourcedata/sub-001")).unwrap();
        std::fs::write(staging.join("sourcedata/sub-001/marker"), "partial").unwrap();
        assert_eq!(
            rollback_preparation_failure(&staging, "config write failed".to_string()),
            "config write failed"
        );
        assert!(!staging.exists());

        std::fs::create_dir_all(staging.join("sourcedata")).unwrap();
        cleanup_staging_root(&staging).unwrap();
        assert!(!staging.exists());
        validate_staging_root(&staging).unwrap();
        assert!(validate_staging_root(&temp.path().join("rawdata")).is_err());
    }

    fn scoped_entry(subject: &str, source_path: &str) -> StagingEntry {
        StagingEntry {
            subject: subject.to_string(),
            session: "01".to_string(),
            run: "01".to_string(),
            run_alias: "ASL1".to_string(),
            modality: "ASL4D".to_string(),
            original_subject: subject.to_string(),
            original_session: "01".to_string(),
            original_run: "01".to_string(),
            source_path: source_path.to_string(),
        }
    }

    #[test]
    fn request_scope_and_nonempty_validation_preserve_portable_subject_contracts() {
        let entries = vec![
            scoped_entry("subjecta", "/source/a/asl"),
            scoped_entry("Straße", "/source/strasse/asl"),
        ];
        validate_subject_scope(&entries, &["SUBJECTA".to_string(), "STRASSE".to_string()]).unwrap();
        assert!(validate_non_empty_inputs(&[], &["A".to_string()]).is_err());
        assert!(validate_non_empty_inputs(&entries, &[]).is_err());
        assert!(
            validate_subject_scope(
                &[scoped_entry("EXTRA", "/source/extra")],
                &["MISSING".to_string()]
            )
            .is_err()
        );
    }

    #[test]
    fn wire_and_path_validation_preserve_prior_command_contracts() {
        let entry: StagingEntry = serde_json::from_value(serde_json::json!({
            "subject": "sub-001", "session": "01", "run": "01", "runAlias": "ASL1",
            "modality": "ASL4D", "originalSubject": "sub-001", "originalSession": "01",
            "originalRun": "01", "sourcePath": "/dicom/sub-001/asl"
        }))
        .unwrap();
        assert_eq!(entry.original_subject, "sub-001");
        assert_eq!(entry.run_alias, "ASL1");
        assert_eq!(entry.source_path, "/dicom/sub-001/asl");

        assert_eq!(
            serde_json::to_value(ImportCommandError::Preflight { issues: vec![] }).unwrap(),
            serde_json::json!({ "kind": "preflight", "issues": [] })
        );
        assert!(validate_subject_components(&["../escape".to_string()]).is_err());
        assert!(validate_subject_components(&["A/B".to_string()]).is_err());
        validate_subject_components(&["sub-001".to_string()]).unwrap();
    }
}
