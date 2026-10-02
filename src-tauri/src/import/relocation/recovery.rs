use super::candidate::require_owned_fingerprint;
use super::cleanup::cleanup_after_terminal;
use super::error::{RelocationTransactionResult, format_transaction_error};
use super::filesystem::{
    path_exists, remove_proven, rename_no_replace, sync_parent, sync_parent_durable,
};
use super::journal::{read_journal, remove_journal_owned, validate_journal, write_journal};
use super::paths::{canonical_project_root, safe_join};
use super::reconcile::reconcile_subject;
use super::rollback::{dataset_should_remain, rollback_dataset, rollback_subject};
use super::types::{
    DatasetPhase, JournalRawdata, RawdataPhase, RelocationJournal, RelocationOutcome,
    RelocationRecoverySummary, RelocationSubjectStatus, SubjectPhase, SubjectRelocationOutcome,
};
use anyhow::{Result as AnyResult, bail};
use std::path::Path;

fn validate_prior_destination(
    destination: &Path,
    destination_exists: bool,
    rawdata: &JournalRawdata,
) -> AnyResult<()> {
    if rawdata.had_destination {
        if !destination_exists {
            bail!("Prior rawdata destination is missing");
        }
        require_owned_fingerprint(
            destination,
            rawdata.backup_fingerprint.as_deref(),
            "Prior rawdata destination",
        )
    } else if destination_exists {
        bail!("Rawdata destination appeared despite recorded prior absence")
    } else {
        Ok(())
    }
}

fn validate_backup(backup: &Path, exists: bool, rawdata: &JournalRawdata) -> AnyResult<()> {
    if rawdata.had_destination {
        if !exists {
            bail!("Required rawdata backup is missing");
        }
        require_owned_fingerprint(
            backup,
            rawdata.backup_fingerprint.as_deref(),
            "Rawdata backup",
        )
    } else if exists {
        bail!("Unexpected rawdata backup for prior absence")
    } else {
        Ok(())
    }
}

fn validate_candidate(candidate: &Path, rawdata: &JournalRawdata, required: bool) -> AnyResult<()> {
    let exists = path_exists(candidate)?;
    if required && !exists {
        bail!("Required rawdata candidate is missing");
    }
    if exists && rawdata.candidate_fingerprint.is_some() {
        require_owned_fingerprint(
            candidate,
            rawdata.candidate_fingerprint.as_deref(),
            "Rawdata candidate",
        )?;
    }
    Ok(())
}

fn validate_recovery_subject(
    root: &Path,
    subject: &super::types::JournalSubject,
    terminal_exists: bool,
) -> AnyResult<()> {
    let rawdata = &subject.rawdata;
    let destination = safe_join(root, &rawdata.destination)?;
    let candidate = safe_join(root, &rawdata.candidate)?;
    let backup = safe_join(root, &rawdata.backup)?;
    let destination_exists = path_exists(&destination)?;
    let candidate_exists = path_exists(&candidate)?;
    let backup_exists = path_exists(&backup)?;

    if subject.phase == SubjectPhase::Committed {
        if rawdata.phase != RawdataPhase::Installed || !destination_exists {
            bail!("Committed rawdata evidence is incomplete");
        }
        require_owned_fingerprint(
            &destination,
            rawdata.candidate_fingerprint.as_deref(),
            "Committed rawdata destination",
        )?;
        if candidate_exists {
            bail!("Committed rawdata retains a candidate");
        }
        if backup_exists {
            validate_backup(&backup, true, rawdata)?;
        } else if rawdata.had_destination && !terminal_exists {
            bail!("Committed rawdata backup disappeared before terminal outcome");
        }
        return Ok(());
    }

    match rawdata.phase {
        RawdataPhase::Planned => {
            if backup_exists {
                bail!("Planned rawdata has an unexpected backup");
            }
            validate_prior_destination(&destination, destination_exists, rawdata)
        }
        RawdataPhase::CandidateReady => {
            validate_candidate(&candidate, rawdata, true)?;
            if backup_exists {
                bail!("Prepared rawdata has an unexpected backup");
            }
            validate_prior_destination(&destination, destination_exists, rawdata)
        }
        RawdataPhase::BackupIntent => {
            validate_candidate(&candidate, rawdata, true)?;
            if rawdata.had_destination {
                if destination_exists == backup_exists {
                    bail!("Backup intent has ambiguous old rawdata evidence");
                }
                if destination_exists {
                    validate_prior_destination(&destination, true, rawdata)
                } else {
                    validate_backup(&backup, true, rawdata)
                }
            } else if destination_exists || backup_exists {
                bail!("Backup intent conflicts with prior rawdata absence")
            } else {
                Ok(())
            }
        }
        RawdataPhase::BackedUp => {
            validate_candidate(&candidate, rawdata, true)?;
            if destination_exists {
                bail!("Backed-up rawdata destination unexpectedly exists");
            }
            validate_backup(&backup, backup_exists, rawdata)
        }
        RawdataPhase::InstallIntent => {
            validate_backup(&backup, backup_exists, rawdata)?;
            match (candidate_exists, destination_exists) {
                (true, false) => validate_candidate(&candidate, rawdata, true),
                (false, true) => require_owned_fingerprint(
                    &destination,
                    rawdata.candidate_fingerprint.as_deref(),
                    "Install-intent rawdata destination",
                ),
                _ => bail!("Install intent has ambiguous rawdata evidence"),
            }
        }
        RawdataPhase::Installed => {
            validate_backup(&backup, backup_exists, rawdata)?;
            if candidate_exists || !destination_exists {
                bail!("Installed rawdata evidence is incomplete");
            }
            require_owned_fingerprint(
                &destination,
                rawdata.candidate_fingerprint.as_deref(),
                "Installed rawdata destination",
            )
        }
        RawdataPhase::RollbackIntent => {
            if backup_exists {
                validate_backup(&backup, true, rawdata)?;
                if destination_exists {
                    require_owned_fingerprint(
                        &destination,
                        rawdata.candidate_fingerprint.as_deref(),
                        "Rollback rawdata destination",
                    )?;
                }
            } else if rawdata.had_destination {
                validate_prior_destination(&destination, destination_exists, rawdata)?;
            } else if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    rawdata.candidate_fingerprint.as_deref(),
                    "Rollback rawdata destination",
                )?;
            }
            validate_candidate(&candidate, rawdata, false)
        }
        RawdataPhase::RolledBack => {
            if candidate_exists || backup_exists {
                bail!("Rolled-back rawdata retains transaction artifacts");
            }
            validate_prior_destination(&destination, destination_exists, rawdata)
        }
    }
}

fn validate_dataset(root: &Path, journal: &RelocationJournal) -> AnyResult<()> {
    let dataset = &journal.dataset;
    let destination = safe_join(root, &dataset.destination)?;
    let candidate = safe_join(root, &dataset.candidate)?;
    let destination_exists = path_exists(&destination)?;
    let candidate_exists = path_exists(&candidate)?;
    match dataset.phase {
        DatasetPhase::NotRequired => {
            if dataset.source_present || candidate_exists {
                bail!("Not-required dataset description has unexpected evidence");
            }
        }
        DatasetPhase::Planned => {
            if !dataset.source_present || dataset.destination_existed || destination_exists {
                bail!("Planned dataset description has inconsistent evidence");
            }
        }
        DatasetPhase::InstallIntent => match (candidate_exists, destination_exists) {
            (true, false) | (true, true) => require_owned_fingerprint(
                &candidate,
                dataset.fingerprint.as_deref(),
                "Dataset description candidate",
            )?,
            (false, true) => require_owned_fingerprint(
                &destination,
                dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?,
            (false, false) => bail!("Dataset description install evidence is missing"),
        },
        DatasetPhase::Installed => {
            if candidate_exists || !destination_exists {
                bail!("Installed dataset description evidence is incomplete");
            }
            require_owned_fingerprint(
                &destination,
                dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
        }
        DatasetPhase::ExistingWon => {
            if !destination_exists {
                bail!("Existing dataset description evidence is incomplete");
            }
            if candidate_exists {
                require_owned_fingerprint(
                    &candidate,
                    dataset.fingerprint.as_deref(),
                    "Dataset description candidate",
                )?;
            }
        }
        DatasetPhase::RolledBack => {
            if candidate_exists || (!dataset.destination_existed && destination_exists) {
                bail!("Rolled-back dataset description evidence is inconsistent");
            }
        }
        DatasetPhase::RollbackIntent => {
            if !dataset.source_present
                || dataset.destination_existed
                || destination_exists && candidate_exists
                || journal
                    .subjects
                    .iter()
                    .any(|subject| subject.phase != SubjectPhase::RolledBack)
            {
                bail!("Dataset description rollback intent has inconsistent ownership");
            }
            if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    dataset.fingerprint.as_deref(),
                    "Rollback dataset description",
                )?;
            }
            if candidate_exists && dataset.fingerprint.is_some() {
                require_owned_fingerprint(
                    &candidate,
                    dataset.fingerprint.as_deref(),
                    "Dataset description candidate",
                )?;
            }
        }
    }
    Ok(())
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
            bail!("Terminal outcome conflicts with subject journal state");
        }
        validate_recovery_subject(root, subject, terminal.is_some())?;
    }
    validate_dataset(root, journal)
}

pub fn recover(project_root: &Path) -> anyhow::Result<RelocationRecoverySummary> {
    recover_result(project_root).map_err(anyhow::Error::from)
}

fn recover_result(project_root: &Path) -> RelocationTransactionResult<RelocationRecoverySummary> {
    let root = canonical_project_root(project_root)?;
    let Some(mut journal) = read_journal(&root)? else {
        return Ok(RelocationRecoverySummary::default());
    };
    validate_recovery_preflight(&root, &journal)?;
    crate::import::journal::validate_relocation_recovery_authority(
        &root,
        journal.generation,
        &journal.plan_id,
        journal.terminal_outcome.as_ref(),
    )?;
    let checkpointed_outcome = crate::import::journal::load_record(&root)?
        .and_then(|record| record.snapshot.relocation_outcome);
    if let Some(checkpointed) = &checkpointed_outcome
        && journal.terminal_outcome.as_ref() != Some(checkpointed)
    {
        return Err("Relocation journal disagrees with durable import-run checkpoint".into());
    }
    let normalize_terminal_outcome = checkpointed_outcome.is_none();
    let mut summary = RelocationRecoverySummary::default();
    for index in 0..journal.subjects.len() {
        let subject = journal.subjects[index].subject.clone();
        if journal.subjects[index].phase == SubjectPhase::Committed {
            summary.preserved_subjects.push(subject);
        } else {
            rollback_subject(&root, &mut journal, index)?;
            summary.restored_subjects.push(subject);
        }
    }

    if dataset_should_remain(&journal) {
        if journal.dataset.phase == DatasetPhase::InstallIntent {
            let destination = safe_join(&root, &journal.dataset.destination)?;
            let candidate = safe_join(&root, &journal.dataset.candidate)?;
            match (path_exists(&candidate)?, path_exists(&destination)?) {
                (true, false) => {
                    rename_no_replace(&candidate, &destination).map_err(anyhow::Error::from)?;
                    sync_parent(candidate.parent().expect("dataset candidate parent"))?;
                    sync_parent(destination.parent().expect("dataset destination parent"))?;
                    require_owned_fingerprint(
                        &destination,
                        journal.dataset.fingerprint.as_deref(),
                        "Recovered dataset description",
                    )?;
                    journal.dataset.phase = DatasetPhase::Installed;
                    write_journal(&root, &journal)?;
                }
                (false, true) => {
                    require_owned_fingerprint(
                        &destination,
                        journal.dataset.fingerprint.as_deref(),
                        "Recovered dataset description",
                    )?;
                    journal.dataset.phase = DatasetPhase::Installed;
                    write_journal(&root, &journal)?;
                }
                (true, true) => {
                    journal.dataset.phase = DatasetPhase::ExistingWon;
                    write_journal(&root, &journal)?;
                    remove_proven(
                        &candidate,
                        journal.dataset.fingerprint.as_deref(),
                        "dataset description candidate",
                    )?;
                }
                (false, false) => {
                    return Err("Dataset description install evidence is missing".into());
                }
            }
        }
    } else {
        rollback_dataset(&root, &mut journal)?;
    }

    if journal.terminal_outcome.is_none() {
        journal.terminal_outcome = Some(RelocationOutcome {
            plan_id: journal.plan_id.clone(),
            generation: journal.generation,
            subjects: journal
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
                .collect(),
            staging_cleanup_complete: false,
        });
        write_journal(&root, &journal)?;
    }

    let cleanup_ok = match cleanup_after_terminal(&root, &mut journal) {
        Ok(()) => true,
        Err(error) => {
            summary.cleanup_errors.push(format!(
                "Relocation cleanup remains pending: {}",
                format_transaction_error(&error)
            ));
            false
        }
    };
    let staging = root.join(".easl_staging");
    for index in 0..journal.subjects.len() {
        if journal.subjects[index].phase != SubjectPhase::Committed
            || journal.subjects[index].derived_reconciled
        {
            continue;
        }
        let subject = journal.subjects[index].subject.clone();
        let result = reconcile_subject(&root, &staging, &subject);
        let warning = result.as_ref().err().map(|error| {
            format!("Derived artifact reconciliation remains pending for {subject}: {error:#}")
        });
        if let Some(warning) = &warning {
            summary.cleanup_errors.push(warning.clone());
        }
        journal.subjects[index].derived_reconciled = result.is_ok();
        if normalize_terminal_outcome {
            let terminal_subject = journal
                .terminal_outcome
                .as_mut()
                .and_then(|outcome| {
                    outcome
                        .subjects
                        .iter_mut()
                        .find(|entry| entry.subject == subject)
                })
                .ok_or_else(|| "Terminal outcome lacks its committed subject".to_string())?;
            terminal_subject.phase = if result.is_ok() {
                "committed"
            } else {
                "derivedReconciliation"
            }
            .to_string();
            terminal_subject.message = warning;
        }
        if (result.is_ok() || normalize_terminal_outcome)
            && let Err(error) = write_journal(&root, &journal)
        {
            summary.cleanup_errors.push(format!(
                "Failed to checkpoint derived artifact reconciliation for {subject}: {error:#}"
            ));
            // Replacement may be visible despite a failed parent sync. Bridge
            // the actual durable journal, not the attempted in-memory outcome.
            journal = read_journal(&root)?.ok_or_else(|| {
                "Relocation journal disappeared during reconciliation checkpoint".to_string()
            })?;
            sync_parent_durable(&root)?;
        }
    }
    // Custody is authoritative even when cleanup cannot finish. Finalization
    // must reuse this durable outcome rather than relocate committed rawdata.
    if let Some(outcome) = &journal.terminal_outcome {
        crate::import::journal::checkpoint_relocation_outcome(&root, outcome)?;
    }
    if cleanup_ok && summary.cleanup_errors.is_empty() {
        summary.cleaned_subjects.extend(
            journal
                .subjects
                .iter()
                .map(|subject| subject.subject.clone()),
        );
        if let Err(error) = remove_journal_owned(&root, &journal) {
            summary
                .cleanup_errors
                .push(format!("Failed to remove relocation journal: {error:#}"));
        }
    }
    Ok(summary)
}
