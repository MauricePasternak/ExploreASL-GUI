//! Import workflow: run ownership, staging, output parsing, verification and relocation.
//!
//! `execution` owns shared profile validation and launch support; `process` owns
//! OS process scopes. Import owns the scientific evidence and terminal result.

pub(crate) mod commands;
pub(crate) mod discovery;
mod finalization;
mod output;
pub mod parser;
mod pipeline;
mod record;
pub mod relocation;
mod runs;
pub(crate) mod staging;
pub(crate) mod status;
mod supervisor;
mod types;
pub(crate) mod validation;
mod verification;

pub use self::commands::{
    acknowledge_import_run, attach_import_run, cancel_import_run, confirm_import_worker_stopped,
    get_active_import_run, launch_import_run, plan_import_relocation, preflight_staging_plan,
    read_import_status, reserve_import_run,
};
pub use self::output::{cleanup_staging_root, validate_subject_components};
pub(crate) use self::runs::{
    recover_import_run_after_processing_recovery, recover_processing_before_import,
};
pub use self::staging::{
    StagingEntry, StagingField, StagingIssueCode, StagingPreflightResult, StagingValidationIssue,
};

pub(crate) use self::status::import_lock_dir_for_relocation;
pub(crate) use self::supervisor::{stop_import_run_for_state, stop_running_import_for_exit};
pub use self::types::{
    ImportCommandError, ImportExitEvidence, ImportLifecycle, ImportRawEventPayload,
    ImportRunSnapshot, ImportState, ImportStructuredError, ImportStructuredEventPayload,
    ImportSubjectOutcome, ImportSubjectOutcomeKind, ImportSubjectStatus, ImportSubjectStatusKind,
    ImportTerminalResult,
};
pub use self::validation::{
    find_executable_on_path, rollback_preparation_failure, validate_import_request_inputs,
    validate_matlab_executable, validate_staging_root, validate_subject_scope,
};

#[cfg(test)]
mod tests;
