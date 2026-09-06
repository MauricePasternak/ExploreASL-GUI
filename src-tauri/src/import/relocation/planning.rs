use super::filesystem::{path_exists, tree_fingerprint};
use super::paths::{
    log_matches_subject, owned_sibling, reject_symlink_components, relative_owned, safe_join,
    subject_dir,
};
use super::types::{
    ArtifactPhase, ArtifactRole, DatasetPhase, JournalArtifact, JournalDataset, JournalSubject,
    OwnedPathRole, RelocationEntryKind, RelocationPlan, SubjectInventory, SubjectPhase,
};
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn source_artifacts(
    root: &Path,
    staging: &Path,
    subject: &str,
) -> AnyResult<Vec<(PathBuf, PathBuf)>> {
    let sub = subject_dir(subject);
    let raw_source = staging.join("rawdata").join(&sub);
    reject_symlink_components(staging, &raw_source)?;
    // Mandatory rawdata absence remains a per-subject outcome. Preflight still
    // records its deterministic source/destination/candidate paths before any
    // project mutation; preparation enforces existence and nonemptiness.
    let mut artifacts = vec![(raw_source, root.join("rawdata").join(&sub))];
    let lock_source = crate::import::import_lock_dir_for_relocation(staging, subject);
    if path_exists(&lock_source)? {
        reject_symlink_components(staging, &lock_source)?;
        artifacts.push((
            lock_source,
            crate::import::import_lock_dir_for_relocation(root, subject),
        ));
    }
    let source_logs = staging.join("derivatives/ExploreASL/log");
    if path_exists(&source_logs)? {
        reject_symlink_components(staging, &source_logs)?;
        for entry in fs::read_dir(&source_logs).with_context(|| {
            format!(
                "Failed to read staged log directory {}",
                source_logs.display()
            )
        })? {
            let entry = entry.with_context(|| {
                format!(
                    "Failed to read entry in staged log directory {}",
                    source_logs.display()
                )
            })?;
            if log_matches_subject(&entry.file_name().to_string_lossy(), &sub) {
                reject_symlink_components(staging, &entry.path())?;
                artifacts.push((
                    entry.path(),
                    root.join("derivatives/ExploreASL/log")
                        .join(entry.file_name()),
                ));
            }
        }
    }
    artifacts.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(artifacts)
}

pub(super) fn planned_subject(
    root: &Path,
    staging: &Path,
    plan: &RelocationPlan,
    inventory: &SubjectInventory,
) -> AnyResult<JournalSubject> {
    use std::collections::BTreeMap;
    let mut members = BTreeMap::<PathBuf, Option<PathBuf>>::new();
    for (source, destination) in source_artifacts(root, staging, &inventory.subject)? {
        if members.insert(destination, Some(source)).is_some() {
            bail!("Duplicate relocation artifact destination");
        }
    }
    let lock_destination = crate::import::import_lock_dir_for_relocation(root, &inventory.subject);
    let lock_relative = relative_owned(root, &lock_destination)?;
    if inventory.entries.iter().any(|entry| {
        entry.path == lock_relative || entry.path.starts_with(&format!("{lock_relative}/"))
    }) {
        members.entry(lock_destination).or_insert(None);
    }
    for entry in &inventory.entries {
        if entry.kind != RelocationEntryKind::File
            || !entry.path.starts_with("derivatives/ExploreASL/log/")
        {
            continue;
        }
        members.entry(safe_join(root, &entry.path)?).or_insert(None);
    }
    let legacy_prefix = format!(
        "derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/{}_",
        subject_dir(&inventory.subject)
    );
    for entry in &inventory.entries {
        if !entry.path.starts_with(&legacy_prefix) {
            continue;
        }
        let relative = Path::new(&entry.path);
        if relative.components().count() == 5 {
            members.entry(safe_join(root, &entry.path)?).or_insert(None);
        }
    }
    let mut artifacts = Vec::new();
    for (destination, source) in members {
        reject_symlink_components(root, &destination)?;
        let candidate = source
            .as_ref()
            .map(|_| {
                owned_sibling(
                    &destination,
                    &plan.plan_id,
                    &inventory.subject,
                    OwnedPathRole::Candidate,
                )
            })
            .transpose()?;
        let backup = owned_sibling(
            &destination,
            &plan.plan_id,
            &inventory.subject,
            OwnedPathRole::Backup,
        )?;
        for reserved in candidate.iter().chain(std::iter::once(&backup)) {
            reject_symlink_components(root, reserved)?;
            if path_exists(reserved)? {
                bail!(
                    "Reserved transaction path collision: {}",
                    reserved.display()
                );
            }
        }
        let had_destination = path_exists(&destination)?;
        let backup_fingerprint = if had_destination {
            Some(tree_fingerprint(&destination)?)
        } else {
            None
        };
        artifacts.push(JournalArtifact {
            role: if source.is_some() {
                ArtifactRole::Replacement
            } else {
                ArtifactRole::Removal
            },
            destination: relative_owned(root, &destination)?,
            candidate: candidate
                .as_ref()
                .map(|path| relative_owned(root, path))
                .transpose()?,
            backup: Some(relative_owned(root, &backup)?),
            had_destination,
            phase: ArtifactPhase::Planned,
            candidate_fingerprint: None,
            backup_fingerprint,
            reservation_token: None,
            candidate_abandoned: false,
        });
    }
    Ok(JournalSubject {
        subject: inventory.subject.clone(),
        phase: SubjectPhase::Planned,
        artifacts,
    })
}

pub(super) fn planned_dataset(
    root: &Path,
    staging: &Path,
    plan: &RelocationPlan,
) -> AnyResult<JournalDataset> {
    let source = staging.join("rawdata/dataset_description.json");
    let destination = root.join("rawdata/dataset_description.json");
    let candidate = owned_sibling(&destination, &plan.plan_id, "run", OwnedPathRole::Candidate)?;
    reject_symlink_components(staging, &source)?;
    reject_symlink_components(root, &destination)?;
    reject_symlink_components(root, &candidate)?;
    let source_present = path_exists(&source)?;
    if source_present {
        let metadata = fs::symlink_metadata(&source).with_context(|| {
            format!(
                "Failed to inspect staged dataset description {}",
                source.display()
            )
        })?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            bail!("Staged dataset description must be a regular file");
        }
    }
    let destination_existed = path_exists(&destination)?;
    if destination_existed {
        let metadata = fs::symlink_metadata(&destination).with_context(|| {
            format!(
                "Failed to inspect dataset description {}",
                destination.display()
            )
        })?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            bail!("Existing dataset description must be a regular file");
        }
    }
    let phase = if !source_present {
        DatasetPhase::NotRequired
    } else if destination_existed {
        DatasetPhase::ExistingWon
    } else {
        DatasetPhase::Planned
    };
    if phase == DatasetPhase::Planned && path_exists(&candidate)? {
        bail!("Dataset description transaction candidate collision");
    }
    Ok(JournalDataset {
        source_present,
        destination_existed,
        destination: relative_owned(root, &destination)?,
        candidate: relative_owned(root, &candidate)?,
        phase,
        fingerprint: None,
        reservation_token: None,
        candidate_abandoned: false,
    })
}
