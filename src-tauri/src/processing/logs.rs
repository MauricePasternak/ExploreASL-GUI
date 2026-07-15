use super::types::LogFileInfo;
use super::utils::{exploreasl_log_dirs, module_index_to_name, parse_module_log_file};
use crate::tracing::CommandTrace;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn list_module_logs(project_root: String) -> Result<Vec<LogFileInfo>, String> {
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
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
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

#[tauri::command]
pub fn read_module_logs(
    project_root: String,
    subject_session: String,
    module: String,
) -> Result<std::collections::HashMap<String, String>, String> {
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
        _ => return Err(format!("Unknown module: {}", module)),
    };

    let search_prefix = if module == "population" {
        module_prefix.to_string()
    } else {
        format!("{}_{}", module_prefix, subject_session)
    };

    let mut results = std::collections::HashMap::new();

    for log_dir in log_dirs {
        let entries = fs::read_dir(&log_dir)
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if !file_name.starts_with(&search_prefix) || results.contains_key(&file_name) {
                continue;
            }

            let content = match fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => {
                    let bytes = match fs::read(entry.path()) {
                        Ok(b) => b,
                        Err(e) => {
                            return Err(format!("Failed to read log file {}: {}", file_name, e));
                        }
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

pub(crate) fn delete_module_log_files(
    project_root: &std::path::Path,
    b_process: &[bool],
    subject_regexp: &str,
) -> Result<(), String> {
    let log_dir = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if !log_dir.exists() {
        return Ok(());
    }

    let subject_re = if subject_regexp.is_empty() {
        None
    } else {
        Some(
            regex::Regex::new(subject_regexp)
                .map_err(|e| format!("Invalid subject regexp '{}': {}", subject_regexp, e))?,
        )
    };

    let subject_session_re =
        regex::Regex::new(r"sub-[^_]+_\d+").expect("subject_session pattern should compile");

    for (i, &enabled) in b_process.iter().enumerate() {
        if !enabled {
            continue;
        }
        let module_name = module_index_to_name(i);
        let prefix = module_name.to_string();

        for entry in fs::read_dir(&log_dir)
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if !file_name.starts_with(&prefix) {
                continue;
            }

            let should_delete = match &subject_re {
                Some(re) => {
                    if let Some(mat) = subject_session_re.find(&file_name) {
                        re.is_match(mat.as_str())
                    } else {
                        true
                    }
                }
                None => true,
            };

            if should_delete {
                match fs::remove_file(entry.path()) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(format!(
                            "Failed to delete log file {}: {}",
                            entry.path().display(),
                            e
                        ));
                    }
                }
            }
        }
    }

    Ok(())
}
