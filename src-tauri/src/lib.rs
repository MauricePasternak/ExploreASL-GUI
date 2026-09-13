mod app_state;
mod apptainer;
pub(crate) mod runtime {
    pub use easl_execution_runtime::{fs_safety, process};
}
pub(crate) use runtime::{fs_safety, process};
pub mod bids;
mod commands;
mod error;
mod execution_managed;
pub mod execution_profile;
pub mod import;
pub mod manifest;
pub mod matlab;
mod niivue_protocol;
pub mod processing;
pub(crate) mod project_ownership;
mod project_runtime;
mod project_writer;
pub mod qc;
mod single_instance;
mod tracing;
pub mod visualization;
mod visualization_tests;

pub use bids::commands as bids_commands;
pub use import::parser as import_parser;
pub use import::relocation as import_relocation;

#[cfg(test)]
mod project_writer_tests;

use app_state::AppState;
use apptainer::which_apptainer;
use bids::commands::{
    check_bids_dataset, commit_bids_project_mutations, preflight_bids_project_mutations,
    preflight_bids_setup_repair, scan_bids_sidecars, verify_bids_compatibility_for_run,
};
use commands::{
    get_available_memory_mb, get_cpu_cores, inspect_source_path, is_writable, walk_directory,
};
use execution_profile::{validate_all_execution_profiles, validate_execution_profile};
use import::{
    acknowledge_import_run, attach_import_run, cancel_import_run, confirm_import_worker_stopped,
    get_active_import_run, launch_import_run, plan_import_relocation, preflight_staging_plan,
    read_import_status, reserve_import_run, stop_running_import_for_exit,
};
use manifest::read_prior_modules_mtimes;
use matlab::which_matlab;
use processing::{
    acknowledge_processing_run, attach_run, confirm_processing_workers_stopped,
    detect_exploreasl_version, get_active_run, kill_pipeline, list_module_logs,
    list_subject_reports, list_subjects, read_lock_status, read_module_logs, read_report_image,
    reserve_processing_run, run_pipeline, stop_running_processing_for_exit,
};
use project_runtime::shutdown_project_runtime;
use project_writer::{atomic_write_project, cleanup_project_temps};
use qc::{get_all_subjects_qc, get_subject_session_qc};
use tauri::Manager;
#[cfg(debug_assertions)]
use tauri::{LogicalSize, Size};
use visualization::{
    check_join_sanity, clear_active_project, execute_join, inspect_external_data, list_stats_files,
    load_qcbf_data, read_data_columns, set_active_project, stat_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        // Must remain first: second instances exit before any other plugin can
        // initialize project-facing behavior.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            single_instance::handle_second_instance(app, &args, &cwd);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin({
            #[allow(unused_mut)]
            let mut builder = tauri_plugin_log::Builder::default();
            #[cfg(debug_assertions)]
            {
                let log_dir = std::env::temp_dir().join("exploreasl-gui-logs");
                let _ = std::fs::create_dir_all(&log_dir);
                builder =
                    builder
                        .level(log::LevelFilter::Debug)
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: log_dir,
                                file_name: Some("dev.log".into()),
                            },
                        ));
            }
            builder.build()
        })
        .invoke_handler(tauri::generate_handler![
            which_matlab,
            which_apptainer,
            validate_execution_profile,
            validate_all_execution_profiles,
            is_writable,
            walk_directory,
            get_cpu_cores,
            get_available_memory_mb,
            inspect_source_path,
            preflight_staging_plan,
            plan_import_relocation,
            reserve_import_run,
            get_active_import_run,
            attach_import_run,
            launch_import_run,
            cancel_import_run,
            confirm_import_worker_stopped,
            acknowledge_import_run,
            read_import_status,
            list_subjects,
            read_lock_status,
            reserve_processing_run,
            acknowledge_processing_run,
            confirm_processing_workers_stopped,
            get_active_run,
            attach_run,
            run_pipeline,
            kill_pipeline,
            detect_exploreasl_version,
            list_module_logs,
            read_module_logs,
            read_prior_modules_mtimes,
            list_subject_reports,
            read_report_image,
            list_stats_files,
            load_qcbf_data,
            read_data_columns,
            inspect_external_data,
            execute_join,
            set_active_project,
            clear_active_project,
            check_join_sanity,
            stat_file,
            get_subject_session_qc,
            get_all_subjects_qc,
            check_bids_dataset,
            scan_bids_sidecars,
            preflight_bids_project_mutations,
            preflight_bids_setup_repair,
            commit_bids_project_mutations,
            verify_bids_compatibility_for_run,
            atomic_write_project,
            cleanup_project_temps,
            shutdown_project_runtime,
        ])
        .register_uri_scheme_protocol("niivue", niivue_protocol::handle_niivue_protocol)
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            *app.state::<AppState>()
                .setup_app_data
                .lock()
                .map_err(|_| anyhow::anyhow!("Setup app-data state lock was poisoned"))? =
                Some(app_data.clone());
            let recovery = bids::setup::recover_at_startup(&app_data)?;
            for root in recovery.deferred_roots {
                log::warn!("Deferred BIDS setup recovery until root is available: {root}");
            }
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon)?;
                #[cfg(debug_assertions)]
                {
                    window.set_size(Size::Logical(LogicalSize::new(800.0, 900.0)))?;
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let import = stop_running_import_for_exit(app_handle);
                if let Err(error) = &import {
                    log::error!("Failed to stop running import during app exit: {}", error);
                }
                let processing = stop_running_processing_for_exit(app_handle);
                if let Err(error) = &processing {
                    log::error!(
                        "Failed to stop running processing during app exit: {}",
                        error
                    );
                }

                match project_runtime::native_exit_decision(&import, &processing) {
                    project_runtime::NativeExitDecision::Allow => {}
                    project_runtime::NativeExitDecision::Prevent => api.prevent_exit(),
                    project_runtime::NativeExitDecision::PreventThenExit => {
                        api.prevent_exit();
                        app_handle.exit(code.unwrap_or(0));
                    }
                }
            }
        });
}

#[cfg(test)]
mod project_ownership_tests;
