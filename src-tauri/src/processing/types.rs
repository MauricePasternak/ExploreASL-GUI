use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProcessingLifecycle {
    Preparing,
    Running,
    Finalizing,
    Completed,
    Cancelling,
    Cancelled,
    Failed,
    Interrupted,
}

impl ProcessingLifecycle {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("Illegal processing lifecycle transition: {from:?} -> {to:?}")]
pub struct ProcessingTransitionError {
    pub from: ProcessingLifecycle,
    pub to: ProcessingLifecycle,
}

impl From<ProcessingTransitionError> for String {
    fn from(error: ProcessingTransitionError) -> Self {
        error.to_string()
    }
}

pub fn validate_processing_transition(
    from: ProcessingLifecycle,
    to: ProcessingLifecycle,
) -> Result<(), ProcessingTransitionError> {
    use ProcessingLifecycle::*;
    let legal = matches!(
        (from, to),
        (Preparing, Running | Cancelling | Failed | Interrupted)
            | (Running, Finalizing | Cancelling | Failed | Interrupted)
            | (Cancelling, Cancelled | Failed | Interrupted)
            | (Finalizing, Completed | Failed | Cancelling | Interrupted)
    );
    if legal {
        Ok(())
    } else {
        Err(ProcessingTransitionError { from, to })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProcessingTerminalResult {
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl ProcessingTerminalResult {
    pub fn lifecycle(self) -> ProcessingLifecycle {
        match self {
            Self::Completed => ProcessingLifecycle::Completed,
            Self::Failed => ProcessingLifecycle::Failed,
            Self::Cancelled => ProcessingLifecycle::Cancelled,
            Self::Interrupted => ProcessingLifecycle::Interrupted,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProcessingVersions {
    pub explore_asl: String,
    pub matlab: String,
    pub gui: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingRunSnapshot {
    pub run_id: String,
    pub lifecycle: ProcessingLifecycle,
    pub project_root: String,
    pub selected_modules: Vec<String>,
    pub selected_subject_sessions: Vec<String>,
    pub start_time: u64,
    #[serde(skip_serializing)]
    pub watcher_owned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_result: Option<ProcessingTerminalResult>,
    pub revision: u64,
    pub request_id: Option<String>,
    pub expected_targets: Vec<super::record::ExpectedTarget>,
    pub logical_exits: Vec<super::record::LogicalWorkerExit>,
    pub worker_count: u32,
    pub error: Option<super::record::ProcessingError>,
    pub available_action: super::record::AvailableAction,
    pub terminal_summary: Option<super::record::ProcessingTerminalSummary>,
    pub terminal_revision: Option<u64>,
    pub execution_committed: bool,
    pub population_execution_committed: bool,
    pub versions: Option<Box<ProcessingVersions>>,
    pub population_ready_mtime_ms: Option<u64>,
}

#[derive(Debug)]
pub struct ProcessingRun {
    pub run_id: String,
    pub project_root: PathBuf,
    pub selected_modules: Vec<String>,
    pub selected_subject_sessions: Vec<String>,
    pub lifecycle: ProcessingLifecycle,
    pub start_time: u64,
    pub watcher_owned: bool,
    pub terminal_result: Option<ProcessingTerminalResult>,
    pub(crate) durable: Option<super::record::ProcessingRecord>,
}

impl ProcessingRun {
    pub fn new(
        run_id: String,
        project_root: PathBuf,
        selected_modules: Vec<String>,
        selected_subject_sessions: Vec<String>,
    ) -> Self {
        Self {
            run_id,
            project_root,
            selected_modules,
            selected_subject_sessions,
            lifecycle: ProcessingLifecycle::Preparing,
            start_time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            watcher_owned: false,
            terminal_result: None,
            durable: None,
        }
    }

    pub fn snapshot(&self) -> ProcessingRunSnapshot {
        if let Some(record) = &self.durable {
            return record.snapshot();
        }
        ProcessingRunSnapshot {
            run_id: self.run_id.clone(),
            lifecycle: self.lifecycle,
            project_root: self.project_root.to_string_lossy().to_string(),
            selected_modules: self.selected_modules.clone(),
            selected_subject_sessions: self.selected_subject_sessions.clone(),
            start_time: self.start_time,
            watcher_owned: self.watcher_owned,
            terminal_result: self.terminal_result,
            revision: 0,
            request_id: None,
            expected_targets: Vec::new(),
            logical_exits: Vec::new(),
            worker_count: 0,
            error: None,
            available_action: super::record::AvailableAction::None,
            terminal_summary: None,
            terminal_revision: None,
            execution_committed: false,
            population_execution_committed: false,
            versions: None,
            population_ready_mtime_ms: None,
        }
    }

    pub(crate) fn from_record(record: super::record::ProcessingRecord) -> Self {
        let mut run = Self::new(
            record.run_id.to_string(),
            record.project_root.clone(),
            record.request.selected_modules.clone(),
            record.request.selected_subject_sessions.clone(),
        );
        run.lifecycle = record.lifecycle;
        run.start_time = record.start_time;
        run.terminal_result = record.terminal_summary.as_ref().map(|s| s.result);
        run.durable = Some(record);
        run
    }
    pub(crate) fn unacknowledged(&self) -> bool {
        self.durable.as_ref().is_some_and(|r| !r.acknowledged)
    }

    pub fn belongs_to(&self, project_root: &Path) -> bool {
        self.project_root == project_root
    }

    pub fn transition(&mut self, to: ProcessingLifecycle) -> Result<(), String> {
        validate_processing_transition(self.lifecycle, to)?;
        if let Some(previous) = self.durable.as_ref() {
            let mut next = previous.clone();
            next.set_lifecycle(to).map_err(|e| e.to_string())?;
            super::record::persist(&next, Some(previous)).map_err(|e| e.to_string())?;
            self.durable = Some(next);
        }
        self.lifecycle = to;
        if to.is_terminal() {
            self.terminal_result = Some(match to {
                ProcessingLifecycle::Completed => ProcessingTerminalResult::Completed,
                ProcessingLifecycle::Failed => ProcessingTerminalResult::Failed,
                ProcessingLifecycle::Cancelled => ProcessingTerminalResult::Cancelled,
                ProcessingLifecycle::Interrupted => ProcessingTerminalResult::Interrupted,
                _ => unreachable!("nonterminal processing lifecycle"),
            });
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct ProcessState {
    pub(crate) settlement: std::sync::Arc<std::sync::Mutex<()>>,
    pub(crate) cancellation: Option<crate::process::CancellationToken>,
    pub(crate) supervisor_handle: Option<thread::JoinHandle<()>>,
    pub(crate) launch_in_progress: bool,
    pub current_run: Option<ProcessingRun>,
    pub watcher_handle: Option<thread::JoinHandle<()>>,
    pub watcher_stop: Option<mpsc::Sender<()>>,
    pub watcher_run_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInfo {
    pub subject_session: String,
    pub subject: String,
    pub session: String,
    pub has_structural: bool,
    #[serde(rename = "hasASL")]
    pub has_asl: bool,
    pub asl_runs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectModuleStatus {
    pub subject_session: String,
    #[serde(rename = "module")]
    pub module_name: String,
    pub run: Option<String>,
    pub status: String,
    pub completed_steps: Vec<String>,
    pub locked: bool,
    pub bids2legacy_exists: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub filename: String,
    pub module: String,
    pub subject_session: String,
    pub run: Option<String>,
    pub has_error: bool,
}

pub(super) struct ParsedLockComponents {
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFileCreated {
    pub run_id: String,
    pub module: String,
    pub subject_session: Option<String>,
    pub step_code: String,
    pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockCreated {
    pub run_id: String,
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockRemoved {
    pub run_id: String,
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportFileInfo {
    pub module: String, // "structural" | "asl" | "m0"
    pub subject_session: String,
    pub run: Option<String>,
}
