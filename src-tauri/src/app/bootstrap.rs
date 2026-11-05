//! Tauri wiring, startup recovery, and application exit coordination.
use super::{close_fallback, single_instance, state::AppState};
use crate::{import, processing, project::lifecycle};
use tauri::Manager;
#[cfg(debug_assertions)]
use tauri::{LogicalSize, Size};

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(close_fallback::CloseFallback::default())
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
        .plugin(tauri_plugin_log::Builder::default().skip_logger().build())
        .invoke_handler(crate::bindings::command_registry().invoke_handler())
        .register_uri_scheme_protocol(
            "niivue",
            crate::visualization::niivue_protocol::handle_niivue_protocol,
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                close_fallback::on_close_requested(window, api);
            }
        })
        .setup(|app| {
            super::logging::init(app.handle());
            log::info!(
                "[STARTUP] version={} platform={}-{} build={}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH,
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                }
            );
            let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                close_fallback::install(&window);
                window.set_icon(icon)?;
                #[cfg(debug_assertions)]
                {
                    window.set_size(Size::Logical(LogicalSize::new(800.0, 900.0)))?;
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
                    lifecycle::NativeExitDecision::Prevent => {
                        api.prevent_exit();
                        close_fallback::exit_failed(app_handle);
                    }
                    lifecycle::NativeExitDecision::PreventThenExit => {
                        api.prevent_exit();
                        app_handle.exit(code.unwrap_or(0));
                    }
                }
            }
        });
}
