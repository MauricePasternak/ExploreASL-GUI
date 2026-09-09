use super::output::{cleanup_staging_root, owned_subject_spelling};
use super::parser::{
    ImportOutputLine, ImportOutputLineSource, ImportOutputParser, ImportStructuredEvent,
    progress_bar_re,
};
use super::staging::{StagingEntry, compile_staging_plan, execute_compiled_staging_plan};
use super::state::{
    RESERVED_IMPORT_PID, admit_reserved_import_launch, bind_relocation_plan_for_run,
    cleanup_after_prepare_event_failure, emit_running_snapshot, rollback_process_spawn_failure,
    rollback_reserved_operational_failure, set_import_supervisor_handle, set_reserved_import_pid,
    validate_relocation_plan_for_run,
};
use super::status::copy_lock_files_paths;
use super::types::{
    ImportCommandError, ImportLifecycle, ImportRawEventPayload, ImportState,
    ImportStructuredEventPayload,
};
use super::validation::{normalize_staging_subject_spelling, validate_import_request_inputs};
use super::verification::prepare_generation;
use crate::app_state::AppState;
use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH, ensure_mcr_cache};
use crate::error::MutexExt;
use crate::execution_profile::ExecutionProfile;
use crate::process_control::{
    force_kill_process, send_termination_signal, validate_process_id, wait_for_process_exit,
};
use anyhow::{Context, Result as AnyResult, bail};
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

pub(crate) fn accepts_import_diagnostic(import_state: &ImportState, generation: u64) -> bool {
    import_state.ownership_generation == generation
        && matches!(
            import_state.lifecycle,
            ImportLifecycle::Running | ImportLifecycle::Cancelling
        )
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
        }
        let state = app.state::<AppState>();
        let emitted = state.import_state.lock().ok().is_some_and(|import_state| {
            if !canonicalize_import_event_subject(&mut event, &import_state.subject_list) {
                return false;
            }
            if !accepts_import_diagnostic(&import_state, generation) {
                return false;
            }
            // Hold ownership through the event so a later reservation cannot
            // receive output from this generation.
            let _ = app.emit(
                "import-structured-event",
                ImportStructuredEventPayload {
                    event,
                    run_id: import_state.run_id.clone(),
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
                        run_id: import_state.run_id.clone(),
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
        for output_line in receiver {
            let _ = stream_import_output(&app, generation, output_line, &mut parser);
        }

        if let Some(handle) = stdout_thread {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_thread {
            let _ = handle.join();
        }
        let finished_events = parser.finish();
        if let Ok(status) = child.wait() {
            // Parser output stays diagnostic.  Flush terminal parser diagnostics
            // before durable exit classification, but never promote it to success.
            for event in finished_events {
                if !matches!(event, ImportStructuredEvent::ImportComplete) {
                    let _ = emit_structured_events(&app, generation, vec![event]);
                }
            }
            let state = app.state::<AppState>();
            let exit_code = status.code().unwrap_or(-1);
            if let Ok(snapshot) =
                record_import_process_exit(&state, generation, child_pid, exit_code)
            {
                if snapshot.lifecycle == ImportLifecycle::Finalizing {
                    // Finalizing is independently durable and visible before
                    // verification, cleanup, or relocation work begins.
                    let _ = app.emit("import-run-snapshot", snapshot);
                    if let Ok(terminal) = complete_finalizing_import(&state, generation, exit_code)
                    {
                        release_terminal_supervisor_handle(&state, generation);
                        let _ = app.emit("import-run-snapshot", terminal);
                    }
                } else {
                    release_terminal_supervisor_handle(&state, generation);
                    let _ = app.emit("import-run-snapshot", snapshot);
                }
            }
        }
    })
}

fn release_terminal_supervisor_handle(state: &AppState, generation: u64) {
    // A naturally completed supervisor has no external joiner. Drop its self
    // handle only after durable terminal state; project shutdown otherwise
    // treats the finished handle as live ownership and cannot close.
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && run.lifecycle.is_terminal()
        && run.child_pid.is_none()
    {
        run.supervisor_handle.take();
    }
}

pub(crate) fn record_import_process_exit(
    state: &AppState,
    generation: u64,
    child_pid: u32,
    exit_code: i32,
) -> AnyResult<super::types::ImportRunSnapshot> {
    use super::types::ImportExitEvidence;

    {
        let mut run = state
            .import_state
            .lock()
            .map_err(|_| anyhow::anyhow!("Import state lock was poisoned"))?;
        if run.ownership_generation != generation || run.child_pid != Some(child_pid) {
            bail!("Import supervisor is obsolete");
        }
        if run.lifecycle == ImportLifecycle::Cancelling
            && run.termination_requested_for == Some(child_pid)
        {
            let prior_updated_at = run.updated_at_ms;
            run.child_pid = None;
            run.termination_requested_for = None;
            run.transition(ImportLifecycle::Cancelled)
                .map_err(anyhow::Error::msg)?;
            run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
            run.terminal_result = Some(super::types::ImportTerminalResult::Cancelled);
            if let Err(error) = super::journal::write_record(
                &run.project_root,
                &super::journal::record_from_state(&run)?,
            ) {
                run.lifecycle = ImportLifecycle::Cancelling;
                run.updated_at_ms = prior_updated_at;
                run.child_pid = Some(child_pid);
                run.terminal_result = None;
                return Err(error);
            }
            return Ok(run.snapshot());
        }
        if run.lifecycle == ImportLifecycle::Cancelling {
            // Cancellation failed or became unconfirmed before exit. The exit
            // remains authoritative, but must follow normal finalization rather
            // than falsely claiming Cancelled.
            run.transition(ImportLifecycle::Running)
                .map_err(anyhow::Error::msg)?;
        }
        if run.lifecycle != ImportLifecycle::Running {
            bail!("Import supervisor no longer owns a running process");
        }
        run.child_pid = None;
        let prior_updated_at = run.updated_at_ms;
        run.exit_evidence = Some(ImportExitEvidence {
            exit_code,
            successful: exit_code == 0,
        });
        // Durable exit evidence precedes Finalizing and any filesystem mutation.
        run.transition(ImportLifecycle::Finalizing)
            .map_err(anyhow::Error::msg)?;
        if let Err(error) = super::journal::write_record(
            &run.project_root,
            &super::journal::record_from_state(&run)?,
        ) {
            run.lifecycle = ImportLifecycle::Running;
            run.updated_at_ms = prior_updated_at;
            run.exit_evidence = None;
            run.child_pid = Some(child_pid);
            return Err(error);
        }
    }
    let run = state.import_state.lock_or_bail("Import state")?;
    Ok(run.snapshot())
}

/// Resume a crash-surviving finalization after relocation journal recovery.
/// The record already contains durable exit evidence and an immutable plan.
pub(crate) fn resume_finalizing_import(
    state: &AppState,
    generation: u64,
) -> AnyResult<super::types::ImportRunSnapshot> {
    let exit_code = {
        let run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Finalizing {
            bail!("Import run is not eligible for finalization recovery");
        }
        let exit = run
            .exit_evidence
            .as_ref()
            .context("Finalizing import record lacks exit evidence")?;
        exit.exit_code
    };
    complete_finalizing_import(state, generation, exit_code)
}

pub(crate) fn complete_finalizing_import(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<super::types::ImportRunSnapshot> {
    use super::relocation::{RelocationSubjectStatus, relocate};
    use super::types::{ImportStructuredError, ImportSubjectOutcomeKind, ImportTerminalResult};
    use super::verification::verify_subject;

    let (
        project_root,
        staging_root,
        subjects,
        staging_generation,
        plan,
        checkpointed_relocation,
        preserve_staging,
    ) = {
        let run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Finalizing {
            bail!("Import finalizer is obsolete");
        }
        (
            run.project_root.clone(),
            run.staging_root.clone(),
            run.subject_list.clone(),
            run.staging_generation.clone(),
            run.relocation_plan
                .clone()
                .context("Finalizing import record lacks confirmed relocation plan")?,
            run.relocation_outcome.clone(),
            run.preserve_staging,
        )
    };

    let (mut outcomes, relocation_outcome, mut cleanup_errors) =
        if let Some(relocation) = checkpointed_relocation {
            // Relocation recovery may already have removed its journal. The run
            // checkpoint is then sole proof that committed output must not move
            // again. Reuse the prior verification checkpoint and outcome verbatim.
            let outcomes = {
                let run = state.import_state.lock_or_bail("Import state")?;
                if run.subject_outcomes.is_empty() {
                    bail!("Relocation checkpoint lacks prior subject verification evidence");
                }
                run.subject_outcomes.clone()
            };
            (outcomes, Some(relocation), Vec::new())
        } else {
            let outcomes = subjects
                .iter()
                .map(|subject| verify_subject(&staging_root, subject, &staging_generation))
                .collect::<Vec<_>>();
            let verified = outcomes
                .iter()
                .filter(|outcome| outcome.outcome == ImportSubjectOutcomeKind::Verified)
                .map(|outcome| outcome.subject.clone())
                .collect::<Vec<_>>();
            // Verification checkpoint is durable before failed-lock cleanup or
            // relocation may mutate staging/project output.
            {
                let mut run = state.import_state.lock_or_bail("Import state")?;
                if run.ownership_generation != generation
                    || run.lifecycle != ImportLifecycle::Finalizing
                {
                    bail!("Import finalizer became obsolete before verification checkpoint");
                }
                let prior_outcomes = std::mem::replace(&mut run.subject_outcomes, outcomes.clone());
                if let Err(error) = super::journal::write_record(
                    &run.project_root,
                    &super::journal::record_from_state(&run)?,
                ) {
                    run.subject_outcomes = prior_outcomes;
                    return Err(error);
                }
            }
            let mut cleanup_errors = Vec::new();
            for outcome in outcomes
                .iter()
                .filter(|outcome| outcome.outcome == ImportSubjectOutcomeKind::Failed)
            {
                // Never clean when staging-generation authority itself is absent.
                if outcome
                    .error
                    .as_ref()
                    .is_some_and(|error| error.code != "stagingGeneration")
                    && let Err(error) = super::verification::cleanup_failed_subject_status(
                        &staging_root,
                        &outcome.subject,
                    )
                {
                    cleanup_errors.push(format!("{}: {error:#}", outcome.subject));
                }
            }
            let relocation = if verified.is_empty() {
                None
            } else {
                match relocate(
                    &plan,
                    generation,
                    &staging_root,
                    &verified,
                    exit_code == 0 && verified.len() == subjects.len() && cleanup_errors.is_empty(),
                    preserve_staging,
                ) {
                    Ok(outcome)
                        if outcome.subjects.iter().any(|subject| {
                            subject.status == RelocationSubjectStatus::RecoveryRequired
                        }) =>
                    {
                        bail!("Import relocation requires filesystem recovery")
                    }
                    Ok(outcome) => Some(outcome),
                    Err(error) => {
                        if project_root
                            .join(super::relocation::JOURNAL_FILE)
                            .try_exists()
                            .context("Failed to inspect relocation recovery journal")?
                        {
                            // Mutation may be in flight. Keep Finalizing so activation
                            // relocation recovery settles custody before retry.
                            return Err(error);
                        }
                        cleanup_errors.push(format!("relocation: {error:#}"));
                        None
                    }
                }
            };
            (outcomes, relocation, cleanup_errors)
        };
    if let Some(relocation) = &relocation_outcome {
        for outcome in &mut outcomes {
            if let Some(subject) = relocation
                .subjects
                .iter()
                .find(|entry| entry.subject == outcome.subject)
            {
                if subject.status == RelocationSubjectStatus::Committed {
                    outcome.outcome = ImportSubjectOutcomeKind::Committed;
                    outcome.committed = true;
                } else {
                    outcome.outcome = ImportSubjectOutcomeKind::Failed;
                    outcome.error = Some(ImportStructuredError {
                        code: "relocation".to_string(),
                        message: subject
                            .message
                            .clone()
                            .unwrap_or_else(|| "Relocation did not commit".to_string()),
                        subject: Some(outcome.subject.clone()),
                        staging_issues: None,
                    });
                }
            }
        }
        if preserve_staging
            && !relocation.subjects.is_empty()
            && relocation
                .subjects
                .iter()
                .all(|subject| subject.status == RelocationSubjectStatus::Committed)
            && let Err(error) = super::output::copy_import_configs(&staging_root, &project_root)
        {
            cleanup_errors.push(format!("debug config preservation: {error:#}"));
        }
    }
    let successful = exit_code == 0
        && outcomes.len() == subjects.len()
        && outcomes.iter().all(|outcome| outcome.committed)
        && relocation_outcome
            .as_ref()
            .is_some_and(|outcome| outcome.staging_cleanup_complete || preserve_staging)
        && cleanup_errors.is_empty();
    let mut run = state
        .import_state
        .lock()
        .map_err(|_| anyhow::anyhow!("Import state lock was poisoned"))?;
    if run.ownership_generation != generation
        || run.lifecycle != ImportLifecycle::Finalizing
        || run.project_root != project_root
    {
        bail!("Import finalizer became obsolete before terminal checkpoint");
    }
    // Relocation and its resulting per-subject classifications form their own
    // durable Finalizing checkpoint. Discovery must never expose these
    // mutations solely from memory if the later terminal write fails.
    let prior_outcomes = std::mem::replace(&mut run.subject_outcomes, outcomes);
    let prior_relocation = std::mem::replace(&mut run.relocation_outcome, relocation_outcome);
    if let Err(error) =
        super::journal::write_record(&run.project_root, &super::journal::record_from_state(&run)?)
    {
        run.subject_outcomes = prior_outcomes;
        run.relocation_outcome = prior_relocation;
        return Err(error);
    }
    let terminal = if successful {
        ImportLifecycle::Completed
    } else {
        ImportLifecycle::Failed
    };
    let prior_updated_at = run.updated_at_ms;
    run.transition(terminal).map_err(anyhow::Error::msg)?;
    run.terminal_result = Some(if successful {
        ImportTerminalResult::Completed
    } else {
        ImportTerminalResult::Failed
    });
    if !successful {
        run.error = Some(ImportStructuredError {
            code: "finalization".to_string(),
            message: if !cleanup_errors.is_empty() {
                format!("Import finalization failed: {}", cleanup_errors.join("; "))
            } else if exit_code == 0 {
                "Import completion verification or relocation failed".to_string()
            } else {
                format!("Import process exited with code {exit_code}")
            },
            subject: None,
            staging_issues: None,
        });
    }
    // Terminal result is durable before the best-effort event.
    if let Err(error) =
        super::journal::write_record(&run.project_root, &super::journal::record_from_state(&run)?)
    {
        run.lifecycle = ImportLifecycle::Finalizing;
        run.updated_at_ms = prior_updated_at;
        run.terminal_result = None;
        run.error = None;
        return Err(error);
    }
    Ok(run.snapshot())
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
                import_state.lifecycle = ImportLifecycle::Finalizing;
                import_state.supervisor_handle.take()
            }
            // The supervisor may have observed exit before a stopper takes its
            // handle. The generation guard still makes this handle exclusive.
            ImportLifecycle::Finalizing => import_state.supervisor_handle.take(),
            ImportLifecycle::Cancelling if import_state.child_pid == Some(pid) => {
                // Leave PID ownership intact until the supervisor consumes the
                // real child wait result and durably classifies cancellation.
                // Clearing it here races the supervisor's exact-run guard.
                import_state.supervisor_handle.take()
            }
            _ => None,
        }
    })
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

    if !matches!(
        import_state.lifecycle,
        ImportLifecycle::Running | ImportLifecycle::Cancelling
    ) {
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
    let generation = {
        let mut import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        validate_process_id(pid)?;
        authorize_import_state_pid(&import_state, pid)?;
        let generation = import_state.ownership_generation;

        // Serialize signal admission against process-exit classification, then
        // release state while waiting. This keeps durable Cancelling observable
        // through discovery and avoids holding native ownership for six seconds.
        send_signal(pid)?;
        mark_import_termination_requested(&mut import_state, pid);
        generation
    };

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

    if result.is_err()
        && let Ok(mut import_state) = state.import_state.lock()
    {
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
        handle.join().map_err(|_| {
            "Import supervisor failed while awaiting final process status".to_string()
        })?;
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

/// Run-scoped cancellation.  The PID remains in native state and callers
/// cannot cancel another run by guessing an operating-system identifier.
pub(crate) fn stop_import_run_for_state(
    state: &AppState,
    run_id: &str,
) -> Result<super::types::ImportRunSnapshot, String> {
    stop_import_run_with(state, run_id, stop_import_pid)
}

pub(crate) fn stop_import_run_with(
    state: &AppState,
    run_id: &str,
    stop: impl FnOnce(&AppState, u32) -> Result<(), String>,
) -> Result<super::types::ImportRunSnapshot, String> {
    let (generation, pid) = {
        let mut run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        if run.run_id != run_id {
            return Err("Import run ID is obsolete or unknown".to_string());
        }
        match run.lifecycle {
            ImportLifecycle::Preparing => {
                let prior_updated_at = run.updated_at_ms;
                run.transition(ImportLifecycle::Cancelling)?;
                if let Err(error) = super::journal::write_record(
                    &run.project_root,
                    &super::journal::record_from_state(&run)
                        .map_err(|error| format!("Failed to encode cancellation: {error:#}"))?,
                ) {
                    run.lifecycle = ImportLifecycle::Preparing;
                    run.updated_at_ms = prior_updated_at;
                    return Err(format!("Failed to persist cancellation intent: {error:#}"));
                }
                let cancelling_updated_at = run.updated_at_ms;
                let cancelling_outcomes = run.subject_outcomes.clone();
                run.transition(ImportLifecycle::Cancelled)?;
                run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
                run.terminal_result = Some(super::types::ImportTerminalResult::Cancelled);
                if let Err(error) = super::journal::write_record(
                    &run.project_root,
                    &super::journal::record_from_state(&run)
                        .map_err(|error| format!("Failed to encode cancellation: {error:#}"))?,
                ) {
                    run.lifecycle = ImportLifecycle::Cancelling;
                    run.updated_at_ms = cancelling_updated_at;
                    run.subject_outcomes = cancelling_outcomes;
                    run.terminal_result = None;
                    return Err(format!("Failed to persist cancellation: {error:#}"));
                }
                return Ok(run.snapshot());
            }
            ImportLifecycle::Running => {
                let prior_updated_at = run.updated_at_ms;
                run.transition(ImportLifecycle::Cancelling)?;
                if let Err(error) = super::journal::write_record(
                    &run.project_root,
                    &super::journal::record_from_state(&run)
                        .map_err(|error| format!("Failed to encode cancellation: {error:#}"))?,
                ) {
                    run.lifecycle = ImportLifecycle::Running;
                    run.updated_at_ms = prior_updated_at;
                    return Err(format!("Failed to persist cancellation: {error:#}"));
                }
                (
                    run.ownership_generation,
                    run.child_pid
                        .ok_or_else(|| "Import process has no native PID".to_string())?,
                )
            }
            _ => return Err("Import run is not cancellable".to_string()),
        }
    };
    if let Err(error) = stop(state, pid) {
        let mut run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        if run.run_id == run_id
            && run.ownership_generation == generation
            && run.lifecycle == ImportLifecycle::Cancelling
        {
            let prior_updated_at = run.updated_at_ms;
            let prior_error = run.error.clone();
            run.transition(ImportLifecycle::Running)?;
            run.error = Some(super::types::ImportStructuredError {
                code: "cancellation".to_string(),
                message: error.clone(),
                subject: None,
                staging_issues: None,
            });
            if let Err(persist) = super::journal::write_record(
                &run.project_root,
                &super::journal::record_from_state(&run).map_err(|persist| {
                    format!("Failed to encode cancellation rollback: {persist:#}")
                })?,
            ) {
                run.lifecycle = ImportLifecycle::Cancelling;
                run.updated_at_ms = prior_updated_at;
                run.error = prior_error;
                return Err(format!(
                    "{error}; failed to persist cancellation rollback: {persist:#}"
                ));
            }
        }
        if run.run_id == run_id
            && run.ownership_generation == generation
            && run.lifecycle.is_terminal()
        {
            return Ok(run.snapshot());
        }
        return Err(error);
    }
    let mut run = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    if run.run_id == run_id
        && run.ownership_generation == generation
        && !run.lifecycle.is_terminal()
    {
        let prior_lifecycle = run.lifecycle;
        let prior_updated_at = run.updated_at_ms;
        let prior_outcomes = run.subject_outcomes.clone();
        let prior_pid = run.child_pid;
        let prior_termination = run.termination_requested_for;
        run.lifecycle = ImportLifecycle::Cancelled;
        run.child_pid = None;
        run.termination_requested_for = None;
        run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
        run.terminal_result = Some(super::types::ImportTerminalResult::Cancelled);
        if let Err(error) = super::journal::write_record(
            &run.project_root,
            &super::journal::record_from_state(&run)
                .map_err(|error| format!("Failed to encode cancellation: {error:#}"))?,
        ) {
            run.lifecycle = prior_lifecycle;
            run.updated_at_ms = prior_updated_at;
            run.child_pid = prior_pid;
            run.termination_requested_for = prior_termination;
            run.subject_outcomes = prior_outcomes;
            run.terminal_result = None;
            return Err(format!("Failed to persist cancellation: {error:#}"));
        }
    }
    Ok(run.snapshot())
}

fn cancelled_subject_outcomes(subjects: &[String]) -> Vec<super::types::ImportSubjectOutcome> {
    subjects
        .iter()
        .map(|subject| super::types::ImportSubjectOutcome {
            subject: subject.clone(),
            outcome: super::types::ImportSubjectOutcomeKind::Cancelled,
            ready_lock_verified: false,
            rawdata_verified: false,
            committed: false,
            error: None,
        })
        .collect()
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
pub(crate) fn run_import_pipeline_impl<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    execution_profile: ExecutionProfile,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    run_id: String,
    relocation_plan_id: String,
) -> Result<u32, ImportCommandError> {
    // Keep active-root ownership stable through exact-run admission, staging
    // mutation, and child registration. Project shutdown/activation takes the
    // same gate and cannot clear or replace this run's root mid-launch.
    let _transition = state.project_transition.lock().map_err(|_| {
        ImportCommandError::from("Project transition lock was poisoned".to_string())
    })?;
    validate_import_request_inputs(&staging_entries, &subject_list)?;
    let staging_entries = normalize_staging_subject_spelling(&staging_entries, &subject_list)?;
    if run_id.trim().is_empty() {
        return Err("run_id must not be empty".to_string().into());
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
    let execution_profile_id = execution_profile.id().to_string();

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
    if subjects_to_preserve
        .as_ref()
        .is_some_and(|subjects| !subjects.is_empty())
    {
        return Err(
            "Retry preservation must be authorized when reserving the import run"
                .to_string()
                .into(),
        );
    }
    let reservation = admit_reserved_import_launch(
        state,
        &run_id,
        &staging_root,
        &project_root,
        &subject_list,
        &relocation_plan_id,
        &execution_profile_id,
    )?;
    let generation = reservation.generation;
    if let Err(error) = bind_relocation_plan_for_run(
        state,
        &relocation_plan_id,
        &project_root,
        &stream_subject_list,
        generation,
    ) {
        let snapshot = super::state::fail_admitted_preparation(
            state,
            generation,
            format!("Failed to bind confirmed relocation plan: {error:#}"),
        )
        .map_err(ImportCommandError::from)?;
        return Err(ImportCommandError::Operational {
            message: snapshot
                .error
                .map(|error| error.message)
                .unwrap_or_else(|| "Failed to bind confirmed relocation plan".to_string()),
        });
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

    let staging_generation =
        prepare_generation(&staging_root, &stream_subject_list).map_err(|error| {
            rollback_reserved_operational_failure(state, generation, &staging_root, error)
        })?;
    // Preparation is write-ahead: record the marker and absent-ready baseline
    // before a child can create any completion evidence.
    let generation_checkpoint = {
        let mut import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        if import_state.ownership_generation != generation
            || import_state.lifecycle != ImportLifecycle::Preparing
        {
            return Err("Import reservation became obsolete during preparation"
                .to_string()
                .into());
        }
        import_state.staging_generation = staging_generation;
        super::journal::write_record(
            &import_state.project_root,
            &super::journal::record_from_state(&import_state)?,
        )
    };
    if let Err(error) = generation_checkpoint {
        return Err(rollback_reserved_operational_failure(
            state,
            generation,
            &staging_root,
            error,
        ));
    }

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
        let error = cleanup_after_prepare_event_failure(state, generation, &staging_root, err);
        return Err(error.into());
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
        let error = cleanup_after_prepare_event_failure(state, generation, &staging_root, err);
        return Err(error.into());
    }

    match emit_running_snapshot(&app, state, generation, child_pid) {
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
                "Import state changed before the Running snapshot could be emitted".to_string(),
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
