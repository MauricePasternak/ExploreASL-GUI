use super::output::{
    validate_owned_subjects, validate_project_root_for_staging, validate_subject_components,
    with_owned_import_roots,
};
use super::types::{ImportSubjectStatus, ImportSubjectStatusKind};
use super::validation::validate_staging_root;
use crate::app_state::AppState;
use anyhow::{Context, Result as AnyResult};
use std::fs;
use std::path::{Path, PathBuf};

const IMPORT_STATUS_FILES: [&str; 3] = [
    "010_DCM2NII.status",
    "020_NII2BIDS.status",
    "999_ready.status",
];

pub(super) fn import_lock_dir(root: &Path, subject: &str) -> PathBuf {
    root.join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Import")
        .join(subject)
        .join("xASL_module_Import")
}

/// Relocation owns lock paths natively; callers never supply these roots over IPC.
pub(crate) fn import_lock_dir_for_relocation(root: &Path, subject: &str) -> PathBuf {
    import_lock_dir(root, subject)
}

pub fn clean_import_status_paths(staging_root: &Path, subjects: &[String]) -> AnyResult<()> {
    validate_subject_components(subjects).map_err(anyhow::Error::msg)?;

    for subject in subjects {
        let lock_dir = import_lock_dir(staging_root, subject);
        for file_name in IMPORT_STATUS_FILES {
            let status_path = lock_dir.join(file_name);
            fs::remove_file(&status_path)
                .or_else(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(error)
                    }
                })
                .with_context(|| {
                    format!("Failed to remove import status file {file_name} for subject {subject}")
                })?;
        }
    }

    Ok(())
}

pub(super) fn clean_import_status_for_state(state: &AppState) -> AnyResult<()> {
    with_owned_import_roots(state, |import_state, _, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.failed_subjects)
            .map_err(anyhow::Error::msg)?;
        clean_import_status_paths(staging_root, &import_state.failed_subjects)
    })
}

pub(super) fn copy_lock_files_for_state(state: &AppState, subjects: &[String]) -> AnyResult<()> {
    with_owned_import_roots(state, |import_state, project_root, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.succeeded_subjects)
            .map_err(anyhow::Error::msg)?;
        validate_owned_subjects(&import_state.succeeded_subjects, subjects)
            .map_err(anyhow::Error::msg)?;
        copy_lock_files_paths(project_root, staging_root, subjects)
    })
}

pub fn copy_lock_files_paths(
    project_root: &Path,
    staging_root: &Path,
    subjects: &[String],
) -> AnyResult<()> {
    validate_staging_root(staging_root).map_err(anyhow::Error::msg)?;
    validate_project_root_for_staging(staging_root, project_root).map_err(anyhow::Error::msg)?;
    validate_subject_components(subjects).map_err(anyhow::Error::msg)?;

    for subject in subjects {
        let source_dir = import_lock_dir(project_root, subject);
        let destination_dir = import_lock_dir(staging_root, subject);
        fs::create_dir_all(&destination_dir).with_context(|| {
            format!(
                "Failed to create staging lock directory {}",
                destination_dir.display()
            )
        })?;

        for file_name in IMPORT_STATUS_FILES {
            let source = source_dir.join(file_name);
            let destination = destination_dir.join(file_name);
            fs::copy(&source, &destination).with_context(|| {
                format!(
                    "Failed to copy lock file {} to {}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
    }

    Ok(())
}

pub(super) fn read_import_status_impl(
    project_root: PathBuf,
) -> AnyResult<Vec<ImportSubjectStatus>> {
    let lock_base = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Import");

    if !lock_base.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&lock_base)
        .with_context(|| format!("Failed to read lock directory {}", lock_base.display()))?;

    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.context("Failed to read directory entry")?;
        let metadata = entry
            .metadata()
            .with_context(|| format!("Failed to inspect entry {}", entry.path().display()))?;

        if !metadata.is_dir() {
            continue;
        }

        let subject = entry.file_name().to_string_lossy().to_string();
        let subject_lock_dir = lock_base.join(&subject).join("xASL_module_Import");

        if !subject_lock_dir.exists() {
            continue;
        }

        let ready_path = subject_lock_dir.join("999_ready.status");
        if ready_path.exists() {
            results.push(ImportSubjectStatus {
                subject,
                status: ImportSubjectStatusKind::Completed,
            });
        } else {
            let has_status_files = fs::read_dir(&subject_lock_dir)
                .ok()
                .map(|dir_entries| {
                    dir_entries
                        .filter_map(|e| e.ok())
                        .any(|e| e.path().extension().is_some_and(|ext| ext == "status"))
                })
                .unwrap_or(false);

            if has_status_files {
                results.push(ImportSubjectStatus {
                    subject,
                    status: ImportSubjectStatusKind::Failed,
                });
            }
        }
    }

    Ok(results)
}
