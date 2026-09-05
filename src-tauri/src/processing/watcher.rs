use super::runs::{
    lock_project_transition, matching_run_for_active_project, validate_watcher_request,
};
use super::types::{LockRemoved, ProcessingRunSnapshot};
use super::utils::{parse_lock_dir_path, parse_lock_path};
use crate::app_state::AppState;
use crate::tracing::CommandTrace;
use notify::{EventKind, RecursiveMode, Watcher};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn watch_lock_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    let trace = CommandTrace::new("watch_lock_dir");
    trace.arg("run_id", &run_id);

    let admission = validate_watcher_request(&state, &run_id)?;
    if admission.already_owned {
        return Ok(admission.snapshot);
    }
    let lock_root = admission.lock_root;
    {
        let (mut processing_state, _) = matching_run_for_active_project(&state, &run_id)?;
        if processing_state
            .current_run
            .as_ref()
            .expect("matching run exists")
            .lifecycle
            .is_terminal()
        {
            return Err(format!("Processing run {run_id} is terminal"));
        }
        if let Some(owner) = processing_state.watcher_run_id.as_deref() {
            if owner == run_id {
                return Ok(processing_state
                    .current_run
                    .as_ref()
                    .expect("matching run exists")
                    .snapshot());
            }
            return Err("Lock watcher belongs to another processing run".to_string());
        }
        processing_state.watcher_run_id = Some(run_id.clone());
    }

    if let Err(error) = std::fs::create_dir_all(&lock_root) {
        clear_watcher_reservation(&state, &run_id);
        return Err(format!(
            "Failed to create lock directory {}: {error}",
            lock_root.display()
        ));
    }

    let lock_root_clone = lock_root.clone();
    let app_clone = app.clone();
    let bound_run_id = run_id.clone();
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(watcher) => watcher,
        Err(error) => {
            clear_watcher_reservation(&state, &run_id);
            return Err(format!("Failed to create file watcher: {error}"));
        }
    };
    if let Err(error) = watcher.watch(&lock_root, RecursiveMode::Recursive) {
        clear_watcher_reservation(&state, &run_id);
        return Err(format!("Failed to watch lock directory: {error}"));
    }

    let watcher_thread = thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ok(event)) => match event.kind {
                    EventKind::Create(_) => {
                        for path in &event.paths {
                            if path.is_dir() {
                                if path.file_name().and_then(|name| name.to_str()) == Some("locked")
                                    && let Some(lock_event) =
                                        parse_lock_dir_path(&lock_root_clone, path, &bound_run_id)
                                {
                                    let _ = app_clone.emit("LockCreated", lock_event);
                                }
                            } else if let Some(status_event) =
                                parse_lock_path(&lock_root_clone, path, &bound_run_id)
                            {
                                let _ = app_clone.emit("StatusFileCreated", status_event);
                            }
                        }
                    }
                    EventKind::Modify(_) => {
                        for path in &event.paths {
                            if !path.is_dir()
                                && let Some(status_event) =
                                    parse_lock_path(&lock_root_clone, path, &bound_run_id)
                            {
                                let _ = app_clone.emit("StatusFileCreated", status_event);
                            }
                        }
                    }
                    EventKind::Remove(_) => {
                        for path in &event.paths {
                            if path.is_dir()
                                && path.file_name().and_then(|name| name.to_str()) == Some("locked")
                                && let Some(lock_event) =
                                    parse_lock_dir_path(&lock_root_clone, path, &bound_run_id)
                            {
                                let _ = app_clone.emit(
                                    "LockRemoved",
                                    LockRemoved {
                                        run_id: lock_event.run_id,
                                        module: lock_event.module,
                                        subject_session: lock_event.subject_session,
                                        run: lock_event.run,
                                    },
                                );
                            }
                        }
                    }
                    _ => {}
                },
                Ok(Err(error)) => log::error!("Watch error: {error}"),
                Err(mpsc::RecvTimeoutError::Timeout) => match stop_rx.try_recv() {
                    Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
                    Err(mpsc::TryRecvError::Empty) => {}
                },
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(watcher);
    });

    let snapshot = {
        let (mut processing_state, _) = matching_run_for_active_project(&state, &run_id)?;
        let run_is_terminal = processing_state
            .current_run
            .as_ref()
            .expect("matching run exists")
            .lifecycle
            .is_terminal();
        if run_is_terminal || processing_state.watcher_run_id.as_deref() != Some(run_id.as_str()) {
            drop(processing_state);
            let _ = stop_tx.send(());
            let _ = watcher_thread.join();
            return Err("Processing run ownership changed while starting lock watcher".to_string());
        }
        processing_state.watcher_stop = Some(stop_tx);
        processing_state.watcher_handle = Some(watcher_thread);
        let run = processing_state
            .current_run
            .as_mut()
            .expect("matching run exists");
        run.watcher_owned = true;
        run.snapshot()
    };
    trace.success(&snapshot);
    Ok(snapshot)
}

fn clear_watcher_reservation(state: &AppState, run_id: &str) {
    if let Ok(mut processing_state) = state.processing_state.lock()
        && processing_state.watcher_stop.is_none()
        && processing_state.watcher_run_id.as_deref() == Some(run_id)
    {
        processing_state.watcher_run_id = None;
        if let Some(run) = processing_state.current_run.as_mut()
            && run.run_id == run_id
        {
            run.watcher_owned = false;
        }
    }
}

#[tauri::command]
pub fn stop_watch_lock_dir(state: State<'_, AppState>, run_id: String) -> Result<(), String> {
    let _transition = lock_project_transition(&state)?;
    stop_watch_lock_dir_impl(&state, &run_id)
}

pub(crate) fn stop_watch_lock_dir_impl(state: &AppState, run_id: &str) -> Result<(), String> {
    let (handle, stop_tx) = {
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        if processing_state.watcher_run_id.is_none()
            && processing_state.watcher_stop.is_none()
            && processing_state.watcher_handle.is_none()
        {
            return Ok(());
        }
        if processing_state.watcher_run_id.as_deref() != Some(run_id) {
            return Err("Lock watcher belongs to another processing run".to_string());
        }
        (
            processing_state.watcher_handle.take(),
            processing_state.watcher_stop.clone(),
        )
    };
    if let Some(sender) = stop_tx
        && sender.send(()).is_err()
        && handle.as_ref().is_some_and(|thread| !thread.is_finished())
    {
        // Sender failure does not prove a live watcher stopped. Restore its
        // join handle so shutdown/retry retains actionable exact-run ownership.
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        if processing_state.watcher_run_id.as_deref() == Some(run_id)
            && processing_state.watcher_handle.is_none()
        {
            processing_state.watcher_handle = handle;
        }
        return Err("Lock watcher stop request failed".to_string());
    }
    if let Some(handle) = handle {
        handle
            .join()
            .map_err(|_| "Lock watcher thread failed while stopping".to_string())?;
    }
    let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
    if processing_state.watcher_run_id.as_deref() != Some(run_id) {
        return Err("Lock watcher ownership changed while stopping".to_string());
    }
    processing_state.watcher_run_id = None;
    processing_state.watcher_stop = None;
    processing_state
        .current_run
        .as_mut()
        .expect("matching run exists")
        .watcher_owned = false;
    Ok(())
}
