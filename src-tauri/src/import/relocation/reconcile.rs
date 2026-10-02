use super::candidate::create_owned_parent_dirs;
use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{
    copy_tree_reserved, path_exists, remove_proven, same_tree, sync_parent, sync_tree,
};
use super::paths::{log_matches_subject, reject_symlink_components, subject_dir};
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};

fn matching_children(
    root: &Path,
    directory: &Path,
    matches: impl Fn(&str) -> bool,
) -> AnyResult<Vec<PathBuf>> {
    if !path_exists(directory)? {
        return Ok(Vec::new());
    }
    reject_symlink_components(root, directory)?;
    let metadata = fs::symlink_metadata(directory)
        .with_context(|| format!("Failed to inspect {}", directory.display()))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        bail!("Derived artifact parent must be a regular directory");
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)
        .with_context(|| format!("Failed to read {}", directory.display()))?
    {
        let entry =
            entry.with_context(|| format!("Failed to read entry in {}", directory.display()))?;
        if matches(&entry.file_name().to_string_lossy()) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

fn remove_path(root: &Path, path: &Path, description: &str) -> AnyResult<()> {
    reject_symlink_components(root, path)?;
    if path_exists(path)? {
        remove_proven(path, None, description)?;
        sync_parent(path.parent().context("Derived artifact has no parent")?)?;
    }
    Ok(())
}

fn copy_path(root: &Path, source_root: &Path, source: &Path, destination: &Path) -> AnyResult<()> {
    reject_symlink_components(source_root, source)?;
    reject_symlink_components(root, destination)?;
    create_owned_parent_dirs(
        root,
        destination.parent().context("Destination has no parent")?,
    )?;
    copy_tree_reserved(source, destination, false)?;
    if !same_tree(source, destination)? {
        bail!("Derived artifact copy verification failed");
    }
    sync_tree(destination)?;
    sync_parent(destination.parent().expect("destination parent"))
}

pub(super) fn reconcile_subject(root: &Path, staging: &Path, subject: &str) -> AnyResult<()> {
    let lock_source = crate::import::import_lock_dir_for_relocation(staging, subject);
    let lock_destination = crate::import::import_lock_dir_for_relocation(root, subject);
    remove_path(root, &lock_destination, "subject import lock")?;
    fail(FaultPoint::AncillaryInstall)?;
    if path_exists(&lock_source)? {
        copy_path(root, staging, &lock_source, &lock_destination)?;
    }

    let sub = subject_dir(subject);
    let log_source_root = staging.join("derivatives/ExploreASL/log");
    let log_destination_root = root.join("derivatives/ExploreASL/log");
    for path in matching_children(root, &log_destination_root, |name| {
        log_matches_subject(name, &sub)
    })? {
        remove_path(root, &path, "subject import log")?;
    }
    for source in matching_children(staging, &log_source_root, |name| {
        log_matches_subject(name, &sub)
    })? {
        let destination = log_destination_root.join(source.file_name().expect("log name"));
        copy_path(root, staging, &source, &destination)?;
    }

    let legacy_root = root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    let prefix = format!("{sub}_");
    for path in matching_children(root, &legacy_root, |name| name.starts_with(&prefix))? {
        remove_path(root, &path, "subject BIDS2Legacy lock")?;
    }
    Ok(())
}
