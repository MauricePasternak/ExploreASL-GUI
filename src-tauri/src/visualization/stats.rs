//! Stats-file discovery and qCBF parsing/loading.
//! GUI/BIDS Session = ExploreASL Visit, taken from the participant_id suffix.
//! GUI/BIDS Run = ExploreASL Session, taken from the stats session column.

use anyhow::{Context, Result as AnyResult, bail};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;
use tauri::State;

use super::data::{
    ActiveData, ColumnMetadata, ColumnSource, DataInspection, infer_type, is_missing_value,
};
use crate::error::IntoCommandResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsFileInfo {
    pub file_name: String,
    pub relative_path: String,
    pub size: u64,
    pub modified: String,
}

pub fn list_stats_files_impl(project_root: PathBuf) -> AnyResult<Vec<StatsFileInfo>> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    if !stats_dir.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in std::fs::read_dir(&stats_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "tsv").unwrap_or(false) {
            let file_name = path.file_name().unwrap().to_string_lossy().to_string();
            if file_name.starts_with("mean_")
                || file_name.starts_with("median_")
                || file_name.starts_with("CoV_")
            {
                let meta = entry.metadata()?;
                files.push(StatsFileInfo {
                    file_name: file_name.clone(),
                    relative_path: file_name,
                    size: meta.len(),
                    modified: meta
                        .modified()
                        .map(|t| {
                            t.duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_secs().to_string())
                                .unwrap_or_default()
                        })
                        .unwrap_or_default(),
                });
            }
        }
    }
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(files)
}

#[tauri::command]
pub async fn list_stats_files(project_root: String) -> Result<Vec<StatsFileInfo>, String> {
    list_stats_files_impl(PathBuf::from(project_root)).into_command_result()
}

fn detect_units_row(lines: &[&str], headers: &[String]) -> bool {
    if lines.len() <= 1 {
        return false;
    }
    let second_row: Vec<&str> = lines[1].split('\t').map(|s| s.trim()).collect();
    if second_row.len() != headers.len() {
        return false;
    }
    let candidate_units: Vec<&&str> = second_row.iter().filter(|v| !v.is_empty()).collect();
    if candidate_units.is_empty() {
        return false;
    }
    let unit_like = candidate_units
        .iter()
        .filter(|v| {
            v.len() < 20
                && v.parse::<f64>().is_err()
                && !v.starts_with("sub-")
                && !is_missing_value(v)
        })
        .count();
    unit_like > candidate_units.len() / 2
}

pub fn load_qcbf_data_impl(
    project_root: PathBuf,
    relative_path: String,
    state: &crate::app::state::AppState,
) -> AnyResult<DataInspection> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    let file_path = stats_dir.join(&relative_path);

    let canonical = std::fs::canonicalize(&file_path).context("Path not found")?;
    let canonical_stats = std::fs::canonicalize(&stats_dir)?;
    if !canonical.starts_with(&canonical_stats) {
        bail!("Path traversal detected");
    }

    let mut file = std::fs::File::open(&canonical)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    let contents = contents.trim_start_matches('\u{FEFF}');

    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    let qcbf_hash = format!("{:x}", hasher.finalize());

    let lines: Vec<&str> = contents.lines().collect();
    if lines.is_empty() {
        bail!("File is empty");
    }

    let headers: Vec<String> = lines[0].split('\t').map(|s| s.trim().to_string()).collect();
    let has_units_row = detect_units_row(&lines, &headers);
    let data_start = if has_units_row { 2 } else { 1 };
    let units_row: Vec<String> = if has_units_row {
        lines[1].split('\t').map(|s| s.trim().to_string()).collect()
    } else {
        vec!["".to_string(); headers.len()]
    };
    let row_count = lines.len().saturating_sub(data_start);

    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    for line in &lines[data_start..] {
        let cells: Vec<&str> = line.split('\t').map(|s| s.trim()).collect();
        for (i, cell) in cells.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(cell.to_string());
            }
        }
    }

    let mut columns: Vec<ColumnMetadata> = Vec::new();
    let has_participant_id = headers.contains(&"participant_id".to_string());
    let has_session = headers.contains(&"session".to_string());

    for (i, header) in headers.iter().enumerate() {
        if header == "session" || header == "subject" || header == "run" {
            continue;
        }
        let is_id = header == "participant_id";
        let inferred = if is_id {
            "nominal".to_string()
        } else if header == "LongitudinalTimePoint" {
            "ordinal".to_string()
        } else if header == "GM_vol"
            || header == "WM_vol"
            || header == "CSF_vol"
            || header == "GM_ICVRatio"
            || header == "GMWM_ICVRatio"
            || header == "MeanMotion"
            || header == "SubjectNList"
            || header.ends_with("_L")
            || header.ends_with("_R")
            || header.ends_with("_B")
        {
            "continuous".to_string()
        } else {
            infer_type(&column_values[i])
        };
        let levels = if inferred != "continuous" {
            let mut seen = HashSet::new();
            let mut levels = Vec::new();
            for val in &column_values[i] {
                if !is_missing_value(val) && seen.insert(val.clone()) {
                    levels.push(val.clone());
                }
            }
            levels
        } else {
            vec![]
        };

        columns.push(ColumnMetadata {
            name: header.clone(),
            original_name: header.clone(),
            source: ColumnSource::Qcbf,
            units: units_row.get(i).cloned().unwrap_or_default(),
            inferred_type: inferred,
            levels,
            is_identifier: is_id,
        });
    }

    if has_participant_id {
        let pid_idx = headers
            .iter()
            .position(|h| h == "participant_id")
            .expect("participant_id verified to exist");
        let pid_values = &column_values[pid_idx];

        let subject_values: Vec<String> = pid_values
            .iter()
            .map(|v| {
                if let Some(pos) = v.rfind('_') {
                    v[..pos].to_string()
                } else {
                    v.clone()
                }
            })
            .collect();
        let mut subject_levels = HashSet::new();
        let mut subject_level_list = Vec::new();
        for val in &subject_values {
            if !is_missing_value(val) && subject_levels.insert(val.clone()) {
                subject_level_list.push(val.clone());
            }
        }
        columns.push(ColumnMetadata {
            name: "subject".to_string(),
            original_name: "subject".to_string(),
            source: ColumnSource::Qcbf,
            units: String::new(),
            inferred_type: "nominal".to_string(),
            levels: subject_level_list,
            is_identifier: true,
        });

        let session_parsed: Vec<String> = pid_values
            .iter()
            .map(|v| {
                if let Some(pos) = v.rfind('_') {
                    v[pos + 1..].to_string()
                } else {
                    String::new()
                }
            })
            .collect();
        let mut session_levels = HashSet::new();
        let mut session_level_list = Vec::new();
        for val in &session_parsed {
            if !is_missing_value(val) && session_levels.insert(val.clone()) {
                session_level_list.push(val.clone());
            }
        }
        columns.push(ColumnMetadata {
            name: "session".to_string(),
            original_name: "session".to_string(),
            source: ColumnSource::Qcbf,
            units: String::new(),
            inferred_type: "nominal".to_string(),
            levels: session_level_list,
            is_identifier: true,
        });
    }

    if has_session {
        let session_idx = headers
            .iter()
            .position(|h| h == "session")
            .expect("session verified to exist");
        let run_values = &column_values[session_idx];

        let mut run_levels = HashSet::new();
        let mut run_level_list = Vec::new();
        for val in run_values {
            if !is_missing_value(val) && run_levels.insert(val.clone()) {
                run_level_list.push(val.clone());
            }
        }
        columns.push(ColumnMetadata {
            name: "run".to_string(),
            original_name: "run".to_string(),
            source: ColumnSource::Qcbf,
            units: String::new(),
            inferred_type: "nominal".to_string(),
            levels: run_level_list,
            is_identifier: true,
        });
    }

    let mut rows: Vec<HashMap<String, String>> = Vec::new();
    let pid_idx = headers.iter().position(|h| h == "participant_id");
    let session_idx = headers.iter().position(|h| h == "session");
    for line in &lines[data_start..] {
        let cells: Vec<&str> = line.split('\t').map(|s| s.trim()).collect();
        let mut row = HashMap::new();
        if let Some(idx) = pid_idx
            && idx < cells.len()
        {
            let pid_val = cells[idx].to_string();
            row.insert("participant_id".to_string(), pid_val.clone());
            if let Some(pos) = pid_val.rfind('_') {
                row.insert("subject".to_string(), pid_val[..pos].to_string());
                row.insert("session".to_string(), pid_val[pos + 1..].to_string());
            } else {
                row.insert("subject".to_string(), pid_val.clone());
                row.insert("session".to_string(), String::new());
            }
        }
        if let Some(idx) = session_idx
            && idx < cells.len()
        {
            row.insert("run".to_string(), cells[idx].to_string());
        }
        for (i, header) in headers.iter().enumerate() {
            if header == "session"
                || header == "subject"
                || header == "run"
                || header == "participant_id"
            {
                continue;
            }
            if i < cells.len() {
                row.insert(header.clone(), cells[i].to_string());
            }
        }
        rows.push(row);
    }

    let active = ActiveData {
        rows: rows.clone(),
        columns: columns.clone(),
        row_count,
        qcbf_row_count: row_count,
        qcbf_hash: qcbf_hash.clone(),
        external_hash: None,
        qcbf_rows: rows,
    };
    *state
        .active_data
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))? = Some(active);

    Ok(DataInspection {
        columns,
        row_count,
        qcbf_row_count: row_count,
        qcbf_hash,
        external_hash: None,
    })
}

#[tauri::command]
pub async fn load_qcbf_data(
    project_root: String,
    relative_path: String,
    state: State<'_, crate::app::state::AppState>,
) -> Result<DataInspection, String> {
    load_qcbf_data_impl(PathBuf::from(project_root), relative_path, &state).into_command_result()
}
