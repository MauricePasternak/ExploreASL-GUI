//! Native-owned import output replacement. All paths persisted in the journal
//! are relative to the canonical project root.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
use std::cell::RefCell;

pub const JOURNAL_FILE: &str = ".easl_import_relocation.json";
const JOURNAL_VERSION: u32 = 2;
const RESERVATION_MARKER: &str = ".easl-reservation";
const CANDIDATE_PAYLOAD: &str = "payload";
static RESERVATION_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static JOURNAL_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Deterministic filesystem-operation failures used only by transaction tests.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelocationFailurePoint {
    CandidateCreate,
    RecursiveCopy,
    FileSync,
    ParentSync,
    HashVerification,
    SourceMutation,
    JournalPersist,
    DestinationBackup,
    CandidateInstall,
    AncillaryInstall,
    InsufficientSpace,
    BackupCollision,
    InstallCollision,
    DatasetInstall,
    DatasetCollision,
    OutcomePersist,
    Cleanup,
    JournalCleanup,
    Rollback,
    InterruptAfterDatasetInstall,
    InterruptAfterDatasetReserved,
    InterruptAfterCandidateReserved,
    InterruptAfterCandidateReservationIntent,
    InterruptAfterCandidateReservationOperation,
    InterruptAfterCandidatePopulationIntent,
    InterruptAfterCandidatePopulationOperation,
    InterruptAfterDatasetReservationIntent,
    InterruptAfterDatasetReservationOperation,
    InterruptAfterDatasetPopulationIntent,
    InterruptAfterDatasetPopulationOperation,
    InterruptAfterDatasetCandidateReady,
    InterruptAfterDatasetInstallIntent,
    InterruptAfterDatasetInstallOperation,
    InterruptAfterCandidateReady,
    InterruptAfterBackupIntent,
    InterruptAfterBackupOperation,
    InterruptAfterBackup,
    InterruptAfterInstallIntent,
    InterruptAfterInstallOperation,
    InterruptAfterInstall,
    InterruptAfterCommit,
    SubstituteAfterCandidateReady,
    SubstituteAfterInstall,
    SubstituteDatasetAfterCandidateReady,
    SubstituteDatasetAfterInstall,
    InterruptRollbackAfterIntent,
    InterruptRollbackAfterDestinationRemoval,
    InterruptRollbackAfterBackupRestore,
    InterruptRollbackAfterCandidateCleanup,
    InterruptDatasetRollbackAfterIntent,
    InterruptDatasetRollbackAfterDestinationRemoval,
    InterruptDatasetRollbackAfterCandidateCleanup,
    PayloadParentSync,
    PayloadRenameSourceSync,
    PayloadRenameDestinationSync,
    WrapperDeleteParentSync,
}

#[cfg(test)]
thread_local! {
    static FAILURE_POINT: RefCell<Option<RelocationFailurePoint>> = const { RefCell::new(None) };
}

#[cfg(test)]
pub struct RelocationFailureGuard;

#[cfg(test)]
impl Drop for RelocationFailureGuard {
    fn drop(&mut self) {
        FAILURE_POINT.with(|point| *point.borrow_mut() = None);
    }
}

#[cfg(test)]
pub fn inject_relocation_failure(point: RelocationFailurePoint) -> RelocationFailureGuard {
    FAILURE_POINT.with(|active| *active.borrow_mut() = Some(point));
    RelocationFailureGuard
}

fn fail_if_injected(_point: &str) -> Result<(), String> {
    #[cfg(test)]
    {
        let requested = match _point {
            "candidate-create" => RelocationFailurePoint::CandidateCreate,
            "recursive-copy" => RelocationFailurePoint::RecursiveCopy,
            "file-sync" => RelocationFailurePoint::FileSync,
            "parent-sync" => RelocationFailurePoint::ParentSync,
            "hash-verification" => RelocationFailurePoint::HashVerification,
            "source-mutation" => RelocationFailurePoint::SourceMutation,
            "journal-persist" => RelocationFailurePoint::JournalPersist,
            "destination-backup" => RelocationFailurePoint::DestinationBackup,
            "candidate-install" => RelocationFailurePoint::CandidateInstall,
            "ancillary-install" => RelocationFailurePoint::AncillaryInstall,
            "insufficient-space" => RelocationFailurePoint::InsufficientSpace,
            "backup-collision" => RelocationFailurePoint::BackupCollision,
            "install-collision" => RelocationFailurePoint::InstallCollision,
            "dataset-install" => RelocationFailurePoint::DatasetInstall,
            "dataset-collision" => RelocationFailurePoint::DatasetCollision,
            "outcome-persist" => RelocationFailurePoint::OutcomePersist,
            "cleanup" => RelocationFailurePoint::Cleanup,
            "journal-cleanup" => RelocationFailurePoint::JournalCleanup,
            "rollback" => RelocationFailurePoint::Rollback,
            "interrupt-after-dataset-install" => {
                RelocationFailurePoint::InterruptAfterDatasetInstall
            }
            "interrupt-after-dataset-reserved" => {
                RelocationFailurePoint::InterruptAfterDatasetReserved
            }
            "interrupt-after-candidate-reserved" => {
                RelocationFailurePoint::InterruptAfterCandidateReserved
            }
            "interrupt-after-candidate-reservation-intent" => {
                RelocationFailurePoint::InterruptAfterCandidateReservationIntent
            }
            "interrupt-after-candidate-reservation-operation" => {
                RelocationFailurePoint::InterruptAfterCandidateReservationOperation
            }
            "interrupt-after-candidate-population-intent" => {
                RelocationFailurePoint::InterruptAfterCandidatePopulationIntent
            }
            "interrupt-after-candidate-population-operation" => {
                RelocationFailurePoint::InterruptAfterCandidatePopulationOperation
            }
            "interrupt-after-dataset-reservation-intent" => {
                RelocationFailurePoint::InterruptAfterDatasetReservationIntent
            }
            "interrupt-after-dataset-reservation-operation" => {
                RelocationFailurePoint::InterruptAfterDatasetReservationOperation
            }
            "interrupt-after-dataset-population-intent" => {
                RelocationFailurePoint::InterruptAfterDatasetPopulationIntent
            }
            "interrupt-after-dataset-population-operation" => {
                RelocationFailurePoint::InterruptAfterDatasetPopulationOperation
            }
            "interrupt-after-dataset-candidate-ready" => {
                RelocationFailurePoint::InterruptAfterDatasetCandidateReady
            }
            "interrupt-after-dataset-install-intent" => {
                RelocationFailurePoint::InterruptAfterDatasetInstallIntent
            }
            "interrupt-after-dataset-install-operation" => {
                RelocationFailurePoint::InterruptAfterDatasetInstallOperation
            }
            "interrupt-after-candidate-ready" => {
                RelocationFailurePoint::InterruptAfterCandidateReady
            }
            "interrupt-after-backup-intent" => RelocationFailurePoint::InterruptAfterBackupIntent,
            "interrupt-after-backup-operation" => {
                RelocationFailurePoint::InterruptAfterBackupOperation
            }
            "interrupt-after-backup" => RelocationFailurePoint::InterruptAfterBackup,
            "interrupt-after-install-intent" => RelocationFailurePoint::InterruptAfterInstallIntent,
            "interrupt-after-install-operation" => {
                RelocationFailurePoint::InterruptAfterInstallOperation
            }
            "interrupt-after-install" => RelocationFailurePoint::InterruptAfterInstall,
            "interrupt-after-commit" => RelocationFailurePoint::InterruptAfterCommit,
            "interrupt-rollback-after-intent" => {
                RelocationFailurePoint::InterruptRollbackAfterIntent
            }
            "interrupt-rollback-after-destination-removal" => {
                RelocationFailurePoint::InterruptRollbackAfterDestinationRemoval
            }
            "interrupt-rollback-after-backup-restore" => {
                RelocationFailurePoint::InterruptRollbackAfterBackupRestore
            }
            "interrupt-rollback-after-candidate-cleanup" => {
                RelocationFailurePoint::InterruptRollbackAfterCandidateCleanup
            }
            "interrupt-dataset-rollback-after-intent" => {
                RelocationFailurePoint::InterruptDatasetRollbackAfterIntent
            }
            "interrupt-dataset-rollback-after-destination-removal" => {
                RelocationFailurePoint::InterruptDatasetRollbackAfterDestinationRemoval
            }
            "interrupt-dataset-rollback-after-candidate-cleanup" => {
                RelocationFailurePoint::InterruptDatasetRollbackAfterCandidateCleanup
            }
            "payload-parent-sync" => RelocationFailurePoint::PayloadParentSync,
            "payload-rename-source-sync" => RelocationFailurePoint::PayloadRenameSourceSync,
            "payload-rename-destination-sync" => {
                RelocationFailurePoint::PayloadRenameDestinationSync
            }
            "wrapper-delete-parent-sync" => RelocationFailurePoint::WrapperDeleteParentSync,
            _ => return Ok(()),
        };
        let injected = FAILURE_POINT.with(|active| {
            let mut active = active.borrow_mut();
            if *active == Some(requested) {
                active.take();
                true
            } else {
                false
            }
        });
        if injected {
            return Err(format!("Injected relocation failure at {_point}"));
        }
    }
    Ok(())
}

#[cfg(test)]
fn rollback_interrupt_is_active() -> bool {
    FAILURE_POINT.with(|active| {
        matches!(
            *active.borrow(),
            Some(
                RelocationFailurePoint::InterruptRollbackAfterIntent
                    | RelocationFailurePoint::InterruptRollbackAfterDestinationRemoval
                    | RelocationFailurePoint::InterruptRollbackAfterBackupRestore
                    | RelocationFailurePoint::InterruptRollbackAfterCandidateCleanup
            )
        )
    })
}

#[cfg(not(test))]
fn rollback_interrupt_is_active() -> bool {
    false
}

#[derive(Debug, thiserror::Error)]
enum RelocationTransactionError {
    #[error("Injected relocation interruption at {point}")]
    Interrupted { point: String },
    #[error("{0}")]
    Operational(String),
}

impl From<String> for RelocationTransactionError {
    fn from(error: String) -> Self {
        Self::Operational(error)
    }
}

impl From<RelocationTransactionError> for String {
    fn from(error: RelocationTransactionError) -> Self {
        error.to_string()
    }
}

type RelocationTransactionResult<T> = Result<T, RelocationTransactionError>;

fn fail_if_interrupted(point: &str) -> RelocationTransactionResult<()> {
    fail_if_injected(point).map_err(|_| RelocationTransactionError::Interrupted {
        point: point.to_string(),
    })
}

#[cfg(test)]
fn substitute_if_injected(point: RelocationFailurePoint, path: &Path) -> Result<(), String> {
    let injected = FAILURE_POINT.with(|active| {
        let mut active = active.borrow_mut();
        if *active == Some(point) {
            active.take();
            true
        } else {
            false
        }
    });
    if !injected {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
        fs::create_dir(path).map_err(|error| error.to_string())?;
        fs::write(path.join("foreign"), b"foreign").map_err(|error| error.to_string())?;
    } else {
        fs::write(path, b"foreign").map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationEntry {
    pub path: String,
    pub kind: RelocationEntryKind,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelocationEntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInventory {
    pub subject: String,
    pub entries: Vec<RelocationEntry>,
    pub file_count: u64,
    pub byte_total: u64,
    pub sessions: Vec<String>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationPlan {
    pub plan_id: String,
    pub subjects: Vec<SubjectInventory>,
    pub fingerprint: String,
    #[serde(skip)]
    pub project_root: PathBuf,
    #[serde(skip)]
    pub project_identity: String,
    #[serde(skip)]
    pub bound_generation: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectRelocationOutcome {
    pub subject: String,
    pub status: RelocationSubjectStatus,
    pub phase: String,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelocationSubjectStatus {
    Committed,
    RolledBack,
    RecoveryRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationOutcome {
    pub plan_id: String,
    pub generation: u64,
    pub subjects: Vec<SubjectRelocationOutcome>,
    pub staging_cleanup_complete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationRecoverySummary {
    pub preserved_subjects: Vec<String>,
    pub restored_subjects: Vec<String>,
    pub cleaned_subjects: Vec<String>,
    pub cleanup_errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationJournal {
    version: u32,
    project_identity: String,
    generation: u64,
    plan_id: String,
    plan_fingerprint: String,
    dataset: JournalDataset,
    subjects: Vec<JournalSubject>,
    terminal_outcome: Option<RelocationOutcome>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalSubject {
    subject: String,
    phase: SubjectPhase,
    artifacts: Vec<JournalArtifact>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SubjectPhase {
    Planned,
    Prepared,
    Committing,
    Committed,
    RolledBack,
    RecoveryRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ArtifactRole {
    Replacement,
    Removal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ArtifactPhase {
    Planned,
    ReservationIntent,
    CandidateReserved,
    PopulationIntent,
    CandidateReady,
    BackupIntent,
    BackedUp,
    InstallIntent,
    Installed,
    RollbackIntent,
    RolledBack,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalArtifact {
    role: ArtifactRole,
    destination: String,
    candidate: Option<String>,
    backup: Option<String>,
    had_destination: bool,
    phase: ArtifactPhase,
    candidate_fingerprint: Option<String>,
    backup_fingerprint: Option<String>,
    reservation_token: Option<String>,
    #[serde(default)]
    candidate_abandoned: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DatasetPhase {
    NotRequired,
    Planned,
    ReservationIntent,
    CandidateReserved,
    PopulationIntent,
    CandidateReady,
    InstallIntent,
    Installed,
    ExistingWon,
    RollbackIntent,
    RolledBack,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalDataset {
    source_present: bool,
    destination_existed: bool,
    destination: String,
    candidate: String,
    phase: DatasetPhase,
    fingerprint: Option<String>,
    reservation_token: Option<String>,
    #[serde(default)]
    candidate_abandoned: bool,
}

fn subject_dir(subject: &str) -> String {
    if subject.starts_with("sub-") {
        subject.to_string()
    } else {
        format!("sub-{subject}")
    }
}

pub fn canonical_project_root(project_root: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(project_root).map_err(|error| {
        format!(
            "Failed to canonicalize project root {}: {error}",
            project_root.display()
        )
    })?;
    if !root.is_dir() {
        return Err("Project root must be a directory".to_string());
    }
    if fs::symlink_metadata(&root)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Project root must not be a symlink".to_string());
    }
    Ok(root)
}

fn project_identity(root: &Path) -> String {
    sha256_bytes(root.to_string_lossy().as_bytes())
}
fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Path escapes project root".to_string())?;
    validate_relative_path(relative)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err("Journal path must be a nonempty relative path".to_string());
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("Unsafe journal path: {}", path.display()));
        }
    }
    Ok(())
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    validate_relative_path(relative)?;
    let path = root.join(relative);
    reject_symlink_components(root, &path)?;
    if path.parent().is_some_and(|parent| parent.exists()) {
        let canonical_parent = fs::canonicalize(path.parent().expect("parent checked"))
            .map_err(|error| format!("Failed to canonicalize transaction parent: {error}"))?;
        if !canonical_parent.starts_with(root) {
            return Err("Transaction path escapes project root".to_string());
        }
    }
    Ok(path)
}

fn candidate_record_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    validate_relative_path(relative)?;
    let path = root.join(relative);
    let parent = path
        .parent()
        .ok_or_else(|| "Candidate path has no parent".to_string())?;
    reject_symlink_components(root, parent)?;
    if parent.exists() {
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|error| format!("Failed to canonicalize candidate parent: {error}"))?;
        if !canonical_parent.starts_with(root) {
            return Err("Candidate path escapes project root".to_string());
        }
    }
    Ok(path)
}

fn reject_symlink_components(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Transaction path escapes project root".to_string())?;
    let mut current = root.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(component) = component else {
            return Err("Transaction path is not a normal relative path".to_string());
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Symlink in transaction path: {}",
                    current.display()
                ));
            }
            Ok(metadata) if components.peek().is_some() && !metadata.is_dir() => {
                return Err(format!(
                    "Non-directory intermediate transaction path: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            // Once an ancestor is absent, every remaining child is absent too.
            Err(error) if error.kind() == io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn inspect_tree(
    root: &Path,
    path: &Path,
    entries: &mut Vec<RelocationEntry>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return Err(format!(
            "Symlinks are not supported in relocation inventory: {}",
            path.display()
        ));
    }
    let relative = relative_path(root, path)?;
    if file_type.is_dir() {
        entries.push(RelocationEntry {
            path: relative,
            kind: RelocationEntryKind::Directory,
            bytes: 0,
        });
        let mut children = fs::read_dir(path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            inspect_tree(root, &child.path(), entries)?;
        }
    } else if file_type.is_file() {
        entries.push(RelocationEntry {
            path: relative,
            kind: RelocationEntryKind::File,
            bytes: metadata.len(),
        });
    } else {
        return Err(format!(
            "Unsupported filesystem entry in relocation inventory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn inventory_paths(
    root: &Path,
    paths: impl IntoIterator<Item = PathBuf>,
    subject: &str,
) -> Result<SubjectInventory, String> {
    let mut entries = Vec::new();
    for path in paths {
        reject_symlink_components(root, &path)?;
        if path_exists(&path)? {
            inspect_tree(root, &path, &mut entries)?;
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    let sessions = entries
        .iter()
        .filter_map(|entry| {
            let mut parts = entry.path.split('/');
            match (parts.next(), parts.next(), parts.next()) {
                (Some("rawdata"), Some(_), Some(session)) if session.starts_with("ses-") => {
                    Some(session.to_string())
                }
                _ => None,
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let file_count = entries
        .iter()
        .filter(|entry| entry.kind == RelocationEntryKind::File)
        .count() as u64;
    let byte_total = entries.iter().map(|entry| entry.bytes).sum();
    let fingerprint = fingerprint_entries(root, &entries)?;
    Ok(SubjectInventory {
        subject: subject.to_string(),
        entries,
        file_count,
        byte_total,
        sessions,
        fingerprint,
    })
}

fn fingerprint_entries(root: &Path, entries: &[RelocationEntry]) -> Result<String, String> {
    let mut hash = Sha256::new();
    for entry in entries {
        hash.update(entry.path.as_bytes());
        hash.update([0]);
        hash.update(match entry.kind {
            RelocationEntryKind::File => b"f",
            RelocationEntryKind::Directory => b"d",
        });
        hash.update([0]);
        hash.update(entry.bytes.to_le_bytes());
        hash.update([0]);
        if entry.kind == RelocationEntryKind::File {
            let mut file =
                File::open(safe_join(root, &entry.path)?).map_err(|error| error.to_string())?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn inventory_subject(project_root: &Path, subject: &str) -> Result<SubjectInventory, String> {
    crate::import::validate_subject_components(&[subject.to_string()])?;
    let root = canonical_project_root(project_root)?;
    let sub = subject_dir(subject);
    let mut paths = vec![
        root.join("rawdata").join(&sub),
        crate::import::import_lock_dir_for_relocation(&root, subject),
    ];
    let log_root = root.join("derivatives/ExploreASL/log");
    if path_exists(&log_root)? {
        reject_symlink_components(&root, &log_root)?;
        for entry in fs::read_dir(&log_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if log_matches_subject(&entry.file_name().to_string_lossy(), &sub) {
                paths.push(entry.path());
            }
        }
    }
    let legacy_root = root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    if path_exists(&legacy_root)? {
        reject_symlink_components(&root, &legacy_root)?;
        let prefix = format!("{sub}_");
        for entry in fs::read_dir(&legacy_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                paths.push(entry.path());
            }
        }
    }
    inventory_paths(&root, paths, subject)
}

pub fn plan_relocation(project_root: &Path, subjects: &[String]) -> Result<RelocationPlan, String> {
    create_plan(project_root, subjects, "test-plan".to_string())
}

pub fn create_plan(
    project_root: &Path,
    subjects: &[String],
    plan_id: String,
) -> Result<RelocationPlan, String> {
    crate::import::validate_subject_components(subjects)?;
    if subjects.is_empty() {
        return Err("Relocation plan requires at least one subject".to_string());
    }
    let root = canonical_project_root(project_root)?;
    let mut seen = BTreeSet::new();
    let mut inventories = Vec::new();
    for subject in subjects {
        let key = crate::import::staging::portable_key(subject);
        if !seen.insert(key) {
            return Err("Relocation plan subjects must be portable-unique".to_string());
        }
        inventories.push(inventory_subject(&root, subject)?);
    }
    let mut hash = Sha256::new();
    for inventory in &inventories {
        hash.update(inventory.subject.as_bytes());
        hash.update([0]);
        hash.update(inventory.fingerprint.as_bytes());
    }
    Ok(RelocationPlan {
        plan_id,
        subjects: inventories,
        fingerprint: format!("{:x}", hash.finalize()),
        project_identity: project_identity(&root),
        project_root: root,
        bound_generation: None,
    })
}

pub fn validate_plan_scope(
    plan: &RelocationPlan,
    project_root: &Path,
    subjects: &[String],
) -> Result<(), String> {
    let root = canonical_project_root(project_root)?;
    if plan.project_root != root || plan.project_identity != project_identity(&root) {
        return Err("Relocation plan belongs to another project".to_string());
    }
    if plan.bound_generation.is_some() {
        return Err("Relocation plan has already been used".to_string());
    }
    let planned = plan
        .subjects
        .iter()
        .map(|inventory| crate::import::staging::portable_key(&inventory.subject))
        .collect::<Vec<_>>();
    let requested = subjects
        .iter()
        .map(|subject| crate::import::staging::portable_key(subject))
        .collect::<Vec<_>>();
    if planned != requested {
        return Err("Relocation plan does not match the selected subject scope".to_string());
    }
    Ok(())
}

pub fn bind_plan(
    plan: &mut RelocationPlan,
    project_root: &Path,
    subjects: &[String],
    generation: u64,
) -> Result<(), String> {
    validate_plan_scope(plan, project_root, subjects)?;
    plan.bound_generation = Some(generation);
    Ok(())
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(JOURNAL_FILE)
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Failed to inspect {}: {error}", path.display())),
    }
}

fn is_already_exists(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::AlreadyExists
        || matches!(error.raw_os_error(), Some(libc::EEXIST))
        || cfg!(windows) && matches!(error.raw_os_error(), Some(80) | Some(183))
}

#[cfg(target_os = "linux")]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    unsafe extern "C" {
        fn renameatx_np(fromfd: i32, from: *const i8, tofd: i32, to: *const i8, flags: u32) -> i32;
    }
    const RENAME_EXCL: u32 = 0x0000_0004;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    let result = unsafe {
        renameatx_np(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
compile_error!("import relocation requires an atomic no-replace rename implementation");

fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let source = source
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let destination = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    fs::rename(source, destination)
}

fn journal_temp_path(root: &Path, journal: &RelocationJournal) -> PathBuf {
    let token = journal
        .plan_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let sequence = JOURNAL_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    root.join(format!(
        "{JOURNAL_FILE}.{token}.{}.{timestamp}.{sequence}.tmp",
        journal.generation
    ))
}

fn cleanup_owned_journal_temp(path: &Path, expected_bytes: &[u8]) {
    let owned = fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        && fs::read(path).is_ok_and(|bytes| bytes == expected_bytes);
    if owned {
        let _ = fs::remove_file(path);
    }
}

fn write_journal(root: &Path, journal: &RelocationJournal) -> Result<(), String> {
    validate_journal(root, journal)?;
    fail_if_injected("journal-persist")?;
    let destination = journal_path(root);
    let temporary = journal_temp_path(root, journal);
    let data = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| {
                format!("Failed to exclusively create relocation journal temporary file: {error}")
            })?;
        file.write_all(&data).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        let installed = if path_exists(&destination)? {
            let existing =
                read_journal(root)?.ok_or_else(|| "Relocation journal disappeared".to_string())?;
            if existing.project_identity != journal.project_identity
                || existing.plan_id != journal.plan_id
                || existing.generation != journal.generation
            {
                return Err("Refusing to replace a foreign relocation journal".to_string());
            }
            atomic_replace(&temporary, &destination)
        } else {
            rename_no_replace(&temporary, &destination)
        };
        installed
            .map_err(|error| format!("Failed to atomically persist relocation journal: {error}"))?;
        sync_parent_durable(root)
    })();
    if result.is_err() {
        cleanup_owned_journal_temp(&temporary, &data);
    }
    result
}

fn remove_journal_owned(root: &Path, journal: &RelocationJournal) -> Result<(), String> {
    let current = read_journal(root)?
        .ok_or_else(|| "Relocation journal disappeared before cleanup".to_string())?;
    if current.project_identity != journal.project_identity
        || current.plan_id != journal.plan_id
        || current.generation != journal.generation
        || current.terminal_outcome.is_none()
    {
        return Err(
            "Refusing to remove relocation journal without durable terminal ownership".to_string(),
        );
    }
    fail_if_injected("journal-cleanup")?;
    fs::remove_file(journal_path(root)).map_err(|error| error.to_string())?;
    sync_parent_durable(root)
}

fn read_journal(root: &Path) -> Result<Option<RelocationJournal>, String> {
    let path = journal_path(root);
    if !path_exists(&path)? {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Relocation journal must be a regular non-symlink file".to_string());
    }
    let journal = serde_json::from_slice::<RelocationJournal>(
        &fs::read(path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Malformed relocation journal: {error}"))?;
    validate_journal(root, &journal)?;
    Ok(Some(journal))
}

fn validate_journal(root: &Path, journal: &RelocationJournal) -> Result<(), String> {
    if journal.version != JOURNAL_VERSION || journal.project_identity != project_identity(root) {
        return Err("Foreign or unsupported relocation journal".to_string());
    }
    if journal.plan_id.is_empty() || journal.plan_fingerprint.is_empty() {
        return Err("Relocation journal has invalid run ownership".to_string());
    }
    if journal.subjects.is_empty() {
        return Err("Relocation journal has no owned subjects".to_string());
    }
    let dataset_destination = safe_join(root, &journal.dataset.destination)?;
    if dataset_destination != root.join("rawdata/dataset_description.json") {
        return Err("Journal dataset destination is invalid".to_string());
    }
    let dataset_candidate = candidate_record_path(root, &journal.dataset.candidate)?;
    if dataset_candidate
        != owned_sibling(&dataset_destination, &journal.plan_id, "run", "candidate")?
    {
        return Err("Journal dataset candidate is not transaction-owned".to_string());
    }
    let mut subjects = BTreeSet::new();
    for subject in &journal.subjects {
        crate::import::validate_subject_components(std::slice::from_ref(&subject.subject))?;
        if !subjects.insert(crate::import::staging::portable_key(&subject.subject)) {
            return Err("Relocation journal repeats a subject".to_string());
        }
        let mut destinations = BTreeSet::new();
        for artifact in &subject.artifacts {
            let destination = safe_join(root, &artifact.destination)?;
            if !destinations.insert(artifact.destination.clone())
                || !is_subject_artifact_destination(root, &destination, &subject.subject)
            {
                return Err(
                    "Journal references an unrelated or duplicate artifact destination".to_string(),
                );
            }
            let backup = artifact
                .backup
                .as_deref()
                .ok_or_else(|| "Subject artifact has no backup path".to_string())?;
            if safe_join(root, backup)?
                != owned_sibling(&destination, &journal.plan_id, &subject.subject, "backup")?
            {
                return Err("Journal backup does not match its owned destination".to_string());
            }
            match artifact.role {
                ArtifactRole::Replacement => {
                    let candidate = artifact
                        .candidate
                        .as_deref()
                        .ok_or_else(|| "Replacement artifact has no candidate".to_string())?;
                    if candidate_record_path(root, candidate)?
                        != owned_sibling(
                            &destination,
                            &journal.plan_id,
                            &subject.subject,
                            "candidate",
                        )?
                    {
                        return Err(
                            "Journal candidate does not match its owned destination".to_string()
                        );
                    }
                }
                ArtifactRole::Removal if artifact.candidate.is_some() => {
                    return Err("Removal artifact must not have a candidate".to_string());
                }
                ArtifactRole::Removal => {}
            }
            if artifact.candidate_abandoned
                && !matches!(
                    artifact.phase,
                    ArtifactPhase::RollbackIntent | ArtifactPhase::RolledBack
                )
            {
                return Err("Abandoned candidate has an invalid journal phase".to_string());
            }
        }
    }
    if journal.dataset.candidate_abandoned
        && !matches!(
            journal.dataset.phase,
            DatasetPhase::RollbackIntent | DatasetPhase::RolledBack
        )
    {
        return Err("Abandoned dataset candidate has an invalid journal phase".to_string());
    }
    if let Some(outcome) = &journal.terminal_outcome {
        if outcome.plan_id != journal.plan_id || outcome.generation != journal.generation {
            return Err("Terminal relocation outcome has foreign ownership".to_string());
        }
        let recorded = journal
            .subjects
            .iter()
            .map(|subject| crate::import::staging::portable_key(&subject.subject))
            .collect::<Vec<_>>();
        let terminal = outcome
            .subjects
            .iter()
            .map(|subject| crate::import::staging::portable_key(&subject.subject))
            .collect::<Vec<_>>();
        if recorded != terminal {
            return Err(
                "Terminal relocation outcome does not cover the ordered subject scope".to_string(),
            );
        }
    }
    Ok(())
}

fn is_subject_artifact_destination(root: &Path, destination: &Path, subject: &str) -> bool {
    let sub = subject_dir(subject);
    if destination == root.join("rawdata").join(&sub)
        || destination == crate::import::import_lock_dir_for_relocation(root, subject)
    {
        return true;
    }
    let log_root = root.join("derivatives/ExploreASL/log");
    if destination.parent() == Some(log_root.as_path()) {
        return destination
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| log_matches_subject(name, &sub));
    }
    let legacy_root = root.join("derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy");
    destination.parent() == Some(legacy_root.as_path())
        && destination
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("{sub}_")))
}

fn log_matches_subject(name: &str, sub: &str) -> bool {
    name.match_indices(sub).any(|(index, _)| {
        let before = name[..index].chars().next_back();
        let after = name[index + sub.len()..].chars().next();
        !before.is_some_and(|character| character.is_ascii_alphanumeric())
            && !after.is_some_and(|character| character.is_ascii_alphanumeric())
    })
}

fn sync_parent(path: &Path) -> Result<(), String> {
    fail_if_injected("parent-sync")?;
    sync_parent_durable(path)
}

fn sync_parent_durable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            format!(
                "Failed to synchronize transaction directory {}: {error}",
                path.display()
            )
        })?;
    Ok(())
}

fn owned_sibling(
    destination: &Path,
    plan_id: &str,
    subject: &str,
    role: &str,
) -> Result<PathBuf, String> {
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Destination has no name".to_string())?;
    let parent = destination
        .parent()
        .ok_or_else(|| "Destination has no parent".to_string())?;
    let token = plan_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    if token.is_empty() {
        return Err("Invalid relocation plan identity".to_string());
    }
    Ok(parent.join(format!(".{name}.easl-relocation-{token}-{subject}-{role}")))
}

fn reservation_token(candidate: &Path) -> String {
    let sequence = RESERVATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    sha256_bytes(
        format!(
            "{}\0{}\0{timestamp}\0{sequence}",
            std::process::id(),
            candidate.display()
        )
        .as_bytes(),
    )
}

fn candidate_payload(candidate: &Path) -> PathBuf {
    candidate.join(CANDIDATE_PAYLOAD)
}

fn create_owned_parent_dirs(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Candidate parent escapes project root".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err("Candidate parent is not a normal project-relative path".to_string());
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Symlink in candidate parent path: {}",
                    current.display()
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(format!(
                    "Non-directory candidate parent path: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {
                        sync_parent_durable(current.parent().ok_or_else(|| {
                            "Created candidate directory has no parent".to_string()
                        })?)?
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        let metadata = fs::symlink_metadata(&current)
                            .map_err(|inspect_error| inspect_error.to_string())?;
                        if metadata.file_type().is_symlink() || !metadata.is_dir() {
                            return Err(format!(
                                "Candidate parent was concurrently replaced: {}",
                                current.display()
                            ));
                        }
                    }
                    Err(error) => return Err(error.to_string()),
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn reserve_candidate(root: &Path, candidate: &Path, token: &str) -> Result<(), String> {
    fail_if_injected("candidate-create")?;
    let parent = candidate
        .parent()
        .ok_or_else(|| "Candidate has no parent".to_string())?;
    reject_symlink_components(root, parent)?;
    create_owned_parent_dirs(root, parent)?;
    reject_symlink_components(root, parent)?;
    fs::create_dir(candidate)
        .map_err(|error| format!("Failed to exclusively reserve transaction candidate: {error}"))?;
    let marker = candidate.join(RESERVATION_MARKER);
    let result = (|| {
        let mut marker_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
            .map_err(|error| format!("Failed to mark reserved transaction candidate: {error}"))?;
        marker_file
            .write_all(token.as_bytes())
            .map_err(|error| error.to_string())?;
        marker_file.sync_all().map_err(|error| error.to_string())?;
        sync_parent_durable(candidate)?;
        sync_parent_durable(parent)
    })();
    if result.is_err() {
        let marker_owned = fs::read(&marker).is_ok_and(|contents| contents == token.as_bytes());
        if marker_owned {
            let _ = fs::remove_file(marker);
            let _ = fs::remove_dir(candidate);
        }
    }
    result
}

fn validate_candidate_marker(candidate: &Path, token: Option<&str>) -> Result<(), String> {
    let token = token.ok_or_else(|| "Candidate lacks durable reservation ownership".to_string())?;
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("Failed to inspect candidate wrapper: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Candidate wrapper is not transaction-owned".to_string());
    }
    let marker = candidate.join(RESERVATION_MARKER);
    let marker_metadata = fs::symlink_metadata(&marker)
        .map_err(|error| format!("Candidate reservation marker is missing: {error}"))?;
    if !marker_metadata.is_file()
        || marker_metadata.file_type().is_symlink()
        || fs::read(&marker).map_err(|error| error.to_string())? != token.as_bytes()
    {
        return Err("Candidate reservation marker does not match durable ownership".to_string());
    }
    Ok(())
}

fn populate_reserved_candidate(source: &Path, candidate: &Path) -> Result<String, String> {
    (|| {
        let payload = candidate_payload(candidate);
        copy_tree_reserved(source, &payload, false)?;
        fail_if_injected("source-mutation")?;
        if !same_tree(source, &payload)? {
            return Err("Candidate inventory verification failed".to_string());
        }
        sync_tree(&payload)?;
        fail_if_injected("payload-parent-sync")?;
        sync_parent(candidate)?;
        tree_fingerprint(&payload)
    })()
}

fn validate_ready_candidate(
    candidate: &Path,
    token: Option<&str>,
    expected_payload: Option<&str>,
) -> Result<(), String> {
    validate_candidate_marker(candidate, token)?;
    require_owned_fingerprint(
        &candidate_payload(candidate),
        expected_payload,
        "Prepared candidate payload",
    )
}

fn remove_candidate_wrapper(
    candidate: &Path,
    token: Option<&str>,
    expected_payload: Option<&str>,
    payload_may_be_absent: bool,
) -> Result<(), String> {
    if !path_exists(candidate)? {
        return Ok(());
    }
    validate_candidate_marker(candidate, token)?;
    let payload = candidate_payload(candidate);
    if path_exists(&payload)? {
        require_owned_fingerprint(&payload, expected_payload, "Candidate payload")?;
    } else if !payload_may_be_absent && expected_payload.is_some() {
        return Err("Candidate payload disappeared before owned cleanup".to_string());
    }
    fs::remove_dir_all(candidate).map_err(|error| error.to_string())?;
    fail_if_injected("wrapper-delete-parent-sync")?;
    sync_parent(
        candidate
            .parent()
            .ok_or_else(|| "Candidate wrapper has no parent".to_string())?,
    )
}

fn sync_payload_rename(candidate: &Path, destination: &Path) -> Result<(), String> {
    fail_if_injected("payload-rename-source-sync")?;
    sync_parent(candidate)?;
    fail_if_injected("payload-rename-destination-sync")?;
    sync_parent(
        destination
            .parent()
            .ok_or_else(|| "Installed payload has no destination parent".to_string())?,
    )
}

fn same_tree(source: &Path, candidate: &Path) -> Result<bool, String> {
    let source_metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    let candidate_metadata = fs::symlink_metadata(candidate).map_err(|error| error.to_string())?;
    if source_metadata.file_type().is_symlink() || candidate_metadata.file_type().is_symlink() {
        return Err("Symlink in candidate verification".to_string());
    }
    if source_metadata.is_file() && candidate_metadata.is_file() {
        if source_metadata.len() != candidate_metadata.len() {
            return Ok(false);
        }
        return Ok(file_hash(source)? == file_hash(candidate)?);
    }
    if !source_metadata.is_dir() || !candidate_metadata.is_dir() {
        return Ok(false);
    }
    let mut source_entries = fs::read_dir(source)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut candidate_entries = fs::read_dir(candidate)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    source_entries.sort_by_key(|entry| entry.file_name());
    candidate_entries.sort_by_key(|entry| entry.file_name());
    if source_entries.len() != candidate_entries.len() {
        return Ok(false);
    }
    for (source_entry, candidate_entry) in source_entries.iter().zip(candidate_entries.iter()) {
        if source_entry.file_name() != candidate_entry.file_name()
            || !same_tree(&source_entry.path(), &candidate_entry.path())?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn file_hash(path: &Path) -> Result<String, String> {
    fail_if_injected("hash-verification")?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn copy_tree_reserved(
    source: &Path,
    destination: &Path,
    root_reserved: bool,
) -> Result<(), String> {
    fail_if_injected("recursive-copy")?;
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symlinks are not supported in relocation source".to_string());
    }
    if metadata.is_dir() {
        if !root_reserved {
            fs::create_dir(destination).map_err(|error| {
                format!("Failed to exclusively create candidate directory: {error}")
            })?;
        }
        let mut entries = fs::read_dir(source)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_tree_reserved(&entry.path(), &destination.join(entry.file_name()), false)?;
        }
    } else if metadata.is_file() {
        if fail_if_injected("insufficient-space").is_err() {
            let error = io::Error::from_raw_os_error(libc::ENOSPC);
            return Err(format!(
                "Insufficient space while copying {}: {error}",
                source.display()
            ));
        }
        let mut input = File::open(source).map_err(|error| error.to_string())?;
        let mut output = if root_reserved {
            OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(destination)
        } else {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination)
        }
        .map_err(|error| error.to_string())?;
        io::copy(&mut input, &mut output).map_err(|error| {
            if error.raw_os_error() == Some(libc::ENOSPC) {
                format!(
                    "Insufficient space while copying {}: {error}",
                    source.display()
                )
            } else {
                format!("Failed to copy {}: {error}", source.display())
            }
        })?;
        fail_if_injected("file-sync")?;
        output.sync_all().map_err(|error| error.to_string())?;
    } else {
        return Err("Unsupported filesystem entry in relocation source".to_string());
    }
    Ok(())
}

fn sync_tree(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symlink in transaction candidate".to_string());
    }
    if metadata.is_file() {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
    } else if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            sync_tree(&entry.map_err(|error| error.to_string())?.path())?;
        }
        sync_parent(path)?;
    } else {
        return Err("Unsupported transaction candidate entry".to_string());
    }
    Ok(())
}

fn hash_tree(path: &Path, base: &Path, hash: &mut Sha256) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symlink in owned transaction artifact".to_string());
    }
    let relative = path
        .strip_prefix(base)
        .map_err(|_| "Artifact path escaped fingerprint root".to_string())?;
    hash.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
    if metadata.is_dir() {
        hash.update(b"d\0");
        let mut entries = fs::read_dir(path)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            hash_tree(&entry.path(), base, hash)?;
        }
    } else if metadata.is_file() {
        hash.update(b"f\0");
        hash.update(metadata.len().to_le_bytes());
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
    } else {
        return Err("Unsupported owned transaction artifact".to_string());
    }
    Ok(())
}

fn tree_fingerprint(path: &Path) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash_tree(path, path, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()))
}

fn remove_proven(path: &Path, expected: Option<&str>, ownership: &str) -> Result<(), String> {
    if !path_exists(path)? {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Refusing to remove symlink at {ownership}"));
    }
    if let Some(expected) = expected {
        let actual = tree_fingerprint(path)?;
        if actual != expected {
            return Err(format!("Refusing to remove changed or unowned {ownership}"));
        }
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else if metadata.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        Err(format!("Refusing to remove unsupported {ownership}"))
    }
}

fn relative_owned(root: &Path, path: &Path) -> Result<String, String> {
    relative_path(root, path)
}

fn source_artifacts(
    root: &Path,
    staging: &Path,
    subject: &str,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let sub = subject_dir(subject);
    let raw_source = staging.join("rawdata").join(&sub);
    reject_symlink_components(staging, &raw_source)?;
    // Mandatory rawdata absence remains a per-subject outcome. Preflight still
    // records its deterministic source/destination/candidate paths before any
    // project mutation; preparation enforces existence and nonemptiness.
    let mut artifacts = vec![(raw_source, root.join("rawdata").join(&sub))];
    let lock_source = crate::import::import_lock_dir_for_relocation(staging, subject);
    if path_exists(&lock_source)? {
        reject_symlink_components(staging, &lock_source)?;
        artifacts.push((
            lock_source,
            crate::import::import_lock_dir_for_relocation(root, subject),
        ));
    }
    let source_logs = staging.join("derivatives/ExploreASL/log");
    if path_exists(&source_logs)? {
        reject_symlink_components(staging, &source_logs)?;
        for entry in fs::read_dir(source_logs).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if log_matches_subject(&entry.file_name().to_string_lossy(), &sub) {
                reject_symlink_components(staging, &entry.path())?;
                artifacts.push((
                    entry.path(),
                    root.join("derivatives/ExploreASL/log")
                        .join(entry.file_name()),
                ));
            }
        }
    }
    artifacts.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(artifacts)
}

fn planned_subject(
    root: &Path,
    staging: &Path,
    plan: &RelocationPlan,
    inventory: &SubjectInventory,
) -> Result<JournalSubject, String> {
    use std::collections::BTreeMap;
    let mut members = BTreeMap::<PathBuf, Option<PathBuf>>::new();
    for (source, destination) in source_artifacts(root, staging, &inventory.subject)? {
        if members.insert(destination, Some(source)).is_some() {
            return Err("Duplicate relocation artifact destination".to_string());
        }
    }
    let lock_destination = crate::import::import_lock_dir_for_relocation(root, &inventory.subject);
    let lock_relative = relative_owned(root, &lock_destination)?;
    if inventory.entries.iter().any(|entry| {
        entry.path == lock_relative || entry.path.starts_with(&format!("{lock_relative}/"))
    }) {
        members.entry(lock_destination).or_insert(None);
    }
    for entry in &inventory.entries {
        if entry.kind != RelocationEntryKind::File
            || !entry.path.starts_with("derivatives/ExploreASL/log/")
        {
            continue;
        }
        members.entry(safe_join(root, &entry.path)?).or_insert(None);
    }
    let legacy_prefix = format!(
        "derivatives/ExploreASL/lock/xASL_module_BIDS2Legacy/{}_",
        subject_dir(&inventory.subject)
    );
    for entry in &inventory.entries {
        if !entry.path.starts_with(&legacy_prefix) {
            continue;
        }
        let relative = Path::new(&entry.path);
        if relative.components().count() == 5 {
            members.entry(safe_join(root, &entry.path)?).or_insert(None);
        }
    }
    let mut artifacts = Vec::new();
    for (destination, source) in members {
        reject_symlink_components(root, &destination)?;
        let candidate = source
            .as_ref()
            .map(|_| owned_sibling(&destination, &plan.plan_id, &inventory.subject, "candidate"))
            .transpose()?;
        let backup = owned_sibling(&destination, &plan.plan_id, &inventory.subject, "backup")?;
        for reserved in candidate.iter().chain(std::iter::once(&backup)) {
            reject_symlink_components(root, reserved)?;
            if path_exists(reserved)? {
                return Err(format!(
                    "Reserved transaction path collision: {}",
                    reserved.display()
                ));
            }
        }
        let had_destination = path_exists(&destination)?;
        let backup_fingerprint = if had_destination {
            Some(tree_fingerprint(&destination)?)
        } else {
            None
        };
        artifacts.push(JournalArtifact {
            role: if source.is_some() {
                ArtifactRole::Replacement
            } else {
                ArtifactRole::Removal
            },
            destination: relative_owned(root, &destination)?,
            candidate: candidate
                .as_ref()
                .map(|path| relative_owned(root, path))
                .transpose()?,
            backup: Some(relative_owned(root, &backup)?),
            had_destination,
            phase: ArtifactPhase::Planned,
            candidate_fingerprint: None,
            backup_fingerprint,
            reservation_token: None,
            candidate_abandoned: false,
        });
    }
    Ok(JournalSubject {
        subject: inventory.subject.clone(),
        phase: SubjectPhase::Planned,
        artifacts,
    })
}

fn planned_dataset(
    root: &Path,
    staging: &Path,
    plan: &RelocationPlan,
) -> Result<JournalDataset, String> {
    let source = staging.join("rawdata/dataset_description.json");
    let destination = root.join("rawdata/dataset_description.json");
    let candidate = owned_sibling(&destination, &plan.plan_id, "run", "candidate")?;
    reject_symlink_components(staging, &source)?;
    reject_symlink_components(root, &destination)?;
    reject_symlink_components(root, &candidate)?;
    let source_present = path_exists(&source)?;
    if source_present {
        let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Staged dataset description must be a regular file".to_string());
        }
    }
    let destination_existed = path_exists(&destination)?;
    if destination_existed {
        let metadata = fs::symlink_metadata(&destination).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Existing dataset description must be a regular file".to_string());
        }
    }
    let phase = if !source_present {
        DatasetPhase::NotRequired
    } else if destination_existed {
        DatasetPhase::ExistingWon
    } else {
        DatasetPhase::Planned
    };
    if phase == DatasetPhase::Planned && path_exists(&candidate)? {
        return Err("Dataset description transaction candidate collision".to_string());
    }
    Ok(JournalDataset {
        source_present,
        destination_existed,
        destination: relative_owned(root, &destination)?,
        candidate: relative_owned(root, &candidate)?,
        phase,
        fingerprint: None,
        reservation_token: None,
        candidate_abandoned: false,
    })
}

fn prepare_dataset(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if journal.dataset.phase != DatasetPhase::Planned {
        return Ok(());
    }
    let source = staging.join("rawdata/dataset_description.json");
    let candidate = safe_join(root, &journal.dataset.candidate)?;
    let destination = safe_join(root, &journal.dataset.destination)?;
    let token = reservation_token(&candidate);
    journal.dataset.reservation_token = Some(token.clone());
    journal.dataset.phase = DatasetPhase::ReservationIntent;
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-dataset-reservation-intent")?;
    reserve_candidate(root, &candidate, &token)?;
    fail_if_interrupted("interrupt-after-dataset-reservation-operation")?;
    journal.dataset.phase = DatasetPhase::CandidateReserved;
    write_journal(root, journal)?;
    sync_parent(candidate.parent().expect("dataset candidate parent"))?;
    fail_if_interrupted("interrupt-after-dataset-reserved")?;
    journal.dataset.phase = DatasetPhase::PopulationIntent;
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-dataset-population-intent")?;
    validate_candidate_marker(&candidate, journal.dataset.reservation_token.as_deref())?;
    let fingerprint = populate_reserved_candidate(&source, &candidate)?;
    fail_if_interrupted("interrupt-after-dataset-population-operation")?;
    journal.dataset.fingerprint = Some(fingerprint);
    journal.dataset.phase = DatasetPhase::CandidateReady;
    write_journal(root, journal)?;
    #[cfg(test)]
    substitute_if_injected(
        RelocationFailurePoint::SubstituteDatasetAfterCandidateReady,
        &candidate,
    )?;
    fail_if_interrupted("interrupt-after-dataset-candidate-ready")?;
    journal.dataset.phase = DatasetPhase::InstallIntent;
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-dataset-install-intent")?;
    fail_if_injected("dataset-install")
        .map_err(|error| format!("Dataset description install failed: {error}"))?;
    #[cfg(test)]
    if fail_if_injected("dataset-collision").is_err() {
        create_collision(&destination)?;
    }
    validate_ready_candidate(
        &candidate,
        journal.dataset.reservation_token.as_deref(),
        journal.dataset.fingerprint.as_deref(),
    )?;
    match rename_no_replace(&candidate_payload(&candidate), &destination) {
        Ok(()) => {
            sync_payload_rename(&candidate, &destination)?;
            #[cfg(test)]
            substitute_if_injected(
                RelocationFailurePoint::SubstituteDatasetAfterInstall,
                &destination,
            )?;
            require_owned_fingerprint(
                &destination,
                journal.dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
            fail_if_interrupted("interrupt-after-dataset-install-operation")?;
            journal.dataset.phase = DatasetPhase::Installed;
        }
        Err(error) if is_already_exists(&error) => {
            // Persist the concurrent winner before deleting our candidate.
            // Recovery can then preserve the unowned destination whether the
            // wrapper deletion itself is observed before or after a crash.
            journal.dataset.phase = DatasetPhase::ExistingWon;
            write_journal(root, journal)?;
            remove_candidate_wrapper(
                &candidate,
                journal.dataset.reservation_token.as_deref(),
                journal.dataset.fingerprint.as_deref(),
                false,
            )?;
        }
        Err(error) => {
            return Err(format!(
                "Failed to atomically install dataset description without replacement: {error}"
            )
            .into());
        }
    }
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-dataset-install")
}

fn prepare_subject(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    let subject_name = journal.subjects[index].subject.clone();
    let current_sources = source_artifacts(root, staging, &subject_name)?
        .into_iter()
        .map(|(_, destination)| relative_owned(root, &destination))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let planned_sources = journal.subjects[index]
        .artifacts
        .iter()
        .filter(|artifact| artifact.role == ArtifactRole::Replacement)
        .map(|artifact| artifact.destination.clone())
        .collect::<BTreeSet<_>>();
    if current_sources != planned_sources {
        return Err(format!(
            "Staged ancillary artifact set changed before relocation for {subject_name}"
        )
        .into());
    }
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        if journal.subjects[index].artifacts[artifact_index].role != ArtifactRole::Replacement {
            continue;
        }
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        let candidate_relative = journal.subjects[index].artifacts[artifact_index]
            .candidate
            .clone()
            .expect("validated candidate");
        let candidate = safe_join(root, &candidate_relative)?;
        let source = if destination == root.join("rawdata").join(subject_dir(&subject_name)) {
            staging.join("rawdata").join(subject_dir(&subject_name))
        } else if destination == crate::import::import_lock_dir_for_relocation(root, &subject_name)
        {
            crate::import::import_lock_dir_for_relocation(staging, &subject_name)
        } else {
            staging
                .join("derivatives/ExploreASL/log")
                .join(destination.file_name().expect("log name"))
        };
        if destination == root.join("rawdata").join(subject_dir(&subject_name)) {
            if !path_exists(&source)? {
                return Err(format!("Missing staged rawdata directory for {subject_name}").into());
            }
            let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(format!(
                    "Staged rawdata for {subject_name} must be a regular directory"
                )
                .into());
            }
            if fs::read_dir(&source)
                .map_err(|error| error.to_string())?
                .next()
                .is_none()
            {
                return Err(format!("Empty staged rawdata directory for {subject_name}").into());
            }
        }
        let token = reservation_token(&candidate);
        journal.subjects[index].artifacts[artifact_index].reservation_token = Some(token.clone());
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::ReservationIntent;
        write_journal(root, journal)?;
        fail_if_interrupted("interrupt-after-candidate-reservation-intent")?;
        reserve_candidate(root, &candidate, &token)?;
        fail_if_interrupted("interrupt-after-candidate-reservation-operation")?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::CandidateReserved;
        write_journal(root, journal)?;
        sync_parent(candidate.parent().expect("candidate parent"))?;
        fail_if_interrupted("interrupt-after-candidate-reserved")?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::PopulationIntent;
        write_journal(root, journal)?;
        fail_if_interrupted("interrupt-after-candidate-population-intent")?;
        validate_candidate_marker(
            &candidate,
            journal.subjects[index].artifacts[artifact_index]
                .reservation_token
                .as_deref(),
        )?;
        let fingerprint = populate_reserved_candidate(&source, &candidate)?;
        fail_if_interrupted("interrupt-after-candidate-population-operation")?;
        journal.subjects[index].artifacts[artifact_index].candidate_fingerprint = Some(fingerprint);
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::CandidateReady;
        write_journal(root, journal)?;
        #[cfg(test)]
        substitute_if_injected(
            RelocationFailurePoint::SubstituteAfterCandidateReady,
            &candidate,
        )?;
    }
    journal.subjects[index].phase = SubjectPhase::Prepared;
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-candidate-ready")
}

#[cfg(test)]
fn create_collision(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Collision path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(path, b"concurrent-unowned").map_err(|error| error.to_string())
}

fn commit_subject(
    root: &Path,
    journal: &mut RelocationJournal,
    index: usize,
    failure_phase: &mut &'static str,
) -> RelocationTransactionResult<()> {
    *failure_phase = "journal";
    journal.subjects[index].phase = SubjectPhase::Committing;
    write_journal(root, journal)?;
    // Validate every prepared payload before moving any authoritative path.
    *failure_phase = "candidateVerification";
    for artifact in &journal.subjects[index].artifacts {
        if artifact.role != ArtifactRole::Replacement {
            continue;
        }
        let candidate = safe_join(
            root,
            artifact.candidate.as_deref().expect("validated candidate"),
        )?;
        validate_ready_candidate(
            &candidate,
            artifact.reservation_token.as_deref(),
            artifact.candidate_fingerprint.as_deref(),
        )?;
    }
    *failure_phase = "backup";
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        let had_destination = journal.subjects[index].artifacts[artifact_index].had_destination;
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        let backup = safe_join(
            root,
            journal.subjects[index].artifacts[artifact_index]
                .backup
                .as_deref()
                .expect("validated backup"),
        )?;
        if had_destination {
            journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::BackupIntent;
            write_journal(root, journal)?;
            fail_if_interrupted("interrupt-after-backup-intent")?;
            fail_if_injected("destination-backup")?;
            #[cfg(test)]
            if fail_if_injected("backup-collision").is_err() {
                create_collision(&backup)?;
            }
            rename_no_replace(&destination, &backup).map_err(|error| {
                format!("Failed to back up destination without replacement: {error}")
            })?;
            sync_parent(destination.parent().expect("destination parent"))?;
            let expected = journal.subjects[index].artifacts[artifact_index]
                .backup_fingerprint
                .as_deref()
                .ok_or_else(|| "Destination backup lacks its preflight fingerprint".to_string())?;
            if tree_fingerprint(&backup)? != expected {
                return Err(format!(
                    "Destination changed after relocation preflight: {}",
                    journal.subjects[index].artifacts[artifact_index].destination
                )
                .into());
            }
            fail_if_interrupted("interrupt-after-backup-operation")?;
        }
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::BackedUp;
        write_journal(root, journal)?;
        fail_if_interrupted("interrupt-after-backup")?;
    }
    *failure_phase = "install";
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        if journal.subjects[index].artifacts[artifact_index].role != ArtifactRole::Replacement {
            continue;
        }
        let candidate = safe_join(
            root,
            journal.subjects[index].artifacts[artifact_index]
                .candidate
                .as_deref()
                .expect("validated candidate"),
        )?;
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::InstallIntent;
        write_journal(root, journal)?;
        fail_if_interrupted("interrupt-after-install-intent")?;
        if journal.subjects[index].artifacts[artifact_index]
            .destination
            .starts_with("rawdata/")
        {
            fail_if_injected("candidate-install")?;
        } else {
            fail_if_injected("ancillary-install")?;
        }
        #[cfg(test)]
        if fail_if_injected("install-collision").is_err() {
            create_collision(&destination)?;
        }
        rename_no_replace(&candidate_payload(&candidate), &destination).map_err(|error| {
            format!("Failed to install transaction candidate without replacement: {error}")
        })?;
        #[cfg(test)]
        substitute_if_injected(RelocationFailurePoint::SubstituteAfterInstall, &destination)?;
        sync_payload_rename(&candidate, &destination)?;
        require_owned_fingerprint(
            &destination,
            journal.subjects[index].artifacts[artifact_index]
                .candidate_fingerprint
                .as_deref(),
            "Installed transaction destination",
        )?;
        fail_if_interrupted("interrupt-after-install-operation")?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::Installed;
        write_journal(root, journal)?;
        fail_if_interrupted("interrupt-after-install")?;
    }
    if rollback_interrupt_is_active() {
        return Err("Injected pre-commit failure for rollback interruption"
            .to_string()
            .into());
    }
    *failure_phase = "commitVerification";
    for artifact in &journal.subjects[index].artifacts {
        if artifact.role == ArtifactRole::Replacement {
            let destination = safe_join(root, &artifact.destination)?;
            require_owned_fingerprint(
                &destination,
                artifact.candidate_fingerprint.as_deref(),
                "Installed destination before subject commit",
            )?;
        }
    }
    *failure_phase = "commit";
    journal.subjects[index].phase = SubjectPhase::Committed;
    write_journal(root, journal)?;
    fail_if_interrupted("interrupt-after-commit")
}

fn validate_candidate_for_phase(root: &Path, artifact: &JournalArtifact) -> Result<(), String> {
    let Some(candidate_relative) = artifact.candidate.as_deref() else {
        return Ok(());
    };
    if artifact.candidate_abandoned {
        return if matches!(
            artifact.phase,
            ArtifactPhase::RollbackIntent | ArtifactPhase::RolledBack
        ) {
            Ok(())
        } else {
            Err("Abandoned candidate has an invalid phase".to_string())
        };
    }
    let candidate = candidate_record_path(root, candidate_relative)?;
    let exists = path_exists(&candidate)?;
    match artifact.phase {
        ArtifactPhase::Planned => {
            if exists {
                Err("Candidate exists before durable reservation intent".to_string())
            } else {
                Ok(())
            }
        }
        ArtifactPhase::ReservationIntent => {
            if !exists {
                return Ok(());
            }
            // Reservation intent precedes wrapper creation. Missing, partial, or
            // unsynced marker evidence is therefore non-authoritative and gets
            // classified for preservation after whole-journal preflight.
            Ok(())
        }
        ArtifactPhase::CandidateReserved => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                return Err("Reserved candidate unexpectedly has a payload".to_string());
            }
            Ok(())
        }
        ArtifactPhase::PopulationIntent => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())
        }
        ArtifactPhase::CandidateReady | ArtifactPhase::BackupIntent | ArtifactPhase::BackedUp => {
            validate_ready_candidate(
                &candidate,
                artifact.reservation_token.as_deref(),
                artifact.candidate_fingerprint.as_deref(),
            )
        }
        ArtifactPhase::InstallIntent => {
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? {
                require_owned_fingerprint(
                    &payload,
                    artifact.candidate_fingerprint.as_deref(),
                    "Install-intent candidate payload",
                )?;
            }
            Ok(())
        }
        ArtifactPhase::Installed => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                return Err("Installed candidate wrapper still contains its payload".to_string());
            }
            Ok(())
        }
        ArtifactPhase::RollbackIntent => {
            if exists {
                validate_candidate_marker(&candidate, artifact.reservation_token.as_deref())?;
                let payload = candidate_payload(&candidate);
                if path_exists(&payload)? && artifact.candidate_fingerprint.is_some() {
                    require_owned_fingerprint(
                        &payload,
                        artifact.candidate_fingerprint.as_deref(),
                        "Rollback candidate payload",
                    )?;
                }
            }
            Ok(())
        }
        ArtifactPhase::RolledBack => {
            if exists {
                Err("Rolled-back artifact retains a candidate wrapper".to_string())
            } else {
                Ok(())
            }
        }
    }
}

fn cleanup_candidate(root: &Path, artifact: &JournalArtifact) -> Result<(), String> {
    let Some(candidate_relative) = artifact.candidate.as_deref() else {
        return Ok(());
    };
    let candidate = candidate_record_path(root, candidate_relative)?;
    if !path_exists(&candidate)? {
        return Ok(());
    }
    validate_candidate_for_phase(root, artifact)?;
    // PopulationIntent may contain a partial payload; its durable marker is the
    // ownership proof. Every later phase additionally requires payload identity.
    fs::remove_dir_all(&candidate).map_err(|error| error.to_string())?;
    fail_if_injected("wrapper-delete-parent-sync")?;
    sync_parent(candidate.parent().expect("candidate parent"))
}

fn destination_fingerprint_matches(path: &Path, expected: Option<&str>) -> Result<bool, String> {
    let Some(expected) = expected else {
        return Ok(false);
    };
    Ok(tree_fingerprint(path)? == expected)
}

fn rollback_artifact(
    root: &Path,
    journal: &mut RelocationJournal,
    subject_index: usize,
    artifact_index: usize,
) -> RelocationTransactionResult<()> {
    if journal.subjects[subject_index].artifacts[artifact_index].phase
        != ArtifactPhase::RollbackIntent
    {
        journal.subjects[subject_index].artifacts[artifact_index].phase =
            ArtifactPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    fail_if_interrupted("interrupt-rollback-after-intent")?;
    let artifact = journal.subjects[subject_index].artifacts[artifact_index].clone();
    let destination = safe_join(root, &artifact.destination)?;
    let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
    let mut destination_exists = path_exists(&destination)?;
    let mut backup_exists = path_exists(&backup)?;

    if backup_exists {
        require_owned_fingerprint(
            &backup,
            artifact.backup_fingerprint.as_deref(),
            "Rollback backup",
        )?;
    }

    if artifact.had_destination {
        if backup_exists {
            if destination_exists {
                if artifact.role != ArtifactRole::Replacement
                    || !destination_fingerprint_matches(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                    )?
                {
                    return Err(format!(
                        "Unowned destination prevents rollback for {}",
                        artifact.destination
                    )
                    .into());
                }
                remove_proven(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "installed transaction destination",
                )?;
                sync_parent(destination.parent().expect("destination parent"))?;
                destination_exists = false;
                fail_if_interrupted("interrupt-rollback-after-destination-removal")?;
            }
            if !destination_exists {
                rename_no_replace(&backup, &destination).map_err(|error| {
                    format!("Failed to restore backup without replacement: {error}")
                })?;
                sync_parent(destination.parent().expect("destination parent"))?;
                backup_exists = false;
                destination_exists = true;
                fail_if_interrupted("interrupt-rollback-after-backup-restore")?;
            }
        } else if !destination_exists
            || !destination_fingerprint_matches(
                &destination,
                artifact.backup_fingerprint.as_deref(),
            )?
        {
            return Err(format!(
                "Rollback cannot prove restored destination for {}",
                artifact.destination
            )
            .into());
        }
    } else {
        if backup_exists {
            return Err("Unexpected backup exists for originally absent destination"
                .to_string()
                .into());
        }
        if destination_exists {
            if artifact.role != ArtifactRole::Replacement
                || !destination_fingerprint_matches(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                )?
            {
                return Err(format!(
                    "Unowned destination prevents restoring prior absence for {}",
                    artifact.destination
                )
                .into());
            }
            remove_proven(
                &destination,
                artifact.candidate_fingerprint.as_deref(),
                "installed transaction destination",
            )?;
            sync_parent(destination.parent().expect("destination parent"))?;
            destination_exists = false;
            fail_if_interrupted("interrupt-rollback-after-destination-removal")?;
        }
    }

    debug_assert!(!backup_exists);
    debug_assert_eq!(destination_exists, artifact.had_destination);
    if !artifact.candidate_abandoned {
        cleanup_candidate(root, &artifact)?;
    }
    fail_if_interrupted("interrupt-rollback-after-candidate-cleanup")?;
    journal.subjects[subject_index].artifacts[artifact_index].phase = ArtifactPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}

fn rollback_subject(
    root: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    fail_if_injected("rollback")?;
    for artifact_index in (0..journal.subjects[index].artifacts.len()).rev() {
        rollback_artifact(root, journal, index, artifact_index)?;
    }
    journal.subjects[index].phase = SubjectPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}

fn dataset_should_remain(journal: &RelocationJournal) -> bool {
    journal
        .subjects
        .iter()
        .any(|subject| subject.phase == SubjectPhase::Committed)
}

fn validate_dataset_candidate_for_phase(
    root: &Path,
    dataset: &JournalDataset,
) -> Result<(), String> {
    if dataset.candidate_abandoned {
        return if matches!(
            dataset.phase,
            DatasetPhase::RollbackIntent | DatasetPhase::RolledBack
        ) {
            Ok(())
        } else {
            Err("Abandoned dataset candidate has an invalid phase".to_string())
        };
    }
    let candidate = candidate_record_path(root, &dataset.candidate)?;
    let exists = path_exists(&candidate)?;
    match dataset.phase {
        DatasetPhase::NotRequired | DatasetPhase::Planned => {
            if exists {
                Err("Dataset candidate exists outside an owned preparation state".to_string())
            } else {
                Ok(())
            }
        }
        DatasetPhase::ExistingWon => {
            if exists {
                validate_ready_candidate(
                    &candidate,
                    dataset.reservation_token.as_deref(),
                    dataset.fingerprint.as_deref(),
                )?;
            }
            Ok(())
        }
        DatasetPhase::ReservationIntent => {
            if !exists {
                return Ok(());
            }
            Ok(())
        }
        DatasetPhase::CandidateReserved => {
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                return Err("Reserved dataset candidate unexpectedly has a payload".to_string());
            }
            Ok(())
        }
        DatasetPhase::PopulationIntent => {
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())
        }
        DatasetPhase::CandidateReady => validate_ready_candidate(
            &candidate,
            dataset.reservation_token.as_deref(),
            dataset.fingerprint.as_deref(),
        ),
        DatasetPhase::InstallIntent | DatasetPhase::RollbackIntent => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? && dataset.fingerprint.is_some() {
                require_owned_fingerprint(
                    &payload,
                    dataset.fingerprint.as_deref(),
                    "Dataset candidate payload",
                )?;
            }
            Ok(())
        }
        DatasetPhase::Installed => {
            if !exists {
                return Ok(());
            }
            validate_candidate_marker(&candidate, dataset.reservation_token.as_deref())?;
            if path_exists(&candidate_payload(&candidate))? {
                return Err("Installed dataset wrapper still contains its payload".to_string());
            }
            Ok(())
        }
        DatasetPhase::RolledBack => {
            if exists {
                Err("Rolled-back dataset retains a candidate wrapper".to_string())
            } else {
                Ok(())
            }
        }
    }
}

fn cleanup_dataset_candidate(root: &Path, dataset: &JournalDataset) -> Result<(), String> {
    let candidate = candidate_record_path(root, &dataset.candidate)?;
    if !path_exists(&candidate)? {
        return Ok(());
    }
    validate_dataset_candidate_for_phase(root, dataset)?;
    fs::remove_dir_all(&candidate).map_err(|error| error.to_string())?;
    fail_if_injected("wrapper-delete-parent-sync")?;
    sync_parent(candidate.parent().expect("dataset candidate parent"))
}

fn rollback_dataset(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if matches!(
        journal.dataset.phase,
        DatasetPhase::NotRequired | DatasetPhase::RolledBack
    ) {
        return Ok(());
    }
    if journal.dataset.phase == DatasetPhase::ExistingWon {
        cleanup_dataset_candidate(root, &journal.dataset)?;
        return Ok(());
    }
    if journal.dataset.phase != DatasetPhase::RollbackIntent {
        journal.dataset.phase = DatasetPhase::RollbackIntent;
        write_journal(root, journal)?;
    }
    fail_if_interrupted("interrupt-dataset-rollback-after-intent")?;
    let destination = safe_join(root, &journal.dataset.destination)?;
    if path_exists(&destination)? {
        if journal.dataset.destination_existed {
            return Err("Dataset rollback cannot alter the pre-existing destination"
                .to_string()
                .into());
        }
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Rollback dataset destination",
        )?;
        remove_proven(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "installed dataset description",
        )?;
        sync_parent(destination.parent().expect("dataset parent"))?;
        fail_if_interrupted("interrupt-dataset-rollback-after-destination-removal")?;
    }
    if !journal.dataset.candidate_abandoned {
        cleanup_dataset_candidate(root, &journal.dataset)?;
    }
    fail_if_interrupted("interrupt-dataset-rollback-after-candidate-cleanup")?;
    journal.dataset.phase = DatasetPhase::RolledBack;
    write_journal(root, journal)?;
    Ok(())
}

fn cleanup_after_terminal(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    fail_if_injected("cleanup")?;
    // Validate every installed replacement and retained backup before deleting
    // any old authoritative copy.
    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        for artifact in &subject.artifacts {
            let destination = safe_join(root, &artifact.destination)?;
            match artifact.role {
                ArtifactRole::Replacement => {
                    if artifact.phase != ArtifactPhase::Installed {
                        return Err("Committed replacement has no installed state"
                            .to_string()
                            .into());
                    }
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Committed installed destination",
                    )?;
                    validate_candidate_for_phase(root, artifact)?;
                }
                ArtifactRole::Removal if path_exists(&destination)? => {
                    return Err("Committed removal destination reappeared"
                        .to_string()
                        .into());
                }
                ArtifactRole::Removal => {}
            }
            let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
            if path_exists(&backup)? {
                require_owned_fingerprint(
                    &backup,
                    artifact.backup_fingerprint.as_deref(),
                    "Committed transaction backup",
                )?;
            }
        }
    }
    if dataset_should_remain(journal) && journal.dataset.phase == DatasetPhase::Installed {
        let destination = safe_join(root, &journal.dataset.destination)?;
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Committed dataset description",
        )?;
        validate_dataset_candidate_for_phase(root, &journal.dataset)?;
    }

    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        for artifact in &subject.artifacts {
            if artifact.role == ArtifactRole::Replacement {
                cleanup_candidate(root, artifact)?;
            }
            let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
            if path_exists(&backup)? {
                if artifact.role == ArtifactRole::Replacement {
                    let destination = safe_join(root, &artifact.destination)?;
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Committed installed destination before backup cleanup",
                    )?;
                }
                remove_proven(
                    &backup,
                    artifact.backup_fingerprint.as_deref(),
                    "committed transaction backup",
                )?;
                sync_parent(backup.parent().expect("backup parent"))?;
            }
        }
    }
    if !dataset_should_remain(journal) {
        rollback_dataset(root, journal)?;
    } else if matches!(
        journal.dataset.phase,
        DatasetPhase::Installed | DatasetPhase::ExistingWon
    ) {
        cleanup_dataset_candidate(root, &journal.dataset)?;
    }
    Ok(())
}

pub fn relocate(
    plan: &RelocationPlan,
    generation: u64,
    staging: &Path,
    succeeded_subjects: &[String],
    cleanup_staging: bool,
    debug_mode: bool,
) -> Result<RelocationOutcome, String> {
    if plan.bound_generation != Some(generation) {
        return Err("Relocation plan is not bound to this import generation".to_string());
    }
    let root = canonical_project_root(&plan.project_root)?;
    if project_identity(&root) != plan.project_identity {
        return Err("Relocation plan belongs to another project".to_string());
    }
    reject_symlink_components(&root, staging)?;
    if !staging.is_dir() {
        return Err("Import staging root is missing".to_string());
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
        return Err(
            "Relocation plan is stale; project output changed after confirmation".to_string(),
        );
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
        return Err(
            "Succeeded import subjects do not match the confirmed relocation plan".to_string(),
        );
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
        return Err("An import relocation journal already requires recovery".to_string());
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
        let mut failure_phase = "candidatePreparation";
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
                return Err(error.into());
            }
            Err(error) => {
                let error = error.to_string();
                match rollback_subject(&root, &mut journal, index) {
                    Ok(()) => outcomes.push(SubjectRelocationOutcome {
                        subject,
                        status: RelocationSubjectStatus::RolledBack,
                        phase: failure_phase.to_string(),
                        message: Some(error),
                    }),
                    Err(recovery_error @ RelocationTransactionError::Interrupted { .. }) => {
                        return Err(recovery_error.into());
                    }
                    Err(recovery_error) => {
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
    fail_if_injected("outcome-persist")?;
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
            return Err(error.into());
        }
        // Authoritative subject outcomes are durable. Retain journal and staging;
        // activation recovery can finish cleanup and surface a warning.
        log::warn!("Relocation terminal cleanup deferred: {error}");
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
    remove_journal_owned(&root, &journal)?;
    Ok(outcome)
}

fn require_owned_fingerprint(
    path: &Path,
    expected: Option<&str>,
    description: &str,
) -> Result<(), String> {
    let expected = expected.ok_or_else(|| format!("{description} lacks a durable fingerprint"))?;
    if tree_fingerprint(path)? != expected {
        return Err(format!(
            "{description} does not match its durable fingerprint"
        ));
    }
    Ok(())
}

fn validate_prior_destination(
    destination: &Path,
    destination_exists: bool,
    artifact: &JournalArtifact,
) -> Result<(), String> {
    if artifact.had_destination {
        if !destination_exists {
            return Err(format!(
                "Prior destination is missing for {}",
                artifact.destination
            ));
        }
        require_owned_fingerprint(
            destination,
            artifact.backup_fingerprint.as_deref(),
            "Prior destination",
        )
    } else if destination_exists {
        Err(format!(
            "Destination appeared despite recorded prior absence for {}",
            artifact.destination
        ))
    } else {
        Ok(())
    }
}

fn validate_owned_backup(
    backup: &Path,
    backup_exists: bool,
    artifact: &JournalArtifact,
) -> Result<(), String> {
    if artifact.had_destination {
        if !backup_exists {
            return Err(format!(
                "Required backup is missing for {}",
                artifact.destination
            ));
        }
        require_owned_fingerprint(
            backup,
            artifact.backup_fingerprint.as_deref(),
            "Transaction backup",
        )
    } else if backup_exists {
        Err(format!(
            "Unexpected backup exists for originally absent {}",
            artifact.destination
        ))
    } else {
        Ok(())
    }
}

fn validate_recovery_artifact(
    root: &Path,
    artifact: &JournalArtifact,
    committed: bool,
    terminal_exists: bool,
) -> Result<(), String> {
    let destination = safe_join(root, &artifact.destination)?;
    let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
    let destination_exists = path_exists(&destination)?;
    let backup_exists = path_exists(&backup)?;
    validate_candidate_for_phase(root, artifact)?;

    if committed {
        match artifact.role {
            ArtifactRole::Replacement => {
                if artifact.phase != ArtifactPhase::Installed || !destination_exists {
                    return Err(format!(
                        "Committed replacement evidence is incomplete for {}",
                        artifact.destination
                    ));
                }
                require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Committed destination",
                )?;
            }
            ArtifactRole::Removal => {
                if artifact.phase != ArtifactPhase::BackedUp || destination_exists {
                    return Err(format!(
                        "Committed removal evidence is incomplete for {}",
                        artifact.destination
                    ));
                }
            }
        }
        if backup_exists {
            validate_owned_backup(&backup, true, artifact)?;
        } else if artifact.had_destination && !terminal_exists {
            return Err(format!(
                "Committed backup disappeared before terminal outcome for {}",
                artifact.destination
            ));
        }
        if !artifact.had_destination && backup_exists {
            return Err(format!(
                "Unexpected committed backup for {}",
                artifact.destination
            ));
        }
        return Ok(());
    }

    match artifact.phase {
        ArtifactPhase::Planned
        | ArtifactPhase::ReservationIntent
        | ArtifactPhase::CandidateReserved
        | ArtifactPhase::PopulationIntent
        | ArtifactPhase::CandidateReady => {
            if backup_exists {
                return Err(format!(
                    "Prepared artifact has an unexpected backup for {}",
                    artifact.destination
                ));
            }
            validate_prior_destination(&destination, destination_exists, artifact)
        }
        ArtifactPhase::BackupIntent => {
            if artifact.had_destination {
                if destination_exists == backup_exists {
                    return Err(format!(
                        "Backup intent has ambiguous old-state evidence for {}",
                        artifact.destination
                    ));
                }
                if destination_exists {
                    validate_prior_destination(&destination, true, artifact)
                } else {
                    validate_owned_backup(&backup, true, artifact)
                }
            } else if destination_exists || backup_exists {
                Err(format!(
                    "Backup intent conflicts with prior absence for {}",
                    artifact.destination
                ))
            } else {
                Ok(())
            }
        }
        ArtifactPhase::BackedUp => {
            if destination_exists {
                return Err(format!(
                    "Backed-up destination unexpectedly exists for {}",
                    artifact.destination
                ));
            }
            validate_owned_backup(&backup, backup_exists, artifact)
        }
        ArtifactPhase::InstallIntent => {
            validate_owned_backup(&backup, backup_exists, artifact)?;
            if artifact.role != ArtifactRole::Replacement {
                return Err("Removal artifact cannot have install intent".to_string());
            }
            let candidate = safe_join(
                root,
                artifact.candidate.as_deref().expect("validated candidate"),
            )?;
            let payload_exists = path_exists(&candidate_payload(&candidate))?;
            match (payload_exists, destination_exists) {
                (true, false) => Ok(()),
                (false, true) => require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Install-intent destination",
                ),
                _ => Err(format!(
                    "Install intent has ambiguous candidate/destination evidence for {}",
                    artifact.destination
                )),
            }
        }
        ArtifactPhase::Installed => {
            validate_owned_backup(&backup, backup_exists, artifact)?;
            match artifact.role {
                ArtifactRole::Replacement if destination_exists => require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Installed destination",
                ),
                ArtifactRole::Replacement => Err(format!(
                    "Installed replacement evidence is incomplete for {}",
                    artifact.destination
                )),
                ArtifactRole::Removal if !destination_exists => Ok(()),
                ArtifactRole::Removal => Err(format!(
                    "Installed removal evidence is incomplete for {}",
                    artifact.destination
                )),
            }
        }
        ArtifactPhase::RollbackIntent => {
            if backup_exists {
                validate_owned_backup(&backup, true, artifact)?;
                if destination_exists {
                    if artifact.role != ArtifactRole::Replacement {
                        return Err(
                            "Removal rollback has conflicting destination and backup".to_string()
                        );
                    }
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Rollback installed destination",
                    )?;
                }
                Ok(())
            } else if artifact.had_destination {
                validate_prior_destination(&destination, destination_exists, artifact)
            } else if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    artifact.candidate_fingerprint.as_deref(),
                    "Rollback destination pending removal",
                )
            } else {
                Ok(())
            }
        }
        ArtifactPhase::RolledBack => {
            if backup_exists {
                return Err(format!(
                    "Rolled-back artifact retains a backup for {}",
                    artifact.destination
                ));
            }
            validate_prior_destination(&destination, destination_exists, artifact)
        }
    }
}

fn validate_recovery_preflight(root: &Path, journal: &RelocationJournal) -> Result<(), String> {
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
            return Err(format!(
                "Terminal outcome conflicts with subject journal state for {}",
                subject.subject
            ));
        }
        for artifact in &subject.artifacts {
            validate_recovery_artifact(
                root,
                artifact,
                subject.phase == SubjectPhase::Committed,
                terminal.is_some(),
            )?;
        }
    }

    let destination = safe_join(root, &journal.dataset.destination)?;
    let candidate = candidate_record_path(root, &journal.dataset.candidate)?;
    let destination_exists = path_exists(&destination)?;
    let candidate_exists = path_exists(&candidate)?;
    validate_dataset_candidate_for_phase(root, &journal.dataset)?;
    match journal.dataset.phase {
        DatasetPhase::NotRequired => {
            if journal.dataset.source_present || candidate_exists {
                return Err("Not-required dataset artifact has unexpected evidence".to_string());
            }
        }
        DatasetPhase::Planned => {
            if !journal.dataset.source_present
                || journal.dataset.destination_existed
                || destination_exists
                || candidate_exists
            {
                return Err("Planned dataset artifact has inconsistent evidence".to_string());
            }
        }
        DatasetPhase::ReservationIntent => {
            if destination_exists {
                return Err("Dataset destination appeared before installation".to_string());
            }
        }
        DatasetPhase::CandidateReserved | DatasetPhase::PopulationIntent => {
            if destination_exists || !candidate_exists {
                return Err("Prepared dataset reservation has incomplete evidence".to_string());
            }
        }
        DatasetPhase::CandidateReady => {
            if destination_exists || !candidate_exists {
                return Err("Prepared dataset artifact has incomplete evidence".to_string());
            }
        }
        DatasetPhase::InstallIntent => {
            if !candidate_exists {
                return Err("Dataset install intent lost its candidate wrapper".to_string());
            }
            let payload_exists = path_exists(&candidate_payload(&candidate))?;
            match (payload_exists, destination_exists) {
                (true, false) => {}
                (false, true) => require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Installed dataset description",
                )?,
                // A concurrent create may win no-replace while our payload remains.
                (true, true) => {}
                (false, false) => {
                    return Err("Dataset install evidence is missing".to_string());
                }
            }
        }
        DatasetPhase::Installed => {
            if !destination_exists {
                return Err("Installed dataset evidence is incomplete".to_string());
            }
            require_owned_fingerprint(
                &destination,
                journal.dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
        }
        DatasetPhase::ExistingWon => {
            if !destination_exists {
                return Err("Concurrent dataset winner evidence is incomplete".to_string());
            }
        }
        DatasetPhase::RollbackIntent => {
            if destination_exists {
                require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Dataset destination pending rollback",
                )?;
            }
        }
        DatasetPhase::RolledBack => {
            if (!journal.dataset.candidate_abandoned && candidate_exists) || destination_exists {
                return Err("Rolled-back dataset evidence is inconsistent".to_string());
            }
        }
    }
    Ok(())
}

fn preserve_ambiguous_reservation_wrappers(
    root: &Path,
    journal: &mut RelocationJournal,
    summary: &mut RelocationRecoverySummary,
) -> Result<(), String> {
    let mut changed = false;
    for subject in &mut journal.subjects {
        for artifact in &mut subject.artifacts {
            if artifact.candidate_abandoned {
                summary.cleanup_errors.push(format!(
                    "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
                    artifact.candidate.as_deref().unwrap_or("unknown")
                ));
                continue;
            }
            if artifact.phase != ArtifactPhase::ReservationIntent {
                continue;
            }
            let Some(candidate_relative) = artifact.candidate.as_deref() else {
                continue;
            };
            let candidate = candidate_record_path(root, candidate_relative)?;
            if path_exists(&candidate)? {
                artifact.candidate_abandoned = true;
                artifact.phase = ArtifactPhase::RollbackIntent;
                summary.cleanup_errors.push(format!(
                    "Preserved ambiguous reservation wrapper {candidate_relative}; manual cleanup may be required"
                ));
                changed = true;
            }
        }
    }
    if journal.dataset.candidate_abandoned {
        summary.cleanup_errors.push(format!(
            "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
            journal.dataset.candidate
        ));
    }
    if journal.dataset.phase == DatasetPhase::ReservationIntent {
        let candidate = candidate_record_path(root, &journal.dataset.candidate)?;
        if path_exists(&candidate)? {
            journal.dataset.candidate_abandoned = true;
            journal.dataset.phase = DatasetPhase::RollbackIntent;
            summary.cleanup_errors.push(format!(
                "Preserved ambiguous reservation wrapper {}; manual cleanup may be required",
                journal.dataset.candidate
            ));
            changed = true;
        }
    }
    if changed {
        write_journal(root, journal)?;
    }
    Ok(())
}

pub fn recover(project_root: &Path) -> Result<RelocationRecoverySummary, String> {
    let root = canonical_project_root(project_root)?;
    let Some(mut journal) = read_journal(&root)? else {
        return Ok(RelocationRecoverySummary::default());
    };
    // Preflight every record and all actual evidence before first mutation.
    validate_recovery_preflight(&root, &journal)?;
    let mut summary = RelocationRecoverySummary::default();
    preserve_ambiguous_reservation_wrappers(&root, &mut journal, &mut summary)?;
    for index in 0..journal.subjects.len() {
        let subject = journal.subjects[index].subject.clone();
        if journal.subjects[index].phase == SubjectPhase::Committed {
            summary.preserved_subjects.push(subject.clone());
        } else {
            rollback_subject(&root, &mut journal, index)?;
            summary.restored_subjects.push(subject.clone());
        }
    }
    if dataset_should_remain(&journal) {
        if journal.dataset.phase == DatasetPhase::InstallIntent {
            let destination = safe_join(&root, &journal.dataset.destination)?;
            let candidate = candidate_record_path(&root, &journal.dataset.candidate)?;
            let payload = candidate_payload(&candidate);
            if path_exists(&payload)? && !path_exists(&destination)? {
                rename_no_replace(&payload, &destination)
                    .map_err(|error| format!("Failed to resume dataset installation: {error}"))?;
                sync_payload_rename(&candidate, &destination)?;
                require_owned_fingerprint(
                    &destination,
                    journal.dataset.fingerprint.as_deref(),
                    "Recovered dataset destination",
                )?;
                journal.dataset.phase = DatasetPhase::Installed;
                write_journal(&root, &journal)?;
            } else if !path_exists(&payload)? && path_exists(&destination)? {
                journal.dataset.phase = DatasetPhase::Installed;
                write_journal(&root, &journal)?;
            } else if path_exists(&payload)? && path_exists(&destination)? {
                journal.dataset.phase = DatasetPhase::ExistingWon;
                write_journal(&root, &journal)?;
                remove_candidate_wrapper(
                    &candidate,
                    journal.dataset.reservation_token.as_deref(),
                    journal.dataset.fingerprint.as_deref(),
                    false,
                )?;
            }
        }
    } else {
        rollback_dataset(&root, &mut journal)?;
    }
    if journal.terminal_outcome.is_none() {
        let subjects = journal
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
            .collect();
        journal.terminal_outcome = Some(RelocationOutcome {
            plan_id: journal.plan_id.clone(),
            generation: journal.generation,
            subjects,
            staging_cleanup_complete: false,
        });
        write_journal(&root, &journal)?;
    }
    match cleanup_after_terminal(&root, &mut journal) {
        Ok(()) => {
            for subject in &journal.subjects {
                if subject
                    .artifacts
                    .iter()
                    .all(|artifact| !artifact.candidate_abandoned)
                {
                    summary.cleaned_subjects.push(subject.subject.clone());
                }
            }
            if let Err(error) = remove_journal_owned(&root, &journal) {
                summary
                    .cleanup_errors
                    .push(format!("Failed to remove relocation journal: {error}"));
            }
        }
        Err(error) => summary
            .cleanup_errors
            .push(format!("Relocation cleanup remains pending: {error}")),
    }
    Ok(summary)
}

#[cfg(test)]
pub fn transaction_test_fingerprint(path: &Path) -> Result<String, String> {
    tree_fingerprint(path)
}

#[cfg(test)]
mod relocation_tests;

#[cfg(test)]
mod journal_tests {
    use super::*;
    use tempfile::tempdir;

    fn planned_journal(root: &Path) -> RelocationJournal {
        RelocationJournal {
            version: JOURNAL_VERSION,
            project_identity: project_identity(root),
            generation: 7,
            plan_id: "plan".to_string(),
            plan_fingerprint: "first".to_string(),
            dataset: JournalDataset {
                source_present: false,
                destination_existed: false,
                destination: "rawdata/dataset_description.json".to_string(),
                candidate: "rawdata/.dataset_description.json.easl-relocation-plan-run-candidate"
                    .to_string(),
                phase: DatasetPhase::NotRequired,
                fingerprint: None,
                reservation_token: None,
                candidate_abandoned: false,
            },
            subjects: vec![JournalSubject {
                subject: "A".to_string(),
                phase: SubjectPhase::Planned,
                artifacts: vec![JournalArtifact {
                    role: ArtifactRole::Replacement,
                    destination: "rawdata/sub-A".to_string(),
                    candidate: Some("rawdata/.sub-A.easl-relocation-plan-A-candidate".to_string()),
                    backup: Some("rawdata/.sub-A.easl-relocation-plan-A-backup".to_string()),
                    had_destination: false,
                    phase: ArtifactPhase::Planned,
                    candidate_fingerprint: None,
                    backup_fingerprint: None,
                    reservation_token: None,
                    candidate_abandoned: false,
                }],
            }],
            terminal_outcome: None,
        }
    }

    #[test]
    fn journal_v2_replacement_is_atomic_and_keeps_run_ownership() {
        let workspace = tempdir().expect("workspace");
        let root = workspace.path();
        let mut journal = planned_journal(root);
        write_journal(root, &journal).expect("initial journal");
        journal.plan_fingerprint = "second".to_string();
        write_journal(root, &journal).expect("atomic replacement");

        let stored = read_journal(root).expect("read").expect("journal");
        assert_eq!(stored.version, 2);
        assert_eq!(stored.generation, 7);
        assert_eq!(stored.plan_id, "plan");
        assert_eq!(stored.plan_fingerprint, "second");
        assert!(!journal_temp_path(root, &journal).exists());
    }

    #[test]
    fn journal_rejects_foreign_run_and_escaping_or_mismatched_paths() {
        let workspace = tempdir().expect("workspace");
        let root = workspace.path();
        let mut journal = planned_journal(root);
        journal.project_identity = "foreign".to_string();
        assert!(validate_journal(root, &journal).is_err());

        let mut escaping = planned_journal(root);
        escaping.subjects[0].artifacts[0].destination = "../outside".to_string();
        assert!(validate_journal(root, &escaping).is_err());

        let mut mismatched = planned_journal(root);
        mismatched.subjects[0].artifacts[0].backup =
            Some("rawdata/.sub-B.easl-relocation-plan-B-backup".to_string());
        assert!(validate_journal(root, &mismatched).is_err());
    }

    #[test]
    fn exact_stale_next_journal_temp_name_cannot_block_persistence() {
        let workspace = tempdir().expect("workspace");
        let root = workspace.path();
        let journal = planned_journal(root);
        let stale = journal_temp_path(root, &journal);
        fs::write(&stale, b"foreign stale temp").expect("stale temp");

        write_journal(root, &journal).expect("fresh unique journal temp");

        assert_eq!(fs::read(&stale).unwrap(), b"foreign stale temp");
        assert!(journal_path(root).exists());
    }

    #[cfg(unix)]
    #[test]
    fn candidate_parent_creation_rejects_nested_symlink_ancestor_without_external_mutation() {
        use std::os::unix::fs::symlink;

        let workspace = tempdir().expect("workspace");
        let root = workspace.path().join("project");
        let external = workspace.path().join("external");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&external).unwrap();
        symlink(&external, root.join("derivatives")).unwrap();
        let candidate = root.join("derivatives/ExploreASL/log/.candidate");

        assert!(reserve_candidate(&root, &candidate, "owned-token").is_err());
        assert!(!external.join("ExploreASL").exists());
    }
}
