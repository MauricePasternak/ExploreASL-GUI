use super::output::{validate_project_root_for_staging, validate_subject_components};
use super::types::{ImportSubjectStatus, ImportSubjectStatusKind};
use super::validation::validate_staging_root;
use crate::app::state::AppState;
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

pub fn copy_lock_files_paths(
    project_root: &Path,
    staging_root: &Path,
    subjects: &[String],
) -> AnyResult<()> {
    validate_staging_root(staging_root)?;
    validate_project_root_for_staging(staging_root, project_root)?;
    validate_subject_components(subjects)?;

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
            let metadata = fs::symlink_metadata(&source).with_context(|| {
                format!("Failed to inspect preserved lock file {}", source.display())
            })?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || !super::verification::safe_directory(&source_dir)
            {
                anyhow::bail!("Preserved lock file is unsafe: {}", source.display());
            }
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

pub(super) fn read_import_status_for_state(
    state: &AppState,
) -> AnyResult<Vec<ImportSubjectStatus>> {
    let project_root = state
        .active_project_root
        .lock()
        .map_err(|_| anyhow::anyhow!("Active project state lock was poisoned"))?
        .clone()
        .context("No active project root")?;
    let project_root =
        fs::canonicalize(project_root).context("Failed to canonicalize active project root")?;
    read_import_status_impl(project_root)
}

pub(super) fn is_committed_import_subject(project_root: &Path, subject: &str) -> AnyResult<bool> {
    super::output::validate_subject_components(&[subject.to_string()])?;
    let ready = import_lock_dir(project_root, subject).join("999_ready.status");
    let ready = match fs::symlink_metadata(ready) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => true,
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error).context("Failed to inspect preserved import lock"),
    };
    let rawdata_subject = if subject.starts_with("sub-") {
        subject.to_string()
    } else {
        format!("sub-{subject}")
    };
    let rawdata = super::verification::safe_nonempty_tree(
        &project_root.join("rawdata").join(rawdata_subject),
    )?;
    Ok(ready
        && rawdata
        && super::verification::safe_directory(project_root)
        && super::verification::safe_directory(&import_lock_dir(project_root, subject)))
}

pub(super) fn read_import_status_impl(
    project_root: PathBuf,
) -> AnyResult<Vec<ImportSubjectStatus>> {
    let lock_base = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Import");

    let lock_metadata = match fs::symlink_metadata(&lock_base) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error).context("Failed to inspect import lock directory"),
    };
    if lock_metadata.file_type().is_symlink()
        || !lock_metadata.is_dir()
        || !super::verification::safe_directory(&lock_base)
    {
        anyhow::bail!("Import lock directory is unsafe");
    }
    if !lock_base.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&lock_base)
        .with_context(|| format!("Failed to read lock directory {}", lock_base.display()))?;

    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.context("Failed to read directory entry")?;
        let metadata = fs::symlink_metadata(entry.path())
            .with_context(|| format!("Failed to inspect entry {}", entry.path().display()))?;

        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            results.push(ImportSubjectStatus {
                subject: entry.file_name().to_string_lossy().to_string(),
                status: ImportSubjectStatusKind::Failed,
            });
            continue;
        }

        let subject = entry.file_name().to_string_lossy().to_string();
        let subject_lock_dir = lock_base.join(&subject).join("xASL_module_Import");

        let subject_lock_metadata = match fs::symlink_metadata(&subject_lock_dir) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error).context("Failed to inspect subject import lock"),
        };
        if subject_lock_metadata.file_type().is_symlink() || !subject_lock_metadata.is_dir() {
            results.push(ImportSubjectStatus {
                subject,
                status: ImportSubjectStatusKind::Failed,
            });
            continue;
        }

        let ready_path = subject_lock_dir.join("999_ready.status");
        let ready_metadata = fs::symlink_metadata(&ready_path).ok();
        let rawdata_subject = if subject.starts_with("sub-") {
            subject.clone()
        } else {
            format!("sub-{subject}")
        };
        let rawdata = project_root.join("rawdata").join(rawdata_subject);
        let rawdata_nonempty = super::verification::safe_nonempty_tree(&rawdata)?;
        if ready_metadata
            .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
            && rawdata_nonempty
            && super::verification::safe_directory(&subject_lock_dir)
        {
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
