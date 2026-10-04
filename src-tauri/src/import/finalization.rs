//! Import exit checkpoints, completion verification, relocation and terminal publication.
//!
//! Process-scope settlement comes from the supervisor. Only durable import
//! evidence authorizes output mutation or a terminal result, not parser events.

use super::output::copy_import_configs;
use super::record::{record_from_state, write_record};
use super::relocation::{JOURNAL_FILE, RelocationSubjectStatus, relocate};
use super::runs::{persist, recover_processing_before_import};
use super::types::{
    ImportExitEvidence, ImportLifecycle, ImportRunSnapshot, ImportStructuredError,
    ImportSubjectOutcome, ImportSubjectOutcomeKind, ImportTerminalResult,
};
use super::verification::{cleanup_failed_subject_status, verify_subject};
use crate::app::state::AppState;
use crate::error::MutexExt;
use anyhow::{Context, Result as AnyResult, bail};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub(super) fn settle_import_scope_exit<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    exit_code: i32,
) -> AnyResult<()> {
    let state = app.state::<AppState>();
    let snapshot = {
        let run = state.import_state.lock_or_bail("Import state")?;
        match run.lifecycle {
            ImportLifecycle::Running | ImportLifecycle::Cancelling => {
                drop(run);
                record_import_process_exit(&state, generation, exit_code)?
            }
            ImportLifecycle::Finalizing => run.snapshot(),
            lifecycle if lifecycle.is_terminal() => run.snapshot(),
            _ => bail!("Import scope settled before native running ownership was established"),
        }
    };
    let terminal = if snapshot.lifecycle == ImportLifecycle::Finalizing {
        app.emit("import-run-snapshot", snapshot).ok();
        complete_finalizing_import(&state, generation, exit_code)?
    } else {
        snapshot
    };
    if !terminal.lifecycle.is_terminal() {
        bail!("Import scope settled without a terminal native lifecycle");
    }
    release_terminal_supervisor_handle(&state, generation);
    app.emit("import-run-snapshot", terminal).ok();
    Ok(())
}

fn release_terminal_supervisor_handle(state: &AppState, generation: u64) {
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && run.lifecycle.is_terminal()
    {
        run.cancellation = None;
        run.supervisor_handle.take();
    }
}

pub(super) fn cancelled_subject_outcomes(subjects: &[String]) -> Vec<ImportSubjectOutcome> {
    subjects
        .iter()
        .map(|subject| ImportSubjectOutcome {
            subject: subject.clone(),
            outcome: ImportSubjectOutcomeKind::Cancelled,
            ready_lock_verified: false,
            rawdata_verified: false,
            committed: false,
            error: None,
        })
        .collect()
}

pub(super) fn record_import_process_exit(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<ImportRunSnapshot> {
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || !matches!(
            run.lifecycle,
            ImportLifecycle::Running | ImportLifecycle::Cancelling
        )
    {
        bail!("Import supervisor is obsolete");
    }
    let prior = run.snapshot();
    run.exit_evidence = Some(ImportExitEvidence {
        exit_code,
        successful: exit_code == 0,
    });
    if run.lifecycle == ImportLifecycle::Cancelling {
        run.transition(ImportLifecycle::Cancelled)
            .map_err(anyhow::Error::msg)?;
        run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
        run.terminal_result = Some(ImportTerminalResult::Cancelled);
    } else {
        run.transition(ImportLifecycle::Finalizing)
            .map_err(anyhow::Error::msg)?;
    }
    if let Err(error) = persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.exit_evidence = prior.exit_evidence;
        run.subject_outcomes = prior.subject_outcomes;
        run.terminal_result = prior.terminal_result;
        return Err(error);
    }
    run.cancellation = None;
    Ok(run.snapshot())
}

/// Resume a crash-surviving finalization after relocation journal recovery.
/// The record already contains durable exit evidence and an immutable plan.
pub(super) fn resume_finalizing_import(
    state: &AppState,
    generation: u64,
) -> AnyResult<ImportRunSnapshot> {
    let exit_code = {
        let run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Finalizing {
            bail!("Import run is not eligible for finalization recovery");
        }
        let exit = run
            .exit_evidence
            .as_ref()
            .context("Finalizing import record lacks exit evidence")?;
        exit.exit_code
    };
    complete_finalizing_import_after_processing_recovery(state, generation, exit_code)
}

pub(super) fn complete_finalizing_import(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<ImportRunSnapshot> {
    let root = state
        .import_state
        .lock_or_bail("Import state")?
        .project_root
        .clone();
    recover_processing_before_import(&root)?;
    complete_finalizing_import_after_processing_recovery(state, generation, exit_code)
}

fn complete_finalizing_import_after_processing_recovery(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<ImportRunSnapshot> {
    let (
        project_root,
        staging_root,
        subjects,
        staging_generation,
        plan,
        checkpointed_relocation,
        preserve_staging,
    ) = {
        let run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Finalizing {
            bail!("Import finalizer is obsolete");
        }
        (
            run.project_root.clone(),
            run.staging_root.clone(),
            run.subject_list.clone(),
            run.staging_generation.clone(),
            run.relocation_plan
                .clone()
                .context("Finalizing import record lacks confirmed relocation plan")?,
            run.relocation_outcome.clone(),
            run.preserve_staging,
        )
    };

    let (mut outcomes, relocation_outcome, mut cleanup_errors) = if let Some(relocation) =
        checkpointed_relocation
    {
        // Relocation recovery may already have removed its journal. The run
        // checkpoint is then sole proof that committed output must not move
        // again. Reuse the prior verification checkpoint and outcome verbatim.
        let outcomes = {
            let run = state.import_state.lock_or_bail("Import state")?;
            if run.subject_outcomes.is_empty() {
                bail!("Relocation checkpoint lacks prior subject verification evidence");
            }
            run.subject_outcomes.clone()
        };
        (outcomes, Some(relocation), Vec::new())
    } else {
        let outcomes = subjects
            .iter()
            .map(|subject| verify_subject(&staging_root, subject, &staging_generation))
            .collect::<Vec<_>>();
        let verified = outcomes
            .iter()
            .filter(|outcome| outcome.outcome == ImportSubjectOutcomeKind::Verified)
            .map(|outcome| outcome.subject.clone())
            .collect::<Vec<_>>();
        // Verification checkpoint is durable before failed-lock cleanup or
        // relocation may mutate staging/project output.
        {
            let mut run = state.import_state.lock_or_bail("Import state")?;
            if run.ownership_generation != generation
                || run.lifecycle != ImportLifecycle::Finalizing
            {
                bail!("Import finalizer became obsolete before verification checkpoint");
            }
            let prior_outcomes = std::mem::replace(&mut run.subject_outcomes, outcomes.clone());
            if let Err(error) = write_record(&run.project_root, &record_from_state(&run)?) {
                run.subject_outcomes = prior_outcomes;
                return Err(error);
            }
        }
        let mut cleanup_errors = Vec::new();
        for outcome in outcomes
            .iter()
            .filter(|outcome| outcome.outcome == ImportSubjectOutcomeKind::Failed)
        {
            // Never clean when staging-generation authority itself is absent.
            if outcome
                .error
                .as_ref()
                .is_some_and(|error| error.code != "stagingGeneration")
                && let Err(error) = cleanup_failed_subject_status(&staging_root, &outcome.subject)
            {
                cleanup_errors.push(format!("{}: {error:#}", outcome.subject));
            }
        }
        let relocation = if verified.is_empty() {
            None
        } else {
            match relocate(
                &plan,
                generation,
                &staging_root,
                &verified,
                exit_code == 0 && verified.len() == subjects.len() && cleanup_errors.is_empty(),
                preserve_staging,
            ) {
                Ok(outcome)
                    if outcome.subjects.iter().any(|subject| {
                        subject.status == RelocationSubjectStatus::RecoveryRequired
                    }) =>
                {
                    bail!("Import relocation requires filesystem recovery")
                }
                Ok(outcome) => Some(outcome),
                Err(error) => {
                    if project_root
                        .join(JOURNAL_FILE)
                        .try_exists()
                        .context("Failed to inspect relocation recovery journal")?
                    {
                        // Mutation may be in flight. Keep Finalizing so activation
                        // relocation recovery settles custody before retry.
                        return Err(error);
                    }
                    cleanup_errors.push(format!("relocation: {error:#}"));
                    None
                }
            }
        };
        (outcomes, relocation, cleanup_errors)
    };
    if relocation_outcome.is_some()
        && project_root
            .join(JOURNAL_FILE)
            .try_exists()
            .context("Failed to inspect pending relocation cleanup")?
    {
        cleanup_errors.push(
            "Relocation cleanup remains pending; staging and recovery journal retained".to_string(),
        );
    }
    if let Some(relocation) = &relocation_outcome {
        for outcome in &mut outcomes {
            if let Some(subject) = relocation
                .subjects
                .iter()
                .find(|entry| entry.subject == outcome.subject)
            {
                if subject.status == RelocationSubjectStatus::Committed {
                    outcome.outcome = ImportSubjectOutcomeKind::Committed;
                    outcome.committed = true;
                    if let Some(message) = &subject.message {
                        cleanup_errors.push(format!("{}: {message}", outcome.subject));
                    }
                } else {
                    outcome.outcome = ImportSubjectOutcomeKind::Failed;
                    outcome.error = Some(ImportStructuredError {
                        code: "relocation".to_string(),
                        message: subject
                            .message
                            .clone()
                            .unwrap_or_else(|| "Relocation did not commit".to_string()),
                        subject: Some(outcome.subject.clone()),
                        staging_issues: None,
                    });
                }
            }
        }
        if preserve_staging
            && !relocation.subjects.is_empty()
            && relocation
                .subjects
                .iter()
                .all(|subject| subject.status == RelocationSubjectStatus::Committed)
            && let Err(error) = copy_import_configs(&staging_root, &project_root)
        {
            cleanup_errors.push(format!("debug config preservation: {error:#}"));
        }
    }
    let successful = true
        && exit_code == 0
        && outcomes.len() == subjects.len()
        && outcomes.iter().all(|outcome| outcome.committed)
        && relocation_outcome
            .as_ref()
            .is_some_and(|outcome| outcome.staging_cleanup_complete || preserve_staging)
        && cleanup_errors.is_empty();
    let mut run = state
        .import_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Import state lock was poisoned"))?;
    if run.ownership_generation != generation
        || run.lifecycle != ImportLifecycle::Finalizing
        || run.project_root != project_root
    {
        bail!("Import finalizer became obsolete before terminal checkpoint");
    }
    // Relocation and its resulting per-subject classifications form their own
    // durable Finalizing checkpoint. Discovery must never expose these
    // mutations solely from memory if the later terminal write fails.
    let prior_outcomes = std::mem::replace(&mut run.subject_outcomes, outcomes);
    let prior_relocation = std::mem::replace(&mut run.relocation_outcome, relocation_outcome);
    if let Err(error) = write_record(&run.project_root, &record_from_state(&run)?) {
        run.subject_outcomes = prior_outcomes;
        run.relocation_outcome = prior_relocation;
        return Err(error);
    }
    let terminal = if successful {
        ImportLifecycle::Completed
    } else {
        ImportLifecycle::Failed
    };
    let prior_updated_at = run.updated_at_ms;
    run.transition(terminal).map_err(anyhow::Error::msg)?;
    run.terminal_result = Some(if successful {
        ImportTerminalResult::Completed
    } else {
        ImportTerminalResult::Failed
    });
    let prior_error = run.error.clone();
    if !successful && true {
        run.error = Some(ImportStructuredError {
            code: "finalization".to_string(),
            message: if !cleanup_errors.is_empty() {
                format!("Import finalization failed: {}", cleanup_errors.join("; "))
            } else if exit_code == 0 {
                "Import completion verification or relocation failed".to_string()
            } else {
                format!("Import process exited with code {exit_code}")
            },
            subject: None,
            staging_issues: None,
        });
    }
    // Terminal result is durable before the best-effort event.
    if let Err(error) = write_record(&run.project_root, &record_from_state(&run)?) {
        run.lifecycle = ImportLifecycle::Finalizing;
        run.updated_at_ms = prior_updated_at;
        run.terminal_result = None;
        run.error = prior_error;
        return Err(error);
    }
    Ok(run.snapshot())
}
