use super::cleanup::cleanup_after_terminal;
use super::commit::commit_subject;
use super::error::{
    RelocationTransactionError, RelocationTransactionResult, format_transaction_error,
};
use super::fault_injection::{FaultPoint, fail};
use super::filesystem::path_exists;
use super::inventory::create_plan;
use super::journal::{JOURNAL_VERSION, journal_path, remove_journal_owned, write_journal};
use super::paths::{canonical_project_root, project_identity, reject_symlink_components};
use super::planning::{planned_dataset, planned_subject};
use super::prepare::{prepare_dataset, prepare_subject};
use super::rollback::rollback_subject;
use super::types::{
    RelocationJournal, RelocationOutcome, RelocationPlan, RelocationSubjectStatus,
    SubjectFailurePhase, SubjectPhase, SubjectRelocationOutcome,
};
use std::collections::BTreeSet;
use std::path::Path;

pub fn relocate(
    plan: &RelocationPlan,
    generation: u64,
    staging: &Path,
    succeeded_subjects: &[String],
    cleanup_staging: bool,
    debug_mode: bool,
) -> anyhow::Result<RelocationOutcome> {
    relocate_result(
        plan,
        generation,
        staging,
        succeeded_subjects,
        cleanup_staging,
        debug_mode,
    )
    .map_err(anyhow::Error::from)
}

fn relocate_result(
    plan: &RelocationPlan,
    generation: u64,
    staging: &Path,
    succeeded_subjects: &[String],
    cleanup_staging: bool,
    debug_mode: bool,
) -> RelocationTransactionResult<RelocationOutcome> {
    if plan.bound_generation != Some(generation) {
        return Err("Relocation plan is not bound to this import generation".into());
    }
    let root = canonical_project_root(&plan.project_root)?;
    if project_identity(&root) != plan.project_identity {
        return Err("Relocation plan belongs to another project".into());
    }
    reject_symlink_components(&root, staging)?;
    if !staging.is_dir() {
        return Err("Import staging root is missing".into());
    }
    let current = create_plan(
        &root,
        &plan
            .subjects
            .iter()
            .map(|subject| subject.subject.clone())
            .collect::<Vec<_>>(),
        plan.plan_id.clone(),
    )?;
    if current.fingerprint != plan.fingerprint {
        return Err("Relocation plan is stale; project output changed after confirmation".into());
    }
    crate::import::validate_subject_components(succeeded_subjects)?;
    let planned_keys = plan
        .subjects
        .iter()
        .map(|inventory| crate::import::staging::portable_key(&inventory.subject))
        .collect::<BTreeSet<_>>();
    let succeeded_keys = succeeded_subjects
        .iter()
        .map(|subject| crate::import::staging::portable_key(subject))
        .collect::<BTreeSet<_>>();
    if !succeeded_keys.is_subset(&planned_keys) {
        return Err("Succeeded import subjects do not match the confirmed relocation plan".into());
    }
    if succeeded_keys.is_empty() {
        return Ok(RelocationOutcome {
            plan_id: plan.plan_id.clone(),
            generation,
            subjects: Vec::new(),
            staging_cleanup_complete: false,
        });
    }
    if path_exists(&journal_path(&root))? {
        return Err("An import relocation journal already requires recovery".into());
    }

    // Full run preflight. No project mutation may happen before every persisted
    // destination and reserved path has passed structural and collision checks.
    let selected = plan
        .subjects
        .iter()
        .filter(|inventory| {
            succeeded_keys.contains(&crate::import::staging::portable_key(&inventory.subject))
        })
        .collect::<Vec<_>>();
    let dataset = planned_dataset(&root, staging, plan)?;
    let mut subjects = Vec::with_capacity(selected.len());
    for inventory in selected {
        subjects.push(planned_subject(&root, staging, plan, inventory)?);
    }
    let mut journal = RelocationJournal {
        version: JOURNAL_VERSION,
        project_identity: plan.project_identity.clone(),
        generation,
        plan_id: plan.plan_id.clone(),
        plan_fingerprint: plan.fingerprint.clone(),
        dataset,
        subjects,
        terminal_outcome: None,
    };
    write_journal(&root, &journal)?;
    prepare_dataset(&root, staging, &mut journal)?;

    let mut outcomes = Vec::with_capacity(journal.subjects.len());
    let mut stop_after_recovery_required = false;
    for index in 0..journal.subjects.len() {
        let subject = journal.subjects[index].subject.clone();
        if stop_after_recovery_required {
            outcomes.push(SubjectRelocationOutcome {
                subject,
                status: RelocationSubjectStatus::RecoveryRequired,
                phase: "notAttempted".to_string(),
                message: Some(
                    "Not attempted because an earlier subject requires filesystem recovery"
                        .to_string(),
                ),
            });
            continue;
        }
        let mut failure_phase = SubjectFailurePhase::CandidatePreparation;
        let result = prepare_subject(&root, staging, &mut journal, index)
            .and_then(|()| commit_subject(&root, &mut journal, index, &mut failure_phase));
        match result {
            Ok(()) => outcomes.push(SubjectRelocationOutcome {
                subject,
                status: RelocationSubjectStatus::Committed,
                phase: "committed".to_string(),
                message: None,
            }),
            Err(error @ RelocationTransactionError::Interrupted { .. }) => {
                return Err(error);
            }
            Err(error) => {
                let error = format_transaction_error(&error);
                match rollback_subject(&root, &mut journal, index) {
                    Ok(()) => outcomes.push(SubjectRelocationOutcome {
                        subject,
                        status: RelocationSubjectStatus::RolledBack,
                        phase: failure_phase.as_str().to_string(),
                        message: Some(error),
                    }),
                    Err(recovery_error @ RelocationTransactionError::Interrupted { .. }) => {
                        return Err(recovery_error);
                    }
                    Err(recovery_error) => {
                        let recovery_error = format_transaction_error(&recovery_error);
                        journal.subjects[index].phase = SubjectPhase::RecoveryRequired;
                        // Best effort only: failed persistence itself is another reason to retain journal.
                        let _ = write_journal(&root, &journal);
                        outcomes.push(SubjectRelocationOutcome {
                            subject,
                            status: RelocationSubjectStatus::RecoveryRequired,
                            phase: "recovery".to_string(),
                            message: Some(format!(
                                "{failure_phase} failed: {error}; rollback failed: {recovery_error}"
                            )),
                        });
                        stop_after_recovery_required = true;
                    }
                }
            }
        }
    }
    let mut outcome = RelocationOutcome {
        plan_id: plan.plan_id.clone(),
        generation,
        subjects: outcomes,
        staging_cleanup_complete: false,
    };
    fail(FaultPoint::OutcomePersist)?;
    journal.terminal_outcome = Some(outcome.clone());
    write_journal(&root, &journal)?;

    let all_committed = !outcome.subjects.is_empty()
        && outcome
            .subjects
            .iter()
            .all(|subject| subject.status == RelocationSubjectStatus::Committed);
    if outcome
        .subjects
        .iter()
        .any(|subject| subject.status == RelocationSubjectStatus::RecoveryRequired)
    {
        // Unsafe or ambiguous evidence must remain journaled for activation
        // recovery/manual intervention. No cleanup path may guess ownership.
        return Ok(outcome);
    }
    if let Err(error) = cleanup_after_terminal(&root, &mut journal) {
        if matches!(error, RelocationTransactionError::Interrupted { .. }) {
            return Err(error);
        }
        // Authoritative subject outcomes are durable. Retain journal and staging;
        // activation recovery can finish cleanup and surface a warning.
        log::warn!(
            "Relocation terminal cleanup deferred: {}",
            format_transaction_error(&error)
        );
        return Ok(outcome);
    }
    if all_committed && cleanup_staging && !debug_mode {
        if let Err(error) = crate::import::cleanup_staging_root(staging) {
            log::warn!("Relocation staging cleanup deferred: {error:#}");
            return Ok(outcome);
        }
        outcome.staging_cleanup_complete = true;
        journal.terminal_outcome = Some(outcome.clone());
        write_journal(&root, &journal)?;
    }
    crate::import::journal::checkpoint_relocation_outcome(&root, &outcome)?;
    remove_journal_owned(&root, &journal)?;
    Ok(outcome)
}
