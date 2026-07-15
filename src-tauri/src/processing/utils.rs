use super::types::{LockCreated, LogFileInfo, StatusFileCreated};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn module_index_to_name(index: usize) -> &'static str {
    match index {
        0 => "xASL_module_Structural",
        1 => "xASL_module_ASL",
        2 => "xASL_module_Population",
        _ => panic!("Invalid module index: {}", index),
    }
}

pub fn normalize_asl_run_id(raw: &str) -> String {
    let s = raw.trim();
    let s = s
        .strip_prefix("ASL_")
        .or_else(|| s.strip_prefix("asl_"))
        .unwrap_or(s);
    if s.is_empty() {
        return "1".to_string();
    }
    match s.parse::<u32>() {
        Ok(n) if n >= 1 => n.to_string(),
        _ => "1".to_string(),
    }
}

pub fn normalize_asl_run_id_opt(raw: Option<&str>) -> String {
    match raw {
        Some(s) => normalize_asl_run_id(s),
        None => "1".to_string(),
    }
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

pub(crate) fn determine_status(dir: &Path) -> (String, Vec<String>, bool) {
    let mut has_status = false;
    let mut has_ready = false;
    let mut locked = false;
    let mut completed_steps = Vec::new();

    if dir.join("locked").exists() {
        locked = true;
    }

    for entry in WalkDir::new(dir).min_depth(1) {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file()
            && let Some(file_name) = path.file_name().and_then(|f| f.to_str())
            && file_name.ends_with(".status")
        {
            has_status = true;
            let step_name = file_name.trim_end_matches(".status").to_string();
            if step_name == "999_ready" {
                has_ready = true;
            } else {
                completed_steps.push(step_name);
            }
        }
    }

    if has_ready {
        locked = false;
    }

    completed_steps.sort();

    let status = if has_ready {
        "complete".to_string()
    } else if has_status {
        "incomplete".to_string()
    } else {
        "pending".to_string()
    };
    (status, completed_steps, locked)
}

pub(crate) fn get_structural_completion_time(
    project_root: &Path,
    subject_session: &str,
) -> Option<std::time::SystemTime> {
    let ready_file = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Structural")
        .join(subject_session)
        .join("xASL_module_Structural")
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&ready_file)
        && let Ok(mtime) = metadata.modified()
    {
        return Some(mtime);
    }
    let log_dirs = exploreasl_log_dirs(project_root);
    for log_dir in log_dirs {
        let log_file = log_dir.join(format!("xASL_module_Structural_{}.log", subject_session));
        if log_file.is_file()
            && !check_log_for_error(&log_file)
            && let Ok(metadata) = std::fs::metadata(&log_file)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }
    None
}

pub(crate) fn get_asl_completion_time(
    project_root: &Path,
    subject_session: &str,
    run: &str,
) -> Option<std::time::SystemTime> {
    let ready_file = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_ASL")
        .join(subject_session)
        .join(format!("xASL_module_ASL_ASL_{}", run))
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&ready_file)
        && let Ok(mtime) = metadata.modified()
    {
        return Some(mtime);
    }
    let log_dirs = exploreasl_log_dirs(project_root);
    for log_dir in log_dirs {
        let log_file = log_dir.join(format!(
            "xASL_module_ASL_{}_ASL_{}.log",
            subject_session, run
        ));
        if log_file.is_file()
            && !check_log_for_error(&log_file)
            && let Ok(metadata) = std::fs::metadata(&log_file)
            && let Ok(mtime) = metadata.modified()
        {
            return Some(mtime);
        }
    }
    None
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

pub(crate) fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}

pub(crate) fn ensure_lock_dir(project_root: &Path) -> Result<PathBuf, String> {
    let lock_dir = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock");
    fs::create_dir_all(&lock_dir).map_err(|e| {
        format!(
            "Failed to create lock directory {}: {}",
            lock_dir.display(),
            e
        )
    })?;
    Ok(lock_dir)
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

pub(crate) fn parse_lock_path(lock_root: &Path, path: &Path) -> Option<StatusFileCreated> {
    let relative = path.strip_prefix(lock_root).ok()?;
    let parts: Vec<&str> = relative.iter().map(|p| p.to_str().unwrap_or("")).collect();

    if parts.len() < 2 {
        return None;
    }

    let module = parts[0].to_string();
    let file_name = parts.last()?.to_string();

    if !file_name.ends_with(".status") {
        return None;
    }

    let step_code = file_name.trim_end_matches(".status").to_string();

    match module.as_str() {
        "xASL_module_Structural" => {
            if parts.len() < 4 {
                return None;
            }
            let subject_session = Some(parts[1].to_string());
            Some(StatusFileCreated {
                module,
                subject_session,
                step_code,
                run: None,
            })
        }
        "xASL_module_ASL" => {
            if parts.len() < 4 {
                return None;
            }
            let subject_session = Some(parts[1].to_string());
            let run_dir = parts[2].to_string();
            let run = if run_dir.starts_with("xASL_module_ASL_ASL_") {
                run_dir
                    .strip_prefix("xASL_module_ASL_ASL_")
                    .map(normalize_asl_run_id)
            } else {
                None
            };
            Some(StatusFileCreated {
                module,
                subject_session,
                step_code,
                run,
            })
        }
        "xASL_module_Population" => Some(StatusFileCreated {
            module,
            subject_session: None,
            step_code,
            run: None,
        }),
        _ => None,
    }
}

pub(crate) fn parse_lock_dir_path(lock_root: &Path, path: &Path) -> Option<LockCreated> {
    let relative = path.strip_prefix(lock_root).ok()?;
    let parts: Vec<&str> = relative.iter().map(|p| p.to_str().unwrap_or("")).collect();

    if parts.is_empty() {
        return None;
    }

    let module = parts[0].to_string();

    match module.as_str() {
        "xASL_module_Structural" => {
            if parts.len() < 4 {
                return None;
            }
            let subject_session = Some(parts[1].to_string());
            Some(LockCreated {
                module,
                subject_session,
                run: None,
            })
        }
        "xASL_module_ASL" => {
            if parts.len() < 4 {
                return None;
            }
            let subject_session = Some(parts[1].to_string());
            let run_dir = parts[2].to_string();
            let run = if run_dir.starts_with("xASL_module_ASL_ASL_") {
                run_dir
                    .strip_prefix("xASL_module_ASL_ASL_")
                    .map(normalize_asl_run_id)
            } else {
                None
            };
            Some(LockCreated {
                module,
                subject_session,
                run,
            })
        }
        "xASL_module_Population" => Some(LockCreated {
            module,
            subject_session: None,
            run: None,
        }),
        _ => None,
    }
}
