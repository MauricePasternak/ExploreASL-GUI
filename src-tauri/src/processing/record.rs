//! One fixed current record and bounded direct historical replay bindings.
use super::{
    journal::{AUTHORITY, publish, relative},
    types::*,
};
use crate::{execution::profile::ExecutionProfile, fs_safety::ProjectDirectory};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessingRequest {
    pub request_id: Uuid,
    pub project_id: String,
    /// Current IPC/admission input. It is deliberately omitted from durable
    /// request content; `projectMeta.id` is the persistent project identity.
    #[serde(skip)]
    pub project_root: PathBuf,
    pub selected_modules: Vec<String>,
    pub selected_subject_sessions: Vec<String>,
    pub execution_profile: ExecutionProfile,
    pub data_par: serde_json::Value,
    pub participants: ParticipantInputs,
    pub workers: u32,
    pub rerun_bids2legacy: bool,
}
/// Transient IPC admission context. This path is validated against native
/// active-project ownership, then excluded from durable request content.
#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessingAdmission {
    pub project_root: PathBuf,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ParticipantInputs {
    pub correction: bool,
    pub subject_rows: Vec<ParticipantRow>,
    pub metadata_groups: Vec<ParticipantGroup>,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ParticipantRow {
    pub subject: String,
    pub session: String,
    pub group_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ParticipantGroup {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AvailableAction {
    None,
    Stop,
    RetryCleanup,
    Acknowledge,
    ConfirmStopped,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessingError {
    pub code: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LogicalWorkerExit {
    pub worker_id: String,
    pub exit_code: i32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExpectedTarget {
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
    pub complete: bool,
}
impl ExpectedTarget {
    pub(crate) fn ready_path(&self) -> Result<String> {
        let path = match (
            self.module.as_str(),
            self.subject_session.as_deref(),
            self.run.as_deref(),
        ) {
            ("structural", Some(subject), None) if safe_label(subject) => format!(
                "lock/xASL_module_Structural/{subject}/xASL_module_Structural/999_ready.status"
            ),
            ("asl", Some(subject), Some(run))
                if safe_label(subject)
                    && run
                        .parse::<u32>()
                        .is_ok_and(|n| n > 0 && n.to_string() == run) =>
            {
                format!("lock/xASL_module_ASL/{subject}/xASL_module_ASL_ASL_{run}/999_ready.status")
            }
            ("population", None, None) => {
                "lock/xASL_module_Population/xASL_module_Population/999_ready.status".into()
            }
            _ => bail!("Invalid logical processing target"),
        };
        Ok(format!("derivatives/ExploreASL/{path}"))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessingTerminalSummary {
    pub result: ProcessingTerminalResult,
    pub execution_committed: bool,
    pub population_completed: bool,
    pub profile_id: String,
    pub explore_asl_version: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProcessingRecord {
    pub version: u32,
    directory_identity: (u64, u64),
    #[serde(skip)]
    pub project_root: PathBuf,
    pub run_id: Uuid,
    pub request: ProcessingRequest,
    pub revision: u64,
    pub lifecycle: ProcessingLifecycle,
    pub start_time: u64,
    pub data_source: String,
    pub expected_targets: Vec<ExpectedTarget>,
    pub logical_exits: Vec<LogicalWorkerExit>,
    pub error: Option<ProcessingError>,
    pub available_action: AvailableAction,
    pub terminal_summary: Option<ProcessingTerminalSummary>,
    pub terminal_revision: Option<u64>,
    pub acknowledged: bool,
    pub execution_committed: bool,
    #[serde(default)]
    pub execution_committed_at_ms: Option<u64>,
    #[serde(default)]
    pub cancellation_requested: bool,
    #[serde(default)]
    pub versions: Option<ProcessingVersions>,
    #[serde(default)]
    pub population_ready_mtime_ms: Option<u64>,
    pub launch_started: bool,
    pub launch_journal: String,
}
fn safe_label(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
impl ProcessingRequest {
    pub(crate) fn canonicalize(&mut self) -> Result<()> {
        // Validate renderer shape before dropping native-derived fields, so
        // unsupported authority fields never become silently accepted inputs.
        self.validate()?;
        let x = self.data_par["x"]
            .as_object_mut()
            .context("Invalid configuration")?;
        x.remove("opts");
        x.remove("dataset");
        Ok(())
    }
    fn validate(&self) -> Result<()> {
        if self.request_id.is_nil() || self.project_id.is_empty() || self.workers == 0 {
            bail!("Invalid processing request identity or worker count");
        }
        super::runs::selected_modules_to_b_process(&self.selected_modules)
            .map_err(anyhow::Error::msg)?;
        if self
            .selected_subject_sessions
            .iter()
            .any(|s| !safe_label(s))
        {
            bail!("Invalid selected Subject/Session");
        }
        let object = self
            .data_par
            .as_object()
            .context("Processing configuration must be an assembled JSON object")?;
        let x = object
            .get("x")
            .and_then(|x| x.as_object())
            .context("Processing configuration requires assembled x object")?;
        if object.len() != 1
            || x.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "opts"
                        | "Q"
                        | "modules"
                        | "settings"
                        | "S"
                        | "external"
                        | "WMHsegmAlg"
                        | "dataset"
                        | "bAutomaticallyDetectFSL"
                        | "bAutomaticallyDetectVABY"
                )
            })
        {
            bail!("Unsupported processing configuration authority field");
        }
        for (section, keys) in [
            ("opts", &["subjectFolder"][..]),
            ("dataset", &["subjectRegexp", "ForceInclusionList"][..]),
        ] {
            if let Some(value) = x.get(section) {
                let value = value.as_object().context("Invalid configuration section")?;
                if value.keys().any(|key| !keys.contains(&key.as_str())) {
                    bail!("Unsupported configuration destination field");
                }
            }
        }
        if self
            .participants
            .subject_rows
            .iter()
            .any(|r| !safe_label(&r.subject) || !safe_label(&r.session))
        {
            bail!("Invalid participant identity");
        }
        Ok(())
    }
    pub(crate) fn same_content(&self, other: &Self) -> Result<bool> {
        let mut left = self.clone();
        let mut right = other.clone();
        left.canonicalize()?;
        right.canonicalize()?;
        Ok(serde_json::to_value(left)? == serde_json::to_value(right)?)
    }
}
impl ProcessingRecord {
    pub(crate) fn new(
        root: &Path,
        mut request: ProcessingRequest,
        targets: Vec<ExpectedTarget>,
    ) -> Result<Self> {
        request.canonicalize()?;
        if targets.is_empty() {
            bail!("Selected processing work has no effective targets");
        }
        let project: serde_json::Value = serde_json::from_slice(
            &ProjectDirectory::open(root)?.read_regular(&relative("project.easl")?)?,
        )?;
        let data_source = project["projectMeta"]["dataSource"]
            .as_str()
            .context("Project data source missing")?
            .to_string();
        let run_id = Uuid::new_v4();
        let record = Self {
            version: 2,
            directory_identity: ProjectDirectory::open(root)?.directory_identity()?,
            project_root: root.into(),
            run_id,
            request,
            revision: 1,
            lifecycle: ProcessingLifecycle::Preparing,
            start_time: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_millis() as u64,
            data_source,
            expected_targets: targets,
            logical_exits: Vec::new(),
            error: None,
            available_action: AvailableAction::Stop,
            terminal_summary: None,
            terminal_revision: None,
            acknowledged: false,
            execution_committed: false,
            execution_committed_at_ms: None,
            cancellation_requested: false,
            versions: None,
            population_ready_mtime_ms: None,
            launch_started: false,
            launch_journal: format!("{AUTHORITY}/runs/{run_id}/launch.json"),
        };
        record.validate(root)?;
        Ok(record)
    }
    fn validate(&self, root: &Path) -> Result<()> {
        self.request.validate()?;
        if self.version != 2
            || self.request.project_id != current_project_id(root)?
            || !matches!(self.data_source.as_str(), "bids" | "dicom")
            || self.project_root != root
            || self.request.project_root != root
            || self.run_id.is_nil()
            || self.revision == 0
            || self.launch_journal != format!("{AUTHORITY}/runs/{}/launch.json", self.run_id)
        {
            bail!("Unsupported, corrupt, or foreign processing record");
        }
        if self.expected_targets.is_empty() {
            bail!("Processing record has no effective targets");
        }
        let mut target_paths = std::collections::BTreeSet::new();
        for target in &self.expected_targets {
            if !self.request.selected_modules.contains(&target.module)
                || !target_paths.insert(target.ready_path()?)
                || target.subject_session.as_ref().is_some_and(|s| {
                    !self.request.selected_subject_sessions.is_empty()
                        && !self.request.selected_subject_sessions.contains(s)
                })
            {
                bail!("Processing target conflicts with request");
            }
        }
        let mut workers = std::collections::BTreeSet::new();
        for exit in &self.logical_exits {
            if !workers.insert(&exit.worker_id)
                || !exit
                    .worker_id
                    .strip_prefix("worker-")
                    .and_then(|s| s.parse::<u32>().ok())
                    .is_some_and(|n| n > 0 && n <= self.request.workers)
            {
                bail!("Invalid logical worker evidence");
            }
        }
        let awaiting_confirmation = self.lifecycle == ProcessingLifecycle::Interrupted
            && self.available_action == AvailableAction::ConfirmStopped
            && !self.acknowledged
            && self.terminal_summary.is_none()
            && self.terminal_revision.is_none();
        if (self.available_action == AvailableAction::ConfirmStopped && !awaiting_confirmation)
            || (self.available_action == AvailableAction::Acknowledge
                && (!self.lifecycle.is_terminal() || self.acknowledged))
            || (self.available_action == AvailableAction::None
                && (!self.lifecycle.is_terminal() || !self.acknowledged))
            || (matches!(
                self.available_action,
                AvailableAction::Stop | AvailableAction::RetryCleanup
            ) && self.lifecycle.is_terminal())
            || (!awaiting_confirmation
                && self.lifecycle.is_terminal() != self.terminal_summary.is_some())
            || (!awaiting_confirmation
                && self.lifecycle.is_terminal() != self.terminal_revision.is_some())
            || self
                .terminal_revision
                .is_some_and(|revision| revision > self.revision || revision == 0)
            || self.acknowledged && !self.lifecycle.is_terminal()
        {
            bail!("Invalid processing terminal evidence");
        }
        if let Some(summary) = &self.terminal_summary
            && (summary.result.lifecycle() != self.lifecycle
                || summary.execution_committed != self.execution_committed)
        {
            bail!("Contradictory processing terminal summary");
        }
        Ok(())
    }
    /// A mismatched identity marks a copied unresolved authority. It remains
    /// readable only so activation can require explicit external-stop
    /// confirmation; it never authorizes direct admission or journal mutation.
    pub(crate) fn directory_matches(&self, root: &Path) -> Result<bool> {
        Ok(self.directory_identity == ProjectDirectory::open(root)?.directory_identity()?)
    }
    pub(crate) fn rebind_directory_identity(&mut self) -> Result<()> {
        self.directory_identity =
            ProjectDirectory::open(&self.project_root)?.directory_identity()?;
        Ok(())
    }
    pub(crate) fn assembled_configuration(&self) -> Result<serde_json::Value> {
        let mut value = self.request.data_par.clone();
        let x = value["x"]
            .as_object_mut()
            .context("Invalid reserved configuration")?;
        let opts = x
            .entry("opts")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .context("Invalid reserved opts")?;
        opts.remove("subjectFolder");
        if self.data_source == "bids" {
            opts.insert(
                "subjectFolder".into(),
                self.project_root.to_string_lossy().to_string().into(),
            );
        }
        let mut dataset = serde_json::json!({"subjectRegexp": super::runs::selected_subject_sessions_regexp(&self.request.selected_subject_sessions)});
        if !self.request.selected_subject_sessions.is_empty() {
            dataset["ForceInclusionList"] =
                serde_json::json!(self.request.selected_subject_sessions);
        }
        x.insert("dataset".into(), dataset);
        Ok(value)
    }
    pub(crate) fn snapshot(&self) -> ProcessingRunSnapshot {
        ProcessingRunSnapshot {
            run_id: self.run_id.to_string(),
            lifecycle: self.lifecycle,
            project_root: self.project_root.to_string_lossy().into(),
            selected_modules: self.request.selected_modules.clone(),
            selected_subject_sessions: self.request.selected_subject_sessions.clone(),
            start_time: self.start_time,
            watcher_owned: false,
            terminal_result: self.terminal_summary.as_ref().map(|s| s.result),
            revision: self.revision,
            request_id: Some(self.request.request_id.to_string()),
            expected_targets: self.expected_targets.clone(),
            logical_exits: self.logical_exits.clone(),
            worker_count: self.request.workers,
            error: self.error.clone(),
            available_action: self.available_action,
            terminal_summary: self.terminal_summary.clone(),
            terminal_revision: self.terminal_revision,
            execution_committed: self.execution_committed,
            population_execution_committed: self.execution_committed
                && self
                    .request
                    .selected_modules
                    .iter()
                    .any(|m| m == "population"),
            versions: self.versions.clone().map(Box::new),
            population_ready_mtime_ms: self.population_ready_mtime_ms,
        }
    }
    pub(crate) fn set_lifecycle(&mut self, lifecycle: ProcessingLifecycle) -> Result<()> {
        validate_processing_transition(self.lifecycle, lifecycle)?;
        self.revision = self
            .revision
            .checked_add(1)
            .context("Processing revision exhausted")?;
        self.lifecycle = lifecycle;
        self.available_action = if lifecycle.is_terminal() {
            AvailableAction::Acknowledge
        } else {
            AvailableAction::Stop
        };
        if lifecycle.is_terminal() {
            let result = match lifecycle {
                ProcessingLifecycle::Completed => ProcessingTerminalResult::Completed,
                ProcessingLifecycle::Cancelled => ProcessingTerminalResult::Cancelled,
                ProcessingLifecycle::Interrupted => ProcessingTerminalResult::Interrupted,
                _ => ProcessingTerminalResult::Failed,
            };
            let version = self.versions.as_ref().map(|v| v.explore_asl.clone());
            self.terminal_revision = Some(self.revision);
            self.terminal_summary = Some(ProcessingTerminalSummary {
                result,
                execution_committed: self.execution_committed,
                population_completed: lifecycle == ProcessingLifecycle::Completed
                    && self
                        .expected_targets
                        .iter()
                        .any(|t| t.module == "population" && t.complete),
                profile_id: self.request.execution_profile.id().into(),
                explore_asl_version: version,
            });
        }
        Ok(())
    }
}
pub(crate) const CURRENT_RECORD: &str = "derivatives/ExploreASL_GUI/processing/current.json";
const HISTORY_REQUESTS: &str = "derivatives/ExploreASL_GUI/processing/history/requests";
const HISTORY_RUNS: &str = "derivatives/ExploreASL_GUI/processing/history/runs";
// Version 2 replaces unbounded raw project IDs in compact authority.
const COMPACT_VERSION: u32 = 2;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HistoricalSummary {
    result: ProcessingTerminalResult,
    execution_committed: bool,
    population_completed: bool,
    profile_id: String,
    expected_target_count: u32,
    worker_count: u32,
    failed_worker_count: u32,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HistoricalReplayEnvelope {
    pub version: u32,
    pub project_id_digest: String,
    pub request_id: Uuid,
    pub run_id: Uuid,
    #[specta(type = specta_typescript::Number)]
    pub terminal_revision: u64,
    pub request_digest: String,
    pub outcome: ProcessingTerminalResult,
    pub summary: HistoricalSummary,
    pub acknowledged: bool,
    pub historical_replay: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProcessingReservation {
    Current { snapshot: ProcessingRunSnapshot },
    Historical { replay: HistoricalReplayEnvelope },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RunLocator {
    version: u32,
    project_id_digest: String,
    request_id: Uuid,
    run_id: Uuid,
    terminal_revision: u64,
}

fn current_path() -> String {
    CURRENT_RECORD.into()
}
fn request_binding_path(request_id: Uuid) -> String {
    format!("{HISTORY_REQUESTS}/{request_id}.json")
}
fn run_locator_path(run_id: Uuid) -> String {
    format!("{HISTORY_RUNS}/{run_id}.json")
}

fn bind_root(mut record: ProcessingRecord, root: &Path) -> ProcessingRecord {
    record.project_root = root.into();
    record.request.project_root = root.into();
    record
}
fn read_current(root: &Path) -> Result<Option<ProcessingRecord>> {
    let directory = ProjectDirectory::open(root)?;
    repair_authority_parent(&directory, CURRENT_RECORD)?;
    let bytes = match directory.read_regular(&relative(current_path())?) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let version = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value["version"].as_u64());
    if version == Some(1) {
        bail!(
            "Guardian-era processing record is unsupported; use checkpoint build to settle and acknowledge it, or restore a verified clean project copy. Record bytes were preserved"
        );
    }
    let record: ProcessingRecord = bind_root(
        serde_json::from_slice(&bytes).context("Corrupt processing current record")?,
        root,
    );
    record.validate(root)?;
    Ok(Some(record))
}
pub(crate) fn read(root: &Path, request_id: Uuid) -> Result<Option<ProcessingRecord>> {
    Ok(read_current(root)?.filter(|record| record.request.request_id == request_id))
}
pub(crate) fn records(root: &Path) -> Result<Vec<ProcessingRecord>> {
    Ok(read_current(root)?.into_iter().collect())
}
fn read_json<T: serde::de::DeserializeOwned>(
    directory: &ProjectDirectory,
    path: &str,
) -> Result<Option<T>> {
    let bytes = match directory.read_regular(&relative(path)?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if bytes.len() > 4096 {
        bail!("Processing compact authority exceeds 4 KiB");
    }
    let value = serde_json::from_slice(&bytes).context("Corrupt processing compact authority")?;
    repair_authority_parent(directory, path)?;
    Ok(Some(value))
}
fn publish_once<T: Serialize + serde::de::DeserializeOwned + PartialEq>(
    directory: &ProjectDirectory,
    path: &str,
    value: &T,
) -> Result<()> {
    if let Some(existing) = read_json::<T>(directory, path)? {
        if &existing == value {
            return Ok(());
        }
        bail!("Foreign compact processing authority blocks recovery");
    }
    publish(directory, path, value, true)
}
// Sync the containing directory even when a previously visible unlink or
// rename returned uncertainty. For a pristine namespace, sync the nearest
// existing ancestor; never create authority solely to discover it.
fn repair_authority_parent(directory: &ProjectDirectory, path: &str) -> Result<()> {
    super::journal::checkpoint("beforeAuthoritySync")?;
    super::journal::checkpoint(&format!("beforeAuthoritySync:{path}"))?;
    super::journal::sync_existing_parent(directory, path)
}
fn truncate(value: &str, byte_limit: usize) -> String {
    // Account for JSON escaping, not Unicode character count. Quotes consume
    // two bytes; the budget covers the encoded contents only.
    let mut encoded = 0;
    value
        .chars()
        .take_while(|ch| {
            encoded += serde_json::to_string(ch)
                .expect("character serializes")
                .len()
                - 2;
            encoded <= byte_limit
        })
        .collect()
}
pub(crate) fn request_digest(request: &ProcessingRequest) -> Result<String> {
    let mut canonical = request.clone();
    canonical.canonicalize()?;
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&canonical)?)))
}
pub(crate) fn current_project_id(root: &Path) -> Result<String> {
    let project: serde_json::Value = serde_json::from_slice(
        &ProjectDirectory::open(root)?.read_regular(&relative("project.easl")?)?,
    )?;
    Ok(project["projectMeta"]["id"]
        .as_str()
        .context("Project ID missing")?
        .into())
}
// Project IDs are arbitrary strings. Hash the complete exact UTF-8 identity,
// without truncation or normalization, so every compact record stays bounded.
fn project_identity_digest(project_id: &str) -> String {
    hex::encode(Sha256::digest(project_id.as_bytes()))
}
fn envelope(record: &ProcessingRecord) -> Result<HistoricalReplayEnvelope> {
    let terminal = record
        .terminal_summary
        .as_ref()
        .context("Processing record is not terminal")?;
    let error = record.error.as_ref();
    let result = HistoricalReplayEnvelope {
        version: COMPACT_VERSION,
        project_id_digest: project_identity_digest(&record.request.project_id),
        request_id: record.request.request_id,
        run_id: record.run_id,
        terminal_revision: record
            .terminal_revision
            .context("Missing terminal revision")?,
        request_digest: request_digest(&record.request)?,
        outcome: terminal.result,
        summary: HistoricalSummary {
            result: terminal.result,
            execution_committed: terminal.execution_committed,
            population_completed: terminal.population_completed,
            profile_id: truncate(&terminal.profile_id, 128),
            expected_target_count: u32::try_from(record.expected_targets.len()).unwrap_or(u32::MAX),
            worker_count: record.request.workers,
            failed_worker_count: u32::try_from(
                record
                    .logical_exits
                    .iter()
                    .filter(|exit| exit.exit_code != 0)
                    .count(),
            )
            .unwrap_or(u32::MAX),
            error_code: error.map(|error| truncate(&error.code, 128)),
            error_message: error.map(|error| truncate(&error.message, 512)),
        },
        acknowledged: true,
        historical_replay: true,
    };
    if serde_json::to_vec(&result)?.len() > 4096 {
        bail!("Processing compact binding exceeds 4 KiB");
    }
    Ok(result)
}
pub(crate) fn lookup_request(
    root: &Path,
    request_id: Uuid,
) -> Result<Option<HistoricalReplayEnvelope>> {
    let directory = ProjectDirectory::open(root)?;
    let replay =
        read_json::<HistoricalReplayEnvelope>(&directory, &request_binding_path(request_id))?;
    if let Some(replay) = &replay
        && (replay.version != COMPACT_VERSION
            || replay.project_id_digest != project_identity_digest(&current_project_id(root)?)
            || replay.request_id.is_nil()
            || replay.run_id.is_nil()
            || replay.terminal_revision == 0
            || replay.request_digest.len() != 64
            || !replay
                .request_digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || replay.summary.result != replay.outcome
            || replay.summary.worker_count == 0
            || replay.summary.expected_target_count == 0
            || replay.summary.failed_worker_count > replay.summary.worker_count
            || replay.summary.population_completed
                && (replay.outcome != ProcessingTerminalResult::Completed
                    || !replay.summary.execution_committed)
            || replay.request_id != request_id
            || !replay.acknowledged
            || !replay.historical_replay
            || serde_json::to_vec(replay)?.len() > 4096)
    {
        bail!("Invalid or foreign processing request binding");
    }
    Ok(replay)
}
pub(crate) fn lookup_run(root: &Path, run_id: Uuid) -> Result<Option<HistoricalReplayEnvelope>> {
    let directory = ProjectDirectory::open(root)?;
    let Some(locator) = read_json::<RunLocator>(&directory, &run_locator_path(run_id))? else {
        return Ok(None);
    };
    if locator.version != COMPACT_VERSION
        || locator.project_id_digest != project_identity_digest(&current_project_id(root)?)
        || locator.run_id != run_id
        || locator.run_id.is_nil()
        || locator.request_id.is_nil()
        || locator.terminal_revision == 0
    {
        bail!("Invalid processing run locator");
    }
    let replay = lookup_request(root, locator.request_id)?
        .context("Processing run locator lacks request binding")?;
    if replay.run_id != locator.run_id || replay.terminal_revision != locator.terminal_revision {
        bail!("Processing run locator conflicts with binding");
    }
    Ok(Some(replay))
}
pub(crate) fn persist(
    record: &ProcessingRecord,
    previous: Option<&ProcessingRecord>,
) -> Result<()> {
    record.validate(&record.project_root)?;
    let current = read_current(&record.project_root)?;
    match (current.as_ref(), previous) {
        (None, None) => {}
        (Some(current), Some(previous))
            if serde_json::to_value(current)? == serde_json::to_value(previous)?
                && record.run_id == previous.run_id
                && record.request.same_content(&previous.request)?
                && record.revision > previous.revision => {}
        _ => bail!("Processing record changed; explicit recovery required"),
    }
    publish(
        &ProjectDirectory::open(&record.project_root)?,
        &current_path(),
        record,
        previous.is_none(),
    )
}
pub(crate) fn validate_archives(root: &Path) -> Result<()> {
    let directory = ProjectDirectory::open(root)?;
    let runs = match directory.directory_names(&relative(format!("{AUTHORITY}/runs"))?) {
        Ok(runs) => runs,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let current = read_current(root)?;
    for run in runs {
        let run = run
            .to_str()
            .context("Invalid launch journal entry")?
            .parse::<Uuid>()
            .context("Invalid launch journal entry")?;
        if current.as_ref().is_some_and(|r| r.run_id == run) {
            continue;
        }
        super::journal::compaction_state(root, run)?;
    }
    Ok(())
}
pub(crate) fn admit(root: &Path, mut request: ProcessingRequest) -> Result<ProcessingRecord> {
    request.canonicalize()?;
    if request.project_id != current_project_id(root)? {
        bail!("Processing request identifies a different project");
    }
    if let Some(existing) = read_current(root)? {
        if !existing.directory_matches(root)? {
            bail!(
                "Copied unresolved processing record requires project activation and external-stop confirmation"
            );
        }
        if existing.request.request_id == request.request_id {
            if !existing.request.same_content(&request)? {
                bail!("Processing request identity reused with different content");
            }
            return Ok(existing);
        }
        if !existing.acknowledged {
            bail!("Processing run must settle and be acknowledged before replacement");
        }
        acknowledge(
            root,
            existing.run_id,
            existing
                .terminal_revision
                .context("Missing terminal revision")?,
        )?;
    }
    if lookup_request(root, request.request_id)?.is_some() {
        bail!("Processing request was compacted; use direct historical replay");
    }
    validate_archives(root)?;
    let project: serde_json::Value = serde_json::from_slice(
        &ProjectDirectory::open(root)?.read_regular(&relative("project.easl")?)?,
    )?;
    if project["projectMeta"]["id"].as_str() != Some(&request.project_id) {
        bail!("Processing request identifies a different project");
    }
    let data_source = project["projectMeta"]["dataSource"]
        .as_str()
        .context("Project data source is missing")?;
    if !matches!(data_source, "bids" | "dicom") {
        bail!("Invalid project data source");
    }
    let inventory =
        super::subjects::list_subjects(root.to_string_lossy().into(), Some(data_source.into()))
            .map_err(anyhow::Error::msg)?;
    let targets = expected_targets(&request, &inventory)?;
    let record = ProcessingRecord::new(root, request, targets)?;
    persist(&record, None)?;
    Ok(record)
}
pub(crate) fn expected_targets(
    request: &ProcessingRequest,
    inventory: &[SubjectInfo],
) -> Result<Vec<ExpectedTarget>> {
    let mut targets = Vec::new();
    for selected in &request.selected_subject_sessions {
        if !inventory.iter().any(|s| &s.subject_session == selected) {
            bail!("Selected Subject/Session absent from native inventory: {selected}");
        }
    }
    for module in &request.selected_modules {
        if module == "population" {
            targets.push(ExpectedTarget {
                module: module.clone(),
                subject_session: None,
                run: None,
                complete: false,
            });
            continue;
        }
        for subject in inventory.iter().filter(|s| {
            request.selected_subject_sessions.is_empty()
                || request
                    .selected_subject_sessions
                    .contains(&s.subject_session)
        }) {
            if module == "structural" && subject.has_structural {
                targets.push(ExpectedTarget {
                    module: module.clone(),
                    subject_session: Some(subject.subject_session.clone()),
                    run: None,
                    complete: false,
                });
            }
            if module == "asl" && subject.has_asl {
                for run in &subject.asl_runs {
                    targets.push(ExpectedTarget {
                        module: module.clone(),
                        subject_session: Some(subject.subject_session.clone()),
                        run: Some(super::identifiers::normalize_asl_run_id(run)),
                        complete: false,
                    });
                }
            }
        }
    }
    if targets.is_empty() {
        bail!("Selected processing work has no effective targets");
    }
    Ok(targets)
}
pub(crate) fn acknowledge(
    root: &Path,
    run_id: Uuid,
    terminal_revision: u64,
) -> Result<HistoricalReplayEnvelope> {
    // A published locator can coexist with the acknowledged full current
    // after interruption. Finish that exact current before historical replay.
    let current = read_current(root)?;
    let previous = match current {
        Some(current) if current.run_id == run_id => current,
        _ => {
            let replay = lookup_run(root, run_id)?.context("Unknown processing run UUID")?;
            if replay.terminal_revision != terminal_revision {
                bail!("Stale processing terminal revision");
            }
            return Ok(replay);
        }
    };
    if previous.terminal_revision != Some(terminal_revision) || !previous.lifecycle.is_terminal() {
        bail!("Stale processing terminal revision");
    }
    // Construct and byte-bound immutable replay before acknowledging anything.
    let replay = envelope(&previous)?;
    let acknowledged = if previous.acknowledged {
        previous
    } else {
        let mut next = previous.clone();
        next.acknowledged = true;
        next.available_action = AvailableAction::None;
        next.revision = next
            .revision
            .checked_add(1)
            .context("Processing revision exhausted")?;
        super::journal::checkpoint("beforeAcknowledge")?;
        persist(&next, Some(&previous))?;
        super::journal::checkpoint("afterAcknowledge")?;
        next
    };
    let directory = ProjectDirectory::open(root)?;
    super::journal::compaction_state(root, run_id)?;
    super::journal::checkpoint("beforeRequestBinding")?;
    publish_once(
        &directory,
        &request_binding_path(replay.request_id),
        &replay,
    )?;
    super::journal::checkpoint("afterRequestBinding")?;
    let locator = RunLocator {
        version: COMPACT_VERSION,
        project_id_digest: replay.project_id_digest.clone(),
        request_id: replay.request_id,
        run_id,
        terminal_revision,
    };
    super::journal::checkpoint("beforeRunLocator")?;
    publish_once(&directory, &run_locator_path(run_id), &locator)?;
    super::journal::checkpoint("afterRunLocator")?;
    super::journal::checkpoint("beforeCurrentRemoval")?;
    let current = relative(current_path())?;
    let raw: serde_json::Value = serde_json::from_slice(&directory.read_regular(&current)?)?;
    if raw != serde_json::to_value(&acknowledged)? {
        bail!("Processing current record changed during compaction");
    }
    directory.cleanup_owned_candidate(&current)?;
    super::journal::checkpoint("afterCurrentUnlink")
        .context("Processing current record removed; durability uncertain")?;
    directory
        .sync_parent(&current)
        .context("Processing current record removed; durability uncertain")?;
    super::journal::checkpoint("afterCurrentRemoval")?;
    Ok(replay)
}
