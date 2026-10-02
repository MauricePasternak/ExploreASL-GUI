//! Read-only BIDS setup planning and the dedicated fixed-path setup transaction.
//! This module intentionally does not use import-relocation semantics.
use crate::fs_safety::{atomic_replace, sync_directory};
use crate::project_ownership::ActiveProject;
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;

#[cfg(test)]
use std::cell::RefCell;

pub const RAWDATA_MARKER_PATH: &str = "rawdata/.easl-gui-managed";
pub const RAWDATA_MARKER_BYTES: &[u8] = b"{\"kind\":\"bids-direct-rawdata\",\"version\":1}\n";
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
const PLAN_TTL: Duration = Duration::from_secs(15 * 60);
const JOURNAL_VERSION: u32 = 1;
const REGISTRY_VERSION: u32 = 1;
const REGISTRY_FILE: &str = "pending-bids-setup-transactions.json";
const JOURNAL_PREFIX: &str = ".easl-gui-setup-";

/// Deterministic transaction fault points. Compiled into tests only; production
/// code has no environment-variable or renderer-controlled failure path.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupFault {
    RegistryWrite,
    JournalWrite,
    CandidateCreate,
    CandidateWrite,
    CandidateFlush,
    CandidateVerify,
    RawdataCreate,
    IntentRecord,
    RawdataIntent,
    CandidateIntent,
    BackupIntent,
    InstallIntent,
    BackupRename,
    Install,
    MarkerInstall,
    IgnoreInstall,
    ProjectInstall,
    ParentFlush,
    RootFlush,
    TerminalRecord,
    Cleanup,
}
#[cfg(test)]
thread_local! { static SETUP_FAULT: RefCell<Option<SetupFault>> = const { RefCell::new(None) }; }
// Test-only commit observation. It records visibility at each successful file
// installation without adding an externally controllable production hook.
#[cfg(test)]
thread_local! {
    static SETUP_INSTALL_OBSERVATIONS: RefCell<Vec<(String, bool)>> = const { RefCell::new(Vec::new()) };
}
#[cfg(test)]
pub struct SetupFaultGuard;
#[cfg(test)]
impl Drop for SetupFaultGuard {
    fn drop(&mut self) {
        SETUP_FAULT.with(|fault| *fault.borrow_mut() = None);
    }
}
#[cfg(test)]
pub fn inject_setup_fault(fault: SetupFault) -> SetupFaultGuard {
    SETUP_FAULT.with(|active| *active.borrow_mut() = Some(fault));
    SetupFaultGuard
}
#[cfg(test)]
fn take_install_observations() -> Vec<(String, bool)> {
    SETUP_INSTALL_OBSERVATIONS.with(|observations| std::mem::take(&mut *observations.borrow_mut()))
}
fn observe_install(_destination: &Path) {
    #[cfg(test)]
    SETUP_INSTALL_OBSERVATIONS.with(|observations| {
        let project_visible = _destination
            .parent()
            .is_some_and(|parent| parent.join("project.easl").is_file());
        observations.borrow_mut().push((
            _destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned(),
            project_visible,
        ));
    });
}
fn fail(_fault: &str) -> Result<()> {
    #[cfg(test)]
    {
        let selected = match _fault {
            "registry" => SetupFault::RegistryWrite,
            "journal" => SetupFault::JournalWrite,
            "candidate-create" => SetupFault::CandidateCreate,
            "candidate-write" => SetupFault::CandidateWrite,
            "candidate-flush" => SetupFault::CandidateFlush,
            "candidate-verify" => SetupFault::CandidateVerify,
            "rawdata-create" => SetupFault::RawdataCreate,
            "intent" => SetupFault::IntentRecord,
            "rawdata-intent" => SetupFault::RawdataIntent,
            "candidate-intent" => SetupFault::CandidateIntent,
            "backup-intent" => SetupFault::BackupIntent,
            "install-intent" => SetupFault::InstallIntent,
            "backup" => SetupFault::BackupRename,
            "install" => SetupFault::Install,
            "install-marker" => SetupFault::MarkerInstall,
            "install-ignore" => SetupFault::IgnoreInstall,
            "install-project" => SetupFault::ProjectInstall,
            "flush" => SetupFault::ParentFlush,
            "root-flush" => SetupFault::RootFlush,
            "terminal" => SetupFault::TerminalRecord,
            "cleanup" => SetupFault::Cleanup,
            _ => return Ok(()),
        };
        let hit = SETUP_FAULT.with(|active| {
            let mut active = active.borrow_mut();
            if *active == Some(selected) {
                active.take();
                true
            } else {
                false
            }
        });
        if hit {
            bail!("Injected setup failure at {_fault}");
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SetupMode {
    Bids,
    Dicom,
    Repair,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Create,
    Update,
    NoOp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupOperation {
    pub path: String,
    pub operation: OperationKind,
    pub text_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub schema_version: String,
    pub name: String,
    pub project_id: String,
    pub data_source: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupPlan {
    pub plan_id: String,
    pub root_path: String,
    pub mode: SetupMode,
    pub operations: Vec<SetupOperation>,
    pub warnings: Vec<String>,
    pub conflicts: Vec<String>,
    pub project_summary: Option<ProjectSummary>,
    pub preserves_readme: bool,
    pub temporary_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupCommitResult {
    pub outcome: String,
    pub project_path: Option<String>,
    pub canonical_project_bytes: Option<String>,
    pub directory_sync_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetupRecoverySummary {
    pub recovered: usize,
    pub deferred_roots: Vec<String>,
    pub blocked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SetupCommandError {
    #[error("{message}")]
    Stale { message: String },
    #[error("{message}")]
    Conflict { message: String },
    #[error("{message}")]
    Rollback { message: String },
    #[error("{message}")]
    UncertainDurability { message: String },
    #[error("{message}")]
    RecoveryRequired { message: String },
    #[error("{message}")]
    Failed { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
enum EntryKind {
    Missing,
    File,
    Directory,
    Symlink,
    Other,
}

/// Classification of the only file owned by BIDS-direct setup.  Keep this
/// separate from the planner so callers cannot mistake an arbitrary marker
/// name for GUI ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerClassification {
    Absent,
    Exact,
    Foreign,
    Unsafe,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fingerprint {
    kind: EntryKind,
    hash: Option<String>,
    len: Option<u64>,
}

#[derive(Debug, Clone)]
struct CachedPlan {
    displayed: SetupPlan,
    root: PathBuf,
    mode: SetupMode,
    project_bytes: Option<Vec<u8>>,
    marker_bytes: Option<Vec<u8>>,
    ignore_bytes: Option<Vec<u8>>,
    observations: BTreeMap<String, Fingerprint>,
    created: SystemTime,
    claimed: bool,
    result: Option<SetupCommitResult>,
    terminal_failure: Option<String>,
}
#[derive(Default)]
pub struct SetupPlans(Mutex<BTreeMap<String, CachedPlan>>);

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn random_id(label: &str) -> String {
    format!("{label}-{}", uuid::Uuid::new_v4())
}

fn canonical_root(root: &Path) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(root).context("Could not inspect selected project root")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("Selected project root must be a real directory");
    }
    root.canonicalize()
        .context("Could not canonicalize selected project root")
}

/// Fixed paths never accept a renderer or journal-controlled traversal component.
fn safe_relative(relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        bail!("Unsafe project-relative setup path");
    }
    Ok(path.to_path_buf())
}
fn fixed_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let rel = safe_relative(relative)?;
    if !matches!(
        relative,
        "project.easl" | ".bidsignore" | "rawdata" | RAWDATA_MARKER_PATH
    ) {
        bail!("Unsupported setup path");
    }
    Ok(root.join(rel))
}

/// Verify every existing component below `root` immediately before a fixed
/// path is opened or renamed. `symlink_metadata` intentionally does not
/// follow a replacement symlink. This cannot make path names atomic on every
/// platform, but paired with no-follow file opens and post-mutation checks it
/// fails closed on observable swaps.
fn validate_fixed_hierarchy(root: &Path, path: &Path) -> Result<()> {
    let root_meta = fs::symlink_metadata(root)
        .with_context(|| format!("Could not inspect setup root {}", root.display()))?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        bail!("Setup root changed or is unsafe");
    }
    let relative = path.strip_prefix(root).context("Setup path escaped root")?;
    let mut current = root.to_path_buf();
    let parts = relative.components().collect::<Vec<_>>();
    for component in parts.iter().take(parts.len().saturating_sub(1)) {
        let Component::Normal(name) = component else {
            bail!("Unsafe project-relative setup path");
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current)
            .with_context(|| format!("Could not inspect setup parent {}", current.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            bail!("Setup parent changed or is unsafe: {}", current.display());
        }
    }
    Ok(())
}

fn open_regular_no_follow(path: &Path) -> Result<File> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Could not inspect {}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("{} must be a regular non-symlink file", path.display());
    }
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Setup file has no parent"))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        bail!("Setup file parent is unsafe: {}", parent.display());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    // OPEN_REPARSE_POINT opens the link itself on Windows. The metadata check
    // below therefore rejects it instead of reading its target.
    #[cfg(windows)]
    options.custom_flags(0x0020_0000);
    let file = options
        .open(path)
        .with_context(|| format!("Could not read {} without following links", path.display()))?;
    let opened = file.metadata()?;
    if !opened.is_file() {
        bail!(
            "{} changed to a non-regular file while opening",
            path.display()
        );
    }
    let after = fs::symlink_metadata(path)?;
    if after.file_type().is_symlink() || !after.is_file() || after.len() != opened.len() {
        bail!("{} changed while opening", path.display());
    }
    Ok(file)
}

fn read_bounded(path: &Path, expected: u64) -> Result<Vec<u8>> {
    if expected > MAX_TEXT_BYTES {
        bail!(
            "{} exceeds the {} byte inspection limit",
            path.display(),
            MAX_TEXT_BYTES
        );
    }
    let mut file = open_regular_no_follow(path)?;
    let mut bytes = Vec::with_capacity(expected as usize);
    Read::by_ref(&mut file)
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        bail!("{} exceeds inspection limit", path.display());
    }
    Ok(bytes)
}
fn inspect(path: &Path, read_bytes: bool) -> Result<Fingerprint> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if matches!(error.kind(), io::ErrorKind::NotFound) => {
            return Ok(Fingerprint {
                kind: EntryKind::Missing,
                hash: None,
                len: None,
            });
        }
        Err(error) if matches!(error.kind(), io::ErrorKind::NotADirectory) => {
            return Ok(Fingerprint {
                kind: EntryKind::Missing,
                hash: None,
                len: None,
            });
        }
        Err(error) => {
            return Err(error).with_context(|| format!("Could not inspect {}", path.display()));
        }
    };
    let kind = if metadata.file_type().is_symlink() {
        EntryKind::Symlink
    } else if metadata.is_file() {
        EntryKind::File
    } else if metadata.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::Other
    };
    if read_bytes && kind == EntryKind::File {
        // A too-large controlled text file is a planning conflict. Preserve a
        // metadata-only observation so preflight can report it without reading
        // or changing it.
        if metadata.len() > MAX_TEXT_BYTES {
            return Ok(Fingerprint {
                kind,
                hash: None,
                len: Some(metadata.len()),
            });
        }
        let bytes = read_bounded(path, metadata.len())?;
        return Ok(Fingerprint {
            kind,
            hash: Some(hash(&bytes)),
            len: Some(bytes.len() as u64),
        });
    }
    Ok(Fingerprint {
        kind,
        hash: None,
        len: Some(metadata.len()),
    })
}
fn read_regular(path: &Path) -> Result<Option<Vec<u8>>> {
    match inspect(path, true)? {
        Fingerprint {
            kind: EntryKind::Missing,
            ..
        } => Ok(None),
        Fingerprint {
            kind: EntryKind::File,
            len: Some(len),
            ..
        } => Ok(Some(read_bounded(path, len)?)),
        Fingerprint {
            kind: EntryKind::Symlink,
            ..
        } => bail!("{} must not be a symbolic link", path.display()),
        _ => bail!("{} must be a regular file", path.display()),
    }
}

pub fn classify_marker(root: &Path) -> Result<MarkerClassification> {
    let root = canonical_root(root)?;
    let rawdata = fixed_path(&root, "rawdata")?;
    match inspect(&rawdata, false)?.kind {
        EntryKind::Missing => return Ok(MarkerClassification::Absent),
        EntryKind::Directory => validate_fixed_hierarchy(&root, &rawdata)?,
        _ => return Ok(MarkerClassification::Unsafe),
    }
    let marker = fixed_path(&root, RAWDATA_MARKER_PATH)?;
    match read_regular(&marker) {
        Ok(None) => Ok(MarkerClassification::Absent),
        Ok(Some(bytes)) if bytes == RAWDATA_MARKER_BYTES => Ok(MarkerClassification::Exact),
        Ok(Some(_)) => Ok(MarkerClassification::Foreign),
        Err(_) => Ok(MarkerClassification::Unsafe),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnorePlan {
    pub operation: OperationKind,
    pub bytes: Vec<u8>,
}
pub fn plan_bidsignore(existing: Option<&[u8]>, mode: SetupMode) -> Result<IgnorePlan> {
    let required: &[&str] = match mode {
        SetupMode::Bids | SetupMode::Repair => &["project.easl", ".easl_staging", "rawdata/"],
        SetupMode::Dicom => &["project.easl", ".easl_staging"],
    };
    let Some(existing) = existing else {
        let mut bytes = required.join("\n").into_bytes();
        bytes.push(b'\n');
        return Ok(IgnorePlan {
            operation: OperationKind::Create,
            bytes,
        });
    };
    let text =
        std::str::from_utf8(existing).map_err(|_| anyhow!(".bidsignore is not valid UTF-8"))?;
    let present: BTreeSet<&str> = text
        .split('\n')
        .map(|line| line.trim().trim_end_matches('\r').trim())
        .collect();
    let missing: Vec<_> = required
        .iter()
        .copied()
        .filter(|entry| !present.contains(entry))
        .collect();
    if missing.is_empty() {
        return Ok(IgnorePlan {
            operation: OperationKind::NoOp,
            bytes: existing.to_vec(),
        });
    }
    let newline = match text.as_bytes().windows(2).position(|pair| pair == b"\r\n") {
        Some(_) => b"\r\n".as_slice(),
        None => b"\n".as_slice(),
    };
    let mut bytes = existing.to_vec();
    // A bare CR is part of an unfinished separator: finish it, do not add CRLF.
    if bytes.ends_with(b"\r") {
        bytes.push(b'\n');
    } else if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        bytes.extend_from_slice(newline);
    }
    for entry in missing {
        bytes.extend_from_slice(entry.as_bytes());
        bytes.extend_from_slice(newline);
    }
    Ok(IgnorePlan {
        operation: OperationKind::Update,
        bytes,
    })
}

fn json_object<'a>(
    value: &'a serde_json::Value,
    name: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>> {
    value
        .as_object()
        .ok_or_else(|| anyhow!("Project payload {name} must be an object"))
}
fn required_string(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<String> {
    object
        .get(name)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Project payload has invalid or missing {name}"))
}
fn no_unknown(
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
    name: &str,
) -> Result<()> {
    if let Some(field) = object
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        bail!("Project payload {name} contains non-canonical field {field}");
    }
    Ok(())
}
fn required_value<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<&'a serde_json::Value> {
    object
        .get(name)
        .ok_or_else(|| anyhow!("Project payload has no {name}"))
}
fn optional_string(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        value
            .as_str()
            .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?;
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn optional_bool(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        if !value.is_boolean() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn optional_number(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<()> {
    if let Some(value) = object.get(name) {
        if !value.is_number() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
fn optional_array<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<Option<&'a Vec<serde_json::Value>>> {
    object
        .get(name)
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {name}"))
        })
        .transpose()
}
fn string_array(value: &serde_json::Value, name: &str) -> Result<()> {
    for entry in value
        .as_array()
        .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?
    {
        if !entry.is_string() {
            bail!("Project payload has invalid {name}");
        }
    }
    Ok(())
}
fn stored_path(value: &serde_json::Value, name: &str) -> Result<()> {
    let path = value
        .as_str()
        .ok_or_else(|| anyhow!("Project payload has invalid {name}"))?;
    // Mirrors hasParentTraversal: absolute paths are allowed for external
    // DICOM sources; only relative values may not contain a parent segment.
    let absolute = path.starts_with('/')
        || (path.len() >= 3
            && path.as_bytes()[1] == b':'
            && matches!(path.as_bytes()[2], b'/' | b'\\'))
        || path.starts_with("//")
        || path.starts_with("\\\\");
    if !absolute && path.replace('\\', "/").split('/').any(|part| part == "..") {
        bail!("Project payload {name} escapes its root");
    }
    Ok(())
}
fn datetime(value: &str, name: &str) -> Result<()> {
    // Zod's datetime() default accepts RFC3339 UTC timestamps, not arbitrary
    // date strings or offsets. Parsing also rejects impossible calendar dates.
    if !value.ends_with('Z') || OffsetDateTime::parse(value, &Rfc3339).is_err() {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
fn exact_object<'a>(
    value: &'a serde_json::Value,
    name: &str,
    fields: &[&str],
) -> Result<&'a serde_json::Map<String, serde_json::Value>> {
    let object = json_object(value, name)?;
    no_unknown(object, fields, name)?;
    Ok(object)
}
fn validate_token_assignment(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(value, name, &["blockIndex", "subBlockIndex", "tag"])?;
    let sub_block = required_value(object, "subBlockIndex")?;
    let valid_sub_block = sub_block.is_null() || sub_block.as_i64().is_some_and(|value| value >= 0);
    if required_value(object, "blockIndex")?
        .as_i64()
        .filter(|value| *value >= 0)
        .is_none()
        || !valid_sub_block
        || !matches!(
            required_value(object, "tag")?.as_str(),
            Some("Subject" | "Session" | "Run" | "Modality" | "Ignore")
        )
    {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
fn validate_path_pattern(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(
        value,
        name,
        &[
            "signature",
            "samplePath",
            "blocks",
            "uniqueNames",
            "count",
            "depth",
        ],
    )?;
    for field in ["signature", "samplePath"] {
        required_value(object, field)?
            .as_str()
            .ok_or_else(|| anyhow!("Project payload has invalid {name}.{field}"))?;
    }
    string_array(required_value(object, "blocks")?, name)?;
    let unique = json_object(required_value(object, "uniqueNames")?, name)?;
    for values in unique.values() {
        string_array(values, name)?;
    }
    for field in ["count", "depth"] {
        if required_value(object, field)?
            .as_i64()
            .filter(|value| *value >= 1)
            .is_none()
        {
            bail!("Project payload has invalid {name}.{field}");
        }
    }
    Ok(())
}
fn validate_number_or_array(value: &serde_json::Value, name: &str, array_only: bool) -> Result<()> {
    let valid_number = value.is_number();
    let valid_array = value
        .as_array()
        .is_some_and(|entries| entries.iter().all(serde_json::Value::is_number));
    if !(valid_array || (!array_only && valid_number)) {
        bail!("Project payload has invalid {name}");
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_bids_metadata(value: &serde_json::Value, name: &str) -> Result<()> {
    // BidsAslMetadataBaseSchema is passthrough. Validate each known field and
    // retain unknown BIDS fields unchanged, matching Zod's loose contract.
    let object = json_object(value, name)?;
    for field in [
        "MagneticFieldStrength",
        "EchoTime",
        "LabelingPulseAverageGradient",
        "LabelingPulseMaximumGradient",
        "LabelingPulseAverageB1",
        "LabelingPulseDuration",
        "LabelingPulseInterval",
        "BackgroundSuppressionNumberPulses",
        "RepetitionTimePreparation",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "ArterialSpinLabelingType",
        "MRAcquisitionType",
        "PCASLType",
        "CASLType",
        "BolusCutOffTechnique",
        "PulseSequenceType",
        "Manufacturer",
        "M0Type",
        "ASLContext",
        "DatasetType",
        "LabelingType",
    ] {
        optional_string(object, field)?;
    }
    for field in [
        "BolusCutOffFlag",
        "BackgroundSuppression",
        "VascularCrushing",
    ] {
        optional_bool(object, field)?;
    }
    for field in [
        "PostLabelingDelay",
        "LabelingDuration",
        "BolusCutOffDelayTime",
        "FlipAngle",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, false)?;
        }
    }
    for field in [
        "BackgroundSuppressionPulseTime",
        "SliceTiming",
        "DummyScanPositionInASL4D",
        "RepetitionTimePreparationM0",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, true)?;
        }
    }
    if let Some(value) = object.get("M0_GMScaleFactor") {
        if value.as_f64().filter(|number| *number > 0.0).is_none() {
            bail!("Project payload has invalid M0_GMScaleFactor");
        }
    }
    if let Some(value) = object.get("ArterialSpinLabelingType") {
        if !matches!(value.as_str(), Some("CASL" | "PCASL" | "PASL")) {
            bail!("Project payload has invalid ArterialSpinLabelingType");
        }
    }
    if let Some(value) = object.get("MRAcquisitionType") {
        if !matches!(value.as_str(), Some("2D" | "3D")) {
            bail!("Project payload has invalid MRAcquisitionType");
        }
    }
    if let Some(value) = object.get("PCASLType") {
        if !matches!(value.as_str(), Some("balanced" | "unbalanced")) {
            bail!("Project payload has invalid PCASLType");
        }
    }
    if let Some(value) = object.get("CASLType") {
        if !matches!(value.as_str(), Some("single-coil" | "double-coil")) {
            bail!("Project payload has invalid CASLType");
        }
    }
    if let Some(value) = object.get("BolusCutOffTechnique") {
        if !matches!(value.as_str(), Some("Q2TIPS" | "QUIPSS" | "QUIPSSII")) {
            bail!("Project payload has invalid BolusCutOffTechnique");
        }
    }
    if let Some(value) = object.get("M0Type") {
        if !matches!(
            value.as_str(),
            Some("Separate" | "Included" | "Absent" | "Estimate")
        ) {
            bail!("Project payload has invalid M0Type");
        }
    }
    if let Some(value) = object.get("LabelingType") {
        if !matches!(value.as_str(), Some("PASL" | "CASL" | "PCASL")) {
            bail!("Project payload has invalid LabelingType");
        }
    }
    // Refinements shared by metadata grouping and imported snapshots.
    if let Some(value) = object.get("BackgroundSuppressionNumberPulses") {
        if object
            .get("BackgroundSuppression")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
            && value.as_f64().is_some_and(|number| number <= 0.0)
        {
            bail!("Project payload has invalid BackgroundSuppressionNumberPulses");
        }
    }
    for field in [
        "PostLabelingDelay",
        "BolusCutOffDelayTime",
        "LabelingDuration",
    ] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .cloned()
                .unwrap_or_else(|| vec![value.clone()]);
            if values.iter().any(|entry| {
                entry
                    .as_f64()
                    .is_none_or(|number| number != 0.0 && !(0.01..=10.0).contains(&number))
            }) {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    Ok(())
}
fn validate_mapping(mapping: &serde_json::Value) -> Result<()> {
    let object = exact_object(
        mapping,
        "mappingState",
        &[
            "sourceDataPath",
            "rawPaths",
            "pathPatterns",
            "bMatchDirectories",
            "ingestionComplete",
            "tokenizerConfigs",
            "modalityAliases",
            "sessionAliases",
            "runAliases",
            "subjectRenames",
            "metadataGroups",
            "subjectRows",
        ],
    )?;
    if let Some(value) = object.get("sourceDataPath") {
        stored_path(value, "mappingState.sourceDataPath")?;
    }
    if let Some(paths) = optional_array(object, "rawPaths")? {
        for path in paths {
            stored_path(path, "mappingState.rawPaths")?;
        }
    }
    if let Some(patterns) = optional_array(object, "pathPatterns")? {
        for value in patterns {
            validate_path_pattern(value, "mappingState.pathPatterns")?;
        }
    }
    for field in ["bMatchDirectories", "ingestionComplete"] {
        optional_bool(object, field)?;
    }
    if let Some(configs) = object.get("tokenizerConfigs") {
        for values in json_object(configs, "mappingState.tokenizerConfigs")?.values() {
            for value in values.as_array().ok_or_else(|| {
                anyhow!("Project payload has invalid mappingState.tokenizerConfigs")
            })? {
                validate_token_assignment(value, "mappingState.tokenizerConfigs")?;
            }
        }
    }
    if let Some(values) = optional_array(object, "modalityAliases")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.modalityAliases",
                &["captured", "mapped"],
            )?;
            required_string(item, "captured")?;
            let mapped = required_value(item, "mapped")?;
            if !mapped.is_null()
                && !matches!(
                    mapped.as_str(),
                    Some("T1w" | "T2w" | "ASL4D" | "M0" | "FLAIR" | "WMH_SEGM")
                )
            {
                bail!("Project payload has invalid mappingState.modalityAliases");
            }
        }
    }
    for field in ["sessionAliases", "runAliases"] {
        if let Some(values) = optional_array(object, field)? {
            for value in values {
                let item = exact_object(value, field, &["captured", "alias", "index"])?;
                required_string(item, "captured")?;
                required_string(item, "alias")?;
                if required_value(item, "index")?
                    .as_i64()
                    .filter(|number| *number >= 1)
                    .is_none()
                {
                    bail!("Project payload has invalid {field}");
                }
            }
        }
    }
    if let Some(values) = optional_array(object, "subjectRenames")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.subjectRenames",
                &["original", "target"],
            )?;
            required_string(item, "original")?;
            required_string(item, "target")?;
        }
    }
    if let Some(values) = optional_array(object, "metadataGroups")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.metadataGroups",
                &["id", "label", "bidsParams"],
            )?;
            required_string(item, "id")?;
            required_string(item, "label")?;
            validate_bids_metadata(
                required_value(item, "bidsParams")?,
                "mappingState.metadataGroups.bidsParams",
            )?;
        }
    }
    if let Some(values) = optional_array(object, "subjectRows")? {
        for value in values {
            let item = exact_object(
                value,
                "mappingState.subjectRows",
                &["id", "subject", "session", "groupId"],
            )?;
            for field in ["id", "subject", "session", "groupId"] {
                required_string(item, field)?;
            }
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_datapar(data_par: &serde_json::Value) -> Result<()> {
    // DataParSchema is loose: reject bad known values, preserve unknown keys.
    let object = json_object(data_par, "dataPar")?;
    for field in [
        "BackgroundSuppressionNumberPulses",
        "M0_GMScaleFactor",
        "nCompartments",
        "Lambda",
        "T2art",
        "T1blood",
        "T1GM",
        "T1WM",
        "T2GM",
        "T2WM",
        "T2tissueMultiTE",
        "ATTSDBASIL",
        "SpikeRemovalThreshold",
        "SpikeRemovalAbsoluteThreshold",
        "bRegistrationContrast",
        "bAffineRegistration",
        "bDCTRegistration",
        "bHct2BloodT1",
        "MinimalROIVolume",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "bUseExternalQuantification",
        "bMaskingExternal",
        "bSpatialBASIL",
        "bInferT1BASIL",
        "bInferATTBASIL",
        "bCleanUpExternal",
        "enableMetadataGroupingCorrection",
        "bTopUp",
        "bPVCGaussianMM",
        "SaveCBF4D",
        "bFixResolution",
        "bLesionFilling",
        "bAutoACPC",
        "bWMH",
        "bAutomaticallyDetectFSL",
        "bAutomaticallyDetectVABY",
    ] {
        optional_bool(object, field)?;
    }
    for field in [
        "ExternalQuantificationType",
        "ExchBASIL",
        "DispBASIL",
        "WMHsegmAlg",
    ] {
        optional_string(object, field)?;
    }
    for field in [
        "bRegisterM02ASL",
        "M0_conventionalProcessing",
        "Quality",
        "DELETETEMP",
        "SkipIfNoFlair",
        "SkipIfNoASL",
        "SkipIfNoM0",
        "motionCorrection",
        "bPVCNativeSpace",
        "bUseMNIasDummyStructural",
        "bRunLongReg",
        "bRunDARTEL",
        "bSegmentSPM12",
        "bHammersCAT12",
    ] {
        if let Some(value) = object.get(field) {
            if !matches!(value.as_i64(), Some(0 | 1)) {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    for field in [
        "BackgroundSuppressionPulseTime",
        "RepetitionTimePreparationM0",
    ] {
        if let Some(value) = object.get(field) {
            validate_number_or_array(value, field, false)?;
        }
    }
    if let Some(value) = object.get("M0") {
        if !(value.is_number()
            || matches!(
                value.as_str(),
                Some("separate_scan" | "UseControlAsM0" | "Absent")
            ))
        {
            bail!("Project payload has invalid M0");
        }
    }
    for field in ["ApplyQuantification", "TissueThreshold"] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {field}"))?;
            let expected = field == "ApplyQuantification" && values.len() != 6;
            if expected
                || values.iter().any(|entry| {
                    entry
                        .as_f64()
                        .is_none_or(|number| !(0.0..=1.0).contains(&number))
                })
            {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    for field in [
        "PVCNativeSpaceKernel",
        "ExternalQuantificationSmoothGaussianMM",
    ] {
        if let Some(value) = object.get(field) {
            let values = value
                .as_array()
                .ok_or_else(|| anyhow!("Project payload has invalid {field}"))?;
            if values.len() != 3
                || values.iter().any(|entry| {
                    !entry.is_number()
                        || (field == "ExternalQuantificationSmoothGaussianMM"
                            && entry.as_i64().is_none())
                })
            {
                bail!("Project payload has invalid {field}");
            }
        }
    }
    if let Some(value) = object.get("bMasking") {
        let values = value
            .as_array()
            .ok_or_else(|| anyhow!("Project payload has invalid bMasking"))?;
        if values.len() != 4
            || values
                .iter()
                .any(|entry| !matches!(entry.as_i64(), Some(0 | 1)))
        {
            bail!("Project payload has invalid bMasking");
        }
    }
    for field in ["Atlases", "TissueMasking", "DataTypes"] {
        if let Some(value) = object.get(field) {
            string_array(value, field)?;
        }
    }
    Ok(())
}
fn validate_snapshot(encoded: &str) -> Result<()> {
    let compressed = BASE64
        .decode(encoded)
        .context("Project payload has invalid compressed snapshot encoding")?;
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .context("Project payload has invalid compressed snapshot")?;
    let snapshot: serde_json::Value = serde_json::from_str(&json)
        .context("Project payload has invalid compressed snapshot JSON")?;
    let object = exact_object(
        &snapshot,
        "compressed snapshot",
        &[
            "sourceDataPath",
            "pathPatterns",
            "tokenizerConfigs",
            "bMatchDirectories",
            "modalityAliases",
            "sessionAliases",
            "runAliases",
            "subjectRenames",
            "metadataGroups",
            "subjectRows",
            "selectedProfileId",
        ],
    )?;
    stored_path(
        required_value(object, "sourceDataPath")?,
        "compressed snapshot.sourceDataPath",
    )?;
    validate_mapping(&serde_json::json!({
        "sourceDataPath": required_value(object, "sourceDataPath")?, "pathPatterns": required_value(object, "pathPatterns")?, "tokenizerConfigs": required_value(object, "tokenizerConfigs")?, "bMatchDirectories": required_value(object, "bMatchDirectories")?, "modalityAliases": required_value(object, "modalityAliases")?, "sessionAliases": required_value(object, "sessionAliases")?, "runAliases": required_value(object, "runAliases")?, "subjectRenames": required_value(object, "subjectRenames")?, "metadataGroups": required_value(object, "metadataGroups")?, "subjectRows": required_value(object, "subjectRows")?
    }))?;
    optional_string(object, "selectedProfileId")
}
#[allow(clippy::collapsible_if)]
fn validate_last_run(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(
        value,
        name,
        &[
            "profileId",
            "exploreASLVersion",
            "matlabVersion",
            "guiVersion",
            "Mtime",
        ],
    )?;
    required_string(object, "profileId")?;
    for field in ["exploreASLVersion", "matlabVersion", "guiVersion"] {
        optional_string(object, field)?;
    }
    if let Some(value) = object.get("Mtime") {
        if !(value.is_null() || value.as_i64().is_some()) {
            bail!("Project payload has invalid {name}.Mtime");
        }
    }
    Ok(())
}
#[allow(clippy::collapsible_if)]
fn validate_manifest_verdict(value: &serde_json::Value, name: &str) -> Result<()> {
    let object = exact_object(value, name, &["status", "reason", "notes", "setAt"])?;
    let status = required_string(object, "status")?;
    if !matches!(status.as_str(), "pass" | "fail") {
        bail!("Project payload has invalid {name}.status");
    }
    if status == "fail" && object.get("reason").is_none() {
        bail!("Project payload {name}.reason is required for failure");
    }
    if let Some(value) = object.get("reason") {
        if !matches!(
            value.as_str(),
            Some("motion" | "coverage" | "dropout" | "artifact" | "registration" | "other")
        ) {
            bail!("Project payload has invalid {name}.reason");
        }
    }
    if let Some(value) = object.get("notes") {
        if value.as_str().filter(|notes| notes.len() <= 500).is_none() {
            bail!("Project payload has invalid {name}.notes");
        }
    }
    if required_value(object, "setAt")?.as_i64().is_none() {
        bail!("Project payload has invalid {name}.setAt");
    }
    Ok(())
}
fn validate_data_vis(value: &serde_json::Value) -> Result<()> {
    // `dataVis` is loose, but its declared fields must retain the same types
    // as ProjectFileSchema. Unknown extensions are deliberately preserved.
    let object = json_object(value, "uiState.dataVis")?;
    if let Some(value) = object.get("qcbfSource")
        && !value.is_null()
    {
        let source = exact_object(
            value,
            "uiState.dataVis.qcbfSource",
            &["relativePath", "fileHash"],
        )?;
        stored_path(
            required_value(source, "relativePath")?,
            "uiState.dataVis.qcbfSource.relativePath",
        )?;
        required_string(source, "fileHash")?;
    }
    if let Some(value) = object.get("joinConfig")
        && !value.is_null()
    {
        let join = exact_object(
            value,
            "uiState.dataVis.joinConfig",
            &[
                "externalSource",
                "keys",
                "dropRightOn",
                "naTokens",
                "delimiter",
            ],
        )?;
        let source = exact_object(
            required_value(join, "externalSource")?,
            "uiState.dataVis.joinConfig.externalSource",
            &["absolutePath", "fileHash", "sheetName"],
        )?;
        required_string(source, "absolutePath")?;
        required_string(source, "fileHash")?;
        if !required_value(source, "sheetName")?.is_null()
            && !required_value(source, "sheetName")?.is_string()
        {
            bail!(
                "Project payload has invalid uiState.dataVis.joinConfig.externalSource.sheetName"
            );
        }
        for key in required_value(join, "keys")?
            .as_array()
            .ok_or_else(|| anyhow!("Project payload has invalid uiState.dataVis.joinConfig.keys"))?
        {
            let key = exact_object(key, "uiState.dataVis.joinConfig.keys", &["left", "right"])?;
            required_string(key, "left")?;
            required_string(key, "right")?;
        }
        if !required_value(join, "dropRightOn")?.is_boolean() {
            bail!("Project payload has invalid uiState.dataVis.joinConfig.dropRightOn");
        }
        string_array(
            required_value(join, "naTokens")?,
            "uiState.dataVis.joinConfig.naTokens",
        )?;
        required_string(join, "delimiter")?;
    }
    for field in ["columnTypes"] {
        if let Some(value) = object.get(field)
            && !json_object(value, "uiState.dataVis.columnTypes")?
                .values()
                .all(serde_json::Value::is_string)
        {
            bail!("Project payload has invalid uiState.dataVis.{field}");
        }
    }
    if let Some(value) = object.get("identifiers")
        && !value.is_null()
    {
        let identifiers = exact_object(
            value,
            "uiState.dataVis.identifiers",
            &["subject", "session", "run"],
        )?;
        for field in ["subject", "session", "run"] {
            required_string(identifiers, field)?;
        }
    }
    if let Some(value) = object.get("levelOrderings") {
        for value in json_object(value, "uiState.dataVis.levelOrderings")?.values() {
            string_array(value, "uiState.dataVis.levelOrderings")?;
        }
    }
    if let Some(value) = object.get("axisAssignment") {
        let axis = exact_object(
            value,
            "uiState.dataVis.axisAssignment",
            &["x", "y", "colorBy"],
        )?;
        for field in ["x", "y", "colorBy"] {
            if let Some(value) = axis.get(field)
                && !value.is_null()
                && !value.is_string()
            {
                bail!("Project payload has invalid uiState.dataVis.axisAssignment.{field}");
            }
        }
    }
    if let Some(value) = object.get("domainFilters") {
        let domain = exact_object(
            value,
            "uiState.dataVis.domainFilters",
            &["xMin", "xMax", "yMin", "yMax"],
        )?;
        for field in ["xMin", "xMax", "yMin", "yMax"] {
            if let Some(value) = domain.get(field)
                && !value.is_null()
                && !value.is_number()
            {
                bail!("Project payload has invalid uiState.dataVis.domainFilters.{field}");
            }
        }
    }
    optional_string(object, "stage")?;
    for field in [
        "splitRatio",
        "pointSize",
        "swarmSpacing",
        "chartOpacity",
        "xTickSize",
        "xTickPadding",
        "xTickRotation",
        "xLegendOffset",
        "yTickSize",
        "yTickPadding",
        "yTickRotation",
        "yLegendOffset",
    ] {
        optional_number(object, field)?;
    }
    for field in [
        "filtersExpanded",
        "showGridX",
        "showGridY",
        "nvRadiological",
        "nvColorbar",
        "nvCrosshair",
        "nvCornerOrientation",
    ] {
        optional_bool(object, field)?;
    }
    for field in ["nvColormap", "nvSliceType", "nvBackColor"] {
        optional_string(object, field)?;
    }
    for field in ["xLegendOverride", "yLegendOverride"] {
        if let Some(value) = object.get(field)
            && !value.is_null()
            && !value.is_string()
        {
            bail!("Project payload has invalid uiState.dataVis.{field}");
        }
    }
    Ok(())
}
fn validate_flat_verdicts(value: &serde_json::Value, name: &str) -> Result<()> {
    for verdict in json_object(value, name)?.values() {
        validate_manifest_verdict(verdict, name)?;
    }
    Ok(())
}
fn validate_ui_state(ui_state: &serde_json::Map<String, serde_json::Value>) -> Result<()> {
    optional_bool(ui_state, "navbarCollapsed")?;
    if let Some(import) = ui_state.get("import") {
        let import = exact_object(
            import,
            "uiState.import",
            &[
                "activeStep",
                "completed",
                "bidsReviewConfirmed",
                "skippedSubjects",
                "selectedProfileId",
                "currentPhase",
                "mostRecentConfig",
            ],
        )?;
        if let Some(value) = import.get("activeStep")
            && value.as_i64().filter(|number| *number >= 0).is_none()
        {
            bail!("Project payload has invalid uiState.import.activeStep");
        }
        optional_bool(import, "completed")?;
        optional_bool(import, "bidsReviewConfirmed")?;
        optional_string(import, "selectedProfileId")?;
        if let Some(value) = import.get("skippedSubjects") {
            string_array(value, "uiState.import.skippedSubjects")?;
        }
        if let Some(value) = import.get("currentPhase")
            && !matches!(
                value.as_str(),
                Some("idle" | "preparing" | "running" | "completed" | "failed" | "cancelled")
            )
        {
            bail!("Project payload has invalid uiState.import.currentPhase");
        }
        if let Some(value) = import.get("mostRecentConfig")
            && !value.is_null()
        {
            validate_snapshot(value.as_str().ok_or_else(|| {
                anyhow!("Project payload has invalid uiState.import.mostRecentConfig")
            })?)?;
        }
    }
    if let Some(processing) = ui_state.get("processing") {
        let processing = exact_object(
            processing,
            "uiState.processing",
            &["config", "currentPhase", "structural", "asl", "population"],
        )?;
        if let Some(config) = processing.get("config") {
            let config = exact_object(
                config,
                "uiState.processing.config",
                &[
                    "subjects",
                    "modules",
                    "selectedProfileId",
                    "workers",
                    "rerunBids2Legacy",
                ],
            )?;
            string_array(
                required_value(config, "subjects")?,
                "uiState.processing.config.subjects",
            )?;
            for module in required_value(config, "modules")?
                .as_array()
                .ok_or_else(|| {
                    anyhow!("Project payload has invalid uiState.processing.config.modules")
                })?
            {
                if !matches!(module.as_str(), Some("structural" | "asl" | "population")) {
                    bail!("Project payload has invalid uiState.processing.config.modules");
                }
            }
            required_string(config, "selectedProfileId")?;
            if required_value(config, "workers")?
                .as_i64()
                .filter(|number| *number >= 1)
                .is_none()
            {
                bail!("Project payload has invalid uiState.processing.config.workers");
            }
            optional_bool(config, "rerunBids2Legacy")?;
        }
        if let Some(value) = processing.get("currentPhase")
            && !matches!(
                value.as_str(),
                Some(
                    "idle"
                        | "preparing"
                        | "running"
                        | "finalizing"
                        | "cancelling"
                        | "completed"
                        | "failed"
                        | "cancelled"
                        | "interrupted"
                )
            )
        {
            bail!("Project payload has invalid uiState.processing.currentPhase");
        }
        for module in ["structural", "asl", "population"] {
            if let Some(value) = processing.get(module) {
                let item = exact_object(
                    value,
                    "uiState.processing.module",
                    &["completed", "lastRun"],
                )?;
                optional_bool(item, "completed")?;
                if let Some(last_run) = item.get("lastRun") {
                    validate_last_run(last_run, "uiState.processing.lastRun")?;
                }
            }
        }
    }
    if let Some(datapar) = ui_state.get("datapar") {
        let datapar = exact_object(datapar, "uiState.datapar", &["advancedVisibility"])?;
        if let Some(visibility) = datapar.get("advancedVisibility") {
            let visibility = exact_object(
                visibility,
                "uiState.datapar.advancedVisibility",
                &[
                    "showAdvancedSections",
                    "showAdvancedM0Params",
                    "showAdvancedQuantification",
                    "showAdvancedGeneralSettings",
                    "showAdvancedASLProcessing",
                    "showAdvancedAtlases",
                ],
            )?;
            for field in [
                "showAdvancedSections",
                "showAdvancedM0Params",
                "showAdvancedQuantification",
                "showAdvancedGeneralSettings",
                "showAdvancedASLProcessing",
                "showAdvancedAtlases",
            ] {
                optional_bool(visibility, field)?;
            }
        }
    }
    if let Some(data_vis) = ui_state.get("dataVis") {
        validate_data_vis(data_vis)?;
    }
    if let Some(manifest) = ui_state.get("manifest") {
        let manifest = exact_object(
            manifest,
            "uiState.manifest",
            &[
                "reviewers",
                "activeReviewerId",
                "verdicts",
                "resolvedVerdicts",
                "lastRunVersions",
                "lastPopulationRunMtime",
            ],
        )?;
        let reviewer_count = if let Some(reviewers) = optional_array(manifest, "reviewers")? {
            if reviewers.len() > 5 {
                bail!("Project payload has too many manifest reviewers");
            }
            for reviewer in reviewers {
                let reviewer = exact_object(
                    reviewer,
                    "uiState.manifest.reviewers",
                    &["id", "label", "createdAt"],
                )?;
                let id = required_string(reviewer, "id")?;
                uuid::Uuid::parse_str(&id)?;
                if required_string(reviewer, "label")?.len() > 100
                    || required_string(reviewer, "label")?.is_empty()
                {
                    bail!("Project payload has invalid reviewer label");
                }
                datetime(
                    &required_string(reviewer, "createdAt")?,
                    "reviewer.createdAt",
                )?;
            }
            reviewers.len()
        } else {
            0
        };
        if let Some(value) = manifest.get("activeReviewerId") {
            uuid::Uuid::parse_str(value.as_str().ok_or_else(|| {
                anyhow!("Project payload has invalid uiState.manifest.activeReviewerId")
            })?)?;
        }
        if let Some(verdicts) = manifest.get("verdicts") {
            let values = json_object(verdicts, "uiState.manifest.verdicts")?;
            let nested = values.values().all(|value| {
                value
                    .as_object()
                    .is_some_and(|object| !object.contains_key("status"))
            });
            if reviewer_count >= 2 {
                if !nested {
                    bail!("Project payload multi-reviewer verdicts must be nested");
                }
                for (reviewer, verdicts) in values {
                    uuid::Uuid::parse_str(reviewer)?;
                    validate_flat_verdicts(verdicts, "uiState.manifest.verdicts")?;
                }
            } else {
                if nested {
                    bail!("Project payload single-reviewer verdicts must be flat");
                }
                validate_flat_verdicts(verdicts, "uiState.manifest.verdicts")?;
            }
        }
        if let Some(value) = manifest.get("resolvedVerdicts") {
            validate_flat_verdicts(value, "uiState.manifest.resolvedVerdicts")?;
        }
        if let Some(value) = manifest.get("lastRunVersions") {
            let versions = exact_object(
                value,
                "uiState.manifest.lastRunVersions",
                &["exploreASL", "matlab", "gui"],
            )?;
            for field in ["exploreASL", "matlab", "gui"] {
                optional_string(versions, field)?;
            }
        }
        if let Some(value) = manifest.get("lastPopulationRunMtime")
            && !(value.is_null() || value.is_number())
        {
            bail!("Project payload has invalid uiState.manifest.lastPopulationRunMtime");
        }
    }
    Ok(())
}
/// Native boundary validation for the persisted v1 envelope. Renderer bytes
/// are accepted only if they are the exact recursively-sorted, two-space JSON
/// emitted by serializeProject and satisfy every non-loose persisted schema.
#[allow(clippy::collapsible_if)]
fn validate_canonical_project_v1(value: &serde_json::Value) -> Result<ProjectSummary> {
    let root = json_object(value, "envelope")?;
    no_unknown(
        root,
        &[
            "schemaVersion",
            "projectMeta",
            "uiState",
            "mappingState",
            "dataPar",
        ],
        "envelope",
    )?;
    if root
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        bail!("Project payload must use canonical schema version 1");
    }
    let meta_value = root
        .get("projectMeta")
        .ok_or_else(|| anyhow!("Project payload has no projectMeta"))?;
    let meta = json_object(meta_value, "projectMeta")?;
    no_unknown(
        meta,
        &[
            "id",
            "name",
            "createdAt",
            "lastOpened",
            "currentPhase",
            "dataSource",
        ],
        "projectMeta",
    )?;
    let id = required_string(meta, "id")?;
    let name = required_string(meta, "name")?;
    required_string(meta, "createdAt")?;
    required_string(meta, "lastOpened")?;
    let phase = required_string(meta, "currentPhase")?;
    if ![
        "import",
        "parameters",
        "processing",
        "visualization",
        "manifest",
    ]
    .contains(&phase.as_str())
    {
        bail!("Project payload has invalid projectMeta.currentPhase");
    }
    let data_source = required_string(meta, "dataSource")?;
    if !["bids", "dicom"].contains(&data_source.as_str()) {
        bail!("Project payload has invalid projectMeta.dataSource");
    }
    let ui_state = root
        .get("uiState")
        .ok_or_else(|| anyhow!("Project payload has no uiState"))?;
    // ProjectFileSchema deliberately uses `.passthrough()` for uiState; known
    // descendants remain validated while future top-level UI data survives.
    let ui_state = json_object(ui_state, "uiState")?;
    validate_ui_state(ui_state)?;
    let mapping = root
        .get("mappingState")
        .ok_or_else(|| anyhow!("Project payload has no mappingState"))?;
    validate_mapping(mapping)?;
    let data_par = root
        .get("dataPar")
        .ok_or_else(|| anyhow!("Project payload has no dataPar"))?;
    validate_datapar(data_par)?;
    Ok(ProjectSummary {
        schema_version: "1".into(),
        name,
        project_id: id,
        data_source,
        content_hash: String::new(),
    })
}
fn parse_summary(bytes: &[u8]) -> Result<ProjectSummary> {
    let input = std::str::from_utf8(bytes).context("Project payload is not UTF-8")?;
    let value: serde_json::Value =
        serde_json::from_slice(bytes).context("Project payload is not valid JSON")?;
    let canonical =
        serde_json::to_string_pretty(&value).context("Could not canonicalize project payload")?;
    if input != canonical {
        bail!(
            "Project payload must use exact canonical two-space JSON bytes without a trailing newline"
        );
    }
    let mut summary = validate_canonical_project_v1(&value)?;
    summary.content_hash = hash(bytes);
    Ok(summary)
}
fn preview(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec()).ok()
}
fn observe_fixed(root: &Path, mode: SetupMode) -> Result<BTreeMap<String, Fingerprint>> {
    let paths: &[&str] = match mode {
        SetupMode::Dicom => &["project.easl", ".bidsignore"],
        // `project.easl` determines whether repair is authorized. It is not an
        // operation, but it must be observed and revalidated so a BIDS repair
        // plan cannot be applied after the project becomes a different kind of
        // project (or is replaced by an unsafe entry).
        SetupMode::Repair => &[
            "project.easl",
            ".bidsignore",
            "rawdata",
            RAWDATA_MARKER_PATH,
        ],
        SetupMode::Bids => &[
            "project.easl",
            ".bidsignore",
            "rawdata",
            RAWDATA_MARKER_PATH,
        ],
    };
    paths
        .iter()
        .map(|path| {
            Ok((
                (*path).to_owned(),
                inspect(&fixed_path(root, path)?, *path != "rawdata")?,
            ))
        })
        .collect()
}
fn rawdata_subject_count(root: &Path) -> Result<usize> {
    let rawdata = fixed_path(root, "rawdata")?;
    let mut count = 0;
    for item in fs::read_dir(rawdata).context("Could not read rawdata directory")? {
        let item = item?;
        let ty = item.file_type()?;
        if ty.is_dir() && !ty.is_symlink() && item.file_name().to_string_lossy().starts_with("sub-")
        {
            count += 1;
        }
    }
    Ok(count)
}
fn preflight(root: &Path, mode: SetupMode, project_bytes: Option<Vec<u8>>) -> Result<CachedPlan> {
    let root = canonical_root(root)?;
    if mode == SetupMode::Repair && project_bytes.is_some() {
        bail!("Repair must not replace project.easl");
    }
    if mode == SetupMode::Repair {
        let project_path = fixed_path(&root, "project.easl")?;
        let project_bytes = read_regular(&project_path)?
            .ok_or_else(|| anyhow!("BIDS setup repair requires an existing project.easl"))?;
        let summary = parse_summary(&project_bytes)?;
        if summary.data_source != "bids" {
            bail!("BIDS setup repair requires a BIDS-direct project");
        }
    }
    let summary = project_bytes.as_deref().map(parse_summary).transpose()?;
    if mode != SetupMode::Repair && summary.is_none() {
        bail!("Project payload is required for setup");
    }
    if let Some(summary) = &summary {
        let wanted = if mode == SetupMode::Bids {
            "bids"
        } else {
            "dicom"
        };
        if summary.data_source != wanted {
            bail!("Project data source does not match selected setup mode");
        }
    }
    let observations = observe_fixed(&root, mode)?;
    let mut operations = Vec::new();
    let mut warnings = Vec::new();
    let mut conflicts = Vec::new();
    if mode != SetupMode::Repair {
        let project = &observations["project.easl"];
        let operation = if project.kind == EntryKind::Missing {
            OperationKind::Create
        } else {
            conflicts
                .push("project.easl already exists or is not a safe replacement target".into());
            OperationKind::NoOp
        };
        operations.push(SetupOperation {
            path: "project.easl".into(),
            operation,
            text_preview: None,
        });
    }
    let ignore_existing = match read_regular(&fixed_path(&root, ".bidsignore")?) {
        Ok(value) => value,
        Err(error) => {
            conflicts.push(error.to_string());
            None
        }
    };
    let ignore_plan = match plan_bidsignore(ignore_existing.as_deref(), mode) {
        Ok(plan) => Some(plan),
        Err(error) => {
            conflicts.push(error.to_string());
            None
        }
    };
    if let Some(plan) = &ignore_plan {
        operations.push(SetupOperation {
            path: ".bidsignore".into(),
            operation: plan.operation,
            text_preview: (plan.operation != OperationKind::NoOp)
                .then(|| preview(&plan.bytes))
                .flatten(),
        });
    }
    let mut marker_bytes = None;
    if matches!(mode, SetupMode::Bids | SetupMode::Repair) {
        match observations["rawdata"].kind {
            EntryKind::Missing => operations.push(SetupOperation {
                path: "rawdata/".into(),
                operation: OperationKind::Create,
                text_preview: None,
            }),
            EntryKind::Directory => {
                operations.push(SetupOperation {
                    path: "rawdata/".into(),
                    operation: OperationKind::NoOp,
                    text_preview: None,
                });
                let count = rawdata_subject_count(&root)?;
                if count > 0 {
                    warnings.push(format!("rawdata/ contains {count} sub-* directories; BIDS-direct processing ignores them."));
                }
            }
            _ => conflicts.push("rawdata must be a directory, not a symlink or file".into()),
        }
        if !matches!(
            observations["rawdata"].kind,
            EntryKind::Missing | EntryKind::Directory
        ) {
            operations.push(SetupOperation {
                path: RAWDATA_MARKER_PATH.into(),
                operation: OperationKind::NoOp,
                text_preview: None,
            });
        } else {
            match classify_marker(&root)? {
                MarkerClassification::Absent => {
                    marker_bytes = Some(RAWDATA_MARKER_BYTES.to_vec());
                    operations.push(SetupOperation {
                        path: RAWDATA_MARKER_PATH.into(),
                        operation: OperationKind::Create,
                        text_preview: preview(RAWDATA_MARKER_BYTES),
                    });
                }
                MarkerClassification::Exact => operations.push(SetupOperation {
                    path: RAWDATA_MARKER_PATH.into(),
                    operation: OperationKind::NoOp,
                    text_preview: None,
                }),
                MarkerClassification::Foreign => {
                    conflicts.push("rawdata/.easl-gui-managed is not this GUI's marker".into())
                }
                MarkerClassification::Unsafe => conflicts
                    .push("rawdata/.easl-gui-managed must be a regular non-symlink file".into()),
            }
        }
    }
    let displayed = SetupPlan { plan_id: random_id("setup"), root_path: root.to_string_lossy().into_owned(), mode, operations, warnings, conflicts, project_summary: summary, preserves_readme: true, temporary_artifacts: vec!["Same-parent candidates, validated backups, a root journal, and an app-data pending registry are removed after commit or recovery.".into()] };
    Ok(CachedPlan {
        displayed,
        root,
        mode,
        project_bytes,
        marker_bytes,
        ignore_bytes: ignore_plan
            .and_then(|p| (p.operation != OperationKind::NoOp).then_some(p.bytes)),
        observations,
        created: SystemTime::now(),
        claimed: false,
        result: None,
        terminal_failure: None,
    })
}
fn check_fresh(plan: &CachedPlan) -> Result<()> {
    if plan
        .created
        .elapsed()
        .unwrap_or(PLAN_TTL + Duration::from_secs(1))
        > PLAN_TTL
    {
        bail!("Setup plan expired; review a fresh plan");
    }
    if canonical_root(&plan.root)? != plan.root {
        bail!("Project root changed after preflight");
    }
    for path in plan.observations.keys() {
        let path = fixed_path(&plan.root, path)?;
        // A missing final component is valid; each existing parent must still
        // be a real directory rather than a swapped link.
        if path.parent().is_some_and(|parent| parent.exists()) {
            validate_fixed_hierarchy(&plan.root, &path)?;
        }
    }
    if observe_fixed(&plan.root, plan.mode)? != plan.observations {
        bail!("Setup plan is stale; controlled paths changed after review");
    }
    if !plan.displayed.conflicts.is_empty() {
        bail!("Setup plan contains blocking conflicts");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TransactionPhase {
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
enum OperationPhase {
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
struct JournalOperation {
    destination: String,
    kind: OperationKind,
    phase: OperationPhase,
    before: Fingerprint,
    after: Option<Fingerprint>,
    candidate: Option<String>,
    backup: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetupJournal {
    version: u32,
    transaction_id: String,
    journal_id: String,
    registry_id: String,
    root: String,
    mode: SetupMode,
    phase: TransactionPhase,
    operations: Vec<JournalOperation>,
    directory_phase: OperationPhase,
    terminal: Option<SetupCommitResult>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingEntry {
    registry_id: String,
    transaction_id: String,
    journal_id: String,
    root: String,
    journal_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingRegistry {
    version: u32,
    entries: Vec<PendingEntry>,
}

fn journal_name(id: &str) -> String {
    format!("{JOURNAL_PREFIX}{id}.json")
}
fn journal_path(root: &Path, journal_id: &str) -> PathBuf {
    root.join(journal_name(journal_id))
}
fn registry_path(app_data: &Path) -> PathBuf {
    app_data.join(REGISTRY_FILE)
}
fn valid_identity(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .is_some()
}
fn sync_parent(path: &Path) -> Result<bool> {
    fail("flush")?;
    sync_directory(path)
        .map(|outcome| outcome.is_supported())
        .with_context(|| format!("Could not synchronize directory {}", path.display()))
}
fn persist_bytes(path: &Path, bytes: &[u8], replace: bool) -> Result<bool> {
    let parent = path.parent().ok_or_else(|| anyhow!("Path has no parent"))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Could not create app-data directory {}", parent.display()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|x| x.to_str()).unwrap_or("setup"),
        random_id("write")
    ));
    let result = (|| -> Result<bool> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if replace && fs::symlink_metadata(path).is_ok() {
            atomic_replace(&temporary, path)?;
        } else {
            fs::rename(&temporary, path)?;
        }
        sync_parent(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
fn persist_new_bytes(path: &Path, bytes: &[u8]) -> Result<bool> {
    let parent = path.parent().ok_or_else(|| anyhow!("Path has no parent"))?;
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = (|| -> Result<bool> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        sync_parent(parent)
    })();
    if result.is_err() && fs::read(path).ok().as_deref() == Some(bytes) {
        let _ = fs::remove_file(path);
    }
    result
}
fn load_registry(app_data: &Path) -> Result<PendingRegistry> {
    let path = registry_path(app_data);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(PendingRegistry {
            version: REGISTRY_VERSION,
            entries: vec![],
        }),
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            bail!("Setup pending registry must be a regular file")
        }
        Ok(_) => {
            serde_json::from_slice(&fs::read(&path)?).context("Malformed setup pending registry")
        }
        Err(error) => Err(error.into()),
    }
}
fn save_registry(app_data: &Path, registry: &PendingRegistry) -> Result<()> {
    if registry.version != REGISTRY_VERSION {
        bail!("Unsupported setup registry version");
    }
    let path = registry_path(app_data);
    let bytes = serde_json::to_vec(registry)?;
    match fs::symlink_metadata(&path) {
        // Initial global ownership must not replace a pre-existing registry.
        // Every later update is a durable same-parent replacement rather than
        // an in-place truncate/write.
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            persist_new_bytes(&path, &bytes).map(|_| ())
        }
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
            persist_bytes(&path, &bytes, true).map(|_| ())
        }
        Ok(_) => bail!("Setup pending registry must be a regular file"),
        Err(error) => Err(error.into()),
    }
}
fn register_pending(app_data: &Path, entry: PendingEntry) -> Result<()> {
    let mut registry = load_registry(app_data)?;
    if registry.entries.iter().any(|old| {
        old.registry_id == entry.registry_id
            || old.transaction_id == entry.transaction_id
            || old.journal_id == entry.journal_id
    }) {
        bail!("Setup transaction identity collision");
    }
    fail("registry")?;
    registry.entries.push(entry);
    save_registry(app_data, &registry)
}
fn remove_pending(app_data: &Path, registry_id: &str) -> Result<()> {
    let mut registry = load_registry(app_data)?;
    registry
        .entries
        .retain(|entry| entry.registry_id != registry_id);
    save_registry(app_data, &registry)
}
fn validate_registry_entry(entry: &PendingEntry) -> Result<()> {
    if !valid_identity(&entry.registry_id, "registry-")
        || !valid_identity(&entry.transaction_id, "transaction-")
        || !valid_identity(&entry.journal_id, "journal-")
        || !Path::new(&entry.root).is_absolute()
        || Path::new(&entry.root)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || entry.journal_name != journal_name(&entry.journal_id)
    {
        bail!("Malformed setup pending registry entry");
    }
    Ok(())
}
fn journal_bytes(journal: &SetupJournal) -> Result<Vec<u8>> {
    serde_json::to_vec(journal).context("Could not serialize setup journal")
}
fn validate_journal(root: &Path, journal: &SetupJournal) -> Result<()> {
    if journal.version != JOURNAL_VERSION
        || journal.root != root.to_string_lossy()
        || !valid_identity(&journal.transaction_id, "transaction-")
        || !valid_identity(&journal.journal_id, "journal-")
        || !valid_identity(&journal.registry_id, "registry-")
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
fn write_journal(root: &Path, journal: &SetupJournal) -> Result<bool> {
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
                || current.registry_id != journal.registry_id
            {
                bail!("Setup journal ownership identity collision");
            }
            persist_bytes(&path, &bytes, true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => persist_new_bytes(&path, &bytes),
        Err(error) => Err(error.into()),
    }
}
fn read_journal(root: &Path, journal_id: &str) -> Result<SetupJournal> {
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
fn remove_owned_journal(root: &Path, journal: &SetupJournal) -> Result<()> {
    let path = journal_path(root, &journal.journal_id);
    let current = read_journal(root, &journal.journal_id)?;
    if current.transaction_id != journal.transaction_id || current.terminal.is_none() {
        bail!("Refusing to remove nonterminal setup journal");
    }
    fs::remove_file(path)?;
    sync_parent(root).map(|_| ())
}
fn owned_sibling(
    destination: &Path,
    transaction: &str,
    role: &str,
    suffix: &str,
) -> Result<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Setup destination has no parent"))?;
    let name = destination
        .file_name()
        .and_then(|x| x.to_str())
        .ok_or_else(|| anyhow!("Setup destination has invalid filename"))?;
    if !transaction.starts_with("transaction-") || !suffix.chars().all(|x| x.is_ascii_digit()) {
        bail!("Invalid setup owned path identity");
    }
    Ok(parent.join(format!(".{name}.easl-setup-{transaction}-{role}-{suffix}")))
}
fn relative_to_root(root: &Path, path: &Path) -> Result<String> {
    path.strip_prefix(root)
        .context("Setup path escaped root")?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Setup path is not UTF-8"))
}
fn create_candidate(
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
fn initial_journal(
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
fn persist_phase(root: &Path, journal: &mut SetupJournal, phase: TransactionPhase) -> Result<()> {
    journal.phase = phase;
    write_journal(root, journal).map(|_| ())
}
fn update_operation(
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
fn bytes_for<'a>(plan: &'a CachedPlan, destination: &str) -> Option<&'a [u8]> {
    match destination {
        RAWDATA_MARKER_PATH => plan.marker_bytes.as_deref(),
        ".bidsignore" => plan.ignore_bytes.as_deref(),
        "project.easl" => plan.project_bytes.as_deref(),
        _ => None,
    }
}
fn backup_for(
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
/// Locate an unrecorded owned sibling only by its random transaction identity
/// and expected fingerprint. This covers a crash after the mutation but before
/// its completion journal write; a filename alone is never accepted.
fn find_owned_sibling(
    destination: &Path,
    transaction: &str,
    role: &str,
    expected: &Fingerprint,
) -> Result<Option<PathBuf>> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Setup destination has no parent"))?;
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("Setup destination has invalid filename"))?;
    let prefix = format!(".{name}.easl-setup-{transaction}-{role}-");
    let mut matches = Vec::new();
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        // A candidate/backup under a directory that was never created cannot
        // exist. This is the normal rollback state after an interruption
        // before rawdata creation, not ambiguous ownership.
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let path = entry.path();
        if inspect(&path, true)? == *expected {
            matches.push(path);
        } else {
            bail!("Transaction-owned setup sibling has ambiguous content");
        }
    }
    if matches.len() > 1 {
        bail!("Multiple transaction-owned setup siblings are ambiguous");
    }
    Ok(matches.pop())
}
fn rollback(root: &Path, journal: &mut SetupJournal) -> Result<()> {
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
fn cleanup_terminal(root: &Path, journal: &SetupJournal, app_data: &Path) -> Result<()> {
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
fn commit_plan(plan: &CachedPlan, app_data: &Path) -> Result<SetupCommitResult> {
    check_fresh(plan)?;
    fs::create_dir_all(app_data).context("Could not create platform app-data directory")?;
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    let registry_id = random_id("registry");
    let entry = PendingEntry {
        registry_id: registry_id.clone(),
        transaction_id: transaction_id.clone(),
        journal_id: journal_id.clone(),
        root: plan.root.to_string_lossy().into_owned(),
        journal_name: journal_name(&journal_id),
    };
    validate_registry_entry(&entry)?;
    register_pending(app_data, entry)?; // durable global intent precedes every root mutation.
    let mut journal = initial_journal(plan, transaction_id, journal_id, registry_id)?;
    if let Err(error) = write_journal(&plan.root, &journal) {
        return Err(error.context("Setup recovery required: pending registry remains"));
    }
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
            canonical_project_bytes: plan
                .project_bytes
                .as_ref()
                .and_then(|bytes| String::from_utf8(bytes.clone()).ok()),
            directory_sync_supported: durable,
        };
        journal.phase = TransactionPhase::Committed;
        journal.terminal = Some(result.clone());
        write_journal(&plan.root, &journal)?;
        Ok(result)
    })();
    match attempt {
        Ok(result) => {
            if let Err(error) = cleanup_terminal(&plan.root, &journal, app_data) {
                log::warn!("Setup committed; deferred terminal cleanup: {error:#}");
            }
            Ok(result)
        }
        Err(error) => match rollback(&plan.root, &mut journal) {
            Ok(()) => {
                let _ = cleanup_terminal(&plan.root, &journal, app_data);
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

pub fn preflight_for_state(
    plans: &SetupPlans,
    root: String,
    mode: SetupMode,
    project_bytes: Option<String>,
) -> Result<SetupPlan> {
    let cached = preflight(
        Path::new(&root),
        mode,
        project_bytes.map(String::into_bytes),
    )?;
    let displayed = cached.displayed.clone();
    let mut cache = plans
        .0
        .lock()
        .map_err(|_| anyhow!("Setup plan cache unavailable"))?;
    // A new plan for a root supersedes uncommitted plans for every option.
    cache.retain(|_, plan| plan.root != cached.root || plan.result.is_some() || plan.claimed);
    cache.insert(displayed.plan_id.clone(), cached);
    Ok(displayed)
}
pub fn commit_for_state(
    plans: &SetupPlans,
    plan_id: &str,
    app_data: &Path,
) -> Result<SetupCommitResult> {
    commit_with_ownership(plans, plan_id, app_data, |root| {
        Ok(std::sync::Arc::new(ActiveProject::open(root)?))
    })
}
pub(crate) fn commit_for_app_state(
    state: &crate::app_state::AppState,
    plan_id: &str,
    app_data: &Path,
) -> Result<SetupCommitResult> {
    commit_with_ownership(&state.setup_plans, plan_id, app_data, |root| {
        crate::project_ownership::for_setup(state, root).map_err(anyhow::Error::msg)
    })
}
fn commit_with_ownership(
    plans: &SetupPlans,
    plan_id: &str,
    app_data: &Path,
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
    let result = commit_plan(plan, app_data);
    match &result {
        Ok(value) => plan.result = Some(value.clone()),
        Err(error) => plan.terminal_failure = Some(format!("{error:#}")),
    }
    result
}
pub fn command_error(error: anyhow::Error) -> SetupCommandError {
    let message = format!("{error:#}");
    if message.contains("stale")
        || message.contains("expired")
        || message.contains("Unknown or superseded")
    {
        SetupCommandError::Stale { message }
    } else if message.contains("conflict")
        || message.contains("must be")
        || message.contains("already exists")
    {
        SetupCommandError::Conflict { message }
    } else if message.contains("recovery required")
        || message.contains("ambiguous")
        || message.contains("recovery blocked")
    {
        SetupCommandError::RecoveryRequired { message }
    } else if message.contains("synchronize") || message.contains("durability") {
        SetupCommandError::UncertainDurability { message }
    } else if message.contains("rolled back") {
        SetupCommandError::Rollback { message }
    } else {
        SetupCommandError::Failed { message }
    }
}
pub fn verify(root: &Path) -> Result<()> {
    let root = canonical_root(root)?;
    if inspect(&fixed_path(&root, "rawdata")?, false)?.kind != EntryKind::Directory {
        bail!(
            "BIDS compatibility setup is missing rawdata/. Review setup repair before processing."
        );
    }
    let marker = read_regular(&fixed_path(&root, RAWDATA_MARKER_PATH)?)?.ok_or_else(|| {
        anyhow!("BIDS compatibility marker is missing. Review setup repair before processing.")
    })?;
    if marker != RAWDATA_MARKER_BYTES {
        bail!("BIDS compatibility marker is invalid. Review setup repair before processing.");
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/setup.rs"]
mod tests;
