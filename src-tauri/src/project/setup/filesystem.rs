//! Fixed-path inspection and durable file writes for project setup.
use super::fault_injection::fail;
use super::{MarkerClassification, RAWDATA_MARKER_BYTES, RAWDATA_MARKER_PATH};
use crate::fs_safety::{atomic_replace, sync_directory};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;

pub(super) const MAX_TEXT_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum EntryKind {
    Missing,
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Fingerprint {
    pub(super) kind: EntryKind,
    pub(super) hash: Option<String>,
    pub(super) len: Option<u64>,
}

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn random_id(label: &str) -> String {
    format!("{label}-{}", uuid::Uuid::new_v4())
}

pub(super) fn canonical_root(root: &Path) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(root).context("Could not inspect selected project root")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("Selected project root must be a real directory");
    }
    root.canonicalize()
        .context("Could not canonicalize selected project root")
}

/// Fixed paths never accept a renderer or journal-controlled traversal component.
pub(super) fn safe_relative(relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        bail!("Unsafe project-relative setup path");
    }
    Ok(path.to_path_buf())
}
pub(super) fn fixed_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let rel = safe_relative(relative)?;
    if !matches!(
        relative,
        "project.easl" | ".bidsignore" | "rawdata" | RAWDATA_MARKER_PATH
    ) {
        bail!("Unsupported setup path");
    }
    Ok(root.join(rel))
}

/// Verify every existing component below `root` immediately before a fixed
/// path is opened or renamed. `symlink_metadata` intentionally does not
/// follow a replacement symlink. This cannot make path names atomic on every
/// platform, but paired with no-follow file opens and post-mutation checks it
/// fails closed on observable swaps.
pub(super) fn validate_fixed_hierarchy(root: &Path, path: &Path) -> Result<()> {
    let root_meta = fs::symlink_metadata(root)
        .with_context(|| format!("Could not inspect setup root {}", root.display()))?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        bail!("Setup root changed or is unsafe");
    }
    let relative = path.strip_prefix(root).context("Setup path escaped root")?;
    let mut current = root.to_path_buf();
    let parts = relative.components().collect::<Vec<_>>();
    for component in parts.iter().take(parts.len().saturating_sub(1)) {
        let Component::Normal(name) = component else {
            bail!("Unsafe project-relative setup path");
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current)
            .with_context(|| format!("Could not inspect setup parent {}", current.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            bail!("Setup parent changed or is unsafe: {}", current.display());
        }
    }
    Ok(())
}

fn open_regular_no_follow(path: &Path) -> Result<File> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Could not inspect {}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("{} must be a regular non-symlink file", path.display());
    }
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Setup file has no parent"))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        bail!("Setup file parent is unsafe: {}", parent.display());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    // OPEN_REPARSE_POINT opens the link itself on Windows. The metadata check
    // below therefore rejects it instead of reading its target.
    #[cfg(windows)]
    options.custom_flags(0x0020_0000);
    let file = options
        .open(path)
        .with_context(|| format!("Could not read {} without following links", path.display()))?;
    let opened = file.metadata()?;
    if !opened.is_file() {
        bail!(
            "{} changed to a non-regular file while opening",
            path.display()
        );
    }
    let after = fs::symlink_metadata(path)?;
    if after.file_type().is_symlink() || !after.is_file() || after.len() != opened.len() {
        bail!("{} changed while opening", path.display());
    }
    Ok(file)
}

pub(super) fn read_bounded(path: &Path, expected: u64) -> Result<Vec<u8>> {
    if expected > MAX_TEXT_BYTES {
        bail!(
            "{} exceeds the {} byte inspection limit",
            path.display(),
            MAX_TEXT_BYTES
        );
    }
    let mut file = open_regular_no_follow(path)?;
    let mut bytes = Vec::with_capacity(expected as usize);
    Read::by_ref(&mut file)
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        bail!("{} exceeds inspection limit", path.display());
    }
    Ok(bytes)
}
pub(super) fn inspect(path: &Path, read_bytes: bool) -> Result<Fingerprint> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if matches!(error.kind(), io::ErrorKind::NotFound) => {
            return Ok(Fingerprint {
                kind: EntryKind::Missing,
                hash: None,
                len: None,
            });
        }
        Err(error) if matches!(error.kind(), io::ErrorKind::NotADirectory) => {
            return Ok(Fingerprint {
                kind: EntryKind::Missing,
                hash: None,
                len: None,
            });
        }
        Err(error) => {
            return Err(error).with_context(|| format!("Could not inspect {}", path.display()));
        }
    };
    let kind = if metadata.file_type().is_symlink() {
        EntryKind::Symlink
    } else if metadata.is_file() {
        EntryKind::File
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::Other
    };
    if read_bytes && kind == EntryKind::File {
        // A too-large controlled text file is a planning conflict. Preserve a
        // metadata-only observation so preflight can report it without reading
        // or changing it.
        if metadata.len() > MAX_TEXT_BYTES {
            return Ok(Fingerprint {
                kind,
                hash: None,
                len: Some(metadata.len()),
            });
        }
        let bytes = read_bounded(path, metadata.len())?;
        return Ok(Fingerprint {
            kind,
            hash: Some(hash(&bytes)),
            len: Some(bytes.len() as u64),
        });
    }
    Ok(Fingerprint {
        kind,
        hash: None,
        len: Some(metadata.len()),
    })
}
pub(super) fn read_regular(path: &Path) -> Result<Option<Vec<u8>>> {
    match inspect(path, true)? {
        Fingerprint {
            kind: EntryKind::Missing,
            ..
        } => Ok(None),
        Fingerprint {
            kind: EntryKind::File,
            len: Some(len),
            ..
        } => Ok(Some(read_bounded(path, len)?)),
        Fingerprint {
            kind: EntryKind::Symlink,
            ..
        } => bail!("{} must not be a symbolic link", path.display()),
        _ => bail!("{} must be a regular file", path.display()),
    }
}

pub fn classify_marker(root: &Path) -> Result<MarkerClassification> {
    let root = canonical_root(root)?;
    let rawdata = fixed_path(&root, "rawdata")?;
    match inspect(&rawdata, false)?.kind {
        EntryKind::Missing => return Ok(MarkerClassification::Absent),
        EntryKind::Directory => validate_fixed_hierarchy(&root, &rawdata)?,
        _ => return Ok(MarkerClassification::Unsafe),
    }
    let marker = fixed_path(&root, RAWDATA_MARKER_PATH)?;
    match read_regular(&marker) {
        Ok(None) => Ok(MarkerClassification::Absent),
        Ok(Some(bytes)) if bytes == RAWDATA_MARKER_BYTES => Ok(MarkerClassification::Exact),
        Ok(Some(_)) => Ok(MarkerClassification::Foreign),
        Err(_) => Ok(MarkerClassification::Unsafe),
    }
}

pub(super) fn sync_parent(path: &Path) -> Result<bool> {
    fail("flush")?;
    sync_directory(path)
        .map(|outcome| outcome.is_supported())
        .with_context(|| format!("Could not synchronize directory {}", path.display()))
}
pub(super) fn persist_bytes(path: &Path, bytes: &[u8], replace: bool) -> Result<bool> {
    let parent = path.parent().ok_or_else(|| anyhow!("Path has no parent"))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Could not create app-data directory {}", parent.display()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|x| x.to_str()).unwrap_or("setup"),
        random_id("write")
    ));
    let result = (|| -> Result<bool> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if replace && fs::symlink_metadata(path).is_ok() {
            atomic_replace(&temporary, path)?;
        } else {
            fs::rename(&temporary, path)?;
        }
        sync_parent(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
pub(super) fn persist_new_bytes(path: &Path, bytes: &[u8]) -> Result<bool> {
    let parent = path.parent().ok_or_else(|| anyhow!("Path has no parent"))?;
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = (|| -> Result<bool> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        sync_parent(parent)
    })();
    if result.is_err() && fs::read(path).ok().as_deref() == Some(bytes) {
        let _ = fs::remove_file(path);
    }
    result
}

pub(super) fn owned_sibling(
    destination: &Path,
    transaction: &str,
    role: &str,
    suffix: &str,
) -> Result<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Setup destination has no parent"))?;
    let name = destination
        .file_name()
        .and_then(|x| x.to_str())
        .ok_or_else(|| anyhow!("Setup destination has invalid filename"))?;
    if !transaction.starts_with("transaction-") || !suffix.chars().all(|x| x.is_ascii_digit()) {
        bail!("Invalid setup owned path identity");
    }
    Ok(parent.join(format!(".{name}.easl-setup-{transaction}-{role}-{suffix}")))
}
pub(super) fn relative_to_root(root: &Path, path: &Path) -> Result<String> {
    path.strip_prefix(root)
        .context("Setup path escaped root")?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Setup path is not UTF-8"))
}

/// Locate an unrecorded owned sibling only by its random transaction identity
/// and expected fingerprint. This covers a crash after the mutation but before
/// its completion journal write; a filename alone is never accepted.
pub(super) fn find_owned_sibling(
    destination: &Path,
    transaction: &str,
    role: &str,
    expected: &Fingerprint,
) -> Result<Option<PathBuf>> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Setup destination has no parent"))?;
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("Setup destination has invalid filename"))?;
    let prefix = format!(".{name}.easl-setup-{transaction}-{role}-");
    let mut matches = Vec::new();
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        // A candidate/backup under a directory that was never created cannot
        // exist. This is the normal rollback state after an interruption
        // before rawdata creation, not ambiguous ownership.
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let path = entry.path();
        if inspect(&path, true)? == *expected {
            matches.push(path);
        } else {
            bail!("Transaction-owned setup sibling has ambiguous content");
        }
    }
    if matches.len() > 1 {
        bail!("Multiple transaction-owned setup siblings are ambiguous");
    }
    Ok(matches.pop())
}
