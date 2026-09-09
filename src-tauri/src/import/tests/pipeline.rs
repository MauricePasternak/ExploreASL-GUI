use crate::app_state::AppState;
#[cfg(unix)]
use crate::execution_profile::ExecutionProfile;
use crate::import::parser::{ImportOutputLineSource, ImportStructuredEvent};
use crate::import::pipeline::{
    accepts_import_diagnostic, canonicalize_import_event_subject, complete_finalizing_import,
    confirm_import_termination_with, read_pipe_lines, record_import_process_exit,
    run_import_pipeline_impl, stop_import_run_with,
};
use crate::import::state::{
    RESERVED_IMPORT_PID, reserve_import_run_for_state, set_reserved_import_pid,
};
use crate::import::types::{
    ImportCommandError, ImportLifecycle, ImportRunSnapshot, ImportState, ImportTerminalResult,
};
use crate::import::{StagingEntry, journal};
use anyhow::Result as AnyResult;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use tauri::Manager;

fn finalize_import_process(
    state: &AppState,
    generation: u64,
    child_pid: u32,
    exit_code: i32,
) -> AnyResult<ImportRunSnapshot> {
    let snapshot = record_import_process_exit(state, generation, child_pid, exit_code)?;
    if snapshot.lifecycle == ImportLifecycle::Finalizing {
        complete_finalizing_import(state, generation, exit_code)
    } else {
        Ok(snapshot)
    }
}

fn running_state(root: &Path) -> AppState {
    running_state_for_subjects(root, &["ONE"])
}

fn running_state_for_subjects(root: &Path, subjects: &[&str]) -> AppState {
    let state = AppState::default();
    *state.active_project_root.lock().unwrap() = Some(root.canonicalize().unwrap());
    let subjects = subjects
        .iter()
        .map(|subject| (*subject).to_string())
        .collect::<Vec<_>>();
    let mut run = ImportState::new(
        root.join(".easl_staging"),
        root.to_path_buf(),
        subjects.clone(),
    );
    run.run_id = "import-run-1".to_string();
    run.profile_id = "profile-1".to_string();
    run.ownership_generation = 4;
    run.staging_generation = "generation-1".to_string();
    let mut plan =
        crate::import::relocation::create_plan(root, &subjects, "plan-1".to_string()).unwrap();
    crate::import::relocation::bind_plan(&mut plan, root, &subjects, 4).unwrap();
    run.relocation_plan_id = Some("plan-1".to_string());
    run.relocation_plan = Some(plan);
    run.lifecycle = ImportLifecycle::Running;
    run.child_pid = Some(42);
    journal::write_record(root, &journal::record_from_state(&run).unwrap()).unwrap();
    *state.import_state.lock().unwrap() = run;
    state
}

#[test]
fn cancellation_failure_restores_running_authority_and_durable_error() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    let error = stop_import_run_with(&state, "import-run-1", |_, pid| {
        assert_eq!(pid, 42);
        Err("signal denied".to_string())
    })
    .unwrap_err();
    assert_eq!(error, "signal denied");
    let run = state.import_state.lock().unwrap();
    assert_eq!(run.lifecycle, ImportLifecycle::Running);
    assert_eq!(run.error.as_ref().unwrap().code, "cancellation");
    drop(run);
    let record = journal::load_record(temp.path()).unwrap().unwrap();
    assert_eq!(record.snapshot.lifecycle, ImportLifecycle::Running);
    assert_eq!(record.snapshot.error.unwrap().code, "cancellation");
}

#[test]
fn cancelling_is_durable_and_observable_before_process_operations_finish() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());

    let snapshot = stop_import_run_with(&state, "import-run-1", |state, pid| {
        assert_eq!(pid, 42);
        assert_eq!(
            state.import_state.lock().unwrap().lifecycle,
            ImportLifecycle::Cancelling
        );
        assert_eq!(
            journal::load_record(temp.path())
                .unwrap()
                .unwrap()
                .snapshot
                .lifecycle,
            ImportLifecycle::Cancelling
        );
        assert_eq!(
            crate::import::state::get_active_import_run_for_state(state)
                .unwrap()
                .unwrap()
                .lifecycle,
            ImportLifecycle::Cancelling
        );
        Ok(())
    })
    .unwrap();

    assert_eq!(snapshot.lifecycle, ImportLifecycle::Cancelled);
}

#[test]
fn injectable_process_ops_cover_graceful_timeout_force_and_final_wait_failures() {
    use std::cell::{Cell, RefCell};

    fn cancelling_state(root: &Path) -> AppState {
        let state = running_state(root);
        {
            let mut run = state.import_state.lock().unwrap();
            run.lifecycle = ImportLifecycle::Cancelling;
            journal::write_record(root, &journal::record_from_state(&run).unwrap()).unwrap();
        }
        state
    }

    let graceful_root = tempfile::tempdir().unwrap();
    let graceful = cancelling_state(graceful_root.path());
    let order = RefCell::new(Vec::new());
    let generation = confirm_import_termination_with(
        &graceful,
        42,
        |_| {
            order.borrow_mut().push("signal");
            Ok(())
        },
        |_| {
            order.borrow_mut().push("force");
            Ok(())
        },
        |_, _| {
            order.borrow_mut().push("wait");
            Ok(true)
        },
    )
    .unwrap();
    assert_eq!(generation, 4);
    assert_eq!(&*order.borrow(), &["signal", "wait"]);

    let signal_root = tempfile::tempdir().unwrap();
    let signal = cancelling_state(signal_root.path());
    let waited = Cell::new(false);
    assert_eq!(
        confirm_import_termination_with(
            &signal,
            42,
            |_| Err("signal denied".to_string()),
            |_| Ok(()),
            |_, _| {
                waited.set(true);
                Ok(true)
            },
        )
        .unwrap_err(),
        "signal denied"
    );
    assert!(!waited.get());
    assert_eq!(signal.import_state.lock().unwrap().child_pid, Some(42));

    let force_root = tempfile::tempdir().unwrap();
    let force = cancelling_state(force_root.path());
    assert_eq!(
        confirm_import_termination_with(
            &force,
            42,
            |_| Ok(()),
            |_| Err("force denied".to_string()),
            |_, _| Ok(false),
        )
        .unwrap_err(),
        "force denied"
    );
    assert_eq!(
        force.import_state.lock().unwrap().termination_requested_for,
        None
    );

    let final_wait_root = tempfile::tempdir().unwrap();
    let final_wait = cancelling_state(final_wait_root.path());
    let waits = Cell::new(0);
    assert_eq!(
        confirm_import_termination_with(
            &final_wait,
            42,
            |_| Ok(()),
            |_| Ok(()),
            |_, _| {
                waits.set(waits.get() + 1);
                if waits.get() == 1 {
                    Ok(false)
                } else {
                    Err("final wait unavailable".to_string())
                }
            },
        )
        .unwrap_err(),
        "final wait unavailable"
    );
    assert_eq!(waits.get(), 2);
    assert_eq!(
        final_wait
            .import_state
            .lock()
            .unwrap()
            .termination_requested_for,
        None
    );
}

#[test]
fn successful_run_scoped_cancellation_is_terminal_and_pid_private() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    let snapshot = stop_import_run_with(&state, "import-run-1", |_, pid| {
        assert_eq!(pid, 42);
        Ok(())
    })
    .unwrap();
    assert_eq!(snapshot.lifecycle, ImportLifecycle::Cancelled);
    assert_eq!(
        snapshot.terminal_result,
        Some(ImportTerminalResult::Cancelled)
    );
    assert!(!serde_json::to_string(&snapshot).unwrap().contains("pid"));
    assert_eq!(
        journal::load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .lifecycle,
        ImportLifecycle::Cancelled
    );
    assert!(state.import_state.lock().unwrap().child_pid.is_none());
}

#[test]
fn preparing_cancellation_is_durable_without_exposing_or_signalling_a_pid() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    {
        let mut run = state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Preparing;
        run.child_pid = None;
        journal::write_record(temp.path(), &journal::record_from_state(&run).unwrap()).unwrap();
    }
    let signalled = std::cell::Cell::new(false);
    let snapshot = stop_import_run_with(&state, "import-run-1", |_, _| {
        signalled.set(true);
        Ok(())
    })
    .unwrap();
    assert_eq!(snapshot.lifecycle, ImportLifecycle::Cancelled);
    assert!(!signalled.get());
    assert_eq!(
        journal::load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .terminal_result,
        Some(ImportTerminalResult::Cancelled)
    );
}

#[test]
fn obsolete_cancellation_never_calls_process_control() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    let called = std::cell::Cell::new(false);
    assert!(
        stop_import_run_with(&state, "old-run", |_, _| {
            called.set(true);
            Ok(())
        })
        .is_err()
    );
    assert!(!called.get());
    assert_eq!(
        state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Running
    );
}

#[test]
fn supervisor_exit_during_cancellation_durably_finishes_cancelled() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    {
        let mut run = state.import_state.lock().unwrap();
        run.transition(ImportLifecycle::Cancelling).unwrap();
        run.termination_requested_for = Some(42);
        journal::write_record(temp.path(), &journal::record_from_state(&run).unwrap()).unwrap();
    }

    let snapshot = finalize_import_process(&state, 4, 42, 0).unwrap();

    assert_eq!(snapshot.lifecycle, ImportLifecycle::Cancelled);
    assert_eq!(
        snapshot.terminal_result,
        Some(ImportTerminalResult::Cancelled)
    );
    assert!(state.import_state.lock().unwrap().child_pid.is_none());
    assert_eq!(
        journal::load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .lifecycle,
        ImportLifecycle::Cancelled
    );
}

#[test]
fn process_exit_checkpoint_exposes_finalizing_before_verification() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());

    let snapshot = record_import_process_exit(&state, 4, 42, 0).unwrap();

    assert_eq!(snapshot.lifecycle, ImportLifecycle::Finalizing);
    assert_eq!(snapshot.exit_evidence.unwrap().exit_code, 0);
    assert!(snapshot.terminal_result.is_none());
    assert_eq!(
        journal::load_record(temp.path())
            .unwrap()
            .unwrap()
            .snapshot
            .lifecycle,
        ImportLifecycle::Finalizing
    );
}

#[test]
fn write_ahead_persistence_failures_block_each_later_mutation_or_publication() {
    use crate::import::relocation::{
        RelocationOutcome, RelocationSubjectStatus, SubjectRelocationOutcome,
    };
    use crate::import::types::{ImportSubjectOutcome, ImportSubjectOutcomeKind};

    // Preparing persistence failure: no staging mutation and no in-memory
    // reservation becomes visible.
    let reserve_root = tempfile::tempdir().unwrap();
    let reserve_state = AppState::default();
    *reserve_state.active_project_root.lock().unwrap() =
        Some(reserve_root.path().canonicalize().unwrap());
    let plan = crate::import::state::plan_import_relocation_for_state(
        &reserve_state,
        &["ONE".to_string()],
    )
    .unwrap();
    journal::fail_next_record_write();
    assert!(
        reserve_import_run_for_state(
            &reserve_state,
            vec!["ONE".to_string()],
            plan.plan_id,
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .is_err()
    );
    assert_eq!(
        reserve_state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Idle
    );
    assert!(!reserve_root.path().join(".easl_staging").exists());

    // Running persistence failure: readiness remains impossible and both
    // durable and in-memory lifecycle stay Preparing.
    let running_root = tempfile::tempdir().unwrap();
    let preparing_state = running_state(running_root.path());
    {
        let mut run = preparing_state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Preparing;
        run.child_pid = Some(RESERVED_IMPORT_PID);
        journal::write_record(
            running_root.path(),
            &journal::record_from_state(&run).unwrap(),
        )
        .unwrap();
    }
    journal::fail_next_record_write();
    assert!(set_reserved_import_pid(&preparing_state, 4, 42).is_err());
    assert_eq!(
        preparing_state.import_state.lock().unwrap().lifecycle,
        ImportLifecycle::Preparing
    );
    assert_eq!(
        journal::load_record(running_root.path())
            .unwrap()
            .unwrap()
            .snapshot
            .lifecycle,
        ImportLifecycle::Preparing
    );

    // Verification persistence failure: relocation never starts and
    // project output remains absent.
    let verify_root = tempfile::tempdir().unwrap();
    let verify_state = running_state(verify_root.path());
    let staging = verify_root.path().join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
    fs::write(
        staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
        "generation-1",
    )
    .unwrap();
    let lock = crate::import::status::import_lock_dir(&staging, "ONE");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("999_ready.status"), "ready").unwrap();
    fs::write(staging.join("rawdata/sub-ONE/scan.nii"), "nii").unwrap();
    record_import_process_exit(&verify_state, 4, 42, 0).unwrap();
    journal::fail_next_record_write();
    assert!(complete_finalizing_import(&verify_state, 4, 0).is_err());
    assert!(!verify_root.path().join("rawdata/sub-ONE").exists());
    let durable = journal::load_record(verify_root.path()).unwrap().unwrap();
    assert_eq!(durable.snapshot.lifecycle, ImportLifecycle::Finalizing);
    assert!(durable.snapshot.subject_outcomes.is_empty());
    assert!(durable.snapshot.relocation_outcome.is_none());

    // Terminal persistence failure: relocation checkpoint remains durable,
    // but no terminal snapshot can be returned for emission/discovery.
    let terminal_root = tempfile::tempdir().unwrap();
    let terminal_state = running_state(terminal_root.path());
    {
        let mut run = terminal_state.import_state.lock().unwrap();
        run.lifecycle = ImportLifecycle::Finalizing;
        run.child_pid = None;
        run.exit_evidence = Some(crate::import::types::ImportExitEvidence {
            exit_code: 0,
            successful: true,
        });
        run.subject_outcomes = vec![ImportSubjectOutcome {
            subject: "ONE".to_string(),
            outcome: ImportSubjectOutcomeKind::Verified,
            ready_lock_verified: true,
            rawdata_verified: true,
            committed: false,
            error: None,
        }];
        run.relocation_outcome = Some(RelocationOutcome {
            plan_id: "plan-1".to_string(),
            generation: 4,
            subjects: vec![SubjectRelocationOutcome {
                subject: "ONE".to_string(),
                status: RelocationSubjectStatus::Committed,
                phase: "committed".to_string(),
                message: None,
            }],
            staging_cleanup_complete: true,
        });
        journal::write_record(
            terminal_root.path(),
            &journal::record_from_state(&run).unwrap(),
        )
        .unwrap();
    }
    journal::fail_record_write_after(1);
    assert!(complete_finalizing_import(&terminal_state, 4, 0).is_err());
    let memory = terminal_state.import_state.lock().unwrap().snapshot();
    let durable = journal::load_record(terminal_root.path())
        .unwrap()
        .unwrap()
        .snapshot;
    assert_eq!(memory, durable);
    assert_eq!(durable.lifecycle, ImportLifecycle::Finalizing);
    assert!(durable.terminal_result.is_none());
    assert_eq!(
        durable.subject_outcomes[0].outcome,
        ImportSubjectOutcomeKind::Committed
    );
}

#[test]
fn obsolete_supervisor_never_returns_a_replacement_snapshot_for_emission() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    state.import_state.lock().unwrap().run_id = "replacement".to_string();

    assert!(finalize_import_process(&state, 3, 42, 0).is_err());
    assert_eq!(state.import_state.lock().unwrap().run_id, "replacement");
}

#[test]
fn parser_completion_and_failure_are_provisional_until_artifact_finalization() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    {
        let run = state.import_state.lock().unwrap();
        let before = run.snapshot();
        for mut event in [
            ImportStructuredEvent::SubjectComplete {
                subject: "ONE".to_string(),
                duration_secs: 1,
            },
            ImportStructuredEvent::ImportComplete,
            ImportStructuredEvent::ImportFailed {
                subject: "ONE".to_string(),
                step: "NII2BIDS".to_string(),
                message: "parser diagnostic".to_string(),
            },
        ] {
            assert!(canonicalize_import_event_subject(
                &mut event,
                &run.subject_list
            ));
            assert!(accepts_import_diagnostic(&run, 4));
        }
        assert_eq!(run.lifecycle, ImportLifecycle::Running);
        assert!(run.subject_outcomes.is_empty());
        assert_eq!(run.snapshot(), before);
    }
}

#[cfg(unix)]
#[test]
fn large_interleaved_stdout_and_stderr_are_fully_drained_without_deadlock() {
    let mut child = std::process::Command::new("sh")
        .arg("-c")
        .arg("i=0; while [ $i -lt 4000 ]; do echo stdout-$i; echo stderr-$i >&2; i=$((i+1)); done")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (sender, receiver) = mpsc::channel();
    let stdout = read_pipe_lines(
        child.stdout.take().unwrap(),
        ImportOutputLineSource::Stdout,
        sender.clone(),
    );
    let stderr = read_pipe_lines(
        child.stderr.take().unwrap(),
        ImportOutputLineSource::Stderr,
        sender.clone(),
    );
    drop(sender);
    let lines = receiver.into_iter().collect::<Vec<_>>();
    stdout.join().unwrap();
    stderr.join().unwrap();
    assert!(child.wait().unwrap().success());
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.source == ImportOutputLineSource::Stdout)
            .count(),
        4000
    );
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.source == ImportOutputLineSource::Stderr)
            .count(),
        4000
    );
}

#[test]
fn parser_failure_is_diagnostic_when_artifact_is_valid_and_authoritative_when_invalid() {
    for valid_artifact in [true, false] {
        let temp = tempfile::tempdir().unwrap();
        let state = running_state(temp.path());
        let staging = temp.path().join(".easl_staging");
        fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
        fs::write(
            staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
            "generation-1",
        )
        .unwrap();
        fs::write(staging.join("rawdata/sub-ONE/scan.nii"), "nii").unwrap();
        if valid_artifact {
            let lock = crate::import::status::import_lock_dir(&staging, "ONE");
            fs::create_dir_all(&lock).unwrap();
            fs::write(lock.join("999_ready.status"), "ready").unwrap();
        }
        assert!(accepts_import_diagnostic(
            &state.import_state.lock().unwrap(),
            4
        ));

        let terminal = finalize_import_process(&state, 4, 42, 0).unwrap();
        assert_eq!(
            terminal.lifecycle,
            if valid_artifact {
                ImportLifecycle::Completed
            } else {
                ImportLifecycle::Failed
            }
        );
        assert_eq!(terminal.subject_outcomes[0].committed, valid_artifact);
    }
}

#[cfg(unix)]
#[test]
fn required_failed_lock_cleanup_error_fails_terminal_and_preserves_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    let staging = temp.path().join(".easl_staging");
    fs::create_dir_all(&staging).unwrap();
    fs::write(
        staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
        "generation-1",
    )
    .unwrap();
    let lock = crate::import::status::import_lock_dir(&staging, "ONE");
    fs::create_dir_all(&lock).unwrap();
    let special = lock.join("010_DCM2NII.status");
    fs::create_dir(&special).unwrap();

    let terminal = finalize_import_process(&state, 4, 42, 0).unwrap();

    assert_eq!(terminal.lifecycle, ImportLifecycle::Failed);
    assert!(
        terminal
            .error
            .unwrap()
            .message
            .contains("Failed-subject status path is unsafe")
    );
    assert!(special.exists());
    assert!(!temp.path().join("rawdata/sub-ONE").exists());
}

#[test]
fn native_finalizer_preserves_debug_staging_without_weakening_success_checks() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state(temp.path());
    {
        let mut run = state.import_state.lock().unwrap();
        run.preserve_staging = true;
        journal::write_record(temp.path(), &journal::record_from_state(&run).unwrap()).unwrap();
    }
    let staging = temp.path().join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-ONE")).unwrap();
    fs::write(
        staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
        "generation-1",
    )
    .unwrap();
    fs::write(staging.join("rawdata/sub-ONE/scan.nii"), "nii").unwrap();
    fs::write(staging.join("studyPar.json"), "{}").unwrap();
    fs::write(staging.join("sourcestructure.json"), "{}").unwrap();
    fs::write(staging.join("debug.log"), "retain").unwrap();
    let lock = crate::import::status::import_lock_dir(&staging, "ONE");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("999_ready.status"), "ready").unwrap();

    let terminal = finalize_import_process(&state, 4, 42, 0).unwrap();

    assert_eq!(terminal.lifecycle, ImportLifecycle::Completed);
    assert!(staging.join("debug.log").is_file());
    assert!(
        temp.path()
            .join("derivatives/ExploreASL_GUI/studyPar.json")
            .is_file()
    );
    assert!(terminal.subject_outcomes[0].ready_lock_verified);
    assert!(terminal.subject_outcomes[0].rawdata_verified);
    assert!(terminal.subject_outcomes[0].committed);
}

#[test]
fn mixed_subject_finalization_commits_only_verified_subject_and_replays_without_relocation() {
    let temp = tempfile::tempdir().unwrap();
    let state = running_state_for_subjects(temp.path(), &["GOOD", "BAD"]);
    let staging = temp.path().join(".easl_staging");
    fs::create_dir_all(staging.join("rawdata/sub-GOOD")).unwrap();
    fs::create_dir_all(staging.join("rawdata/sub-BAD")).unwrap();
    fs::write(
        staging.join(crate::import::verification::STAGING_GENERATION_MARKER),
        "generation-1",
    )
    .unwrap();
    fs::write(staging.join("rawdata/sub-GOOD/scan.nii"), "good").unwrap();
    fs::write(staging.join("rawdata/sub-BAD/scan.nii"), "bad-staging").unwrap();
    let lock = crate::import::status::import_lock_dir(&staging, "GOOD");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("999_ready.status"), "ready").unwrap();

    let terminal = finalize_import_process(&state, 4, 42, 7).unwrap();

    assert_eq!(terminal.lifecycle, ImportLifecycle::Failed);
    assert_eq!(terminal.subject_outcomes.len(), 2);
    assert!(
        terminal
            .subject_outcomes
            .iter()
            .find(|outcome| outcome.subject == "GOOD")
            .unwrap()
            .committed
    );
    assert_eq!(
        terminal
            .subject_outcomes
            .iter()
            .find(|outcome| outcome.subject == "BAD")
            .unwrap()
            .outcome,
        crate::import::types::ImportSubjectOutcomeKind::Failed
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("rawdata/sub-GOOD/scan.nii")).unwrap(),
        "good"
    );
    assert!(!temp.path().join("rawdata/sub-BAD").exists());
    assert_eq!(
        fs::read_to_string(staging.join("rawdata/sub-BAD/scan.nii")).unwrap(),
        "bad-staging"
    );
    let durable = journal::load_record(temp.path()).unwrap().unwrap().snapshot;
    assert_eq!(durable, terminal);
    assert!(durable.relocation_outcome.is_some());

    // Simulate listener loss/restart. Terminal recovery and late attachment
    // return the same snapshot; already-committed content is not moved again.
    let committed_mtime = fs::metadata(temp.path().join("rawdata/sub-GOOD/scan.nii"))
        .unwrap()
        .modified()
        .unwrap();
    let recovered_state = AppState::default();
    *recovered_state.active_project_root.lock().unwrap() =
        Some(temp.path().canonicalize().unwrap());
    let replay =
        crate::import::state::recover_import_run_for_project(&recovered_state, temp.path())
            .unwrap()
            .unwrap();
    assert_eq!(replay, terminal);
    assert_eq!(
        crate::import::state::attach_import_run_for_state(&recovered_state, &replay.run_id)
            .unwrap(),
        terminal
    );
    assert_eq!(
        fs::metadata(temp.path().join("rawdata/sub-GOOD/scan.nii"))
            .unwrap()
            .modified()
            .unwrap(),
        committed_mtime
    );
}

#[cfg(unix)]
#[test]
fn native_pipeline_checkpoint_and_finalizer_matrix_needs_no_parser_completion_or_listener() {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Listener;

    for (name, writes_evidence, exit_code, expected_lifecycle, expected_commit) in [
        ("all verified", true, 0, ImportLifecycle::Completed, true),
        (
            "zero exit missing target",
            false,
            0,
            ImportLifecycle::Failed,
            false,
        ),
        (
            "nonzero exit verified partial",
            true,
            7,
            ImportLifecycle::Failed,
            true,
        ),
    ] {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().join("project");
        let source = workspace.path().join("source.dcm");
        let matlab = workspace.path().join("fake-matlab");
        let exploreasl = workspace.path().join("ExploreASL");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&exploreasl).unwrap();
        fs::write(exploreasl.join("ExploreASL.m"), "% test").unwrap();
        fs::write(&source, "dicom").unwrap();
        let evidence = if writes_evidence {
            format!(
                "mkdir -p '{0}/.easl_staging/rawdata/sub-ONE' '{0}/.easl_staging/derivatives/ExploreASL/lock/xASL_module_Import/ONE/xASL_module_Import'; printf nii > '{0}/.easl_staging/rawdata/sub-ONE/scan.nii'; printf ready > '{0}/.easl_staging/derivatives/ExploreASL/lock/xASL_module_Import/ONE/xASL_module_Import/999_ready.status';",
                root.display()
            )
        } else {
            String::new()
        };
        // Deliberately omit parser global completion text. The process
        // exit, freshly-created marker-bound evidence, and relocation are
        // the only authority for the terminal result.
        fs::write(&matlab, format!("#!/bin/sh\nsleep 0.1\n{evidence}\nprintf diagnostic-on-stderr >&2\nexit {exit_code}\n")).unwrap();
        let mut permissions = fs::metadata(&matlab).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&matlab, permissions).unwrap();

        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let state = app.state::<AppState>();
        let root = fs::canonicalize(&root).unwrap();
        *state.active_project_root.lock().unwrap() = Some(root.clone());
        let emitted_snapshots = Arc::new(Mutex::new(Vec::new()));
        let snapshot_log = emitted_snapshots.clone();
        let event_root = root.clone();
        app.listen("import-run-snapshot", move |event| {
            let snapshot: crate::import::types::ImportRunSnapshot =
                serde_json::from_str(event.payload()).unwrap();
            let durable = journal::load_record(&event_root).unwrap().unwrap().snapshot;
            assert_eq!(
                durable, snapshot,
                "snapshot emission must follow matching durable record"
            );
            snapshot_log.lock().unwrap().push(snapshot.lifecycle);
        });
        let plan = crate::import::relocation::create_plan(
            &root,
            &["ONE".to_string()],
            format!("plan-{name}"),
        )
        .unwrap();
        state
            .relocation_plans
            .lock()
            .unwrap()
            .insert(plan.plan_id.clone(), plan.clone());
        let reserved = reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id.clone(),
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .unwrap();
        assert_eq!(
            journal::load_record(&root)
                .unwrap()
                .unwrap()
                .snapshot
                .lifecycle,
            ImportLifecycle::Preparing,
            "{name}: Preparing is durable before staging mutation"
        );
        let entry = StagingEntry {
            subject: "ONE".into(),
            session: "01".into(),
            run: "01".into(),
            run_alias: "ASL1".into(),
            modality: "ASL4D".into(),
            original_subject: "ONE".into(),
            original_session: "01".into(),
            original_run: "01".into(),
            source_path: source.display().to_string(),
        };
        run_import_pipeline_impl(
            app.handle().clone(),
            &state,
            vec![entry],
            serde_json::json!({}),
            serde_json::json!({}),
            ExecutionProfile::Matlab {
                id: "profile-1".into(),
                label: "Fake".into(),
                matlab_path: matlab.display().to_string(),
                explore_asl_path: exploreasl.display().to_string(),
                explore_asl_version: None,
            },
            vec!["ONE".to_string()],
            None,
            reserved.run_id,
            plan.plan_id,
        )
        .unwrap();
        let running = journal::load_record(&root).unwrap().unwrap();
        assert_eq!(
            running.snapshot.lifecycle,
            ImportLifecycle::Running,
            "{name}: readiness follows durable Running"
        );
        assert!(
            !running.staging_generation.is_empty(),
            "{name}: marker baseline is durable before spawn"
        );
        assert!(
            emitted_snapshots
                .lock()
                .unwrap()
                .contains(&ImportLifecycle::Running)
        );

        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let run = state.import_state.lock().unwrap();
            let settled = run.lifecycle.is_terminal() && run.supervisor_handle.is_none();
            drop(run);
            if settled {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "{name}: native finalizer or supervisor release timed out"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        let terminal = journal::load_record(&root).unwrap().unwrap().snapshot;
        assert_eq!(terminal.lifecycle, expected_lifecycle, "{name}");
        assert!(
            terminal.exit_evidence.is_some(),
            "{name}: exit precedes Finalizing work"
        );
        assert_eq!(
            terminal.subject_outcomes[0].committed, expected_commit,
            "{name}"
        );
        assert_eq!(
            root.join("rawdata/sub-ONE/scan.nii").is_file(),
            expected_commit,
            "{name}: relocate only verified subjects"
        );
        if !expected_commit {
            assert!(
                root.join(".easl_staging").exists(),
                "{name}: failed staging remains diagnosable"
            );
        }
        assert!(
            state
                .import_state
                .lock()
                .unwrap()
                .supervisor_handle
                .is_none(),
            "{name}: terminal supervisor ownership is released"
        );
        assert!(
            crate::project_runtime::shutdown_project_runtime_impl(&state).success,
            "{name}: terminal import must not block project close"
        );
        let event_deadline = Instant::now() + Duration::from_secs(1);
        while emitted_snapshots.lock().unwrap().len() < 3 {
            assert!(
                Instant::now() < event_deadline,
                "{name}: terminal event delivery timed out"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        let observed = emitted_snapshots.lock().unwrap().clone();
        assert_eq!(
            observed,
            vec![
                ImportLifecycle::Running,
                ImportLifecycle::Finalizing,
                expected_lifecycle
            ],
            "{name}: Running and Finalizing snapshots precede durable terminal snapshot"
        );
    }
}

#[cfg(unix)]
#[test]
fn launch_rejects_obsolete_ids_fails_repeated_preflight_and_reaps_partial_spawn() {
    use std::os::unix::fs::PermissionsExt;

    struct Fixture {
        _workspace: tempfile::TempDir,
        app: tauri::App<tauri::test::MockRuntime>,
        root: PathBuf,
        source: PathBuf,
        matlab: PathBuf,
        exploreasl: PathBuf,
        entry: StagingEntry,
    }

    fn fixture() -> Fixture {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().join("project");
        let source = workspace.path().join("source.dcm");
        let matlab = workspace.path().join("fake-matlab");
        let exploreasl = workspace.path().join("ExploreASL");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&exploreasl).unwrap();
        fs::write(exploreasl.join("ExploreASL.m"), "% test").unwrap();
        fs::write(&source, "dicom").unwrap();
        fs::write(&matlab, "#!/bin/sh\nsleep 30\n").unwrap();
        let mut permissions = fs::metadata(&matlab).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&matlab, permissions).unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let root = root.canonicalize().unwrap();
        *app.state::<AppState>().active_project_root.lock().unwrap() = Some(root.clone());
        let entry = StagingEntry {
            subject: "ONE".into(),
            session: "01".into(),
            run: "01".into(),
            run_alias: "ASL1".into(),
            modality: "ASL4D".into(),
            original_subject: "ONE".into(),
            original_session: "01".into(),
            original_run: "01".into(),
            source_path: source.display().to_string(),
        };
        Fixture {
            _workspace: workspace,
            app,
            root,
            source,
            matlab,
            exploreasl,
            entry,
        }
    }

    fn reserve(fixture: &Fixture) -> (crate::import::types::ImportRunSnapshot, String) {
        let state = fixture.app.state::<AppState>();
        let plan =
            crate::import::state::plan_import_relocation_for_state(&state, &["ONE".to_string()])
                .unwrap();
        let run = reserve_import_run_for_state(
            &state,
            vec!["ONE".to_string()],
            plan.plan_id.clone(),
            "profile-1".to_string(),
            Vec::new(),
            false,
        )
        .unwrap();
        (run, plan.plan_id)
    }

    fn launch(
        fixture: &Fixture,
        run_id: String,
        plan_id: String,
    ) -> Result<u32, ImportCommandError> {
        run_import_pipeline_impl(
            fixture.app.handle().clone(),
            &fixture.app.state::<AppState>(),
            vec![fixture.entry.clone()],
            serde_json::json!({}),
            serde_json::json!({}),
            ExecutionProfile::Matlab {
                id: "profile-1".into(),
                label: "Fake".into(),
                matlab_path: fixture.matlab.display().to_string(),
                explore_asl_path: fixture.exploreasl.display().to_string(),
                explore_asl_version: None,
            },
            vec!["ONE".to_string()],
            None,
            run_id,
            plan_id,
        )
    }

    // Launch-time preflight is repeated after reservation. Its failure is
    // converted into that exact run's authoritative Failed snapshot.
    let preflight = fixture();
    let (run, plan) = reserve(&preflight);
    fs::remove_file(&preflight.source).unwrap();
    let launch_result = launch(&preflight, run.run_id.clone(), plan);
    let failed = crate::import::commands::settle_launch_result(
        &preflight.app.state::<AppState>(),
        &run.run_id,
        launch_result,
    )
    .unwrap();
    assert_eq!(failed.lifecycle, ImportLifecycle::Failed);
    assert!(
        failed
            .error
            .as_ref()
            .and_then(|error| error.staging_issues.as_ref())
            .is_some_and(|issues| !issues.is_empty())
    );
    assert!(!preflight.root.join(".easl_staging").exists());

    // Acknowledged/replaced IDs cannot consume the replacement reservation.
    let obsolete = fixture();
    let (old, _) = reserve(&obsolete);
    {
        let state = obsolete.app.state::<AppState>();
        let mut owned = state.import_state.lock().unwrap();
        owned.lifecycle = ImportLifecycle::Interrupted;
        owned.terminal_result = Some(ImportTerminalResult::Interrupted);
        journal::write_record(&obsolete.root, &journal::record_from_state(&owned).unwrap())
            .unwrap();
    }
    crate::import::state::acknowledge_import_run_for_state(
        &obsolete.app.state::<AppState>(),
        &old.run_id,
    )
    .unwrap();
    let (replacement, replacement_plan) = reserve(&obsolete);
    let before = journal::load_record(&obsolete.root).unwrap().unwrap();
    let stale_result = launch(&obsolete, old.run_id.clone(), replacement_plan);
    assert!(
        crate::import::commands::settle_launch_result(
            &obsolete.app.state::<AppState>(),
            &old.run_id,
            stale_result,
        )
        .is_err()
    );
    assert_eq!(
        journal::load_record(&obsolete.root)
            .unwrap()
            .unwrap()
            .snapshot,
        before.snapshot
    );
    assert_eq!(
        obsolete
            .app
            .state::<AppState>()
            .import_state
            .lock()
            .unwrap()
            .run_id,
        replacement.run_id
    );
    assert!(!obsolete.root.join(".easl_staging").exists());

    // Failure after OS spawn but before durable Running kills/reaps child,
    // emits no readiness, and returns a path-free failed snapshot.
    let partial = fixture();
    let (run, plan) = reserve(&partial);
    journal::fail_record_write_after(2);
    let launch_result = launch(&partial, run.run_id.clone(), plan);
    let failed = crate::import::commands::settle_launch_result(
        &partial.app.state::<AppState>(),
        &run.run_id,
        launch_result,
    )
    .unwrap();
    assert_eq!(failed.lifecycle, ImportLifecycle::Failed);
    assert!(failed.terminal_result.is_some());
    assert!(!serde_json::to_string(&failed).unwrap().contains("pid"));
    assert_eq!(
        journal::load_record(&partial.root)
            .unwrap()
            .unwrap()
            .snapshot,
        failed
    );
    assert!(
        partial
            .app
            .state::<AppState>()
            .import_state
            .lock()
            .unwrap()
            .child_pid
            .is_none()
    );
}
