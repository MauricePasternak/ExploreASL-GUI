//! Rollback, terminal cleanup, and selected-root recovery for project setup.
use super::fault_injection::fail;
use super::filesystem::{
    EntryKind, find_owned_sibling, fixed_path, inspect, safe_relative, sync_parent,
};
use super::journal::{
    JOURNAL_PREFIX, OperationPhase, SetupJournal, TransactionPhase, journal_name, persist_phase,
    read_journal, remove_owned_journal, write_journal,
};
use super::{SetupCommitResult, SetupMode, SetupRecoverySummary};
use crate::project::ownership::ActiveProject;
use anyhow::{Result, anyhow, bail};
use std::fs;
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
        project_document: None,
        candidate_id: None,
        directory_sync_supported: sync_parent(root)?,
    });
    write_journal(root, journal)?;
    Ok(())
}
pub(super) fn cleanup_terminal(root: &Path, journal: &SetupJournal) -> Result<()> {
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
fn recover_journal(root: &Path, mut journal: SetupJournal) -> Result<()> {
    if journal.terminal.is_some() {
        return cleanup_terminal(root, &journal);
    }
    if complete_after_state(root, &journal)? {
        journal.phase = TransactionPhase::Committed;
        journal.terminal = Some(SetupCommitResult {
            outcome: "committed".into(),
            project_path: (journal.mode != SetupMode::Repair)
                .then(|| root.join("project.easl").to_string_lossy().into_owned()),
            project_document: None,
            candidate_id: None,
            directory_sync_supported: sync_parent(root)?,
        });
        write_journal(root, &journal)?;
        return cleanup_terminal(root, &journal);
    }
    rollback(root, &mut journal)?;
    cleanup_terminal(root, &journal)
}
pub fn recover_root(root: &Path) -> Result<SetupRecoverySummary> {
    let ownership = ActiveProject::open(root)?;
    recover_root_owned(&ownership)
}
pub(crate) fn recover_root_owned(ownership: &ActiveProject) -> Result<SetupRecoverySummary> {
    crate::import::recover_processing_before_import(ownership.root())?;
    recover_root_after_processing_recovery(ownership)
}

pub(crate) fn recover_root_after_processing_recovery(
    ownership: &ActiveProject,
) -> Result<SetupRecoverySummary> {
    ownership.verify_root_identity()?;
    let root = ownership.root();
    // Validate every discovered journal before any recovery mutation.
    let mut journals = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(id) = name
            .strip_prefix(JOURNAL_PREFIX)
            .and_then(|name| name.strip_suffix(".json"))
        {
            let journal = read_journal(root, id).map_err(|error| anyhow!(
                "Setup recovery blocked at {}: {error:#}. Preserve evidence and use a compatible build or manual recovery.", entry.path().display()
            ))?;
            if journal_name(&journal.journal_id) != name {
                bail!(
                    "Setup recovery blocked: journal filename and identity disagree; preserve evidence for manual recovery"
                );
            }
            journals.push(journal);
        }
    }
    let mut summary = SetupRecoverySummary {
        recovered: 0,
        deferred_roots: vec![],
        blocked: vec![],
    };
    for journal in journals {
        match recover_journal(root, journal) {
            Ok(()) => summary.recovered += 1,
            Err(error) => summary
                .blocked
                .push(format!("{}: {error:#}", root.display())),
        }
    }
    if !summary.deferred_roots.is_empty() || !summary.blocked.is_empty() {
        bail!(
            "Setup recovery blocked: {}. Preserve evidence for manual recovery before using this root",
            summary.blocked.join("; ")
        );
    }
    Ok(summary)
}
