//! MATLAB executable validation and platform-specific PATH lookup.
//! Apptainer keeps its own resolution rules in `apptainer`.

use anyhow::{Result as AnyResult, anyhow, bail};
use std::{
    env,
    path::{Path, PathBuf},
};

pub fn validate_matlab_executable(matlab_path: &str) -> AnyResult<String> {
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
        .ok_or_else(|| anyhow!("MATLAB executable not found on PATH: {}", matlab_path))
}

pub(crate) fn is_path_like(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() || value.contains('/') || value.contains('\\')
}

pub(crate) fn validate_executable_file(path: &Path) -> AnyResult<()> {
    if !path.exists() {
        bail!("MATLAB executable not found: {}", path.display());
    }
    if !path.is_file() {
        bail!("MATLAB path is not a file: {}", path.display());
    }
    if !is_executable_file(path) {
        bail!("MATLAB executable is not executable: {}", path.display());
    }

    Ok(())
}

#[cfg(unix)]
pub(crate) fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
pub(crate) fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn is_executable_file(path: &Path) -> bool {
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
pub(crate) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
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
pub(crate) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

pub(crate) fn validate_string_input(name: &str, value: &str) -> AnyResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{} must not be empty", name);
    }

    Ok(trimmed.to_string())
}
