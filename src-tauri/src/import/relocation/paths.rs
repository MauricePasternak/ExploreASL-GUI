use super::types::OwnedPathRole;
use anyhow::{Context, Result as AnyResult, bail};
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub(super) fn subject_dir(subject: &str) -> String {
    if subject.starts_with("sub-") {
        subject.to_string()
    } else {
        format!("sub-{subject}")
    }
}

pub fn canonical_project_root(project_root: &Path) -> Result<PathBuf, String> {
    canonical_project_root_result(project_root).map_err(|error| format!("{error:#}"))
}

pub(super) fn canonical_project_root_result(project_root: &Path) -> AnyResult<PathBuf> {
    let root = fs::canonicalize(project_root).with_context(|| {
        format!(
            "Failed to canonicalize project root {}",
            project_root.display()
        )
    })?;
    if !root.is_dir() {
        bail!("Project root must be a directory");
    }
    if fs::symlink_metadata(&root)
        .with_context(|| format!("Failed to inspect project root {}", root.display()))?
        .file_type()
        .is_symlink()
    {
        bail!("Project root must not be a symlink");
    }
    Ok(root)
}

pub(super) fn project_identity(root: &Path) -> String {
    sha256_bytes(root.to_string_lossy().as_bytes())
}
pub(super) fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn relative_path(root: &Path, path: &Path) -> AnyResult<String> {
    let relative = path
        .strip_prefix(root)
        .context("Path escapes project root")?;
    validate_relative_path_result(relative)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub fn validate_relative_path(path: &Path) -> Result<(), String> {
    validate_relative_path_result(path).map_err(|error| format!("{error:#}"))
}

pub(super) fn validate_relative_path_result(path: &Path) -> AnyResult<()> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        bail!("Journal path must be a nonempty relative path");
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            bail!("Unsafe journal path: {}", path.display());
        }
    }
    Ok(())
}

pub(super) fn safe_join(root: &Path, relative: &str) -> AnyResult<PathBuf> {
    let relative = Path::new(relative);
    validate_relative_path_result(relative)?;
    let path = root.join(relative);
    reject_symlink_components(root, &path)?;
    if path.parent().is_some_and(|parent| parent.exists()) {
        let canonical_parent = fs::canonicalize(path.parent().expect("parent checked"))
            .with_context(|| {
                format!(
                    "Failed to canonicalize transaction parent {}",
                    path.parent().expect("parent checked").display()
                )
            })?;
        if !canonical_parent.starts_with(root) {
            bail!("Transaction path escapes project root");
        }
    }
    Ok(path)
}

pub(super) fn candidate_record_path(root: &Path, relative: &str) -> AnyResult<PathBuf> {
    let relative = Path::new(relative);
    validate_relative_path_result(relative)?;
    let path = root.join(relative);
    let parent = path.parent().context("Candidate path has no parent")?;
    reject_symlink_components(root, parent)?;
    if parent.exists() {
        let canonical_parent = fs::canonicalize(parent).with_context(|| {
            format!(
                "Failed to canonicalize candidate parent {}",
                parent.display()
            )
        })?;
        if !canonical_parent.starts_with(root) {
            bail!("Candidate path escapes project root");
        }
    }
    Ok(path)
}

pub(super) fn reject_symlink_components(root: &Path, path: &Path) -> AnyResult<()> {
    let relative = path
        .strip_prefix(root)
        .context("Transaction path escapes project root")?;
    let mut current = root.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(component) = component else {
            bail!("Transaction path is not a normal relative path");
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                bail!("Symlink in transaction path: {}", current.display());
            }
            Ok(metadata) if components.peek().is_some() && !metadata.is_dir() => {
                bail!(
                    "Non-directory intermediate transaction path: {}",
                    current.display()
                );
            }
            Ok(_) => {}
            // Once an ancestor is absent, every remaining child is absent too.
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Failed to inspect {}", current.display()));
            }
        }
    }
    Ok(())
}

pub(super) fn owned_sibling(
    destination: &Path,
    plan_id: &str,
    subject: &str,
    role: OwnedPathRole,
) -> AnyResult<PathBuf> {
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .context("Destination has no name")?;
    let parent = destination.parent().context("Destination has no parent")?;
    let token = plan_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    if token.is_empty() {
        bail!("Invalid relocation plan identity");
    }
    Ok(parent.join(format!(
        ".{name}.easl-relocation-{token}-{subject}-{}",
        role.as_str()
    )))
}

pub(super) fn relative_owned(root: &Path, path: &Path) -> AnyResult<String> {
    relative_path(root, path)
}

pub(super) fn log_matches_subject(name: &str, sub: &str) -> bool {
    name.match_indices(sub).any(|(index, _)| {
        let before = name[..index].chars().next_back();
        let after = name[index + sub.len()..].chars().next();
        !before.is_some_and(|character| character.is_ascii_alphanumeric())
            && !after.is_some_and(|character| character.is_ascii_alphanumeric())
    })
}
