mod commands;
pub mod import;
pub mod import_parser;
mod niivue_protocol;
pub mod processing;
mod tracing;
pub mod visualization;
mod visualization_tests;

use commands::{
    create_symlink_tree, get_available_memory_mb, get_cpu_cores, is_writable, walk_directory,
    which_matlab,
};
use import::{
    clean_import_status, copy_lock_files, move_import_output, read_import_status,
    run_import_pipeline, stop_import, stop_running_import_for_exit, AppState,
};
use processing::{
    clear_stale_locks, detect_exploreasl_version, kill_pipeline, list_module_logs,
    list_subject_reports, list_subjects, read_lock_status, read_module_logs, read_report_image,
    run_pipeline, stop_running_processing_for_exit, stop_watch_lock_dir, watch_lock_dir,
};
use tauri::Manager;
#[cfg(debug_assertions)]
use tauri::{LogicalSize, Size};
use visualization::{
    check_join_sanity, clear_active_project, inspect_tsv, list_stats_files, read_tsv_columns,
    set_active_project,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin({
            #[allow(unused_mut)]
            let mut builder = tauri_plugin_log::Builder::default();
            #[cfg(debug_assertions)]
            {
                let log_dir = std::env::temp_dir()
                    .join("opencode")
                    .join("exploreasl-gui-logs");
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
            is_writable,
            walk_directory,
            create_symlink_tree,
            get_cpu_cores,
            get_available_memory_mb,
            run_import_pipeline,
            stop_import,
            clean_import_status,
            move_import_output,
            copy_lock_files,
            read_import_status,
            list_subjects,
            read_lock_status,
            run_pipeline,
            kill_pipeline,
            watch_lock_dir,
            stop_watch_lock_dir,
            clear_stale_locks,
            detect_exploreasl_version,
            list_module_logs,
            read_module_logs,
            list_subject_reports,
            read_report_image,
            list_stats_files,
            inspect_tsv,
            read_tsv_columns,
            set_active_project,
            clear_active_project,
            check_join_sanity,
        ])
        .register_uri_scheme_protocol("niivue", niivue_protocol::handle_niivue_protocol)
        .setup(|app| {
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
                let mut should_prevent = false;

                match stop_running_import_for_exit(app_handle) {
                    Ok(true) => {
                        should_prevent = true;
                    }
                    Ok(false) => {}
                    Err(error) => {
                        log::error!("Failed to stop running import during app exit: {}", error);
                    }
                }

                match stop_running_processing_for_exit(app_handle) {
                    Ok(true) => {
                        should_prevent = true;
                    }
                    Ok(false) => {}
                    Err(error) => {
                        log::error!(
                            "Failed to stop running processing during app exit: {}",
                            error
                        );
                    }
                }

                if should_prevent {
                    api.prevent_exit();
                    app_handle.exit(code.unwrap_or(0));
                }
            }
        });
}
