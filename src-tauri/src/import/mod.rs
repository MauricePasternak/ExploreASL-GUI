mod commands;
mod output;
pub mod parser;
mod pipeline;
pub mod relocation;
pub(crate) mod staging;
mod state;
mod status;
mod types;
mod validation;

pub use self::commands::{
    clean_import_status, copy_lock_files, move_import_output, plan_import_relocation,
    preflight_staging_plan, read_import_status, run_import_pipeline, stop_active_import,
    stop_import,
};
#[cfg(test)]
use self::output::move_import_output_for_state;
pub use self::output::{
    cleanup_staging_root, move_import_output_paths, validate_project_root_for_staging,
    validate_subject_components,
};
pub use self::pipeline::{
    authorize_stop_import_pid, mark_import_termination_requested, should_emit_matlab_exit_error,
    stop_import_pid, stop_import_pid_for_exit, stop_running_import_for_exit,
};
#[cfg(test)]
use self::pipeline::{
    build_apptainer_import_args, canonicalize_import_event_subject,
    clear_matching_termination_intent, record_import_results, start_supervisor_or_reap,
    stop_import_pid_with, take_matching_supervisor_handle,
};
pub use self::staging::{
    StagingEntry, StagingField, StagingIssueCode, StagingPreflightResult, StagingValidationIssue,
};
pub(crate) use self::state::RESERVED_IMPORT_PID;
#[cfg(test)]
use self::state::mark_import_terminal_if_matches;
#[cfg(test)]
use self::state::{
    cleanup_after_prepare_event_failure, clear_reserved_import, reserve_import_state,
    reserve_import_state_for_run, rollback_process_spawn_failure, set_reserved_import_pid,
};
pub(crate) use self::status::import_lock_dir_for_relocation;
#[cfg(test)]
use self::status::{clean_import_status_for_state, copy_lock_files_for_state};
pub use self::status::{clean_import_status_paths, copy_lock_files_paths};
pub use self::types::{
    ImportCommandError, ImportLifecycle, ImportPrepareComplete, ImportRawEventPayload, ImportState,
    ImportStructuredEventPayload, ImportSubjectStatus, ImportSubjectStatusKind, MatlabExitError,
};
#[cfg(test)]
use self::validation::normalize_staging_subject_spelling;
pub use self::validation::{
    find_executable_on_path, rollback_preparation_failure, validate_import_not_running,
    validate_import_request_inputs, validate_matlab_executable, validate_non_empty_inputs,
    validate_staging_root, validate_subject_scope,
};
pub use crate::app_state::AppState;

#[cfg(test)]
mod tests;
