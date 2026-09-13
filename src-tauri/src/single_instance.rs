//! Single desktop-process activation policy.

use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn handle_second_instance<R: Runtime>(
    app: &AppHandle<R>,
    _args: &[String],
    _cwd: &str,
) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}

#[cfg(test)]
#[path = "single_instance_tests.rs"]
mod tests;
