#[cfg(test)]
mod tests {
    use crate::processing::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("exploreasl-gui-proc-{name}-{suffix}"))
    }

    // -------------------------------------------------------------------------
    // module_index_to_name
    // -------------------------------------------------------------------------

    #[test]
    fn module_index_to_name_maps_0_to_structural() {
        assert_eq!(module_index_to_name(0), "xASL_module_Structural");
    }

    #[test]
    fn module_index_to_name_maps_1_to_asl() {
        assert_eq!(module_index_to_name(1), "xASL_module_ASL");
    }

    #[test]
    fn module_index_to_name_maps_2_to_population() {
        assert_eq!(module_index_to_name(2), "xASL_module_Population");
    }

    #[test]
    #[should_panic(expected = "Invalid module index")]
    fn module_index_to_name_panics_on_invalid_index() {
        module_index_to_name(3);
    }

    // -------------------------------------------------------------------------
    // is_mutex_related_line / check_log_for_error
    // -------------------------------------------------------------------------

    #[test]
    fn is_mutex_related_line_detects_mutex_message() {
        assert!(is_mutex_related_line(
            "ERROR: mutex is locked for subject sub-001"
        ));
        assert!(is_mutex_related_line("  mutex is locked"));
        assert!(is_mutex_related_line("Mutex is locked"));
    }

    #[test]
    fn is_mutex_related_line_rejects_normal_errors() {
        assert!(!is_mutex_related_line("ERROR: file not found"));
        assert!(!is_mutex_related_line("Error processing subject"));
        assert!(!is_mutex_related_line("some normal log line"));
    }

    #[test]
    fn check_log_for_error_returns_false_for_mutex_only_errors() {
        let dir = unique_temp_path("mutex-only");
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("test.log");
        fs::write(
            &log,
            "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: retrying\n",
        )
        .unwrap();
        assert!(!check_log_for_error(&log));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn check_log_for_error_returns_true_for_real_errors() {
        let dir = unique_temp_path("real-error");
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("test.log");
        fs::write(
            &log,
            "INFO: starting\nERROR: file not found /data/sub-001.nii\n",
        )
        .unwrap();
        assert!(check_log_for_error(&log));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn check_log_for_error_returns_true_when_mixed_mutex_and_real_errors() {
        let dir = unique_temp_path("mixed-errors");
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("test.log");
        fs::write(&log, "ERROR: mutex is locked\nERROR: file not found\n").unwrap();
        assert!(check_log_for_error(&log));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn check_log_for_error_returns_false_for_empty_log() {
        let dir = unique_temp_path("empty-log");
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("test.log");
        fs::write(&log, "").unwrap();
        assert!(!check_log_for_error(&log));
        let _ = fs::remove_dir_all(dir);
    }

    // -------------------------------------------------------------------------
    // Error determination: 999_ready.status + mutex interaction
    // -------------------------------------------------------------------------

    #[test]
    fn error_detection_ready_status_no_mutex_not_errored() {
        let dir = unique_temp_path("ready-no-mutex");
        let lock_dir = dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(lock_dir.join("999_ready.status"), "").unwrap();

        let log = dir.join("log");
        fs::write(&log, "INFO: starting\nINFO: completed successfully\n").unwrap();

        let (status, _, _) = determine_status(&lock_dir);
        let has_error = check_log_for_error(&log);
        assert_eq!(status, "complete");
        assert!(!has_error);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn error_detection_ready_status_with_mutex_not_errored() {
        let dir = unique_temp_path("ready-mutex");
        let lock_dir = dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(lock_dir.join("999_ready.status"), "").unwrap();

        let log = dir.join("log");
        fs::write(
            &log,
            "INFO: starting\nERROR: mutex is locked for subject sub-001\nINFO: completed\n",
        )
        .unwrap();

        let (status, _, _) = determine_status(&lock_dir);
        let has_error = check_log_for_error(&log);
        assert_eq!(status, "complete");
        assert!(!has_error);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn error_detection_no_ready_status_with_mutex_is_errored() {
        let dir = unique_temp_path("no-ready-mutex");
        let lock_dir = dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

        let log = dir.join("log");
        fs::write(
            &log,
            "INFO: starting\nERROR: mutex is locked for subject sub-001\n",
        )
        .unwrap();

        let (status, _, _) = determine_status(&lock_dir);
        let has_error = check_log_for_error(&log);
        assert_eq!(status, "incomplete");
        assert!(!has_error);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn error_detection_no_ready_status_no_mutex_is_errored() {
        let dir = unique_temp_path("no-ready-no-mutex");
        let lock_dir = dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();
        fs::write(lock_dir.join("060_Segment_T1w.status"), "").unwrap();

        let log = dir.join("log");
        fs::write(&log, "INFO: starting\nINFO: processing...\n").unwrap();

        let (status, _, _) = determine_status(&lock_dir);
        let has_error = check_log_for_error(&log);
        assert_eq!(status, "incomplete");
        assert!(!has_error);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn error_detection_never_run_not_errored() {
        let dir = unique_temp_path("never-run");
        let lock_dir = dir.join("lock");
        fs::create_dir_all(&lock_dir).unwrap();

        let (status, steps, _) = determine_status(&lock_dir);
        assert_eq!(status, "pending");
        assert!(steps.is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    // -------------------------------------------------------------------------
    // list_subjects
    // -------------------------------------------------------------------------

    #[test]
    fn list_subjects_bids_direct_scans_project_root() {
        let root = unique_temp_path("list-bids-root");
        let perf = root.join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), Some("bids".to_string()))
            .expect("list_subjects should succeed for BIDS-direct");

        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].subject_session, "sub-01_1");
        assert_eq!(subjects[0].session, "1");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_returns_empty_when_rawdata_missing() {
        let root = unique_temp_path("no-rawdata");
        fs::create_dir_all(&root).expect("test root should be created");

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert!(subjects.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_returns_subjects_with_sessions() {
        let root = unique_temp_path("list-subjects");
        let rawdata = root.join("rawdata");
        fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("anat")).unwrap();
        fs::write(
            rawdata
                .join("sub-001")
                .join("ses-01")
                .join("anat")
                .join("sub-001_ses-01_T1w.nii.gz"),
            b"fake",
        )
        .unwrap();
        fs::create_dir_all(rawdata.join("sub-001").join("ses-01").join("perf")).unwrap();
        fs::write(
            rawdata
                .join("sub-001")
                .join("ses-01")
                .join("perf")
                .join("sub-001_ses-01_asl.nii.gz"),
            b"fake",
        )
        .unwrap();
        fs::create_dir_all(rawdata.join("sub-002").join("ses-02")).unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert_eq!(subjects.len(), 2);

        let sub001 = subjects.iter().find(|s| s.subject == "001").unwrap();
        assert_eq!(sub001.session, "01");
        assert_eq!(sub001.subject_session, "sub-001_01");
        assert!(sub001.has_structural);
        assert!(sub001.has_asl);

        let sub002 = subjects.iter().find(|s| s.subject == "002").unwrap();
        assert_eq!(sub002.session, "02");
        assert!(!sub002.has_structural);
        assert!(!sub002.has_asl);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_skips_non_sub_directories() {
        let root = unique_temp_path("list-skip");
        let rawdata = root.join("rawdata");
        fs::create_dir_all(rawdata.join("sub-001").join("ses-01")).unwrap();
        fs::create_dir_all(rawdata.join("README")).unwrap();
        fs::create_dir_all(rawdata.join("dataset")).unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].subject, "001");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_cross_sectional_defaults_session_to_1() {
        let root = unique_temp_path("cross-sectional");
        let rawdata = root.join("rawdata");
        // sub-01/perf/sub-01_asl.nii.gz — no ses-* dir (ds000240 layout)
        let perf = rawdata.join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert_eq!(subjects.len(), 1);
        let sub01 = &subjects[0];
        assert_eq!(sub01.subject, "01");
        assert_eq!(sub01.session, "1"); // cross-sectional default
        assert_eq!(sub01.subject_session, "sub-01_1");
        assert!(sub01.has_asl);
        assert_eq!(sub01.asl_runs, vec!["1"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_parses_run_entities_from_filenames() {
        let root = unique_temp_path("run-entities");
        let rawdata = root.join("rawdata");
        let perf = rawdata.join("sub-01").join("ses-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        // Two ASL files with explicit non-sequential run labels
        fs::write(perf.join("sub-01_ses-01_run-2_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_ses-01_run-2_asl.json"), b"{}").unwrap();
        fs::write(perf.join("sub-01_ses-01_run-5_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_ses-01_run-5_asl.json"), b"{}").unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert_eq!(subjects.len(), 1);
        // Run labels parsed from filenames, sorted ascending
        assert_eq!(subjects[0].asl_runs, vec!["2", "5"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_subjects_asl_run_default_when_no_run_entity() {
        let root = unique_temp_path("default-run");
        let rawdata = root.join("rawdata");
        let perf = rawdata.join("sub-01").join("ses-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        // Single ASL file with no run- entity → default "1"
        fs::write(perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

        let subjects = list_subjects(root.to_string_lossy().to_string(), None)
            .expect("list_subjects should succeed");

        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].asl_runs, vec!["1"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_subject_info_serialization_casing() {
        let info = SubjectInfo {
            subject_session: "sub-001_01".to_string(),
            subject: "001".to_string(),
            session: "01".to_string(),
            has_structural: true,
            has_asl: true,
            asl_runs: vec!["1".to_string(), "2".to_string()],
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""hasASL":true"#));
        assert!(!json.contains(r#""hasAsl""#));
        assert!(json.contains(r#""subjectSession":"sub-001_01""#));
        assert!(json.contains(r#""aslRuns":["1","2"]"#));
    }

    // -------------------------------------------------------------------------
    // determine_status
    // -------------------------------------------------------------------------

    #[test]
    fn determine_status_returns_pending_when_no_status_files() {
        let dir = unique_temp_path("det-pending");
        fs::create_dir_all(&dir).unwrap();

        let (status, steps, locked) = determine_status(&dir);
        assert_eq!(status, "pending");
        assert!(steps.is_empty());
        assert!(!locked);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determine_status_returns_complete_when_ready_file_exists() {
        let dir = unique_temp_path("det-complete");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(dir.join("999_ready.status"), "").unwrap();

        let (status, steps, locked) = determine_status(&dir);
        assert_eq!(status, "complete");
        assert!(steps.contains(&"060_Segment_T1w".to_string()));
        assert!(!locked);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determine_status_returns_incomplete_when_status_files_without_ready() {
        let dir = unique_temp_path("det-incomplete");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(dir.join("070_SkullStrip_T1w.status"), "").unwrap();

        let (status, steps, locked) = determine_status(&dir);
        assert_eq!(status, "incomplete");
        assert_eq!(steps.len(), 2);
        assert!(!locked);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determine_status_detects_locked_directory() {
        let dir = unique_temp_path("det-locked");
        fs::create_dir_all(dir.join("locked")).unwrap();
        fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();

        let (status, steps, locked) = determine_status(&dir);
        assert_eq!(status, "incomplete");
        assert!(locked);
        assert!(steps.contains(&"060_Segment_T1w".to_string()));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determine_status_complete_overrides_locked() {
        let dir = unique_temp_path("det-complete-locked");
        fs::create_dir_all(dir.join("locked")).unwrap();
        fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(dir.join("999_ready.status"), "").unwrap();

        let (status, steps, locked) = determine_status(&dir);
        assert_eq!(status, "complete");
        assert!(!locked);
        assert!(steps.contains(&"060_Segment_T1w".to_string()));
        assert!(!steps.contains(&"999_ready".to_string()));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determine_status_returns_steps_in_sorted_order() {
        let dir = unique_temp_path("det-sorted");
        fs::create_dir_all(&dir).unwrap();
        // Write in reverse order to ensure sort is doing the work
        fs::write(dir.join("100_VisualQC_Structural.status"), "").unwrap();
        fs::write(dir.join("010_LinearReg_T1w2MNI.status"), "").unwrap();
        fs::write(dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(dir.join("030_FLAIR_BiasfieldCorrection.status"), "").unwrap();
        fs::write(dir.join("999_ready.status"), "").unwrap();

        let (status, steps, _) = determine_status(&dir);
        assert_eq!(status, "complete");
        assert_eq!(
            steps,
            vec![
                "010_LinearReg_T1w2MNI",
                "030_FLAIR_BiasfieldCorrection",
                "060_Segment_T1w",
                "100_VisualQC_Structural",
            ]
        );

        let _ = fs::remove_dir_all(dir);
    }

    // -------------------------------------------------------------------------
    // read_lock_status
    // -------------------------------------------------------------------------

    fn create_lock_tree(root: &Path) {
        let lock = root.join("derivatives").join("ExploreASL").join("lock");

        // Structural: sub-001_01 complete
        let struct_sub = lock
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&struct_sub).unwrap();
        fs::write(struct_sub.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(struct_sub.join("999_ready.status"), "").unwrap();

        // ASL: sub-001_01 run 01 incomplete, locked
        let asl_run = lock
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01");
        fs::create_dir_all(asl_run.join("locked")).unwrap();
        fs::write(asl_run.join("ASL.status"), "").unwrap();

        // Population: complete
        let pop = lock
            .join("xASL_module_Population")
            .join("xASL_module_Population");
        fs::create_dir_all(&pop).unwrap();
        fs::write(pop.join("999_ready.status"), "").unwrap();
    }

    #[test]
    fn read_lock_status_returns_empty_when_lock_dir_missing() {
        let root = unique_temp_path("no-lock");
        fs::create_dir_all(&root).unwrap();

        let statuses =
            read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

        assert!(statuses.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_lock_status_parses_all_modules() {
        let root = unique_temp_path("lock-all-modules");
        create_lock_tree(&root);

        let statuses =
            read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

        // Structural
        let structural = statuses
            .iter()
            .find(|s| s.module_name == "xASL_module_Structural")
            .expect("structural status should exist");
        assert_eq!(structural.subject_session, "sub-001_01");
        assert_eq!(structural.status, "complete");
        assert!(!structural.locked);

        // ASL
        let asl = statuses
            .iter()
            .find(|s| s.module_name == "xASL_module_ASL")
            .expect("asl status should exist");
        assert_eq!(asl.subject_session, "sub-001_01");
        assert_eq!(asl.status, "incomplete");
        assert!(asl.locked);
        assert_eq!(asl.run, Some("01".to_string()));

        // Population
        let pop = statuses
            .iter()
            .find(|s| s.module_name == "xASL_module_Population")
            .expect("population status should exist");
        assert_eq!(pop.status, "complete");
        assert!(pop.subject_session.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_lock_status_detects_outdated_status() {
        let root = unique_temp_path("outdated-status");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");

        let struct_sub = lock
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&struct_sub).unwrap();
        let struct_ready = struct_sub.join("999_ready.status");

        let asl_run = lock
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01");
        fs::create_dir_all(&asl_run).unwrap();
        let asl_ready = asl_run.join("999_ready.status");

        // Write ASL first
        fs::write(&asl_ready, "").unwrap();
        // Sleep a bit so structural has a strictly newer modification time
        std::thread::sleep(std::time::Duration::from_millis(15));
        fs::write(&struct_ready, "").unwrap();

        let statuses =
            read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

        let asl = statuses
            .iter()
            .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
            .expect("asl status should exist");
        assert_eq!(asl.status, "outdated");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_lock_status_detects_outdated_status_from_logs_only() {
        let root = unique_temp_path("outdated-status-logs");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");

        let struct_sub = lock
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&struct_sub).unwrap();
        let struct_ready = struct_sub.join("999_ready.status");

        // No ASL lock directory exists, but an ASL log exists
        fs::create_dir_all(&log_dir).unwrap();
        let asl_log = log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log");
        fs::write(&asl_log, "success log with no issues").unwrap();

        // Sleep a bit so structural has a newer timestamp
        std::thread::sleep(std::time::Duration::from_millis(15));
        fs::write(&struct_ready, "").unwrap();

        let statuses =
            read_lock_status(root.to_string_lossy().to_string()).expect("should succeed");

        let asl = statuses
            .iter()
            .find(|s| s.module_name == "xASL_module_ASL" && s.subject_session == "sub-001_01")
            .expect("asl status should exist");
        assert_eq!(asl.status, "outdated");
        assert_eq!(asl.run, Some("1".to_string()));

        let _ = fs::remove_dir_all(root);
    }

    // -------------------------------------------------------------------------
    // clear_stale_lock_dirs
    // -------------------------------------------------------------------------

    #[test]
    fn clear_stale_lock_dirs_removes_only_locked_subdirs_preserves_status_files() {
        let lock_root = unique_temp_path("clear-locked-only");
        let module_dir = lock_root
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(module_dir.join("locked")).unwrap();
        fs::write(module_dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(module_dir.join("999_ready.status"), "").unwrap();

        let asl_module = lock_root
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01");
        fs::create_dir_all(asl_module.join("locked")).unwrap();
        fs::write(asl_module.join("ASL.status"), "").unwrap();

        clear_stale_lock_dirs(&lock_root, &[true, false, false]).unwrap();

        // locked/ directories removed
        assert!(!module_dir.join("locked").exists());
        // .status files preserved
        assert!(module_dir.join("060_Segment_T1w.status").exists());
        assert!(module_dir.join("999_ready.status").exists());
        // Module directory itself preserved
        assert!(module_dir.exists());
        // Non-enabled module untouched
        assert!(asl_module.join("locked").exists());
        assert!(asl_module.join("ASL.status").exists());

        let _ = fs::remove_dir_all(lock_root);
    }

    #[test]
    fn clear_stale_lock_dirs_removes_locked_in_population_module() {
        let lock_root = unique_temp_path("clear-pop-locked");
        let pop_dir = lock_root
            .join("xASL_module_Population")
            .join("xASL_module_Population");
        fs::create_dir_all(pop_dir.join("locked")).unwrap();
        fs::write(pop_dir.join("999_ready.status"), "").unwrap();

        clear_stale_lock_dirs(&lock_root, &[false, false, true]).unwrap();

        assert!(!pop_dir.join("locked").exists());
        assert!(pop_dir.join("999_ready.status").exists());
        assert!(pop_dir.exists());

        let _ = fs::remove_dir_all(lock_root);
    }

    #[test]
    fn clear_stale_lock_dirs_handles_nested_asl_runs() {
        let lock_root = unique_temp_path("clear-asl-locked");
        let run_dir = lock_root
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01");
        fs::create_dir_all(run_dir.join("locked")).unwrap();
        fs::write(run_dir.join("ASL.status"), "").unwrap();

        clear_stale_lock_dirs(&lock_root, &[false, true, false]).unwrap();

        assert!(!run_dir.join("locked").exists());
        assert!(run_dir.join("ASL.status").exists());

        let _ = fs::remove_dir_all(lock_root);
    }

    // -------------------------------------------------------------------------
    // delete_status_files_for_modules
    // -------------------------------------------------------------------------

    #[test]
    fn delete_status_files_removes_only_status_files_in_matching_subjects() {
        let root = unique_temp_path("del-status");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");
        let module_dir = lock
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&module_dir).unwrap();
        fs::write(module_dir.join("060_Segment_T1w.status"), "").unwrap();
        fs::write(module_dir.join("999_ready.status"), "").unwrap();
        fs::write(module_dir.join("keep.txt"), "data").unwrap();

        delete_status_files_for_modules(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!module_dir.join("060_Segment_T1w.status").exists());
        assert!(!module_dir.join("999_ready.status").exists());
        assert!(module_dir.join("keep.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    // -------------------------------------------------------------------------
    // ProcessState defaults for watcher_stop
    // -------------------------------------------------------------------------

    #[test]
    fn process_state_default_has_no_watcher_stop() {
        let state = ProcessState::default();
        assert!(state.watcher_stop.is_none());
        assert!(state.watcher_handle.is_none());
    }

    // -------------------------------------------------------------------------
    // EventKind matching (Bug #4)
    // -------------------------------------------------------------------------

    #[test]
    fn parse_lock_path_works_regardless_of_create_kind() {
        // Verify that parse_lock_path works on any .status file path.
        // The actual fix is in the event kind matching in watch_lock_dir,
        // which switches from CreateKind::File to EventKind::Create(_).
        // This test ensures parse_lock_path correctly handles paths
        // that would come from CreateKind::Any or CreateKind::Folder.
        let temp = std::env::temp_dir();
        let lock_root = temp.join("test").join("lock");
        let path = lock_root
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural")
            .join("060_Segment_T1w.status");
        let result = parse_lock_path(&lock_root, &path);
        assert!(result.is_some());
        let event = result.unwrap();
        assert_eq!(event.module, "xASL_module_Structural");
        assert_eq!(event.subject_session, Some("sub-001_01".to_string()));
        assert_eq!(event.step_code, "060_Segment_T1w");

        // ASL path
        let asl_path = lock_root
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01")
            .join("020_RealignASL.status");
        let asl_result = parse_lock_path(&lock_root, &asl_path);
        assert!(asl_result.is_some());
        let asl_event = asl_result.unwrap();
        assert_eq!(asl_event.module, "xASL_module_ASL");
        assert_eq!(asl_event.subject_session, Some("sub-001_01".to_string()));
        assert_eq!(asl_event.step_code, "020_RealignASL");
        assert_eq!(asl_event.run, Some("01".to_string()));
    }

    #[test]
    fn delete_status_files_respects_subject_regexp_filter() {
        let root = unique_temp_path("del-regexp");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");

        let dir_001 = lock
            .join("xASL_module_Structural")
            .join("sub-001_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&dir_001).unwrap();
        fs::write(dir_001.join("step.status"), "").unwrap();

        let dir_002 = lock
            .join("xASL_module_Structural")
            .join("sub-002_01")
            .join("xASL_module_Structural");
        fs::create_dir_all(&dir_002).unwrap();
        fs::write(dir_002.join("step.status"), "").unwrap();

        delete_status_files_for_modules(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!dir_001.join("step.status").exists());
        assert!(dir_002.join("step.status").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_status_files_removes_asl_status_files() {
        let root = unique_temp_path("del-asl-status");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");
        let run_dir = lock
            .join("xASL_module_ASL")
            .join("sub-001_01")
            .join("xASL_module_ASL_ASL_01");
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(run_dir.join("020_RealignASL.status"), "").unwrap();
        fs::write(run_dir.join("999_ready.status"), "").unwrap();
        fs::write(run_dir.join("keep.txt"), "data").unwrap();

        delete_status_files_for_modules(&root, &[false, true, false], "^sub-001_01$").unwrap();

        assert!(!run_dir.join("020_RealignASL.status").exists());
        assert!(!run_dir.join("999_ready.status").exists());
        assert!(run_dir.join("keep.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_status_files_removes_population_status_files() {
        let root = unique_temp_path("del-pop-status");
        let lock = root.join("derivatives").join("ExploreASL").join("lock");
        let pop_dir = lock
            .join("xASL_module_Population")
            .join("xASL_module_Population");
        fs::create_dir_all(&pop_dir).unwrap();
        fs::write(pop_dir.join("010_CreatePopulationTemplates.status"), "").unwrap();
        fs::write(pop_dir.join("999_ready.status"), "").unwrap();
        fs::write(pop_dir.join("keep.txt"), "data").unwrap();

        delete_status_files_for_modules(&root, &[false, false, true], "^sub-.*$").unwrap();

        assert!(!pop_dir
            .join("010_CreatePopulationTemplates.status")
            .exists());
        assert!(!pop_dir.join("999_ready.status").exists());
        assert!(pop_dir.join("keep.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    // -------------------------------------------------------------------------
    // delete_module_log_files
    // -------------------------------------------------------------------------

    #[test]
    fn delete_module_log_files_removes_structural_log_for_matching_subject() {
        let root = unique_temp_path("del-log-structural");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(
            log_dir.join("xASL_module_Structural_sub-001_01.log"),
            "old log",
        )
        .unwrap();
        fs::write(
            log_dir.join("xASL_module_Structural_sub-002_01.log"),
            "old log",
        )
        .unwrap();

        delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists());
        assert!(log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_removes_all_asl_runs_for_matching_subject() {
        let root = unique_temp_path("del-log-asl-runs");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(
            log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"),
            "old log",
        )
        .unwrap();
        fs::write(
            log_dir.join("xASL_module_ASL_sub-001_01_ASL_2.log"),
            "old log",
        )
        .unwrap();
        fs::write(
            log_dir.join("xASL_module_ASL_sub-002_01_ASL_1.log"),
            "old log",
        )
        .unwrap();

        delete_module_log_files(&root, &[false, true, false], "^sub-001_01$").unwrap();

        assert!(!log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists());
        assert!(!log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_2.log")
            .exists());
        assert!(log_dir
            .join("xASL_module_ASL_sub-002_01_ASL_1.log")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_respects_subject_regexp_filter() {
        let root = unique_temp_path("del-log-regexp");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
        fs::write(log_dir.join("xASL_module_Structural_sub-002_01.log"), "old").unwrap();

        delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists());
        assert!(log_dir
            .join("xASL_module_Structural_sub-002_01.log")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_preserves_non_log_files() {
        let root = unique_temp_path("del-log-nonlog");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
        fs::write(log_dir.join("bids_report_sub-001_ses-01.json"), "{}").unwrap();
        fs::write(log_dir.join("import_summary_sub-001.csv"), "csv").unwrap();

        delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists());
        assert!(log_dir.join("bids_report_sub-001_ses-01.json").exists());
        assert!(log_dir.join("import_summary_sub-001.csv").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_skips_disabled_modules() {
        let root = unique_temp_path("del-log-skip");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();
        fs::write(log_dir.join("xASL_module_ASL_sub-001_01_ASL_1.log"), "old").unwrap();

        delete_module_log_files(&root, &[true, false, false], "^sub-001_01$").unwrap();

        assert!(!log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists());
        assert!(log_dir
            .join("xASL_module_ASL_sub-001_01_ASL_1.log")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_handles_missing_log_dir() {
        let root = unique_temp_path("del-log-missing");

        let result = delete_module_log_files(&root, &[true, false, false], "^sub-001_01$");

        assert!(result.is_ok());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_module_log_files_deletes_population_log() {
        let root = unique_temp_path("del-log-pop");
        let log_dir = root.join("derivatives").join("ExploreASL").join("log");
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("xASL_module_Population.log"), "old").unwrap();
        fs::write(log_dir.join("xASL_module_Structural_sub-001_01.log"), "old").unwrap();

        delete_module_log_files(&root, &[false, false, true], "^sub-001_01$").unwrap();

        assert!(!log_dir.join("xASL_module_Population.log").exists());
        assert!(log_dir
            .join("xASL_module_Structural_sub-001_01.log")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    // -------------------------------------------------------------------------
    // get_exploreasl_version
    // -------------------------------------------------------------------------

    #[test]
    fn get_exploreasl_version_finds_version_file() {
        let root = unique_temp_path("version-find");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("VERSION_1.11.0"), "").unwrap();

        let version = get_exploreasl_version(&root);

        assert_eq!(version, Some("1.11.0".to_string()));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_exploreasl_version_finds_beta_version() {
        let root = unique_temp_path("version-beta");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

        let version = get_exploreasl_version(&root);

        assert_eq!(version, Some("2.0.0_BETA".to_string()));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_exploreasl_version_returns_none_when_no_version_file() {
        let root = unique_temp_path("version-none");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("ExploreASL.m"), "").unwrap();
        fs::write(root.join("README.md"), "").unwrap();

        let version = get_exploreasl_version(&root);

        assert_eq!(version, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_exploreasl_version_returns_none_when_dir_missing() {
        let root = unique_temp_path("version-missing");

        let version = get_exploreasl_version(&root);

        assert_eq!(version, None);
    }

    #[test]
    fn get_exploreasl_version_returns_first_when_multiple() {
        let root = unique_temp_path("version-multi");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("VERSION_1.11.0"), "").unwrap();
        fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

        let version = get_exploreasl_version(&root);

        assert!(version == Some("1.11.0".to_string()) || version == Some("2.0.0_BETA".to_string()));

        let _ = fs::remove_dir_all(root);
    }

    // -------------------------------------------------------------------------
    // list_module_logs / read_module_logs
    // -------------------------------------------------------------------------

    #[test]
    fn list_module_logs_finds_import_logs_in_staging_when_project_log_dir_missing() {
        let root = unique_temp_path("import-staging-logs");
        let staging_log = root
            .join(".easl_staging")
            .join("derivatives")
            .join("ExploreASL")
            .join("log");
        fs::create_dir_all(&staging_log).unwrap();
        fs::write(
            staging_log.join("xASL_module_Import_sub-C9ORF007Philips.log"),
            "ExploreASL import output",
        )
        .unwrap();

        let logs = list_module_logs(root.to_string_lossy().to_string())
            .expect("list_module_logs should succeed");

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].module, "import");
        assert_eq!(logs[0].subject_session, "sub-C9ORF007Philips");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_module_logs_reads_import_logs_from_staging() {
        let root = unique_temp_path("read-import-staging-logs");
        let staging_log = root
            .join(".easl_staging")
            .join("derivatives")
            .join("ExploreASL")
            .join("log");
        fs::create_dir_all(&staging_log).unwrap();
        fs::write(
            staging_log.join("xASL_module_Import_sub-C9ORF007Philips.log"),
            "import log body",
        )
        .unwrap();

        let content = read_module_logs(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips".to_string(),
            "import".to_string(),
        )
        .expect("read_module_logs should succeed");

        assert_eq!(
            content["xASL_module_Import_sub-C9ORF007Philips.log"],
            "import log body"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_list_subject_reports_and_read_report_image() {
        let root = unique_temp_path("test-qc-reports");
        let derivatives = root
            .join("derivatives")
            .join("ExploreASL")
            .join("Population");

        let t1_dir = derivatives.join("T1Check");
        let asl_dir = derivatives.join("ASLCheck");
        let m0_dir = derivatives.join("M0Reg_ASL");

        fs::create_dir_all(&t1_dir).unwrap();
        fs::create_dir_all(&asl_dir).unwrap();
        fs::create_dir_all(&m0_dir).unwrap();

        // 1. Write mock structural report files
        // Axial
        fs::write(
            t1_dir.join("Tra_Seg_rT1_sub-C9ORF007Philips_01_rc2T1_sub-C9ORF007Philips_01.jpg"),
            b"structural_axial_bytes",
        )
        .unwrap();
        // Coronal
        fs::write(
            t1_dir.join("Cor_Seg_rT1_sub-C9ORF007Philips_01_rc2T1_sub-C9ORF007Philips_01.jpg"),
            b"structural_coronal_bytes",
        )
        .unwrap();

        // 2. Write mock ASL report files (Run 1)
        // Axial
        fs::write(
            asl_dir.join("Tra_Reg_qCBF_sub-C9ORF007Philips_01_ASL_1_PV_pWM_sub-C9ORF007Philips_01_Contour.jpg"),
            b"asl_run1_axial_bytes",
        )
        .unwrap();
        // Coronal
        fs::write(
            asl_dir.join("Cor_Reg_qCBF_sub-C9ORF007Philips_01_ASL_1_PV_pWM_sub-C9ORF007Philips_01_Contour.jpg"),
            b"asl_run1_coronal_bytes",
        )
        .unwrap();

        // 3. Write mock M0 report files (Run 1)
        // Axial
        fs::write(
            m0_dir.join("Tra_Reg_noSmooth_M0_sub-C9ORF007Philips_01_ASL_1_PV_pGM_sub-C9ORF007Philips_01_Contour.jpg"),
            b"m0_run1_axial_bytes",
        )
        .unwrap();
        // Coronal
        fs::write(
            m0_dir.join("Cor_Reg_noSmooth_M0_sub-C9ORF007Philips_01_ASL_1_PV_pGM_sub-C9ORF007Philips_01_Contour.jpg"),
            b"m0_run1_coronal_bytes",
        )
        .unwrap();

        // 4. Test list_subject_reports
        let list = list_subject_reports(root.to_string_lossy().to_string())
            .expect("list_subject_reports should succeed");

        // Should contain 1 structural, 1 asl and 1 m0 entry
        assert_eq!(list.len(), 3);

        let struct_entry = list.iter().find(|x| x.module == "structural").unwrap();
        assert_eq!(struct_entry.subject_session, "sub-C9ORF007Philips_01");
        assert_eq!(struct_entry.run, None);

        let asl_entry = list.iter().find(|x| x.module == "asl").unwrap();
        assert_eq!(asl_entry.subject_session, "sub-C9ORF007Philips_01");
        assert_eq!(asl_entry.run, Some("1".to_string()));

        let m0_entry = list.iter().find(|x| x.module == "m0").unwrap();
        assert_eq!(m0_entry.subject_session, "sub-C9ORF007Philips_01");
        assert_eq!(m0_entry.run, Some("1".to_string()));

        // 5. Test read_report_image
        // Structural Axial
        let img_bytes = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "structural".to_string(),
            None,
            "axial".to_string(),
        )
        .expect("read structural axial should succeed");
        assert_eq!(img_bytes, b"structural_axial_bytes");

        // Structural Coronal
        let img_bytes_cor = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "structural".to_string(),
            None,
            "coronal".to_string(),
        )
        .expect("read structural coronal should succeed");
        assert_eq!(img_bytes_cor, b"structural_coronal_bytes");

        // ASL Axial Run 1
        let asl_bytes = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "asl".to_string(),
            Some("1".to_string()),
            "axial".to_string(),
        )
        .expect("read asl axial should succeed");
        assert_eq!(asl_bytes, b"asl_run1_axial_bytes");

        // ASL Coronal Run 1
        let asl_bytes_cor = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "asl".to_string(),
            Some("1".to_string()),
            "coronal".to_string(),
        )
        .expect("read asl coronal should succeed");
        assert_eq!(asl_bytes_cor, b"asl_run1_coronal_bytes");

        // M0 Axial Run 1
        let m0_bytes = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "m0".to_string(),
            Some("1".to_string()),
            "axial".to_string(),
        )
        .expect("read m0 axial should succeed");
        assert_eq!(m0_bytes, b"m0_run1_axial_bytes");

        // M0 Coronal Run 1
        let m0_bytes_cor = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "m0".to_string(),
            Some("1".to_string()),
            "coronal".to_string(),
        )
        .expect("read m0 coronal should succeed");
        assert_eq!(m0_bytes_cor, b"m0_run1_coronal_bytes");

        // 6. Test errors / validation
        // Non-existent image
        let err = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-nonexistent_01".to_string(),
            "structural".to_string(),
            None,
            "axial".to_string(),
        );
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("Report image not found"));

        // Invalid view type
        let err_view = read_report_image(
            root.to_string_lossy().to_string(),
            "sub-C9ORF007Philips_01".to_string(),
            "structural".to_string(),
            None,
            "sagittal".to_string(),
        );
        assert!(err_view.is_err());
        assert!(err_view.unwrap_err().contains("Unknown view type"));

        let _ = fs::remove_dir_all(root);
    }
}
