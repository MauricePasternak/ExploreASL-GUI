//! Processing workflow: admission, preparation, worker ownership and settlement.
//!
//! Shared engine profiles, probes and command helpers live in `crate::execution`.
mod completion;
mod identifiers;
pub(crate) mod journal;
pub(crate) mod locks;
pub(crate) mod logs;
mod participants;
pub(crate) mod pipeline;
mod preparation;
pub(crate) mod record;
pub(crate) mod recovery;
pub(crate) mod reports;
pub(crate) mod runs;
pub(crate) mod subjects;
pub(crate) mod transaction;
mod types;
mod watcher;

#[cfg(test)]
mod tests;

// Re-export the types and commands so that crate::processing::* works exactly the same
// way, avoiding breaking src-tauri/src/lib.rs or other modules.
pub(crate) use completion::completion_from_lock_or_log;
pub use identifiers::{module_index_to_name, normalize_asl_run_id, normalize_asl_run_id_opt};
pub(crate) use locks::lock_module_roots;
pub use locks::read_lock_status;
pub(crate) use logs::exploreasl_log_dirs;
pub use logs::{list_module_logs, read_module_logs};
pub use pipeline::{
    detect_exploreasl_version, kill_pipeline, run_pipeline, stop_running_processing_for_exit,
};
pub use record::{
    HistoricalReplayEnvelope, ParticipantGroup, ParticipantInputs, ParticipantRow,
    ProcessingAdmission, ProcessingRequest, ProcessingReservation,
};
pub use reports::{list_subject_reports, read_report_image};
pub use runs::{
    acknowledge_processing_run, attach_run, confirm_processing_workers_stopped, get_active_run,
    reserve_processing_run,
};
pub use subjects::list_subjects;
pub use types::*;
