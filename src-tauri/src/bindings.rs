//! One command registry for native dispatch and explicit TypeScript generation.
use crate::{
    bids, execution, import, manifest, processing,
    project::{config, lifecycle, source_paths},
    qc, system, visualization,
};
use specta_typescript::Typescript;
use std::path::Path;
use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};

pub(crate) fn command_registry() -> Builder<tauri::Wry> {
    Builder::new()
        // ponytail: preserve existing JSON numbers; use strings if integer precision becomes necessary.
        .dangerously_cast_bigints_to_number()
        .types(&json_wire_types())
        .commands(collect_commands![
            execution::matlab::which_matlab,
            execution::apptainer::which_apptainer,
            execution::profile::validate_execution_profile,
            execution::profile::validate_all_execution_profiles,
            source_paths::is_writable,
            import::discovery::walk_directory,
            system::get_cpu_cores,
            system::get_available_memory_mb,
            source_paths::inspect_source_path,
            config::inspect_project,
            config::activate_project,
            config::copy_project_candidate,
            config::create_project,
            config::accept_project_edit,
            config::get_project_snapshot,
            config::current_project_snapshot,
            config::save_project,
            config::reconcile_import_result,
            config::reconcile_processing_result,
            import::commands::preflight_staging_plan,
            import::commands::plan_import_relocation,
            import::commands::reserve_import_run,
            import::commands::get_active_import_run,
            import::commands::attach_import_run,
            import::commands::launch_import_run::<tauri::Wry>,
            import::commands::cancel_import_run,
            import::commands::confirm_import_worker_stopped,
            import::commands::read_import_status,
            processing::subjects::list_subjects,
            processing::locks::read_lock_status,
            processing::runs::reserve_processing_run,
            processing::runs::confirm_processing_workers_stopped,
            processing::runs::get_active_run,
            processing::runs::attach_run,
            processing::pipeline::run_pipeline::<tauri::Wry>,
            processing::pipeline::kill_pipeline::<tauri::Wry>,
            processing::pipeline::detect_exploreasl_version,
            processing::logs::list_module_logs,
            processing::logs::read_module_logs,
            manifest::read_prior_modules_mtimes,
            processing::reports::list_subject_reports,
            processing::reports::read_report_image,
            visualization::stats::list_stats_files,
            visualization::stats::load_qcbf_data,
            visualization::data::read_data_columns,
            visualization::external::inspect_external_data,
            visualization::join::execute_join,
            lifecycle::clear_active_project,
            visualization::join::check_join_sanity,
            visualization::external::stat_file,
            qc::get_subject_session_qc,
            qc::get_all_subjects_qc,
            bids::commands::check_bids_dataset,
            bids::commands::scan_bids_sidecars,
            bids::commands::preflight_bids_project_mutations,
            bids::commands::preflight_bids_setup_repair,
            bids::commands::commit_bids_project_mutations,
            lifecycle::shutdown_project_runtime,
        ])
        .typ::<crate::project::validation::ProjectParseError>()
        .error_handling(ErrorHandlingMode::Result)
        .typed_error_impl(include_str!("../../src/lib/ipcRuntime.ts"))
}

fn json_wire_types() -> specta::Types {
    let mut types = specta::Types::default().register::<serde_json::Value>();
    // Loose scientific JSON uses JavaScript's existing finite-number contract,
    // not integer identity semantics. Keep this exception specific to JSON Value.
    types.iter_mut(|ty| {
        if ty.module_path == "serde_json" && ty.name == "Value" {
            ty.ty = Some(specta::datatype::DataType::Reference(
                specta_typescript::define(
                    "null | boolean | number | string | Value[] | { [key: string]: Value }",
                ),
            ));
        }
    });
    types
}

/// Called only by the standalone exporter, never startup or backend tests.
pub fn export_bindings(path: &Path) -> Result<(), specta_typescript::Error> {
    command_registry().export(Typescript::default(), path)
}

#[cfg(test)]
#[path = "bindings_test.rs"]
mod tests;
