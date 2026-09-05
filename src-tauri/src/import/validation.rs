use super::output::cleanup_staging_root;
use super::staging::{StagingEntry, portable_key};
use super::types::{ImportLifecycle, ImportState};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

pub fn rollback_preparation_failure(staging_root: &Path, error: String) -> String {
    let _ = cleanup_staging_root(staging_root);
    error
}

pub fn validate_staging_root(staging_root: &Path) -> Result<(), String> {
    if staging_root.file_name().and_then(|name| name.to_str()) != Some(".easl_staging") {
        return Err(format!(
            "staging_root must end with .easl_staging: {}",
            staging_root.display()
        ));
    }

    Ok(())
}

pub fn validate_import_not_running(state: &ImportState) -> Result<(), String> {
    match state.lifecycle {
        ImportLifecycle::Preparing => Err("An import is already preparing".to_string()),
        ImportLifecycle::Running => Err(match state.child_pid {
            Some(pid) => format!("An import is already running with process PID {pid}"),
            None => "An import is already running".to_string(),
        }),
        ImportLifecycle::Idle | ImportLifecycle::Terminal => Ok(()),
    }
}

pub fn validate_non_empty_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    if staging_entries.is_empty() {
        return Err("staging_entries must contain at least one staging entry".to_string());
    }
    if subject_list.is_empty() {
        return Err("subject_list must contain at least one subject".to_string());
    }

    Ok(())
}

pub fn validate_subject_scope(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    let mut staging_subjects = BTreeMap::new();
    for entry in staging_entries {
        staging_subjects
            .entry(portable_key(&entry.subject))
            .or_insert_with(|| entry.subject.clone());
    }

    let mut declared_subjects = BTreeMap::new();
    for subject in subject_list {
        declared_subjects
            .entry(portable_key(subject))
            .or_insert_with(|| subject.clone());
    }

    let undeclared = staging_subjects
        .iter()
        .filter(|(key, _)| !declared_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();
    let missing = declared_subjects
        .iter()
        .filter(|(key, _)| !staging_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();

    if undeclared.is_empty() && missing.is_empty() {
        return Ok(());
    }

    let mut details = Vec::new();
    if !undeclared.is_empty() {
        details.push(format!(
            "undeclared staging subjects: {}",
            undeclared.join(", ")
        ));
    }
    if !missing.is_empty() {
        details.push(format!(
            "declared subjects without staging entries: {}",
            missing.join(", ")
        ));
    }

    Err(format!(
        "Import subject scope mismatch: {}",
        details.join("; ")
    ))
}

pub fn validate_import_request_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    validate_non_empty_inputs(staging_entries, subject_list)?;
    validate_subject_scope(staging_entries, subject_list)
}

pub(super) fn normalize_staging_subject_spelling(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<Vec<StagingEntry>, String> {
    let mut owned_by_key = BTreeMap::new();
    for subject in subject_list {
        let key = portable_key(subject);
        if owned_by_key.insert(key, subject.as_str()).is_some() {
            return Err("Import subject list contains portable-equivalent duplicates".to_string());
        }
    }

    staging_entries
        .iter()
        .map(|entry| {
            let canonical = owned_by_key
                .get(&portable_key(&entry.subject))
                .ok_or_else(|| {
                    format!(
                        "Staging entry subject is not in the declared import scope: {}",
                        entry.subject
                    )
                })?;
            let mut normalized = entry.clone();
            normalized.subject = (*canonical).to_string();
            Ok(normalized)
        })
        .collect()
}

pub fn validate_matlab_executable(matlab_path: &str) -> Result<String, String> {
    let matlab_path = validate_string_input("matlab_path", matlab_path)?;

    if is_path_like(&matlab_path) {
        let path = Path::new(&matlab_path);
        validate_executable_file(path)?;
        return Ok(matlab_path);
    }

    let path_var = env::var_os("PATH")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_default();
    find_executable_on_path(&matlab_path, &path_var)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| format!("MATLAB executable not found on PATH: {}", matlab_path))
}

pub(super) fn is_path_like(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() || value.contains('/') || value.contains('\\')
}

pub(super) fn validate_executable_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("MATLAB executable not found: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("MATLAB path is not a file: {}", path.display()));
    }
    if !is_executable_file(path) {
        return Err(format!(
            "MATLAB executable is not executable: {}",
            path.display()
        ));
    }

    Ok(())
}

#[cfg(unix)]
pub(super) fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
pub(super) fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(not(any(unix, windows)))]
pub(super) fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

pub fn find_executable_on_path(command: &str, path_var: &str) -> Option<PathBuf> {
    if command.trim().is_empty() || is_path_like(command) {
        return None;
    }

    for dir in env::split_paths(path_var) {
        for candidate in executable_candidates(&dir, command) {
            if candidate.is_file() && is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(windows)]
pub(super) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    let command_path = Path::new(command);
    if command_path.extension().is_some() {
        return vec![dir.join(command)];
    }

    let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|ext| !ext.is_empty())
        .map(|ext| dir.join(format!("{command}{ext}")))
        .chain(std::iter::once(dir.join(command)))
        .collect()
}

#[cfg(not(windows))]
pub(super) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

pub(super) fn validate_string_input(name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} must not be empty", name));
    }

    Ok(trimmed.to_string())
}

pub(super) fn validate_path_input(name: &str, value: &str) -> Result<PathBuf, String> {
    validate_string_input(name, value).map(PathBuf::from)
}
