//! ExploreASL desktop backend. Feature modules own workflow policy;
//! execution helpers and the runtime crate provide shared engine/OS mechanisms.
mod app;
pub mod bids;
mod bindings;
mod error;
pub mod execution;
pub mod import;
pub mod manifest;
pub mod processing;
pub mod project;
pub mod qc;
mod system;
mod tracing;
pub mod visualization;

pub(crate) use easl_execution_runtime::{fs_safety, process};

pub use bids::commands as bids_commands;
pub use bindings::export_bindings;
pub use import::parser as import_parser;
pub use import::relocation as import_relocation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::bootstrap::run();
}
