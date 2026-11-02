//! A native escape hatch when renderer-owned close handling cannot finish.
use std::{sync::Mutex, time::Duration};
use tauri::{
    AppHandle, CloseRequestApi, Emitter, Listener, Manager, Runtime, WebviewWindow, Window,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
pub(super) struct CloseFallback(Mutex<CloseState>);

#[derive(Default)]
struct CloseState {
    sequence: u64,
    waiting: Option<u64>,
    dialog_open: bool,
}

impl CloseFallback {
    fn request(&self) -> Option<u64> {
        let mut state = self.0.lock().unwrap();
        if state.waiting.is_some() || state.dialog_open {
            return None;
        }
        state.sequence += 1;
        state.waiting = Some(state.sequence);
        state.waiting
    }

    fn handled(&self, request: u64) {
        let mut state = self.0.lock().unwrap();
        if state.waiting == Some(request) {
            state.waiting = None;
        }
    }

    fn timed_out(&self, request: u64) -> bool {
        let mut state = self.0.lock().unwrap();
        if state.waiting != Some(request) || state.dialog_open {
            return false;
        }
        state.waiting = None;
        state.dialog_open = true;
        true
    }

    fn reset(&self) {
        let mut state = self.0.lock().unwrap();
        state.waiting = None;
        state.dialog_open = false;
    }
}

pub(super) fn install<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle().clone();
    window.listen("app-close-handled", move |event| {
        if let Ok(request) = serde_json::from_str::<u64>(event.payload()) {
            app.state::<CloseFallback>().handled(request);
        }
    });
}

pub(super) fn on_close_requested<R: Runtime>(window: &Window<R>, api: &CloseRequestApi) {
    if window.label() != "main" {
        return;
    }
    api.prevent_close();
    let Some(request) = window.state::<CloseFallback>().request() else {
        return;
    };
    if let Err(error) = window.emit_to(window.label(), "app-close-requested", request) {
        log::warn!("Could not deliver close request to renderer: {error}");
    }
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        if let Some(window) = app.get_webview_window("main")
            && app.state::<CloseFallback>().timed_out(request)
        {
            confirm_exit(&window);
        }
    });
}

fn confirm_exit<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle().clone();
    window
        .dialog()
        .message(
            "The application has not finished closing. Exit without waiting for the interface?\n\n\
             Unsaved changes may be lost. Active import or processing will be stopped before exiting.",
        )
        .title("Exit application")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Exit application".into(),
            "Keep waiting".into(),
        ))
        .parent(window)
        .show(move |exit| {
            if exit {
                log::warn!("Native exit requested without waiting for renderer close handling");
                // Unlike destroy/process::exit, this still runs native ExitRequested cleanup.
                app.exit(0);
            } else {
                app.state::<CloseFallback>().reset();
            }
        });
}

pub(super) fn exit_failed(app: &AppHandle) {
    app.state::<CloseFallback>().reset();
    app.dialog()
        .message(
            "Active import or processing could not be confirmed stopped. The application has not exited. \
             Try closing again to retry cleanup. Consult the application log if this continues.",
        )
        .title("Could not exit safely")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[cfg(test)]
#[path = "close_fallback_test.rs"]
mod tests;
