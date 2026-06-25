use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;
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
