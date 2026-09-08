//! Read-only BIDS setup planning and the dedicated fixed-path setup transaction.
//! This module intentionally does not use import-relocation semantics.
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
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .with_context(|| format!("Could not synchronize directory {}", path.display()))?;
        Ok(true)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(false)
    }
}
fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>()
        };
        let source = wide(source);
        let destination = wide(destination);
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, destination)
    }
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
    let mut journal = read_journal(&root, &entry.journal_id)?;
    if journal.registry_id != entry.registry_id
        || journal.transaction_id != entry.transaction_id
        || journal.journal_id != entry.journal_id
    {
        bail!("Setup registry and journal identities diverge");
    }
    if let Some(result) = &journal.terminal {
        cleanup_terminal(&root, &journal, app_data)?;
        return Ok(result.outcome == "committed");
    }
    if complete_after_state(&root, &journal)? {
        journal.phase = TransactionPhase::Committed;
        journal.terminal = Some(SetupCommitResult {
            outcome: "committed".into(),
            project_path: (journal.mode != SetupMode::Repair)
                .then(|| root.join("project.easl").to_string_lossy().into_owned()),
            canonical_project_bytes: None,
            directory_sync_supported: sync_parent(&root)?,
        });
        write_journal(&root, &journal)?;
        cleanup_terminal(&root, &journal, app_data)?;
        return Ok(true);
    }
    rollback(&root, &mut journal)?;
    cleanup_terminal(&root, &journal, app_data)?;
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
    let canonical = canonical_root(root)?;
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
        match recover_entry(app_data, &entry) {
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
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::TempDir;
    use walkdir::WalkDir;

    #[derive(Debug, PartialEq, Eq)]
    struct SourceEntry {
        kind: EntryKind,
        len: u64,
        digest: Option<String>,
    }
    fn source_snapshot(root: &Path) -> BTreeMap<PathBuf, SourceEntry> {
        WalkDir::new(root)
            .follow_links(false)
            // The selected root itself is not a source-tree entry. Its
            // directory size is filesystem-dependent and would otherwise
            // obscure the reviewed child-path delta.
            .min_depth(1)
            .into_iter()
            .map(|entry| entry.unwrap())
            .map(|entry| {
                let path = entry.path();
                let metadata = fs::symlink_metadata(path).unwrap();
                let kind = if metadata.file_type().is_symlink() {
                    EntryKind::Symlink
                } else if metadata.is_dir() {
                    EntryKind::Directory
                } else if metadata.is_file() {
                    EntryKind::File
                } else {
                    EntryKind::Other
                };
                let digest = metadata.is_file().then(|| hash(&fs::read(path).unwrap()));
                (
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    SourceEntry {
                        kind,
                        len: metadata.len(),
                        digest,
                    },
                )
            })
            .collect()
    }
    fn changed_source_paths(
        before: &BTreeMap<PathBuf, SourceEntry>,
        after: &BTreeMap<PathBuf, SourceEntry>,
    ) -> BTreeSet<String> {
        before
            .keys()
            .chain(after.keys())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|path| before.get(*path) != after.get(*path))
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect()
    }
    fn reviewed_changed_paths(plan: &SetupPlan) -> BTreeSet<String> {
        let mut paths = plan
            .operations
            .iter()
            .filter(|operation| operation.operation != OperationKind::NoOp)
            .map(|operation| operation.path.trim_end_matches('/').to_owned())
            .collect::<BTreeSet<_>>();
        // A reviewed no-op directory changes its metadata when a separately
        // reviewed child marker is installed. It remains an explicitly
        // disclosed operation path, unlike an unrelated parent directory.
        for operation in &plan.operations {
            if operation.path.ends_with('/')
                && paths.iter().any(|path| path.starts_with(&operation.path))
            {
                paths.insert(operation.path.trim_end_matches('/').to_owned());
            }
        }
        paths
    }
    fn assert_confirmed_delta(
        root: &Path,
        before: &BTreeMap<PathBuf, SourceEntry>,
        plan: &SetupPlan,
    ) {
        let after = source_snapshot(root);
        assert_eq!(
            changed_source_paths(before, &after),
            reviewed_changed_paths(plan),
            "only reviewed, confirmed operation paths may differ: {:?}",
            plan.operations
        );
        for operation in &plan.operations {
            if let Some(preview) = &operation.text_preview {
                assert_eq!(
                    fs::read(root.join(operation.path.trim_end_matches('/'))).unwrap(),
                    preview.as_bytes(),
                    "{} must equal its reviewed text preview",
                    operation.path
                );
            }
        }
        if let Some(summary) = &plan.project_summary {
            assert_eq!(
                hash(&fs::read(root.join("project.easl")).unwrap()),
                summary.content_hash,
                "project.easl must equal the reviewed project summary hash"
            );
        }
    }
    fn write_bids_fixture(root: &Path, bidsignore: Option<&[u8]>) {
        fs::write(
            root.join("dataset_description.json"),
            br#"{"Name":"Source snapshot fixture","BIDSVersion":"1.9.0"}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join("sub-01/perf")).unwrap();
        fs::write(root.join("sub-01/perf/sub-01_asl.nii.gz"), b"nii bytes").unwrap();
        fs::write(root.join("sub-01/perf/sub-01_asl.json"), b"{}").unwrap();
        fs::write(
            root.join("sub-01/perf/sub-01_aslcontext.tsv"),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
        if let Some(bytes) = bidsignore {
            fs::write(root.join(".bidsignore"), bytes).unwrap();
        }
    }
    fn project(source: &str) -> Vec<u8> {
        serde_json::to_string_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "projectMeta": {
                "id": "11111111-1111-4111-8111-111111111111",
                "name": "name",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "lastOpened": "2026-01-01T00:00:00.000Z",
                "currentPhase": "import",
                "dataSource": source,
            },
            "uiState": {},
            "mappingState": {},
            "dataPar": {},
        }))
        .unwrap()
        .into_bytes()
    }
    fn identities() -> (String, String, String) {
        (
            random_id("transaction"),
            random_id("journal"),
            random_id("registry"),
        )
    }
    fn entry_for(
        root: &Path,
        transaction_id: String,
        journal_id: String,
        registry_id: String,
    ) -> PendingEntry {
        PendingEntry {
            registry_id,
            transaction_id,
            journal_name: journal_name(&journal_id),
            journal_id,
            root: root.canonicalize().unwrap().to_string_lossy().into_owned(),
        }
    }
    #[test]
    fn marker_classification_matrix_preserves_readme_and_confines_fixed_paths() {
        let root = TempDir::new().unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Absent
        );
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/README.md"), b"user bytes").unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Absent
        );
        fs::write(root.path().join(RAWDATA_MARKER_PATH), RAWDATA_MARKER_BYTES).unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Exact
        );
        fs::write(root.path().join(RAWDATA_MARKER_PATH), b"foreign").unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Foreign
        );
        assert_eq!(
            fs::read(root.path().join("rawdata/README.md")).unwrap(),
            b"user bytes"
        );
        assert!(fixed_path(root.path(), "../rawdata/.easl-gui-managed").is_err());
        assert!(fixed_path(root.path(), "rawdata/README.md").is_err());
    }
    #[test]
    fn snapshots_prove_detection_and_all_preflight_paths_are_read_only() {
        let root = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("sub-01/perf")).unwrap();
        fs::write(root.path().join("sub-01/perf/sub-01_asl.nii.gz"), b"nii").unwrap();
        fs::write(root.path().join("sub-01/perf/sub-01_asl.json"), b"{}").unwrap();
        fs::write(
            root.path().join("sub-01/perf/sub-01_aslcontext.tsv"),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
        fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
        let before = source_snapshot(root.path());
        crate::bids::commands::check_bids_dataset_impl(root.path()).unwrap();
        let bids = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let dicom = preflight(root.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
        assert_ne!(bids.displayed.plan_id, dicom.displayed.plan_id);
        assert!(preflight(root.path(), SetupMode::Bids, Some(b"not-json".to_vec())).is_err());
        // Dropping an uncommitted plan is cancellation; it must not need cleanup.
        drop((bids, dicom));
        assert_eq!(source_snapshot(root.path()), before);
    }
    #[test]
    fn source_tree_hash_integration_matrix_covers_review_cancel_stale_failure_and_recovery() {
        // Fresh BIDS-direct: detection, preflight, commit, then read-only
        // compatibility verification. Snapshots retain relative path, entry
        // type, size, and file-content hash for every source-tree entry.
        let fresh = TempDir::new().unwrap();
        let fresh_app_data = TempDir::new().unwrap();
        write_bids_fixture(fresh.path(), None);
        let fresh_before = source_snapshot(fresh.path());
        assert!(
            crate::bids::commands::check_bids_dataset_impl(fresh.path())
                .unwrap()
                .is_bids
        );
        let fresh_plans = SetupPlans::default();
        let fresh_plan = preflight_for_state(
            &fresh_plans,
            fresh.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        assert_eq!(
            source_snapshot(fresh.path()),
            fresh_before,
            "preflight is read-only"
        );
        commit_for_state(&fresh_plans, &fresh_plan.plan_id, fresh_app_data.path()).unwrap();
        assert_confirmed_delta(fresh.path(), &fresh_before, &fresh_plan);
        let verified_before = source_snapshot(fresh.path());
        verify(fresh.path()).unwrap();
        assert_eq!(
            source_snapshot(fresh.path()),
            verified_before,
            "verification is read-only"
        );

        // DICOM-on-BIDS retains the BIDS source fixture but commits only its
        // reviewed project and ignore-file operations.
        let dicom = TempDir::new().unwrap();
        let dicom_app_data = TempDir::new().unwrap();
        write_bids_fixture(dicom.path(), None);
        let dicom_before = source_snapshot(dicom.path());
        assert!(
            crate::bids::commands::check_bids_dataset_impl(dicom.path())
                .unwrap()
                .is_bids
        );
        let dicom_plans = SetupPlans::default();
        let dicom_plan = preflight_for_state(
            &dicom_plans,
            dicom.path().display().to_string(),
            SetupMode::Dicom,
            Some(String::from_utf8(project("dicom")).unwrap()),
        )
        .unwrap();
        assert_eq!(source_snapshot(dicom.path()), dicom_before);
        commit_for_state(&dicom_plans, &dicom_plan.plan_id, dicom_app_data.path()).unwrap();
        assert_confirmed_delta(dicom.path(), &dicom_before, &dicom_plan);
        assert!(!dicom.path().join("rawdata").exists());

        // Existing rawdata and a user README survive an LF ignore-file update.
        let existing_lf = TempDir::new().unwrap();
        let existing_lf_app_data = TempDir::new().unwrap();
        write_bids_fixture(existing_lf.path(), Some(b"derivatives/\n"));
        fs::create_dir(existing_lf.path().join("rawdata")).unwrap();
        fs::write(
            existing_lf.path().join("rawdata/README.md"),
            b"user README\n",
        )
        .unwrap();
        let existing_lf_before = source_snapshot(existing_lf.path());
        let existing_lf_plans = SetupPlans::default();
        let existing_lf_plan = preflight_for_state(
            &existing_lf_plans,
            existing_lf.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        assert_eq!(source_snapshot(existing_lf.path()), existing_lf_before);
        commit_for_state(
            &existing_lf_plans,
            &existing_lf_plan.plan_id,
            existing_lf_app_data.path(),
        )
        .unwrap();
        assert_confirmed_delta(existing_lf.path(), &existing_lf_before, &existing_lf_plan);
        assert_eq!(
            fs::read(existing_lf.path().join("rawdata/README.md")).unwrap(),
            b"user README\n"
        );

        // CRLF input keeps CRLF bytes exactly as previewed.
        let crlf = TempDir::new().unwrap();
        let crlf_app_data = TempDir::new().unwrap();
        write_bids_fixture(crlf.path(), Some(b"derivatives/\r\nproject.easl\r\n"));
        let crlf_before = source_snapshot(crlf.path());
        let crlf_plans = SetupPlans::default();
        let crlf_plan = preflight_for_state(
            &crlf_plans,
            crlf.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        assert_eq!(source_snapshot(crlf.path()), crlf_before);
        commit_for_state(&crlf_plans, &crlf_plan.plan_id, crlf_app_data.path()).unwrap();
        assert_confirmed_delta(crlf.path(), &crlf_before, &crlf_plan);
        assert!(
            fs::read(crlf.path().join(".bidsignore"))
                .unwrap()
                .windows(2)
                .any(|bytes| bytes == b"\r\n")
        );

        // Scan, mode changes, malformed-project preflight, and cancellation
        // (dropping plans without confirmation) never mutate the source tree.
        let cancelled = TempDir::new().unwrap();
        write_bids_fixture(cancelled.path(), Some(b"user\n"));
        let cancelled_before = source_snapshot(cancelled.path());
        crate::bids::commands::check_bids_dataset_impl(cancelled.path()).unwrap();
        let cancelled_bids =
            preflight(cancelled.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let cancelled_dicom =
            preflight(cancelled.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
        assert!(
            preflight(
                cancelled.path(),
                SetupMode::Bids,
                Some(b"not-json".to_vec())
            )
            .is_err()
        );
        drop((cancelled_bids, cancelled_dicom));
        assert_eq!(
            source_snapshot(cancelled.path()),
            cancelled_before,
            "cancel is read-only"
        );

        // A stale plan rejects before mutation. The external edit is the
        // baseline; the rejected confirmation itself has a zero tree delta.
        let stale = TempDir::new().unwrap();
        let stale_app_data = TempDir::new().unwrap();
        write_bids_fixture(stale.path(), None);
        let stale_plans = SetupPlans::default();
        let stale_plan = preflight_for_state(
            &stale_plans,
            stale.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        fs::write(stale.path().join(".bidsignore"), b"external change\n").unwrap();
        let stale_before_commit = source_snapshot(stale.path());
        assert!(
            commit_for_state(&stale_plans, &stale_plan.plan_id, stale_app_data.path()).is_err()
        );
        assert_eq!(
            source_snapshot(stale.path()),
            stale_before_commit,
            "stale commit is read-only"
        );

        // Ordinary commit failure rolls back every owned path to the exact
        // source snapshot, including LF/CRLF-sensitive file bytes.
        let failed = TempDir::new().unwrap();
        let failed_app_data = TempDir::new().unwrap();
        write_bids_fixture(failed.path(), Some(b"before\r\n"));
        let failed_before = source_snapshot(failed.path());
        let failed_plans = SetupPlans::default();
        let failed_plan = preflight_for_state(
            &failed_plans,
            failed.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        {
            let _fault = inject_setup_fault(SetupFault::RootFlush);
            assert!(
                commit_for_state(&failed_plans, &failed_plan.plan_id, failed_app_data.path())
                    .is_err()
            );
        }
        assert_eq!(
            source_snapshot(failed.path()),
            failed_before,
            "failed commit rolls back"
        );

        // An interruption after durable commit but before terminal cleanup
        // leaves its journal. Recovery removes that evidence and settles on
        // exactly the reviewed after-state.
        let interrupted = TempDir::new().unwrap();
        let interrupted_app_data = TempDir::new().unwrap();
        write_bids_fixture(interrupted.path(), None);
        let interrupted_before = source_snapshot(interrupted.path());
        let interrupted_plans = SetupPlans::default();
        let interrupted_plan = preflight_for_state(
            &interrupted_plans,
            interrupted.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        {
            let _fault = inject_setup_fault(SetupFault::Cleanup);
            assert_eq!(
                commit_for_state(
                    &interrupted_plans,
                    &interrupted_plan.plan_id,
                    interrupted_app_data.path(),
                )
                .unwrap()
                .outcome,
                "committed"
            );
        }
        assert!(
            changed_source_paths(&interrupted_before, &source_snapshot(interrupted.path()))
                .iter()
                .any(|path| path.starts_with(JOURNAL_PREFIX))
        );
        assert_eq!(
            recover_all(interrupted_app_data.path()).unwrap().recovered,
            1
        );
        assert_confirmed_delta(interrupted.path(), &interrupted_before, &interrupted_plan);
    }
    #[test]
    fn planning_accepts_the_canonical_schema_v1_envelope_only() {
        let summary = parse_summary(&project("bids")).unwrap();
        assert_eq!(summary.schema_version, "1");
        assert!(parse_summary(
            br#"{"version":"0.1.0","projectMeta":{"id":"id","name":"name","dataSource":"bids"}}"#
        )
        .is_err());
    }
    #[test]
    fn canonical_project_validation_rejects_untrusted_shape_and_path_payloads() {
        let valid: serde_json::Value = serde_json::from_slice(&project("bids")).unwrap();
        assert!(validate_canonical_project_v1(&valid).is_ok());
        for mutation in [
            ("schemaVersion", serde_json::json!(2)),
            ("uiState", serde_json::json!([])),
            (
                "mappingState",
                serde_json::json!({"sourceDataPath":"../escape"}),
            ),
            ("dataPar", serde_json::json!([])),
            ("unexpected", serde_json::json!(true)),
        ] {
            let mut invalid = valid.clone();
            invalid
                .as_object_mut()
                .unwrap()
                .insert(mutation.0.into(), mutation.1);
            assert!(
                validate_canonical_project_v1(&invalid).is_err(),
                "{}",
                mutation.0
            );
        }
        let mut invalid = valid;
        invalid["projectMeta"]["currentPhase"] = serde_json::json!("other");
        assert!(validate_canonical_project_v1(&invalid).is_err());
    }
    #[test]
    fn canonical_project_bytes_reject_noncanonical_encoding_and_schema_refinements() {
        let valid = project("bids");
        assert!(parse_summary(&valid).is_ok());
        assert!(
            parse_summary(format!("{}\n", String::from_utf8_lossy(&valid)).as_bytes()).is_err()
        );
        assert!(parse_summary(
            br#"{"schemaVersion":1,"projectMeta":{"id":"11111111-1111-4111-8111-111111111111","name":"name","createdAt":"2026-01-01T00:00:00.000Z","lastOpened":"2026-01-01T00:00:00.000Z","currentPhase":"import","dataSource":"bids"},"uiState":{},"mappingState":{},"dataPar":{}}"#
        ).is_err());

        // ProjectMetaSchema accepts legacy non-UUID project identifiers and
        // arbitrary timestamp strings; the native boundary must not reject a
        // project that the persisted frontend schema accepts.
        let mut legacy: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        legacy["projectMeta"]["id"] = serde_json::json!("legacy-project-id");
        legacy["projectMeta"]["createdAt"] = serde_json::json!("legacy date");
        legacy["projectMeta"]["lastOpened"] = serde_json::json!("another legacy date");
        let legacy = serde_json::to_string_pretty(&legacy).unwrap();
        assert!(parse_summary(legacy.as_bytes()).is_ok());

        let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        invalid["dataPar"]["ApplyQuantification"] = serde_json::json!([0, 0, 0]);
        let invalid = serde_json::to_string_pretty(&invalid).unwrap();
        assert!(parse_summary(invalid.as_bytes()).is_err());

        let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        invalid["mappingState"]["sourceDataPath"] = serde_json::json!("../outside");
        let invalid = serde_json::to_string_pretty(&invalid).unwrap();
        assert!(parse_summary(invalid.as_bytes()).is_err());

        let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        invalid["uiState"]["datapar"] = serde_json::json!("not-an-object");
        let invalid = serde_json::to_string_pretty(&invalid).unwrap();
        assert!(parse_summary(invalid.as_bytes()).is_err());

        let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        invalid["uiState"]["dataVis"] = serde_json::json!({"pointSize":"large"});
        let invalid = serde_json::to_string_pretty(&invalid).unwrap();
        assert!(parse_summary(invalid.as_bytes()).is_err());
    }
    #[test]
    fn ignore_bytes_cover_newline_edges() {
        assert_eq!(
            plan_bidsignore(None, SetupMode::Bids).unwrap().bytes,
            b"project.easl\n.easl_staging\nrawdata/\n"
        );
        assert_eq!(
            plan_bidsignore(Some(b"derivatives/"), SetupMode::Bids)
                .unwrap()
                .bytes,
            b"derivatives/\nproject.easl\n.easl_staging\nrawdata/\n"
        );
        assert_eq!(
            plan_bidsignore(Some(b"derivatives/\r"), SetupMode::Bids)
                .unwrap()
                .bytes,
            b"derivatives/\r\nproject.easl\n.easl_staging\nrawdata/\n"
        );
        assert_eq!(
            plan_bidsignore(Some(b"derivatives/\r\nproject.easl\r\n"), SetupMode::Bids)
                .unwrap()
                .bytes,
            b"derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
        );
        let exact = b" project.easl \r\n.easl_staging\nrawdata/\nrawdata/\n";
        assert_eq!(
            plan_bidsignore(Some(exact), SetupMode::Bids).unwrap(),
            IgnorePlan {
                operation: OperationKind::NoOp,
                bytes: exact.to_vec()
            }
        );
        assert!(plan_bidsignore(Some(b"\xff"), SetupMode::Bids).is_err());
    }
    #[test]
    fn inspection_and_planning_are_read_only() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("rawdata")).unwrap();
        fs::write(temp.path().join("rawdata/README.md"), b"user").unwrap();
        fs::create_dir(temp.path().join("rawdata/sub-01")).unwrap();
        let before = fs::read(temp.path().join("rawdata/README.md")).unwrap();
        let plan = preflight(temp.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        assert!(plan.displayed.conflicts.is_empty());
        assert!(plan.displayed.warnings[0].contains("1 sub-*"));
        assert_eq!(
            fs::read(temp.path().join("rawdata/README.md")).unwrap(),
            before
        );
        assert!(!temp.path().join(RAWDATA_MARKER_PATH).exists());
    }
    #[test]
    fn repair_preflight_excludes_project_and_preserves_legacy_entries_without_writes() {
        for marker in [
            None,
            Some(RAWDATA_MARKER_BYTES),
            Some(b"foreign".as_slice()),
        ] {
            let root = TempDir::new().unwrap();
            fs::write(root.path().join("project.easl"), project("bids")).unwrap();
            fs::create_dir(root.path().join("rawdata")).unwrap();
            fs::write(root.path().join("rawdata/README.md"), b"user readme").unwrap();
            fs::create_dir(root.path().join("rawdata/sub-existing")).unwrap();
            fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
            if let Some(bytes) = marker {
                fs::write(root.path().join(RAWDATA_MARKER_PATH), bytes).unwrap();
            }
            let before = source_snapshot(root.path());
            let plan = preflight(root.path(), SetupMode::Repair, None).unwrap();
            assert!(
                plan.displayed
                    .operations
                    .iter()
                    .all(|operation| operation.path != "project.easl")
            );
            assert!(plan.displayed.preserves_readme);
            assert!(
                plan.displayed
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("sub-*"))
            );
            if marker == Some(b"foreign".as_slice()) {
                assert!(!plan.displayed.conflicts.is_empty());
            }
            assert_eq!(source_snapshot(root.path()), before);
        }

        let missing = TempDir::new().unwrap();
        fs::write(missing.path().join("project.easl"), project("bids")).unwrap();
        let plan = preflight(missing.path(), SetupMode::Repair, None).unwrap();
        assert!(
            plan.displayed
                .operations
                .iter()
                .any(|operation| operation.path == "rawdata/"
                    && operation.operation == OperationKind::Create)
        );
        assert!(
            plan.displayed
                .operations
                .iter()
                .any(|operation| operation.path == RAWDATA_MARKER_PATH)
        );
    }
    #[test]
    fn repair_requires_an_existing_bids_project_and_revalidates_its_identity() {
        let root = TempDir::new().unwrap();
        let before = source_snapshot(root.path());
        assert!(preflight(root.path(), SetupMode::Repair, None).is_err());
        assert_eq!(source_snapshot(root.path()), before);

        fs::write(root.path().join("project.easl"), project("dicom")).unwrap();
        let before = source_snapshot(root.path());
        assert!(preflight(root.path(), SetupMode::Repair, None).is_err());
        assert_eq!(source_snapshot(root.path()), before);

        fs::write(root.path().join("project.easl"), project("bids")).unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Repair,
            None,
        )
        .unwrap();
        fs::write(root.path().join("project.easl"), project("dicom")).unwrap();
        let before_commit = source_snapshot(root.path());
        assert!(commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before_commit);
    }
    #[test]
    fn repair_transaction_changes_only_reviewed_compatibility_paths() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let original_project = project("bids");
        fs::write(root.path().join("project.easl"), &original_project).unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/README.md"), b"keep exactly").unwrap();
        fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Repair,
            None,
        )
        .unwrap();
        let reviewed_paths = plan
            .operations
            .iter()
            .filter(|operation| operation.operation != OperationKind::NoOp)
            .map(|operation| operation.path.as_str())
            .collect::<Vec<_>>();
        let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
        assert_eq!(result.project_path, None);
        assert_eq!(result.canonical_project_bytes, None);
        assert_eq!(
            fs::read(root.path().join("project.easl")).unwrap(),
            original_project
        );
        assert_eq!(
            fs::read(root.path().join("rawdata/README.md")).unwrap(),
            b"keep exactly"
        );
        assert_eq!(
            fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
            RAWDATA_MARKER_BYTES
        );
        assert_eq!(
            fs::read(root.path().join(".bidsignore")).unwrap(),
            b"derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
        );
        assert_eq!(reviewed_paths, vec![".bidsignore", RAWDATA_MARKER_PATH]);
    }
    #[test]
    fn verification_is_read_only_and_rejects_missing_altered_and_wrong_type_setup() {
        let root = TempDir::new().unwrap();
        let before = source_snapshot(root.path());
        assert!(verify(root.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before);

        fs::create_dir(root.path().join("rawdata")).unwrap();
        let before = source_snapshot(root.path());
        assert!(verify(root.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before);

        fs::write(root.path().join(RAWDATA_MARKER_PATH), b"altered").unwrap();
        let before = source_snapshot(root.path());
        assert!(verify(root.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before);

        fs::remove_file(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        fs::create_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        let before = source_snapshot(root.path());
        assert!(verify(root.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before);
    }
    #[cfg(unix)]
    #[test]
    fn verification_rejects_symlinked_marker_without_following_it() {
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        let external = outside.path().join("marker");
        fs::write(&external, RAWDATA_MARKER_BYTES).unwrap();
        symlink(&external, root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        let before = source_snapshot(root.path());
        assert!(verify(root.path()).is_err());
        assert_eq!(source_snapshot(root.path()), before);
        assert_eq!(fs::read(external).unwrap(), RAWDATA_MARKER_BYTES);
    }
    #[test]
    fn marker_conflicts_and_dicom_omits_compatibility() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("rawdata")).unwrap();
        fs::write(temp.path().join(RAWDATA_MARKER_PATH), b"foreign").unwrap();
        assert!(
            !preflight(temp.path(), SetupMode::Bids, Some(project("bids")))
                .unwrap()
                .displayed
                .conflicts
                .is_empty()
        );
        let other = TempDir::new().unwrap();
        let plan = preflight(other.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
        assert!(
            plan.displayed
                .operations
                .iter()
                .all(|op| !op.path.starts_with("rawdata"))
        );
    }
    #[test]
    fn plan_serialization_is_display_only_and_complete_for_both_modes() {
        let root = TempDir::new().unwrap();
        let bids = preflight(root.path(), SetupMode::Bids, Some(project("bids")))
            .unwrap()
            .displayed;
        let json = serde_json::to_value(&bids).unwrap();
        assert_eq!(json["mode"], "bids");
        assert!(json["planId"].as_str().unwrap().starts_with("setup-"));
        assert_eq!(
            json["rootPath"],
            root.path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .as_ref()
        );
        assert_eq!(
            json["projectSummary"]["contentHash"]
                .as_str()
                .unwrap()
                .len(),
            64
        );
        assert!(
            json["operations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|op| op["path"] == RAWDATA_MARKER_PATH
                    && op["textPreview"].as_str()
                        == Some("{\"kind\":\"bids-direct-rawdata\",\"version\":1}\n"))
        );
        assert_eq!(json["preservesReadme"], true);
        assert!(!json["temporaryArtifacts"].as_array().unwrap().is_empty());
        let dicom = preflight(root.path(), SetupMode::Dicom, Some(project("dicom")))
            .unwrap()
            .displayed;
        assert!(
            dicom
                .operations
                .iter()
                .all(|operation| !operation.path.starts_with("rawdata"))
        );
    }
    #[test]
    fn unsafe_ignore_inputs_are_conflicts_without_writes() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join(".bidsignore")).unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        assert!(!plan.displayed.conflicts.is_empty());
        assert!(root.path().join(".bidsignore").is_dir());

        let large = TempDir::new().unwrap();
        File::create(large.path().join(".bidsignore"))
            .unwrap()
            .set_len(MAX_TEXT_BYTES + 1)
            .unwrap();
        let plan = preflight(large.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        assert!(
            plan.displayed
                .conflicts
                .iter()
                .any(|conflict| conflict.contains("inspection limit"))
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_control_paths_are_conflicts() {
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("ignore"), b"outside").unwrap();
        symlink(
            outside.path().join("ignore"),
            root.path().join(".bidsignore"),
        )
        .unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        assert!(!plan.displayed.conflicts.is_empty());
        assert_eq!(fs::read(outside.path().join("ignore")).unwrap(), b"outside");
    }
    #[cfg(unix)]
    #[test]
    fn marker_wrong_type_and_symlink_are_never_followed() {
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::create_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Unsafe
        );
        fs::remove_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        let outside = TempDir::new().unwrap();
        let external = outside.path().join("marker");
        fs::write(&external, RAWDATA_MARKER_BYTES).unwrap();
        symlink(&external, root.path().join(RAWDATA_MARKER_PATH)).unwrap();
        assert_eq!(
            classify_marker(root.path()).unwrap(),
            MarkerClassification::Unsafe
        );
        assert_eq!(fs::read(external).unwrap(), RAWDATA_MARKER_BYTES);
    }
    #[test]
    fn transaction_installs_project_last_and_replays_result() {
        let temp = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            temp.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
        assert_eq!(result.outcome, "committed");
        assert_eq!(
            fs::read(temp.path().join("project.easl")).unwrap(),
            project("bids")
        );
        assert_eq!(
            fs::read(temp.path().join(RAWDATA_MARKER_PATH)).unwrap(),
            RAWDATA_MARKER_BYTES
        );
        assert_eq!(
            commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap(),
            result
        );
    }
    #[test]
    fn transaction_matrix_preserves_existing_rawdata_and_omits_dicom_compatibility() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/README.md"), b"user readme").unwrap();
        fs::write(root.path().join(RAWDATA_MARKER_PATH), RAWDATA_MARKER_BYTES).unwrap();
        fs::write(root.path().join(".bidsignore"), b"user\r\n").unwrap();
        let plans = SetupPlans::default();
        let bids = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        commit_for_state(&plans, &bids.plan_id, app_data.path()).unwrap();
        assert_eq!(
            fs::read(root.path().join("rawdata/README.md")).unwrap(),
            b"user readme"
        );
        assert_eq!(
            fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
            RAWDATA_MARKER_BYTES
        );
        assert_eq!(
            fs::read(root.path().join(".bidsignore")).unwrap(),
            b"user\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
        );

        let dicom_root = TempDir::new().unwrap();
        let dicom_plans = SetupPlans::default();
        let dicom = preflight_for_state(
            &dicom_plans,
            dicom_root.path().display().to_string(),
            SetupMode::Dicom,
            Some(String::from_utf8(project("dicom")).unwrap()),
        )
        .unwrap();
        commit_for_state(&dicom_plans, &dicom.plan_id, app_data.path()).unwrap();
        assert!(!dicom_root.path().join("rawdata").exists());
        assert_eq!(
            fs::read(dicom_root.path().join("project.easl")).unwrap(),
            project("dicom")
        );
    }
    #[test]
    fn stale_plan_has_no_writes() {
        let temp = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            temp.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        fs::write(temp.path().join(".bidsignore"), b"changed\n").unwrap();
        assert!(commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err());
        assert!(!temp.path().join("project.easl").exists());
    }
    #[test]
    fn plan_admission_rejects_missing_expired_superseded_and_claimed_ids() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        assert!(commit_for_state(&plans, "missing", app_data.path()).is_err());
        let first = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let second = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Dicom,
            Some(String::from_utf8(project("dicom")).unwrap()),
        )
        .unwrap();
        assert!(commit_for_state(&plans, &first.plan_id, app_data.path()).is_err());
        {
            let mut cache = plans.0.lock().unwrap();
            let plan = cache.get_mut(&second.plan_id).unwrap();
            plan.created = SystemTime::now() - PLAN_TTL - Duration::from_secs(1);
        }
        assert!(commit_for_state(&plans, &second.plan_id, app_data.path()).is_err());
        let current = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Dicom,
            Some(String::from_utf8(project("dicom")).unwrap()),
        )
        .unwrap();
        plans
            .0
            .lock()
            .unwrap()
            .get_mut(&current.plan_id)
            .unwrap()
            .claimed = true;
        assert!(commit_for_state(&plans, &current.plan_id, app_data.path()).is_err());
        assert!(!root.path().join("project.easl").exists());
    }
    #[test]
    fn a_failed_claim_is_terminal_and_cannot_be_retried_with_reviewed_bytes() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        fs::write(root.path().join(".bidsignore"), b"external change\n").unwrap();
        let first = commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap_err()
            .to_string();
        fs::remove_file(root.path().join(".bidsignore")).unwrap();
        let second = commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap_err()
            .to_string();
        assert_eq!(second, first);
        assert!(!root.path().join("project.easl").exists());
    }
    #[test]
    fn concurrent_duplicate_commit_has_one_admission_and_one_terminal_replay() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = Arc::new(SetupPlans::default());
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let outcomes = std::thread::scope(|scope| {
            let first_plans = Arc::clone(&plans);
            let first_barrier = Arc::clone(&barrier);
            let first_id = plan.plan_id.clone();
            let first_app_data = app_data.path().to_path_buf();
            let first = scope.spawn(move || {
                first_barrier.wait();
                commit_for_state(&first_plans, &first_id, &first_app_data).unwrap()
            });
            let second_plans = Arc::clone(&plans);
            let second_barrier = Arc::clone(&barrier);
            let second_id = plan.plan_id.clone();
            let second_app_data = app_data.path().to_path_buf();
            let second = scope.spawn(move || {
                second_barrier.wait();
                commit_for_state(&second_plans, &second_id, &second_app_data).unwrap()
            });
            barrier.wait();
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(outcomes[0], outcomes[1]);
        assert_eq!(
            fs::read(root.path().join("project.easl")).unwrap(),
            project("bids")
        );
    }
    #[test]
    fn malformed_registry_and_path_escape_fail_closed() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join(REGISTRY_FILE), b"not json").unwrap();
        assert!(recover_all(temp.path()).is_err());
        assert!(safe_relative("../escape").is_err());
        assert!(safe_relative("/escape").is_err());
    }
    #[test]
    fn journal_registry_and_candidate_paths_reject_tampering_and_collisions() {
        let root = TempDir::new().unwrap();
        let destination = root.path().join(".bidsignore");
        let transaction = "transaction-00000000-0000-0000-0000-000000000001";
        let (candidate, fingerprint) =
            create_candidate(root.path(), &destination, transaction, b"exact\n").unwrap();
        assert_eq!(fs::read(root.path().join(&candidate)).unwrap(), b"exact\n");
        assert_eq!(fingerprint.hash.as_deref(), Some(hash(b"exact\n").as_str()));
        assert!(safe_relative(&candidate).is_ok());
        assert!(owned_sibling(&destination, transaction, "candidate", "x").is_err());
        let entry = PendingEntry {
            registry_id: "registry-1".into(),
            transaction_id: transaction.into(),
            journal_id: "journal-1".into(),
            root: root.path().display().to_string(),
            journal_name: "wrong.json".into(),
        };
        assert!(validate_registry_entry(&entry).is_err());
        fs::write(root.path().join(&candidate), b"foreign").unwrap();
        assert!(find_owned_sibling(&destination, transaction, "candidate", &fingerprint).is_err());
    }
    #[test]
    fn replacement_revalidates_before_backup_and_fails_closed_on_swap() {
        let root = TempDir::new().unwrap();
        let target = root.path().join(".bidsignore");
        fs::write(&target, b"before\n").unwrap();
        let observed = inspect(&target, true).unwrap();
        fs::write(&target, b"swapped\n").unwrap();
        assert!(
            backup_for(
                root.path(),
                &target,
                "transaction-00000000-0000-0000-0000-000000000001",
                &observed,
            )
            .is_err()
        );
        assert_eq!(fs::read(target).unwrap(), b"swapped\n");
    }
    #[test]
    fn ordinary_faults_restore_before_state_or_leave_terminal_recovery() {
        for fault in [
            SetupFault::RegistryWrite,
            SetupFault::JournalWrite,
            SetupFault::CandidateCreate,
            SetupFault::CandidateWrite,
            SetupFault::CandidateFlush,
            SetupFault::CandidateVerify,
            SetupFault::RawdataCreate,
            SetupFault::IntentRecord,
            SetupFault::BackupRename,
            SetupFault::Install,
            SetupFault::ParentFlush,
            SetupFault::TerminalRecord,
        ] {
            let root = TempDir::new().unwrap();
            let app_data = TempDir::new().unwrap();
            fs::write(root.path().join(".bidsignore"), b"user-ignore\r\n").unwrap();
            let plans = SetupPlans::default();
            let plan = preflight_for_state(
                &plans,
                root.path().to_string_lossy().into_owned(),
                SetupMode::Bids,
                Some(String::from_utf8(project("bids")).unwrap()),
            )
            .unwrap();
            let _guard = inject_setup_fault(fault);
            assert!(
                commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
                "{fault:?}"
            );
            assert_eq!(
                fs::read(root.path().join(".bidsignore")).unwrap(),
                b"user-ignore\r\n",
                "{fault:?}"
            );
            assert!(!root.path().join("project.easl").exists(), "{fault:?}");
            assert!(!root.path().join("rawdata").exists(), "{fault:?}");
        }
    }
    #[test]
    fn every_structured_command_error_category_has_a_stable_wire_kind() {
        let cases = [
            (anyhow!("Setup plan expired"), "stale"),
            (anyhow!("marker must be regular"), "conflict"),
            (anyhow!("changes rolled back"), "rollback"),
            (
                anyhow!("could not synchronize directory"),
                "uncertain_durability",
            ),
            (
                anyhow!("recovery required after ambiguous swap"),
                "recovery_required",
            ),
            (anyhow!("unexpected"), "failed"),
        ];
        for (error, kind) in cases {
            let value = serde_json::to_value(command_error(error)).unwrap();
            assert_eq!(value["kind"], kind);
            assert!(
                value["message"]
                    .as_str()
                    .is_some_and(|message| !message.is_empty())
            );
        }
    }
    #[test]
    fn command_errors_distinguish_rollback_from_pending_recovery() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _guard = inject_setup_fault(SetupFault::CandidateCreate);
        let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
        assert!(matches!(
            command_error(error),
            SetupCommandError::Rollback { .. }
        ));
        drop(_guard);

        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _guard = inject_setup_fault(SetupFault::JournalWrite);
        let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
        assert!(matches!(
            command_error(error),
            SetupCommandError::RecoveryRequired { .. }
        ));
    }
    #[test]
    fn terminal_cleanup_is_retried_by_recovery() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _guard = inject_setup_fault(SetupFault::Cleanup);
        assert_eq!(
            commit_for_state(&plans, &plan.plan_id, app_data.path())
                .unwrap()
                .outcome,
            "committed"
        );
        drop(_guard);
        assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
        assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
    }
    #[test]
    fn recovery_rolls_back_each_incomplete_phase_and_defers_unavailable_roots() {
        for phase in [
            TransactionPhase::Planned,
            TransactionPhase::Preparing,
            TransactionPhase::Committing,
            TransactionPhase::RecoveryRequired,
        ] {
            let root = TempDir::new().unwrap();
            let app_data = TempDir::new().unwrap();
            let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
            let transaction_id = random_id("transaction");
            let journal_id = random_id("journal");
            let registry_id = random_id("registry");
            let mut journal = initial_journal(
                &plan,
                transaction_id.clone(),
                journal_id.clone(),
                registry_id.clone(),
            )
            .unwrap();
            journal.phase = phase;
            let entry = PendingEntry {
                registry_id,
                transaction_id,
                journal_id: journal_id.clone(),
                root: root.path().canonicalize().unwrap().display().to_string(),
                journal_name: journal_name(&journal_id),
            };
            register_pending(app_data.path(), entry).unwrap();
            write_journal(root.path(), &journal).unwrap();
            assert_eq!(
                recover_all(app_data.path()).unwrap().recovered,
                1,
                "{phase:?}"
            );
            assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
            assert!(!journal_path(root.path(), &journal_id).exists());
        }
        let app_data = TempDir::new().unwrap();
        let registry_id = random_id("registry");
        let transaction_id = random_id("transaction");
        let journal_id = random_id("journal");
        register_pending(
            app_data.path(),
            PendingEntry {
                registry_id,
                transaction_id,
                journal_id: journal_id.clone(),
                root: app_data
                    .path()
                    .join("unavailable-root")
                    .display()
                    .to_string(),
                journal_name: journal_name(&journal_id),
            },
        )
        .unwrap();
        let summary = recover_all(app_data.path()).unwrap();
        assert_eq!(summary.deferred_roots.len(), 1);
        assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
    }
    #[test]
    fn recovery_blocks_divergent_journals_and_preserves_concurrent_rawdata_entries() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let transaction_id = random_id("transaction");
        let journal_id = random_id("journal");
        let registry_id = random_id("registry");
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.directory_phase = OperationPhase::Created;
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
        register_pending(
            app_data.path(),
            PendingEntry {
                registry_id: registry_id.clone(),
                transaction_id,
                journal_id: journal_id.clone(),
                root: root.path().canonicalize().unwrap().display().to_string(),
                journal_name: journal_name(&journal_id),
            },
        )
        .unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert!(recover_all(app_data.path()).is_err());
        assert_eq!(
            fs::read(root.path().join("rawdata/concurrent")).unwrap(),
            b"keep"
        );
        let mut foreign = journal.clone();
        foreign.registry_id = "foreign-registry".into();
        fs::write(
            journal_path(root.path(), &journal_id),
            journal_bytes(&foreign).unwrap(),
        )
        .unwrap();
        assert!(recover_root(app_data.path(), root.path()).is_err());
    }

    #[test]
    fn journal_and_registry_schemas_are_versioned_strict_and_cross_bound() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        assert_ne!(transaction_id, journal_id);
        assert_ne!(transaction_id, registry_id);
        assert_ne!(journal_id, registry_id);
        let journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        let entry = entry_for(root.path(), transaction_id, journal_id.clone(), registry_id);

        let registry = PendingRegistry {
            version: REGISTRY_VERSION,
            entries: vec![entry.clone()],
        };
        assert_eq!(
            serde_json::to_value(&journal).unwrap()["version"],
            JOURNAL_VERSION
        );
        assert_eq!(
            serde_json::to_value(&registry).unwrap()["version"],
            REGISTRY_VERSION
        );

        let mut malformed = serde_json::to_value(&registry).unwrap();
        malformed["unexpected"] = serde_json::json!(true);
        fs::write(
            registry_path(app_data.path()),
            serde_json::to_vec(&malformed).unwrap(),
        )
        .unwrap();
        assert!(load_registry(app_data.path()).is_err());

        register_pending(app_data.path(), entry.clone()).unwrap_err();
        fs::remove_file(registry_path(app_data.path())).unwrap();
        register_pending(app_data.path(), entry.clone()).unwrap();
        write_journal(root.path(), &journal).unwrap();

        let mut foreign = journal.clone();
        foreign.registry_id = random_id("registry");
        fs::write(
            journal_path(root.path(), &journal_id),
            journal_bytes(&foreign).unwrap(),
        )
        .unwrap();
        assert!(recover_all(app_data.path()).is_err());
        assert_eq!(load_registry(app_data.path()).unwrap().entries, vec![entry]);
    }

    #[test]
    fn initial_journal_and_registry_claims_never_replace_foreign_files() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        let journal_path = journal_path(root.path(), &journal_id);
        fs::write(&journal_path, b"foreign journal").unwrap();
        assert!(write_journal(root.path(), &journal).is_err());
        assert_eq!(fs::read(&journal_path).unwrap(), b"foreign journal");

        let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
        fs::write(registry_path(app_data.path()), b"foreign registry").unwrap();
        assert!(register_pending(app_data.path(), entry).is_err());
        assert_eq!(
            fs::read(registry_path(app_data.path())).unwrap(),
            b"foreign registry"
        );
    }

    #[cfg(unix)]
    #[test]
    fn journal_and_registry_updates_are_same_parent_replacements_not_truncates() {
        use std::os::unix::fs::MetadataExt;

        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        write_journal(root.path(), &journal).unwrap();
        let root_journal = journal_path(root.path(), &journal_id);
        let before_journal_inode = fs::metadata(&root_journal).unwrap().ino();
        journal.phase = TransactionPhase::Preparing;
        write_journal(root.path(), &journal).unwrap();
        assert_ne!(
            before_journal_inode,
            fs::metadata(&root_journal).unwrap().ino()
        );

        let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
        register_pending(app_data.path(), entry.clone()).unwrap();
        let registry = registry_path(app_data.path());
        let before_registry_inode = fs::metadata(&registry).unwrap().ino();
        remove_pending(app_data.path(), &entry.registry_id).unwrap();
        assert_ne!(
            before_registry_inode,
            fs::metadata(&registry).unwrap().ino()
        );
    }

    #[test]
    fn journal_paths_are_relative_owned_siblings_and_reject_escape_or_links() {
        let root = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal =
            initial_journal(&plan, transaction_id.clone(), journal_id, registry_id).unwrap();
        let target = fixed_path(root.path(), ".bidsignore").unwrap();
        let candidate = owned_sibling(&target, &transaction_id, "candidate", "0").unwrap();
        let backup = owned_sibling(&target, &transaction_id, "backup", "1").unwrap();
        journal.operations[1].candidate = Some(relative_to_root(root.path(), &candidate).unwrap());
        journal.operations[1].backup = Some(relative_to_root(root.path(), &backup).unwrap());
        assert!(
            journal.operations[1]
                .candidate
                .as_deref()
                .unwrap()
                .starts_with('.')
        );
        validate_journal(root.path(), &journal).unwrap();
        journal.operations[1].candidate = Some("../outside".into());
        assert!(validate_journal(root.path(), &journal).is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let (transaction_id, journal_id, registry_id) = identities();
            let clean =
                initial_journal(&plan, transaction_id, journal_id.clone(), registry_id).unwrap();
            let path = journal_path(root.path(), &journal_id);
            symlink(root.path().join("outside"), &path).unwrap();
            assert!(write_journal(root.path(), &clean).is_err());
        }
    }

    #[test]
    fn durable_intents_precede_directory_candidate_backup_and_install_mutations() {
        let root = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal = initial_journal(&plan, transaction_id, journal_id, registry_id).unwrap();
        write_journal(root.path(), &journal).unwrap();

        journal.directory_phase = OperationPhase::CreateIntent;
        write_journal(root.path(), &journal).unwrap();
        assert!(!root.path().join("rawdata").exists());
        for (index, phase) in [
            OperationPhase::CandidateIntent,
            OperationPhase::BackupIntent,
            OperationPhase::InstallIntent,
        ]
        .into_iter()
        .enumerate()
        {
            update_operation(root.path(), &mut journal, index, phase).unwrap();
            let persisted = read_journal(root.path(), &journal.journal_id).unwrap();
            assert_eq!(persisted.operations[index].phase, phase);
            assert!(
                inspect(
                    &fixed_path(root.path(), &persisted.operations[index].destination).unwrap(),
                    true
                )
                .unwrap()
                .kind
                    == persisted.operations[index].before.kind
            );
        }
    }

    #[test]
    fn candidates_are_exact_same_parent_create_new_and_backups_validate_fingerprints() {
        let root = TempDir::new().unwrap();
        let transaction = "transaction-00000000-0000-0000-0000-000000000001";
        let destination = root.path().join(".bidsignore");
        let collision = owned_sibling(&destination, transaction, "candidate", "0").unwrap();
        fs::write(&collision, b"foreign").unwrap();
        let (candidate, fingerprint) =
            create_candidate(root.path(), &destination, transaction, b"exact bytes\n").unwrap();
        let candidate_path = root.path().join(&candidate);
        assert_eq!(candidate_path.parent(), destination.parent());
        assert_ne!(candidate_path, collision);
        assert_eq!(fs::read(&candidate_path).unwrap(), b"exact bytes\n");
        assert_eq!(
            fingerprint.hash.as_deref(),
            Some(hash(b"exact bytes\n").as_str())
        );

        fs::write(&destination, b"before\n").unwrap();
        let before = inspect(&destination, true).unwrap();
        let backup_collision = owned_sibling(&destination, transaction, "backup", "0").unwrap();
        fs::write(&backup_collision, b"unowned").unwrap();
        let (backup, backup_fingerprint) =
            backup_for(root.path(), &destination, transaction, &before).unwrap();
        assert_ne!(root.path().join(&backup), backup_collision);
        assert_eq!(backup_fingerprint, before);
        assert_eq!(fs::read(backup_collision).unwrap(), b"unowned");
        fs::write(root.path().join(&backup), b"tampered").unwrap();
        assert_ne!(inspect(&root.path().join(&backup), true).unwrap(), before);
    }

    #[cfg(unix)]
    #[test]
    fn directory_flush_reports_supported_on_unix() {
        let root = TempDir::new().unwrap();
        assert!(sync_parent(root.path()).unwrap());
    }

    #[cfg(not(unix))]
    #[test]
    fn directory_flush_reports_reduced_durability_when_unsupported() {
        let root = TempDir::new().unwrap();
        assert!(!sync_parent(root.path()).unwrap());
    }

    #[test]
    fn fresh_and_existing_transactions_preserve_exact_bytes_and_project_is_last_visible() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
        assert_eq!(
            take_install_observations(),
            vec![
                (".easl-gui-managed".into(), false),
                (".bidsignore".into(), false),
                ("project.easl".into(), true),
            ]
        );
        assert_eq!(
            fs::read(root.path().join("project.easl")).unwrap(),
            project("bids")
        );
        assert_eq!(
            fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
            RAWDATA_MARKER_BYTES
        );

        let existing = TempDir::new().unwrap();
        let existing_app_data = TempDir::new().unwrap();
        fs::create_dir(existing.path().join("rawdata")).unwrap();
        fs::write(existing.path().join("rawdata/README.md"), b"keep").unwrap();
        fs::write(
            existing.path().join(RAWDATA_MARKER_PATH),
            RAWDATA_MARKER_BYTES,
        )
        .unwrap();
        fs::write(existing.path().join(".bidsignore"), b"user\r\n").unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            existing.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let first = commit_for_state(&plans, &plan.plan_id, existing_app_data.path()).unwrap();
        let second = commit_for_state(&plans, &plan.plan_id, existing_app_data.path()).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            fs::read(existing.path().join("rawdata/README.md")).unwrap(),
            b"keep"
        );
        assert_eq!(
            fs::read(existing.path().join(".bidsignore")).unwrap(),
            b"user\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
        );
    }

    #[test]
    fn dicom_transaction_omits_rawdata_and_marker() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Dicom,
            Some(String::from_utf8(project("dicom")).unwrap()),
        )
        .unwrap();
        commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
        assert!(!root.path().join("rawdata").exists());
        assert!(!root.path().join(RAWDATA_MARKER_PATH).exists());
    }

    #[test]
    fn every_named_failure_stage_restores_before_state_or_keeps_recovery_evidence() {
        let rollback_faults = [
            SetupFault::RegistryWrite,
            SetupFault::CandidateCreate,
            SetupFault::CandidateWrite,
            SetupFault::CandidateFlush,
            SetupFault::CandidateVerify,
            SetupFault::RawdataCreate,
            SetupFault::IntentRecord,
            SetupFault::RawdataIntent,
            SetupFault::CandidateIntent,
            SetupFault::BackupIntent,
            SetupFault::InstallIntent,
            SetupFault::BackupRename,
            SetupFault::Install,
            SetupFault::MarkerInstall,
            SetupFault::IgnoreInstall,
            SetupFault::ProjectInstall,
            SetupFault::ParentFlush,
            SetupFault::RootFlush,
            SetupFault::TerminalRecord,
        ];
        for fault in rollback_faults {
            let root = TempDir::new().unwrap();
            let app_data = TempDir::new().unwrap();
            fs::write(root.path().join(".bidsignore"), b"before\r\n").unwrap();
            let before = source_snapshot(root.path());
            let plans = SetupPlans::default();
            let plan = preflight_for_state(
                &plans,
                root.path().display().to_string(),
                SetupMode::Bids,
                Some(String::from_utf8(project("bids")).unwrap()),
            )
            .unwrap();
            let _fault = inject_setup_fault(fault);
            assert!(
                commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
                "{fault:?}"
            );
            assert_eq!(source_snapshot(root.path()), before, "{fault:?}");
        }

        // A root journal write failure happens after global intent and before
        // the journal exists. It must report recovery-required and preserve
        // discovery evidence rather than guessing that cleanup is safe.
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(SetupFault::JournalWrite);
        let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
        assert!(matches!(
            command_error(error),
            SetupCommandError::RecoveryRequired { .. }
        ));
        assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);

        // Terminal cleanup is deliberately non-destructive to the committed
        // result; its validated retry is covered by recovery.
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(SetupFault::Cleanup);
        assert_eq!(
            commit_for_state(&plans, &plan.plan_id, app_data.path())
                .unwrap()
                .outcome,
            "committed"
        );
        assert!(root.path().join("project.easl").exists());
        assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
    }

    #[test]
    fn recovery_handles_every_phase_finish_forward_and_preserves_ambiguous_intents() {
        for phase in [
            TransactionPhase::Planned,
            TransactionPhase::Preparing,
            TransactionPhase::Committing,
            TransactionPhase::Committed,
            TransactionPhase::RollingBack,
            TransactionPhase::RolledBack,
            TransactionPhase::RecoveryRequired,
        ] {
            let root = TempDir::new().unwrap();
            let app_data = TempDir::new().unwrap();
            let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
            let (transaction_id, journal_id, registry_id) = identities();
            let mut journal = initial_journal(
                &plan,
                transaction_id.clone(),
                journal_id.clone(),
                registry_id.clone(),
            )
            .unwrap();
            journal.phase = phase;
            let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
            register_pending(app_data.path(), entry).unwrap();
            write_journal(root.path(), &journal).unwrap();
            assert_eq!(
                recover_all(app_data.path()).unwrap().recovered,
                1,
                "{phase:?}"
            );
        }

        // A complete valid after-state is the only incomplete journal state
        // allowed to finish forward.
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        for operation in &journal.operations {
            fs::write(
                fixed_path(root.path(), &operation.destination).unwrap(),
                bytes_for(&plan, &operation.destination).unwrap(),
            )
            .unwrap();
        }
        register_pending(
            app_data.path(),
            entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
        )
        .unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
        assert_eq!(
            fs::read(root.path().join("project.easl")).unwrap(),
            project("bids")
        );
        assert!(!journal_path(root.path(), &journal_id).exists());

        // Intent-only directory creation cannot establish ownership after a
        // crash. Recovery blocks and leaves both record and user entry intact.
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.directory_phase = OperationPhase::CreateIntent;
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
        register_pending(
            app_data.path(),
            entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
        )
        .unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert!(recover_all(app_data.path()).is_err());
        assert_eq!(
            fs::read(root.path().join("rawdata/concurrent")).unwrap(),
            b"keep"
        );
        assert!(journal_path(root.path(), &journal_id).exists());
    }

    #[test]
    fn startup_and_targeted_recovery_settle_before_root_use_and_block_malformed_pairs() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        register_pending(
            app_data.path(),
            entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
        )
        .unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(recover_at_startup(app_data.path()).unwrap().recovered, 1);
        assert!(load_registry(app_data.path()).unwrap().entries.is_empty());

        let blocked_root = TempDir::new().unwrap();
        let blocked_app_data = TempDir::new().unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let entry = entry_for(
            blocked_root.path(),
            transaction_id,
            journal_id.clone(),
            registry_id,
        );
        register_pending(blocked_app_data.path(), entry).unwrap();
        fs::write(journal_path(blocked_root.path(), &journal_id), b"malformed").unwrap();
        assert!(recover_root(blocked_app_data.path(), blocked_root.path()).is_err());
        assert_eq!(
            load_registry(blocked_app_data.path())
                .unwrap()
                .entries
                .len(),
            1
        );
    }

    #[test]
    fn commit_contract_returns_only_durable_result_and_structured_failures_without_activation() {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let stale = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        fs::write(root.path().join(".bidsignore"), b"stale").unwrap();
        assert!(matches!(
            command_error(commit_for_state(&plans, &stale.plan_id, app_data.path()).unwrap_err()),
            SetupCommandError::Stale { .. }
        ));
        assert!(!root.path().join("project.easl").exists());

        let conflict_root = TempDir::new().unwrap();
        let conflict_app_data = TempDir::new().unwrap();
        fs::write(conflict_root.path().join("project.easl"), b"user project").unwrap();
        let conflict_plans = SetupPlans::default();
        let conflict = preflight_for_state(
            &conflict_plans,
            conflict_root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        assert!(matches!(
            command_error(
                commit_for_state(&conflict_plans, &conflict.plan_id, conflict_app_data.path())
                    .unwrap_err()
            ),
            SetupCommandError::Conflict { .. }
        ));
        assert_eq!(
            fs::read(conflict_root.path().join("project.easl")).unwrap(),
            b"user project"
        );

        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(SetupFault::RootFlush);
        assert!(matches!(
            command_error(commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err()),
            SetupCommandError::Rollback { .. }
        ));
        assert!(!root.path().join("project.easl").exists());

        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(SetupFault::JournalWrite);
        assert!(matches!(
            command_error(commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err()),
            SetupCommandError::RecoveryRequired { .. }
        ));
        assert!(!root.path().join("project.easl").exists());
        assert!(matches!(
            command_error(anyhow!("could not synchronize directory")),
            SetupCommandError::UncertainDurability { .. }
        ));

        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
        assert_eq!(
            result.project_path.as_deref(),
            root.path().join("project.easl").to_str()
        );
        assert_eq!(
            result.canonical_project_bytes.as_deref(),
            std::str::from_utf8(&project("bids")).ok()
        );
        assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
    }
}
