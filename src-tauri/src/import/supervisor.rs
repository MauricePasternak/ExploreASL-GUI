//! Import-specific output draining, parser diagnostics, live scope ownership and cancellation.
//!
//! `process::ProcessScope` supplies shared OS supervision. This module correlates
//! its output and settlement with import ownership; finalization owns success.

use super::finalization::{cancelled_subject_outcomes, settle_import_scope_exit};
use super::output::owned_subject_spelling;
use super::parser::{
    ImportOutputLine, ImportOutputLineSource, ImportOutputParser, ImportStructuredEvent,
    progress_bar_re,
};
use super::runs::{persist, reservation_durability_is_uncertain};
use super::types::{
    ImportLifecycle, ImportRawEventPayload, ImportRunSnapshot, ImportState, ImportStructuredError,
    ImportStructuredEventPayload, ImportTerminalResult,
};
use crate::app::state::AppState;
use crate::error::MutexExt;
use crate::execution::output::OutputDrains;
use crate::process::ProcessScope;
use crate::project::ownership;
use crate::tracing::EmissionWarnings;
use anyhow::{Result as AnyResult, bail};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub(super) fn accepts_import_diagnostic(import_state: &ImportState, generation: u64) -> bool {
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

fn emit_structured_events<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    events: Vec<ImportStructuredEvent>,
    warnings: &mut EmissionWarnings,
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
            warnings.check(
                "import-structured-event",
                app.emit(
                    "import-structured-event",
                    ImportStructuredEventPayload {
                        event,
                        run_id: import_state.run_id.clone(),
                        ownership_generation: generation,
                    },
                ),
            );
            true
        });
        if emitted {
            continue;
        }
    }
    saw_import_complete
}

fn stream_import_output<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    output_line: ImportOutputLine,
    parser: &mut ImportOutputParser,
    warnings: &mut EmissionWarnings,
) -> bool {
    let is_progress = progress_bar_re().is_match(&output_line.line);
    if !is_progress {
        let trimmed = output_line.line.trim().to_string();
        if !parser.is_duplicate(&trimmed) {
            parser.record_line(trimmed);
            let state = app.state::<AppState>();
            if let Ok(import_state) = state.import_state.lock()
                && import_state.ownership_generation == generation
            {
                // Hold ownership through the event so stale raw output cannot
                // be delivered after a replacement reservation.
                warnings.check(
                    "import-raw-event",
                    app.emit(
                        "import-raw-event",
                        ImportRawEventPayload {
                            line: output_line.line.clone(),
                            run_id: import_state.run_id.clone(),
                            ownership_generation: generation,
                        },
                    ),
                );
            }
        }
    }

    emit_structured_events(
        app,
        generation,
        parser.push_line(&output_line.line, output_line.source),
        warnings,
    )
}

/// Both readers feed the same parser synchronously. No unbounded output queue,
/// and draining continues while the scope owner waits through cancellation.
pub(super) struct ImportOutput {
    drains: Option<OutputDrains>,
    parser: Arc<Mutex<(ImportOutputParser, EmissionWarnings)>>,
}

impl ImportOutput {
    pub(super) fn new<R: Runtime>(
        app: AppHandle<R>,
        generation: u64,
        run_id: &str,
        subjects: &[String],
    ) -> Self {
        let context = format!("[IMPORT] run={run_id} generation={generation}");
        let parser = Arc::new(Mutex::new((
            ImportOutputParser::new(subjects),
            EmissionWarnings::new(context.clone()),
        )));
        let callback_parser = parser.clone();
        let drains = OutputDrains::new(context, move |source, line| {
            let mut diagnostics = callback_parser
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let (parser, warnings) = &mut *diagnostics;
            stream_import_output(
                &app,
                generation,
                ImportOutputLine {
                    line,
                    source: if source == "stdout" {
                        ImportOutputLineSource::Stdout
                    } else {
                        ImportOutputLineSource::Stderr
                    },
                },
                parser,
                warnings,
            );
        });
        Self {
            drains: Some(drains),
            parser,
        }
    }

    pub(super) fn configure(&self, command: &mut std::process::Command) {
        self.drains.as_ref().unwrap().configure(command);
    }

    fn finish<R: Runtime>(&mut self, app: &AppHandle<R>, generation: u64) {
        drop(self.drains.take());
        let mut diagnostics = self
            .parser
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (parser, warnings) = &mut *diagnostics;
        for event in parser.finish() {
            if !matches!(event, ImportStructuredEvent::ImportComplete) {
                emit_structured_events(app, generation, vec![event], warnings);
            }
        }
    }
}

pub(super) fn supervise_import_process<R: Runtime>(
    app: AppHandle<R>,
    generation: u64,
    mut scope: ProcessScope,
    mut output: ImportOutput,
    start_receiver: mpsc::Receiver<()>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        if start_receiver.recv().is_err() {
            scope.cancellation().cancel();
        }
        output.drains.as_ref().unwrap().attach(&mut scope);
        let result = (|| -> AnyResult<()> {
            let exit = loop {
                match scope.wait_for(Duration::from_millis(20)) {
                    Ok(Some(outcome)) => break outcome.exit_status,
                    Ok(None) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                        break scope.wait()?.exit_status;
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            output.finish(&app, generation);
            settle_import_scope_exit(&app, generation, exit.code().unwrap_or(-1))?;
            Ok(())
        })();
        if let Err(error) = result {
            retain_import_scope_after_supervision_error(
                &app,
                generation,
                scope,
                &mut output,
                error,
            );
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
    output: &mut ImportOutput,
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
        if output.drains.is_some() {
            output.finish(app, generation);
        }
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

pub(super) fn record_import_supervision_error<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    error: impl std::fmt::Display,
) {
    log::error!("[IMPORT] generation={generation} supervision/settlement failed: {error:#}");
    let state = app.state::<AppState>();
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
        && !run.lifecycle.is_terminal()
    {
        let prior = run.error.clone();
        run.error = Some(ImportStructuredError {
            code: "process".into(),
            message: format!("Import supervision failed: {error:#}"),
            subject: None,
            staging_issues: None,
        });
        if let Err(storage) = persist(&run) {
            log::error!(
                "[IMPORT] run={} generation={generation} failed to persist supervision error: {storage:#}",
                run.run_id
            );
            run.error = prior;
        }
    }
}

pub(crate) fn stop_import_run_for_state(
    state: &AppState,
    run_id: &str,
) -> Result<ImportRunSnapshot, String> {
    log::info!("[IMPORT] run={run_id} stop requested");
    let ownership = ownership::active(state)?;
    let (generation, cancellation, launching) = {
        let mut run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned")?;
        if run.run_id != run_id || run.project_root != ownership.root() {
            return Err("Import run ID is obsolete, unknown, or belongs to another project".into());
        }
        if reservation_durability_is_uncertain(&run) {
            return Err(
                "Import reservation durability uncertain; ownership retained; cancellation cannot rewrite it"
                    .into(),
            );
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
        persist(&run).map_err(|e| format!("Failed to persist cancellation intent: {e:#}"))?;
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
        + crate::process::GRACE_PERIOD
        + crate::process::FORCE_SETTLEMENT_PERIOD
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

pub(super) fn finish_cancelled_preparation(
    state: &AppState,
    generation: u64,
) -> AnyResult<ImportRunSnapshot> {
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
    run.terminal_result = Some(ImportTerminalResult::Cancelled);
    if let Err(e) = persist(&run) {
        run.lifecycle = prior.lifecycle;
        run.updated_at_ms = prior.updated_at_ms;
        run.subject_outcomes = prior.subject_outcomes;
        run.terminal_result = prior.terminal_result;
        return Err(e);
    }
    run.cancellation = None;
    Ok(run.snapshot())
}

pub(crate) fn stop_running_import_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let id = {
        let run = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned")?;
        if !should_stop_import_for_exit(&run) {
            return Ok(false);
        }
        run.run_id.clone()
    };
    stop_import_run_for_state(&state, &id)?;
    Ok(true)
}

pub(super) fn should_stop_import_for_exit(run: &ImportState) -> bool {
    run.lifecycle != ImportLifecycle::Idle
        && !run.lifecycle.is_terminal()
        && !reservation_durability_is_uncertain(run)
}

pub(super) fn handoff_running_checkpoint_failure<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    generation: u64,
    scope: ProcessScope,
    output: ImportOutput,
    checkpoint_error: String,
) -> AnyResult<()> {
    log::error!(
        "[IMPORT] generation={generation} Running checkpoint failed; cancelling owned scope: {checkpoint_error}"
    );
    scope.cancellation().cancel();
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor =
        supervise_import_process(app.clone(), generation, scope, output, start_receiver);
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
    run.error = Some(ImportStructuredError {
        code: "process".into(),
        message: format!("Failed to durably record Running import: {checkpoint_error}"),
        subject: None,
        staging_issues: None,
    });
    // The failed Running write has already rolled itself back. Best-effort
    // persistence of cancellation intent may also fail; in-memory ownership
    // and the live supervisor still prevent replacement in this process.
    if let Err(error) = persist(&run) {
        log::error!(
            "[IMPORT] run={} generation={generation} cancellation checkpoint failed: {error:#}",
            run.run_id
        );
    }
    run.supervisor_handle = Some(supervisor);
    drop(run);
    start_sender
        .send(())
        .map_err(|_| anyhow::anyhow!("Import supervisor stopped before cancelled handoff"))
}
