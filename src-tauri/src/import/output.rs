use super::staging::portable_key;
use super::validation::validate_staging_root;
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn cleanup_staging_root(staging_root: &Path) -> AnyResult<()> {
    if staging_root.exists() {
        fs::remove_dir_all(staging_root).with_context(|| {
            format!(
                "Failed to remove staging directory {}",
                staging_root.display()
            )
        })?;
    }

    Ok(())
}

pub fn validate_subject_components(subjects: &[String]) -> AnyResult<()> {
    for subject in subjects {
        if subject.is_empty() || subject == "." || subject == ".." {
            bail!("Invalid subject path component: {subject:?}");
        }
        if subject.contains('/') || subject.contains('\\') {
            bail!("Invalid subject path component: {subject:?}");
        }

        let mut components = Path::new(subject).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => {}
            _ => bail!("Invalid subject path component: {subject:?}"),
        }
    }

    Ok(())
}

pub(super) fn owned_subject_spelling<'a>(
    owned_subjects: &'a [String],
    subject: &str,
) -> Option<&'a str> {
    let key = portable_key(subject);
    owned_subjects
        .iter()
        .find(|owned| portable_key(owned) == key)
        .map(String::as_str)
}

pub(super) fn validate_preserved_subjects_are_disjoint(
    subject_list: &[String],
    preserved_subjects: &[String],
) -> AnyResult<()> {
    let run_subject_keys = subject_list
        .iter()
        .map(|subject| portable_key(subject))
        .collect::<std::collections::HashSet<_>>();
    if preserved_subjects
        .iter()
        .any(|subject| run_subject_keys.contains(&portable_key(subject)))
    {
        bail!("Retry preserve subjects overlap subjects selected for import");
    }

    Ok(())
}

pub fn validate_project_root_for_staging(
    staging_root: &Path,
    project_root: &Path,
) -> AnyResult<()> {
    validate_staging_root(staging_root)?;

    let normalized_staging_root = normalize_path_for_validation(staging_root)?;
    let normalized_project_root = normalize_path_for_validation(project_root)?;
    let staging_parent = normalized_staging_root.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "staging_root must have a parent directory: {}",
            staging_root.display()
        )
    })?;

    if staging_parent != normalized_project_root {
        bail!(
            "project_root must be the parent of staging_root: project_root={}, staging_root={}",
            project_root.display(),
            staging_root.display()
        );
    }

    Ok(())
}

pub(super) fn normalize_path_for_validation(path: &Path) -> AnyResult<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path)
            .with_context(|| format!("Failed to canonicalize {}", path.display()));
    }

    let (parent, file_name) = validation_path_components(path)?;
    let parent = fs::canonicalize(parent)
        .with_context(|| format!("Failed to canonicalize parent {}", parent.display()))?;

    Ok(parent.join(file_name))
}

pub(super) fn validation_path_components(path: &Path) -> AnyResult<(&Path, &std::ffi::OsStr)> {
    let parent = path.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "Path must have an existing parent for validation: {}",
            path.display()
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        anyhow::anyhow!(
            "Path must have a final component for validation: {}",
            path.display()
        )
    })?;

    Ok((parent, file_name))
}

pub(super) fn copy_import_configs(staging_root: &Path, project_root: &Path) -> AnyResult<()> {
    let destination_dir = project_root.join("derivatives").join("ExploreASL_GUI");
    fs::create_dir_all(&destination_dir).with_context(|| {
        format!(
            "Failed to create GUI derivatives directory {}",
            destination_dir.display()
        )
    })?;

    for file_name in ["sourcestructure.json", "studyPar.json"] {
        let source = staging_root.join(file_name);
        if source.exists() {
            fs::copy(&source, destination_dir.join(file_name))
                .with_context(|| format!("Failed to copy import config {}", source.display()))?;
        }
    }

    Ok(())
}
