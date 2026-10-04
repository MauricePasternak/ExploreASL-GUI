//! Loaded rows, column metadata and inference, and cached column reads.

use anyhow::{Context, Result as AnyResult};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::error::IntoCommandResult;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnSource {
    Qcbf,
    External,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMetadata {
    pub name: String,
    pub original_name: String,
    pub source: ColumnSource,
    pub units: String,
    pub inferred_type: String,
    pub levels: Vec<String>,
    pub is_identifier: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveData {
    pub rows: Vec<HashMap<String, String>>,
    pub columns: Vec<ColumnMetadata>,
    pub row_count: usize,
    pub qcbf_row_count: usize,
    pub qcbf_hash: String,
    pub external_hash: Option<String>,
    pub qcbf_rows: Vec<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInspection {
    pub columns: Vec<ColumnMetadata>,
    pub row_count: usize,
    pub qcbf_row_count: usize,
    pub qcbf_hash: String,
    pub external_hash: Option<String>,
}

impl ActiveData {
    pub fn to_inspection(&self) -> DataInspection {
        DataInspection {
            columns: self.columns.clone(),
            row_count: self.row_count,
            qcbf_row_count: self.qcbf_row_count,
            qcbf_hash: self.qcbf_hash.clone(),
            external_hash: self.external_hash.clone(),
        }
    }
}

pub(super) fn is_missing_value(val: &str) -> bool {
    val.is_empty()
        || val.eq_ignore_ascii_case("nan")
        || val.eq_ignore_ascii_case("na")
        || val.eq_ignore_ascii_case("n/a")
}

pub(super) fn infer_type(values: &[String]) -> String {
    let non_missing: Vec<&str> = values
        .iter()
        .filter(|v| !is_missing_value(v))
        .map(|s| s.as_str())
        .collect();
    if non_missing.is_empty() {
        return "nominal".to_string();
    }
    let all_float = non_missing.iter().all(|v| v.parse::<f64>().is_ok());
    if all_float {
        "continuous".to_string()
    } else {
        "nominal".to_string()
    }
}

pub fn read_data_columns_impl(
    column_names: Vec<String>,
    state: &crate::app::state::AppState,
) -> AnyResult<Vec<HashMap<String, String>>> {
    let guard = state
        .active_data
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let active = guard
        .as_ref()
        .context("No data loaded. Select a file first.")?;

    let id_cols = ["participant_id", "subject", "session", "run"];
    let mut rows = Vec::with_capacity(active.rows.len());
    for row in &active.rows {
        let mut filtered = HashMap::new();
        for id_col in &id_cols {
            if let Some(val) = row.get(*id_col) {
                filtered.insert((*id_col).to_string(), val.clone());
            }
        }
        for name in &column_names {
            if !id_cols.contains(&name.as_str())
                && let Some(val) = row.get(name)
            {
                filtered.insert(name.clone(), val.clone());
            }
        }
        rows.push(filtered);
    }
    Ok(rows)
}

#[tauri::command]
pub async fn read_data_columns(
    _project_root: String,
    column_names: Vec<String>,
    state: State<'_, crate::app::state::AppState>,
) -> Result<Vec<HashMap<String, String>>, String> {
    read_data_columns_impl(column_names, &state).into_command_result()
}
