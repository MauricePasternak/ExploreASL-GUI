//! Durable, project-local authority for an import run.
//!
//! This is intentionally distinct from the relocation journal.  The relocation
//! journal owns file transactions; this record owns why a transaction is
//! allowed, lifecycle recovery, and terminal replay.
use super::relocation::project_identity;
use super::relocation::{RelocationOutcome, RelocationPlan, RelocationSubjectStatus};
use super::types::{ImportLifecycle, ImportRunSnapshot, ImportState};
use crate::fs_safety::{ProjectDirectory, ProjectRelativePath};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::fs;
use std::io::Write;
#[cfg(test)]
use std::path::PathBuf;
use std::path::{Component, Path};

pub const IMPORT_RUN_RECORD_VERSION: u32 = 1;
const RECORD_NAME: &str = "import-run.json";
const RECORD_RELATIVE_PATH: &str = "derivatives/ExploreASL_GUI/import-run.json";

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
    RemoveParentSync,
}

#[cfg(test)]
thread_local! {
    static RECORD_FAULT: std::cell::Cell<Option<RecordFaultPoint>> = const {
        std::cell::Cell::new(None)
    };
    static RECORD_FAULT_SKIPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static RECORD_PUBLISH_SWAP: std::cell::RefCell<Option<(PathBuf, PathBuf)>> = const {
        std::cell::RefCell::new(None)
    };
}

#[cfg(test)]
pub(crate) fn swap_record_parent_before_publish(project_root: PathBuf, foreign_parent: PathBuf) {
    RECORD_PUBLISH_SWAP.with(|swap| *swap.borrow_mut() = Some((project_root, foreign_parent)));
}

#[cfg(test)]
fn apply_record_parent_swap() {
    let Some((project_root, foreign_parent)) =
        RECORD_PUBLISH_SWAP.with(|swap| swap.borrow_mut().take())
    else {
        return;
    };
    let live_parent = project_root.join("derivatives/ExploreASL_GUI");
    let moved_parent = project_root.join("derivatives/.record-parent-moved");
    fs::rename(&live_parent, &moved_parent).unwrap();
    let candidate = fs::read_dir(&moved_parent)
        .unwrap()
        .map(Result::unwrap)
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(".import-run.json.") && name.ends_with(".tmp"))
        })
        .unwrap();
    let candidate_name = candidate.file_name().unwrap();
    fs::rename(&candidate, foreign_parent.join(candidate_name)).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&foreign_parent, &live_parent).unwrap();
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

fn record_parent_relative_path() -> Result<ProjectRelativePath> {
    ProjectRelativePath::new("derivatives/ExploreASL_GUI").map_err(Into::into)
}

fn record_relative_path() -> Result<ProjectRelativePath> {
    ProjectRelativePath::new(RECORD_RELATIVE_PATH).map_err(Into::into)
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
    if record.snapshot.confirmation_required
        && record.snapshot.lifecycle != ImportLifecycle::Interrupted
    {
        bail!("Import external-stop confirmation is only valid for an interrupted run");
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

/// Candidate + flush + verify + atomic rename. Failures before replacement
/// preserve prior visible bytes. A parent-sync failure after replacement leaves
/// the installed record visible and reports uncertain durability.
pub fn write_record(project_root: &Path, record: &ImportRunRecord) -> Result<()> {
    validate_record(record, project_root)?;
    let authority = ProjectDirectory::open(project_root).with_context(|| {
        format!(
            "Failed to open project record authority {}",
            project_root.display()
        )
    })?;
    let record_parent = record_parent_relative_path()?;
    authority
        .create_dir_all_durable(&record_parent)
        .context("Failed to create import run record parent")?;
    let record_relative = record_relative_path()?;
    let temp_relative = ProjectRelativePath::new(format!(
        "derivatives/ExploreASL_GUI/.{RECORD_NAME}.{}.tmp",
        uuid::Uuid::new_v4()
    ))?;
    let contents =
        serde_json::to_vec_pretty(record).context("Failed to encode import run record")?;
    let write_result = (|| -> Result<()> {
        #[cfg(test)]
        fail(RecordFaultPoint::CandidateCreate)?;
        let mut file = authority
            .create_new_file(&temp_relative)
            .context("Failed to create import run record candidate")?;
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
        let reread = authority
            .read_regular(&temp_relative)
            .context("Failed to verify import run record")?;
        let verified: ImportRunRecord = serde_json::from_slice(&reread)
            .context("Failed to decode verified import run record")?;
        validate_record(&verified, project_root)?;
        #[cfg(test)]
        fail(RecordFaultPoint::Rename)?;
        #[cfg(test)]
        apply_record_parent_swap();
        match authority.rename_regular_file_no_replace(&temp_relative, &record_relative) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                authority.replace_regular_file(&temp_relative, &record_relative)?;
            }
            Err(error) => return Err(error.into()),
        }
        #[cfg(test)]
        fail(RecordFaultPoint::ParentSync).context(
            "Import run record replacement has uncertain durability after parent synchronization failure",
        )?;
        authority.sync_parent(&record_relative).context(
            "Import run record replacement has uncertain durability after parent synchronization failure",
        )?;
        Ok(())
    })();
    if write_result.is_err() {
        let owned = authority
            .read_regular(&temp_relative)
            .is_ok_and(|bytes| bytes == contents);
        if owned {
            let _ = authority.cleanup_owned_candidate(&temp_relative);
        }
    }
    write_result
}

pub fn load_record(project_root: &Path) -> Result<Option<ImportRunRecord>> {
    let authority = ProjectDirectory::open(project_root).with_context(|| {
        format!(
            "Failed to open project record authority {}",
            project_root.display()
        )
    })?;
    let relative = record_relative_path()?;
    let record = read_record_without_parent_sync(&authority, &relative, project_root)?;
    repair_record_parent(&authority, &relative)?;
    Ok(record)
}

pub(crate) fn exact_record_is_visible(
    project_root: &Path,
    expected: &ImportRunRecord,
) -> Result<bool> {
    let authority = ProjectDirectory::open(project_root).with_context(|| {
        format!(
            "Failed to open project record authority {}",
            project_root.display()
        )
    })?;
    let relative = record_relative_path()?;
    let Some(visible) = read_record_without_parent_sync(&authority, &relative, project_root)?
    else {
        return Ok(false);
    };
    let visible =
        serde_json::to_value(visible).context("Failed to compare visible import run record")?;
    let expected =
        serde_json::to_value(expected).context("Failed to compare expected import run record")?;
    if visible != expected {
        bail!("Visible import run record conflicts with the attempted reservation");
    }
    Ok(true)
}

fn read_record_without_parent_sync(
    authority: &ProjectDirectory,
    relative: &ProjectRelativePath,
    project_root: &Path,
) -> Result<Option<ImportRunRecord>> {
    let bytes = match authority.read_regular(relative) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("Failed to inspect import run record"),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).context("Malformed import run record")?;
    if value.get("containment").is_some() {
        bail!(
            "Guardian-bound experimental import record: use the compatible checkpoint build to settle/acknowledge it or restore a verified project copy"
        );
    }
    let record: ImportRunRecord =
        serde_json::from_slice(&bytes).context("Malformed import run record")?;
    validate_record(&record, project_root)?;
    Ok(Some(record))
}

pub fn remove_record(project_root: &Path) -> Result<()> {
    let authority = ProjectDirectory::open(project_root).with_context(|| {
        format!(
            "Failed to open project record authority {}",
            project_root.display()
        )
    })?;
    let relative = record_relative_path()?;
    #[cfg(test)]
    fail(RecordFaultPoint::Remove)?;
    match authority.cleanup_owned_candidate(&relative) {
        Ok(_) => {
            #[cfg(test)]
            fail(RecordFaultPoint::RemoveParentSync)
                .context("Import terminal removed; durability uncertain")?;
            repair_record_parent(&authority, &relative)
                .context("Import terminal removed; durability uncertain")
        }
        Err(error) => Err(error).context("Failed to retire import run record"),
    }
}

fn repair_record_parent(authority: &ProjectDirectory, path: &ProjectRelativePath) -> Result<()> {
    match authority.sync_parent(path) {
        Ok(_) => Ok(()),
        // A project with no import authority directory has no record unlink to repair.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
