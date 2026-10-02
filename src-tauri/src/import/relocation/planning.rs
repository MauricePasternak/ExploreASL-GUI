use super::filesystem::{path_exists, tree_fingerprint};
use super::paths::{owned_sibling, reject_symlink_components, relative_owned, subject_dir};
use super::types::{
    DatasetPhase, JournalDataset, JournalRawdata, JournalSubject, OwnedPathRole, RawdataPhase,
    RelocationPlan, SubjectInventory, SubjectPhase,
};
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn rawdata_source(staging: &Path, subject: &str) -> PathBuf {
    staging.join("rawdata").join(subject_dir(subject))
}

pub(super) fn planned_subject(
    root: &Path,
    plan: &RelocationPlan,
    inventory: &SubjectInventory,
) -> AnyResult<JournalSubject> {
    let destination = root.join("rawdata").join(subject_dir(&inventory.subject));
    reject_symlink_components(root, &destination)?;
    let candidate = owned_sibling(
        &destination,
        &plan.plan_id,
        &inventory.subject,
        OwnedPathRole::Candidate,
    )?;
    let backup = owned_sibling(
        &destination,
        &plan.plan_id,
        &inventory.subject,
        OwnedPathRole::Backup,
    )?;
    for reserved in [&candidate, &backup] {
        reject_symlink_components(root, reserved)?;
        if path_exists(reserved)? {
            bail!(
                "Reserved transaction path collision: {}",
                reserved.display()
            );
        }
    }
    let had_destination = path_exists(&destination)?;
    Ok(JournalSubject {
        subject: inventory.subject.clone(),
        phase: SubjectPhase::Planned,
        derived_reconciled: false,
        rawdata: JournalRawdata {
            destination: relative_owned(root, &destination)?,
            candidate: relative_owned(root, &candidate)?,
            backup: relative_owned(root, &backup)?,
            had_destination,
            phase: RawdataPhase::Planned,
            candidate_fingerprint: None,
            backup_fingerprint: had_destination
                .then(|| tree_fingerprint(&destination))
                .transpose()?,
        },
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
        let metadata = fs::symlink_metadata(&source)
            .with_context(|| format!("Failed to inspect {}", source.display()))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            bail!("Staged dataset description must be a regular file");
        }
    }
    let destination_existed = path_exists(&destination)?;
    if destination_existed {
        let metadata = fs::symlink_metadata(&destination)
            .with_context(|| format!("Failed to inspect {}", destination.display()))?;
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
    if path_exists(&candidate)? {
        bail!("Dataset description transaction candidate collision");
    }
    Ok(JournalDataset {
        source_present,
        destination_existed,
        destination: relative_owned(root, &destination)?,
        candidate: relative_owned(root, &candidate)?,
        phase,
        fingerprint: None,
    })
}
