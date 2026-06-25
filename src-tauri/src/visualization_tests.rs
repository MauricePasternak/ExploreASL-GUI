#[cfg(test)]
mod tests {
    use crate::import::AppState;
    use crate::visualization::*;
    use std::fs;
    use std::path::PathBuf;

    fn setup_stats_dir(tsv_content: &str) -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_path_buf();
        let stats_dir = root.join("derivatives/ExploreASL/Population/Stats");
        fs::create_dir_all(&stats_dir).unwrap();
        fs::write(stats_dir.join("test.tsv"), tsv_content).unwrap();
        (temp, root)
    }

    #[test]
    fn test_list_stats_files_returns_only_tsv() {
        let temp = tempfile::tempdir().unwrap();
        let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
        fs::create_dir_all(&stats_dir).unwrap();
        fs::write(stats_dir.join("mean_data.tsv"), "header\n").unwrap();
        fs::write(stats_dir.join("image.png"), "png").unwrap();
        let result = list_stats_files_impl(temp.path().to_path_buf()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].file_name.ends_with(".tsv"));
    }

    #[test]
    fn test_list_stats_files_empty_when_no_dir() {
        let temp = tempfile::tempdir().unwrap();
        let result = list_stats_files_impl(temp.path().to_path_buf()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_inspect_tsv_parses_columns_and_skips_units() {
        let tsv = "participant_id\tsession\tGM_vol\nStudyID\t...\tLiter\nsub-X_01\tASL_1\t0.64\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let state = AppState::default();
        let result = load_qcbf_data_impl(root, "test.tsv".to_string(), &state).unwrap();
        assert_eq!(result.row_count, 1);
        assert!(result.external_hash.is_none());
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "participant_id" && c.is_identifier));
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "subject" && c.is_identifier));
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "session" && c.is_identifier));
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "run" && c.is_identifier));
        let gm = result.columns.iter().find(|c| c.name == "GM_vol").unwrap();
        assert_eq!(gm.inferred_type, "continuous");
        assert_eq!(gm.units, "Liter");
        assert_eq!(gm.source, ColumnSource::Qcbf);
        assert_eq!(gm.original_name, "GM_vol");
        assert!(!result.qcbf_hash.is_empty());
    }

    #[test]
    fn test_inspect_tsv_missing_values_treated_as_missing() {
        let tsv = "participant_id\tsession\tGM_vol\tSite\nStudyID\t...\tLiter\tint\nsub-X_01\tASL_1\t\t1\nsub-X_02\tASL_1\tNaN\t\nsub-X_03\tASL_1\t0.64\tNA\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let state = AppState::default();
        let result = load_qcbf_data_impl(root, "test.tsv".to_string(), &state).unwrap();
        let gm = result.columns.iter().find(|c| c.name == "GM_vol").unwrap();
        assert_eq!(gm.inferred_type, "continuous");
        let site = result.columns.iter().find(|c| c.name == "Site").unwrap();
        assert_eq!(site.inferred_type, "continuous");
    }

    #[test]
    fn test_read_tsv_columns_returns_requested_and_identifiers() {
        let tsv = "participant_id\tsession\tGM_vol\tSite\nStudyID\t...\tLiter\tint\nsub-X_01\tASL_1\t0.64\t1\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let result =
            read_tsv_columns_impl(root, "test.tsv".to_string(), vec!["GM_vol".to_string()])
                .unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].contains_key("participant_id"));
        assert!(result[0].contains_key("subject"));
        assert!(result[0].contains_key("session"));
        assert!(result[0].contains_key("run"));
        assert!(result[0].contains_key("GM_vol"));
        assert!(!result[0].contains_key("Site"));
    }

    #[test]
    fn test_inspect_tsv_no_duplicate_columns() {
        let tsv = "participant_id\tsession\tGM_vol\nStudyID\t...\tLiter\nsub-X_01\tASL_1\t0.64\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let result = inspect_tsv_impl(root, "test.tsv".to_string()).unwrap();

        let mut seen = std::collections::HashSet::new();
        for col in &result.columns {
            assert!(
                seen.insert(col.name.clone()),
                "Duplicate column found: {}",
                col.name
            );
        }
    }

    #[test]
    fn test_active_data_default_is_none() {
        let state = AppState::default();
        let data = state.active_data.lock().unwrap();
        assert!(data.is_none());
    }

    fn populate_active_data(state: &AppState) {
        *state.active_data.lock().unwrap() = Some(ActiveData {
            rows: vec![],
            columns: vec![],
            row_count: 0,
            qcbf_hash: "test".to_string(),
            external_hash: None,
        });
    }

    #[test]
    fn test_clear_active_project_clears_active_data() {
        let state = AppState::default();
        populate_active_data(&state);
        assert!(state.active_data.lock().unwrap().is_some());
        clear_active_project_impl(&state).unwrap();
        assert!(state.active_data.lock().unwrap().is_none());
    }

    #[test]
    fn test_set_active_project_clears_active_data() {
        let temp = tempfile::tempdir().unwrap();
        let state = AppState::default();
        populate_active_data(&state);
        assert!(state.active_data.lock().unwrap().is_some());
        set_active_project_impl(temp.path().to_string_lossy().to_string(), &state).unwrap();
        assert!(state.active_data.lock().unwrap().is_none());
    }

    #[test]
    fn test_load_qcbf_data_returns_inspection_and_caches() {
        let tsv = "participant_id\tsession\tGM_vol\nStudyID\t...\tLiter\nsub-X_01\tASL_1\t0.64\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let state = AppState::default();
        let result = load_qcbf_data_impl(root, "test.tsv".to_string(), &state).unwrap();
        assert_eq!(result.row_count, 1);
        assert!(result.external_hash.is_none());
        assert!(!result.qcbf_hash.is_empty());
        let cached = state.active_data.lock().unwrap();
        assert!(cached.is_some());
        assert_eq!(cached.as_ref().unwrap().row_count, 1);
    }

    #[test]
    fn test_to_inspection_strips_rows() {
        let columns = vec![ColumnMetadata {
            name: "GM_vol".to_string(),
            original_name: "GM_vol".to_string(),
            source: ColumnSource::Qcbf,
            units: "Liter".to_string(),
            inferred_type: "continuous".to_string(),
            levels: vec![],
            is_identifier: false,
        }];
        let rows = vec![
            std::collections::HashMap::from([("GM_vol".to_string(), "0.64".to_string())]),
            std::collections::HashMap::from([("GM_vol".to_string(), "0.72".to_string())]),
        ];
        let active = ActiveData {
            rows: rows.clone(),
            columns: columns.clone(),
            row_count: rows.len(),
            qcbf_hash: "abc123".to_string(),
            external_hash: Some("ext9".to_string()),
        };
        let inspection = active.to_inspection();
        assert_eq!(inspection.columns, columns);
        assert_eq!(inspection.row_count, 2);
        assert_eq!(inspection.qcbf_hash, "abc123");
        assert_eq!(inspection.external_hash, Some("ext9".to_string()));
    }

    #[test]
    fn test_read_data_columns_from_cache() {
        let tsv = "participant_id\tsession\tGM_vol\tSite\nStudyID\t...\tLiter\tint\nsub-X_01\tASL_1\t0.64\t1\n";
        let (_temp, root) = setup_stats_dir(tsv);
        let state = AppState::default();
        load_qcbf_data_impl(root, "test.tsv".to_string(), &state).unwrap();
        let result = read_data_columns_impl(vec!["GM_vol".to_string()], &state).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].contains_key("participant_id"));
        assert!(result[0].contains_key("subject"));
        assert!(result[0].contains_key("session"));
        assert!(result[0].contains_key("run"));
        assert!(result[0].contains_key("GM_vol"));
        assert!(!result[0].contains_key("Site"));
    }

    #[test]
    fn test_read_data_columns_error_when_no_cache() {
        let state = AppState::default();
        let result = read_data_columns_impl(vec!["GM_vol".to_string()], &state);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No data loaded"));
    }

    #[test]
    fn test_inspect_external_data_csv() {
        let temp = tempfile::tempdir().unwrap();
        let csv_path = temp.path().join("covariates.csv");
        fs::write(
            &csv_path,
            "SubjectID,Diagnosis,Age\nsub-X_01,AD,65\nsub-X_02,Control,70\n",
        )
        .unwrap();
        let result =
            inspect_external_data_impl(csv_path.to_string_lossy().to_string(), None).unwrap();
        assert_eq!(result.row_count, 2);
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "SubjectID" && !c.is_identifier));
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "Age" && c.inferred_type == "continuous"));
        assert!(result
            .columns
            .iter()
            .any(|c| c.name == "Diagnosis" && c.inferred_type == "nominal"));
        assert!(result.sheet_name.is_none());
        assert!(!result.file_hash.is_empty());
    }

    #[test]
    fn test_inspect_external_data_file_not_found() {
        let result = inspect_external_data_impl("/nonexistent/path.csv".to_string(), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_inspect_external_data_csv_semicolon() {
        let temp = tempfile::tempdir().unwrap();
        let csv_path = temp.path().join("euro.csv");
        fs::write(
            &csv_path,
            "SubjectID;Diagnosis;Age\nsub-X_01;AD;65\nsub-X_02;Control;70\n",
        )
        .unwrap();
        let result =
            inspect_external_data_impl(csv_path.to_string_lossy().to_string(), None).unwrap();
        assert!(result.columns.iter().any(|c| c.name == "SubjectID"));
        assert!(result.columns.iter().any(|c| c.name == "Diagnosis"));
        assert!(result.columns.iter().any(|c| c.name == "Age"));
    }
}
