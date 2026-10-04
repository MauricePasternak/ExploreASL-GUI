//! Tauri wiring, startup recovery, and application exit coordination.
use super::{single_instance, state::AppState};
use crate::{
    bids, execution, import, manifest, processing,
    project::{lifecycle, persistence, source_paths},
    qc, system, visualization,
};
use tauri::Manager;
#[cfg(debug_assertions)]
use tauri::{LogicalSize, Size};

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
        // Defining-module paths also resolve Tauri's generated command macros.
        .invoke_handler(tauri::generate_handler![
            execution::matlab::which_matlab,
            execution::apptainer::which_apptainer,
            execution::profile::validate_execution_profile,
            execution::profile::validate_all_execution_profiles,
            source_paths::is_writable,
            import::discovery::walk_directory,
            system::get_cpu_cores,
            system::get_available_memory_mb,
            source_paths::inspect_source_path,
            import::commands::preflight_staging_plan,
            import::commands::plan_import_relocation,
            import::commands::reserve_import_run,
            import::commands::get_active_import_run,
            import::commands::attach_import_run,
            import::commands::launch_import_run,
            import::commands::cancel_import_run,
            import::commands::confirm_import_worker_stopped,
            import::commands::acknowledge_import_run,
            import::commands::read_import_status,
            processing::subjects::list_subjects,
            processing::locks::read_lock_status,
            processing::runs::reserve_processing_run,
            processing::runs::acknowledge_processing_run,
            processing::runs::confirm_processing_workers_stopped,
            processing::runs::get_active_run,
            processing::runs::attach_run,
            processing::pipeline::run_pipeline,
            processing::pipeline::kill_pipeline,
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
            lifecycle::set_active_project,
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
            persistence::atomic_write_project,
            persistence::cleanup_project_temps,
            lifecycle::shutdown_project_runtime,
        ])
        .register_uri_scheme_protocol(
            "niivue",
            crate::visualization::niivue_protocol::handle_niivue_protocol,
        )
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            *app.state::<AppState>()
                .setup_app_data
                .lock()
                .map_err(|_| anyhow::anyhow!("Setup app-data state lock was poisoned"))? =
                Some(app_data.clone());
            let recovery = crate::project::setup::recover_at_startup(&app_data)?;
            for root in recovery.deferred_roots {
                log::warn!("Deferred BIDS setup recovery until root is available: {root}");
            }
            let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/icon.png"))?;
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
                let import = import::stop_running_import_for_exit(app_handle);
                if let Err(error) = &import {
                    log::error!("Failed to stop running import during app exit: {}", error);
                }
                let processing = processing::stop_running_processing_for_exit(app_handle);
                if let Err(error) = &processing {
                    log::error!(
                        "Failed to stop running processing during app exit: {}",
                        error
                    );
                }

                match lifecycle::native_exit_decision(&import, &processing) {
                    lifecycle::NativeExitDecision::Allow => {}
                    lifecycle::NativeExitDecision::Prevent => api.prevent_exit(),
                    lifecycle::NativeExitDecision::PreventThenExit => {
                        api.prevent_exit();
                        app_handle.exit(code.unwrap_or(0));
                    }
                }
            }
        });
}
