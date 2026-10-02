use super::fault_injection::{FaultPoint, fail, take};
pub(crate) use crate::fs_safety::{atomic_replace, rename_no_replace, sync_directory};
use anyhow::{Context, Result as AnyResult, bail};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::Path;

pub(super) fn path_exists(path: &Path) -> AnyResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("Failed to inspect {}", path.display())),
    }
}

pub(super) fn is_already_exists(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::AlreadyExists
        || matches!(error.raw_os_error(), Some(libc::EEXIST))
        || cfg!(windows) && matches!(error.raw_os_error(), Some(80) | Some(183))
}

pub(super) fn sync_parent(path: &Path) -> AnyResult<()> {
    fail(FaultPoint::ParentSync)?;
    sync_parent_durable(path)
}

pub(crate) fn sync_parent_durable(path: &Path) -> AnyResult<()> {
    sync_directory(path).with_context(|| {
        format!(
            "Failed to synchronize transaction directory {}",
            path.display()
        )
    })?;
    Ok(())
}

pub(super) fn same_tree(source: &Path, candidate: &Path) -> AnyResult<bool> {
    let source_metadata = fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect source {}", source.display()))?;
    let candidate_metadata = fs::symlink_metadata(candidate)
        .with_context(|| format!("Failed to inspect candidate {}", candidate.display()))?;
    if source_metadata.file_type().is_symlink() || candidate_metadata.file_type().is_symlink() {
        bail!("Symlink in candidate verification");
    }
    if source_metadata.is_file() && candidate_metadata.is_file() {
        if source_metadata.len() != candidate_metadata.len() {
            return Ok(false);
        }
        return Ok(file_hash(source)? == file_hash(candidate)?);
    }
    if !source_metadata.is_dir() || !candidate_metadata.is_dir() {
        return Ok(false);
    }
    let mut source_entries = fs::read_dir(source)
        .with_context(|| format!("Failed to read source directory {}", source.display()))?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| {
            format!(
                "Failed to read entry in source directory {}",
                source.display()
            )
        })?;
    let mut candidate_entries = fs::read_dir(candidate)
        .with_context(|| format!("Failed to read candidate directory {}", candidate.display()))?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| {
            format!(
                "Failed to read entry in candidate directory {}",
                candidate.display()
            )
        })?;
    source_entries.sort_by_key(|entry| entry.file_name());
    candidate_entries.sort_by_key(|entry| entry.file_name());
    if source_entries.len() != candidate_entries.len() {
        return Ok(false);
    }
    for (source_entry, candidate_entry) in source_entries.iter().zip(candidate_entries.iter()) {
        if source_entry.file_name() != candidate_entry.file_name()
            || !same_tree(&source_entry.path(), &candidate_entry.path())?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn file_hash(path: &Path) -> AnyResult<String> {
    fail(FaultPoint::HashVerification)?;
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open file for hashing {}", path.display()))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .with_context(|| format!("Failed to read file while hashing {}", path.display()))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn copy_tree_reserved(
    source: &Path,
    destination: &Path,
    root_reserved: bool,
) -> AnyResult<()> {
    fail(FaultPoint::RecursiveCopy)?;
    let metadata = fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect relocation source {}", source.display()))?;
    if metadata.file_type().is_symlink() {
        bail!("Symlinks are not supported in relocation source");
    }
    if metadata.is_dir() {
        if !root_reserved {
            fs::create_dir(destination).with_context(|| {
                format!(
                    "Failed to exclusively create candidate directory {}",
                    destination.display()
                )
            })?;
        }
        let mut entries = fs::read_dir(source)
            .with_context(|| format!("Failed to read relocation source {}", source.display()))?
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| {
                format!(
                    "Failed to read entry in relocation source {}",
                    source.display()
                )
            })?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_tree_reserved(&entry.path(), &destination.join(entry.file_name()), false)?;
        }
    } else if metadata.is_file() {
        if take(FaultPoint::InsufficientSpace) {
            let error = io::Error::from_raw_os_error(libc::ENOSPC);
            return Err(anyhow::Error::new(error).context(format!(
                "Insufficient space while copying {}",
                source.display()
            )));
        }
        let mut input = File::open(source)
            .with_context(|| format!("Failed to open relocation source {}", source.display()))?;
        let mut output = if root_reserved {
            OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(destination)
        } else {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination)
        }
        .with_context(|| format!("Failed to create candidate file {}", destination.display()))?;
        io::copy(&mut input, &mut output).map_err(|error| {
            let message = if error.raw_os_error() == Some(libc::ENOSPC) {
                format!("Insufficient space while copying {}", source.display())
            } else {
                format!("Failed to copy {}", source.display())
            };
            anyhow::Error::new(error).context(message)
        })?;
        fail(FaultPoint::FileSync)?;
        output.sync_all().with_context(|| {
            format!(
                "Failed to synchronize candidate file {}",
                destination.display()
            )
        })?;
    } else {
        bail!("Unsupported filesystem entry in relocation source");
    }
    Ok(())
}

pub(super) fn sync_tree(path: &Path) -> AnyResult<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Failed to inspect transaction candidate {}", path.display()))?;
    if metadata.file_type().is_symlink() {
        bail!("Symlink in transaction candidate");
    }
    if metadata.is_file() {
        File::open(path)
            .and_then(|file| file.sync_all())
            .with_context(|| format!("Failed to synchronize candidate file {}", path.display()))?;
    } else if metadata.is_dir() {
        for entry in fs::read_dir(path)
            .with_context(|| format!("Failed to read candidate directory {}", path.display()))?
        {
            let entry = entry.with_context(|| {
                format!(
                    "Failed to read entry in candidate directory {}",
                    path.display()
                )
            })?;
            sync_tree(&entry.path())?;
        }
        sync_parent(path)?;
    } else {
        bail!("Unsupported transaction candidate entry");
    }
    Ok(())
}

pub(super) fn hash_tree(path: &Path, base: &Path, hash: &mut Sha256) -> AnyResult<()> {
    let metadata = fs::symlink_metadata(path).with_context(|| {
        format!(
            "Failed to inspect artifact while hashing {}",
            path.display()
        )
    })?;
    if metadata.file_type().is_symlink() {
        bail!("Symlink in owned transaction artifact");
    }
    let relative = path
        .strip_prefix(base)
        .context("Artifact path escaped fingerprint root")?;
    hash.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
    if metadata.is_dir() {
        hash.update(b"d\0");
        let mut entries = fs::read_dir(path)
            .with_context(|| format!("Failed to read artifact directory {}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| {
                format!(
                    "Failed to read entry in artifact directory {}",
                    path.display()
                )
            })?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            hash_tree(&entry.path(), base, hash)?;
        }
    } else if metadata.is_file() {
        hash.update(b"f\0");
        hash.update(metadata.len().to_le_bytes());
        let mut file = File::open(path)
            .with_context(|| format!("Failed to open artifact for hashing {}", path.display()))?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).with_context(|| {
                format!("Failed to read artifact while hashing {}", path.display())
            })?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
    } else {
        bail!("Unsupported owned transaction artifact");
    }
    Ok(())
}

pub(super) fn tree_fingerprint(path: &Path) -> AnyResult<String> {
    let mut hash = Sha256::new();
    hash_tree(path, path, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn remove_proven(path: &Path, expected: Option<&str>, ownership: &str) -> AnyResult<()> {
    if !path_exists(path)? {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Failed to inspect {ownership} at {}", path.display()))?;
    if metadata.file_type().is_symlink() {
        bail!("Refusing to remove symlink at {ownership}");
    }
    if let Some(expected) = expected {
        let actual = tree_fingerprint(path)?;
        if actual != expected {
            bail!("Refusing to remove changed or unowned {ownership}");
        }
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .with_context(|| format!("Failed to remove {ownership} at {}", path.display()))
    } else if metadata.is_file() {
        fs::remove_file(path)
            .with_context(|| format!("Failed to remove {ownership} at {}", path.display()))
    } else {
        bail!("Refusing to remove unsupported {ownership}")
    }
}
