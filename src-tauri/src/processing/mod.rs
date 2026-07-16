mod locks;
mod logs;
mod pipeline;
mod reports;
mod subjects;
mod types;
mod utils;
mod watcher;

#[cfg(test)]
mod tests;

// Re-export the types and commands so that crate::processing::* works exactly the same
// way, avoiding breaking src-tauri/src/lib.rs or other modules.
pub use locks::{clear_stale_locks, read_lock_status};
pub use logs::{list_module_logs, read_module_logs};
pub use pipeline::{
    detect_exploreasl_version, kill_pipeline, run_pipeline, stop_running_processing_for_exit,
};
pub use reports::{list_subject_reports, read_report_image};
pub use subjects::list_subjects;
pub use types::*;
pub(crate) use utils::{check_log_for_error, exploreasl_log_dirs};
pub use utils::{module_index_to_name, normalize_asl_run_id, normalize_asl_run_id_opt};
pub use watcher::{stop_watch_lock_dir, watch_lock_dir};
