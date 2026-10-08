//! Dedicated fixed-path transaction for project creation and compatibility repair.
//! Import relocation has separate transaction semantics.
use super::fault_injection::{fail, observe_install};
use super::filesystem::{
    EntryKind, Fingerprint, fixed_path, hash, inspect, owned_sibling, random_id, relative_to_root,
    safe_relative, sync_parent, validate_fixed_hierarchy,
};
use super::journal::{
    OperationPhase, TransactionPhase, initial_journal, persist_phase, update_operation,
    write_journal,
};
use super::planning::{CachedPlan, check_fresh};
use super::recovery::{cleanup_terminal, rollback};
use super::{RAWDATA_MARKER_PATH, SetupCommitResult, SetupMode, SetupPlans};
use crate::app::state::AppState;
use crate::project::ownership::{self, ActiveProject};
use anyhow::{Context, Result, anyhow, bail};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

pub(super) fn create_candidate(
    root: &Path,
    destination: &Path,
    transaction: &str,
    bytes: &[u8],
) -> Result<(String, Fingerprint)> {
    validate_fixed_hierarchy(root, destination)?;
    for index in 0..100u32 {
        let path = owned_sibling(destination, transaction, "candidate", &index.to_string())?;
        fail("candidate-create")?;
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let result = (|| -> Result<Fingerprint> {
                    fail("candidate-write")?;
                    file.write_all(bytes)?;
                    fail("candidate-flush")?;
                    file.sync_all()?;
                    drop(file);
                    fail("candidate-verify")?;
                    let fingerprint = inspect(&path, true)?;
                    if fingerprint.hash.as_deref() != Some(&hash(bytes)) {
                        bail!("Setup candidate hash verification failed");
                    }
                    sync_parent(path.parent().unwrap())?;
                    Ok(fingerprint)
                })();
                if result.is_err() {
                    let _ = fs::remove_file(&path);
                }
                return match result {
                    Ok(fingerprint) => Ok((relative_to_root(root, &path)?, fingerprint)),
                    Err(error) => Err(error),
                };
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    bail!("Could not allocate same-parent setup candidate")
}
pub(super) fn bytes_for<'a>(plan: &'a CachedPlan, destination: &str) -> Option<&'a [u8]> {
    match destination {
        RAWDATA_MARKER_PATH => plan.marker_bytes.as_deref(),
        ".bidsignore" => plan.ignore_bytes.as_deref(),
        "project.easl" => plan.project_bytes.as_deref(),
        _ => None,
    }
}
pub(super) fn backup_for(
    root: &Path,
    destination: &Path,
    transaction: &str,
    expected_before: &Fingerprint,
) -> Result<(String, Fingerprint)> {
    validate_fixed_hierarchy(root, destination)?;
    let before = inspect(destination, true)?;
    if &before != expected_before || before.kind != EntryKind::File {
        bail!("Setup destination changed before backup");
    }
    for index in 0..100u32 {
        let backup = owned_sibling(destination, transaction, "backup", &index.to_string())?;
        if fs::symlink_metadata(&backup).is_ok() {
            continue;
        }
        fail("backup")?;
        fs::rename(destination, &backup)
            .with_context(|| format!("Could not back up {}", destination.display()))?;
        sync_parent(backup.parent().unwrap())?;
        validate_fixed_hierarchy(root, &backup)?;
        if inspect(&backup, true)? != before {
            bail!("Setup backup verification failed");
        }
        return Ok((relative_to_root(root, &backup)?, before));
    }
    bail!("Could not allocate setup backup")
}
fn install_candidate(
    root: &Path,
    destination: &Path,
    candidate: &str,
    after: &Fingerprint,
) -> Result<()> {
    validate_fixed_hierarchy(root, destination)?;
    let candidate_path = root.join(safe_relative(candidate)?);
    validate_fixed_hierarchy(root, &candidate_path)?;
    if inspect(&candidate_path, true)? != *after {
        bail!("Setup candidate ownership validation failed");
    }
    if fs::symlink_metadata(destination).is_ok() {
        bail!("Setup destination changed before install");
    }
    fail("install")?;
    fail(
        match destination.file_name().and_then(|name| name.to_str()) {
            Some(".easl-gui-managed") => "install-marker",
            Some(".bidsignore") => "install-ignore",
            Some("project.easl") => "install-project",
            _ => return Err(anyhow!("Unsupported setup install destination")),
        },
    )?;
    fs::rename(&candidate_path, destination)
        .with_context(|| format!("Could not install {}", destination.display()))?;
    sync_parent(destination.parent().unwrap())?;
    validate_fixed_hierarchy(root, destination)?;
    if inspect(destination, true)? != *after {
        bail!("Setup install verification failed");
    }
    observe_install(destination);
    Ok(())
}

fn commit_plan(plan: &CachedPlan) -> Result<SetupCommitResult> {
    check_fresh(plan)?;
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    let registry_id = random_id("registry");
    let mut journal = initial_journal(plan, transaction_id, journal_id, registry_id)?;
    write_journal(&plan.root, &journal)?;
    let attempt = (|| -> Result<SetupCommitResult> {
        persist_phase(&plan.root, &mut journal, TransactionPhase::Preparing)?;
        if matches!(plan.mode, SetupMode::Bids | SetupMode::Repair)
            && plan.observations["rawdata"].kind == EntryKind::Missing
        {
            // Directory intent is durable before mkdir.
            fail("intent")?;
            fail("rawdata-intent")?;
            journal.directory_phase = OperationPhase::CreateIntent;
            write_journal(&plan.root, &journal)?;
            fail("rawdata-create")?;
            let rawdata = fixed_path(&plan.root, "rawdata")?;
            validate_fixed_hierarchy(&plan.root, &rawdata)?;
            if inspect(&rawdata, false)?.kind != EntryKind::Missing {
                bail!("rawdata changed before creation");
            }
            fs::create_dir(&rawdata)?;
            if inspect(&rawdata, false)?.kind != EntryKind::Directory {
                bail!("rawdata changed while creating it");
            }
            // Keep in-process rollback ownership after mkdir succeeds even if
            // recording the completion or flushing the directory fails. A
            // crash with only CreateIntent remains deliberately ambiguous to
            // recovery and is never deleted blindly.
            journal.directory_phase = OperationPhase::Created;
            write_journal(&plan.root, &journal)?;
            sync_parent(&plan.root)?;
        }
        for index in 0..journal.operations.len() {
            let destination = journal.operations[index].destination.clone();
            let target = fixed_path(&plan.root, &destination)?;
            update_operation(
                &plan.root,
                &mut journal,
                index,
                OperationPhase::CandidateIntent,
            )?;
            let bytes =
                bytes_for(plan, &destination).ok_or_else(|| anyhow!("Setup plan bytes missing"))?;
            let (candidate, after) =
                create_candidate(&plan.root, &target, &journal.transaction_id, bytes)?;
            journal.operations[index].candidate = Some(candidate);
            journal.operations[index].after = Some(after);
            update_operation(
                &plan.root,
                &mut journal,
                index,
                OperationPhase::CandidateReady,
            )?;
        }
        persist_phase(&plan.root, &mut journal, TransactionPhase::Committing)?;
        // Journal order is marker, ignore, project. project.easl therefore remains the visibility point.
        for index in 0..journal.operations.len() {
            let target = fixed_path(&plan.root, &journal.operations[index].destination)?;
            if journal.operations[index].before.kind == EntryKind::File {
                update_operation(
                    &plan.root,
                    &mut journal,
                    index,
                    OperationPhase::BackupIntent,
                )?;
                let expected_before = journal.operations[index].before.clone();
                let (backup, _) = backup_for(
                    &plan.root,
                    &target,
                    &journal.transaction_id,
                    &expected_before,
                )?;
                journal.operations[index].backup = Some(backup);
                update_operation(&plan.root, &mut journal, index, OperationPhase::BackedUp)?;
            } else if journal.operations[index].before.kind != EntryKind::Missing {
                bail!("Unsafe setup replacement target");
            }
            update_operation(
                &plan.root,
                &mut journal,
                index,
                OperationPhase::InstallIntent,
            )?;
            if let Some(backup) = journal.operations[index].backup.as_deref() {
                let backup = plan.root.join(safe_relative(backup)?);
                if inspect(&backup, true)? != journal.operations[index].before {
                    bail!("Setup backup changed before install");
                }
            }
            install_candidate(
                &plan.root,
                &target,
                journal.operations[index].candidate.as_deref().unwrap(),
                journal.operations[index].after.as_ref().unwrap(),
            )?;
            update_operation(&plan.root, &mut journal, index, OperationPhase::Installed)?;
        }
        fail("root-flush")?;
        let durable = sync_parent(&plan.root)?;
        let result = SetupCommitResult {
            outcome: "committed".into(),
            project_path: plan.project_bytes.as_ref().map(|_| {
                plan.root
                    .join("project.easl")
                    .to_string_lossy()
                    .into_owned()
            }),
            project_document: plan
                .project_bytes
                .as_deref()
                .map(crate::project::validation::parse_document)
                .transpose()?,
            candidate_id: None,
            directory_sync_supported: durable,
        };
        journal.phase = TransactionPhase::Committed;
        journal.terminal = Some(result.clone());
        write_journal(&plan.root, &journal)?;
        Ok(result)
    })();
    match attempt {
        Ok(result) => {
            if let Err(error) = cleanup_terminal(&plan.root, &journal) {
                log::warn!("Setup committed; deferred terminal cleanup: {error:#}");
            }
            Ok(result)
        }
        Err(error) => match rollback(&plan.root, &mut journal) {
            Ok(()) => {
                let _ = cleanup_terminal(&plan.root, &journal);
                Err(anyhow!(
                    "Setup changes rolled back after failure: {error:#}"
                ))
            }
            Err(rollback_error) => {
                journal.phase = TransactionPhase::RecoveryRequired;
                let _ = write_journal(&plan.root, &journal);
                Err(anyhow!(
                    "Setup failed ({error:#}); recovery required ({rollback_error:#})"
                ))
            }
        },
    }
}

pub fn commit_for_state(plans: &SetupPlans, plan_id: &str) -> Result<SetupCommitResult> {
    commit_with_ownership(plans, plan_id, |root| {
        Ok(std::sync::Arc::new(ActiveProject::open(root)?))
    })
}
pub(crate) fn commit_for_app_state(state: &AppState, plan_id: &str) -> Result<SetupCommitResult> {
    commit_with_ownership(&state.setup_plans, plan_id, |root| {
        ownership::for_setup(state, root).map_err(anyhow::Error::msg)
    })
}
fn commit_with_ownership(
    plans: &SetupPlans,
    plan_id: &str,
    acquire: impl FnOnce(&Path) -> Result<std::sync::Arc<ActiveProject>>,
) -> Result<SetupCommitResult> {
    let mut cache = plans
        .0
        .lock()
        .map_err(|_| anyhow!("Setup plan cache unavailable"))?;
    let plan = cache
        .get_mut(plan_id)
        .ok_or_else(|| anyhow!("Unknown or superseded setup plan; review a fresh plan"))?;
    if let Some(result) = &plan.result {
        return Ok(result.clone());
    }
    if let Some(error) = &plan.terminal_failure {
        bail!("{error}");
    }
    if plan.claimed {
        bail!("Setup plan is currently being committed");
    }
    let _ownership = acquire(&plan.root)?;
    plan.claimed = true;
    let result = commit_plan(plan);
    match &result {
        Ok(value) => plan.result = Some(value.clone()),
        Err(error) => plan.terminal_failure = Some(format!("{error:#}")),
    }
    result
}
