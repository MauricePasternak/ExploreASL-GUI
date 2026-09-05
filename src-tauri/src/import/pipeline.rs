use super::output::{cleanup_staging_root, contains_portable_subject, owned_subject_spelling};
use super::parser::{
    ImportOutputLine, ImportOutputLineSource, ImportOutputParser, ImportStructuredEvent,
    progress_bar_re,
};
use super::staging::{
    StagingEntry, compile_staging_plan, execute_compiled_staging_plan, portable_key,
};
use super::state::{
    RESERVED_IMPORT_PID, bind_relocation_plan_for_run, cleanup_after_prepare_event_failure,
    clear_matching_import, clear_reserved_import, emit_prepare_complete_for_running_import,
    mark_import_terminal_if_matches, reserve_import_state_for_run, rollback_process_spawn_failure,
    rollback_reserved_operational_failure, set_import_supervisor_handle, set_reserved_import_pid,
    validate_relocation_plan_for_run,
};
use super::status::copy_lock_files_paths;
use super::types::{
    ImportCommandError, ImportLifecycle, ImportRawEventPayload, ImportState,
    ImportStructuredEventPayload, MatlabExitError,
};
use super::validation::{normalize_staging_subject_spelling, validate_import_request_inputs};
use crate::app_state::AppState;
use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH, ensure_mcr_cache};
use crate::execution_profile::ExecutionProfile;
use crate::process_control::{
    force_kill_process, send_termination_signal, validate_process_id, wait_for_process_exit,
};
use anyhow::{Context, Result as AnyResult};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub(super) fn read_pipe_lines<R>(
    reader: R,
    source: ImportOutputLineSource,
    sender: mpsc::Sender<ImportOutputLine>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) => {
                    let output_line = ImportOutputLine { source, line };
                    if sender.send(output_line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    })
}

pub(super) fn record_import_results(
    import_state: &mut ImportState,
    generation: u64,
    event: &ImportStructuredEvent,
) -> bool {
    if import_state.ownership_generation != generation {
        return false;
    }

    match event {
        ImportStructuredEvent::ImportFailed { subject, .. }
            if owned_subject_spelling(&import_state.subject_list, subject).is_some() =>
        {
            let canonical = owned_subject_spelling(&import_state.subject_list, subject)
                .expect("guarded owned subject")
                .to_string();
            if !contains_portable_subject(&import_state.failed_subjects, &canonical) {
                import_state.failed_subjects.push(canonical.clone());
            }
            import_state
                .succeeded_subjects
                .retain(|owned| portable_key(owned) != portable_key(&canonical));
        }
        ImportStructuredEvent::SubjectComplete { subject, .. }
            if owned_subject_spelling(&import_state.subject_list, subject).is_some()
                && !contains_portable_subject(&import_state.failed_subjects, subject) =>
        {
            let canonical = owned_subject_spelling(&import_state.subject_list, subject)
                .expect("guarded owned subject")
                .to_string();
            if !contains_portable_subject(&import_state.succeeded_subjects, &canonical) {
                import_state.succeeded_subjects.push(canonical);
            }
        }
        ImportStructuredEvent::ImportComplete => {
            let succeeded = import_state
                .subject_list
                .iter()
                .filter(|subject| {
                    !contains_portable_subject(&import_state.failed_subjects, subject)
                })
                .cloned()
                .collect();
            import_state.succeeded_subjects = succeeded;
        }
        _ => {}
    }
    true
}

pub(super) fn canonicalize_import_event_subject(
    event: &mut ImportStructuredEvent,
    owned_subjects: &[String],
) -> bool {
    let subject = match event {
        ImportStructuredEvent::SubjectStart { subject, .. }
        | ImportStructuredEvent::SubjectComplete { subject, .. }
        | ImportStructuredEvent::ImportFailed { subject, .. }
        | ImportStructuredEvent::Dcm2NiiStatus { subject, .. } => subject,
        ImportStructuredEvent::ImportComplete => return true,
    };
    let Some(canonical) = owned_subject_spelling(owned_subjects, subject) else {
        return false;
    };
    if subject != canonical {
        *subject = canonical.to_string();
    }
    true
}

pub(super) fn emit_structured_events<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    events: Vec<ImportStructuredEvent>,
) -> bool {
    let mut saw_import_complete = false;
    for mut event in events {
        if matches!(event, ImportStructuredEvent::ImportComplete) {
            saw_import_complete = true;
            continue;
        }
        let state = app.state::<AppState>();
        let emitted = state
            .import_state
            .lock()
            .ok()
            .is_some_and(|mut import_state| {
                if !canonicalize_import_event_subject(&mut event, &import_state.subject_list) {
                    return false;
                }
                if !record_import_results(&mut import_state, generation, &event) {
                    return false;
                }
                // Hold ownership through the event so a later reservation cannot
                // receive output from this generation.
                let _ = app.emit(
                    "import-structured-event",
                    ImportStructuredEventPayload {
                        event,
                        run_request_id: import_state.run_request_id.clone(),
                        ownership_generation: generation,
                    },
                );
                true
            });
        if emitted {
            continue;
        }
    }
    saw_import_complete
}

pub fn mark_import_termination_requested(state: &mut ImportState, pid: u32) {
    if state.child_pid == Some(pid) {
        state.termination_requested_for = Some(pid);
    }
}

pub fn should_emit_matlab_exit_error(
    state: &mut ImportState,
    child_pid: u32,
    success: bool,
) -> bool {
    if success {
        if state.termination_requested_for == Some(child_pid) {
            state.termination_requested_for = None;
        }
        return false;
    }

    if state.termination_requested_for == Some(child_pid) {
        state.termination_requested_for = None;
        return false;
    }

    true
}

pub(super) fn stream_import_output<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    output_line: ImportOutputLine,
    parser: &mut ImportOutputParser,
) -> bool {
    let is_progress = progress_bar_re().is_match(&output_line.line);
    if !is_progress {
        let trimmed = output_line.line.trim().to_string();
        if !parser.is_duplicate(&trimmed) {
            parser.record_line(trimmed);
            let state = app.state::<AppState>();
            let _ = state.import_state.lock().ok().and_then(|import_state| {
                if import_state.ownership_generation != generation {
                    return None;
                }
                // Hold ownership through the event so stale raw output cannot
                // be delivered after a replacement reservation.
                app.emit(
                    "import-raw-event",
                    ImportRawEventPayload {
                        line: output_line.line.clone(),
                        run_request_id: import_state.run_request_id.clone(),
                        ownership_generation: generation,
                    },
                )
                .ok()
            });
        }
    }

    emit_structured_events(
        app,
        generation,
        parser.push_line(&output_line.line, output_line.source),
    )
}

pub(super) fn supervise_import_process<R: Runtime>(
    app: AppHandle<R>,
    generation: u64,
    child_pid: u32,
    mut child: Child,
    subject_list: Vec<String>,
    start_receiver: mpsc::Receiver<()>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        if !start_supervisor_or_reap(&mut child, start_receiver) {
            return;
        }
        let (sender, receiver) = mpsc::channel();
        let stdout_thread = child
            .stdout
            .take()
            .map(|stdout| read_pipe_lines(stdout, ImportOutputLineSource::Stdout, sender.clone()));
        let stderr_thread = child
            .stderr
            .take()
            .map(|stderr| read_pipe_lines(stderr, ImportOutputLineSource::Stderr, sender.clone()));
        drop(sender);

        let mut parser = ImportOutputParser::new(&subject_list);
        let mut saw_import_complete = false;
        for output_line in receiver {
            saw_import_complete |= stream_import_output(&app, generation, output_line, &mut parser);
        }

        if let Some(handle) = stdout_thread {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_thread {
            let _ = handle.join();
        }
        let finished_events = parser.finish();
        if let Ok(status) = child.wait() {
            let state = app.state::<AppState>();
            let _ = state.import_state.lock().ok().and_then(|mut import_state| {
                if !mark_import_terminal_if_matches(&mut import_state, generation, child_pid) {
                    return None;
                }

                let should_emit_exit_error =
                    should_emit_matlab_exit_error(&mut import_state, child_pid, status.success());
                for event in finished_events {
                    if matches!(event, ImportStructuredEvent::ImportComplete) {
                        saw_import_complete = true;
                        continue;
                    }
                    if record_import_results(&mut import_state, generation, &event) {
                        let _ = app.emit(
                            "import-structured-event",
                            ImportStructuredEventPayload {
                                event,
                                run_request_id: import_state.run_request_id.clone(),
                                ownership_generation: generation,
                            },
                        );
                    }
                }
                if status.success()
                    && saw_import_complete
                    && record_import_results(
                        &mut import_state,
                        generation,
                        &ImportStructuredEvent::ImportComplete,
                    )
                {
                    let _ = app.emit(
                        "import-structured-event",
                        ImportStructuredEventPayload {
                            event: ImportStructuredEvent::ImportComplete,
                            run_request_id: import_state.run_request_id.clone(),
                            ownership_generation: generation,
                        },
                    );
                }
                if should_emit_exit_error {
                    let _ = app.emit(
                        "MatlabExitError",
                        MatlabExitError {
                            exit_code: status.code().unwrap_or(-1),
                            run_request_id: import_state.run_request_id.clone(),
                            ownership_generation: generation,
                        },
                    );
                }
                Some(())
            });
        }
    })
}

pub(super) fn start_supervisor_or_reap(
    child: &mut Child,
    start_receiver: mpsc::Receiver<()>,
) -> bool {
    if start_receiver.recv().is_ok() {
        return true;
    }

    let _ = child.kill();
    let _ = child.wait();
    false
}

pub(super) fn spawn_matlab_import_process(
    matlab_path: &str,
    batch: &str,
) -> std::io::Result<Child> {
    log::info!(
        "[IMPORT] Spawning MATLAB process: {} with batch: {}",
        matlab_path,
        batch
    );
    let mut command = crate::apptainer::create_system_command(matlab_path);
    command
        .arg("-batch")
        .arg(batch)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        // GenerateConsoleCtrlEvent uses the child PID as the process group id.
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

pub(crate) fn build_apptainer_import_args(staging_root: &Path, sif_path: &Path) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--cleanenv".to_string(),
        "--writable-tmpfs".to_string(),
        "--bind".to_string(),
        format!("{}:{CONTAINER_DATA_ROOT}", staging_root.display()),
        sif_path.to_string_lossy().to_string(),
        "/bin/bash".to_string(),
        EXPLOREASL_SCRIPT.to_string(),
        MCR_PATH.to_string(),
        CONTAINER_DATA_ROOT.to_string(),
        "[1,1,0]".to_string(),
        "0".to_string(),
    ]
}

pub(super) fn spawn_apptainer_import_process(
    apptainer_path: &str,
    args: &[String],
) -> std::io::Result<Child> {
    log::info!(
        "[IMPORT] Spawning Apptainer import process: {} args: {:?}",
        apptainer_path,
        args
    );
    let mut command = crate::apptainer::create_system_command(apptainer_path);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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

pub(super) fn take_matching_supervisor_handle(
    state: &AppState,
    generation: u64,
    pid: u32,
) -> Option<thread::JoinHandle<()>> {
    state.import_state.lock().ok().and_then(|mut import_state| {
        if import_state.ownership_generation != generation {
            return None;
        }
        match import_state.lifecycle {
            ImportLifecycle::Running if import_state.child_pid == Some(pid) => {
                import_state.child_pid = None;
                import_state.lifecycle = ImportLifecycle::Terminal;
                import_state.supervisor_handle.take()
            }
            // The supervisor may have observed exit before a stopper takes its
            // handle. The generation guard still makes this handle exclusive.
            ImportLifecycle::Terminal => import_state.supervisor_handle.take(),
            _ => None,
        }
    })
}

pub fn authorize_stop_import_pid(state: &AppState, pid: u32) -> Result<(), String> {
    let import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    authorize_import_state_pid(&import_state, pid)
}

pub(super) fn authorize_import_state_pid(
    import_state: &ImportState,
    pid: u32,
) -> Result<(), String> {
    if import_state.lifecycle == ImportLifecycle::Preparing && pid == RESERVED_IMPORT_PID {
        return Err("Import is still preparing and cannot be stopped yet".to_string());
    }
    validate_process_id(pid)?;
    if import_state.lifecycle == ImportLifecycle::Preparing {
        return Err("Import is still preparing and cannot be stopped yet".to_string());
    }

    if import_state.lifecycle != ImportLifecycle::Running {
        return Err("No import process is currently running".to_string());
    }
    match import_state.child_pid {
        None => Err("No import process is currently running".to_string()),
        Some(active_pid) if active_pid != pid => Err(format!(
            "Requested PID {pid} does not match active import PID {active_pid}"
        )),
        Some(_) => Ok(()),
    }
}

pub(super) fn clear_matching_termination_intent(
    import_state: &mut ImportState,
    generation: u64,
    pid: u32,
) {
    if import_state.ownership_generation == generation
        && import_state.child_pid == Some(pid)
        && import_state.termination_requested_for == Some(pid)
    {
        import_state.termination_requested_for = None;
    }
}

pub(super) fn confirm_import_termination_with(
    state: &AppState,
    pid: u32,
    send_signal: impl FnOnce(u32) -> Result<(), String>,
    force_kill: impl FnOnce(u32) -> Result<(), String>,
    mut wait_for_exit: impl FnMut(u32, Duration) -> Result<bool, String>,
) -> Result<u64, String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    validate_process_id(pid)?;
    authorize_import_state_pid(&import_state, pid)?;
    let generation = import_state.ownership_generation;

    // Keep ownership locked until Stop succeeds or its intent has been removed.
    // The supervisor waits on its child before acquiring this mutex, so its
    // terminal exit decision cannot consume a provisional termination intent.
    send_signal(pid)?;
    mark_import_termination_requested(&mut import_state, pid);

    let result = match wait_for_exit(pid, Duration::from_secs(5)) {
        Ok(true) => Ok(()),
        Ok(false) => match force_kill(pid) {
            Ok(()) => match wait_for_exit(pid, Duration::from_secs(1)) {
                Ok(true) => Ok(()),
                Ok(false) => Err(format!(
                    "Import process {pid} could not be confirmed stopped"
                )),
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };

    if result.is_err() {
        clear_matching_termination_intent(&mut import_state, generation, pid);
    }
    result.map(|()| generation)
}

pub(super) fn stop_import_pid_with(
    state: &AppState,
    pid: u32,
    send_signal: impl FnOnce(u32) -> Result<(), String>,
    force_kill: impl FnOnce(u32) -> Result<(), String>,
    wait_for_exit: impl FnMut(u32, Duration) -> Result<bool, String>,
) -> Result<(), String> {
    let generation =
        confirm_import_termination_with(state, pid, send_signal, force_kill, wait_for_exit)?;

    if let Some(handle) = take_matching_supervisor_handle(state, generation, pid) {
        let _ = handle.join();
    }

    Ok(())
}

pub fn stop_import_pid(state: &AppState, pid: u32) -> Result<(), String> {
    stop_import_pid_with(
        state,
        pid,
        send_termination_signal,
        force_kill_process,
        wait_for_process_exit,
    )
}

pub fn stop_import_pid_for_exit(state: &AppState, pid: u32) -> Result<(), String> {
    let generation = confirm_import_termination_with(
        state,
        pid,
        send_termination_signal,
        force_kill_process,
        wait_for_process_exit,
    )?;

    let _ = take_matching_supervisor_handle(state, generation, pid);

    Ok(())
}

pub(super) fn stop_active_import_for_state(state: &AppState) -> Result<(), String> {
    let (lifecycle, pid) = {
        let import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        (import_state.lifecycle, import_state.child_pid)
    };

    match (lifecycle, pid) {
        (ImportLifecycle::Preparing, Some(RESERVED_IMPORT_PID)) => {
            Err("Import is still preparing and cannot be stopped yet".to_string())
        }
        (_, Some(pid)) => {
            validate_process_id(pid)?;
            stop_import_pid(state, pid)
        }
        (_, None) => Err("No import process is currently running".to_string()),
    }
}

pub fn stop_running_import_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let (lifecycle, pid) = {
        let import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        (import_state.lifecycle, import_state.child_pid)
    };

    match (lifecycle, pid) {
        (ImportLifecycle::Preparing, Some(RESERVED_IMPORT_PID)) => Ok(false),
        (_, Some(pid)) => {
            validate_process_id(pid)?;
            stop_import_pid_for_exit(&state, pid)?;
            Ok(true)
        }
        (_, None) => Ok(false),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_import_pipeline_impl<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    execution_profile: ExecutionProfile,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    run_request_id: String,
    relocation_plan_id: String,
) -> Result<u32, ImportCommandError> {
    validate_import_request_inputs(&staging_entries, &subject_list)?;
    let staging_entries = normalize_staging_subject_spelling(&staging_entries, &subject_list)?;
    if run_request_id.trim().is_empty() {
        return Err("run_request_id must not be empty".to_string().into());
    }
    if relocation_plan_id.trim().is_empty() {
        return Err("relocation_plan_id must not be empty".to_string().into());
    }

    if !sourcestructure_json.is_object() {
        return Err("sourcestructure_json must be a JSON object"
            .to_string()
            .into());
    }
    if !studypar_json.is_object() {
        return Err("studypar_json must be a JSON object".to_string().into());
    }

    let validation = execution_profile.validate();
    if !validation.valid {
        return Err(validation.errors.join("; ").into());
    }

    enum ImportExecution {
        Matlab {
            matlab_path: String,
            exploreasl_path: PathBuf,
        },
        Apptainer {
            apptainer_path: String,
            sif_path: PathBuf,
        },
    }

    let execution = match execution_profile {
        ExecutionProfile::Matlab { .. } => ImportExecution::Matlab {
            matlab_path: validation
                .matlab_path
                .expect("validated matlab profile should include matlab path"),
            exploreasl_path: validation
                .explore_asl_path
                .expect("validated matlab profile should include exploreasl path"),
        },
        ExecutionProfile::Apptainer { .. } => ImportExecution::Apptainer {
            apptainer_path: validation
                .apptainer_path
                .expect("validated Apptainer profile should include executable path"),
            sif_path: validation
                .sif_path
                .expect("validated Apptainer profile should include SIF path"),
        },
    };

    let compiled_plan = compile_staging_plan(
        state
            .active_project_root
            .lock()
            .map_err(|_| "Active project state lock was poisoned".to_string())?
            .clone(),
        &staging_entries,
    )
    .map_err(|result| ImportCommandError::Preflight {
        issues: result.issues,
    })?;
    // All operations after validation use the immutable, canonical plan root.
    let staging_root = compiled_plan.staging_root.clone();
    let project_root = compiled_plan
        .staging_root
        .parent()
        .expect("compiled staging root has a parent")
        .to_path_buf();
    let stream_subject_list = subject_list.clone();
    // Reject foreign, stale-scope, and already-consumed plans before replacing
    // import ownership or touching staging.
    validate_relocation_plan_for_run(state, &relocation_plan_id, &project_root, &subject_list)?;
    let reservation = reserve_import_state_for_run(
        state,
        staging_root.clone(),
        project_root.clone(),
        run_request_id,
        subject_list,
        subjects_to_preserve,
        relocation_plan_id.clone(),
    )?;
    let generation = reservation.generation;
    if let Err(error) = bind_relocation_plan_for_run(
        state,
        &relocation_plan_id,
        &project_root,
        &stream_subject_list,
        generation,
    ) {
        clear_reserved_import(state, generation);
        return Err(error.into());
    }

    cleanup_staging_root(&staging_root).map_err(|error| {
        rollback_reserved_operational_failure(state, generation, &staging_root, error)
    })?;

    execute_compiled_staging_plan(&compiled_plan).map_err(|error| {
        rollback_reserved_operational_failure(state, generation, &staging_root, error)
    })?;

    fs::create_dir_all(&staging_root)
        .with_context(|| {
            format!(
                "Failed to create staging directory {}",
                staging_root.display()
            )
        })
        .map_err(|error| {
            rollback_reserved_operational_failure(state, generation, &staging_root, error)
        })?;
    write_config_json(
        &staging_root.join("sourcestructure.json"),
        &sourcestructure_json,
    )
    .map_err(|error| {
        rollback_reserved_operational_failure(state, generation, &staging_root, error)
    })?;
    write_config_json(&staging_root.join("studyPar.json"), &studypar_json)
        .map_err(|e| rollback_reserved_operational_failure(state, generation, &staging_root, e))?;

    if !reservation.preserved_subjects.is_empty() {
        copy_lock_files_paths(
            &project_root,
            &staging_root,
            &reservation.preserved_subjects,
        )
        .map_err(|error| {
            rollback_reserved_operational_failure(state, generation, &staging_root, error)
        })?;
    }

    let mut child = match execution {
        ImportExecution::Matlab {
            matlab_path,
            exploreasl_path,
        } => {
            let batch = format!(
                "addpath('{}'); ExploreASL('{}', [1,1,0], 0, 0)",
                escape_matlab_string(&exploreasl_path.to_string_lossy()),
                escape_matlab_string(&staging_root.to_string_lossy()),
            );
            spawn_matlab_import_process(&matlab_path, &batch).map_err(|error| {
                rollback_process_spawn_failure(
                    state,
                    generation,
                    &staging_root,
                    "MATLAB",
                    &matlab_path,
                    error,
                )
            })?
        }
        ImportExecution::Apptainer {
            apptainer_path,
            sif_path,
        } => {
            ensure_mcr_cache(&apptainer_path, &sif_path, &staging_root).map_err(|error| {
                rollback_reserved_operational_failure(state, generation, &staging_root, error)
            })?;
            let args = build_apptainer_import_args(&staging_root, &sif_path);
            spawn_apptainer_import_process(&apptainer_path, &args).map_err(|error| {
                rollback_process_spawn_failure(
                    state,
                    generation,
                    &staging_root,
                    "Apptainer",
                    &apptainer_path,
                    error,
                )
            })?
        }
    };
    let child_pid = child.id();

    if let Err(err) = set_reserved_import_pid(state, generation, child_pid) {
        let _ = child.kill();
        let _ = child.wait();
        if clear_matching_import(state, generation) {
            let _ = cleanup_staging_root(&staging_root);
        }
        return Err(err.into());
    }

    // Keep the supervisor gated until readiness is delivered. This gives a
    // failed readiness emission one owner that can terminate and reap the
    // child before staging and matching ownership are released.
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor_handle = supervise_import_process(
        app.clone(),
        generation,
        child_pid,
        child,
        stream_subject_list,
        start_receiver,
    );
    if let Err((err, supervisor_handle)) =
        set_import_supervisor_handle(state, generation, child_pid, supervisor_handle)
    {
        drop(start_sender);
        let _ = supervisor_handle.join();
        if clear_matching_import(state, generation) {
            let _ = cleanup_staging_root(&staging_root);
        }
        return Err(err.into());
    }

    match emit_prepare_complete_for_running_import(&app, state, generation, child_pid) {
        Ok(true) => {}
        Ok(false) => {
            drop(start_sender);
            if let Some(handle) = take_matching_supervisor_handle(state, generation, child_pid) {
                let _ = handle.join();
            }
            let error = cleanup_after_prepare_event_failure(
                state,
                generation,
                &staging_root,
                "Import state changed before ImportPrepareComplete could be emitted".to_string(),
            );
            return Err(error.into());
        }
        Err(error) => {
            drop(start_sender);
            if let Some(handle) = take_matching_supervisor_handle(state, generation, child_pid) {
                let _ = handle.join();
            }
            let error =
                cleanup_after_prepare_event_failure(state, generation, &staging_root, error);
            return Err(error.into());
        }
    }
    if start_sender.send(()).is_err() {
        if let Some(handle) = take_matching_supervisor_handle(state, generation, child_pid) {
            let _ = handle.join();
        }
        let error = cleanup_after_prepare_event_failure(
            state,
            generation,
            &staging_root,
            "Import supervisor stopped before it could begin".to_string(),
        );
        return Err(error.into());
    }

    Ok(child_pid)
}

pub(super) fn write_config_json(path: &Path, value: &Value) -> AnyResult<()> {
    let contents = serde_json::to_string_pretty(value)
        .with_context(|| format!("Failed to serialize {}", path.display()))?;
    fs::write(path, contents).with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

pub(super) fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}
