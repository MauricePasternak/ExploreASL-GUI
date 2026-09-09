//! Durable, project-local authority for an import run.
//!
//! This is intentionally distinct from the relocation journal.  The relocation
//! journal owns file transactions; this record owns why a transaction is
//! allowed, lifecycle recovery, and terminal replay.
use super::relocation::project_identity;
use super::relocation::{RelocationOutcome, RelocationPlan, RelocationSubjectStatus};
use super::types::{ImportLifecycle, ImportRunSnapshot, ImportState};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub const IMPORT_RUN_RECORD_VERSION: u32 = 1;
const RECORD_NAME: &str = "import-run.json";

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecordFaultPoint {
    CandidateCreate,
    Write,
    Flush,
    Verification,
    Rename,
    ParentSync,
    Remove,
}

#[cfg(test)]
thread_local! {
    static RECORD_FAULT: std::cell::Cell<Option<RecordFaultPoint>> = const {
        std::cell::Cell::new(None)
    };
    static RECORD_FAULT_SKIPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn fail(point: RecordFaultPoint) -> Result<()> {
    let injected = RECORD_FAULT.with(|fault| {
        if fault.get() == Some(point) {
            let skipped = RECORD_FAULT_SKIPS.with(|remaining| {
                let value = remaining.get();
                if value > 0 {
                    remaining.set(value - 1);
                    true
                } else {
                    false
                }
            });
            if skipped {
                return false;
            }
            fault.set(None);
            true
        } else {
            false
        }
    });
    if injected {
        bail!("Injected import record failure at {point:?}");
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn inject_fault(point: RecordFaultPoint) {
    RECORD_FAULT.with(|fault| fault.set(Some(point)));
    RECORD_FAULT_SKIPS.with(|remaining| remaining.set(0));
}

#[cfg(test)]
pub(crate) fn fail_next_record_write() {
    inject_fault(RecordFaultPoint::Rename);
}

#[cfg(test)]
pub(crate) fn fail_record_write_after(successful_writes: usize) {
    RECORD_FAULT.with(|fault| fault.set(Some(RecordFaultPoint::Rename)));
    RECORD_FAULT_SKIPS.with(|remaining| remaining.set(successful_writes));
}

#[cfg(test)]
pub(crate) fn fail_next_record_removal() {
    inject_fault(RecordFaultPoint::Remove);
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRunRecord {
    pub version: u32,
    pub project_identity: String,
    pub staging_relative_path: String,
    pub staging_generation: String,
    pub preserved_subjects: Vec<String>,
    #[serde(default)]
    pub preserve_staging: bool,
    pub relocation_plan_id: Option<String>,
    pub relocation_plan: Option<RelocationPlan>,
    pub snapshot: ImportRunSnapshot,
    pub acknowledged: bool,
}

#[cfg(test)]
pub fn record_path(project_root: &Path) -> PathBuf {
    project_root
        .join("derivatives")
        .join("ExploreASL_GUI")
        .join(RECORD_NAME)
}

/// Return the record parent only after proving every component below the
/// project root is a real directory.  Run metadata is an authority boundary;
/// following a user-created `derivatives` symlink here could write, read, or
/// remove a record outside the active project.
fn ensure_record_parent(project_root: &Path) -> Result<PathBuf> {
    let root_metadata = fs::symlink_metadata(project_root)
        .with_context(|| format!("Failed to inspect project root {}", project_root.display()))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        bail!("Import run record project root must be a real directory");
    }
    let root = fs::canonicalize(project_root).with_context(|| {
        format!(
            "Failed to canonicalize project root {}",
            project_root.display()
        )
    })?;
    let mut parent = root;
    for component in ["derivatives", "ExploreASL_GUI"] {
        parent.push(component);
        match fs::symlink_metadata(&parent) {
            Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {}
            Ok(_) => bail!(
                "Import run record parent is not a real directory: {}",
                parent.display()
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&parent)
                    .with_context(|| format!("Failed to create {}", parent.display()))?;
                let metadata = fs::symlink_metadata(&parent)
                    .with_context(|| format!("Failed to verify {}", parent.display()))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    bail!("Import run record parent is unsafe: {}", parent.display());
                }
            }
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Failed to inspect {}", parent.display()));
            }
        }
    }
    Ok(parent)
}

fn checked_record_path(project_root: &Path, create_parent: bool) -> Result<PathBuf> {
    let parent = if create_parent {
        ensure_record_parent(project_root)?
    } else {
        let root_metadata = fs::symlink_metadata(project_root).with_context(|| {
            format!("Failed to inspect project root {}", project_root.display())
        })?;
        if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
            bail!("Import run record project root must be a real directory");
        }
        let root = fs::canonicalize(project_root).with_context(|| {
            format!(
                "Failed to canonicalize project root {}",
                project_root.display()
            )
        })?;
        let mut parent = root;
        for component in ["derivatives", "ExploreASL_GUI"] {
            parent.push(component);
            match fs::symlink_metadata(&parent) {
                Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {}
                Ok(_) => {
                    bail!(
                        "Import run record parent is not a real directory: {}",
                        parent.display()
                    )
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(parent.join(RECORD_NAME));
                }
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("Failed to inspect {}", parent.display()));
                }
            }
        }
        parent
    };
    Ok(parent.join(RECORD_NAME))
}

fn validate_component(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || Path::new(value).is_absolute()
    {
        bail!("Unsafe {label}");
    }
    Ok(())
}

fn validate_relative(value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() {
        bail!("Run record path must be nonempty and project-relative");
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            bail!("Run record path escapes the project root");
        }
    }
    Ok(())
}

fn validate_inventory_entry(subject: &str, value: &str) -> Result<()> {
    validate_relative(value)?;
    let sub = if subject.starts_with("sub-") {
        subject.to_string()
    } else {
        format!("sub-{subject}")
    };
    let rawdata = format!("rawdata/{sub}");
    let import_lock =
        format!("derivatives/ExploreASL/lock/xASL_module_Import/{subject}/xASL_module_Import");
    let legacy = format!("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/{sub}_");
    let log_relative = value.strip_prefix("derivatives/ExploreASL/log/");
    let owned_log = log_relative
        .and_then(|relative| relative.split('/').next())
        .is_some_and(|name| super::relocation::log_matches_subject(name, &sub));
    if value == rawdata
        || value.starts_with(&format!("{rawdata}/"))
        || value == import_lock
        || value.starts_with(&format!("{import_lock}/"))
        || value.starts_with(&legacy)
        || owned_log
    {
        Ok(())
    } else {
        bail!("Relocation inventory path exceeds its subject scope")
    }
}

pub fn record_from_state(state: &ImportState) -> Result<ImportRunRecord> {
    if state.project_root.as_os_str().is_empty() {
        bail!("Cannot persist import run without project ownership");
    }
    for subject in &state.subject_list {
        validate_component(subject, "selected subject")?;
    }
    validate_relative(".easl_staging")?;
    Ok(ImportRunRecord {
        version: IMPORT_RUN_RECORD_VERSION,
        project_identity: project_identity(&state.project_root),
        staging_relative_path: ".easl_staging".to_string(),
        staging_generation: state.staging_generation.clone(),
        preserved_subjects: state.preserved_subjects.clone(),
        preserve_staging: state.preserve_staging,
        relocation_plan_id: state.relocation_plan_id.clone(),
        relocation_plan: state.relocation_plan.clone(),
        snapshot: state.snapshot(),
        acknowledged: state.acknowledged,
    })
}

pub fn validate_record(record: &ImportRunRecord, project_root: &Path) -> Result<()> {
    if record.version != IMPORT_RUN_RECORD_VERSION {
        bail!("Unsupported import run record version {}", record.version);
    }
    if record.project_identity != project_identity(project_root) {
        bail!("Import run record belongs to another project");
    }
    validate_relative(&record.staging_relative_path)?;
    if record.staging_relative_path != ".easl_staging" {
        bail!("Import run record has an unexpected staging root");
    }
    if record.snapshot.lifecycle == ImportLifecycle::Idle {
        bail!("Idle import state must not have a durable run record");
    }
    if matches!(
        record.snapshot.lifecycle,
        ImportLifecycle::Running | ImportLifecycle::Finalizing | ImportLifecycle::Completed
    ) && record.staging_generation.trim().is_empty()
    {
        bail!("Import run record lacks staging generation after preparation");
    }
    validate_component(&record.snapshot.run_id, "run ID")?;
    validate_component(&record.snapshot.profile_id, "profile ID")?;
    for subject in &record.snapshot.selected_subjects {
        validate_component(subject, "selected subject")?;
    }
    if record.snapshot.selected_subjects.is_empty() {
        bail!("Import run record has no selected subjects");
    }
    let mut selected = std::collections::BTreeSet::new();
    for subject in &record.snapshot.selected_subjects {
        if !selected.insert(super::staging::portable_key(subject)) {
            bail!("Import run record repeats a selected subject");
        }
    }
    for subject in &record.preserved_subjects {
        validate_component(subject, "preserved subject")?;
        if record
            .snapshot
            .selected_subjects
            .iter()
            .any(|selected| selected == subject)
        {
            bail!("Preserved subject overlaps selected subject scope");
        }
    }
    let preserved = record
        .preserved_subjects
        .iter()
        .map(|subject| super::staging::portable_key(subject))
        .collect::<std::collections::BTreeSet<_>>();
    if preserved.len() != record.preserved_subjects.len()
        || preserved.iter().any(|subject| selected.contains(subject))
    {
        bail!("Preserved import subjects repeat or overlap selected scope");
    }
    if record.snapshot.lifecycle.is_terminal() != record.snapshot.terminal_result.is_some() {
        bail!("Import terminal lifecycle and terminal result disagree");
    }
    if let Some(terminal) = &record.snapshot.terminal_result {
        let agrees = matches!(
            (record.snapshot.lifecycle, terminal),
            (
                ImportLifecycle::Completed,
                super::types::ImportTerminalResult::Completed
            ) | (
                ImportLifecycle::Failed,
                super::types::ImportTerminalResult::Failed
            ) | (
                ImportLifecycle::Cancelled,
                super::types::ImportTerminalResult::Cancelled
            ) | (
                ImportLifecycle::Interrupted,
                super::types::ImportTerminalResult::Interrupted
            )
        );
        if !agrees {
            bail!("Import terminal lifecycle and result kind disagree");
        }
    }
    if record.acknowledged && !record.snapshot.lifecycle.is_terminal() {
        bail!("Nonterminal import run cannot be acknowledged");
    }
    if record.snapshot.lifecycle == ImportLifecycle::Finalizing
        && record.snapshot.exit_evidence.is_none()
    {
        bail!("Finalizing import record lacks process exit evidence");
    }
    if record.snapshot.exit_evidence.is_some()
        && matches!(
            record.snapshot.lifecycle,
            ImportLifecycle::Preparing | ImportLifecycle::Running
        )
    {
        bail!("Import exit evidence precedes the finalization checkpoint");
    }
    if let Some(exit) = &record.snapshot.exit_evidence
        && exit.successful != (exit.exit_code == 0)
    {
        bail!("Import process exit code and success evidence disagree");
    }
    let mut outcomes = std::collections::BTreeSet::new();
    for outcome in &record.snapshot.subject_outcomes {
        validate_component(&outcome.subject, "outcome subject")?;
        if !selected.contains(&super::staging::portable_key(&outcome.subject))
            || !outcomes.insert(super::staging::portable_key(&outcome.subject))
        {
            bail!("Import subject outcome is outside or repeats the selected scope");
        }
        if outcome.committed
            != matches!(
                outcome.outcome,
                super::types::ImportSubjectOutcomeKind::Committed
            )
        {
            bail!("Import subject committed evidence is inconsistent");
        }
        if outcome.committed && (!outcome.ready_lock_verified || !outcome.rawdata_verified) {
            bail!("Committed import subject lacks verification evidence");
        }
    }
    if let Some(plan) = &record.relocation_plan {
        if record.relocation_plan_id.as_deref() != Some(&plan.plan_id)
            || plan.fingerprint.is_empty()
            || plan.subjects.len() != record.snapshot.selected_subjects.len()
        {
            bail!("Import run relocation plan binding is invalid");
        }
        for (inventory, subject) in plan.subjects.iter().zip(&record.snapshot.selected_subjects) {
            if inventory.subject != *subject {
                bail!("Import run relocation plan scope is invalid");
            }
            for entry in &inventory.entries {
                validate_inventory_entry(subject, &entry.path)?;
            }
        }
    } else if matches!(record.snapshot.lifecycle, ImportLifecycle::Finalizing) {
        bail!("Finalizing import record lacks a relocation plan");
    }
    if let Some(outcome) = &record.snapshot.relocation_outcome {
        if record.relocation_plan_id.as_deref() != Some(&outcome.plan_id)
            || outcome.generation != record.snapshot.ownership_generation
        {
            bail!("Relocation checkpoint has foreign run ownership");
        }
        let mut relocated_subjects = std::collections::BTreeSet::new();
        for relocated in &outcome.subjects {
            if !selected.contains(&super::staging::portable_key(&relocated.subject)) {
                bail!("Relocation checkpoint exceeds selected subject scope");
            }
            if !relocated_subjects.insert(super::staging::portable_key(&relocated.subject)) {
                bail!("Relocation checkpoint repeats a selected subject");
            }
            if relocated.status == RelocationSubjectStatus::Committed
                && !record.snapshot.subject_outcomes.iter().any(|subject| {
                    subject.subject.eq_ignore_ascii_case(&relocated.subject)
                        && subject.ready_lock_verified
                        && subject.rawdata_verified
                })
            {
                bail!("Committed relocation lacks prior verification checkpoint");
            }
        }
    }
    if record.snapshot.lifecycle == ImportLifecycle::Completed {
        let relocation = record
            .snapshot
            .relocation_outcome
            .as_ref()
            .context("Completed import lacks relocation checkpoint")?;
        if !record
            .snapshot
            .exit_evidence
            .as_ref()
            .is_some_and(|exit| exit.successful)
            || (!record.preserve_staging && !relocation.staging_cleanup_complete)
            || relocation.subjects.len() != record.snapshot.selected_subjects.len()
            || relocation
                .subjects
                .iter()
                .any(|subject| subject.status != RelocationSubjectStatus::Committed)
        {
            bail!("Completed import lacks complete process and relocation evidence");
        }
        if outcomes.len() != selected.len()
            || record
                .snapshot
                .subject_outcomes
                .iter()
                .any(|subject| !subject.committed)
        {
            bail!("Completed import lacks committed per-subject evidence");
        }
    }
    Ok(())
}

/// Bridge relocation's transaction journal to the run journal before the
/// transaction journal can disappear. This closes the crash boundary where
/// committed output exists but finalization has not yet persisted its terminal
/// run snapshot.
pub(crate) fn checkpoint_relocation_outcome(
    project_root: &Path,
    outcome: &RelocationOutcome,
) -> Result<()> {
    let Some(mut record) = load_record(project_root)? else {
        // Relocation has non-import test/internal users. No run record means no
        // second authority to coordinate.
        return Ok(());
    };
    if record.snapshot.ownership_generation != outcome.generation
        || record.relocation_plan_id.as_deref() != Some(&outcome.plan_id)
    {
        bail!("Relocation journal disagrees with durable import-run authority");
    }
    if let Some(existing) = &record.snapshot.relocation_outcome {
        if existing != outcome {
            bail!("Relocation outcome changed after its durable checkpoint");
        }
        if record.snapshot.lifecycle == ImportLifecycle::Finalizing
            || record.snapshot.lifecycle.is_terminal()
        {
            return Ok(());
        }
        bail!("Relocation checkpoint belongs to an invalid import lifecycle");
    }
    if record.snapshot.lifecycle != ImportLifecycle::Finalizing {
        bail!("Relocation outcome precedes native import finalization");
    }
    record.snapshot.relocation_outcome = Some(outcome.clone());
    write_record(project_root, &record)
}

/// Validate cross-journal authority before relocation recovery mutates output.
pub(crate) fn validate_relocation_recovery_authority(
    project_root: &Path,
    generation: u64,
    plan_id: &str,
    terminal_outcome: Option<&RelocationOutcome>,
) -> Result<()> {
    let Some(record) = load_record(project_root)? else {
        // Relocation also has standalone test/internal callers.
        return Ok(());
    };
    if record.snapshot.ownership_generation != generation
        || record.relocation_plan_id.as_deref() != Some(plan_id)
    {
        bail!("Relocation journal disagrees with durable import-run authority");
    }
    match record.snapshot.lifecycle {
        ImportLifecycle::Finalizing => Ok(()),
        lifecycle if lifecycle.is_terminal() => {
            if record.snapshot.relocation_outcome.as_ref() == terminal_outcome
                && terminal_outcome.is_some()
            {
                Ok(())
            } else {
                bail!("Terminal import and relocation recovery outcomes disagree")
            }
        }
        _ => bail!("Relocation recovery precedes native import finalization"),
    }
}

/// Candidate + flush + verify + atomic rename.  Existing valid data remains
/// visible if creation, writing, syncing, verification, or rename fails.
pub fn write_record(project_root: &Path, record: &ImportRunRecord) -> Result<()> {
    validate_record(record, project_root)?;
    let path = checked_record_path(project_root, true)?;
    let parent = path.parent().context("Import record has no parent")?;
    if let Ok(metadata) = fs::symlink_metadata(&path)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        bail!("Import run record must be a regular file");
    }
    let temp = parent.join(format!(".{RECORD_NAME}.{}.tmp", uuid::Uuid::new_v4()));
    let prior = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).context("Failed to read prior import run record"),
    };
    let contents =
        serde_json::to_vec_pretty(record).context("Failed to encode import run record")?;
    let write_result = (|| -> Result<()> {
        #[cfg(test)]
        fail(RecordFaultPoint::CandidateCreate)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .with_context(|| format!("Failed to create {}", temp.display()))?;
        #[cfg(test)]
        fail(RecordFaultPoint::Write)?;
        file.write_all(&contents)
            .context("Failed to write import run record")?;
        #[cfg(test)]
        fail(RecordFaultPoint::Flush)?;
        file.sync_all()
            .context("Failed to flush import run record")?;
        #[cfg(test)]
        fail(RecordFaultPoint::Verification)?;
        let reread = fs::read(&temp).context("Failed to verify import run record")?;
        let verified: ImportRunRecord = serde_json::from_slice(&reread)
            .context("Failed to decode verified import run record")?;
        validate_record(&verified, project_root)?;
        #[cfg(test)]
        fail(RecordFaultPoint::Rename)?;
        if path
            .try_exists()
            .context("Failed to inspect prior import run record")?
        {
            super::relocation::atomic_replace(&temp, &path)
        } else {
            super::relocation::rename_no_replace(&temp, &path)
        }
        .with_context(|| format!("Failed to replace {}", path.display()))?;
        #[cfg(test)]
        fail(RecordFaultPoint::ParentSync).inspect_err(|_| {
            let _ = restore_prior_record(parent, &path, prior.as_deref());
        })?;
        if let Err(error) = super::relocation::sync_parent_durable(parent) {
            restore_prior_record(parent, &path, prior.as_deref()).with_context(|| {
                format!("Parent sync failed ({error:#}) and prior record restoration failed")
            })?;
            return Err(error);
        }
        Ok(())
    })();
    if write_result.is_err() {
        let owned = fs::symlink_metadata(&temp)
            .ok()
            .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
            && fs::read(&temp).is_ok_and(|bytes| bytes == contents);
        if owned {
            let _ = fs::remove_file(&temp);
        }
    }
    write_result
}

fn restore_prior_record(parent: &Path, path: &Path, prior: Option<&[u8]>) -> Result<()> {
    match prior {
        Some(bytes) => {
            let restore = parent.join(format!(
                ".{RECORD_NAME}.restore.{}.tmp",
                uuid::Uuid::new_v4()
            ));
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&restore)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            super::relocation::atomic_replace(&restore, path)?;
        }
        None => match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        },
    }
    super::relocation::sync_parent_durable(parent)
}

pub fn load_record(project_root: &Path) -> Result<Option<ImportRunRecord>> {
    let path = checked_record_path(project_root, false)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("Failed to inspect import run record"),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Import run record must be a regular file");
    }
    let record: ImportRunRecord = serde_json::from_slice(
        &fs::read(&path).with_context(|| format!("Failed to read {}", path.display()))?,
    )
    .context("Malformed import run record")?;
    validate_record(&record, project_root)?;
    Ok(Some(record))
}

pub fn remove_record(project_root: &Path) -> Result<()> {
    let path = checked_record_path(project_root, false)?;
    if let Ok(metadata) = fs::symlink_metadata(&path)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        bail!("Import run record must be a regular file");
    }
    #[cfg(test)]
    fail(RecordFaultPoint::Remove)?;
    match fs::remove_file(&path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                super::relocation::sync_parent_durable(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("Failed to retire import run record"),
    }
}
