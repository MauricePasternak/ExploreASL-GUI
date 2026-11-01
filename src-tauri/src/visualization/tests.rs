use crate::app::state::AppState;
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
fn test_load_qcbf_data_parses_columns_skips_units_and_caches() {
    let tsv = "participant_id\tsession\tGM_vol\nStudyID\t...\tLiter\nsub-X_01\tASL_1\t0.64\n";
    let (_temp, root) = setup_stats_dir(tsv);
    let state = AppState::default();
    let result = load_qcbf_data_impl(root, "test.tsv".to_string(), &state).unwrap();
    assert_eq!(result.row_count, 1);
    assert_eq!(result.qcbf_row_count, 1);
    assert!(result.external_hash.is_none());
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "participant_id" && c.is_identifier)
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "subject" && c.is_identifier)
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "session" && c.is_identifier)
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "run" && c.is_identifier)
    );
    let gm = result.columns.iter().find(|c| c.name == "GM_vol").unwrap();
    assert_eq!(gm.inferred_type, "continuous");
    assert_eq!(gm.units, "Liter");
    assert_eq!(gm.source, ColumnSource::Qcbf);
    assert_eq!(gm.original_name, "GM_vol");
    assert!(!result.qcbf_hash.is_empty());
    let cached = state.active_data.lock().unwrap();
    let cached = cached.as_ref().unwrap();
    assert_eq!(cached.rows.len(), 1);
    assert_eq!(cached.rows, cached.qcbf_rows);
}

#[test]
fn test_load_qcbf_data_missing_values_treated_as_missing() {
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
fn test_active_data_default_is_none() {
    let state = AppState::default();
    let data = state.active_data.lock().unwrap();
    assert!(data.is_none());
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
    assert!(result.unwrap_err().to_string().contains("No data loaded"));
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
        inspect_external_data_impl(csv_path.to_string_lossy().to_string(), None, None).unwrap();
    assert_eq!(result.row_count, 2);
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "SubjectID" && !c.is_identifier)
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "Age" && c.inferred_type == "continuous")
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "Diagnosis" && c.inferred_type == "nominal")
    );
    assert!(result.sheet_name.is_none());
    assert_eq!(
        result.file_hash,
        "2f0be0bdb4a2414c185663d868680d8fb5a21f48f343557121a5a86991c241dc"
    );
}

#[test]
fn test_inspect_external_data_xlsx_and_read_rows() {
    use super::external::parse_external_xlsx_rows;

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("covariates.xlsx");
    fs::write(
        &path,
        include_bytes!("../../../test/fixtures/metadata/covariates.xlsx"),
    )
    .unwrap();
    let inspect =
        |sheet| inspect_external_data_impl(path.to_string_lossy().into_owned(), sheet, None);
    let result = inspect(None).unwrap();
    assert_eq!(result.sheet_name.as_deref(), Some("Covariates"));
    assert_eq!(result.row_count, 2);
    assert_eq!(result.columns[0].name, "SubjectID");
    assert!(result.columns.iter().all(|column| !column.is_identifier));
    assert_eq!(result.columns[1].inferred_type, "continuous");
    assert_eq!(result.columns[2].levels, ["AD"]);
    assert_eq!(
        result.file_hash,
        "c4baa17ff135a825dde00b6fe6decf41c99c2e16e16a47cac5a56c58546cb66b"
    );
    let rows = parse_external_xlsx_rows(&path, None, &["NA".into()]).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["Age"], "65");
    assert_eq!(rows[1]["Age"], "70");
    assert_eq!(rows[1]["Diagnosis"], "");

    let result = inspect(Some("Alternate".into())).unwrap();
    assert_eq!(result.sheet_name.as_deref(), Some("Alternate"));
    assert_eq!(result.row_count, 1);
    let rows = parse_external_xlsx_rows(&path, Some("Alternate".into()), &[]).unwrap();
    assert_eq!(rows[0]["SubjectID"], "sub-Å_03");
    assert_eq!(rows[0]["Age"], "");
    assert_eq!(rows[0]["Diagnosis"], "Control");
    assert!(inspect(Some("Missing".into())).is_err());
    assert!(parse_external_xlsx_rows(&path, Some("Missing".into()), &[]).is_err());
}

#[test]
fn test_inspect_external_data_file_not_found() {
    let result = inspect_external_data_impl("/nonexistent/path.csv".to_string(), None, None);
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
        inspect_external_data_impl(csv_path.to_string_lossy().to_string(), None, None).unwrap();
    assert!(result.columns.iter().any(|c| c.name == "SubjectID"));
    assert!(result.columns.iter().any(|c| c.name == "Diagnosis"));
    assert!(result.columns.iter().any(|c| c.name == "Age"));
}

#[test]
fn test_inspect_external_data_csv_delimiter_override() {
    let temp = tempfile::tempdir().unwrap();
    let csv_path = temp.path().join("override.csv");
    // Semicolon file, but we override delimiter to comma -> will parse as single column unless overridden
    fs::write(&csv_path, "SubjectID;Diagnosis;Age\nsub-X_01;AD;65\n").unwrap();

    // Comma override: single column "SubjectID;Diagnosis;Age" expected
    let result_comma = inspect_external_data_impl(
        csv_path.to_string_lossy().to_string(),
        None,
        Some(",".to_string()),
    )
    .unwrap();
    assert_eq!(result_comma.columns.len(), 1);
    assert_eq!(result_comma.columns[0].name, "SubjectID;Diagnosis;Age");

    // Semicolon override: parses correctly
    let result_semi = inspect_external_data_impl(
        csv_path.to_string_lossy().to_string(),
        None,
        Some(";".to_string()),
    )
    .unwrap();
    assert_eq!(result_semi.columns.len(), 3);
    assert_eq!(result_semi.columns[0].name, "SubjectID");
}

fn default_na_tokens() -> Vec<String> {
    vec![
        "".to_string(),
        "NaN".to_string(),
        "NA".to_string(),
        "n/a".to_string(),
        "<NA>".to_string(),
    ]
}

#[test]
fn test_execute_join_basic() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\nsub-X_02\tASL_1\t0.70\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(
        &ext_path,
        "SubjectID,Diagnosis\nsub-X_01,AD\nsub-X_02,Control\n",
    )
    .unwrap();

    let state = AppState::default();
    let result = execute_join_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.row_count, 2);
    assert_eq!(result.qcbf_row_count, 2);
    assert!(!result.qcbf_hash.is_empty());
    assert!(result.external_hash.is_some());
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "Diagnosis" && c.source == ColumnSource::External)
    );
    assert!(!result.columns.iter().any(|c| c.name == "SubjectID"));
    let cached = state.active_data.lock().unwrap();
    let cached = cached.as_ref().unwrap();
    assert_eq!(cached.rows.len(), 2);
    assert_eq!(cached.rows[0]["Diagnosis"], "AD");
    assert_eq!(cached.qcbf_rows.len(), 2);
    assert!(
        cached
            .qcbf_rows
            .iter()
            .all(|row| !row.contains_key("Diagnosis"))
    );
}

#[test]
fn test_execute_join_unmatched_rows() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\nsub-X_02\tASL_1\t0.70\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "SubjectID,Diagnosis\nsub-X_01,AD\n").unwrap();

    let state = AppState::default();
    let result = execute_join_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.row_count, 2);
    let cached = state.active_data.lock().unwrap();
    let rows = &cached.as_ref().unwrap().rows;
    let unmatched = rows
        .iter()
        .find(|r| r.get("participant_id") == Some(&"sub-X_02".to_string()))
        .unwrap();
    assert_eq!(unmatched.get("Diagnosis"), Some(&"".to_string()));
}

#[test]
fn test_execute_join_column_collision_suffix() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tMeanMotion\nsub-X_01\tASL_1\t0.5\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "SubjectID,MeanMotion\nsub-X_01,1.2\n").unwrap();

    let state = AppState::default();
    let result = execute_join_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "MeanMotion_x" && c.source == ColumnSource::Qcbf)
    );
    assert!(
        result
            .columns
            .iter()
            .any(|c| c.name == "MeanMotion_y" && c.source == ColumnSource::External)
    );
}

#[test]
fn test_check_join_sanity_full_overlap() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\nsub-X_02\tASL_1\t0.70\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(
        &ext_path,
        "SubjectID,Diagnosis\nsub-X_01,AD\nsub-X_02,Control\n",
    )
    .unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let result = check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.overlap_count, 2);
    assert_eq!(result.unmatched_left_count, 0);
    assert!(result.left_keys_unique);
    assert!(result.right_keys_unique);
}

#[test]
fn test_check_join_sanity_robust_matching() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
            stats_dir.join("test.tsv"),
            "participant_id\tsession\tGM_vol\nsub-001Philips_01\tASL_1\t0.64\nsub-002Siemens_01\tASL_1\t0.70\n",
        )
        .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(
        &ext_path,
        "Subject,Diagnosis\n001Philips,AD\n002siemens,Control\n",
    )
    .unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let result = check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "subject".to_string(),
            right: "Subject".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.overlap_count, 2);
    assert_eq!(result.unmatched_left_count, 0);
}

#[test]
fn test_check_join_sanity_zero_overlap() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "SubjectID,Diagnosis\nsub-Y_99,AD\n").unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let result = check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.overlap_count, 0);
    assert_eq!(result.unmatched_left_count, 1);
}

#[test]
fn test_check_join_sanity_non_unique_left_keys() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\nsub-X_01\tASL_2\t0.70\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "Subject,Diagnosis\nsub-X_01,AD\n").unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let result = check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "subject".to_string(),
            right: "Subject".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert!(!result.left_keys_unique);
    assert_eq!(result.overlap_count, 0);
    assert_eq!(result.unmatched_left_count, 2);
}

#[test]
fn test_check_join_sanity_unmatched_count_is_rows_not_keys() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
            stats_dir.join("test.tsv"),
            "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\nsub-Y_99\tASL_1\t0.70\nsub-Y_99\tASL_2\t0.71\n",
        )
        .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "SubjectID,Diagnosis\nsub-X_01,AD\n").unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let result = check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(result.overlap_count, 1);
    assert_eq!(result.unmatched_left_count, 2);
    assert!(!result.left_keys_unique);
}

#[test]
fn test_check_join_sanity_does_not_modify_cache() {
    let temp = tempfile::tempdir().unwrap();
    let stats_dir = temp.path().join("derivatives/ExploreASL/Population/Stats");
    fs::create_dir_all(&stats_dir).unwrap();
    fs::write(
        stats_dir.join("test.tsv"),
        "participant_id\tsession\tGM_vol\nsub-X_01\tASL_1\t0.64\n",
    )
    .unwrap();

    let ext_path = temp.path().join("covariates.csv");
    fs::write(&ext_path, "SubjectID,Diagnosis\nsub-X_01,AD\n").unwrap();

    let state = AppState::default();
    load_qcbf_data_impl(temp.path().to_path_buf(), "test.tsv".to_string(), &state).unwrap();
    let cached_before = state.active_data.lock().unwrap().as_ref().unwrap().clone();

    check_join_sanity_impl(
        temp.path().to_path_buf(),
        "test.tsv".to_string(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "SubjectID".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    let cached_after = state.active_data.lock().unwrap();
    let cached_after = cached_after.as_ref().unwrap();
    assert_eq!(cached_before.rows, cached_after.rows);
    assert_eq!(cached_before.qcbf_rows, cached_after.qcbf_rows);
}

#[test]
fn test_integration_clinical_covariates_join() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("clinical_covariates.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    // 1. Sanity check: clean 1:1 join, all rows match, no warnings
    let sanity = check_join_sanity_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(sanity.overlap_count, 8);
    assert_eq!(sanity.unmatched_left_count, 0);
    assert!(sanity.left_keys_unique);
    assert!(sanity.right_keys_unique);

    // 2. Execute join: should succeed and have exactly 8 rows
    let joined = execute_join_impl(
        project_root,
        qcbf_relative_path,
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        true, // drop_right_on
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(joined.row_count, 8);
    assert!(joined.columns.iter().any(|c| c.name == "Diagnosis"));
    assert!(joined.columns.iter().any(|c| c.name == "Age"));
}

#[test]
fn test_integration_demographics_multi_key_join() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("demographics.tsv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let sanity = check_join_sanity_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path.to_string_lossy().to_string(),
        vec![
            JoinKeyPair {
                left: "subject".to_string(),
                right: "Subject".to_string(),
            },
            JoinKeyPair {
                left: "session".to_string(),
                right: "Session".to_string(),
            },
        ],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(sanity.overlap_count, 8);
    assert_eq!(sanity.unmatched_left_count, 0);

    let joined = execute_join_impl(
        project_root,
        qcbf_relative_path,
        ext_path.to_string_lossy().to_string(),
        vec![
            JoinKeyPair {
                left: "subject".to_string(),
                right: "Subject".to_string(),
            },
            JoinKeyPair {
                left: "session".to_string(),
                right: "Session".to_string(),
            },
        ],
        true, // drop_right_on
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(joined.row_count, 8);
    assert!(joined.columns.iter().any(|c| c.name == "MeanMotion_x"));
    assert!(joined.columns.iter().any(|c| c.name == "MeanMotion_y"));
}

#[test]
fn test_integration_semicolon_delimiter_auto_detection() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("diagnosis_semicolon.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let sanity = check_join_sanity_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        default_na_tokens(),
        None,
        None, // auto-detect
        &state,
    )
    .unwrap();

    assert_eq!(sanity.overlap_count, 8);
    assert_eq!(sanity.unmatched_left_count, 0);
}

#[test]
fn test_integration_missing_value_normalization() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("with_missing_values.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let _joined = execute_join_impl(
        project_root,
        qcbf_relative_path,
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    let active_guard = state.active_data.lock().unwrap();
    let active = active_guard.as_ref().unwrap();

    let row = active
        .rows
        .iter()
        .find(|r| r.get("participant_id") == Some(&"sub-001_02".to_string()))
        .unwrap();
    assert_eq!(row.get("Biomarker_Tau"), Some(&"".to_string())); // normalized from NA
    assert_eq!(row.get("Biomarker_NfL"), Some(&"11.8".to_string()));

    let row2 = active
        .rows
        .iter()
        .find(|r| r.get("participant_id") == Some(&"sub-002_11".to_string()))
        .unwrap();
    assert_eq!(row2.get("Biomarker_Tau"), Some(&"".to_string())); // normalized from <NA>
    assert_eq!(row2.get("Biomarker_NfL"), Some(&"52.1".to_string()));
}

#[test]
fn test_integration_partial_overlap() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("partial_overlap.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let sanity = check_join_sanity_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert_eq!(sanity.overlap_count, 4);
    assert_eq!(sanity.unmatched_left_count, 4);
}

#[test]
fn test_integration_duplicate_right_keys() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("duplicate_right_keys.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let sanity = check_join_sanity_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "subject".to_string(),
            right: "Subject".to_string(),
        }],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert!(!sanity.right_keys_unique);
}

#[test]
fn test_integration_collision_columns() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path = test_metadata_dir.join("collision_columns.csv");

    let state = AppState::default();
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    let joined = execute_join_impl(
        project_root,
        qcbf_relative_path,
        ext_path.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    assert!(joined.columns.iter().any(|c| c.name == "MeanMotion_x"));
    assert!(joined.columns.iter().any(|c| c.name == "MeanMotion_y"));
    assert!(joined.columns.iter().any(|c| c.name == "Site_x"));
    assert!(joined.columns.iter().any(|c| c.name == "Site_y"));
    assert!(joined.columns.iter().any(|c| c.name == "Total_GM_B_x"));
    assert!(joined.columns.iter().any(|c| c.name == "Total_GM_B_y"));
}

#[test]
fn test_integration_successive_joins_no_leak() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().unwrap();
    let test_metadata_dir = workspace_dir.join("test/fixtures/metadata");
    let project_root = workspace_dir.join("test/fixtures");
    let qcbf_relative_path = "mean_qCBF_mock.tsv".to_string();
    let ext_path_1 = test_metadata_dir.join("clinical_covariates.csv");
    let ext_path_2 = test_metadata_dir.join("demographics.tsv");

    let state = AppState::default();

    // 1. Load data
    load_qcbf_data_impl(project_root.clone(), qcbf_relative_path.clone(), &state).unwrap();

    // 2. Perform first join (clinical covariates)
    execute_join_impl(
        project_root.clone(),
        qcbf_relative_path.clone(),
        ext_path_1.to_string_lossy().to_string(),
        vec![JoinKeyPair {
            left: "participant_id".to_string(),
            right: "participant_id".to_string(),
        }],
        true,
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    // 3. Now run sanity check for a DIFFERENT join (demographics.tsv)
    // This sanity check should run against the raw qCBF rows, NOT the merged rows!
    let sanity = check_join_sanity_impl(
        project_root,
        qcbf_relative_path,
        ext_path_2.to_string_lossy().to_string(),
        vec![
            JoinKeyPair {
                left: "subject".to_string(),
                right: "Subject".to_string(),
            },
            JoinKeyPair {
                left: "session".to_string(),
                right: "Session".to_string(),
            },
        ],
        default_na_tokens(),
        None,
        None,
        &state,
    )
    .unwrap();

    // If leakage occurred, sanity check would read the merged rows (which has 8 rows but with collision suffixes/merged fields)
    // or could fail sanity expectations.
    // It should successfully overlap exactly 8 rows.
    assert_eq!(sanity.overlap_count, 8);
    assert_eq!(sanity.unmatched_left_count, 0);
    assert!(sanity.left_keys_unique);
}
