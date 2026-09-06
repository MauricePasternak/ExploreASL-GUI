use super::candidate::{
    candidate_payload, remove_candidate_wrapper, require_owned_fingerprint, sync_payload_rename,
};
use super::cleanup::cleanup_after_terminal;
use super::error::{RelocationTransactionResult, format_transaction_error};
use super::filesystem::{path_exists, rename_no_replace};
use super::journal::{read_journal, remove_journal_owned, validate_journal, write_journal};
use super::paths::{candidate_record_path, canonical_project_root_result, safe_join};
use super::rollback::{
    dataset_should_remain, rollback_dataset, rollback_subject, validate_candidate_for_phase,
    validate_dataset_candidate_for_phase,
};
use super::types::{
    ArtifactPhase, ArtifactRole, DatasetPhase, JournalArtifact, RelocationJournal,
    RelocationOutcome, RelocationRecoverySummary, RelocationSubjectStatus, SubjectPhase,
    SubjectRelocationOutcome,
};
use anyhow::{Context, Result as AnyResult, bail};
use std::path::Path;

fn validate_prior_destination(
    destination: &Path,
    destination_exists: bool,
    artifact: &JournalArtifact,
) -> AnyResult<()> {
    if artifact.had_destination {
        if !destination_exists {
            bail!("Prior destination is missing for {}", artifact.destination);
        }
        require_owned_fingerprint(
            destination,
            artifact.backup_fingerprint.as_deref(),
            "Prior destination",
        )
    } else if destination_exists {
        Err(anyhow::anyhow!(
            "Destination appeared despite recorded prior absence for {}",
            artifact.destination
        ))
    } else {
        Ok(())
    }
}

fn validate_owned_backup(
    backup: &Path,
    backup_exists: bool,
    artifact: &JournalArtifact,
) -> AnyResult<()> {
    if artifact.had_destination {
        if !backup_exists {
            bail!("Required backup is missing for {}", artifact.destination);
        }
        require_owned_fingerprint(
            backup,
            artifact.backup_fingerprint.as_deref(),
            "Transaction backup",
        )
    } else if backup_exists {
        Err(anyhow::anyhow!(
            "Unexpected backup exists for originally absent {}",
            artifact.destination
        ))
    } else {
        Ok(())
    }
}

fn validate_recovery_artifact(
    root: &Path,
    artifact: &JournalArtifact,
    committed: bool,
    terminal_exists: bool,
) -> AnyResult<()> {
    let destination = safe_join(root, &artifact.destination)?;
    let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
    let destination_exists = path_exists(&destination)?;
    let backup_exists = path_exists(&backup)?;
    validate_candidate_for_phase(root, artifact)?;

    if committed {
        match artifact.role {
            ArtifactRole::Replacement => {
                if artifact.phase != ArtifactPhase::Installed || !destination_exists {
                    bail!(
                        "Committed replacement evidence is incomplete for {}",
                        artifact.destination
                    );
                }
                require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Committed destination",
                )?;
            }
            ArtifactRole::Removal => {
                if artifact.phase != ArtifactPhase::BackedUp || destination_exists {
                    bail!(
                        "Committed removal evidence is incomplete for {}",
                        artifact.destination
                    );
                }
            }
        }
        if backup_exists {
            validate_owned_backup(&backup, true, artifact)?;
        } else if artifact.had_destination && !terminal_exists {
            bail!(
                "Committed backup disappeared before terminal outcome for {}",
                artifact.destination
            );
        }
        if !artifact.had_destination && backup_exists {
            bail!("Unexpected committed backup for {}", artifact.destination);
        }
        return Ok(());
    }

    match artifact.phase {
        ArtifactPhase::Planned
        | ArtifactPhase::ReservationIntent
        | ArtifactPhase::CandidateReserved
        | ArtifactPhase::PopulationIntent
        | ArtifactPhase::CandidateReady => {
            if backup_exists {
                bail!(
                    "Prepared artifact has an unexpected backup for {}",
                    artifact.destination
                );
            }
            validate_prior_destination(&destination, destination_exists, artifact)
        }
        ArtifactPhase::BackupIntent => {
            if artifact.had_destination {
                if destination_exists == backup_exists {
                    bail!(
                        "Backup intent has ambiguous old-state evidence for {}",
                        artifact.destination
                    );
                }
                if destination_exists {
                    validate_prior_destination(&destination, true, artifact)
                } else {
                    validate_owned_backup(&backup, true, artifact)
                }
            } else if destination_exists || backup_exists {
                Err(anyhow::anyhow!(
                    "Backup intent conflicts with prior absence for {}",
                    artifact.destination
                ))
            } else {
                Ok(())
            }
        }
        ArtifactPhase::BackedUp => {
            if destination_exists {
                bail!(
                    "Backed-up destination unexpectedly exists for {}",
                    artifact.destination
                );
            }
            validate_owned_backup(&backup, backup_exists, artifact)
        }
        ArtifactPhase::InstallIntent => {
            validate_owned_backup(&backup, backup_exists, artifact)?;
            if artifact.role != ArtifactRole::Replacement {
                bail!("Removal artifact cannot have install intent");
            }
            let candidate = safe_join(
                root,
                artifact.candidate.as_deref().expect("validated candidate"),
            )?;
            let payload_exists = path_exists(&candidate_payload(&candidate))?;
            match (payload_exists, destination_exists) {
                (true, false) => Ok(()),
                (false, true) => require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Install-intent destination",
                ),
                _ => Err(anyhow::anyhow!(
                    "Install intent has ambiguous candidate/destination evidence for {}",
                    artifact.destination
                )),
            }
        }
        ArtifactPhase::Installed => {
            validate_owned_backup(&backup, backup_exists, artifact)?;
            match artifact.role {
                ArtifactRole::Replacement if destination_exists => require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Installed destination",
                ),
                ArtifactRole::Replacement => Err(anyhow::anyhow!(
                    "Installed replacement evidence is incomplete for {}",
                    artifact.destination
                )),
                ArtifactRole::Removal if !destination_exists => Ok(()),
                ArtifactRole::Removal => Err(anyhow::anyhow!(
                    "Installed removal evidence is incomplete for {}",
                    artifact.destination
                )),
            }
        }
        ArtifactPhase::RollbackIntent => {
            if backup_exists {
                validate_owned_backup(&backup, true, artifact)?;
                if destination_exists {
                    if artifact.role != ArtifactRole::Replacement {
                        bail!("Removal rollback has conflicting destination and backup");
                    }
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Rollback installed destination",
                    )?;
                }
                Ok(())
            } else if artifact.had_destination {
                validate_prior_destination(&destination, destination_exists, artifact)
            } else if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Rollback destination pending removal",
                )
            } else {
                Ok(())
            }
        }
        ArtifactPhase::RolledBack => {
            if backup_exists {
                bail!(
                    "Rolled-back artifact retains a backup for {}",
                    artifact.destination
                );
            }
            validate_prior_destination(&destination, destination_exists, artifact)
        }
    }
}

fn validate_recovery_preflight(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    validate_journal(root, journal)?;
    let terminal = journal.terminal_outcome.as_ref();
    for subject in &journal.subjects {
        let terminal_committed = terminal
            .and_then(|outcome| {
                outcome
                    .subjects
                    .iter()
                    .find(|entry| entry.subject == subject.subject)
            })
            .is_some_and(|entry| entry.status == RelocationSubjectStatus::Committed);
        if terminal.is_some() && terminal_committed != (subject.phase == SubjectPhase::Committed) {
            bail!(
                "Terminal outcome conflicts with subject journal state for {}",
                subject.subject
            );
        }
        for artifact in &subject.artifacts {
            validate_recovery_artifact(
                root,
                artifact,
                subject.phase == SubjectPhase::Committed,
                terminal.is_some(),
            )?;
        }
    }

    let destination = safe_join(root, &journal.dataset.destination)?;
    let candidate = candidate_record_path(root, &journal.dataset.candidate)?;
    let destination_exists = path_exists(&destination)?;
    let candidate_exists = path_exists(&candidate)?;
    validate_dataset_candidate_for_phase(root, &journal.dataset)?;
    match journal.dataset.phase {
        DatasetPhase::NotRequired => {
            if journal.dataset.source_present || candidate_exists {
                bail!("Not-required dataset artifact has unexpected evidence");
            }
        }
        DatasetPhase::Planned => {
            if !journal.dataset.source_present
                || journal.dataset.destination_existed
                || destination_exists
                || candidate_exists
            {
                bail!("Planned dataset artifact has inconsistent evidence");
            }
        }
        DatasetPhase::ReservationIntent => {
            if destination_exists {
                bail!("Dataset destination appeared before installation");
            }
        }
        DatasetPhase::CandidateReserved | DatasetPhase::PopulationIntent => {
            if destination_exists || !candidate_exists {
                bail!("Prepared dataset reservation has incomplete evidence");
            }
        }
        DatasetPhase::CandidateReady => {
            if destination_exists || !candidate_exists {
                bail!("Prepared dataset artifact has incomplete evidence");
            }
        }
        DatasetPhase::InstallIntent => {
            if !candidate_exists {
                bail!("Dataset install intent lost its candidate wrapper");
            }
            let payload_exists = path_exists(&candidate_payload(&candidate))?;
            match (payload_exists, destination_exists) {
                (true, false) => {}
                (false, true) => require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Installed dataset description",
                )?,
                // A concurrent create may win no-replace while our payload remains.
                (true, true) => {}
                (false, false) => {
                    bail!("Dataset install evidence is missing");
                }
            }
        }
        DatasetPhase::Installed => {
            if !destination_exists {
                bail!("Installed dataset evidence is incomplete");
            }
            require_owned_fingerprint(
                &destination,
                journal.dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
        }
        DatasetPhase::ExistingWon => {
            if !destination_exists {
                bail!("Concurrent dataset winner evidence is incomplete");
            }
        }
        DatasetPhase::RollbackIntent => {
            if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Dataset destination pending rollback",
                )?;
            }
        }
        DatasetPhase::RolledBack => {
            if (!journal.dataset.candidate_abandoned && candidate_exists) || destination_exists {
                bail!("Rolled-back dataset evidence is inconsistent");
            }
        }
    }
    Ok(())
}

fn preserve_ambiguous_reservation_wrappers(
    root: &Path,
    journal: &mut RelocationJournal,
    summary: &mut RelocationRecoverySummary,
) -> AnyResult<()> {
    let mut changed = false;
    for subject in &mut journal.subjects {
        for artifact in &mut subject.artifacts {
            if artifact.candidate_abandoned {
                summary.cleanup_errors.push(format!(
                    "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
                    artifact.candidate.as_deref().unwrap_or("unknown")
                ));
                continue;
            }
            if artifact.phase != ArtifactPhase::ReservationIntent {
                continue;
            }
            let Some(candidate_relative) = artifact.candidate.as_deref() else {
                continue;
            };
            let candidate = candidate_record_path(root, candidate_relative)?;
            if path_exists(&candidate)? {
                artifact.candidate_abandoned = true;
                artifact.phase = ArtifactPhase::RollbackIntent;
                summary.cleanup_errors.push(format!(
                    "Preserved ambiguous reservation wrapper {candidate_relative}; manual cleanup may be required"
                ));
                changed = true;
            }
        }
    }
    if journal.dataset.candidate_abandoned {
        summary.cleanup_errors.push(format!(
            "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
            journal.dataset.candidate
        ));
    }
    if journal.dataset.phase == DatasetPhase::ReservationIntent {
        let candidate = candidate_record_path(root, &journal.dataset.candidate)?;
        if path_exists(&candidate)? {
            journal.dataset.candidate_abandoned = true;
            journal.dataset.phase = DatasetPhase::RollbackIntent;
            summary.cleanup_errors.push(format!(
                "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
                journal.dataset.candidate
            ));
            changed = true;
        }
    }
    if changed {
        write_journal(root, journal)?;
    }
    Ok(())
}

pub fn recover(project_root: &Path) -> Result<RelocationRecoverySummary, String> {
    recover_result(project_root).map_err(Into::into)
}

fn recover_result(project_root: &Path) -> RelocationTransactionResult<RelocationRecoverySummary> {
    let root = canonical_project_root_result(project_root)?;
    let Some(mut journal) = read_journal(&root)? else {
        return Ok(RelocationRecoverySummary::default());
    };
    // Preflight every record and all actual evidence before first mutation.
    validate_recovery_preflight(&root, &journal)?;
    let mut summary = RelocationRecoverySummary::default();
    preserve_ambiguous_reservation_wrappers(&root, &mut journal, &mut summary)?;
    for index in 0..journal.subjects.len() {
        let subject = journal.subjects[index].subject.clone();
        if journal.subjects[index].phase == SubjectPhase::Committed {
            summary.preserved_subjects.push(subject.clone());
        } else {
            rollback_subject(&root, &mut journal, index)?;
            summary.restored_subjects.push(subject.clone());
        }
    }
    if dataset_should_remain(&journal) {
        if journal.dataset.phase == DatasetPhase::InstallIntent {
            let destination = safe_join(&root, &journal.dataset.destination)?;
            let candidate = candidate_record_path(&root, &journal.dataset.candidate)?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? && !path_exists(&destination)? {
                rename_no_replace(&payload, &destination).with_context(|| {
                    format!(
                        "Failed to resume dataset installation from {} to {}",
                        payload.display(),
                        destination.display()
                    )
                })?;
                sync_payload_rename(&candidate, &destination)?;
                require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Recovered dataset destination",
                )?;
                journal.dataset.phase = DatasetPhase::Installed;
                write_journal(&root, &journal)?;
            } else if !path_exists(&payload)? && path_exists(&destination)? {
                journal.dataset.phase = DatasetPhase::Installed;
                write_journal(&root, &journal)?;
            } else if path_exists(&payload)? && path_exists(&destination)? {
                journal.dataset.phase = DatasetPhase::ExistingWon;
                write_journal(&root, &journal)?;
                remove_candidate_wrapper(
                    &candidate,
                    journal.dataset.reservation_token.as_deref(),
                    journal.dataset.fingerprint.as_deref(),
                    false,
                )?;
            }
        }
    } else {
        rollback_dataset(&root, &mut journal)?;
    }
    if journal.terminal_outcome.is_none() {
        let subjects = journal
            .subjects
            .iter()
            .map(|subject| SubjectRelocationOutcome {
                subject: subject.subject.clone(),
                status: if subject.phase == SubjectPhase::Committed {
                    RelocationSubjectStatus::Committed
                } else {
                    RelocationSubjectStatus::RolledBack
                },
                phase: "activationRecovery".to_string(),
                message: None,
            })
            .collect();
        journal.terminal_outcome = Some(RelocationOutcome {
            plan_id: journal.plan_id.clone(),
            generation: journal.generation,
            subjects,
            staging_cleanup_complete: false,
        });
        write_journal(&root, &journal)?;
    }
    match cleanup_after_terminal(&root, &mut journal) {
        Ok(()) => {
            for subject in &journal.subjects {
                if subject
                    .artifacts
                    .iter()
                    .all(|artifact| !artifact.candidate_abandoned)
                {
                    summary.cleaned_subjects.push(subject.subject.clone());
                }
            }
            if let Err(error) = remove_journal_owned(&root, &journal) {
                summary
                    .cleanup_errors
                    .push(format!("Failed to remove relocation journal: {error:#}"));
            }
        }
        Err(error) => summary.cleanup_errors.push(format!(
            "Relocation cleanup remains pending: {}",
            format_transaction_error(&error)
        )),
    }
    Ok(summary)
}
