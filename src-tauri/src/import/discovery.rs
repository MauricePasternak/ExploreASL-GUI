//! DICOM source discovery before staging.
use crate::{error::CommandError, tracing::CommandTrace};
use std::path::Path;
use walkdir::WalkDir;

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
#[specta::specta]
pub fn walk_directory(
    root: String,
    max_depth: u32,
    b_match_directories: bool,
) -> Result<Vec<String>, CommandError> {
    let trace = CommandTrace::new("walk_directory");
    trace.arg("root", &root);
    trace.arg("max_depth", max_depth);
    trace.arg("b_match_directories", b_match_directories);

    let root_path = Path::new(&root);

    if !root_path.exists() {
        let err = format!("Directory does not exist: {}", root);
        trace.error(&err);
        return Err(err.into());
    }

    if !root_path.is_dir() {
        let err = format!("Path is not a directory: {}", root);
        trace.error(&err);
        return Err(err.into());
    }

    let walker = WalkDir::new(&root)
        .max_depth(max_depth as usize)
        .follow_links(true);

    let mut paths = std::collections::BTreeSet::new();
    let mut skipped = 0_u64;
    let mut first_error = None;
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                skipped += 1;
                first_error.get_or_insert_with(|| error.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file()
            || !entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dcm"))
        {
            continue;
        }
        let path = if b_match_directories {
            entry.path().parent().unwrap()
        } else {
            entry.path()
        };
        if let Ok(relative) = path.strip_prefix(&root) {
            paths.insert(relative.to_string_lossy().to_string());
        }
    }
    if let Some(error) = first_error {
        log::warn!(
            "[DICOM] walk_directory skipped_paths={skipped}; partial discovery retained; representative cause: {error}"
        );
    }
    let result: Vec<String> = paths.into_iter().collect();
    trace.success(&format!(
        "{} DICOM locations; {skipped} skipped paths",
        result.len()
    ));
    Ok(result)
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
