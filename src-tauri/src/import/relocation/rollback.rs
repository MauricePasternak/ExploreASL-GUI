use super::candidate::{
    candidate_payload, require_owned_fingerprint, validate_candidate_marker,
    validate_ready_candidate,
};
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt};
use super::filesystem::{
    path_exists, remove_proven, rename_no_replace, sync_parent, tree_fingerprint,
};
use super::journal::write_journal;
use super::paths::{candidate_record_path, safe_join};
use super::types::{
    ArtifactPhase, ArtifactRole, DatasetPhase, JournalArtifact, JournalDataset, RelocationJournal,
    SubjectPhase,
};
use anyhow::{Context, Result as AnyResult, bail};
use std::fs;
use std::path::Path;

pub(super) fn validate_candidate_for_phase(
    root: &Path,
    artifact: &JournalArtifact,
) -> AnyResult<()> {
    let Some(candidate_relative) = artifact.candidate.as_deref() else {
        return Ok(());
    };
    if artifact.candidate_abandoned {
        return if matches!(
            artifact.phase,
            ArtifactPhase::RollbackIntent | ArtifactPhase::RolledBack
        ) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Abandoned candidate has an invalid phase"))
        };
    }
    let candidate = candidate_record_path(root, candidate_relative)?;
    let exists = path_exists(&candidate)?;
    match artifact.phase {
        ArtifactPhase::Planned => {
            if exists {
                Err(anyhow::anyhow!(
                    "Candidate exists before durable reservation intent"
                ))
            } else {
                Ok(())
            }
        }
        ArtifactPhase::ReservationIntent => {
            if !exists {
                return Ok(());
            }
            // Reservation intent precedes wrapper creation. Missing, partial, or
            // unsynced marker evidence is therefore non-authoritative and gets
            // classified for preservation after whole-journal preflight.
            Ok(())
        }
        ArtifactPhase::CandidateReserved => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                bail!("Reserved candidate unexpectedly has a payload");
            }
            Ok(())
        }
        ArtifactPhase::PopulationIntent => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())
        }
        ArtifactPhase::CandidateReady | ArtifactPhase::BackupIntent | ArtifactPhase::BackedUp => {
            validate_ready_candidate(
                &candidate,
                artifact.reservation_token.as_deref(),
                artifact.candidate_fingerprint.as_deref(),
            )
        }
        ArtifactPhase::InstallIntent => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? {
                require_owned_fingerprint(
                    &payload,
                    artifact.candidate_fingerprint.as_deref(),
                    "Install-intent candidate payload",
                )?;
            }
            Ok(())
        }
        ArtifactPhase::Installed => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                bail!("Installed candidate wrapper still contains its payload");
            }
            Ok(())
        }
        ArtifactPhase::RollbackIntent => {
            if exists {
                validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
                let payload = candidate_payload(&candidate);
                if path_exists(&payload)? && artifact.candidate_fingerprint.is_some() {
                    require_owned_fingerprint(
                        &payload,
                        artifact.candidate_fingerprint.as_deref(),
                        "Rollback candidate payload",
                    )?;
                }
            }
            Ok(())
        }
        ArtifactPhase::RolledBack => {
            if exists {
                Err(anyhow::anyhow!(
                    "Rolled-back artifact retains a candidate wrapper"
                ))
            } else {
                Ok(())
            }
        }
    }
}

pub(super) fn cleanup_candidate(root: &Path, artifact: &JournalArtifact) -> AnyResult<()> {
    let Some(candidate_relative) = artifact.candidate.as_deref() else {
        return Ok(());
    };
    let candidate = candidate_record_path(root, candidate_relative)?;
    if !path_exists(&candidate)? {
        return Ok(());
    }
    validate_candidate_for_phase(root, artifact)?;
    // PopulationIntent may contain a partial payload; its durable marker is the
    // ownership proof. Every later phase additionally requires payload identity.
    fs::remove_dir_all(&candidate)
        .with_context(|| format!("Failed to remove candidate wrapper {}", candidate.display()))?;
    fail(FaultPoint::WrapperDeleteParentSync)?;
    sync_parent(candidate.parent().expect("candidate parent"))
}

pub(super) fn destination_fingerprint_matches(
    path: &Path,
    expected: Option<&str>,
) -> AnyResult<bool> {
    let Some(expected) = expected else {
        return Ok(false);
    };
    Ok(tree_fingerprint(path)? == expected)
}

pub(super) fn rollback_artifact(
    root: &Path,
    journal: &mut RelocationJournal,
    subject_index: usize,
    artifact_index: usize,
) -> RelocationTransactionResult<()> {
    if journal.subjects[subject_index].artifacts[artifact_index].phase
        != ArtifactPhase::RollbackIntent
    {
        journal.subjects[subject_index].artifacts[artifact_index].phase =
            ArtifactPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    interrupt(FaultPoint::InterruptRollbackAfterIntent)?;
    let artifact = journal.subjects[subject_index].artifacts[artifact_index].clone();
    let destination = safe_join(root, &artifact.destination)?;
    let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
    let mut destination_exists = path_exists(&destination)?;
    let mut backup_exists = path_exists(&backup)?;

    if backup_exists {
        require_owned_fingerprint(
            &backup,
            artifact.backup_fingerprint.as_deref(),
            "Rollback backup",
        )?;
    }

    if artifact.had_destination {
        if backup_exists {
            if destination_exists {
                if artifact.role != ArtifactRole::Replacement
                    || !destination_fingerprint_matches(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                    )?
                {
                    return Err(format!(
                        "Unowned destination prevents rollback for {}",
                        artifact.destination
                    )
                    .into());
                }
                remove_proven(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "installed transaction destination",
                )?;
                sync_parent(destination.parent().expect("destination parent"))?;
                destination_exists = false;
                interrupt(FaultPoint::InterruptRollbackAfterDestinationRemoval)?;
            }
            if !destination_exists {
                rename_no_replace(&backup, &destination).with_context(|| {
                    format!(
                        "Failed to restore backup {} to {} without replacement",
                        backup.display(),
                        destination.display()
                    )
                })?;
                sync_parent(destination.parent().expect("destination parent"))?;
                backup_exists = false;
                destination_exists = true;
                interrupt(FaultPoint::InterruptRollbackAfterBackupRestore)?;
            }
        } else if !destination_exists
            || !destination_fingerprint_matches(
                &destination,
                artifact.backup_fingerprint.as_deref(),
            )?
        {
            return Err(format!(
                "Rollback cannot prove restored destination for {}",
                artifact.destination
            )
            .into());
        }
    } else {
        if backup_exists {
            return Err("Unexpected backup exists for originally absent destination"
                .to_string()
                .into());
        }
        if destination_exists {
            if artifact.role != ArtifactRole::Replacement
                || !destination_fingerprint_matches(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                )?
            {
                return Err(format!(
                    "Unowned destination prevents restoring prior absence for {}",
                    artifact.destination
                )
                .into());
            }
            remove_proven(
                &destination,
                artifact.candidate_fingerprint.as_deref(),
                "installed transaction destination",
            )?;
            sync_parent(destination.parent().expect("destination parent"))?;
            destination_exists = false;
            interrupt(FaultPoint::InterruptRollbackAfterDestinationRemoval)?;
        }
    }

    debug_assert!(!backup_exists);
    debug_assert_eq!(destination_exists, artifact.had_destination);
    if !artifact.candidate_abandoned {
        cleanup_candidate(root, &artifact)?;
    }
    interrupt(FaultPoint::InterruptRollbackAfterCandidateCleanup)?;
    journal.subjects[subject_index].artifacts[artifact_index].phase = ArtifactPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}

pub(super) fn rollback_subject(
    root: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    fail(FaultPoint::Rollback)?;
    for artifact_index in (0..journal.subjects[index].artifacts.len()).rev() {
        rollback_artifact(root, journal, index, artifact_index)?;
    }
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

pub(super) fn validate_dataset_candidate_for_phase(
    root: &Path,
    dataset: &JournalDataset,
) -> AnyResult<()> {
    if dataset.candidate_abandoned {
        return if matches!(
            dataset.phase,
            DatasetPhase::RollbackIntent | DatasetPhase::RolledBack
        ) {
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Abandoned dataset candidate has an invalid phase"
            ))
        };
    }
    let candidate = candidate_record_path(root, &dataset.candidate)?;
    let exists = path_exists(&candidate)?;
    match dataset.phase {
        DatasetPhase::NotRequired | DatasetPhase::Planned => {
            if exists {
                Err(anyhow::anyhow!(
                    "Dataset candidate exists outside an owned preparation state"
                ))
            } else {
                Ok(())
            }
        }
        DatasetPhase::ExistingWon => {
            if exists {
                validate_ready_candidate(
                    &candidate,
                    dataset.reservation_token.as_deref(),
                    dataset.fingerprint.as_deref(),
                )?;
            }
            Ok(())
        }
        DatasetPhase::ReservationIntent => {
            if !exists {
                return Ok(());
            }
            Ok(())
        }
        DatasetPhase::CandidateReserved => {
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                bail!("Reserved dataset candidate unexpectedly has a payload");
            }
            Ok(())
        }
        DatasetPhase::PopulationIntent => {
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())
        }
        DatasetPhase::CandidateReady => validate_ready_candidate(
            &candidate,
            dataset.reservation_token.as_deref(),
            dataset.fingerprint.as_deref(),
        ),
        DatasetPhase::InstallIntent | DatasetPhase::RollbackIntent => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? && dataset.fingerprint.is_some() {
                require_owned_fingerprint(
                    &payload,
                    dataset.fingerprint.as_deref(),
                    "Dataset candidate payload",
                )?;
            }
            Ok(())
        }
        DatasetPhase::Installed => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                bail!("Installed dataset wrapper still contains its payload");
            }
            Ok(())
        }
        DatasetPhase::RolledBack => {
            if exists {
                Err(anyhow::anyhow!(
                    "Rolled-back dataset retains a candidate wrapper"
                ))
            } else {
                Ok(())
            }
        }
    }
}

pub(super) fn cleanup_dataset_candidate(root: &Path, dataset: &JournalDataset) -> AnyResult<()> {
    let candidate = candidate_record_path(root, &dataset.candidate)?;
    if !path_exists(&candidate)? {
        return Ok(());
    }
    validate_dataset_candidate_for_phase(root, dataset)?;
    fs::remove_dir_all(&candidate).with_context(|| {
        format!(
            "Failed to remove dataset candidate wrapper {}",
            candidate.display()
        )
    })?;
    fail(FaultPoint::WrapperDeleteParentSync)?;
    sync_parent(candidate.parent().expect("dataset candidate parent"))
}

pub(super) fn rollback_dataset(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if matches!(
        journal.dataset.phase,
        DatasetPhase::NotRequired | DatasetPhase::RolledBack
    ) {
        return Ok(());
    }
    if journal.dataset.phase == DatasetPhase::ExistingWon {
        cleanup_dataset_candidate(root, &journal.dataset)?;
        return Ok(());
    }
    if journal.dataset.phase != DatasetPhase::RollbackIntent {
        journal.dataset.phase = DatasetPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    interrupt(FaultPoint::InterruptDatasetRollbackAfterIntent)?;
    let destination = safe_join(root, &journal.dataset.destination)?;
    if path_exists(&destination)? {
        if journal.dataset.destination_existed {
            return Err("Dataset rollback cannot alter the pre-existing destination"
                .to_string()
                .into());
        }
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Rollback dataset destination",
        )?;
        remove_proven(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "installed dataset description",
        )?;
        sync_parent(destination.parent().expect("dataset parent"))?;
        interrupt(FaultPoint::InterruptDatasetRollbackAfterDestinationRemoval)?;
    }
    if !journal.dataset.candidate_abandoned {
        cleanup_dataset_candidate(root, &journal.dataset)?;
    }
    interrupt(FaultPoint::InterruptDatasetRollbackAfterCandidateCleanup)?;
    journal.dataset.phase = DatasetPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}
