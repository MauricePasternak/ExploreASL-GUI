use super::candidate::require_owned_fingerprint;
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt};
use super::filesystem::{
    path_exists, remove_proven, rename_no_replace, sync_parent, tree_fingerprint,
};
use super::journal::write_journal;
use super::paths::safe_join;
use super::types::{DatasetPhase, JournalRawdata, RawdataPhase, RelocationJournal, SubjectPhase};
use anyhow::{Context, Result as AnyResult};
use std::path::Path;

fn fingerprint_matches(path: &Path, expected: Option<&str>) -> AnyResult<bool> {
    Ok(expected
        .is_some_and(|expected| tree_fingerprint(path).is_ok_and(|actual| actual == expected)))
}

pub(super) fn cleanup_candidate(root: &Path, rawdata: &JournalRawdata) -> AnyResult<()> {
    let candidate = safe_join(root, &rawdata.candidate)?;
    if path_exists(&candidate)? {
        remove_proven(
            &candidate,
            rawdata.candidate_fingerprint.as_deref(),
            "rawdata candidate",
        )?;
        sync_parent(candidate.parent().context("Candidate has no parent")?)?;
    }
    Ok(())
}

pub(super) fn rollback_subject(
    root: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    fail(FaultPoint::Rollback)?;
    if journal.subjects[index].rawdata.phase != RawdataPhase::RollbackIntent {
        journal.subjects[index].rawdata.phase = RawdataPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    interrupt(FaultPoint::InterruptRollbackAfterIntent)?;
    let rawdata = journal.subjects[index].rawdata.clone();
    let destination = safe_join(root, &rawdata.destination)?;
    let backup = safe_join(root, &rawdata.backup)?;
    let destination_exists = path_exists(&destination)?;
    let backup_exists = path_exists(&backup)?;

    if backup_exists {
        require_owned_fingerprint(
            &backup,
            rawdata.backup_fingerprint.as_deref(),
            "Rollback rawdata backup",
        )?;
    }
    if rawdata.had_destination {
        if backup_exists {
            if destination_exists {
                if !fingerprint_matches(&destination, rawdata.candidate_fingerprint.as_deref())? {
                    return Err("Unowned destination prevents rawdata rollback"
                        .to_string()
                        .into());
                }
                remove_proven(
                    &destination,
                    rawdata.candidate_fingerprint.as_deref(),
                    "installed rawdata destination",
                )?;
                sync_parent(destination.parent().expect("rawdata parent"))?;
                interrupt(FaultPoint::InterruptRollbackAfterDestinationRemoval)?;
            }
            rename_no_replace(&backup, &destination).with_context(|| {
                format!(
                    "Failed to restore rawdata backup {} to {}",
                    backup.display(),
                    destination.display()
                )
            })?;
            sync_parent(destination.parent().expect("rawdata parent"))?;
            interrupt(FaultPoint::InterruptRollbackAfterBackupRestore)?;
        } else if !destination_exists
            || !fingerprint_matches(&destination, rawdata.backup_fingerprint.as_deref())?
        {
            return Err("Rollback cannot prove the previous rawdata destination"
                .to_string()
                .into());
        }
    } else {
        if backup_exists {
            return Err("Unexpected rawdata backup for prior absence"
                .to_string()
                .into());
        }
        if destination_exists {
            if !fingerprint_matches(&destination, rawdata.candidate_fingerprint.as_deref())? {
                return Err("Unowned destination prevents restoring rawdata absence"
                    .to_string()
                    .into());
            }
            remove_proven(
                &destination,
                rawdata.candidate_fingerprint.as_deref(),
                "installed rawdata destination",
            )?;
            sync_parent(destination.parent().expect("rawdata parent"))?;
            interrupt(FaultPoint::InterruptRollbackAfterDestinationRemoval)?;
        }
    }
    cleanup_candidate(root, &rawdata)?;
    interrupt(FaultPoint::InterruptRollbackAfterCandidateCleanup)?;
    journal.subjects[index].rawdata.phase = RawdataPhase::RolledBack;
    journal.subjects[index].phase = SubjectPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}

pub(super) fn dataset_should_remain(journal: &RelocationJournal) -> bool {
    journal
        .subjects
        .iter()
        .any(|subject| subject.phase == SubjectPhase::Committed)
}

pub(super) fn cleanup_dataset_candidate(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    if journal.dataset.fingerprint.is_none()
        && !matches!(
            journal.dataset.phase,
            DatasetPhase::Planned | DatasetPhase::RollbackIntent
        )
    {
        return Ok(());
    }
    let candidate = safe_join(root, &journal.dataset.candidate)?;
    if path_exists(&candidate)? {
        remove_proven(
            &candidate,
            journal.dataset.fingerprint.as_deref(),
            "dataset description candidate",
        )?;
    }
    let parent = candidate
        .parent()
        .context("Dataset candidate has no parent")?;
    if path_exists(parent)? {
        // Replay also repairs a removal interrupted before parent synchronization.
        sync_parent(parent)?;
    }
    Ok(())
}

pub(super) fn rollback_dataset(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if matches!(
        journal.dataset.phase,
        DatasetPhase::NotRequired | DatasetPhase::ExistingWon | DatasetPhase::RolledBack
    ) {
        cleanup_dataset_candidate(root, journal)?;
        return Ok(());
    }
    let destination = safe_join(root, &journal.dataset.destination)?;
    if journal.dataset.phase != DatasetPhase::RollbackIntent {
        let candidate = safe_join(root, &journal.dataset.candidate)?;
        if path_exists(&destination)?
            && (journal.dataset.phase == DatasetPhase::InstallIntent && path_exists(&candidate)?
                || !fingerprint_matches(&destination, journal.dataset.fingerprint.as_deref())?)
        {
            journal.dataset.phase = DatasetPhase::ExistingWon;
            write_journal(root, journal)?;
            cleanup_dataset_candidate(root, journal)?;
            return Ok(());
        }
        journal.dataset.phase = DatasetPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    interrupt(FaultPoint::InterruptDatasetRollbackAfterIntent)?;
    if path_exists(&destination)? {
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Rollback dataset description",
        )?;
        remove_proven(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "installed dataset description",
        )?;
        sync_parent(destination.parent().expect("dataset parent"))?;
        interrupt(FaultPoint::InterruptDatasetRollbackAfterDestinationRemoval)?;
    }
    cleanup_dataset_candidate(root, journal)?;
    interrupt(FaultPoint::InterruptDatasetRollbackAfterCandidateCleanup)?;
    journal.dataset.phase = DatasetPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}
