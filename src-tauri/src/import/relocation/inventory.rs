use super::filesystem::path_exists;
use super::paths::{
    canonical_project_root_result, log_matches_subject, project_identity,
    reject_symlink_components, relative_path, safe_join, subject_dir,
};
use super::types::{RelocationEntry, RelocationEntryKind, RelocationPlan, SubjectInventory};
use anyhow::{Context, Result as AnyResult, bail};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

fn inspect_tree(root: &Path, path: &Path, entries: &mut Vec<RelocationEntry>) -> AnyResult<()> {
    let metadata = fs::symlink_metadata(path).with_context(|| {
        format!(
            "Failed to inspect relocation inventory path {}",
            path.display()
        )
    })?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        bail!(
            "Symlinks are not supported in relocation inventory: {}",
            path.display()
        );
    }
    let relative = relative_path(root, path)?;
    if file_type.is_dir() {
        entries.push(RelocationEntry {
            path: relative,
            kind: RelocationEntryKind::Directory,
            bytes: 0,
        });
        let mut children = fs::read_dir(path)
            .with_context(|| {
                format!(
                    "Failed to read relocation inventory directory {}",
                    path.display()
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| {
                format!(
                    "Failed to read entry in relocation inventory directory {}",
                    path.display()
                )
            })?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            inspect_tree(root, &child.path(), entries)?;
        }
    } else if file_type.is_file() {
        entries.push(RelocationEntry {
            path: relative,
            kind: RelocationEntryKind::File,
            bytes: metadata.len(),
        });
    } else {
        bail!(
            "Unsupported filesystem entry in relocation inventory: {}",
            path.display()
        );
    }
    Ok(())
}

fn inventory_paths(
    root: &Path,
    paths: impl IntoIterator<Item = PathBuf>,
    subject: &str,
) -> AnyResult<SubjectInventory> {
    let mut entries = Vec::new();
    for path in paths {
        reject_symlink_components(root, &path)?;
        if path_exists(&path)? {
            inspect_tree(root, &path, &mut entries)?;
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    let sessions = entries
        .iter()
        .filter_map(|entry| {
            let mut parts = entry.path.split('/');
            match (parts.next(), parts.next(), parts.next()) {
                (Some("rawdata"), Some(_), Some(session)) if session.starts_with("ses-") => {
                    Some(session.to_string())
                }
                _ => None,
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let file_count = entries
        .iter()
        .filter(|entry| entry.kind == RelocationEntryKind::File)
        .count() as u64;
    let byte_total = entries.iter().map(|entry| entry.bytes).sum();
    let fingerprint = fingerprint_entries(root, &entries)?;
    Ok(SubjectInventory {
        subject: subject.to_string(),
        entries,
        file_count,
        byte_total,
        sessions,
        fingerprint,
    })
}

fn fingerprint_entries(root: &Path, entries: &[RelocationEntry]) -> AnyResult<String> {
    let mut hash = Sha256::new();
    for entry in entries {
        hash.update(entry.path.as_bytes());
        hash.update([0]);
        hash.update(match entry.kind {
            RelocationEntryKind::File => b"f",
            RelocationEntryKind::Directory => b"d",
        });
        hash.update([0]);
        hash.update(entry.bytes.to_le_bytes());
        hash.update([0]);
        if entry.kind == RelocationEntryKind::File {
            let path = safe_join(root, &entry.path)?;
            let mut file = File::open(&path)
                .with_context(|| format!("Failed to open inventory file {}", path.display()))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file
                    .read(&mut buffer)
                    .with_context(|| format!("Failed to read inventory file {}", path.display()))?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn inventory_subject(project_root: &Path, subject: &str) -> Result<SubjectInventory, String> {
    inventory_subject_result(project_root, subject).map_err(|error| format!("{error:#}"))
}

pub(super) fn inventory_subject_result(
    project_root: &Path,
    subject: &str,
) -> AnyResult<SubjectInventory> {
    crate::import::validate_subject_components(&[subject.to_string()])
        .map_err(anyhow::Error::msg)?;
    let root = canonical_project_root_result(project_root)?;
    let sub = subject_dir(subject);
    let mut paths = vec![
        root.join("rawdata").join(&sub),
        crate::import::import_lock_dir_for_relocation(&root, subject),
    ];
    let log_root = root.join("derivatives/ExploreASL/log");
    if path_exists(&log_root)? {
        reject_symlink_components(&root, &log_root)?;
        for entry in fs::read_dir(&log_root)
            .with_context(|| format!("Failed to read log directory {}", log_root.display()))?
        {
            let entry = entry.with_context(|| {
                format!(
                    "Failed to read entry in log directory {}",
                    log_root.display()
                )
            })?;
            if log_matches_subject(&entry.file_name().to_string_lossy(), &sub) {
                paths.push(entry.path());
            }
        }
    }
    let legacy_root = root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    if path_exists(&legacy_root)? {
        reject_symlink_components(&root, &legacy_root)?;
        let prefix = format!("{sub}_");
        for entry in fs::read_dir(&legacy_root).with_context(|| {
            format!(
                "Failed to read legacy lock directory {}",
                legacy_root.display()
            )
        })? {
            let entry = entry.with_context(|| {
                format!(
                    "Failed to read entry in legacy lock directory {}",
                    legacy_root.display()
                )
            })?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                paths.push(entry.path());
            }
        }
    }
    inventory_paths(&root, paths, subject)
}

pub fn plan_relocation(project_root: &Path, subjects: &[String]) -> Result<RelocationPlan, String> {
    create_plan(project_root, subjects, "test-plan".to_string())
}

pub fn create_plan(
    project_root: &Path,
    subjects: &[String],
    plan_id: String,
) -> Result<RelocationPlan, String> {
    create_plan_result(project_root, subjects, plan_id).map_err(|error| format!("{error:#}"))
}

pub(super) fn create_plan_result(
    project_root: &Path,
    subjects: &[String],
    plan_id: String,
) -> AnyResult<RelocationPlan> {
    crate::import::validate_subject_components(subjects).map_err(anyhow::Error::msg)?;
    if subjects.is_empty() {
        bail!("Relocation plan requires at least one subject");
    }
    let root = canonical_project_root_result(project_root)?;
    let mut seen = BTreeSet::new();
    let mut inventories = Vec::new();
    for subject in subjects {
        let key = crate::import::staging::portable_key(subject);
        if !seen.insert(key) {
            bail!("Relocation plan subjects must be portable-unique");
        }
        inventories.push(inventory_subject_result(&root, subject)?);
    }
    let mut hash = Sha256::new();
    for inventory in &inventories {
        hash.update(inventory.subject.as_bytes());
        hash.update([0]);
        hash.update(inventory.fingerprint.as_bytes());
    }
    Ok(RelocationPlan {
        plan_id,
        subjects: inventories,
        fingerprint: format!("{:x}", hash.finalize()),
        project_identity: project_identity(&root),
        project_root: root,
        bound_generation: None,
    })
}

pub fn validate_plan_scope(
    plan: &RelocationPlan,
    project_root: &Path,
    subjects: &[String],
) -> Result<(), String> {
    validate_plan_scope_result(plan, project_root, subjects).map_err(|error| format!("{error:#}"))
}

pub(super) fn validate_plan_scope_result(
    plan: &RelocationPlan,
    project_root: &Path,
    subjects: &[String],
) -> AnyResult<()> {
    let root = canonical_project_root_result(project_root)?;
    if plan.project_root != root || plan.project_identity != project_identity(&root) {
        bail!("Relocation plan belongs to another project");
    }
    if plan.bound_generation.is_some() {
        bail!("Relocation plan has already been used");
    }
    let planned = plan
        .subjects
        .iter()
        .map(|inventory| crate::import::staging::portable_key(&inventory.subject))
        .collect::<Vec<_>>();
    let requested = subjects
        .iter()
        .map(|subject| crate::import::staging::portable_key(subject))
        .collect::<Vec<_>>();
    if planned != requested {
        bail!("Relocation plan does not match the selected subject scope");
    }
    Ok(())
}

pub fn bind_plan(
    plan: &mut RelocationPlan,
    project_root: &Path,
    subjects: &[String],
    generation: u64,
) -> Result<(), String> {
    bind_plan_result(plan, project_root, subjects, generation).map_err(|error| format!("{error:#}"))
}

pub(super) fn bind_plan_result(
    plan: &mut RelocationPlan,
    project_root: &Path,
    subjects: &[String],
    generation: u64,
) -> AnyResult<()> {
    validate_plan_scope_result(plan, project_root, subjects)?;
    plan.bound_generation = Some(generation);
    Ok(())
}
