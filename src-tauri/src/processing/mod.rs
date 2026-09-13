pub(crate) mod journal;
mod locks;
mod logs;
mod participants;
pub(crate) mod pipeline;
mod preparation;
pub(crate) mod record;
pub(crate) mod recovery;
mod reports;
pub(crate) mod runs;
mod subjects;
pub(crate) mod transaction;
mod types;
mod utils;
mod watcher;

#[cfg(test)]
mod tests;

// Re-export the types and commands so that crate::processing::* works exactly the same
// way, avoiding breaking src-tauri/src/lib.rs or other modules.
pub use locks::read_lock_status;
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
pub(crate) use utils::{completion_from_lock_or_log, exploreasl_log_dirs, lock_module_roots};
pub use utils::{module_index_to_name, normalize_asl_run_id, normalize_asl_run_id_opt};
