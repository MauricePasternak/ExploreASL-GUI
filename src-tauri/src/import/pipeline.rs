use super::output::{cleanup_staging_root, owned_subject_spelling};
use super::parser::{ImportOutputLine, ImportOutputParser, ImportStructuredEvent, progress_bar_re};
use super::staging::{StagingEntry, compile_staging_plan, execute_compiled_staging_plan};
use super::state::{
    admit_reserved_import_launch, bind_relocation_plan_for_run, emit_running_snapshot,
    set_import_supervisor_handle, set_reserved_import_running, validate_relocation_plan_for_run,
};
use super::status::copy_lock_files_paths;
use super::types::{
    ImportCommandError, ImportLifecycle, ImportRawEventPayload, ImportState,
    ImportStructuredEventPayload,
};
use super::validation::{normalize_staging_subject_spelling, validate_import_request_inputs};
use super::verification::prepare_generation;
use crate::app_state::AppState;
use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH};
use crate::error::MutexExt;
use crate::execution_profile::ExecutionProfile;
use anyhow::{Context, Result as AnyResult, bail};
use easl_execution_runtime::process::{CancellationToken, ProcessScope};
use serde_json::Value;
use std::fs;
use std::path::Path;

use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
    mut scope: easl_execution_runtime::process::ProcessScope,
    subject_list: Vec<String>,
    start_receiver: mpsc::Receiver<()>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        if start_receiver.recv().is_err() {
            scope.cancellation().cancel();
        }
        let result = (|| -> AnyResult<()> {
            let stdout = scope.take_stdout()?;
            let stderr = scope.take_stderr()?;
            let (lines, receiver) = mpsc::channel();
            for (stream, source) in [
                (
                    Box::new(stdout) as Box<dyn std::io::Read + Send>,
                    super::parser::ImportOutputLineSource::Stdout,
                ),
                (
                    Box::new(stderr) as Box<dyn std::io::Read + Send>,
                    super::parser::ImportOutputLineSource::Stderr,
                ),
            ] {
                let sender = lines.clone();
                thread::spawn(move || {
                    let mut reader = std::io::BufReader::new(stream);
                    let mut retained = Vec::with_capacity(64 * 1024);
                    let mut buffer = [0_u8; 8192];
                    loop {
                        let count = match std::io::Read::read(&mut reader, &mut buffer) {
                            Ok(0) => break,
                            Ok(count) => count,
                            Err(_) => return,
                        };
                        for byte in &buffer[..count] {
                            if *byte == b'\n' {
                                if retained.last() == Some(&b'\r') {
                                    retained.pop();
                                }
                                let line = bounded_lossy_line(&retained);
                                let _ = sender.send(ImportOutputLine { line, source });
                                retained.clear();
                            } else if retained.len() < 64 * 1024 {
                                retained.push(*byte);
                            }
                        }
                    }
                    if !retained.is_empty() {
                        let line = bounded_lossy_line(&retained);
                        let _ = sender.send(ImportOutputLine { line, source });
                    }
                });
            }
            drop(lines);
            let mut parser = ImportOutputParser::new(&subject_list);
            let exit = loop {
                while let Ok(line) = receiver.try_recv() {
                    stream_import_output(&app, generation, line, &mut parser);
                }
                match scope.wait_for(Duration::from_millis(20)) {
                    Ok(Some(outcome)) => break outcome.exit_status,
                    Ok(None) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                        break scope.wait()?.exit_status;
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            for line in receiver {
                stream_import_output(&app, generation, line, &mut parser);
            }
            for event in parser.finish() {
                if !matches!(event, ImportStructuredEvent::ImportComplete) {
                    emit_structured_events(&app, generation, vec![event]);
                }
            }
            settle_import_scope_exit(&app, generation, exit.code().unwrap_or(-1))?;
            Ok(())
        })();
        if let Err(error) = result {
            retain_import_scope_after_supervision_error(&app, generation, scope, error);
        }
    })
}

/// A process-scope error is not proof that the worker stopped. Keep the scope
/// in this supervisor thread until direct-child reaping and scope settlement
/// succeed, then retry the durable exit/finalization checkpoint as needed.
fn retain_import_scope_after_supervision_error<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    mut scope: ProcessScope,
    initial_error: anyhow::Error,
) {
    record_import_supervision_error(app, generation, initial_error);
    loop {
        let exit = match scope.wait_for(Duration::from_millis(100)) {
            Ok(Some(outcome)) => outcome.exit_status,
            Ok(None) => continue,
            // `wait_for` returns Interrupted only after `cancel` has settled
            // the supported scope. Re-read its reaped direct-child status.
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => match scope.wait() {
                Ok(outcome) => outcome.exit_status,
                Err(error) => {
                    record_import_supervision_error(app, generation, error);
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
            },
            Err(error) => {
                // Includes graceful/force/settlement failure. The scope remains
                // owned by this live thread; a later Stop or shutdown observes
                // the retained join handle and cannot publish a false terminal.
                record_import_supervision_error(app, generation, error);
                thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        match settle_import_scope_exit(app, generation, exit.code().unwrap_or(-1)) {
            Ok(()) => return,
            Err(error) => {
                // The worker is known settled, but write-ahead terminal state
                // is not. Retain this owner until a durable checkpoint succeeds
                // instead of leaving a finished handle for Stop to reinterpret.
                record_import_supervision_error(app, generation, error);
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn record_import_supervision_error<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    error: impl std::fmt::Display,
) {
    let state = app.state::<AppState>();
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && !run.lifecycle.is_terminal()
    {
        let prior = run.error.clone();
        run.error = Some(super::types::ImportStructuredError {
            code: "process".into(),
            message: format!("Import supervision failed: {error}"),
            subject: None,
            staging_issues: None,
        });
        if super::state::persist(&run).is_err() {
            run.error = prior;
        }
    }
}

fn settle_import_scope_exit<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    exit_code: i32,
) -> AnyResult<()> {
    let state = app.state::<AppState>();
    let snapshot = {
        let run = state.import_state.lock_or_bail("Import state")?;
        match run.lifecycle {
            ImportLifecycle::Running | ImportLifecycle::Cancelling => {
                drop(run);
                record_import_process_exit(&state, generation, exit_code)?
            }
            ImportLifecycle::Finalizing => run.snapshot(),
            lifecycle if lifecycle.is_terminal() => run.snapshot(),
            _ => bail!("Import scope settled before native running ownership was established"),
        }
    };
    let terminal = if snapshot.lifecycle == ImportLifecycle::Finalizing {
        app.emit("import-run-snapshot", snapshot).ok();
        complete_finalizing_import(&state, generation, exit_code)?
    } else {
        snapshot
    };
    if !terminal.lifecycle.is_terminal() {
        bail!("Import scope settled without a terminal native lifecycle");
    }
    release_terminal_supervisor_handle(&state, generation);
    app.emit("import-run-snapshot", terminal).ok();
    Ok(())
}

fn bounded_lossy_line(bytes: &[u8]) -> String {
    let mut line = String::from_utf8_lossy(bytes).into_owned();
    while line.len() > 64 * 1024 {
        line.pop();
    }
    line
}

fn release_terminal_supervisor_handle(state: &AppState, generation: u64) {
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && run.lifecycle.is_terminal()
    {
        run.cancellation = None;
        run.supervisor_handle.take();
    }
}

pub(crate) fn record_import_process_exit(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<super::types::ImportRunSnapshot> {
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || !matches!(
            run.lifecycle,
            ImportLifecycle::Running | ImportLifecycle::Cancelling
        )
    {
        bail!("Import supervisor is obsolete");
    }
    let prior = run.snapshot();
    run.exit_evidence = Some(super::types::ImportExitEvidence {
        exit_code,
        successful: exit_code == 0,
    });
    if run.lifecycle == ImportLifecycle::Cancelling {
        run.transition(ImportLifecycle::Cancelled)
            .map_err(anyhow::Error::msg)?;
        run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
        run.terminal_result = Some(super::types::ImportTerminalResult::Cancelled);
    } else {
        run.transition(ImportLifecycle::Finalizing)
            .map_err(anyhow::Error::msg)?;
    }
    if let Err(error) = super::state::persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.exit_evidence = prior.exit_evidence;
        run.subject_outcomes = prior.subject_outcomes;
        run.terminal_result = prior.terminal_result;
        return Err(error);
    }
    run.cancellation = None;
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
    complete_finalizing_import_after_processing_recovery(state, generation, exit_code)
}

pub(crate) fn complete_finalizing_import(
    state: &AppState,
    generation: u64,
    exit_code: i32,
) -> AnyResult<super::types::ImportRunSnapshot> {
    let root = state
        .import_state
        .lock_or_bail("Import state")?
        .project_root
        .clone();
    super::state::recover_processing_before_import(&root)?;
    complete_finalizing_import_after_processing_recovery(state, generation, exit_code)
}

fn complete_finalizing_import_after_processing_recovery(
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
    let successful = true
        && exit_code == 0
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
    let prior_error = run.error.clone();
    if !successful && true {
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
        run.error = prior_error;
        return Err(error);
    }
    Ok(run.snapshot())
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

pub(crate) fn stop_import_run_for_state(
    state: &AppState,
    run_id: &str,
) -> Result<super::types::ImportRunSnapshot, String> {
    let ownership = crate::project_ownership::active(state)?;
    let (generation, cancellation, launching) = {
        let mut run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned")?;
        if run.run_id != run_id || run.project_root != ownership.root() {
            return Err("Import run ID is obsolete, unknown, or belongs to another project".into());
        }
        if run.lifecycle.is_terminal() {
            return Ok(run.snapshot());
        }
        if !matches!(
            run.lifecycle,
            ImportLifecycle::Preparing | ImportLifecycle::Running | ImportLifecycle::Cancelling
        ) {
            return Err("Import run is not cancellable".into());
        }
        if run.lifecycle != ImportLifecycle::Cancelling {
            run.transition(ImportLifecycle::Cancelling)?;
        }
        super::state::persist(&run)
            .map_err(|e| format!("Failed to persist cancellation intent: {e:#}"))?;
        (
            run.ownership_generation,
            run.cancellation.clone(),
            run.launch_in_progress,
        )
    };
    let has_scope = cancellation.is_some();
    if let Some(token) = cancellation {
        token.cancel();
    }
    if !has_scope && !launching {
        return Err("Import has no in-process supervisor ownership; restart recovery requires external-stop confirmation".into());
    }
    let deadline = std::time::Instant::now()
        + easl_execution_runtime::process::GRACE_PERIOD
        + easl_execution_runtime::process::FORCE_SETTLEMENT_PERIOD
        + Duration::from_secs(1);
    loop {
        let mut run = state
            .import_state
            .lock_or_bail("Import state")
            .map_err(|e| e.to_string())?;
        if run.run_id != run_id || run.ownership_generation != generation {
            return Err("Import cancellation became obsolete".into());
        }
        if run.lifecycle.is_terminal() {
            return Ok(run.snapshot());
        }
        if run
            .supervisor_handle
            .as_ref()
            .is_some_and(|handle| handle.is_finished())
            && let Some(handle) = run.supervisor_handle.take()
        {
            drop(run);
            handle.join().map_err(|_| "Import supervisor failed")?;
            continue;
        }
        if run.supervisor_handle.is_none() && !run.launch_in_progress {
            drop(run);
            return finish_cancelled_preparation(state, generation).map_err(|e| format!("{e:#}"));
        }
        drop(run);
        if std::time::Instant::now() >= deadline {
            return Err("Import cancellation did not settle; ownership retained".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn finish_cancelled_preparation(
    state: &AppState,
    generation: u64,
) -> AnyResult<super::types::ImportRunSnapshot> {
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || run.launch_in_progress
        || run.lifecycle != ImportLifecycle::Cancelling
    {
        bail!("Import cancellation still has an effect owner");
    }
    let prior = run.snapshot();
    run.transition(ImportLifecycle::Cancelled)
        .map_err(anyhow::Error::msg)?;
    run.subject_outcomes = cancelled_subject_outcomes(&run.subject_list);
    run.terminal_result = Some(super::types::ImportTerminalResult::Cancelled);
    if let Err(e) = super::state::persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.subject_outcomes = prior.subject_outcomes;
        run.terminal_result = prior.terminal_result;
        return Err(e);
    }
    run.cancellation = None;
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
    let id = {
        let run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned")?;
        if run.lifecycle == ImportLifecycle::Idle || run.lifecycle.is_terminal() {
            return Ok(false);
        }
        run.run_id.clone()
    };
    stop_import_run_for_state(&state, &id)?;
    Ok(true)
}

fn require_preparing(state: &AppState, generation: u64) -> AnyResult<()> {
    let run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || run.lifecycle != ImportLifecycle::Preparing
        || !run.launch_in_progress
    {
        bail!("Import preparation cancelled or obsolete");
    }
    Ok(())
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
) -> Result<(), ImportCommandError> {
    let (reservation, compiled_plan, ownership) = {
        let _transition = state
            .project_transition
            .lock_or_bail("Project transition")?;
        crate::project_ownership::ensure_not_shutting_down(state).map_err(anyhow::Error::msg)?;
        validate_import_request_inputs(&staging_entries, &subject_list)?;
        let entries = normalize_staging_subject_spelling(&staging_entries, &subject_list)?;
        if run_id.trim().is_empty() || relocation_plan_id.trim().is_empty() {
            return Err("run_id and relocation_plan_id must not be empty"
                .to_string()
                .into());
        }
        if !sourcestructure_json.is_object() || !studypar_json.is_object() {
            return Err("Import configs must be JSON objects".to_string().into());
        }
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
        let ownership =
            crate::project_ownership::active(state).map_err(ImportCommandError::from)?;
        let plan = compile_staging_plan(Some(ownership.root().to_path_buf()), &entries)
            .map_err(|r| ImportCommandError::Preflight { issues: r.issues })?;
        validate_relocation_plan_for_run(
            state,
            &relocation_plan_id,
            ownership.root(),
            &subject_list,
        )?;
        let reservation = admit_reserved_import_launch(
            state,
            &run_id,
            &plan.staging_root,
            ownership.root(),
            &subject_list,
            &relocation_plan_id,
            execution_profile.id(),
        )?;
        (reservation, plan, ownership)
    };
    let generation = reservation.generation;
    let token = CancellationToken::default();
    {
        let mut run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Preparing {
            return Err("Import reservation became obsolete".to_string().into());
        }
        run.cancellation = Some(token.clone());
    }
    let preparation = (|| -> AnyResult<Option<ProcessScope>> {
        require_preparing(state, generation)?;
        let mut command = import_command(&execution_profile, token.clone())?;
        bind_relocation_plan_for_run(
            state,
            &relocation_plan_id,
            ownership.root(),
            &subject_list,
            generation,
        )?;
        cleanup_staging_root(&compiled_plan.staging_root)?;
        execute_compiled_staging_plan(&compiled_plan)?;
        fs::create_dir_all(&compiled_plan.staging_root)?;
        write_config_json(
            &compiled_plan.staging_root.join("sourcestructure.json"),
            &sourcestructure_json,
        )?;
        write_config_json(
            &compiled_plan.staging_root.join("studyPar.json"),
            &studypar_json,
        )?;
        let staging_generation = prepare_generation(&compiled_plan.staging_root, &subject_list)?;
        {
            let mut run = state.import_state.lock_or_bail("Import state")?;
            run.staging_generation = staging_generation;
            super::state::persist(&run)?;
        }
        if !reservation.preserved_subjects.is_empty() {
            copy_lock_files_paths(
                ownership.root(),
                &compiled_plan.staging_root,
                &reservation.preserved_subjects,
            )?;
        }
        if let ExecutionProfile::Apptainer {
            sif_path,
            apptainer_path,
            ..
        } = &execution_profile
        {
            warm_import_mcr_cache(
                apptainer_path,
                Path::new(sif_path.trim()),
                &compiled_plan.staging_root,
                token.clone(),
            )?;
        }
        match &execution_profile {
            ExecutionProfile::Matlab {
                explore_asl_path, ..
            } => {
                command.arg("-batch").arg(format!(
                    "addpath('{}'); ExploreASL('{}', [1,1,0], 0, 0)",
                    escape_matlab_string(explore_asl_path.trim()),
                    escape_matlab_string(&compiled_plan.staging_root.to_string_lossy())
                ));
            }
            ExecutionProfile::Apptainer { sif_path, .. } => {
                command.args(build_apptainer_import_args(
                    &compiled_plan.staging_root,
                    Path::new(sif_path.trim()),
                ));
            }
        };
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if token.is_cancelled() {
            bail!("Import preparation cancelled");
        }
        let scope = ProcessScope::spawn_with_cancellation(command, token.clone())?;
        let cancelling = {
            let run = state.import_state.lock_or_bail("Import state")?;
            run.lifecycle == ImportLifecycle::Cancelling
        };
        if cancelling {
            token.cancel();
        } else {
            if let Err(error) = set_reserved_import_running(state, generation) {
                // Running is the durable execution-commit boundary. If its
                // write fails after spawn, retain the scope under a live
                // Cancelling supervisor. A failed force/settlement attempt
                // must never turn this into an untracked Failed launch.
                handoff_running_checkpoint_failure(
                    app.clone(),
                    state,
                    generation,
                    scope,
                    subject_list.clone(),
                    error,
                )?;
                return Ok(None);
            }
        }
        Ok(Some(scope))
    })();
    let scope = match preparation {
        Ok(Some(scope)) => scope,
        Ok(None) => return Ok(()),
        Err(error) => {
            let mut run = state.import_state.lock_or_bail("Import state")?;
            run.launch_in_progress = false;
            let cancelling = run.lifecycle == ImportLifecycle::Cancelling;
            run.cancellation = None;
            drop(run);
            if cancelling {
                return finish_cancelled_preparation(state, generation)
                    .map(|_| ())
                    .map_err(ImportCommandError::from);
            }
            super::state::fail_admitted_preparation(state, generation, format!("{error:#}"))?;
            return Err(error.into());
        }
    };
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor =
        supervise_import_process(app.clone(), generation, scope, subject_list, start_receiver);
    if let Err((error, handle)) = set_import_supervisor_handle(state, generation, supervisor) {
        drop(start_sender);
        let _ = handle.join();
        return Err(error.into());
    }
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
    {
        run.launch_in_progress = false;
    }
    let _ = emit_running_snapshot(&app, state, generation);
    start_sender.send(()).map_err(|_| {
        ImportCommandError::from("Import supervisor stopped before observation".to_string())
    })?;
    Ok(())
}

fn handoff_running_checkpoint_failure<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    generation: u64,
    scope: ProcessScope,
    subject_list: Vec<String>,
    checkpoint_error: String,
) -> AnyResult<()> {
    scope.cancellation().cancel();
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor =
        supervise_import_process(app.clone(), generation, scope, subject_list, start_receiver);
    let mut run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || !matches!(
            run.lifecycle,
            ImportLifecycle::Preparing | ImportLifecycle::Cancelling
        )
    {
        drop(run);
        drop(start_sender);
        // The supervisor owns the scope and observes its cancelled token even
        // without a start message. Do not drop a possibly live process scope.
        return Err(anyhow::anyhow!(
            "Import ownership changed while retaining failed Running checkpoint: {checkpoint_error}"
        ));
    }
    if run.lifecycle == ImportLifecycle::Preparing {
        run.transition(ImportLifecycle::Cancelling)
            .map_err(anyhow::Error::msg)?;
    }
    run.launch_in_progress = false;
    run.error = Some(super::types::ImportStructuredError {
        code: "process".into(),
        message: format!("Failed to durably record Running import: {checkpoint_error}"),
        subject: None,
        staging_issues: None,
    });
    // The failed Running write has already rolled itself back. Best-effort
    // persistence of cancellation intent may also fail; in-memory ownership
    // and the live supervisor still prevent replacement in this process.
    let _ = super::state::persist(&run);
    run.supervisor_handle = Some(supervisor);
    drop(run);
    start_sender
        .send(())
        .map_err(|_| anyhow::anyhow!("Import supervisor stopped before cancelled handoff"))
}

fn import_command(
    profile: &ExecutionProfile,
    cancellation: CancellationToken,
) -> AnyResult<std::process::Command> {
    match profile {
        ExecutionProfile::Matlab {
            matlab_path,
            explore_asl_path,
            ..
        } => {
            let matlab = crate::execution_managed::validate_matlab_executable(matlab_path)?;
            crate::execution_profile::validate_exploreasl_path(explore_asl_path)?;
            Ok(crate::apptainer::create_system_command(matlab))
        }
        ExecutionProfile::Apptainer {
            apptainer_path,
            sif_path,
            ..
        } => {
            let executable = crate::apptainer::resolve_apptainer_executable(apptainer_path)?;
            if !Path::new(sif_path.trim()).is_file() {
                bail!("SIF image is not a file: {sif_path}");
            }
            let mut version = crate::apptainer::create_system_command(&executable);
            version.current_dir(std::env::temp_dir()).arg("--version");
            let output = easl_execution_runtime::process::run_probe(
                version,
                256 * 1024,
                Duration::from_secs(5),
                cancellation.clone(),
            )?;
            if !output.status.success() {
                bail!("Apptainer version probe failed");
            }
            let mut sif_version = crate::apptainer::create_system_command(&executable);
            sif_version.current_dir(std::env::temp_dir()).args([
                "exec",
                "--cleanenv",
                sif_path.trim(),
                "ls",
                "/opt/xasl/xASL_latest/",
            ]);
            let output = easl_execution_runtime::process::run_probe(
                sif_version,
                256 * 1024,
                Duration::from_secs(5),
                cancellation,
            )?;
            if !output.status.success()
                || !String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    line.trim()
                        .strip_prefix("VERSION_")
                        .is_some_and(|v| !v.is_empty())
                })
            {
                bail!("Could not find VERSION_* file in container");
            }
            Ok(crate::apptainer::create_system_command(executable))
        }
    }
}

fn warm_import_mcr_cache(
    apptainer_path: &str,
    sif: &Path,
    staging: &Path,
    cancellation: CancellationToken,
) -> AnyResult<()> {
    let cache = crate::apptainer::mcr_cache_path();
    if cache.exists() {
        return Ok(());
    }
    fs::create_dir_all(&cache).context("Failed to create MCR cache")?;
    let executable = crate::apptainer::resolve_apptainer_executable(apptainer_path)?;
    let mut command = crate::apptainer::create_system_command(executable);
    command.args([
        "exec",
        "--cleanenv",
        "--writable-tmpfs",
        "--bind",
        &format!("{}:{CONTAINER_DATA_ROOT}", staging.display()),
        "--bind",
        &format!("{}:{}", cache.display(), cache.display()),
        "--env",
        &format!("MCR_CACHE_ROOT={}", cache.display()),
        &sif.to_string_lossy(),
        "/bin/bash",
        EXPLOREASL_SCRIPT,
        MCR_PATH,
    ]);
    let output = easl_execution_runtime::process::run_probe(
        command,
        256 * 1024,
        Duration::from_secs(300),
        cancellation,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        bail!("Apptainer MCR warmup failed")
    }
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
