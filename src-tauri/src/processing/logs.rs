//! ExploreASL processing log discovery, filename parsing and error detection.
use super::identifiers::normalize_asl_run_id;
use super::types::LogFileInfo;
use crate::error::IntoCommandResult;
use crate::tracing::CommandTrace;
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn list_module_logs(project_root: String) -> Result<Vec<LogFileInfo>, String> {
    list_module_logs_impl(project_root).into_command_result()
}

fn list_module_logs_impl(project_root: String) -> AnyResult<Vec<LogFileInfo>> {
    let trace = CommandTrace::new("list_module_logs");
    trace.arg("project_root", &project_root);

    let project_root = PathBuf::from(project_root);
    let log_dirs = exploreasl_log_dirs(&project_root);

    if log_dirs.is_empty() {
        trace.success(&Vec::<LogFileInfo>::new());
        return Ok(Vec::new());
    }

    let subject_session_re =
        regex::Regex::new(r"sub-[^_]+_\d+").expect("subject_session pattern should compile");

    let import_subject_re =
        regex::Regex::new(r"sub-[^_\s.]+").expect("import subject pattern should compile");

    let asl_run_re = regex::Regex::new(r"_ASL_(\d+)\.").expect("ASL run pattern should compile");

    let mut results = Vec::new();
    let mut seen_filenames = std::collections::HashSet::new();

    for log_dir in log_dirs {
        let entries = fs::read_dir(&log_dir)
            .with_context(|| format!("Failed to read log dir {}", log_dir.display()))?;

        for entry in entries {
            let entry = entry.context("Failed to read log entry")?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if seen_filenames.contains(&file_name) {
                continue;
            }

            let Some(info) = parse_module_log_file(
                &file_name,
                &entry.path(),
                &subject_session_re,
                &import_subject_re,
                &asl_run_re,
            ) else {
                continue;
            };

            seen_filenames.insert(file_name);
            results.push(info);
        }
    }

    trace.success(&results);
    Ok(results)
}

pub(crate) fn is_mutex_related_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("mutex is locked")
}

pub(crate) fn check_log_for_error(path: &Path) -> bool {
    let file_size = match fs::metadata(path) {
        Ok(m) => m.len(),
        Err(_) => return false,
    };

    let offset = file_size.saturating_sub(2048);
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };

    use std::io::{Read, Seek, SeekFrom};
    if offset > 0 && file.seek(SeekFrom::Start(offset)).is_err() {
        return false;
    }

    let mut buf = vec![0u8; 2048];
    let bytes_read = match file.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };

    let content = String::from_utf8_lossy(&buf[..bytes_read]);
    content
        .lines()
        .any(|line| line.to_lowercase().contains("error") && !is_mutex_related_line(line))
}

pub(crate) fn find_asl_runs_from_logs(project_root: &Path, subject_session: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let log_dirs = exploreasl_log_dirs(project_root);
    let pattern = format!("xASL_module_ASL_{}_ASL_", subject_session);
    for log_dir in log_dirs {
        if let Ok(entries) = std::fs::read_dir(log_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type()
                    && file_type.is_file()
                {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with(&pattern)
                        && name.ends_with(".log")
                        && let Some(run_part) = name.strip_prefix(&pattern)
                        && let Some(run_str) = run_part.strip_suffix(".log")
                    {
                        let run = normalize_asl_run_id(run_str);
                        if !runs.contains(&run) {
                            runs.push(run);
                        }
                    }
                }
            }
        }
    }
    runs
}

pub(crate) fn exploreasl_log_dirs(project_root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let project_log = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if project_log.is_dir() {
        dirs.push(project_log);
    }
    let staging_log = project_root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if staging_log.is_dir() {
        dirs.push(staging_log);
    }
    dirs
}

pub(crate) fn parse_module_log_file(
    file_name: &str,
    path: &Path,
    subject_session_re: &regex::Regex,
    import_subject_re: &regex::Regex,
    asl_run_re: &regex::Regex,
) -> Option<LogFileInfo> {
    let module = if file_name.starts_with("xASL_module_Structural") {
        "structural"
    } else if file_name.starts_with("xASL_module_ASL") {
        "asl"
    } else if file_name.starts_with("xASL_module_Import") {
        "import"
    } else if file_name.starts_with("xASL_module_Population") {
        "population"
    } else {
        return None;
    };

    let subject_identifier = if module == "import" {
        import_subject_re
            .find(file_name)
            .map(|m| m.as_str().to_string())
    } else if module == "population" {
        Some(String::new())
    } else {
        subject_session_re
            .find(file_name)
            .map(|m| m.as_str().to_string())
    };

    let subject_identifier_val = subject_identifier?;

    let run = if module == "asl" {
        asl_run_re
            .captures(file_name)
            .and_then(|caps| caps.get(1))
            .map(|m| normalize_asl_run_id(m.as_str()))
    } else {
        None
    };

    Some(LogFileInfo {
        filename: file_name.to_string(),
        module: module.to_string(),
        subject_session: subject_identifier_val,
        run,
        has_error: check_log_for_error(path),
    })
}

#[tauri::command]
pub fn read_module_logs(
    project_root: String,
    subject_session: String,
    module: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    read_module_logs_impl(project_root, subject_session, module).into_command_result()
}

fn read_module_logs_impl(
    project_root: String,
    subject_session: String,
    module: String,
) -> AnyResult<std::collections::HashMap<String, String>> {
    let trace = CommandTrace::new("read_module_logs");
    trace.arg("project_root", &project_root);
    trace.arg("subject_session", &subject_session);
    trace.arg("module", &module);

    let project_root = PathBuf::from(&project_root);
    let log_dirs = exploreasl_log_dirs(&project_root);

    if log_dirs.is_empty() {
        trace.success(&std::collections::HashMap::<String, String>::new());
        return Ok(std::collections::HashMap::new());
    }

    let module_prefix = match module.as_str() {
        "structural" => "xASL_module_Structural",
        "asl" => "xASL_module_ASL",
        "import" => "xASL_module_Import",
        "population" => "xASL_module_Population",
        _ => bail!("Unknown module: {}", module),
    };

    let search_prefix = if module == "population" {
        module_prefix.to_string()
    } else {
        format!("{}_{}", module_prefix, subject_session)
    };

    let mut results = std::collections::HashMap::new();

    for log_dir in log_dirs {
        let entries = fs::read_dir(&log_dir)
            .with_context(|| format!("Failed to read log dir {}", log_dir.display()))?;

        for entry in entries {
            let entry = entry.context("Failed to read log entry")?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if !file_name.starts_with(&search_prefix) || results.contains_key(&file_name) {
                continue;
            }

            let content = match fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => {
                    let bytes = match fs::read(entry.path()) {
                        Ok(b) => b,
                        Err(e) => bail!("Failed to read log file {}: {}", file_name, e),
                    };
                    String::from_utf8_lossy(&bytes).to_string()
                }
            };

            results.insert(file_name, content);
        }
    }

    trace.success(&results);
    Ok(results)
}
