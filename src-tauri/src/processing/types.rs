use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
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
        (Preparing, Running | Failed)
            | (Running, Finalizing | Cancelling | Failed | Interrupted)
            | (Cancelling, Cancelled | Failed)
            | (Finalizing, Completed | Failed)
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
#[serde(rename_all = "camelCase")]
pub struct WorkerExitEvidence {
    pub pid: u32,
    pub exit_code: i32,
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
    pub workers: Vec<u32>,
    pub exit_evidence: Vec<WorkerExitEvidence>,
    pub watcher_owned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_result: Option<ProcessingTerminalResult>,
    /// Launch may fail after earlier workers have started. This evidence keeps
    /// the nonterminal run actionable until its remaining workers exit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_launch_failure: Option<String>,
}

#[derive(Debug)]
pub struct ProcessingRun {
    pub run_id: String,
    pub project_root: PathBuf,
    pub selected_modules: Vec<String>,
    pub selected_subject_sessions: Vec<String>,
    pub lifecycle: ProcessingLifecycle,
    pub start_time: u64,
    pub workers: BTreeSet<u32>,
    pub exit_evidence: Vec<WorkerExitEvidence>,
    pub watcher_owned: bool,
    pub terminal_result: Option<ProcessingTerminalResult>,
    pub pending_launch_failure: Option<String>,
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
            workers: BTreeSet::new(),
            exit_evidence: Vec::new(),
            watcher_owned: false,
            terminal_result: None,
            pending_launch_failure: None,
        }
    }

    pub fn snapshot(&self) -> ProcessingRunSnapshot {
        ProcessingRunSnapshot {
            run_id: self.run_id.clone(),
            lifecycle: self.lifecycle,
            project_root: self.project_root.to_string_lossy().to_string(),
            selected_modules: self.selected_modules.clone(),
            selected_subject_sessions: self.selected_subject_sessions.clone(),
            start_time: self.start_time,
            workers: self.workers.iter().copied().collect(),
            exit_evidence: self.exit_evidence.clone(),
            watcher_owned: self.watcher_owned,
            terminal_result: self.terminal_result,
            pending_launch_failure: self.pending_launch_failure.clone(),
        }
    }

    pub fn belongs_to(&self, project_root: &Path) -> bool {
        self.project_root == project_root
    }

    pub fn transition(&mut self, to: ProcessingLifecycle) -> Result<(), ProcessingTransitionError> {
        validate_processing_transition(self.lifecycle, to)?;
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

#[derive(Debug, Default)]
pub struct ProcessState {
    pub current_run: Option<ProcessingRun>,
    pub worker_supervisors: Vec<WorkerSupervisor>,
    pub watcher_handle: Option<thread::JoinHandle<()>>,
    pub watcher_stop: Option<mpsc::Sender<()>>,
    pub watcher_run_id: Option<String>,
}

#[derive(Debug)]
pub struct WorkerSupervisor {
    pub run_id: String,
    pub handle: thread::JoinHandle<()>,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerExited {
    pub run_id: String,
    pub pid: u32,
    pub exit_code: i32,
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
