use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use walkdir::WalkDir;

use crate::tracing::CommandTrace;

#[tauri::command]
pub fn which_matlab() -> Vec<serde_json::Value> {
    let trace = CommandTrace::new("which_matlab");
    let mut results = Vec::new();

    if let Ok(output) = Command::new("which").arg("-a").arg("matlab").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for (index, line) in stdout.lines().enumerate() {
            let path = line.trim();
            if !path.is_empty() {
                results.push(serde_json::json!({
                    "id": format!("matlab_{}", index),
                    "label": format!("MATLAB ({})", path),
                    "path": path,
                }));
            }
        }
    }

    if let Ok(entries) = fs::read_dir("/usr/local/MATLAB") {
        for entry in entries.flatten() {
            let matlab_binary = entry.path().join("bin").join("matlab");
            if matlab_binary.exists() {
                results.push(serde_json::json!({
                    "id": format!("matlab_common_{}", entry.file_name().to_string_lossy()),
                    "label": format!("MATLAB ({})", matlab_binary.display()),
                    "path": matlab_binary.display().to_string(),
                }));
            }
        }
    }

    trace.success(&results);
    results
}

#[tauri::command]
pub fn is_writable(path: &str) -> bool {
    let trace = CommandTrace::new("is_writable");
    trace.arg("path", path);
    let test_file = format!("{}/.easl_write_test", path);

    let result = fs::write(&test_file, b"").is_ok() && fs::remove_file(&test_file).is_ok();
    trace.success(&result);
    result
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
        // Find directories containing .dcm files
        let mut dcm_dirs = std::collections::HashSet::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(ext) = entry.path().extension() {
                    if ext.eq_ignore_ascii_case("dcm") {
                        if let Some(parent) = entry.path().parent() {
                            if let Ok(relative) = parent.strip_prefix(&root) {
                                dcm_dirs.insert(relative.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }

        let mut result: Vec<String> = dcm_dirs.into_iter().collect();
        result.sort();
        Ok(result)
    } else {
        // Find individual .dcm files
        let mut dcm_files = Vec::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(ext) = entry.path().extension() {
                    if ext.eq_ignore_ascii_case("dcm") {
                        if let Ok(relative) = entry.path().strip_prefix(&root) {
                            dcm_files.push(relative.to_string_lossy().to_string());
                        }
                    }
                }
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

/// Entry for creating a symlink in the staging tree.
#[derive(Debug, Deserialize, Serialize)]
pub struct SymlinkEntry {
    pub subject: String,
    pub session: String,
    pub run: String,
    pub modality: String,
    pub source_path: String,
}

/// Create the BIDS-compliant staging tree with symlinks (or copies on Windows).
///
/// Creates directories at:
///   staging_root/sourcedata/<Subject>/<Session>/<Run>/<Modality>/
///
/// Then symlinks (Linux/macOS) or copies (Windows) all files from source_path
/// into the corresponding staging directory.
#[tauri::command]
pub fn create_symlink_tree(
    mappings: Vec<SymlinkEntry>,
    staging_root: String,
) -> Result<(), String> {
    let trace = CommandTrace::new("create_symlink_tree");
    trace.arg("staging_root", &staging_root);
    trace.arg("mappings_count", mappings.len());

    let staging_base = Path::new(&staging_root).join("sourcedata");

    for entry in &mappings {
        let target_dir = staging_base
            .join(&entry.subject)
            .join(&entry.session)
            .join(&entry.run)
            .join(&entry.modality);

        // Create the target directory
        fs::create_dir_all(&target_dir).map_err(|e| {
            let err = format!(
                "Failed to create directory {}: {}",
                target_dir.display(),
                e
            );
            trace.error(&err);
            err
        })?;

        let source = Path::new(&entry.source_path);

        if source.is_dir() {
            // Link/copy all files from the source directory
            let entries = fs::read_dir(source).map_err(|e| {
                let err = format!("Failed to read directory {}: {}", source.display(), e);
                trace.error(&err);
                err
            })?;

            for file_entry in entries.flatten() {
                if file_entry.file_type().is_ok_and(|ft| ft.is_file()) {
                    let target_file = target_dir.join(file_entry.file_name());
                    link_or_copy(&file_entry.path(), &target_file)?;
                }
            }
        } else if source.is_file() {
            // Single file — link/copy directly
            let file_name = source
                .file_name()
                .ok_or_else(|| {
                    let err = format!("Invalid file path: {}", source.display());
                    trace.error(&err);
                    err
                })?;
            let target_file = target_dir.join(file_name);
            link_or_copy(source, &target_file)?;
        } else {
            let err = format!("Source path does not exist: {}", source.display());
            trace.error(&err);
            return Err(err);
        }
    }

    trace.success(&"ok");
    Ok(())
}

/// Create a symlink (Unix) or copy (Windows fallback) from source to target.
fn link_or_copy(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target).map_err(|e| {
            format!(
                "Failed to create symlink {} -> {}: {}",
                target.display(),
                source.display(),
                e
            )
        })
    }

    #[cfg(windows)]
    {
        // Try symlink first (requires Developer Mode)
        if std::os::windows::fs::symlink_file(source, target).is_ok() {
            return Ok(());
        }
        // Try hard link (same-volume only)
        if fs::hard_link(source, target).is_ok() {
            return Ok(());
        }
        // Fall back to copy
        fs::copy(source, target)
            .map(|_| ())
            .map_err(|e| {
                format!(
                    "Failed to copy {} -> {}: {}",
                    source.display(),
                    target.display(),
                    e
                )
            })
    }
}
