use anyhow::{Context, Result as AnyResult, bail};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

use crate::{error::IntoCommandResult, tracing::CommandTrace};

#[tauri::command]
pub fn is_writable(path: &str) -> bool {
    let trace = CommandTrace::new("is_writable");
    trace.arg("path", path);
    let test_file = std::path::Path::new(path).join(".easl_write_test");

    let result = fs::write(&test_file, b"").is_ok() && fs::remove_file(&test_file).is_ok();
    trace.success(&result);
    result
}

#[tauri::command]
pub fn get_cpu_cores() -> usize {
    let trace = CommandTrace::new("get_cpu_cores");
    let cores = num_cpus::get_physical();
    trace.success(&cores);
    cores
}

#[tauri::command]
pub fn get_available_memory_mb() -> u64 {
    let trace = CommandTrace::new("get_available_memory_mb");
    let mb = available_memory_mb_impl();
    trace.success(&mb);
    mb
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PathOwnership {
    Internal,
    External,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePathInspection {
    pub absolute_path: PathBuf,
    pub exists: bool,
    pub readable: bool,
    pub is_directory: bool,
    pub ownership: PathOwnership,
    pub project_relative_path: Option<String>,
}

fn safe_relative_path(path: &Path) -> AnyResult<()> {
    if path.is_absolute() {
        return Ok(());
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        bail!("Relative path cannot escape its root: {}", path.display());
    }
    Ok(())
}

fn portable_relative_path(path: &Path) -> String {
    let relative = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if relative.is_empty() {
        ".".to_owned()
    } else {
        format!("./{relative}")
    }
}

pub fn inspect_source_path_impl(
    project_root: &Path,
    source_path: &Path,
) -> AnyResult<SourcePathInspection> {
    safe_relative_path(source_path)?;
    let canonical_project = project_root
        .canonicalize()
        .with_context(|| format!("Failed to resolve project root {}", project_root.display()))?;
    let candidate = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        canonical_project.join(source_path)
    };

    if !candidate.exists() {
        return Ok(SourcePathInspection {
            absolute_path: candidate,
            exists: false,
            readable: false,
            is_directory: false,
            ownership: PathOwnership::Missing,
            project_relative_path: None,
        });
    }

    let canonical_source = candidate
        .canonicalize()
        .with_context(|| format!("Failed to resolve source path {}", candidate.display()))?;
    let is_directory = canonical_source.is_dir();
    let readable = if is_directory {
        fs::read_dir(&canonical_source).is_ok()
    } else {
        fs::File::open(&canonical_source).is_ok()
    };
    let project_relative_path = canonical_source
        .strip_prefix(&canonical_project)
        .ok()
        .map(portable_relative_path);
    let ownership = if project_relative_path.is_some() {
        PathOwnership::Internal
    } else {
        PathOwnership::External
    };

    Ok(SourcePathInspection {
        absolute_path: canonical_source,
        exists: true,
        readable,
        is_directory,
        ownership,
        project_relative_path,
    })
}

#[tauri::command]
pub fn inspect_source_path(
    project_root: String,
    source_path: String,
) -> Result<SourcePathInspection, String> {
    let trace = CommandTrace::new("inspect_source_path");
    trace.arg("project_root", &project_root);
    trace.arg("source_path", &source_path);
    let result = inspect_source_path_impl(Path::new(&project_root), Path::new(&source_path));
    match &result {
        Ok(value) => trace.success(value),
        Err(error) => trace.error(error),
    }
    result.into_command_result()
}

#[cfg(target_os = "linux")]
fn available_memory_mb_impl() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|contents| {
            for line in contents.lines() {
                if line.starts_with("MemAvailable:") {
                    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
                    return Some(kb / 1024);
                }
            }
            None
        })
        .unwrap_or(16_384)
}

#[cfg(target_os = "macos")]
fn available_memory_mb_impl() -> u64 {
    use std::process::Command;
    Command::new("sysctl")
        .arg("-n")
        .arg("hw.memsize")
        .output()
        .ok()
        .and_then(|output| {
            let s = String::from_utf8_lossy(&output.stdout);
            let bytes: u64 = s.trim().parse().ok()?;
            Some(bytes / 1024 / 1024)
        })
        .unwrap_or(16_384)
}

#[cfg(target_os = "windows")]
fn available_memory_mb_impl() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GlobalMemoryStatusEx;
    use windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX;

    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
        status.ullAvailPhys / 1024 / 1024
    } else {
        16_384
    }
}

/// Recursively walk a directory tree to find DICOM data locations.
///
/// If `b_match_directories` is true: returns relative paths to directories
/// containing at least one `.dcm` file.
///
/// If `b_match_directories` is false: returns relative paths to individual
/// `.dcm` files.
///
/// All paths are returned relative to `root`.
#[tauri::command]
pub fn walk_directory(
    root: String,
    max_depth: u32,
    b_match_directories: bool,
) -> Result<Vec<String>, String> {
    let trace = CommandTrace::new("walk_directory");
    trace.arg("root", &root);
    trace.arg("max_depth", max_depth);
    trace.arg("b_match_directories", b_match_directories);

    let root_path = Path::new(&root);

    if !root_path.exists() {
        let err = format!("Directory does not exist: {}", root);
        trace.error(&err);
        return Err(err);
    }

    if !root_path.is_dir() {
        let err = format!("Path is not a directory: {}", root);
        trace.error(&err);
        return Err(err);
    }

    let walker = WalkDir::new(&root)
        .max_depth(max_depth as usize)
        .follow_links(true);

    let result = if b_match_directories {
        let mut dcm_dirs = std::collections::HashSet::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file()
                && let Some(ext) = entry.path().extension()
                && ext.eq_ignore_ascii_case("dcm")
                && let Some(parent) = entry.path().parent()
                && let Ok(relative) = parent.strip_prefix(&root)
            {
                dcm_dirs.insert(relative.to_string_lossy().to_string());
            }
        }

        let mut result: Vec<String> = dcm_dirs.into_iter().collect();
        result.sort();
        Ok(result)
    } else {
        let mut dcm_files = Vec::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file()
                && let Some(ext) = entry.path().extension()
                && ext.eq_ignore_ascii_case("dcm")
                && let Ok(relative) = entry.path().strip_prefix(&root)
            {
                dcm_files.push(relative.to_string_lossy().to_string());
            }
        }

        dcm_files.sort();
        Ok(dcm_files)
    };

    match &result {
        Ok(val) => trace.success(&val),
        Err(err) => trace.error(&err),
    }
    result
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
