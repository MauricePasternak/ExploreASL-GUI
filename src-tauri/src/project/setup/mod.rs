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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupCommitResult {
    pub outcome: String,
    pub project_path: Option<String>,
    pub project_document: Option<crate::project::model::ProjectDocument>,
    pub candidate_id: Option<String>,
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

#[cfg(test)]
mod tests;
