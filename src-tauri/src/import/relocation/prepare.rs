use super::candidate::{populate_candidate, require_owned_fingerprint};
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt};
#[cfg(test)]
use super::fault_injection::{create_collision, take};
use super::filesystem::{
    is_already_exists, path_exists, remove_proven, rename_no_replace, sync_parent,
};
use super::journal::write_journal;
use super::paths::safe_join;
use super::planning::rawdata_source;
use super::types::{DatasetPhase, RawdataPhase, RelocationJournal, SubjectPhase};
use anyhow::Context;
use std::fs;
use std::path::Path;

pub(super) fn prepare_dataset(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if journal.dataset.phase != DatasetPhase::Planned {
        return Ok(());
    }
    let source = staging.join("rawdata/dataset_description.json");
    let candidate = safe_join(root, &journal.dataset.candidate)?;
    let destination = safe_join(root, &journal.dataset.destination)?;
    let fingerprint = populate_candidate(root, &source, &candidate)?;
    journal.dataset.fingerprint = Some(fingerprint);
    journal.dataset.phase = DatasetPhase::InstallIntent;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetInstallIntent)?;
    fail(FaultPoint::DatasetInstall).context("Dataset description install failed")?;
    #[cfg(test)]
    if take(FaultPoint::DatasetCollision) {
        create_collision(&destination)?;
    }
    require_owned_fingerprint(
        &candidate,
        journal.dataset.fingerprint.as_deref(),
        "Dataset description candidate",
    )?;
    match rename_no_replace(&candidate, &destination) {
        Ok(()) => {
            sync_parent(candidate.parent().expect("dataset candidate parent"))?;
            sync_parent(destination.parent().expect("dataset destination parent"))?;
            require_owned_fingerprint(
                &destination,
                journal.dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
            interrupt(FaultPoint::InterruptAfterDatasetInstallOperation)?;
            journal.dataset.phase = DatasetPhase::Installed;
        }
        Err(error) if is_already_exists(&error) => {
            journal.dataset.phase = DatasetPhase::ExistingWon;
            write_journal(root, journal)?;
            remove_proven(
                &candidate,
                journal.dataset.fingerprint.as_deref(),
                "dataset description candidate",
            )?;
        }
        Err(error) => {
            return Err(format!(
                "Failed to atomically install dataset description without replacement: {error}"
            )
            .into());
        }
    }
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetInstall)
}

pub(super) fn prepare_subject(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    let subject = journal.subjects[index].subject.clone();
    let source = rawdata_source(staging, &subject);
    if !path_exists(&source)? {
        return Err(format!("Missing staged rawdata directory for {subject}").into());
    }
    let metadata = fs::symlink_metadata(&source)
        .with_context(|| format!("Failed to inspect staged rawdata {}", source.display()))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("Staged rawdata for {subject} must be a regular directory").into());
    }
    if fs::read_dir(&source)
        .with_context(|| {
            format!(
                "Failed to read staged rawdata directory {}",
                source.display()
            )
        })?
        .next()
        .is_none()
    {
        return Err(format!("Empty staged rawdata directory for {subject}").into());
    }
    let candidate = safe_join(root, &journal.subjects[index].rawdata.candidate)?;
    let fingerprint = populate_candidate(root, &source, &candidate)?;
    interrupt(FaultPoint::InterruptAfterCandidatePopulationOperation)?;
    journal.subjects[index].rawdata.candidate_fingerprint = Some(fingerprint);
    journal.subjects[index].rawdata.phase = RawdataPhase::CandidateReady;
    journal.subjects[index].phase = SubjectPhase::Prepared;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterCandidateReady)
}
