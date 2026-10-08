use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SubjectFailurePhase {
    CandidatePreparation,
    Journal,
    Backup,
    Install,
    CommitVerification,
    Commit,
}

impl SubjectFailurePhase {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::CandidatePreparation => "candidatePreparation",
            Self::Journal => "journal",
            Self::Backup => "backup",
            Self::Install => "install",
            Self::CommitVerification => "commitVerification",
            Self::Commit => "commit",
        }
    }
}

impl std::fmt::Display for SubjectFailurePhase {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OwnedPathRole {
    Candidate,
    Backup,
}

impl OwnedPathRole {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::Backup => "backup",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubjectInventory {
    pub subject: String,
    pub entries: Vec<RelocationEntry>,
    pub file_count: u64,
    pub byte_total: u64,
    pub sessions: Vec<String>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelocationOutcome {
    pub plan_id: String,
    pub generation: u64,
    pub subjects: Vec<SubjectRelocationOutcome>,
    pub staging_cleanup_complete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
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
    pub(super) version: u32,
    pub(super) project_identity: String,
    pub(super) generation: u64,
    pub(super) plan_id: String,
    pub(super) plan_fingerprint: String,
    pub(super) dataset: JournalDataset,
    pub(super) subjects: Vec<JournalSubject>,
    pub(super) terminal_outcome: Option<RelocationOutcome>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JournalSubject {
    pub(super) subject: String,
    pub(super) phase: SubjectPhase,
    pub(super) rawdata: JournalRawdata,
    pub(super) derived_reconciled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum SubjectPhase {
    Planned,
    Prepared,
    Committing,
    Committed,
    RolledBack,
    RecoveryRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RawdataPhase {
    Planned,
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
pub(super) struct JournalRawdata {
    pub(super) destination: String,
    pub(super) candidate: String,
    pub(super) backup: String,
    pub(super) had_destination: bool,
    pub(super) phase: RawdataPhase,
    pub(super) candidate_fingerprint: Option<String>,
    pub(super) backup_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum DatasetPhase {
    NotRequired,
    Planned,
    InstallIntent,
    Installed,
    ExistingWon,
    RollbackIntent,
    RolledBack,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JournalDataset {
    pub(super) source_present: bool,
    pub(super) destination_existed: bool,
    pub(super) destination: String,
    pub(super) candidate: String,
    pub(super) phase: DatasetPhase,
    pub(super) fingerprint: Option<String>,
}
