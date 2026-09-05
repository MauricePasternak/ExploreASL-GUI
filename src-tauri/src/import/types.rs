use super::parser::ImportStructuredEvent;
use super::staging::StagingValidationIssue;
use std::path::PathBuf;
use std::thread;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportLifecycle {
    Idle,
    Preparing,
    Running,
    Terminal,
}

#[derive(Debug)]
pub struct ImportState {
    pub lifecycle: ImportLifecycle,
    pub ownership_generation: u64,
    /// Frontend-generated correlation metadata. Native ownership remains the
    /// authoritative generation; this value only prevents queued WebView
    /// events from being accepted by a later frontend request.
    pub run_request_id: String,
    pub child_pid: Option<u32>,
    pub supervisor_handle: Option<thread::JoinHandle<()>>,
    pub termination_requested_for: Option<u32>,
    pub staging_root: PathBuf,
    pub project_root: PathBuf,
    pub failed_subjects: Vec<String>,
    pub succeeded_subjects: Vec<String>,
    pub subject_list: Vec<String>,
    pub relocation_plan_id: Option<String>,
}

impl ImportState {
    pub fn new(staging_root: PathBuf, project_root: PathBuf, subject_list: Vec<String>) -> Self {
        Self {
            lifecycle: ImportLifecycle::Terminal,
            ownership_generation: 0,
            run_request_id: String::new(),
            child_pid: None,
            supervisor_handle: None,
            termination_requested_for: None,
            staging_root,
            project_root,
            failed_subjects: Vec::new(),
            succeeded_subjects: Vec::new(),
            subject_list,
            relocation_plan_id: None,
        }
    }
}

impl Default for ImportState {
    fn default() -> Self {
        Self {
            lifecycle: ImportLifecycle::Idle,
            ownership_generation: 0,
            run_request_id: String::new(),
            child_pid: None,
            supervisor_handle: None,
            termination_requested_for: None,
            staging_root: PathBuf::new(),
            project_root: PathBuf::new(),
            failed_subjects: Vec::new(),
            succeeded_subjects: Vec::new(),
            subject_list: Vec::new(),
            relocation_plan_id: None,
        }
    }
}

#[derive(Debug, serde::Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportCommandError {
    #[error("Import staging preflight failed")]
    Preflight { issues: Vec<StagingValidationIssue> },
    #[error("{message}")]
    Operational { message: String },
}

impl From<String> for ImportCommandError {
    fn from(message: String) -> Self {
        Self::Operational { message }
    }
}

impl From<anyhow::Error> for ImportCommandError {
    fn from(error: anyhow::Error) -> Self {
        Self::Operational {
            message: format!("{error:#}"),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSubjectStatus {
    pub subject: String,
    pub status: ImportSubjectStatusKind,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportSubjectStatusKind {
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPrepareComplete {
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatlabExitError {
    pub exit_code: i32,
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRawEventPayload {
    pub line: String,
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStructuredEventPayload {
    #[serde(flatten)]
    pub event: ImportStructuredEvent,
    pub run_request_id: String,
    pub ownership_generation: u64,
}
