use super::locks::{
    clear_stale_lock_dirs, delete_bids2legacy_locks, delete_status_files_for_modules,
};
use super::logs::delete_module_log_files;
use super::runs::{
    attach_run_impl, lock_processing_state, lock_project_transition,
    matching_run_for_active_project, record_launch_failure_impl, record_worker_exit,
    validate_launch_admission, validate_launch_request,
};
use super::types::{ProcessingLifecycle, ProcessingRunSnapshot, WorkerExited, WorkerSupervisor};
use super::utils::{ensure_lock_dir, escape_matlab_string};
use crate::app_state::AppState;
use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH, ensure_mcr_cache};
use crate::execution_profile::{ExecutionProfile, InternalValidation, get_exploreasl_version};
use crate::process_control::{
    force_kill_process, process_exists, send_termination_signal, validate_process_ids,
};
use crate::tracing::CommandTrace;
use anyhow::{Context, Result as AnyResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

fn write_data_par_json(project_root: &Path, data_par_json: &str) -> AnyResult<()> {
    let data_par_dir = project_root.join("derivatives").join("ExploreASL");
    fs::create_dir_all(&data_par_dir).with_context(|| {
        format!(
            "Failed to create ExploreASL derivatives dir {}",
            data_par_dir.display()
        )
    })?;
    let data_par_path = data_par_dir.join("dataPar.json");
    fs::write(&data_par_path, data_par_json)
        .with_context(|| format!("Failed to write {}", data_par_path.display()))?;
    Ok(())
}

fn spawn_matlab_processing_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
    log::info!(
        "[PIPELINE] Spawning MATLAB process: {} with batch: {}",
        matlab_path,
        batch
    );
    let mut command = crate::apptainer::create_system_command(matlab_path);
    command
        .arg("-batch")
        .arg(batch)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
    }

    command.spawn()
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

fn spawn_apptainer_processing_process(
    apptainer_path: &str,
    args: &[String],
) -> std::io::Result<Child> {
    log::info!(
        "[PIPELINE] Spawning Apptainer processing process: {} args: {:?}",
        apptainer_path,
        args
    );
    let mut command = crate::apptainer::create_system_command(apptainer_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
    }

    command.spawn()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ProcessingWorkerCommand {
    Matlab {
        executable: String,
        batch: String,
        worker: usize,
    },
    Apptainer {
        executable: String,
        args: Vec<String>,
        worker: usize,
    },
}

pub(crate) fn begin_cancellation(state: &AppState, run_id: &str) -> Result<Vec<u32>, String> {
    let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_mut()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Running {
        return Err(format!("Processing run {run_id} is not cancellable"));
    }
    let pids = run.workers.iter().copied().collect::<Vec<_>>();
    validate_process_ids(&pids)?;
    run.transition(ProcessingLifecycle::Cancelling)?;
    Ok(pids)
}

pub(crate) fn cancelling_snapshot(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    let (processing_state, _) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_ref()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Cancelling {
        return Err(format!(
            "Processing run {run_id} cancellation was superseded"
        ));
    }
    Ok(run.snapshot())
}

pub(crate) fn complete_cancellation(
    state: &AppState,
    run_id: &str,
) -> Result<ProcessingRunSnapshot, String> {
    // Do not make the terminal record replaceable while its run-owned watcher
    // can still emit callbacks.
    super::watcher::stop_watch_lock_dir_impl(state, run_id)?;
    let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
    let run = processing_state
        .current_run
        .as_mut()
        .expect("matching run exists");
    if run.lifecycle != ProcessingLifecycle::Cancelling {
        return Err(format!(
            "Processing run {run_id} cancellation was superseded"
        ));
    }
    run.workers.clear();
    run.transition(ProcessingLifecycle::Cancelled)?;
    Ok(run.snapshot())
}

pub(crate) fn complete_supervised_worker(
    state: &AppState,
    run_id: &str,
    child_pid: u32,
    exit_code: i32,
) -> bool {
    let terminal_launch_failure =
        state
            .processing_state
            .lock()
            .ok()
            .is_some_and(|mut processing_state| {
                record_worker_exit(&mut processing_state, run_id, child_pid, exit_code)
                    && processing_state.current_run.as_ref().is_some_and(|run| {
                        run.run_id == run_id
                            && run.lifecycle == ProcessingLifecycle::Failed
                            && run.pending_launch_failure.is_some()
                    })
            });

    // Final child ownership is already reaped. Release only this run's watcher;
    // an obsolete supervisor can neither stop nor relabel replacement ownership.
    if terminal_launch_failure
        && let Err(error) = super::watcher::stop_watch_lock_dir_impl(state, run_id)
    {
        log::warn!("Failed to stop watcher after launch failure for {run_id}: {error}");
    }
    terminal_launch_failure
}

fn supervise_processing_worker(
    app: AppHandle,
    run_id: String,
    child_pid: u32,
    mut child: Child,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let exit_code = match child.wait() {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };

        let state = app.state::<AppState>();
        complete_supervised_worker(&state, &run_id, child_pid, exit_code);

        let _ = app.emit(
            "WorkerExited",
            WorkerExited {
                run_id,
                pid: child_pid,
                exit_code,
            },
        );
    })
}

/// A child spawned across the final launch-state check must never become an
/// unowned worker. This is intentionally reaped locally instead of installing
/// a supervisor: the run has already left launch state, so its membership must
/// remain authoritative and no live supervisor may keep the transition gate
/// occupied.
fn terminate_unregistered_worker(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn launch_failure_result(
    state: &AppState,
    run_id: &str,
    error: String,
) -> Result<ProcessingRunSnapshot, String> {
    match record_launch_failure_impl(state, run_id, error.clone()) {
        Ok(snapshot) if snapshot.lifecycle.is_terminal() => Err(error),
        Ok(snapshot) => Err(format!(
            "{error}. Processing run {run_id} remains {:?} with workers {:?}; use Kill to stop it.",
            snapshot.lifecycle, snapshot.workers
        )),
        Err(record_error) => Err(format!(
            "{error}. Failed to record launch failure: {record_error}"
        )),
    }
}

/// Spawn/register/supervise one launch under caller-held project-transition
/// ownership. Generic child hooks keep launch-edge races deterministic in tests.
pub(crate) fn launch_worker_set<ChildToken, Spawn, Supervise, Stagger, Terminate>(
    state: &AppState,
    run_id: &str,
    n_workers: usize,
    mut spawn: Spawn,
    mut supervise: Supervise,
    mut stagger: Stagger,
    mut terminate: Terminate,
) -> Result<ProcessingRunSnapshot, String>
where
    Spawn: FnMut(usize, usize) -> Result<(u32, ChildToken), String>,
    Supervise: FnMut(String, u32, ChildToken) -> WorkerSupervisor,
    Stagger: FnMut(),
    Terminate: FnMut(ChildToken),
{
    for i_worker in 1..=n_workers {
        if let Some(snapshot) = snapshot_before_worker_spawn(state, run_id)? {
            return Ok(snapshot);
        }
        if i_worker > 1 {
            stagger();
        }
        if let Some(snapshot) = snapshot_before_worker_spawn(state, run_id)? {
            return Ok(snapshot);
        }

        let (child_pid, child) = match spawn(i_worker, n_workers) {
            Ok(spawned) => spawned,
            Err(error) => return launch_failure_result(state, run_id, error),
        };

        {
            let (mut processing_state, _) = match matching_run_for_active_project(state, run_id) {
                Ok(ownership) => ownership,
                Err(error) => {
                    terminate(child);
                    return Err(error);
                }
            };
            let run = processing_state
                .current_run
                .as_mut()
                .expect("matching processing run exists");
            if !matches!(
                run.lifecycle,
                ProcessingLifecycle::Preparing | ProcessingLifecycle::Running
            ) {
                drop(processing_state);
                // Another worker crossed the post-stagger spawn boundary and
                // finalized this run. Never register this dead-authority child.
                terminate(child);
                return attach_run_impl(state, run_id);
            }
            run.workers.insert(child_pid);
            if run.lifecycle == ProcessingLifecycle::Preparing {
                run.transition(ProcessingLifecycle::Running)?;
            }
        }

        let supervisor = supervise(run_id.to_string(), child_pid, child);
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        processing_state.worker_supervisors.push(supervisor);
    }
    attach_run_impl(state, run_id)
}

pub(crate) fn join_worker_supervisors(state: &AppState, run_id: &str) -> Result<(), String> {
    let mut handles = {
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        std::mem::take(&mut processing_state.worker_supervisors)
    };
    let mut pending = Vec::new();
    for supervisor in handles.drain(..) {
        if supervisor.run_id != run_id {
            pending.push(supervisor);
            continue;
        }
        join_worker_supervisor(supervisor)?;
    }
    if !pending.is_empty() {
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        processing_state.worker_supervisors.extend(pending);
    }
    Ok(())
}

fn join_worker_supervisor(supervisor: WorkerSupervisor) -> Result<(), String> {
    supervisor
        .handle
        .join()
        .map_err(|_| "Processing worker supervisor failed while joining".to_string())
}

/// Reap only completed supervisors for one run. Terminal launch/finalization
/// paths call this while holding project transition ownership, so blocking on a
/// child that still needs to report an exit would deadlock that protocol.
pub(crate) fn reap_completed_worker_supervisors(
    state: &AppState,
    run_id: &str,
) -> Result<(), String> {
    let supervisors = {
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        std::mem::take(&mut processing_state.worker_supervisors)
    };
    let (completed, pending): (Vec<_>, Vec<_>) = supervisors
        .into_iter()
        .partition(|supervisor| supervisor.run_id == run_id && supervisor.handle.is_finished());
    for supervisor in completed {
        join_worker_supervisor(supervisor)?;
    }
    if !pending.is_empty() {
        let (mut processing_state, _) = matching_run_for_active_project(state, run_id)?;
        processing_state.worker_supervisors.extend(pending);
    }
    Ok(())
}

pub(crate) fn snapshot_before_worker_spawn(
    state: &AppState,
    run_id: &str,
) -> Result<Option<ProcessingRunSnapshot>, String> {
    let snapshot = attach_run_impl(state, run_id)?;
    if matches!(
        snapshot.lifecycle,
        ProcessingLifecycle::Preparing | ProcessingLifecycle::Running
    ) {
        return Ok(None);
    }
    if snapshot.workers.is_empty() && !snapshot.exit_evidence.is_empty() {
        return Ok(Some(snapshot));
    }
    Err(format!(
        "Processing run {run_id} left launch state: {:?}",
        snapshot.lifecycle
    ))
}

/// Terminate an already-validated exact PID set. Signal failure can race a
/// child exit; one immediate exact-PID recheck distinguishes harmless
/// disappearance from a live, actionable cancellation failure.
pub(crate) fn terminate_worker_processes_with<Exists, Terminate, Force, Sleep>(
    pids: &[u32],
    graceful_timeout: Duration,
    mut exists: Exists,
    mut terminate: Terminate,
    mut force: Force,
    mut sleep: Sleep,
) -> Result<(), String>
where
    Exists: FnMut(u32) -> Result<bool, String>,
    Terminate: FnMut(u32) -> Result<(), String>,
    Force: FnMut(u32) -> Result<(), String>,
    Sleep: FnMut(Duration),
{
    // Defense in depth: begin_cancellation validates before lifecycle mutation;
    // this second full-set validation remains before every injected OS adapter.
    validate_process_ids(pids)?;

    for &pid in pids {
        if exists(pid)?
            && let Err(signal_error) = terminate(pid)
        {
            match exists(pid) {
                Ok(false) => continue,
                Ok(true) => return Err(signal_error),
                Err(existence_error) => {
                    return Err(format!(
                        "{signal_error}; process disappearance could not be confirmed: {existence_error}"
                    ));
                }
            }
        }
    }

    let deadline = Instant::now() + graceful_timeout;
    loop {
        let all_dead = pids
            .iter()
            .map(|&pid| exists(pid))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .all(|is_live| !is_live);
        if all_dead || Instant::now() >= deadline {
            break;
        }
        sleep(Duration::from_millis(100));
    }

    for &pid in pids {
        if exists(pid)?
            && let Err(signal_error) = force(pid)
        {
            match exists(pid) {
                Ok(false) => continue,
                Ok(true) => return Err(signal_error),
                Err(existence_error) => {
                    return Err(format!(
                        "{signal_error}; process disappearance could not be confirmed: {existence_error}"
                    ));
                }
            }
        }
    }

    let remaining = pids
        .iter()
        .copied()
        .filter_map(|pid| match exists(pid) {
            Ok(true) => Some(Ok(pid)),
            Ok(false) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !remaining.is_empty() {
        return Err(format!(
            "Processing workers could not be reaped: {remaining:?}"
        ));
    }
    Ok(())
}

/// Exercise the command's full profile dispatch, preparation, and launch
/// protocol through injected process adapters. Production supplies real child
/// adapters; tests never need to invoke MATLAB or Apptainer.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_pipeline_with<
    ChildToken,
    Validate,
    WarmMcr,
    Spawn,
    Supervise,
    Stagger,
    Terminate,
>(
    state: &AppState,
    run_id: &str,
    execution_profile: &ExecutionProfile,
    data_par_json: &str,
    b_process: &[bool],
    workers: u32,
    subject_regexp: &str,
    rerun_bids2legacy: bool,
    mut validate_profile: Validate,
    mut warm_mcr: WarmMcr,
    mut spawn: Spawn,
    supervise: Supervise,
    stagger: Stagger,
    terminate: Terminate,
) -> Result<ProcessingRunSnapshot, String>
where
    Validate: FnMut(&ExecutionProfile) -> InternalValidation,
    WarmMcr: FnMut(&str, &Path, &Path) -> Result<(), String>,
    Spawn: FnMut(ProcessingWorkerCommand) -> Result<(u32, ChildToken), String>,
    Supervise: FnMut(String, u32, ChildToken) -> WorkerSupervisor,
    Stagger: FnMut(),
    Terminate: FnMut(ChildToken),
{
    let fail_launch = |error: String| launch_failure_result(state, run_id, error);
    // Admission failures are caller errors, not failures owned by whichever
    // healthy run happens to be current. Keep this read-only check outside the
    // broad launch-failure path.
    validate_launch_admission(state, run_id)?;
    let authority = match validate_launch_request(state, run_id, b_process, workers) {
        Ok(authority) => authority,
        Err(error) => return fail_launch(error),
    };
    let project_root = authority.project_root;
    let reserved_b_process = authority.b_process;
    let reserved_subject_regexp = authority.subject_regexp;
    let _ = subject_regexp;

    let validation = validate_profile(execution_profile);
    if !validation.valid {
        return fail_launch(validation.errors.join("; "));
    }

    enum ProcessingExecution {
        Matlab {
            executable: String,
            exploreasl_path: PathBuf,
        },
        Apptainer {
            executable: String,
            sif_path: PathBuf,
        },
    }

    let execution = match execution_profile {
        ExecutionProfile::Matlab {
            explore_asl_version,
            ..
        } => {
            let version = explore_asl_version
                .clone()
                .or(validation.explore_asl_version.clone());
            log::info!(
                "ExploreASL version: {}",
                version.as_deref().unwrap_or("unknown")
            );
            ProcessingExecution::Matlab {
                executable: validation
                    .matlab_path
                    .expect("validated matlab profile should include matlab path"),
                exploreasl_path: validation
                    .explore_asl_path
                    .expect("validated matlab profile should include exploreasl path"),
            }
        }
        ExecutionProfile::Apptainer { .. } => {
            log::info!(
                "ExploreASL version: {}",
                validation
                    .explore_asl_version
                    .as_deref()
                    .unwrap_or("unknown")
            );
            let executable = validation
                .apptainer_path
                .expect("validated Apptainer profile should include executable path");
            let sif_path = validation
                .sif_path
                .expect("validated Apptainer profile should include SIF path");
            if let Err(error) = warm_mcr(&executable, &sif_path, &project_root) {
                return fail_launch(error);
            }
            ProcessingExecution::Apptainer {
                executable,
                sif_path,
            }
        }
    };

    if let Err(error) = write_data_par_json(&project_root, data_par_json) {
        return fail_launch(format!("{error:#}"));
    }
    let lock_root = match ensure_lock_dir(&project_root) {
        Ok(lock_root) => lock_root,
        Err(error) => return fail_launch(format!("{error:#}")),
    };
    if let Err(error) = clear_stale_lock_dirs(&lock_root, &reserved_b_process) {
        return fail_launch(format!("{error:#}"));
    }
    if rerun_bids2legacy
        && let Err(error) = delete_bids2legacy_locks(&project_root, &reserved_subject_regexp)
    {
        return fail_launch(format!("{error:#}"));
    }
    if let Err(error) = delete_status_files_for_modules(
        &project_root,
        &reserved_b_process,
        &reserved_subject_regexp,
    ) {
        return fail_launch(format!("{error:#}"));
    }
    if let Err(error) =
        delete_module_log_files(&project_root, &reserved_b_process, &reserved_subject_regexp)
    {
        return fail_launch(format!("{error:#}"));
    }

    let b_process_str = reserved_b_process
        .iter()
        .map(|&selected| if selected { "1" } else { "0" })
        .collect::<Vec<_>>()
        .join(",");
    launch_worker_set(
        state,
        run_id,
        workers as usize,
        |worker, total_workers| {
            let command = match &execution {
                ProcessingExecution::Matlab {
                    executable,
                    exploreasl_path,
                } => ProcessingWorkerCommand::Matlab {
                    executable: executable.clone(),
                    batch: build_matlab_processing_batch(
                        exploreasl_path,
                        &project_root,
                        &b_process_str,
                        worker,
                        total_workers,
                    ),
                    worker,
                },
                ProcessingExecution::Apptainer {
                    executable,
                    sif_path,
                } => ProcessingWorkerCommand::Apptainer {
                    executable: executable.clone(),
                    args: build_apptainer_processing_args(
                        &project_root,
                        sif_path,
                        &b_process_str,
                        worker,
                        total_workers,
                    ),
                    worker,
                },
            };
            spawn(command)
        },
        supervise,
        stagger,
        terminate,
    )
}

#[tauri::command]
pub fn detect_exploreasl_version(explore_asl_path: String) -> Option<String> {
    let trace = CommandTrace::new("detect_exploreasl_version");
    trace.arg("explore_asl_path", &explore_asl_path);

    let path = PathBuf::from(explore_asl_path.trim());
    let version = if path.exists() {
        get_exploreasl_version(&path)
    } else {
        None
    };

    trace.success(&version);
    version
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
    execution_profile: ExecutionProfile,
    data_par_json: String,
    b_process: Vec<bool>,
    workers: u32,
    subject_regexp: String,
    rerun_bids2legacy: bool,
) -> Result<ProcessingRunSnapshot, String> {
    // Serializes direct IPC launch against project shutdown/root replacement.
    // This spans all run-scoped mutation and each spawn registration.
    let _transition = lock_project_transition(&state)?;
    let trace = CommandTrace::new("run_pipeline");
    trace.arg("run_id", &run_id);
    trace.arg("execution_profile_id", execution_profile.id());
    trace.arg("workers", workers.to_string());
    trace.arg("subject_regexp", &subject_regexp);
    trace.arg("rerun_bids2legacy", rerun_bids2legacy.to_string());

    let snapshot = run_pipeline_with(
        &state,
        &run_id,
        &execution_profile,
        &data_par_json,
        &b_process,
        workers,
        &subject_regexp,
        rerun_bids2legacy,
        ExecutionProfile::validate,
        |apptainer, sif, root| {
            ensure_mcr_cache(apptainer, sif, root).map_err(|error| format!("{error:#}"))
        },
        |command| match command {
            ProcessingWorkerCommand::Matlab {
                executable,
                batch,
                worker,
            } => {
                let child =
                    spawn_matlab_processing_process(&executable, &batch).map_err(|error| {
                        if error.kind() == std::io::ErrorKind::NotFound {
                            format!("MATLAB executable not found: {executable}")
                        } else {
                            format!("Failed to spawn MATLAB worker {worker}: {error}")
                        }
                    })?;
                Ok((child.id(), child))
            }
            ProcessingWorkerCommand::Apptainer {
                executable,
                args,
                worker,
            } => {
                let child =
                    spawn_apptainer_processing_process(&executable, &args).map_err(|error| {
                        if error.kind() == std::io::ErrorKind::NotFound {
                            format!("Apptainer executable not found: {executable}")
                        } else {
                            format!("Failed to spawn Apptainer worker {worker}: {error}")
                        }
                    })?;
                Ok((child.id(), child))
            }
        },
        |supervisor_run_id, child_pid, child| WorkerSupervisor {
            run_id: supervisor_run_id.clone(),
            handle: supervise_processing_worker(app.clone(), supervisor_run_id, child_pid, child),
        },
        || {
            // Avoid ExploreASL initialization races that cause early exits.
            std::thread::sleep(std::time::Duration::from_secs(2));
        },
        terminate_unregistered_worker,
    )?;
    trace.success(&snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn kill_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProcessingRunSnapshot, String> {
    let _transition = lock_project_transition(&state)?;
    let trace = CommandTrace::new("kill_pipeline");

    let pids = begin_cancellation(&state, &run_id)?;
    let cancelling = cancelling_snapshot(&state, &run_id)?;
    // Renderer state must not depend on an optimistic click while termination
    // waits. This snapshot is run-correlated and arrives before bounded waits.
    let _ = app.emit("ProcessingLifecycleSnapshot", &cancelling);

    terminate_worker_processes_with(
        &pids,
        Duration::from_secs(5),
        process_exists,
        send_termination_signal,
        force_kill_process,
        thread::sleep,
    )?;
    join_worker_supervisors(&state, &run_id)?;
    let snapshot = complete_cancellation(&state, &run_id)?;

    trace.success(&snapshot);
    Ok(snapshot)
}

pub fn stop_running_processing_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let (pids, watcher_active): (Vec<u32>, bool) = {
        let processing_state = lock_processing_state(&state)?;
        (
            processing_state
                .current_run
                .as_ref()
                .map(|run| run.workers.iter().copied().collect())
                .unwrap_or_default(),
            processing_state.watcher_stop.is_some() || processing_state.watcher_handle.is_some(),
        )
    };

    if pids.is_empty() && !watcher_active {
        return Ok(false);
    }
    validate_process_ids(&pids)?;

    for &pid in &pids {
        if process_exists(pid)? {
            send_termination_signal(pid)?;
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let all_dead = pids
            .iter()
            .map(|&pid| process_exists(pid))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .all(|exists| !exists);
        if all_dead {
            break;
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }

    for &pid in &pids {
        if process_exists(pid)? {
            force_kill_process(pid)?;
        }
    }

    if pids
        .iter()
        .map(|&pid| process_exists(pid))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .any(|exists| exists)
    {
        return Err("Processing workers could not be confirmed stopped".to_string());
    }

    let mut processing_state = lock_processing_state(&state)?;
    if let Some(run) = processing_state.current_run.as_mut() {
        run.workers.clear();
    }

    let stop_tx = processing_state.watcher_stop.take();
    let handle = processing_state.watcher_handle.take();
    let supervisors = std::mem::take(&mut processing_state.worker_supervisors);
    processing_state.watcher_run_id = None;
    drop(processing_state);

    if let Some(sender) = stop_tx {
        let _ = sender.send(());
    }
    if let Some(handle) = handle {
        let _ = handle.join();
    }
    for supervisor in supervisors {
        let _ = supervisor.handle.join();
    }

    Ok(true)
}
