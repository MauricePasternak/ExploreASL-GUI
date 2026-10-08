//! Root-local setup journal validation and persistence.
use super::fault_injection::fail;
use super::filesystem::{
    EntryKind, Fingerprint, fixed_path, hash, owned_sibling, persist_bytes, persist_new_bytes,
    read_bounded, safe_relative, sync_parent,
};
use super::planning::CachedPlan;
use super::{OperationKind, RAWDATA_MARKER_PATH, SetupCommitResult, SetupMode};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub(super) const JOURNAL_VERSION: u32 = 1;
pub(super) const JOURNAL_PREFIX: &str = ".easl-gui-setup-";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum TransactionPhase {
    Planned,
    Preparing,
    Committing,
    Committed,
    RollingBack,
    RolledBack,
    RecoveryRequired,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum OperationPhase {
    Planned,
    CandidateIntent,
    CandidateReady,
    CreateIntent,
    Created,
    BackupIntent,
    BackedUp,
    InstallIntent,
    Installed,
    NoOp,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct JournalOperation {
    pub(super) destination: String,
    pub(super) kind: OperationKind,
    pub(super) phase: OperationPhase,
    pub(super) before: Fingerprint,
    pub(super) after: Option<Fingerprint>,
    pub(super) candidate: Option<String>,
    pub(super) backup: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SetupJournal {
    pub(super) version: u32,
    pub(super) transaction_id: String,
    pub(super) journal_id: String,
    // Retained for version-1 journal readability; not an ownership authority.
    pub(super) registry_id: String,
    pub(super) root: String,
    pub(super) mode: SetupMode,
    pub(super) phase: TransactionPhase,
    pub(super) operations: Vec<JournalOperation>,
    pub(super) directory_phase: OperationPhase,
    pub(super) terminal: Option<SetupCommitResult>,
}

pub(super) fn journal_name(id: &str) -> String {
    format!("{JOURNAL_PREFIX}{id}.json")
}
pub(super) fn journal_path(root: &Path, journal_id: &str) -> PathBuf {
    root.join(journal_name(journal_id))
}
fn valid_identity(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .is_some()
}
pub(super) fn journal_bytes(journal: &SetupJournal) -> Result<Vec<u8>> {
    serde_json::to_vec(journal).context("Could not serialize setup journal")
}
pub(super) fn validate_journal(root: &Path, journal: &SetupJournal) -> Result<()> {
    if journal.version != JOURNAL_VERSION
        || journal.root != root.to_string_lossy()
        || !valid_identity(&journal.transaction_id, "transaction-")
        || !valid_identity(&journal.journal_id, "journal-")
    {
        bail!("Foreign or malformed setup journal");
    }
    let mut destinations = BTreeSet::new();
    for operation in &journal.operations {
        if !matches!(
            operation.destination.as_str(),
            "project.easl" | ".bidsignore" | RAWDATA_MARKER_PATH
        ) || !destinations.insert(&operation.destination)
        {
            bail!("Setup journal has invalid operation destination");
        }
        let destination = fixed_path(root, &operation.destination)?;
        for (owned, role) in [
            (&operation.candidate, "candidate"),
            (&operation.backup, "backup"),
        ] {
            if let Some(relative) = owned {
                let path = root.join(safe_relative(relative)?);
                let expected = owned_sibling(
                    &destination,
                    &journal.transaction_id,
                    role,
                    relative.rsplit('-').next().unwrap_or("0"),
                )?;
                if path != expected {
                    bail!("Setup journal owned path is invalid");
                }
            }
        }
    }
    Ok(())
}
pub(super) fn write_journal(root: &Path, journal: &SetupJournal) -> Result<bool> {
    validate_journal(root, journal)?;
    if journal.terminal.is_some() {
        fail("terminal")?;
    } else {
        fail("journal")?;
    }
    let path = journal_path(root, &journal.journal_id);
    let bytes = journal_bytes(journal)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            bail!("Setup journal path is not a regular file")
        }
        Ok(meta) => {
            // A root journal is claimed with create_new. A later durable
            // replacement may only update that exact transaction; never turn
            // an arbitrary pre-existing same-name file into our journal.
            let current: SetupJournal = serde_json::from_slice(&read_bounded(&path, meta.len())?)
                .context("Malformed setup journal")?;
            validate_journal(root, &current)?;
            if current.transaction_id != journal.transaction_id
                || current.journal_id != journal.journal_id
            {
                bail!("Setup journal ownership identity collision");
            }
            persist_bytes(&path, &bytes, true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => persist_new_bytes(&path, &bytes),
        Err(error) => Err(error.into()),
    }
}
pub(super) fn read_journal(root: &Path, journal_id: &str) -> Result<SetupJournal> {
    let path = journal_path(root, journal_id);
    let meta = fs::symlink_metadata(&path).context("Setup journal is unavailable")?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        bail!("Setup journal must be a regular non-symlink file");
    }
    let journal: SetupJournal = serde_json::from_slice(&read_bounded(&path, meta.len())?)
        .context("Malformed setup journal")?;
    validate_journal(root, &journal)?;
    Ok(journal)
}
pub(super) fn remove_owned_journal(root: &Path, journal: &SetupJournal) -> Result<()> {
    let path = journal_path(root, &journal.journal_id);
    let current = read_journal(root, &journal.journal_id)?;
    if current.transaction_id != journal.transaction_id || current.terminal.is_none() {
        bail!("Refusing to remove nonterminal setup journal");
    }
    fs::remove_file(path)?;
    sync_parent(root).map(|_| ())
}

pub(super) fn initial_journal(
    plan: &CachedPlan,
    transaction_id: String,
    journal_id: String,
    registry_id: String,
) -> Result<SetupJournal> {
    let mut operations = Vec::new();
    for path in [RAWDATA_MARKER_PATH, ".bidsignore", "project.easl"] {
        let bytes = match path {
            RAWDATA_MARKER_PATH => plan.marker_bytes.as_ref(),
            ".bidsignore" => plan.ignore_bytes.as_ref(),
            "project.easl" => plan.project_bytes.as_ref(),
            _ => None,
        };
        if bytes.is_none() {
            continue;
        }
        let operation = plan
            .displayed
            .operations
            .iter()
            .find(|op| op.path == path)
            .ok_or_else(|| anyhow!("Plan operation missing"))?;
        if operation.operation == OperationKind::NoOp {
            continue;
        }
        operations.push(JournalOperation {
            destination: path.to_owned(),
            kind: operation.operation,
            phase: OperationPhase::Planned,
            before: plan.observations.get(path).cloned().unwrap_or(Fingerprint {
                kind: EntryKind::Missing,
                hash: None,
                len: None,
            }),
            // Expected output is durable before candidate creation. Recovery
            // can therefore prove or reject a candidate created immediately
            // before a crash, even if its pathname update was not recorded.
            after: Some(Fingerprint {
                kind: EntryKind::File,
                hash: Some(hash(bytes.unwrap())),
                len: Some(bytes.unwrap().len() as u64),
            }),
            candidate: None,
            backup: None,
        });
    }
    Ok(SetupJournal {
        version: JOURNAL_VERSION,
        transaction_id,
        journal_id,
        registry_id,
        root: plan.root.to_string_lossy().into_owned(),
        mode: plan.mode,
        phase: TransactionPhase::Planned,
        operations,
        directory_phase: OperationPhase::Planned,
        terminal: None,
    })
}
pub(super) fn persist_phase(
    root: &Path,
    journal: &mut SetupJournal,
    phase: TransactionPhase,
) -> Result<()> {
    journal.phase = phase;
    write_journal(root, journal).map(|_| ())
}
pub(super) fn update_operation(
    root: &Path,
    journal: &mut SetupJournal,
    index: usize,
    phase: OperationPhase,
) -> Result<()> {
    if matches!(
        phase,
        OperationPhase::CandidateIntent
            | OperationPhase::CreateIntent
            | OperationPhase::BackupIntent
            | OperationPhase::InstallIntent
    ) {
        fail("intent")?;
        fail(match phase {
            OperationPhase::CandidateIntent => "candidate-intent",
            OperationPhase::CreateIntent => "rawdata-intent",
            OperationPhase::BackupIntent => "backup-intent",
            OperationPhase::InstallIntent => "install-intent",
            _ => unreachable!("only intent phases reach this branch"),
        })?;
    }
    journal.operations[index].phase = phase;
    write_journal(root, journal).map(|_| ())
}
