use super::utils::{parse_lock_dir_path, parse_lock_path};
use crate::import::AppState;
use crate::tracing::CommandTrace;
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn watch_lock_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    project_root: String,
) -> Result<(), String> {
    let trace = CommandTrace::new("watch_lock_dir");
    trace.arg("project_root", &project_root);

    // Prevent starting multiple watcher threads
    {
        let processing_state = state
            .processing_state
            .lock()
            .map_err(|_| "Processing state lock was poisoned".to_string())?;
        if processing_state.watcher_stop.is_some() {
            trace.success(&());
            return Ok(());
        }
    }

    let root = PathBuf::from(project_root.trim());
    let lock_root = root.join("derivatives").join("ExploreASL").join("lock");
    if !lock_root.exists() {
        std::fs::create_dir_all(&lock_root).map_err(|e| {
            format!(
                "Failed to create lock directory {}: {}",
                lock_root.display(),
                e
            )
        })?;
    }

    let lock_root_clone = lock_root.clone();
    let app_clone = app.clone();

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    watcher
        .watch(&lock_root, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch lock directory: {}", e))?;

    let watcher_thread = thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(event_result) => {
                    let event = match event_result {
                        Ok(ev) => ev,
                        Err(e) => {
                            log::error!("Watch error: {}", e);
                            continue;
                        }
                    };

                    match event.kind {
                        EventKind::Create(_) => {
                            for path in &event.paths {
                                if path.is_dir() {
                                    let relative = match path.strip_prefix(&lock_root_clone) {
                                        Ok(r) => r,
                                        Err(_) => continue,
                                    };
                                    let last = match relative.file_name().and_then(|f| f.to_str()) {
                                        Some(name) => name,
                                        None => continue,
                                    };
                                    if last == "locked"
                                        && let Some(lock_event) =
                                            parse_lock_dir_path(&lock_root_clone, path)
                                    {
                                        log::info!(
                                            "[WATCHER] LockCreated: module={} subject={:?} run={:?}",
                                            lock_event.module,
                                            lock_event.subject_session,
                                            lock_event.run
                                        );
                                        let _ = app_clone.emit("LockCreated", lock_event);
                                    }
                                } else if let Some(status_event) =
                                    parse_lock_path(&lock_root_clone, path)
                                {
                                    log::info!(
                                        "[WATCHER] StatusFileCreated: module={} subject={:?} step={} run={:?}",
                                        status_event.module,
                                        status_event.subject_session,
                                        status_event.step_code,
                                        status_event.run
                                    );
                                    let _ = app_clone.emit("StatusFileCreated", status_event);
                                }
                            }
                        }
                        EventKind::Modify(_) => {
                            for path in &event.paths {
                                if !path.is_dir()
                                    && let Some(status_event) =
                                        parse_lock_path(&lock_root_clone, path)
                                {
                                    log::info!(
                                        "[WATCHER] StatusFileModified: module={} subject={:?} step={} run={:?}",
                                        status_event.module,
                                        status_event.subject_session,
                                        status_event.step_code,
                                        status_event.run
                                    );
                                    let _ = app_clone.emit("StatusFileCreated", status_event);
                                }
                            }
                        }
                        EventKind::Remove(_) => {
                            for path in &event.paths {
                                if path.is_dir() {
                                    let relative = match path.strip_prefix(&lock_root_clone) {
                                        Ok(r) => r,
                                        Err(_) => continue,
                                    };
                                    let last = match relative.file_name().and_then(|f| f.to_str()) {
                                        Some(name) => name,
                                        None => continue,
                                    };
                                    if last == "locked"
                                        && let Some(lock_event) =
                                            parse_lock_dir_path(&lock_root_clone, path)
                                    {
                                        log::info!(
                                            "[WATCHER] LockRemoved: module={} subject={:?} run={:?}",
                                            lock_event.module,
                                            lock_event.subject_session,
                                            lock_event.run
                                        );
                                        let _ = app_clone.emit("LockRemoved", lock_event);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => match stop_rx.try_recv() {
                    Ok(()) | Err(mpsc::TryRecvError::Disconnected) => {
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                },
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    log::warn!("[WATCHER] Event channel disconnected");
                    break;
                }
            }
        }
        log::info!("[WATCHER] Stopped");
        drop(watcher);
    });

    {
        let mut processing_state = state
            .processing_state
            .lock()
            .map_err(|_| "Processing state lock was poisoned".to_string())?;
        processing_state.watcher_handle = Some(watcher_thread);
        processing_state.watcher_stop = Some(stop_tx);
    }

    trace.success(&());
    Ok(())
}

#[tauri::command]
pub fn stop_watch_lock_dir(state: State<'_, AppState>) -> Result<(), String> {
    let (handle, stop_tx) = {
        let mut processing_state = state
            .processing_state
            .lock()
            .map_err(|_| "Processing state lock was poisoned".to_string())?;
        let handle = processing_state.watcher_handle.take();
        let stop = processing_state.watcher_stop.take();
        (handle, stop)
    };

    if let Some(sender) = stop_tx {
        let _ = sender.send(());
    }

    if let Some(handle) = handle {
        let _ = handle.join();
    }

    Ok(())
}
