//! Rollback, terminal cleanup, and startup/targeted recovery for project setup.
use super::fault_injection::fail;
use super::filesystem::{
    EntryKind, canonical_root, find_owned_sibling, fixed_path, inspect, safe_relative, sync_parent,
};
use super::journal::{
    OperationPhase, PendingEntry, REGISTRY_VERSION, SetupJournal, TransactionPhase, load_registry,
    persist_phase, read_journal, remove_owned_journal, remove_pending, validate_registry_entry,
    write_journal,
};
use super::{SetupCommitResult, SetupMode, SetupRecoverySummary};
use crate::project::ownership::ActiveProject;
use anyhow::{Result, anyhow, bail};
use std::fs;
use std::io;
use std::path::Path;

pub(super) fn rollback(root: &Path, journal: &mut SetupJournal) -> Result<()> {
    persist_phase(root, journal, TransactionPhase::RollingBack)?;
    for index in (0..journal.operations.len()).rev() {
        let operation = journal.operations[index].clone();
        let target = fixed_path(root, &operation.destination)?;
        let after = operation.after.as_ref();
        let backup_path = match operation.backup.as_deref() {
            Some(relative) => Some(root.join(safe_relative(relative)?)),
            None => find_owned_sibling(
                &target,
                &journal.transaction_id,
                "backup",
                &operation.before,
            )?,
        };
        let installed = matches!(
            operation.phase,
            OperationPhase::Installed | OperationPhase::InstallIntent
        ) && after
            .is_some_and(|expected| inspect(&target, true).ok().as_ref() == Some(expected));
        match operation.phase {
            OperationPhase::Installed | OperationPhase::InstallIntent if installed => {
                let after = operation
                    .after
                    .as_ref()
                    .ok_or_else(|| anyhow!("Installed operation has no fingerprint"))?;
                if inspect(&target, true)? != *after {
                    bail!("Installed setup file changed; recovery required");
                }
                fs::remove_file(&target)?;
                sync_parent(target.parent().unwrap())?;
                if let Some(backup_path) = backup_path {
                    if inspect(&backup_path, true)? != operation.before {
                        bail!("Setup backup changed; recovery required");
                    }
                    fs::rename(&backup_path, &target)?;
                    sync_parent(target.parent().unwrap())?;
                }
            }
            OperationPhase::BackedUp
            | OperationPhase::BackupIntent
            | OperationPhase::InstallIntent => {
                if let Some(backup_path) = backup_path {
                    if inspect(&target, true)?.kind != EntryKind::Missing
                        || inspect(&backup_path, true)? != operation.before
                    {
                        bail!("Setup backup ownership is ambiguous");
                    }
                    fs::rename(&backup_path, &target)?;
                    sync_parent(target.parent().unwrap())?;
                }
            }
            _ => {}
        }
        let candidate_path = match operation.candidate.as_deref() {
            Some(candidate) => Some(root.join(safe_relative(candidate)?)),
            None => match operation.after.as_ref() {
                Some(expected) => {
                    find_owned_sibling(&target, &journal.transaction_id, "candidate", expected)?
                }
                None => None,
            },
        };
        if let Some(candidate_path) = candidate_path
            && let Ok(candidate_fp) = inspect(&candidate_path, true)
            && candidate_fp.kind != EntryKind::Missing
        {
            if operation.after.as_ref() != Some(&candidate_fp) {
                bail!("Setup candidate ownership is ambiguous");
            }
            fs::remove_file(candidate_path)?;
        }
        journal.operations[index].phase = OperationPhase::NoOp;
        write_journal(root, journal)?;
    }
    match journal.directory_phase {
        // CreateIntent is durable before mkdir. If a crash happened after mkdir
        // but before Created was persisted, the directory could be ours or a
        // concurrent creator's. Never infer ownership from that intent alone.
        OperationPhase::CreateIntent => {
            let rawdata = fixed_path(root, "rawdata")?;
            if inspect(&rawdata, false)?.kind != EntryKind::Missing {
                bail!("rawdata create intent outcome is ambiguous; recovery required");
            }
        }
        OperationPhase::Created => {
            let rawdata = fixed_path(root, "rawdata")?;
            if inspect(&rawdata, false)?.kind != EntryKind::Directory {
                bail!("Created rawdata ownership is ambiguous");
            }
            if fs::read_dir(&rawdata)?.next().is_some() {
                bail!("Created rawdata contains concurrent entries; recovery required");
            }
            fs::remove_dir(&rawdata)?;
            sync_parent(root)?;
        }
        _ => {}
    }
    persist_phase(root, journal, TransactionPhase::RolledBack)?;
    journal.terminal = Some(SetupCommitResult {
        outcome: "rolled_back".into(),
        project_path: None,
        canonical_project_bytes: None,
        directory_sync_supported: sync_parent(root)?,
    });
    write_journal(root, journal)?;
    Ok(())
}
pub(super) fn cleanup_terminal(root: &Path, journal: &SetupJournal, app_data: &Path) -> Result<()> {
    fail("cleanup")?;
    for operation in &journal.operations {
        if let Some(candidate) = &operation.candidate {
            let candidate_path = root.join(safe_relative(candidate)?);
            if let Ok(fp) = inspect(&candidate_path, true)
                && fp.kind != EntryKind::Missing
            {
                if operation.after.as_ref() != Some(&fp) {
                    bail!("Setup candidate ownership is ambiguous");
                }
                fs::remove_file(candidate_path)?;
            }
        }
        if let Some(backup) = &operation.backup {
            let backup_path = root.join(safe_relative(backup)?);
            if let Ok(fp) = inspect(&backup_path, true)
                && fp.kind != EntryKind::Missing
            {
                if fp != operation.before {
                    bail!("Setup backup ownership is ambiguous");
                }
                fs::remove_file(backup_path)?;
            }
        }
    }
    sync_parent(root)?;
    // Remove durable global discovery before deleting its paired journal. If
    // the registry write fails after journal deletion, a future startup has a
    // dangling entry it cannot validate or clean up and blocks the root
    // forever. A crash after registry removal can leave only a terminal
    // journal, which is inert and safe to retain as cleanup debris.
    remove_pending(app_data, &journal.registry_id)?;
    remove_owned_journal(root, journal)
}

fn complete_after_state(root: &Path, journal: &SetupJournal) -> Result<bool> {
    if journal.phase == TransactionPhase::RolledBack {
        return Ok(false);
    }
    for operation in &journal.operations {
        let Some(after) = &operation.after else {
            return Ok(false);
        };
        if inspect(&fixed_path(root, &operation.destination)?, true)? != *after {
            return Ok(false);
        }
    }
    if matches!(journal.mode, SetupMode::Bids | SetupMode::Repair)
        && inspect(&fixed_path(root, "rawdata")?, false)?.kind != EntryKind::Directory
    {
        return Ok(false);
    }
    Ok(!journal.operations.is_empty())
}
fn recover_entry(app_data: &Path, entry: &PendingEntry) -> Result<bool> {
    validate_registry_entry(entry)?;
    let root = match canonical_root(Path::new(&entry.root)) {
        Ok(root) => root,
        Err(error) => {
            if matches!(
                error.downcast_ref::<io::Error>().map(io::Error::kind),
                Some(io::ErrorKind::NotFound)
            ) {
                return Ok(false);
            }
            return Err(error.context("Setup recovery root is unavailable"));
        }
    };
    let ownership = ActiveProject::open(&root)?;
    crate::import::recover_processing_before_import(&root)?;
    recover_entry_owned(app_data, entry, &ownership)
}
fn recover_entry_owned(
    app_data: &Path,
    entry: &PendingEntry,
    ownership: &ActiveProject,
) -> Result<bool> {
    validate_registry_entry(entry)?;
    let root = ownership.root();
    if canonical_root(Path::new(&entry.root))? != root {
        bail!("Setup recovery native ownership mismatch");
    }
    let mut journal = read_journal(root, &entry.journal_id)?;
    if journal.registry_id != entry.registry_id
        || journal.transaction_id != entry.transaction_id
        || journal.journal_id != entry.journal_id
    {
        bail!("Setup registry and journal identities diverge");
    }
    if let Some(result) = &journal.terminal {
        cleanup_terminal(root, &journal, app_data)?;
        return Ok(result.outcome == "committed");
    }
    if complete_after_state(root, &journal)? {
        journal.phase = TransactionPhase::Committed;
        journal.terminal = Some(SetupCommitResult {
            outcome: "committed".into(),
            project_path: (journal.mode != SetupMode::Repair)
                .then(|| root.join("project.easl").to_string_lossy().into_owned()),
            canonical_project_bytes: None,
            directory_sync_supported: sync_parent(root)?,
        });
        write_journal(root, &journal)?;
        cleanup_terminal(root, &journal, app_data)?;
        return Ok(true);
    }
    rollback(root, &mut journal)?;
    cleanup_terminal(root, &journal, app_data)?;
    Ok(true)
}
pub fn recover_all(app_data: &Path) -> Result<SetupRecoverySummary> {
    let registry = load_registry(app_data)?;
    if registry.version != REGISTRY_VERSION {
        bail!("Unsupported setup pending registry version");
    }
    let mut summary = SetupRecoverySummary {
        recovered: 0,
        deferred_roots: vec![],
        blocked: vec![],
    };
    for entry in registry.entries {
        match recover_entry(app_data, &entry) {
            Ok(true) => summary.recovered += 1,
            Ok(false) => summary.deferred_roots.push(entry.root),
            Err(error) => summary.blocked.push(format!("{}: {error:#}", entry.root)),
        }
    }
    if !summary.blocked.is_empty() {
        bail!(
            "BIDS setup recovery blocked: {}",
            summary.blocked.join("; ")
        );
    }
    Ok(summary)
}
/// Application startup entrypoint. Kept separate so startup recovery has a
/// direct test target and cannot be accidentally bypassed by builder wiring.
pub fn recover_at_startup(app_data: &Path) -> Result<SetupRecoverySummary> {
    recover_all(app_data)
}
pub fn recover_root(app_data: &Path, root: &Path) -> Result<SetupRecoverySummary> {
    let ownership = ActiveProject::open(root)?;
    recover_root_owned(app_data, &ownership)
}
pub(crate) fn recover_root_owned(
    app_data: &Path,
    ownership: &ActiveProject,
) -> Result<SetupRecoverySummary> {
    crate::import::recover_processing_before_import(ownership.root())?;
    recover_root_after_processing_recovery(app_data, ownership)
}

pub(crate) fn recover_root_after_processing_recovery(
    app_data: &Path,
    ownership: &ActiveProject,
) -> Result<SetupRecoverySummary> {
    let canonical = ownership.root().to_path_buf();
    let registry = load_registry(app_data)?;
    let entries = registry
        .entries
        .into_iter()
        .filter(|entry| {
            Path::new(&entry.root) == canonical
                || fs::canonicalize(&entry.root).ok().as_ref() == Some(&canonical)
        })
        .collect::<Vec<_>>();
    let mut summary = SetupRecoverySummary {
        recovered: 0,
        deferred_roots: vec![],
        blocked: vec![],
    };
    for entry in entries {
        match recover_entry_owned(app_data, &entry, ownership) {
            Ok(true) => summary.recovered += 1,
            Ok(false) => summary.deferred_roots.push(entry.root),
            Err(error) => summary.blocked.push(format!("{}: {error:#}", entry.root)),
        }
    }
    if !summary.deferred_roots.is_empty() || !summary.blocked.is_empty() {
        bail!("BIDS setup recovery must finish before using this root");
    }
    Ok(summary)
}
