//! Join-key normalization, join sanity checks, and metadata left joins.

use anyhow::{Context, Result as AnyResult, bail};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::State;

use super::data::{ActiveData, ColumnMetadata, ColumnSource, DataInspection};
use super::external::{
    detect_delimiter, inspect_external_data_impl, parse_external_rows, parse_external_xlsx_rows,
};
use super::stats::load_qcbf_data_impl;
use crate::error::{CommandError, IntoCommandResult};

fn normalize_key_val(val: &str) -> String {
    let trimmed = val.trim();
    let lower = trimmed.to_lowercase();
    if let Some(stripped) = lower.strip_prefix("sub-") {
        stripped.to_string()
    } else {
        lower
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct JoinKeyPair {
    pub left: String,
    pub right: String,
}

#[allow(clippy::too_many_arguments)]
pub fn execute_join_impl(
    project_root: PathBuf,
    qcbf_relative_path: String,
    external_absolute_path: String,
    keys: Vec<JoinKeyPair>,
    drop_right_on: bool,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    delimiter: Option<String>,
    state: &crate::app::state::AppState,
) -> AnyResult<DataInspection> {
    let left_on: Vec<String> = keys.iter().map(|k| k.left.clone()).collect();
    let right_on: Vec<String> = keys.iter().map(|k| k.right.clone()).collect();

    let ext_path = PathBuf::from(&external_absolute_path);
    if !ext_path.exists() {
        bail!("External file not found: {}", external_absolute_path);
    }

    let qcbf_inspection = load_qcbf_data_impl(project_root, qcbf_relative_path, state)?;
    let qcbf_hash = qcbf_inspection.qcbf_hash.clone();
    let qcbf_rows = {
        let guard = state
            .active_data
            .lock()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        guard
            .as_ref()
            .context("qCBF cache missing after load")?
            .rows
            .clone()
    };

    let ext_inspection = inspect_external_data_impl(
        external_absolute_path.clone(),
        sheet_name.clone(),
        delimiter.clone(),
    )?;
    let external_hash = ext_inspection.file_hash.clone();

    let extension = ext_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let parsed_delimiter = match delimiter.as_deref() {
        Some(",") => Some(','),
        Some(";") => Some(';'),
        Some("\t") => Some('\t'),
        _ => None,
    };

    let ext_rows: Vec<HashMap<String, String>> = match extension.as_str() {
        "tsv" => parse_external_rows(&ext_path, '\t', &na_tokens)?,
        "csv" => {
            let delim_char = if let Some(d) = parsed_delimiter {
                d
            } else {
                let text = std::fs::read_to_string(&ext_path)?;
                let first_line = text.lines().next().unwrap_or("");
                detect_delimiter(first_line)
            };
            parse_external_rows(&ext_path, delim_char, &na_tokens)?
        }
        "xlsx" => parse_external_xlsx_rows(&ext_path, sheet_name, &na_tokens)?,
        _ => bail!("Unsupported file format: .{}", extension),
    };

    let mut ext_index: HashMap<Vec<String>, Vec<&HashMap<String, String>>> = HashMap::new();
    for row in &ext_rows {
        let key: Vec<String> = right_on
            .iter()
            .filter_map(|col| row.get(col).map(|val| normalize_key_val(val)))
            .collect();
        ext_index.entry(key).or_default().push(row);
    }

    let qcbf_names: Vec<String> = qcbf_inspection
        .columns
        .iter()
        .map(|c| c.name.clone())
        .collect();
    let ext_names: Vec<String> = ext_inspection
        .columns
        .iter()
        .map(|c| c.name.clone())
        .collect();
    let qcbf_names_set: HashSet<&String> = qcbf_names.iter().collect();
    let surviving_ext: HashSet<&String> = ext_names
        .iter()
        .filter(|n| !(drop_right_on && right_on.contains(n)))
        .collect();

    let qcbf_rename: HashMap<String, String> = qcbf_inspection
        .columns
        .iter()
        .filter_map(|c| {
            if surviving_ext.contains(&c.name) && !left_on.contains(&c.name) {
                Some((c.name.clone(), format!("{}_x", c.name)))
            } else {
                None
            }
        })
        .collect();

    let ext_cols_final: Vec<(String, String)> = ext_inspection
        .columns
        .iter()
        .filter_map(|c| {
            if drop_right_on && right_on.contains(&c.name) {
                return None;
            }
            let final_name = if qcbf_names_set.contains(&c.name) {
                format!("{}_y", c.name)
            } else {
                c.name.clone()
            };
            Some((c.name.clone(), final_name))
        })
        .collect();

    let mut merged_rows: Vec<HashMap<String, String>> = Vec::new();
    for qcbf_row in &qcbf_rows {
        let key: Vec<String> = left_on
            .iter()
            .filter_map(|col| qcbf_row.get(col).map(|val| normalize_key_val(val)))
            .collect();
        let matches = ext_index.get(&key);
        if let Some(matched) = matches {
            for ext_row in matched {
                let mut merged = HashMap::new();
                for (k, v) in qcbf_row.iter() {
                    let final_name = qcbf_rename.get(k).cloned().unwrap_or_else(|| k.clone());
                    merged.insert(final_name, v.clone());
                }
                for (orig, final_name) in &ext_cols_final {
                    let val = ext_row.get(orig).cloned().unwrap_or_default();
                    merged.insert(final_name.clone(), val);
                }
                merged_rows.push(merged);
            }
        } else {
            let mut merged = HashMap::new();
            for (k, v) in qcbf_row.iter() {
                let final_name = qcbf_rename.get(k).cloned().unwrap_or_else(|| k.clone());
                merged.insert(final_name, v.clone());
            }
            for (_, final_name) in &ext_cols_final {
                merged.insert(final_name.clone(), String::new());
            }
            merged_rows.push(merged);
        }
    }

    let mut merged_columns: Vec<ColumnMetadata> = Vec::new();
    for col in &qcbf_inspection.columns {
        let final_name = qcbf_rename
            .get(&col.name)
            .cloned()
            .unwrap_or_else(|| col.name.clone());
        merged_columns.push(ColumnMetadata {
            name: final_name,
            original_name: col.original_name.clone(),
            source: col.source.clone(),
            units: col.units.clone(),
            inferred_type: col.inferred_type.clone(),
            levels: col.levels.clone(),
            is_identifier: col.is_identifier,
        });
    }
    for col in &ext_inspection.columns {
        if drop_right_on && right_on.contains(&col.name) {
            continue;
        }
        let final_name = if qcbf_names_set.contains(&col.name) {
            format!("{}_y", col.name)
        } else {
            col.name.clone()
        };
        merged_columns.push(ColumnMetadata {
            name: final_name,
            original_name: col.name.clone(),
            source: ColumnSource::External,
            units: String::new(),
            inferred_type: col.inferred_type.clone(),
            levels: col.levels.clone(),
            is_identifier: false,
        });
    }

    let row_count = merged_rows.len();
    let active = ActiveData {
        rows: merged_rows,
        columns: merged_columns.clone(),
        row_count,
        qcbf_row_count: qcbf_inspection.row_count,
        qcbf_hash: qcbf_hash.clone(),
        external_hash: Some(external_hash.clone()),
        qcbf_rows,
    };
    *state
        .active_data
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))? = Some(active);

    Ok(DataInspection {
        columns: merged_columns,
        row_count,
        qcbf_row_count: qcbf_inspection.row_count,
        qcbf_hash,
        external_hash: Some(external_hash),
    })
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SanityCheckResult {
    #[specta(type = specta_typescript::Number)]
    pub overlap_count: usize,
    #[specta(type = specta_typescript::Number)]
    pub unmatched_left_count: usize,
    pub left_keys_unique: bool,
    pub right_keys_unique: bool,
}

#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn check_join_sanity_impl(
    _project_root: PathBuf,
    _qcbf_relative_path: String,
    external_absolute_path: String,
    keys: Vec<JoinKeyPair>,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    delimiter: Option<String>,
    state: &crate::app::state::AppState,
) -> AnyResult<SanityCheckResult> {
    let left_on: Vec<String> = keys.iter().map(|k| k.left.clone()).collect();
    let right_on: Vec<String> = keys.iter().map(|k| k.right.clone()).collect();

    let qcbf_rows: Vec<HashMap<String, String>> = {
        let guard = state
            .active_data
            .lock()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        guard
            .as_ref()
            .context("No qCBF data loaded. Select a file first.")?
            .qcbf_rows
            .clone()
    };

    let ext_path = PathBuf::from(&external_absolute_path);
    if !ext_path.exists() {
        bail!("External file not found: {}", external_absolute_path);
    }
    let extension = ext_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let parsed_delimiter = match delimiter.as_deref() {
        Some(",") => Some(','),
        Some(";") => Some(';'),
        Some("\t") => Some('\t'),
        _ => None,
    };

    let ext_rows: Vec<HashMap<String, String>> = match extension.as_str() {
        "tsv" => parse_external_rows(&ext_path, '\t', &na_tokens)?,
        "csv" => {
            let delim_char = if let Some(d) = parsed_delimiter {
                d
            } else {
                let text = std::fs::read_to_string(&ext_path)?;
                let first_line = text.lines().next().unwrap_or("");
                detect_delimiter(first_line)
            };
            parse_external_rows(&ext_path, delim_char, &na_tokens)?
        }
        "xlsx" => parse_external_xlsx_rows(&ext_path, sheet_name, &na_tokens)?,
        _ => bail!("Unsupported file format: .{}", extension),
    };

    let mut right_key_counts: HashMap<Vec<String>, usize> = HashMap::new();
    for row in &ext_rows {
        let key: Vec<String> = right_on
            .iter()
            .filter_map(|col| row.get(col).map(|val| normalize_key_val(val)))
            .collect();
        *right_key_counts.entry(key).or_default() += 1;
    }

    let mut left_key_counts: HashMap<Vec<String>, usize> = HashMap::new();
    for row in &qcbf_rows {
        let key: Vec<String> = left_on
            .iter()
            .filter_map(|col| row.get(col).map(|val| normalize_key_val(val)))
            .collect();
        *left_key_counts.entry(key).or_default() += 1;
    }

    let left_keys_unique = left_key_counts.values().all(|&c| c == 1);
    let right_keys_unique = right_key_counts.values().all(|&c| c == 1);

    let mut overlap_count = 0;
    let mut unmatched_left_count = 0;
    for (left_key, count) in &left_key_counts {
        if right_key_counts.contains_key(left_key) {
            overlap_count += 1;
        } else {
            unmatched_left_count += count;
        }
    }

    Ok(SanityCheckResult {
        overlap_count,
        unmatched_left_count,
        left_keys_unique,
        right_keys_unique,
    })
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn check_join_sanity(
    project_root: String,
    qcbf_relative_path: String,
    external_absolute_path: String,
    keys: Vec<JoinKeyPair>,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    delimiter: Option<String>,
    state: State<'_, crate::app::state::AppState>,
) -> Result<SanityCheckResult, CommandError> {
    check_join_sanity_impl(
        PathBuf::from(project_root),
        qcbf_relative_path,
        external_absolute_path,
        keys,
        na_tokens,
        sheet_name,
        delimiter,
        &state,
    )
    .into_command_result()
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn execute_join(
    project_root: String,
    qcbf_relative_path: String,
    external_absolute_path: String,
    keys: Vec<JoinKeyPair>,
    drop_right_on: bool,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    delimiter: Option<String>,
    state: State<'_, crate::app::state::AppState>,
) -> Result<DataInspection, CommandError> {
    execute_join_impl(
        PathBuf::from(project_root),
        qcbf_relative_path,
        external_absolute_path,
        keys,
        drop_right_on,
        na_tokens,
        sheet_name,
        delimiter,
        &state,
    )
    .into_command_result()
}
