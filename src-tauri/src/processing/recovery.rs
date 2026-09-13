//! Processing settlement policy under active native ownership.
use super::{journal::relative, record::*, transaction::LaunchTransaction, types::*};
use crate::fs_safety::ProjectDirectory;
use anyhow::{Context, Result};
use std::path::Path;

pub(crate) fn validate(root: &Path) -> Result<Option<ProcessingRecord>> {
    let current = super::record::records(root)?.pop();
    super::record::validate_archives(root)?;
    if let Some(record) = &current {
        // A copied unresolved record is readable only to publish Interrupted.
        // Its old journal identity cannot authorize automatic mutation.
        if record.directory_matches(root)? && journal_exists(record)? {
            LaunchTransaction::reopen(root, &record.run_id.to_string())?;
        } else if record.directory_matches(root)? {
            super::journal::compaction_state(root, record.run_id)?;
        }
    }
    Ok(current)
}
pub(crate) fn journal_exists(record: &ProcessingRecord) -> Result<bool> {
    match ProjectDirectory::open(&record.project_root)?
        .open_regular(&relative(&record.launch_journal)?)
    {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn cleanup_archive(record: &ProcessingRecord) -> Result<()> {
    if !journal_exists(record)? {
        return Ok(());
    }
    let mut transaction =
        LaunchTransaction::reopen(&record.project_root, &record.run_id.to_string())?;
    if transaction.cleanup_pending() {
        transaction.cleanup()?;
    }
    super::journal::compaction_state(&record.project_root, record.run_id)?;
    Ok(())
}

fn audit(record: &mut ProcessingRecord) -> Result<()> {
    let directory = ProjectDirectory::open(&record.project_root)?;
    let boundary = record
        .execution_committed_at_ms
        .context("Execution freshness boundary is missing")?;
    let mut missing = Vec::new();
    for target in &mut record.expected_targets {
        let path = target.ready_path()?;
        let evidence = (|| -> Result<u64> {
            let file = directory.open_regular(&relative(&path)?)?.into_std();
            Ok(file
                .metadata()?
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)?
                .as_millis() as u64)
        })();
        target.complete = evidence.as_ref().is_ok_and(|mtime| *mtime >= boundary);
        if target.complete && target.module == "population" {
            record.population_ready_mtime_ms = evidence.ok();
        }
        if !target.complete {
            missing.push(path);
        }
    }
    if !missing.is_empty() {
        anyhow::bail!(
            "Missing, stale or unsafe ready target(s): {}",
            missing.join(", ")
        );
    }
    Ok(())
}

/// Current in-process settlement or explicit confirmation authorizes this path.
/// Before commit restore owned preparation; after commit preserve scientific
/// artifacts and remove only proven GUI-owned residue.
pub(crate) fn settle(root: &Path, recovering: bool) -> Result<Option<ProcessingRecord>> {
    let Some(previous) = validate(root)? else {
        return Ok(None);
    };
    if previous.lifecycle.is_terminal() {
        return Ok(Some(previous));
    }
    let mut next = previous.clone();
    // No current owner after activation: preserve every artifact until the
    // user has checked external work and confirms this exact run.
    if recovering {
        next.rebind_directory_identity()?;
        next.lifecycle = ProcessingLifecycle::Interrupted;
        next.revision += 1;
        next.available_action = AvailableAction::ConfirmStopped;
        next.error = Some(ProcessingError { code: "interrupted".into(), message: "Processing ownership ended outside this native process. Confirm external workers stopped before cleanup.".into() });
        next.terminal_revision = None;
        next.terminal_summary = None;
        super::record::persist(&next, Some(&previous))?;
        return Ok(Some(next));
    }
    if journal_exists(&next)? {
        let mut transaction = LaunchTransaction::reopen(root, &next.run_id.to_string())?;
        if transaction.cleanup_pending() {
            next.execution_committed = true;
        }
        if transaction.rollback_pending() {
            transaction.rollback()?;
        }
    }
    let complete_exits = next.logical_exits.len() == next.request.workers as usize;
    let worker_failure = next.logical_exits.iter().any(|exit| exit.exit_code != 0);
    let outcome = if next.cancellation_requested {
        ProcessingLifecycle::Cancelled
    } else if next.error.is_some() {
        ProcessingLifecycle::Failed
    } else if !next.execution_committed {
        next.error = Some(ProcessingError {
            code: "interruptedPreparation".into(),
            message:
                "Processing preparation was interrupted and prior owned artifacts were restored."
                    .into(),
        });
        ProcessingLifecycle::Failed
    } else {
        let targets = audit(&mut next);
        if !complete_exits || worker_failure {
            next.error = Some(ProcessingError {
                code: "workerFailed".into(),
                message:
                    "Every requested processing worker must have successful durable exit evidence"
                        .into(),
            });
            ProcessingLifecycle::Failed
        } else if let Err(error) = targets {
            next.error = Some(ProcessingError {
                code: "targetAudit".into(),
                message: format!("{error:#}"),
            });
            ProcessingLifecycle::Failed
        } else {
            ProcessingLifecycle::Completed
        }
    };
    if outcome == ProcessingLifecycle::Cancelled
        && next.lifecycle != ProcessingLifecycle::Cancelling
    {
        next.set_lifecycle(ProcessingLifecycle::Cancelling)?;
    }
    if outcome == ProcessingLifecycle::Completed && next.lifecycle == ProcessingLifecycle::Running {
        next.set_lifecycle(ProcessingLifecycle::Finalizing)?;
    }
    next.set_lifecycle(outcome)?;
    super::record::persist(&next, Some(&previous))?;
    Ok(Some(next))
}
