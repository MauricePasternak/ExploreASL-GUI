//! Source-path inspection and project-directory write checks.
use anyhow::{Context, Result as AnyResult, bail};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::{
    error::{CommandError, IntoCommandResult},
    tracing::CommandTrace,
};

#[tauri::command]
#[specta::specta]
pub fn is_writable(path: &str) -> bool {
    let trace = CommandTrace::new("is_writable");
    trace.arg("path", path);
    let test_file = std::path::Path::new(path).join(".easl_write_test");

    let result = fs::write(&test_file, b"").is_ok() && fs::remove_file(&test_file).is_ok();
    trace.success(&result);
    result
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PathOwnership {
    Internal,
    External,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
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
    if !source_path.is_absolute() && !canonical_source.starts_with(&canonical_project) {
        bail!("Project-relative source escapes its root through a symlink");
    }
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
#[specta::specta]
pub fn inspect_source_path(
    project_root: String,
    source_path: String,
) -> Result<SourcePathInspection, CommandError> {
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
