//! Read-only planning and fixed-path transactions for BIDS/DICOM project creation
//! and BIDS compatibility repair. Import relocation has separate semantics.
mod fault_injection;
mod filesystem;
mod journal;
mod planning;
mod recovery;
mod transaction;

pub use crate::project::validation::ProjectSummary;
#[cfg(test)]
pub use fault_injection::{SetupFault, SetupFaultGuard, inject_setup_fault};
pub use filesystem::classify_marker;
pub(crate) use filesystem::open_regular_no_follow;
pub use planning::{IgnorePlan, plan_bidsignore, preflight_for_state, verify};
pub use recovery::recover_root;
pub(crate) use recovery::{recover_root_after_processing_recovery, recover_root_owned};
pub(crate) use transaction::commit_for_app_state;
pub use transaction::commit_for_state;

use planning::CachedPlan;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

pub const RAWDATA_MARKER_PATH: &str = "rawdata/.easl-gui-managed";
pub const RAWDATA_MARKER_BYTES: &[u8] = b"{\"kind\":\"bids-direct-rawdata\",\"version\":1}\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum SetupMode {
    Bids,
    Dicom,
    Repair,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Create,
    Update,
    NoOp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetupOperation {
    pub path: String,
    pub operation: OperationKind,
    pub text_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetupCommitResult {
    pub outcome: String,
    pub project_path: Option<String>,
    pub project_document: Option<crate::project::model::ProjectDocument>,
    pub candidate_id: Option<String>,
    pub directory_sync_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetupRecoverySummary {
    #[specta(type = specta_typescript::Number)]
    pub recovered: usize,
    pub deferred_roots: Vec<String>,
    pub blocked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SetupCommandError {
    #[error("{message}")]
    Stale { message: String, details: String },
    #[error("{message}")]
    Conflict { message: String, details: String },
    #[error("{message}")]
    Rollback { message: String, details: String },
    #[error("{message}")]
    UncertainDurability { message: String, details: String },
    #[error("{message}")]
    RecoveryRequired { message: String, details: String },
    #[error("{message}")]
    Failed { message: String, details: String },
}

impl SetupCommandError {
    pub(crate) fn failed(error: anyhow::Error) -> Self {
        let error =
            crate::error::CommandError::from_error(&error, "Project setup could not be completed.");
        Self::Failed {
            message: error.message,
            details: error.details,
        }
    }
}

/// Classification of the only file owned by BIDS-direct setup. Keep this
/// separate from the planner so callers cannot mistake an arbitrary marker
/// name for GUI ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerClassification {
    Absent,
    Exact,
    Foreign,
    Unsafe,
}

#[derive(Default)]
pub struct SetupPlans(Mutex<BTreeMap<String, CachedPlan>>);

pub fn command_error(error: anyhow::Error) -> SetupCommandError {
    log::error!("Project setup failed: {error:#}");
    let diagnostic = format!("{error:#}");
    // A completed transaction outcome takes precedence over its original failure.
    let completed_rollback = error.chain().any(|cause| {
        cause
            .to_string()
            .starts_with("Setup changes rolled back after failure:")
    });
    if completed_rollback
        || diagnostic.contains("rolled back") && !diagnostic.contains("recovery required")
    {
        SetupCommandError::Rollback {
            message: "Project setup failed and its changes were rolled back.".into(),
            details:
                "The previous files were restored. Review a new setup plan before trying again."
                    .into(),
        }
    } else if diagnostic.contains("recovery required")
        || diagnostic.contains("ambiguous")
        || diagnostic.contains("recovery blocked")
    {
        SetupCommandError::RecoveryRequired {
            message: "Project setup requires recovery.".into(),
            details: "Keep the project files unchanged. Resolve the incomplete setup before trying again.".into(),
        }
    } else if diagnostic.contains("stale")
        || diagnostic.contains("expired")
        || diagnostic.contains("Unknown or superseded")
    {
        SetupCommandError::Stale {
            message: "The setup plan is out of date.".into(),
            details: "Create and review a new setup plan before trying again.".into(),
        }
    } else if diagnostic.contains("conflict")
        || diagnostic.contains("must be")
        || diagnostic.contains("already exists")
    {
        SetupCommandError::Conflict {
            message: "Project setup is blocked by a conflict.".into(),
            details: "Review the setup plan and resolve its conflicts before trying again.".into(),
        }
    } else if diagnostic.contains("synchronize") || diagnostic.contains("durability") {
        SetupCommandError::UncertainDurability {
            message: "Project setup may not be saved reliably.".into(),
            details: "Storage could not confirm the changes. Reopen the project to check recovery before continuing.".into(),
        }
    } else {
        SetupCommandError::Failed {
            message: "Project setup could not be completed.".into(),
            details: String::new(),
        }
    }
}

#[cfg(test)]
mod tests;
