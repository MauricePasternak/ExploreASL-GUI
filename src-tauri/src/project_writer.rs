use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteErrorCategory {
    InvalidSerialization,
    PermissionDenied,
    InsufficientSpace,
    TemporaryWrite,
    FileFlush,
    Backup,
    PrimaryReplacement,
    DurabilityUncertain,
    Recovery,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtomicWriteError {
    pub category: WriteErrorCategory,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtomicWriteOutcome {
    pub backup_created: bool,
    pub directory_sync_supported: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailurePoint {
    TempCreate,
    TempWrite,
    TempSync,
    BackupRotation,
    BackupSync,
    PrimaryReplace,
    DirectorySync,
    DirectorySyncUnsupported,
}

struct WriteOptions {
    preserve_backup: bool,
    failure: Option<FailurePoint>,
}

#[tauri::command]
pub fn atomic_write_project(
    project_path: String,
    canonical_bytes: String,
    preserve_backup: bool,
) -> Result<AtomicWriteOutcome, AtomicWriteError> {
    atomic_write(
        Path::new(&project_path),
        canonical_bytes.as_bytes(),
        WriteOptions {
            preserve_backup,
            failure: None,
        },
    )
}

#[tauri::command]
pub fn cleanup_project_temps(project_path: String) {
    match ProjectPaths::new(Path::new(&project_path)) {
        Ok(paths) => cleanup_stale_temps(&paths),
        Err(err) => log::debug!(
            "Could not derive project temporary-file paths: {}",
            err.message
        ),
    }
}

#[cfg(test)]
pub(crate) fn atomic_write_project_for_test(
    project_path: &Path,
    canonical_bytes: &[u8],
    preserve_backup: bool,
    failure: Option<FailurePoint>,
) -> Result<AtomicWriteOutcome, AtomicWriteError> {
    atomic_write(
        project_path,
        canonical_bytes,
        WriteOptions {
            preserve_backup,
            failure,
        },
    )
}

fn atomic_write(
    project_path: &Path,
    canonical_bytes: &[u8],
    options: WriteOptions,
) -> Result<AtomicWriteOutcome, AtomicWriteError> {
    let paths = ProjectPaths::new(project_path)?;
    let (temp_path, mut temp) = create_temp(&paths, options.failure)?;

    if options.failure == Some(FailurePoint::TempWrite) {
        return Err(error(
            WriteErrorCategory::TemporaryWrite,
            "temporary write failed",
        ));
    }
    temp.write_all(canonical_bytes).map_err(|err| {
        storage_error(
            WriteErrorCategory::TemporaryWrite,
            err,
            "temporary write failed",
        )
    })?;

    if options.failure == Some(FailurePoint::TempSync) {
        return Err(error(
            WriteErrorCategory::FileFlush,
            "temporary file flush failed",
        ));
    }
    temp.sync_all().map_err(|err| {
        storage_error(
            WriteErrorCategory::FileFlush,
            err,
            "temporary file flush failed",
        )
    })?;
    let primary_exists = primary_exists(&paths.primary)?;
    let backup_created = if primary_exists && !options.preserve_backup {
        if options.failure == Some(FailurePoint::BackupRotation) {
            return Err(error(WriteErrorCategory::Backup, "backup rotation failed"));
        }
        replace_backup(&paths)?;
        sync_backup_rotation(&paths.parent, options.failure)?;
        true
    } else {
        false
    };

    if options.failure == Some(FailurePoint::PrimaryReplace) {
        return Err(error(
            WriteErrorCategory::PrimaryReplacement,
            "primary replacement failed",
        ));
    }

    // Unix permits renaming an open file, so retain the advisory lock until
    // the name is no longer a temporary path. Windows must close the handle
    // before moving it.
    #[cfg(not(unix))]
    drop(temp);
    replace_primary(&temp_path, &paths.primary)?;
    #[cfg(unix)]
    drop(temp);

    let directory_sync_supported = sync_parent(&paths.parent, options.failure)?;
    cleanup_stale_temps(&paths);

    Ok(AtomicWriteOutcome {
        backup_created,
        directory_sync_supported,
    })
}

struct ProjectPaths {
    parent: PathBuf,
    primary: PathBuf,
    backup: PathBuf,
    temp_prefix: String,
}

impl ProjectPaths {
    fn new(primary: &Path) -> Result<Self, AtomicWriteError> {
        let parent = primary
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| {
                error(
                    WriteErrorCategory::TemporaryWrite,
                    "project path has no parent directory",
                )
            })?;
        let name = primary
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                error(
                    WriteErrorCategory::TemporaryWrite,
                    "project path has no file name",
                )
            })?;
        Ok(Self {
            parent: parent.to_path_buf(),
            primary: primary.to_path_buf(),
            backup: parent.join(format!("{name}.bak")),
            temp_prefix: format!(".{name}.atomic-"),
        })
    }
}

fn create_temp(
    paths: &ProjectPaths,
    failure: Option<FailurePoint>,
) -> Result<(PathBuf, File), AtomicWriteError> {
    if failure == Some(FailurePoint::TempCreate) {
        return Err(error(
            WriteErrorCategory::TemporaryWrite,
            "temporary file creation failed",
        ));
    }
    for _ in 0..100 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = paths.parent.join(format!(
            "{}{}-{}.tmp",
            paths.temp_prefix,
            std::process::id(),
            sequence
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                // Cleanup skips locked files, so another process never
                // mistakes an in-progress temporary file for stale data.
                file.try_lock().map_err(|err| {
                    storage_error(
                        WriteErrorCategory::TemporaryWrite,
                        err.into(),
                        "temporary file lock failed",
                    )
                })?;
                return Ok((path, file));
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(storage_error(
                    WriteErrorCategory::TemporaryWrite,
                    err,
                    "temporary file creation failed",
                ));
            }
        }
    }
    Err(error(
        WriteErrorCategory::TemporaryWrite,
        "could not allocate unique temporary file",
    ))
}

fn primary_exists(primary: &Path) -> Result<bool, AtomicWriteError> {
    match fs::symlink_metadata(primary) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(storage_error(
            WriteErrorCategory::TemporaryWrite,
            err,
            "could not inspect existing project file",
        )),
    }
}

fn replace_backup(paths: &ProjectPaths) -> Result<(), AtomicWriteError> {
    #[cfg(windows)]
    if paths.backup.exists() {
        fs::remove_file(&paths.backup).map_err(|err| {
            storage_error(WriteErrorCategory::Backup, err, "backup replacement failed")
        })?;
    }
    fs::rename(&paths.primary, &paths.backup)
        .map_err(|err| storage_error(WriteErrorCategory::Backup, err, "backup rotation failed"))
}

fn replace_primary(temp: &Path, primary: &Path) -> Result<(), AtomicWriteError> {
    #[cfg(windows)]
    return replace_primary_windows(temp, primary);

    #[cfg(not(windows))]
    fs::rename(temp, primary).map_err(|err| {
        storage_error(
            WriteErrorCategory::PrimaryReplacement,
            err,
            "primary replacement failed",
        )
    })
}

/// Windows `std::fs::rename` refuses an existing destination. Removing the
/// primary first creates a destructive gap, particularly in recovery mode
/// where that primary is retained for inspection until replacement succeeds.
#[cfg(windows)]
fn replace_primary_windows(temp: &Path, primary: &Path) -> Result<(), AtomicWriteError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let temp: Vec<u16> = temp
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let primary: Vec<u16> = primary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // Same-directory MoveFileExW replacement avoids the delete-then-rename
    // gap required by std::fs::rename on Windows. WRITE_THROUGH requests that
    // the move not return before the system has flushed it.
    if unsafe {
        MoveFileExW(
            temp.as_ptr(),
            primary.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(storage_error(
            WriteErrorCategory::PrimaryReplacement,
            io::Error::last_os_error(),
            "primary replacement failed",
        ));
    }
    Ok(())
}

fn sync_backup_rotation(
    parent: &Path,
    failure: Option<FailurePoint>,
) -> Result<(), AtomicWriteError> {
    if failure == Some(FailurePoint::BackupSync) {
        return Err(error(
            WriteErrorCategory::Backup,
            "backup rotation flush failed",
        ));
    }
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|err| {
                storage_error(
                    WriteErrorCategory::Backup,
                    err,
                    "backup rotation flush failed",
                )
            })
    }
    #[cfg(not(unix))]
    {
        log::debug!("Parent directory flush is unsupported on this platform");
        Ok(())
    }
}

fn sync_parent(parent: &Path, failure: Option<FailurePoint>) -> Result<bool, AtomicWriteError> {
    if failure == Some(FailurePoint::DirectorySync) {
        return Err(error(
            WriteErrorCategory::DurabilityUncertain,
            "parent directory flush failed after replacement",
        ));
    }
    if failure == Some(FailurePoint::DirectorySyncUnsupported) {
        log::debug!("Parent directory flush is unsupported on this platform");
        return Ok(false);
    }
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            // Replacement already happened. Even permission and disk errors
            // here mean visibility may be new but power-loss durability is
            // unknown, not that the pre-replacement operation failed.
            .map_err(|_| {
                error(
                    WriteErrorCategory::DurabilityUncertain,
                    "parent directory flush failed after replacement",
                )
            })?;
        Ok(true)
    }
    #[cfg(not(unix))]
    {
        log::debug!("Parent directory flush is unsupported on this platform");
        Ok(false)
    }
}

fn cleanup_stale_temps(paths: &ProjectPaths) {
    let Ok(entries) = fs::read_dir(&paths.parent) else {
        log::debug!("Could not inspect project directory for stale atomic temporary files");
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let owned = entry.file_type().is_ok_and(|kind| kind.is_file())
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&paths.temp_prefix) && name.ends_with(".tmp"));
        if !owned {
            continue;
        }

        // Writers hold this advisory lock until their temporary name is
        // replaced. Do not delete another process's live temporary file.
        match OpenOptions::new().read(true).write(true).open(&path) {
            Ok(file) => match file.try_lock() {
                Ok(()) => {
                    drop(file);
                    if let Err(err) = fs::remove_file(&path) {
                        log::debug!("Could not remove stale atomic project temporary file: {err}");
                    }
                }
                Err(std::fs::TryLockError::WouldBlock) => {
                    log::debug!("Skipping active atomic project temporary file");
                }
                Err(std::fs::TryLockError::Error(err)) => {
                    log::debug!("Could not lock atomic project temporary file for cleanup: {err}");
                }
            },
            Err(err) => {
                log::debug!("Could not open atomic project temporary file for cleanup: {err}");
            }
        }
    }
}

fn error(category: WriteErrorCategory, message: &str) -> AtomicWriteError {
    AtomicWriteError {
        category,
        message: message.to_owned(),
    }
}

fn storage_error(
    category: WriteErrorCategory,
    source: io::Error,
    message: &str,
) -> AtomicWriteError {
    let category = match source.kind() {
        io::ErrorKind::PermissionDenied => WriteErrorCategory::PermissionDenied,
        io::ErrorKind::StorageFull => WriteErrorCategory::InsufficientSpace,
        _ => category,
    };
    error(category, message)
}
