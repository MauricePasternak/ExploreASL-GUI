use super::parser::ImportStructuredEvent;
use super::staging::StagingValidationIssue;
use std::path::PathBuf;
use std::thread;

/// State owned by native code.  This deliberately has more states than the
/// renderer: a child exiting is not completion; verification and relocation
/// still own project output while the run is `Finalizing`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImportLifecycle {
    Idle,
    Preparing,
    Running,
    Finalizing,
    Completed,
    Failed,
    Cancelling,
    Cancelled,
    Interrupted,
}

impl ImportLifecycle {
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }

    pub const fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (
                Self::Preparing,
                Self::Running | Self::Failed | Self::Cancelling | Self::Interrupted
            ) | (
                Self::Running,
                Self::Finalizing | Self::Cancelling | Self::Interrupted
            ) | (
                Self::Cancelling,
                Self::Running | Self::Cancelled | Self::Failed
            ) | (
                Self::Finalizing,
                Self::Completed | Self::Failed | Self::Cancelled
            )
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportStructuredError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staging_issues: Option<Vec<StagingValidationIssue>>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImportSubjectOutcomeKind {
    Verified,
    Committed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportSubjectOutcome {
    pub subject: String,
    pub outcome: ImportSubjectOutcomeKind,
    pub ready_lock_verified: bool,
    pub rawdata_verified: bool,
    pub committed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ImportStructuredError>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportExitEvidence {
    pub exit_code: i32,
    pub successful: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImportTerminalResult {
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

/// Public, path-free contract.  Do not add a PID, process handle, staging
/// path, or project root here: snapshots are IPC/replay data.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRunSnapshot {
    pub run_id: String,
    pub lifecycle: ImportLifecycle,
    #[specta(type = specta_typescript::Number)]
    pub ownership_generation: u64,
    pub profile_id: String,
    pub selected_subjects: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub created_at_ms: u128,
    #[specta(type = specta_typescript::Number)]
    pub updated_at_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_evidence: Option<ImportExitEvidence>,
    pub subject_outcomes: Vec<ImportSubjectOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relocation_outcome: Option<super::relocation::RelocationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ImportStructuredError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_result: Option<ImportTerminalResult>,
    #[serde(default)]
    pub confirmation_required: bool,
}

pub struct ImportState {
    pub lifecycle: ImportLifecycle,
    pub ownership_generation: u64,
    /// Native generated ID. PID and frontend request IDs are never authority.
    pub run_id: String,
    pub launch_in_progress: bool,
    /// Transient only. No process identity or containment proof enters records.
    pub cancellation: Option<crate::process::CancellationToken>,
    pub supervisor_handle: Option<thread::JoinHandle<()>>,
    pub staging_root: PathBuf,
    pub project_root: PathBuf,
    pub subject_list: Vec<String>,
    pub preserved_subjects: Vec<String>,
    pub preserve_staging: bool,
    pub relocation_plan_id: Option<String>,
    /// Full confirmed plan remains native-only. Its serializable inventory is
    /// copied into the durable run record for finalization recovery.
    pub relocation_plan: Option<super::relocation::RelocationPlan>,
    pub profile_id: String,
    pub admitted_config: Option<crate::project::model::ImportSnapshot>,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub staging_generation: String,
    pub exit_evidence: Option<ImportExitEvidence>,
    pub subject_outcomes: Vec<ImportSubjectOutcome>,
    pub relocation_outcome: Option<super::relocation::RelocationOutcome>,
    pub error: Option<ImportStructuredError>,
    pub terminal_result: Option<ImportTerminalResult>,
    pub confirmation_required: bool,
    pub acknowledged: bool,
}

impl ImportState {
    pub fn new(staging_root: PathBuf, project_root: PathBuf, subject_list: Vec<String>) -> Self {
        Self {
            lifecycle: ImportLifecycle::Preparing,
            ownership_generation: 0,
            run_id: String::new(),
            launch_in_progress: false,
            cancellation: None,
            supervisor_handle: None,
            staging_root,
            project_root,
            subject_list,
            preserved_subjects: Vec::new(),
            preserve_staging: false,
            relocation_plan_id: None,
            relocation_plan: None,
            profile_id: String::new(),
            admitted_config: None,
            created_at_ms: now_ms(),
            updated_at_ms: now_ms(),
            staging_generation: String::new(),
            exit_evidence: None,
            subject_outcomes: Vec::new(),
            relocation_outcome: None,
            error: None,
            terminal_result: None,
            confirmation_required: false,
            acknowledged: false,
        }
    }
}

impl Default for ImportState {
    fn default() -> Self {
        Self {
            lifecycle: ImportLifecycle::Idle,
            ownership_generation: 0,
            run_id: String::new(),
            launch_in_progress: false,
            cancellation: None,
            supervisor_handle: None,
            staging_root: PathBuf::new(),
            project_root: PathBuf::new(),
            subject_list: Vec::new(),
            preserved_subjects: Vec::new(),
            preserve_staging: false,
            relocation_plan_id: None,
            relocation_plan: None,
            profile_id: String::new(),
            admitted_config: None,
            created_at_ms: 0,
            updated_at_ms: 0,
            staging_generation: String::new(),
            exit_evidence: None,
            subject_outcomes: Vec::new(),
            relocation_outcome: None,
            error: None,
            terminal_result: None,
            confirmation_required: false,
            acknowledged: false,
        }
    }
}

pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

impl ImportState {
    pub fn snapshot(&self) -> ImportRunSnapshot {
        ImportRunSnapshot {
            run_id: self.run_id.clone(),
            lifecycle: self.lifecycle,
            ownership_generation: self.ownership_generation,
            profile_id: self.profile_id.clone(),
            selected_subjects: self.subject_list.clone(),
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
            exit_evidence: self.exit_evidence.clone(),
            subject_outcomes: self.subject_outcomes.clone(),
            relocation_outcome: self.relocation_outcome.clone(),
            error: self.error.clone(),
            terminal_result: self.terminal_result.clone(),
            confirmation_required: self.confirmation_required,
        }
    }

    pub fn transition(&mut self, next: ImportLifecycle) -> Result<(), String> {
        if !self.lifecycle.can_transition_to(next) {
            return Err(format!(
                "Illegal import lifecycle transition {:?} -> {:?}",
                self.lifecycle, next
            ));
        }
        self.lifecycle = next;
        self.updated_at_ms = now_ms();
        Ok(())
    }
}

#[derive(Debug, serde::Serialize, specta::Type, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportCommandError {
    #[error("{message}")]
    Preflight {
        message: String,
        details: String,
        issues: Vec<StagingValidationIssue>,
    },
    #[error("{message}")]
    Operational { message: String, details: String },
}

impl ImportCommandError {
    pub(super) fn preflight(issues: Vec<StagingValidationIssue>) -> Self {
        Self::Preflight {
            message: "Import staging preflight failed".into(),
            details: "Review the staging issues and correct them before starting import again."
                .into(),
            issues,
        }
    }
}

impl From<String> for ImportCommandError {
    fn from(error: String) -> Self {
        anyhow::Error::msg(error).into()
    }
}

impl From<anyhow::Error> for ImportCommandError {
    fn from(error: anyhow::Error) -> Self {
        let error = crate::error::CommandError::from_error(&error, "Import could not be started.");
        Self::Operational {
            message: error.message,
            details: error.details,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSubjectStatus {
    pub subject: String,
    pub status: ImportSubjectStatusKind,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImportSubjectStatusKind {
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportRawEventPayload {
    pub line: String,
    pub run_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportStructuredEventPayload {
    #[serde(flatten)]
    pub event: ImportStructuredEvent,
    pub run_id: String,
    pub ownership_generation: u64,
}
