use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{
    copy_tree_reserved, same_tree, sync_parent, sync_parent_durable, sync_tree, tree_fingerprint,
};
use super::paths::reject_symlink_components;
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::io;
use std::path::{Component, Path};

pub(super) fn create_owned_parent_dirs(root: &Path, path: &Path) -> AnyResult<()> {
    let relative = path
        .strip_prefix(root)
        .context("Owned parent escapes project root")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            bail!("Owned parent is not a normal project-relative path");
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                bail!("Symlink in owned parent path: {}", current.display());
            }
            Ok(metadata) if !metadata.is_dir() => {
                bail!("Non-directory owned parent path: {}", current.display());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&current).with_context(|| {
                    format!("Failed to create owned parent {}", current.display())
                })?;
                sync_parent_durable(current.parent().context("Owned parent has no parent")?)?;
            }
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Failed to inspect {}", current.display()));
            }
        }
    }
    Ok(())
}

pub(super) fn populate_candidate(
    root: &Path,
    source: &Path,
    candidate: &Path,
) -> AnyResult<String> {
    fail(FaultPoint::CandidateCreate)?;
    let parent = candidate.parent().context("Candidate has no parent")?;
    reject_symlink_components(root, parent)?;
    create_owned_parent_dirs(root, parent)?;
    copy_tree_reserved(source, candidate, false)?;
    fail(FaultPoint::SourceMutation)?;
    if !same_tree(source, candidate)? {
        bail!("Candidate inventory verification failed");
    }
    sync_tree(candidate)?;
    sync_parent(parent)?;
    tree_fingerprint(candidate)
}

pub(super) fn require_owned_fingerprint(
    path: &Path,
    expected: Option<&str>,
    description: &str,
) -> AnyResult<()> {
    let expected =
        expected.with_context(|| format!("{description} lacks a durable fingerprint"))?;
    if tree_fingerprint(path)? != expected {
        bail!("{description} does not match its durable fingerprint");
    }
    Ok(())
}
