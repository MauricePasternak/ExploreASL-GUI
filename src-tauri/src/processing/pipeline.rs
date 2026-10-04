//! Processing workflow owner for preparation, workers and terminal settlement.
//!
//! Shared engine validation, probes and command helpers live in `crate::execution`.
use super::{
    record::{AvailableAction, ProcessingError, ProcessingRecord},
    runs::{attach_run_impl, lock_project_transition, matching_run_for_active_project},
    types::{ProcessingLifecycle, ProcessingRunSnapshot},
};
use crate::process::{CancellationToken, ProcessScope, cancel_all};
use crate::{
    app::state::AppState,
    execution::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH},
    execution::profile::{ExecutionProfile, get_exploreasl_version},
};
use anyhow::{Context, Result};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}

pub(crate) fn build_matlab_processing_batch(
    exploreasl_path: &Path,
    project_root: &Path,
    b_process: &str,
    worker: usize,
    total_workers: usize,
) -> String {
    format!(
        "addpath('{}'); ExploreASL('{}', 0, [{}], 0, {}, {})",
        escape_matlab_string(&exploreasl_path.to_string_lossy()),
        escape_matlab_string(&project_root.to_string_lossy()),
        b_process,
        worker,
        total_workers,
    )
}

pub(crate) fn build_apptainer_processing_args(
    project_root: &Path,
    sif_path: &Path,
    b_process_str: &str,
    worker: usize,
    total_workers: usize,
) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--cleanenv".to_string(),
        "--writable-tmpfs".to_string(),
        "--bind".to_string(),
        format!("{}:{CONTAINER_DATA_ROOT}", project_root.display()),
        sif_path.to_string_lossy().to_string(),
        "/bin/bash".to_string(),
        EXPLOREASL_SCRIPT.to_string(),
        MCR_PATH.to_string(),
        CONTAINER_DATA_ROOT.to_string(),
        "0".to_string(),
        b_process_str.to_string(),
        "0".to_string(),
        worker.to_string(),
        total_workers.to_string(),
    ]
}

fn update(
    state: &AppState,
    run_id: &str,
    mutation: impl FnOnce(&mut ProcessingRecord) -> Result<()>,
) -> Result<ProcessingRunSnapshot> {
    let (mut processing, _) =
        matching_run_for_active_project(state, run_id).map_err(anyhow::Error::msg)?;
    let run = processing
        .current_run
        .as_mut()
        .context("Missing processing run")?;
    let previous = run
        .durable
        .as_ref()
        .context("Missing immutable processing request")?;
    if previous.lifecycle.is_terminal() {
        return Ok(run.snapshot());
    }
    let mut next = previous.clone();
    mutation(&mut next)?;
    if next.revision == previous.revision {
        next.revision += 1;
    }
    if let Err(error) = super::record::persist(&next, Some(previous)) {
        // A rename can become visible before its directory sync fails. Keep the
        // uncertainty error, but let the live owner observe its exact durable
        // cancellation/commit update instead of continuing from stale memory.
        if let Ok(Some(visible)) = super::record::records(&next.project_root).map(|mut r| r.pop())
            && serde_json::to_value(&visible)
                .ok()
                .zip(serde_json::to_value(&next).ok())
                .is_some_and(|(visible, intended)| visible == intended)
        {
            run.lifecycle = next.lifecycle;
            run.terminal_result = next.terminal_summary.as_ref().map(|s| s.result);
            run.durable = Some(next);
        }
        return Err(error);
    }
    run.lifecycle = next.lifecycle;
    run.terminal_result = next.terminal_summary.as_ref().map(|s| s.result);
    run.durable = Some(next);
    Ok(run.snapshot())
}
/// Repair a visible-but-unpublished state update only after native resources
/// have settled. Durable identity remains exact; this never adopts a worker.
pub(crate) fn reconcile_idle(state: &AppState, run_id: &str) -> Result<()> {
    let (mut processing, root) =
        matching_run_for_active_project(state, run_id).map_err(anyhow::Error::msg)?;
    if processing.launch_in_progress
        || processing
            .cancellation
            .as_ref()
            .is_some_and(|token| !token.is_cancelled())
        || processing.watcher_run_id.is_some()
        || processing.watcher_handle.is_some()
    {
        return Ok(());
    }
    let Some(current) = super::record::records(&root)?.pop() else {
        return Ok(());
    };
    if current.run_id.to_string() != run_id {
        anyhow::bail!("Processing current identity changed during reconciliation");
    }
    let run = processing
        .current_run
        .as_mut()
        .context("Missing processing run")?;
    run.lifecycle = current.lifecycle;
    run.terminal_result = current.terminal_summary.as_ref().map(|s| s.result);
    run.durable = Some(current);
    processing.cancellation = None;
    Ok(())
}

fn record(state: &AppState, run_id: &str) -> Result<ProcessingRecord> {
    let (processing, _) =
        matching_run_for_active_project(state, run_id).map_err(anyhow::Error::msg)?;
    processing
        .current_run
        .as_ref()
        .and_then(|r| r.durable.clone())
        .context("Missing immutable processing request")
}
fn cancelled(state: &AppState, run_id: &str) -> Result<bool> {
    Ok(record(state, run_id)?.cancellation_requested)
}
fn publish<R: Runtime>(app: &AppHandle<R>, snapshot: &ProcessingRunSnapshot) {
    let _ = app.emit("ProcessingLifecycleSnapshot", snapshot);
}
fn fail(state: &AppState, run_id: &str, code: &str, error: impl std::fmt::Display) -> Result<()> {
    update(state, run_id, |next| {
        if !next.lifecycle.is_terminal() {
            next.error = Some(ProcessingError {
                code: code.into(),
                message: error.to_string(),
            });
        }
        Ok(())
    })?;
    Ok(())
}

fn launch<R: Runtime>(app: &AppHandle<R>, run_id: &str) -> Result<()> {
    let state = app.state::<AppState>();
    let reserved = record(&state, run_id)?;
    if cancelled(&state, run_id)? {
        return Ok(());
    }
    if reserved.data_source == "bids"
        && let Err(error) = crate::project::setup::verify(&reserved.project_root)
    {
        fail(&state, run_id, "bidsCompatibility", format!("{error:#}"))?;
        return Ok(());
    }
    let cancellation = CancellationToken::default();
    state
        .processing_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Processing state lock was poisoned"))?
        .cancellation = Some(cancellation.clone());
    if cancelled(&state, run_id)? {
        return Ok(());
    }
    let profile_version = match &reserved.request.execution_profile {
        ExecutionProfile::Matlab {
            explore_asl_version,
            ..
        }
        | ExecutionProfile::Apptainer {
            explore_asl_version,
            ..
        } => explore_asl_version.as_deref(),
    };
    log::info!(
        "[PROCESSING] Preparing run {run_id}, profile {}, recorded ExploreASL version {}",
        reserved.request.execution_profile.id(),
        profile_version.unwrap_or("unknown")
    );
    // Validation accepts trimmed installation/image paths. Consume those same
    // derived paths everywhere while preserving the exact immutable request.
    let mut execution_profile = reserved.request.execution_profile.clone();
    match &mut execution_profile {
        ExecutionProfile::Matlab {
            explore_asl_path, ..
        } => {
            *explore_asl_path = explore_asl_path.trim().to_string();
        }
        ExecutionProfile::Apptainer { sif_path, .. } => {
            *sif_path = sif_path.trim().to_string();
        }
    }
    let command =
        crate::execution::launch::validate_profile(&execution_profile, cancellation.clone())?;
    if let ExecutionProfile::Apptainer { sif_path, .. } = &execution_profile {
        crate::execution::launch::warm_cache(
            command.get_program(),
            Path::new(sif_path),
            &reserved.project_root,
            cancellation.clone(),
        )?;
    }
    // Native version capture overlaps independent filesystem preparation; both
    // threads settle before the scientific execution boundary.
    let (prepared, versions) = std::thread::scope(|scope| {
        let version = scope.spawn(|| {
            super::preparation::versions(&execution_profile, &command, cancellation.clone())
        });
        let prepared = super::preparation::prepare(&reserved);
        (
            prepared,
            version
                .join()
                .map_err(|_| anyhow::anyhow!("Native version capture panicked"))
                .and_then(|v| v),
        )
    });
    let mut transaction = prepared?;
    let versions = versions?;
    log::info!(
        "[PROCESSING] Run {run_id} native versions: ExploreASL {}, MATLAB {}, GUI {}",
        versions.explore_asl,
        versions.matlab,
        versions.gui
    );
    update(&state, run_id, |next| {
        next.versions = Some(versions);
        Ok(())
    })?;
    if cancelled(&state, run_id)? {
        return Ok(());
    }
    super::watcher::start(app.clone(), &state, run_id.to_string()).map_err(anyhow::Error::msg)?;
    // Cancellation and commit serialize through the same state mutex. Once this
    // durable boundary exists, even first-worker spawn failure preserves output.
    let snapshot = update(&state, run_id, |next| {
        if next.cancellation_requested {
            return Ok(());
        }
        transaction.commit()?;
        next.execution_committed = true;
        next.execution_committed_at_ms = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_millis() as u64,
        );
        next.set_lifecycle(ProcessingLifecycle::Running)?;
        Ok(())
    })?;
    publish(app, &snapshot);
    if cancelled(&state, run_id)? {
        return Ok(());
    }
    let b_process = super::runs::selected_modules_to_b_process(&reserved.request.selected_modules)
        .map_err(anyhow::Error::msg)?
        .into_iter()
        .map(|s| if s { "1" } else { "0" })
        .collect::<Vec<_>>()
        .join(",");
    let mut scopes = Vec::new();
    let worker_result = (|| -> Result<()> {
        for worker in 1..=reserved.request.workers as usize {
            if worker > 1 {
                let until = Instant::now() + Duration::from_secs(2);
                while Instant::now() < until {
                    if cancelled(&state, run_id)? {
                        return Ok(());
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            }
            if cancelled(&state, run_id)? {
                return Ok(());
            }
            let mut worker_command =
                crate::execution::command::create_system_command(command.get_program());
            match &execution_profile {
                ExecutionProfile::Matlab {
                    explore_asl_path, ..
                } => {
                    worker_command.args([
                        "-batch",
                        &build_matlab_processing_batch(
                            Path::new(explore_asl_path),
                            &reserved.project_root,
                            &b_process,
                            worker,
                            reserved.request.workers as usize,
                        ),
                    ]);
                }
                ExecutionProfile::Apptainer { sif_path, .. } => {
                    worker_command.args(build_apptainer_processing_args(
                        &reserved.project_root,
                        Path::new(sif_path),
                        &b_process,
                        worker,
                        reserved.request.workers as usize,
                    ));
                }
            }
            worker_command
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            match ProcessScope::spawn_with_cancellation(worker_command, cancellation.clone()) {
                Ok(scope) => scopes.push(scope),
                Err(error) => {
                    return Err(error.into());
                }
            }
        }
        loop {
            if cancelled(&state, run_id)? || cancellation.is_cancelled() {
                return Ok(());
            }
            let mut all = true;
            for (index, scope) in scopes.iter_mut().enumerate() {
                if let Some(outcome) = scope.poll_settled()? {
                    let worker = format!("worker-{}", index + 1);
                    if !record(&state, run_id)?
                        .logical_exits
                        .iter()
                        .any(|exit| exit.worker_id == worker)
                    {
                        let code = outcome.exit_status.code().unwrap_or(-1);
                        // Direct exit evidence is durable before watcher shutdown/audit.
                        update(&state, run_id, |next| {
                            next.logical_exits.push(super::record::LogicalWorkerExit {
                                worker_id: worker,
                                exit_code: code,
                            });
                            Ok(())
                        })?;
                    }
                } else {
                    all = false;
                }
            }
            if all {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    })();
    // This boundary owns the vector on every worker-phase path. Never let an
    // early polling, persistence, stagger, or spawn error drop a live scope.
    if worker_result.is_err() || cancellation.is_cancelled() || cancelled(&state, run_id)? {
        let cleanup = cancel_scopes_until_settled(&mut scopes);
        if let Err(error) = worker_result {
            cleanup?;
            return Err(error);
        }
        cleanup?;
    } else {
        worker_result?;
    }
    if !cancelled(&state, run_id)? {
        let snapshot = update(&state, run_id, |next| {
            if !next.cancellation_requested {
                next.set_lifecycle(ProcessingLifecycle::Finalizing)?;
            }
            Ok(())
        })?;
        publish(app, &snapshot);
    }
    Ok(())
}
/// This owner never returns while a supported scope might still live. A
/// platform error is retained until reaping has completed, rather than allowing
/// `ProcessScope` drop to become implicit abandonment.
fn cancel_scopes_until_settled(scopes: &mut [ProcessScope]) -> Result<()> {
    loop {
        match cancel_all(scopes) {
            Ok(()) => return Ok(()),
            Err(error) => {
                log::error!("Processing scope cleanup retry: {error}");
                let mut settled = true;
                for scope in &mut *scopes {
                    if let Err(force) = scope.force_shutdown() {
                        log::error!("Processing scope forced cleanup retry: {force}");
                        settled = false;
                    }
                }
                for scope in &mut *scopes {
                    match scope.poll_settled() {
                        Ok(Some(_)) => {}
                        Ok(None) | Err(_) => settled = false,
                    }
                }
                if settled {
                    return Err(error.into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}
fn settle(state: &AppState, run_id: &str) -> Result<ProcessingRunSnapshot> {
    let gate = state
        .processing_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Processing state lock was poisoned"))?
        .settlement
        .clone();
    let _settlement = gate
        .lock()
        .map_err(|_| anyhow::anyhow!("Processing settlement lock was poisoned"))?;
    let current = record(state, run_id)?;
    let cancellation = state
        .processing_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Processing state lock was poisoned"))?
        .cancellation
        .clone();
    if let Some(cancellation) = &cancellation
        && (current.cancellation_requested
            || current.error.is_some()
            || !current.execution_committed)
    {
        cancellation.cancel();
    }
    super::watcher::stop_watch_lock_dir_impl(state, run_id).map_err(anyhow::Error::msg)?;
    // Stop admission and terminal publication serialize here. A cancellation
    // persisted before this lock is acquired wins the final classification.
    let mut processing = state
        .processing_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Processing state lock was poisoned"))?;
    let result = super::recovery::settle(&current.project_root, false)?
        .context("Processing current record disappeared")?;
    let run = processing
        .current_run
        .as_mut()
        .context("Processing run disappeared")?;
    if run.run_id != run_id {
        anyhow::bail!("Processing settlement identity changed");
    }
    run.lifecycle = result.lifecycle;
    run.terminal_result = result.terminal_summary.as_ref().map(|s| s.result);
    run.durable = Some(result);
    processing.cancellation = None;
    processing.launch_in_progress = false;
    Ok(processing.current_run.as_ref().unwrap().snapshot())
}
fn pending_cleanup(state: &AppState, run_id: &str, error: &anyhow::Error) {
    if let Err(storage) = update(state, run_id, |next| {
        if next.lifecycle.is_terminal() {
            return Ok(());
        }
        next.available_action = AvailableAction::RetryCleanup;
        next.error = Some(ProcessingError {
            code: "cleanupRequired".into(),
            message: format!("{error:#}"),
        });
        Ok(())
    }) {
        log::error!("Processing cleanup and authority persistence failed: {error:#}; {storage:#}");
    }
    // The owner may still be retrying scope settlement. Keep admission and
    // project transition locked until it publishes a settled terminal record.
}

#[tauri::command]
pub fn run_pipeline<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    crate::project::ownership::ensure_not_shutting_down(&state)?;
    reconcile_idle(&state, &run_id).map_err(|e| e.to_string())?;
    let previous = record(&state, &run_id).map_err(|e| e.to_string())?;
    if previous.launch_started || previous.lifecycle != ProcessingLifecycle::Preparing {
        return attach_run_impl(&state, &run_id);
    }
    let snapshot = update(&state, &run_id, |next| {
        next.launch_started = true;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    let mut processing = state
        .processing_state
        .lock()
        .map_err(|_| "Processing state lock was poisoned")?;
    processing.launch_in_progress = true;
    let owned_run_id = run_id.clone();
    let worker_app = app.clone();
    let handle = std::thread::Builder::new()
        .name("processing-owner".into())
        .spawn(move || {
            let state = worker_app.state::<AppState>();
            if let Err(error) = launch(&worker_app, &owned_run_id)
                && let Err(storage) = fail(
                    &state,
                    &owned_run_id,
                    "processingFailed",
                    format!("{error:#}"),
                )
            {
                log::error!("Processing launch failed: {error:#}; authority error: {storage:#}");
            }
            match settle(&state, &owned_run_id) {
                Ok(snapshot) => publish(&worker_app, &snapshot),
                Err(error) => {
                    pending_cleanup(&state, &owned_run_id, &error);
                    if let Ok(snapshot) = attach_run_impl(&state, &owned_run_id) {
                        publish(&worker_app, &snapshot);
                    }
                }
            }
        });
    match handle {
        Ok(handle) => {
            processing.supervisor_handle = Some(handle);
            Ok(snapshot)
        }
        Err(error) => {
            processing.launch_in_progress = false;
            drop(processing);
            fail(&state, &run_id, "supervisorStart", &error).map_err(|e| e.to_string())?;
            settle(&state, &run_id).map_err(|e| e.to_string())
        }
    }
}

pub(crate) fn stop_for_state(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    reconcile_idle(state, run_id).map_err(|e| e.to_string())?;
    let current = record(state, run_id).map_err(|e| e.to_string())?;
    if current.lifecycle.is_terminal() {
        reap_supervisor(state)?;
        return attach_run_impl(state, run_id);
    }
    if current.available_action != AvailableAction::RetryCleanup {
        update(state, run_id, |next| {
            if !next.cancellation_requested {
                next.cancellation_requested = true;
                next.set_lifecycle(ProcessingLifecycle::Cancelling)?;
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    }
    let cancellation = state
        .processing_state
        .lock()
        .map_err(|_| "Processing state lock was poisoned")?
        .cancellation
        .clone();
    if let Some(cancellation) = cancellation {
        cancellation.cancel();
    }
    reap_supervisor(state)?;
    if record(state, run_id)
        .map_err(|e| e.to_string())?
        .lifecycle
        .is_terminal()
    {
        return attach_run_impl(state, run_id);
    }
    match settle(state, run_id) {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => {
            pending_cleanup(state, run_id, &error);
            attach_run_impl(state, run_id)
        }
    }
}
pub(crate) fn reap_finished_supervisor(state: &AppState) -> Result<(), String> {
    let handle = {
        let mut processing = state
            .processing_state
            .lock()
            .map_err(|_| "Processing state lock was poisoned")?;
        if processing
            .supervisor_handle
            .as_ref()
            .is_some_and(|h| h.is_finished())
        {
            processing.supervisor_handle.take()
        } else {
            None
        }
    };
    if let Some(handle) = handle {
        handle
            .join()
            .map_err(|_| "Processing supervisor panicked; retry cleanup")?;
    }
    Ok(())
}
pub(crate) fn reap_supervisor(state: &AppState) -> Result<(), String> {
    let deadline = Instant::now() + crate::execution::launch::SETTLE_TIMEOUT;
    loop {
        let (handle, running) = {
            let mut processing = state
                .processing_state
                .lock()
                .map_err(|_| "Processing state lock was poisoned")?;
            let handle = processing
                .supervisor_handle
                .as_ref()
                .is_some_and(std::thread::JoinHandle::is_finished)
                .then(|| processing.supervisor_handle.take())
                .flatten();
            (handle, processing.launch_in_progress)
        };
        if let Some(handle) = handle {
            if handle.join().is_err() {
                return Err("Processing supervisor panicked; retry cleanup".into());
            }
            return Ok(());
        }
        if !running {
            return Ok(());
        }
        // Another exact Stop may own the join handle. It must not let this
        // caller race preparation or release watcher ownership prematurely.
        if Instant::now() >= deadline {
            return Err("Processing supervisor still owns cleanup".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[tauri::command]
pub fn kill_pipeline<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    // Publish durable cancellation before blocking on the native supervisor.
    reconcile_idle(&state, &run_id).map_err(|e| e.to_string())?;
    let current = record(&state, &run_id).map_err(|e| e.to_string())?;
    if !current.lifecycle.is_terminal() && current.available_action != AvailableAction::RetryCleanup
    {
        let snapshot = update(&state, &run_id, |next| {
            if !next.cancellation_requested {
                next.cancellation_requested = true;
                next.set_lifecycle(ProcessingLifecycle::Cancelling)?;
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;
        publish(&app, &snapshot);
    }
    let snapshot = stop_for_state(&state, &run_id)?;
    publish(&app, &snapshot);
    Ok(snapshot)
}

pub fn stop_running_processing_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let run_id = state
        .processing_state
        .lock()
        .map_err(|_| "Processing state lock was poisoned")?
        .current_run
        .as_ref()
        .filter(|run| !run.lifecycle.is_terminal())
        .map(|run| run.run_id.clone());
    if let Some(run_id) = run_id {
        let snapshot = stop_for_state(&state, &run_id)?;
        if !snapshot.lifecycle.is_terminal() {
            return Err("Processing cleanup remains unresolved".into());
        }
        Ok(true)
    } else {
        reap_supervisor(&state)?;
        Ok(false)
    }
}
#[tauri::command]
pub fn detect_exploreasl_version(explore_asl_path: String) -> Option<String> {
    get_exploreasl_version(&PathBuf::from(explore_asl_path.trim()))
}
