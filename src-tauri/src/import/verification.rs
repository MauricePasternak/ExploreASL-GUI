use super::status::import_lock_dir;
use super::types::{ImportStructuredError, ImportSubjectOutcome, ImportSubjectOutcomeKind};
use anyhow::{Context, Result, bail};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;

pub const STAGING_GENERATION_MARKER: &str = ".exploreasl_gui_import_generation";

fn rawdata_subject_dir(subject: &str) -> String {
    if subject.starts_with("sub-") {
        subject.to_string()
    } else {
        format!("sub-{subject}")
    }
}

pub fn prepare_generation(staging_root: &Path, subjects: &[String]) -> Result<String> {
    super::output::validate_subject_components(subjects)?;
    let marker = staging_root.join(STAGING_GENERATION_MARKER);
    let generation = uuid::Uuid::new_v4().to_string();
    for subject in subjects {
        let ready = import_lock_dir(staging_root, subject).join("999_ready.status");
        if fs::symlink_metadata(&ready).is_ok() {
            bail!(
                "Selected subject {subject} already has a completion artifact in rebuilt staging"
            );
        }
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
        .with_context(|| format!("Failed to create {}", marker.display()))?;
    file.write_all(generation.as_bytes())
        .with_context(|| format!("Failed to write {}", marker.display()))?;
    file.sync_all()
        .with_context(|| format!("Failed to flush {}", marker.display()))?;
    #[cfg(unix)]
    File::open(staging_root)
        .context("Failed to open staging root for generation sync")?
        .sync_all()
        .context("Failed to flush staging generation directory")?;
    let metadata =
        fs::symlink_metadata(&marker).context("Failed to verify staging generation marker")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Staging generation marker is unsafe");
    }
    Ok(generation)
}

fn failure(subject: &str, code: &str, message: impl Into<String>) -> ImportSubjectOutcome {
    ImportSubjectOutcome {
        subject: subject.to_string(),
        outcome: ImportSubjectOutcomeKind::Failed,
        ready_lock_verified: false,
        rawdata_verified: false,
        committed: false,
        error: Some(ImportStructuredError {
            code: code.to_string(),
            message: message.into(),
            subject: Some(subject.to_string()),
            staging_issues: None,
        }),
    }
}

pub(super) fn safe_directory(path: &Path) -> bool {
    let mut cursor = path;
    while let Some(parent) = cursor.parent() {
        match fs::symlink_metadata(cursor) {
            Ok(metadata) if metadata.file_type().is_symlink() => return false,
            Ok(_) => {}
            Err(_) => return false,
        }
        cursor = parent;
    }
    true
}

pub fn verify_subject(
    staging_root: &Path,
    subject: &str,
    expected_generation: &str,
) -> ImportSubjectOutcome {
    if let Err(error) = super::output::validate_subject_components(&[subject.to_string()]) {
        return failure(subject, "unsafeSubject", format!("{error:#}"));
    }
    let marker = staging_root.join(STAGING_GENERATION_MARKER);
    let marker_value = fs::symlink_metadata(&marker)
        .ok()
        .filter(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .and_then(|_| fs::read_to_string(&marker).ok());
    if marker_value.as_deref().map(str::trim) != Some(expected_generation)
        || !safe_directory(staging_root)
    {
        return failure(
            subject,
            "stagingGeneration",
            "Staging generation ownership is missing or unsafe",
        );
    }
    let ready = import_lock_dir(staging_root, subject).join("999_ready.status");
    let ready_metadata = match fs::symlink_metadata(&ready) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && safe_directory(ready.parent().unwrap_or(staging_root)) =>
        {
            metadata
        }
        Ok(_) => {
            return failure(
                subject,
                "readyLockUnsafe",
                "Completion lock is not a regular safe file",
            );
        }
        Err(_) => return failure(subject, "readyLockMissing", "Completion lock is missing"),
    };
    if !ready_metadata.is_file() {
        return failure(subject, "readyLockMissing", "Completion lock is missing");
    }
    let rawdata = staging_root
        .join("rawdata")
        .join(rawdata_subject_dir(subject));
    let rawdata_ok = safe_nonempty_tree(&rawdata).unwrap_or(false);
    if !rawdata_ok {
        return failure(
            subject,
            "rawdataMissing",
            "Staged rawdata is missing or empty",
        );
    }
    ImportSubjectOutcome {
        subject: subject.to_string(),
        outcome: ImportSubjectOutcomeKind::Verified,
        ready_lock_verified: true,
        rawdata_verified: true,
        committed: false,
        error: None,
    }
}

pub(super) fn safe_nonempty_tree(root: &Path) -> Result<bool> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error).context("Failed to inspect rawdata evidence"),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() || !safe_directory(root) {
        return Ok(false);
    }
    let mut stack = vec![root.to_path_buf()];
    let mut saw_file = false;
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).context("Failed to read rawdata evidence")? {
            let entry = entry.context("Failed to read rawdata entry")?;
            let metadata =
                fs::symlink_metadata(entry.path()).context("Failed to inspect rawdata entry")?;
            if metadata.file_type().is_symlink() {
                return Ok(false);
            }
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                saw_file = true;
            } else {
                return Ok(false);
            }
        }
    }
    Ok(saw_file)
}

pub(super) fn cleanup_failed_subject_status(staging_root: &Path, subject: &str) -> Result<()> {
    super::output::validate_subject_components(&[subject.to_string()])?;
    let lock_dir = import_lock_dir(staging_root, subject);
    match fs::symlink_metadata(&lock_dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("Failed to inspect failed-subject lock directory"),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            bail!("Failed-subject lock directory is unsafe")
        }
        Ok(_) => {}
    }
    if !safe_directory(&lock_dir) {
        bail!("Failed-subject lock directory is unsafe");
    }
    for name in [
        "010_DCM2NII.status",
        "020_NII2BIDS.status",
        "999_ready.status",
    ] {
        let path = lock_dir.join(name);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                fs::remove_file(&path)
                    .with_context(|| format!("Failed to remove {}", path.display()))?;
            }
            Ok(_) => bail!("Failed-subject status path is unsafe: {}", path.display()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("Failed to inspect failed-subject status"),
        }
    }
    Ok(())
}
