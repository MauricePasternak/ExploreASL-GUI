use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Serialize)]
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
    pub qcbf_hash: String,
    pub external_hash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInspection {
    pub columns: Vec<ColumnMetadata>,
    pub row_count: usize,
    pub qcbf_hash: String,
    pub external_hash: Option<String>,
}

impl ActiveData {
    pub fn to_inspection(&self) -> DataInspection {
        DataInspection {
            columns: self.columns.clone(),
            row_count: self.row_count,
            qcbf_hash: self.qcbf_hash.clone(),
            external_hash: self.external_hash.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsFileInfo {
    pub file_name: String,
    pub relative_path: String,
    pub size: u64,
    pub modified: String,
}

pub fn list_stats_files_impl(project_root: PathBuf) -> Result<Vec<StatsFileInfo>, String> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    if !stats_dir.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in std::fs::read_dir(&stats_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map(|e| e == "tsv").unwrap_or(false) {
            let file_name = path.file_name().unwrap().to_string_lossy().to_string();
            if file_name.starts_with("mean_")
                || file_name.starts_with("median_")
                || file_name.starts_with("CoV_")
            {
                let meta = entry.metadata().map_err(|e| e.to_string())?;
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
    list_stats_files_impl(PathBuf::from(project_root))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TsvColumnMetadata {
    pub name: String,
    pub units: String,
    pub inferred_type: String,
    pub levels: Vec<String>,
    pub is_identifier: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TsvInspection {
    pub columns: Vec<TsvColumnMetadata>,
    pub row_count: usize,
    pub file_hash: String,
}

fn is_missing_value(val: &str) -> bool {
    val.is_empty()
        || val.eq_ignore_ascii_case("nan")
        || val.eq_ignore_ascii_case("na")
        || val.eq_ignore_ascii_case("n/a")
}

fn infer_type(values: &[String]) -> String {
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

pub fn inspect_tsv_impl(
    project_root: PathBuf,
    relative_path: String,
) -> Result<TsvInspection, String> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    let file_path = stats_dir.join(&relative_path);

    let canonical =
        std::fs::canonicalize(&file_path).map_err(|e| format!("Path not found: {}", e))?;
    let canonical_stats = std::fs::canonicalize(&stats_dir).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_stats) {
        return Err("Path traversal detected".to_string());
    }

    let mut file = std::fs::File::open(&canonical).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let contents = contents.trim_start_matches('\u{FEFF}');

    // SHA-256 hash
    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    let file_hash = format!("{:x}", hasher.finalize());

    let lines: Vec<&str> = contents.lines().collect();
    if lines.is_empty() {
        return Err("File is empty".to_string());
    }

    // Parse header
    let headers: Vec<String> = lines[0].split('\t').map(|s| s.trim().to_string()).collect();

    let has_units_row = detect_units_row(&lines, &headers);

    let data_start = if has_units_row { 2 } else { 1 };
    let units_row: Vec<String> = if has_units_row {
        lines[1].split('\t').map(|s| s.trim().to_string()).collect()
    } else {
        vec!["".to_string(); headers.len()]
    };

    let row_count = lines.len().saturating_sub(data_start);

    // Collect column values for type inference
    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    for line in &lines[data_start..] {
        let cells: Vec<&str> = line.split('\t').map(|s| s.trim()).collect();
        for (i, cell) in cells.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(cell.to_string());
            }
        }
    }

    // Build column metadata for original columns
    let mut columns: Vec<TsvColumnMetadata> = Vec::new();

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

        columns.push(TsvColumnMetadata {
            name: header.clone(),
            units: units_row.get(i).cloned().unwrap_or_default(),
            inferred_type: inferred,
            levels,
            is_identifier: is_id,
        });
    }

    // Add parsed identifier columns from participant_id
    if has_participant_id {
        let pid_idx = headers
            .iter()
            .position(|h| h == "participant_id")
            .expect("participant_id verified to exist");
        let pid_values = &column_values[pid_idx];

        // subject column — strip last _XX from participant_id
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

        columns.push(TsvColumnMetadata {
            name: "subject".to_string(),
            units: String::new(),
            inferred_type: "nominal".to_string(),
            levels: subject_level_list,
            is_identifier: true,
        });

        // session column — the XX part after last underscore
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

        columns.push(TsvColumnMetadata {
            name: "session".to_string(),
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

        columns.push(TsvColumnMetadata {
            name: "run".to_string(),
            units: String::new(),
            inferred_type: "nominal".to_string(),
            levels: run_level_list,
            is_identifier: true,
        });
    }

    Ok(TsvInspection {
        columns,
        row_count,
        file_hash,
    })
}

#[tauri::command]
pub async fn inspect_tsv(
    project_root: String,
    relative_path: String,
) -> Result<TsvInspection, String> {
    inspect_tsv_impl(PathBuf::from(project_root), relative_path)
}

pub fn load_qcbf_data_impl(
    project_root: PathBuf,
    relative_path: String,
    state: &crate::import::AppState,
) -> Result<DataInspection, String> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    let file_path = stats_dir.join(&relative_path);

    let canonical =
        std::fs::canonicalize(&file_path).map_err(|e| format!("Path not found: {}", e))?;
    let canonical_stats = std::fs::canonicalize(&stats_dir).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_stats) {
        return Err("Path traversal detected".to_string());
    }

    let mut file = std::fs::File::open(&canonical).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let contents = contents.trim_start_matches('\u{FEFF}');

    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    let qcbf_hash = format!("{:x}", hasher.finalize());

    let lines: Vec<&str> = contents.lines().collect();
    if lines.is_empty() {
        return Err("File is empty".to_string());
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
        if let Some(idx) = pid_idx {
            if idx < cells.len() {
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
        }
        if let Some(idx) = session_idx {
            if idx < cells.len() {
                row.insert("run".to_string(), cells[idx].to_string());
            }
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
        rows,
        columns: columns.clone(),
        row_count,
        qcbf_hash: qcbf_hash.clone(),
        external_hash: None,
    };
    *state.active_data.lock().map_err(|e| e.to_string())? = Some(active);

    Ok(DataInspection {
        columns,
        row_count,
        qcbf_hash,
        external_hash: None,
    })
}

#[tauri::command]
pub async fn load_qcbf_data(
    project_root: String,
    relative_path: String,
    state: State<'_, crate::import::AppState>,
) -> Result<DataInspection, String> {
    load_qcbf_data_impl(PathBuf::from(project_root), relative_path, &state)
}

pub fn read_tsv_columns_impl(
    project_root: PathBuf,
    relative_path: String,
    column_names: Vec<String>,
) -> Result<Vec<HashMap<String, String>>, String> {
    let stats_dir = project_root.join("derivatives/ExploreASL/Population/Stats");
    let file_path = stats_dir.join(&relative_path);

    let canonical =
        std::fs::canonicalize(&file_path).map_err(|e| format!("Path not found: {}", e))?;
    let canonical_stats = std::fs::canonicalize(&stats_dir).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_stats) {
        return Err("Path traversal detected".to_string());
    }

    let mut file = std::fs::File::open(&canonical).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let contents = contents.trim_start_matches('\u{FEFF}');

    let lines: Vec<&str> = contents.lines().collect();
    if lines.is_empty() {
        return Ok(vec![]);
    }

    let headers: Vec<String> = lines[0].split('\t').map(|s| s.trim().to_string()).collect();

    // Check if second row is units row
    let has_units_row = detect_units_row(&lines, &headers);

    let data_start = if has_units_row { 2 } else { 1 };

    // Find indices for requested columns + identifiers
    let pid_idx = headers.iter().position(|h| h == "participant_id");
    let session_idx = headers.iter().position(|h| h == "session");

    let requested_indices: Vec<(String, usize)> = column_names
        .iter()
        .filter(|name| *name != "session" && *name != "subject" && *name != "run")
        .filter_map(|name| {
            headers
                .iter()
                .position(|h| h == name)
                .map(|idx| (name.clone(), idx))
        })
        .collect();

    let mut rows = Vec::new();
    for line in &lines[data_start..] {
        let cells: Vec<&str> = line.split('\t').map(|s| s.trim()).collect();
        let mut row = HashMap::new();

        // Always include participant_id
        if let Some(idx) = pid_idx {
            if idx < cells.len() {
                row.insert("participant_id".to_string(), cells[idx].to_string());
            }
        }

        // Parse subject and session from participant_id
        if let Some(pid_val) = row.get("participant_id").cloned() {
            if let Some(pos) = pid_val.rfind('_') {
                row.insert("subject".to_string(), pid_val[..pos].to_string());
                row.insert("session".to_string(), pid_val[pos + 1..].to_string());
            } else {
                row.insert("subject".to_string(), pid_val.clone());
                row.insert("session".to_string(), String::new());
            }
        }

        // Map TSV session -> run
        if let Some(idx) = session_idx {
            if idx < cells.len() {
                row.insert("run".to_string(), cells[idx].to_string());
            }
        }

        // Include requested columns
        for (name, idx) in &requested_indices {
            if *idx < cells.len() {
                row.insert(name.clone(), cells[*idx].to_string());
            }
        }

        rows.push(row);
    }

    Ok(rows)
}

#[tauri::command]
pub async fn read_tsv_columns(
    project_root: String,
    relative_path: String,
    column_names: Vec<String>,
) -> Result<Vec<HashMap<String, String>>, String> {
    read_tsv_columns_impl(PathBuf::from(project_root), relative_path, column_names)
}

pub fn read_data_columns_impl(
    column_names: Vec<String>,
    state: &crate::import::AppState,
) -> Result<Vec<HashMap<String, String>>, String> {
    let guard = state.active_data.lock().map_err(|e| e.to_string())?;
    let active = guard
        .as_ref()
        .ok_or("No data loaded. Select a file first.")?;

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
            if !id_cols.contains(&name.as_str()) {
                if let Some(val) = row.get(name) {
                    filtered.insert(name.clone(), val.clone());
                }
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
    state: State<'_, crate::import::AppState>,
) -> Result<Vec<HashMap<String, String>>, String> {
    read_data_columns_impl(column_names, &state)
}

pub fn set_active_project_impl(
    root_path: String,
    state: &crate::import::AppState,
) -> Result<(), String> {
    let path = std::fs::canonicalize(&root_path).map_err(|e| {
        log::error!("set_active_project failed canonicalizing: {}", e);
        format!("Invalid project path: {}", e)
    })?;
    *state
        .active_project_root
        .lock()
        .map_err(|e| e.to_string())? = Some(path);
    *state.active_data.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn set_active_project(
    root_path: String,
    state: State<'_, crate::import::AppState>,
) -> Result<(), String> {
    let _trace = crate::tracing::CommandTrace::new("set_active_project");
    log::info!("set_active_project: root_path = {}", root_path);
    set_active_project_impl(root_path, &state)?;
    log::info!("set_active_project success");
    Ok(())
}

pub fn clear_active_project_impl(state: &crate::import::AppState) -> Result<(), String> {
    *state
        .active_project_root
        .lock()
        .map_err(|e| e.to_string())? = None;
    *state.active_data.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn clear_active_project(state: State<'_, crate::import::AppState>) -> Result<(), String> {
    let _trace = crate::tracing::CommandTrace::new("clear_active_project");
    log::info!("clear_active_project");
    clear_active_project_impl(&state)?;
    log::info!("clear_active_project success");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalColumnMetadata {
    pub name: String,
    pub inferred_type: String,
    pub levels: Vec<String>,
    pub is_identifier: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDataInspection {
    pub columns: Vec<ExternalColumnMetadata>,
    pub row_count: usize,
    pub file_hash: String,
    pub sheet_name: Option<String>,
}

fn detect_delimiter(first_line: &str) -> char {
    let comma_count = first_line.matches(',').count();
    let semicolon_count = first_line.matches(';').count();
    let tab_count = first_line.matches('\t').count();
    if semicolon_count > comma_count && semicolon_count > tab_count {
        ';'
    } else if tab_count > comma_count && tab_count > semicolon_count {
        '\t'
    } else {
        ','
    }
}

fn build_external_columns(
    headers: &[String],
    column_values: &[Vec<String>],
) -> Vec<ExternalColumnMetadata> {
    let mut columns = Vec::new();
    for (i, header) in headers.iter().enumerate() {
        let values = column_values.get(i).map(|v| v.as_slice()).unwrap_or(&[]);
        let inferred = infer_type(values);
        let levels = if inferred != "continuous" {
            let mut seen = HashSet::new();
            let mut levels = Vec::new();
            for val in values {
                if !is_missing_value(val) && seen.insert(val.clone()) {
                    levels.push(val.clone());
                }
            }
            levels
        } else {
            vec![]
        };
        columns.push(ExternalColumnMetadata {
            name: header.clone(),
            inferred_type: inferred,
            levels,
            is_identifier: false,
        });
    }
    columns
}

pub fn inspect_external_data_impl(
    absolute_path: String,
    sheet_name: Option<String>,
) -> Result<ExternalDataInspection, String> {
    let path = PathBuf::from(&absolute_path);
    if !path.exists() {
        return Err(format!("File not found: {}", absolute_path));
    }
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents).map_err(|e| e.to_string())?;

    let mut hasher = Sha256::new();
    hasher.update(&contents);
    let file_hash = format!("{:x}", hasher.finalize());

    match extension.as_str() {
        "tsv" => parse_external_delimited(&contents, '\t', file_hash),
        "csv" => {
            let text = String::from_utf8_lossy(&contents);
            let first_line = text.lines().next().unwrap_or("");
            let delimiter = detect_delimiter(first_line);
            parse_external_delimited(&contents, delimiter, file_hash)
        }
        "xlsx" => parse_external_xlsx(&path, sheet_name, file_hash),
        _ => Err(format!("Unsupported file format: .{}", extension)),
    }
}

fn parse_external_delimited(
    contents: &[u8],
    delimiter: char,
    file_hash: String,
) -> Result<ExternalDataInspection, String> {
    let text = String::from_utf8_lossy(contents);
    let text = text.trim_start_matches('\u{FEFF}');

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter as u8)
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|s| s.trim().to_string())
        .collect();

    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    let mut row_count = 0;
    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        row_count += 1;
        for (i, field) in record.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(field.trim().to_string());
            }
        }
    }

    let columns = build_external_columns(&headers, &column_values);

    Ok(ExternalDataInspection {
        columns,
        row_count,
        file_hash,
        sheet_name: None,
    })
}

fn parse_external_xlsx(
    path: &Path,
    sheet_name: Option<String>,
    file_hash: String,
) -> Result<ExternalDataInspection, String> {
    use calamine::{open_workbook, Reader, Xlsx};

    let mut workbook: Xlsx<_> =
        open_workbook(path).map_err(|e: calamine::XlsxError| e.to_string())?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        return Err("xlsx file has no sheets".to_string());
    }
    let target_sheet = sheet_name.unwrap_or_else(|| sheet_names[0].clone());
    let range = workbook
        .worksheet_range(&target_sheet)
        .map_err(|e| e.to_string())?;

    let mut rows_iter = range.rows();
    let header_row = rows_iter.next().ok_or("xlsx sheet is empty")?;
    let headers: Vec<String> = header_row.iter().map(|c| c.to_string()).collect();

    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    let mut row_count = 0;
    for row in rows_iter {
        row_count += 1;
        for (i, cell) in row.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(cell.to_string());
            }
        }
    }

    let columns = build_external_columns(&headers, &column_values);

    Ok(ExternalDataInspection {
        columns,
        row_count,
        file_hash,
        sheet_name: Some(target_sheet),
    })
}

#[tauri::command]
pub async fn inspect_external_data(
    absolute_path: String,
    sheet_name: Option<String>,
) -> Result<ExternalDataInspection, String> {
    inspect_external_data_impl(absolute_path, sheet_name)
}

#[allow(clippy::too_many_arguments)]
pub fn execute_join_impl(
    project_root: PathBuf,
    qcbf_relative_path: String,
    external_absolute_path: String,
    left_on: Vec<String>,
    right_on: Vec<String>,
    drop_right_on: bool,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    state: &crate::import::AppState,
) -> Result<DataInspection, String> {
    let ext_path = PathBuf::from(&external_absolute_path);
    if !ext_path.exists() {
        return Err(format!(
            "External file not found: {}",
            external_absolute_path
        ));
    }

    let qcbf_inspection = load_qcbf_data_impl(project_root, qcbf_relative_path, state)?;
    let qcbf_hash = qcbf_inspection.qcbf_hash.clone();
    let qcbf_rows = {
        let guard = state.active_data.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .ok_or("qCBF cache missing after load")?
            .rows
            .clone()
    };

    let ext_inspection =
        inspect_external_data_impl(external_absolute_path.clone(), sheet_name.clone())?;
    let external_hash = ext_inspection.file_hash.clone();

    let extension = ext_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let ext_rows: Vec<HashMap<String, String>> = match extension.as_str() {
        "tsv" => parse_external_rows(&ext_path, '\t', &na_tokens)?,
        "csv" => {
            let text = std::fs::read_to_string(&ext_path).map_err(|e| e.to_string())?;
            let first_line = text.lines().next().unwrap_or("");
            let delimiter = detect_delimiter(first_line);
            parse_external_rows(&ext_path, delimiter, &na_tokens)?
        }
        "xlsx" => parse_external_xlsx_rows(&ext_path, sheet_name, &na_tokens)?,
        _ => return Err(format!("Unsupported file format: .{}", extension)),
    };

    let mut ext_index: HashMap<Vec<String>, Vec<&HashMap<String, String>>> = HashMap::new();
    for row in &ext_rows {
        let key: Vec<String> = right_on
            .iter()
            .filter_map(|col| row.get(col).cloned())
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
            .filter_map(|col| qcbf_row.get(col).cloned())
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
        qcbf_hash: qcbf_hash.clone(),
        external_hash: Some(external_hash.clone()),
    };
    *state.active_data.lock().map_err(|e| e.to_string())? = Some(active);

    Ok(DataInspection {
        columns: merged_columns,
        row_count,
        qcbf_hash,
        external_hash: Some(external_hash),
    })
}

fn normalize_na(value: &str, na_tokens: &[String]) -> String {
    let trimmed = value.trim();
    let na_set: HashSet<&str> = na_tokens.iter().map(|s| s.as_str()).collect();
    if na_set.contains(trimmed) {
        return String::new();
    }
    trimmed.to_string()
}

fn parse_external_rows(
    path: &Path,
    delimiter: char,
    na_tokens: &[String],
) -> Result<Vec<HashMap<String, String>>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let text = text.trim_start_matches('\u{FEFF}');

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter as u8)
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|s| s.trim().to_string())
        .collect();

    let mut rows = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        let mut row = HashMap::new();
        for (i, field) in record.iter().enumerate() {
            if i < headers.len() {
                row.insert(headers[i].clone(), normalize_na(field, na_tokens));
            }
        }
        rows.push(row);
    }
    Ok(rows)
}

fn parse_external_xlsx_rows(
    path: &Path,
    sheet_name: Option<String>,
    na_tokens: &[String],
) -> Result<Vec<HashMap<String, String>>, String> {
    use calamine::{open_workbook, Reader, Xlsx};

    let mut workbook: Xlsx<_> =
        open_workbook(path).map_err(|e: calamine::XlsxError| e.to_string())?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        return Err("xlsx file has no sheets".to_string());
    }
    let target_sheet = sheet_name.unwrap_or_else(|| sheet_names[0].clone());
    let range = workbook
        .worksheet_range(&target_sheet)
        .map_err(|e| e.to_string())?;

    let mut rows_iter = range.rows();
    let header_row = rows_iter.next().ok_or("xlsx sheet is empty")?;
    let headers: Vec<String> = header_row.iter().map(|c| c.to_string()).collect();

    let na_set: HashSet<String> = na_tokens.iter().cloned().collect();

    let mut rows = Vec::new();
    for row in rows_iter {
        let mut row_map = HashMap::new();
        for (i, cell) in row.iter().enumerate() {
            if i < headers.len() {
                let val = cell.to_string();
                let normalized = if na_set.contains(&val) {
                    String::new()
                } else {
                    val
                };
                row_map.insert(headers[i].clone(), normalized);
            }
        }
        rows.push(row_map);
    }
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SanityCheckResult {
    pub overlap_count: usize,
    pub unmatched_left_count: usize,
    pub left_keys_unique: bool,
    pub right_keys_unique: bool,
}

#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn check_join_sanity_impl(
    _project_root: PathBuf,
    _qcbf_relative_path: String,
    external_absolute_path: String,
    left_on: Vec<String>,
    right_on: Vec<String>,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    state: &crate::import::AppState,
) -> Result<SanityCheckResult, String> {
    let qcbf_rows: Vec<HashMap<String, String>> = {
        let guard = state.active_data.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .ok_or("No qCBF data loaded. Select a file first.")?
            .rows
            .clone()
    };

    let ext_path = PathBuf::from(&external_absolute_path);
    if !ext_path.exists() {
        return Err(format!(
            "External file not found: {}",
            external_absolute_path
        ));
    }
    let extension = ext_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let ext_rows: Vec<HashMap<String, String>> = match extension.as_str() {
        "tsv" => parse_external_rows(&ext_path, '\t', &na_tokens)?,
        "csv" => {
            let text = std::fs::read_to_string(&ext_path).map_err(|e| e.to_string())?;
            let first_line = text.lines().next().unwrap_or("");
            let delimiter = detect_delimiter(first_line);
            parse_external_rows(&ext_path, delimiter, &na_tokens)?
        }
        "xlsx" => parse_external_xlsx_rows(&ext_path, sheet_name, &na_tokens)?,
        _ => return Err(format!("Unsupported file format: .{}", extension)),
    };

    let mut right_key_counts: HashMap<Vec<String>, usize> = HashMap::new();
    for row in &ext_rows {
        let key: Vec<String> = right_on
            .iter()
            .filter_map(|col| row.get(col).cloned())
            .collect();
        *right_key_counts.entry(key).or_default() += 1;
    }

    let mut left_key_counts: HashMap<Vec<String>, usize> = HashMap::new();
    for row in &qcbf_rows {
        let key: Vec<String> = left_on
            .iter()
            .filter_map(|col| row.get(col).cloned())
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
#[allow(clippy::too_many_arguments)]
pub async fn check_join_sanity(
    project_root: String,
    qcbf_relative_path: String,
    external_absolute_path: String,
    left_on: Vec<String>,
    right_on: Vec<String>,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    state: State<'_, crate::import::AppState>,
) -> Result<SanityCheckResult, String> {
    check_join_sanity_impl(
        PathBuf::from(project_root),
        qcbf_relative_path,
        external_absolute_path,
        left_on,
        right_on,
        na_tokens,
        sheet_name,
        &state,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_join(
    project_root: String,
    qcbf_relative_path: String,
    external_absolute_path: String,
    left_on: Vec<String>,
    right_on: Vec<String>,
    drop_right_on: bool,
    na_tokens: Vec<String>,
    sheet_name: Option<String>,
    state: State<'_, crate::import::AppState>,
) -> Result<DataInspection, String> {
    execute_join_impl(
        PathBuf::from(project_root),
        qcbf_relative_path,
        external_absolute_path,
        left_on,
        right_on,
        drop_right_on,
        na_tokens,
        sheet_name,
        &state,
    )
}
