use super::common::state_with_active_project;
use crate::processing::{record::*, types::*};
use std::{fs, path::Path};
use uuid::Uuid;

fn request(root: &Path) -> ProcessingRequest {
    let mut data_par = serde_json::json!({"x": {}});
    let switches = serde_json::to_value(crate::project::model::DataPar::switch_defaults()).unwrap();
    for (key, value) in switches.as_object().unwrap() {
        if key == "enableMetadataGroupingCorrection" {
            continue;
        }
        let pointer = switch_pointer(key);
        let mut section = &mut data_par;
        for part in pointer.trim_start_matches('/').split('/') {
            section = section
                .as_object_mut()
                .unwrap()
                .entry(part)
                .or_insert_with(|| serde_json::json!({}));
        }
        *section = value.clone();
    }
    ProcessingRequest {
        request_id: Uuid::new_v4(),
        project_id: "legacy-project-id".into(),
        project_root: root.into(),
        selected_modules: vec!["population".into()],
        selected_subject_sessions: Vec::new(),
        execution_profile: crate::execution::profile::ExecutionProfile::Matlab {
            id: "profile".into(),
            label: "MATLAB".into(),
            matlab_path: "unused".into(),
            explore_asl_path: "unused".into(),
            explore_asl_version: None,
        },
        data_par,
        participants: ParticipantInputs::default(),
        workers: 2,
        rerun_bids2legacy: false,
    }
}
fn project(root: &Path) {
    fs::write(
        root.join("project.easl"),
        br#"{"projectMeta":{"id":"legacy-project-id","dataSource":"bids"}}"#,
    )
    .unwrap();
}
fn terminal(root: &Path, request: ProcessingRequest) -> ProcessingRecord {
    let previous = admit(root, request).unwrap();
    let mut record = previous.clone();
    record.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
    persist(&record, Some(&previous)).unwrap();
    record
}
#[test]
fn durable_terminal_remains_discoverable_and_blocks_legacy_reservation() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let state = state_with_active_project(temp.path());
    let terminal = terminal(temp.path(), request(temp.path()));
    state.processing_state.lock().unwrap().current_run =
        Some(ProcessingRun::from_record(terminal.clone()));
    assert!(
        crate::processing::runs::get_active_run_impl(&state)
            .unwrap()
            .is_some(),
        "Unacknowledged terminal must remain discoverable"
    );
    assert!(
        crate::processing::runs::reserve_processing_run_impl(
            &state,
            vec!["population".into()],
            Vec::new()
        )
        .is_err()
    );
}

#[test]
fn guardian_era_current_record_is_rejected_with_guidance_and_preserved() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let record = admit(temp.path(), request(temp.path())).unwrap();
    let path = temp.path().join(CURRENT_RECORD);
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["version"] = serde_json::json!(1);
    value["containment"] = serde_json::json!({"legacy": true});
    let bytes = serde_json::to_vec(&value).unwrap();
    fs::write(&path, &bytes).unwrap();

    let error = records(temp.path()).unwrap_err();
    assert!(error.to_string().contains("Guardian-era processing record"));
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert_eq!(record.version, 2);
}

#[test]
fn activation_marks_absent_processing_owner_interrupted_and_blocks_admission() {
    use tauri::Manager;

    for (committed, population) in [(true, true), (false, true), (true, false)] {
        let temp = tempfile::tempdir().unwrap();
        let mut document = crate::project::config::defaults(
            "Recovery".into(),
            crate::project::model::DataSource::Bids,
            "profile".into(),
        )
        .unwrap();
        document.project_meta.id = "legacy-project-id".into();
        document.ui_state.processing = Some(
            serde_json::from_value(serde_json::json!({
                "population": {"completed": true, "lastRun": {"profileId": "prior", "Mtime": 42}}
            }))
            .unwrap(),
        );
        let reviewer = document.ui_state.manifest.active_reviewer_id.clone();
        document.ui_state.manifest.verdicts = serde_json::from_value(serde_json::json!({
            (reviewer): {"sub-ONE_1": {"status": "pass", "setAt": 1}}
        }))
        .unwrap();
        let bytes = crate::project::config::serialize(&document).unwrap();
        fs::write(temp.path().join("project.easl"), &bytes).unwrap();
        let mut attempt = request(temp.path());
        if !population {
            attempt.selected_modules = vec!["structural".into()];
            fs::create_dir_all(temp.path().join("sub-ONE/anat")).unwrap();
            fs::write(temp.path().join("sub-ONE/anat/sub-ONE_T1w.nii"), "fixture").unwrap();
        }
        let admitted = admit(temp.path(), attempt).unwrap();
        let mut running = admitted.clone();
        if committed {
            let previous = running.clone();
            running.execution_committed = true;
            running.execution_committed_at_ms = Some(1);
            running.set_lifecycle(ProcessingLifecycle::Running).unwrap();
            persist(&running, Some(&previous)).unwrap();
        }
        let app = tauri::test::mock_builder()
            .manage(crate::app::state::AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let state = app.state::<crate::app::state::AppState>();

        // Project activation remains viewable, but no absent native owner may be
        // treated as settled or replaced before exact external-stop confirmation.
        let inspected = crate::project::config::inspect_for_state(
            &state,
            temp.path().join("project.easl").display().to_string(),
            Vec::new(),
        )
        .unwrap();
        let opened =
            crate::project::config::activate_for_state(&state, inspected.candidate_id, false)
                .unwrap();
        let mut expected = document.clone();
        if committed && population {
            expected
                .ui_state
                .processing
                .as_mut()
                .unwrap()
                .population
                .as_mut()
                .unwrap()
                .completed = Some(false);
        }
        assert_eq!(opened.document, expected);
        assert_eq!(opened.accepted_revision, opened.persisted_revision);
        assert_eq!(
            crate::project::validation::parse_document(
                &fs::read(temp.path().join("project.easl")).unwrap()
            )
            .unwrap(),
            expected
        );
        if !(committed && population) {
            assert_eq!(fs::read(temp.path().join("project.easl")).unwrap(), bytes);
            assert!(!temp.path().join("project.easl.bak").exists());
        }
        let recovered = records(temp.path()).unwrap().pop().unwrap();
        assert_eq!(recovered.execution_committed, committed);
        assert!(!recovered.acknowledged);
        assert_eq!(recovered.terminal_revision, None);
        let snapshot = crate::processing::runs::get_active_run_impl(&state)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.run_id, admitted.run_id.to_string());
        assert_eq!(snapshot.lifecycle, ProcessingLifecycle::Interrupted);
        assert_eq!(snapshot.available_action, AvailableAction::ConfirmStopped);
        assert!(
            crate::processing::runs::reserve_request_impl(
                &state,
                request(temp.path()),
                ProcessingAdmission {
                    project_root: temp.path().into(),
                },
            )
            .is_err()
        );
        let error = crate::import::reserve_import_run(
            app.state(),
            vec!["subject".into()],
            "plan".into(),
            "profile".into(),
            None,
            false,
        )
        .unwrap_err();
        assert!(crate::project::ownership::ensure_processing_released(&state).is_err());
        assert_eq!(error.message, "Import could not be prepared.");
        assert!(error.details.is_empty());
    }
}

#[test]
fn activation_of_copied_unresolved_record_requires_confirmation_without_mutation() {
    use tauri::Manager;

    let original = tempfile::tempdir().unwrap();
    let copied = tempfile::tempdir().unwrap();
    project(original.path());
    project(copied.path());
    let admitted = admit(original.path(), request(original.path())).unwrap();
    let path = copied.path().join(CURRENT_RECORD);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::copy(original.path().join(CURRENT_RECORD), &path).unwrap();
    let original_bytes = fs::read(&path).unwrap();
    let app = tauri::test::mock_builder()
        .manage(crate::app::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = app.state::<crate::app::state::AppState>();

    crate::project::lifecycle::set_active_project_impl(copied.path().display().to_string(), &state)
        .unwrap();
    let snapshot = crate::processing::runs::get_active_run_impl(&state)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.run_id, admitted.run_id.to_string());
    assert_eq!(snapshot.available_action, AvailableAction::ConfirmStopped);
    assert_ne!(
        fs::read(path).unwrap(),
        original_bytes,
        "only durable Interrupted state changed"
    );
}

#[test]
fn confirmation_requires_exact_interrupted_record_and_retries_persistence_without_journal() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let state = state_with_active_project(temp.path());
    let previous = admit(temp.path(), request(temp.path())).unwrap();
    let mut interrupted = previous.clone();
    interrupted.lifecycle = ProcessingLifecycle::Interrupted;
    interrupted.revision += 1;
    interrupted.available_action = AvailableAction::ConfirmStopped;
    interrupted.error = Some(ProcessingError {
        code: "interrupted".into(),
        message: "confirm external workers".into(),
    });
    persist(&interrupted, Some(&previous)).unwrap();

    assert!(
        crate::processing::runs::confirm_processing_workers_stopped_impl(
            &state,
            Uuid::new_v4(),
            interrupted.revision,
        )
        .is_err()
    );
    crate::processing::journal::inject_fault("beforeRecordWrite");
    assert!(
        crate::processing::runs::confirm_processing_workers_stopped_impl(
            &state,
            interrupted.run_id,
            interrupted.revision,
        )
        .is_err()
    );
    let persisted = records(temp.path()).unwrap().pop().unwrap();
    assert_eq!(persisted.available_action, AvailableAction::ConfirmStopped);
    assert!(persisted.terminal_summary.is_none());

    let confirmed = crate::processing::runs::confirm_processing_workers_stopped_impl(
        &state,
        interrupted.run_id,
        interrupted.revision,
    )
    .unwrap();
    assert_eq!(confirmed.lifecycle, ProcessingLifecycle::Interrupted);
    assert_eq!(confirmed.available_action, AvailableAction::Acknowledge);
    assert_eq!(confirmed.revision, interrupted.revision + 1);
    assert_eq!(confirmed.terminal_revision, Some(confirmed.revision));
}

#[test]
fn record_rejects_impossible_confirmation_and_acknowledgement_actions() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let record = admit(temp.path(), request(temp.path())).unwrap();
    for (lifecycle, action, acknowledged) in [
        (
            ProcessingLifecycle::Preparing,
            AvailableAction::ConfirmStopped,
            false,
        ),
        (
            ProcessingLifecycle::Failed,
            AvailableAction::ConfirmStopped,
            false,
        ),
        (
            ProcessingLifecycle::Preparing,
            AvailableAction::Acknowledge,
            false,
        ),
        (
            ProcessingLifecycle::Failed,
            AvailableAction::Acknowledge,
            true,
        ),
        (ProcessingLifecycle::Failed, AvailableAction::None, false),
    ] {
        let mut invalid = record.clone();
        invalid.revision += 1;
        invalid.lifecycle = lifecycle;
        invalid.available_action = action;
        invalid.acknowledged = acknowledged;
        if lifecycle.is_terminal() {
            invalid.terminal_revision = Some(invalid.revision);
            invalid.terminal_summary = Some(ProcessingTerminalSummary {
                result: ProcessingTerminalResult::Failed,
                execution_committed: false,
                population_completed: false,
                profile_id: "profile".into(),
                explore_asl_version: None,
            });
        }
        assert!(persist(&invalid, Some(&record)).is_err(), "{action:?}");
    }
}

#[test]
fn confirmation_rolls_back_precommit_and_cleans_postcommit_journals() {
    for committed in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let state = state_with_active_project(temp.path());
        let previous = admit(temp.path(), request(temp.path())).unwrap();
        let mut transaction = crate::processing::transaction::LaunchTransaction::plan(
            temp.path(),
            &previous.run_id.to_string(),
            &[false, false, true],
            "",
            false,
        )
        .unwrap();
        transaction.prepare(b"native configuration").unwrap();
        if committed {
            transaction.commit().unwrap();
        }
        let mut interrupted = previous.clone();
        interrupted.lifecycle = ProcessingLifecycle::Interrupted;
        interrupted.revision += 1;
        interrupted.execution_committed = committed;
        interrupted.execution_committed_at_ms = committed.then_some(1);
        interrupted.available_action = AvailableAction::ConfirmStopped;
        interrupted.error = Some(ProcessingError {
            code: "interrupted".into(),
            message: "confirm".into(),
        });
        persist(&interrupted, Some(&previous)).unwrap();

        let snapshot = crate::processing::runs::confirm_processing_workers_stopped_impl(
            &state,
            interrupted.run_id,
            interrupted.revision,
        )
        .unwrap();
        assert_eq!(snapshot.available_action, AvailableAction::Acknowledge);
        let config = temp.path().join("derivatives/ExploreASL/dataPar.json");
        assert_eq!(config.exists(), committed, "committed={committed}");
        crate::processing::journal::compaction_state(temp.path(), interrupted.run_id).unwrap();
    }
}
#[test]
fn request_identity_survives_restart_acknowledgement_and_new_run() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let request = request(temp.path());
    let first = admit(temp.path(), request.clone()).unwrap();
    let duplicate = admit(temp.path(), request.clone()).unwrap();
    assert_eq!(first.run_id, duplicate.run_id);
    let mut changed = request.clone();
    changed.data_par["changed"] = true.into();
    assert!(admit(temp.path(), changed.clone()).is_err());
    let mut terminal = first.clone();
    terminal.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
    persist(&terminal, Some(&first)).unwrap();
    assert!(admit(temp.path(), self::request(temp.path())).is_err());
    acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
    let next = admit(temp.path(), self::request(temp.path())).unwrap();
    assert_ne!(next.run_id, first.run_id);
    assert_eq!(
        lookup_request(temp.path(), request.request_id)
            .unwrap()
            .unwrap()
            .run_id,
        first.run_id
    );
    assert!(admit(temp.path(), changed).is_err());
    assert_eq!(
        records(temp.path())
            .unwrap()
            .into_iter()
            .find(|r| !r.acknowledged)
            .unwrap()
            .run_id,
        next.run_id
    );
}
#[test]
fn exact_acknowledgement_is_durable_idempotent_and_storage_failure_preserves_terminal() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let terminal = terminal(temp.path(), request(temp.path()));
    for (run, revision) in [
        (Uuid::new_v4(), terminal.revision),
        (terminal.run_id, terminal.revision + 1),
        (terminal.run_id, terminal.revision - 1),
    ] {
        assert!(acknowledge(temp.path(), run, revision).is_err());
    }
    crate::processing::journal::inject_fault("beforeRecordWrite");
    assert!(acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err());
    assert!(
        !read(temp.path(), terminal.request.request_id)
            .unwrap()
            .unwrap()
            .acknowledged
    );
    let ack = acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
    assert!(ack.acknowledged);
    assert_eq!(
        acknowledge(temp.path(), terminal.run_id, terminal.revision)
            .unwrap()
            .terminal_revision,
        ack.terminal_revision
    );
}
#[test]
fn record_replacement_uncertainty_never_publishes_terminal_in_memory() {
    for fault in ["beforeRecordWrite", "afterRecordReplace"] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let record = admit(temp.path(), request(temp.path())).unwrap();
        let mut run = ProcessingRun::from_record(record.clone());
        crate::processing::journal::inject_fault(fault);
        assert!(run.transition(ProcessingLifecycle::Failed).is_err());
        assert_eq!(run.lifecycle, ProcessingLifecycle::Preparing);
        assert_eq!(run.snapshot().revision, 1);
        let disk = read(temp.path(), record.request.request_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            disk.lifecycle,
            if fault == "afterRecordReplace" {
                ProcessingLifecycle::Failed
            } else {
                ProcessingLifecycle::Preparing
            }
        );
    }
}
#[test]
fn record_validation_rejects_foreign_version_corruption_and_logical_target_escape() {
    for mutate in [0, 1, 2, 3] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let record = admit(temp.path(), request(temp.path())).unwrap();
        let path = temp
            .path()
            .join("derivatives/ExploreASL_GUI/processing/current.json");
        let mut json = serde_json::to_value(&record).unwrap();
        match mutate {
            0 => json["version"] = 99.into(),
            1 => json["projectRoot"] = "foreign".into(),
            2 => json["expectedTargets"][0]["module"] = "../scientific.nii".into(),
            _ => json["unexpectedAuthority"] = "foreign".into(),
        }
        let bytes = serde_json::to_vec(&json).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(records(temp.path()).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
}
#[test]
fn native_inventory_filters_missing_modalities_and_normalizes_asl_targets() {
    let mut request = request(Path::new("unused"));
    request.selected_modules = vec!["structural".into(), "asl".into()];
    let inventory = vec![
        SubjectInfo {
            subject_session: "sub-001_01".into(),
            subject: "001".into(),
            session: "01".into(),
            has_structural: false,
            has_asl: true,
            asl_runs: vec!["01".into(), "2".into()],
        },
        SubjectInfo {
            subject_session: "sub-002_01".into(),
            subject: "002".into(),
            session: "01".into(),
            has_structural: true,
            has_asl: false,
            asl_runs: vec!["1".into()],
        },
    ];
    let targets = expected_targets(&request, &inventory).unwrap();
    assert_eq!(targets.len(), 3);
    assert_eq!(targets.iter().filter(|t| t.module == "asl").count(), 2);
    assert!(targets.iter().all(|t| t.ready_path().is_ok()));
    request.selected_modules = vec!["structural".into()];
    request.selected_subject_sessions = vec!["sub-001_01".into()];
    assert!(expected_targets(&request, &inventory).is_err());
}

#[test]
fn acknowledgement_compacts_fixed_current_record_into_direct_bounded_lookups() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let request = request(temp.path());
    let current = admit(temp.path(), request.clone()).unwrap();
    let current_path = temp
        .path()
        .join("derivatives/ExploreASL_GUI/processing/current.json");
    assert!(
        current_path.is_file(),
        "one fixed full record is admission authority"
    );
    let current_bytes = fs::read(&current_path).unwrap();
    assert!(
        !String::from_utf8_lossy(&current_bytes).contains(&temp.path().display().to_string()),
        "current root is runtime input, never persisted identity"
    );

    let mut terminal = current.clone();
    terminal.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
    persist(&terminal, Some(&current)).unwrap();
    let replay = acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();

    assert!(replay.historical_replay);
    assert_eq!(replay.request_id, request.request_id);
    assert_eq!(replay.run_id, terminal.run_id);
    assert!(
        !current_path.exists(),
        "compaction removes the only full request payload"
    );
    let request_lookup = temp.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/history/requests/{}.json",
        request.request_id
    ));
    let run_lookup = temp.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/history/runs/{}.json",
        terminal.run_id
    ));
    assert!(request_lookup.is_file());
    assert!(run_lookup.is_file());
    assert!(fs::metadata(request_lookup).unwrap().len() <= 4096);
    assert!(read(temp.path(), request.request_id).unwrap().is_none());
    assert_eq!(
        lookup_request(temp.path(), request.request_id)
            .unwrap()
            .unwrap()
            .run_id,
        terminal.run_id
    );
    assert_eq!(
        lookup_run(temp.path(), terminal.run_id)
            .unwrap()
            .unwrap()
            .request_id,
        request.request_id
    );
}

#[test]
fn ipc_request_has_no_persisted_root_and_returns_current_or_historical_variant() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let state = state_with_active_project(temp.path());
    let request = request(temp.path());
    let mut wire_request: ProcessingRequest =
        serde_json::from_value(serde_json::to_value(&request).unwrap()).unwrap();
    assert!(
        wire_request.project_root.as_os_str().is_empty(),
        "wire content cannot supply durable root identity"
    );
    {
        let mut config = state.project_config.lock().unwrap();
        config.active.as_mut().unwrap().document.data_par.bTopUp = None;
    }
    assert!(
        crate::processing::runs::reserve_request_impl(
            &state,
            wire_request.clone(),
            ProcessingAdmission {
                project_root: temp.path().into()
            }
        )
        .unwrap_err()
        .contains("bTopUp is missing")
    );
    {
        let mut config = state.project_config.lock().unwrap();
        config.active.as_mut().unwrap().document.data_par.bTopUp = Some(false);
    }
    wire_request.data_par["x"]["modules"]["asl"]["bTopUp"] = serde_json::json!(0);
    assert!(
        crate::processing::runs::reserve_request_impl(
            &state,
            wire_request.clone(),
            ProcessingAdmission {
                project_root: temp.path().into()
            }
        )
        .unwrap_err()
        .contains("bTopUp must match")
    );
    assert!(!temp.path().join(CURRENT_RECORD).exists());
    wire_request.data_par["x"]["modules"]["asl"]["bTopUp"] = serde_json::json!(false);
    let first = crate::processing::runs::reserve_request_impl(
        &state,
        wire_request,
        crate::processing::ProcessingAdmission {
            project_root: temp.path().into(),
        },
    )
    .unwrap();
    assert!(matches!(
        first,
        crate::processing::ProcessingReservation::Current { .. }
    ));
}

#[test]
fn stale_ipc_admission_root_rejects_before_current_record_or_effects() {
    let temp = tempfile::tempdir().unwrap();
    let stale = tempfile::tempdir().unwrap();
    project(temp.path());
    let state = state_with_active_project(temp.path());
    let wire_request: ProcessingRequest =
        serde_json::from_value(serde_json::to_value(request(temp.path())).unwrap()).unwrap();
    assert!(
        crate::processing::runs::reserve_request_impl(
            &state,
            wire_request,
            crate::processing::ProcessingAdmission {
                project_root: stale.path().into()
            }
        )
        .is_err()
    );
    assert!(
        !temp
            .path()
            .join("derivatives/ExploreASL_GUI/processing/current.json")
            .exists()
    );
}

#[test]
fn settled_move_keeps_direct_replay_across_directory_instances() {
    let workspace = tempfile::tempdir().unwrap();
    let original = workspace.path().join("original");
    fs::create_dir(&original).unwrap();
    project(&original);
    let request = request(&original);
    let current = admit(&original, request.clone()).unwrap();
    let mut terminal = current.clone();
    terminal.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
    persist(&terminal, Some(&current)).unwrap();
    acknowledge(&original, terminal.run_id, terminal.revision).unwrap();
    let settled = workspace.path().join("settled");
    fs::rename(&original, &settled).unwrap();
    assert_eq!(
        lookup_request(&settled, request.request_id)
            .unwrap()
            .unwrap()
            .run_id,
        terminal.run_id
    );

    let copied = workspace.path().join("copied");
    fs::create_dir_all(copied.join("derivatives/ExploreASL_GUI/processing/history/requests"))
        .unwrap();
    fs::copy(settled.join("project.easl"), copied.join("project.easl")).unwrap();
    fs::copy(
        settled.join(format!(
            "derivatives/ExploreASL_GUI/processing/history/requests/{}.json",
            request.request_id
        )),
        copied.join(format!(
            "derivatives/ExploreASL_GUI/processing/history/requests/{}.json",
            request.request_id
        )),
    )
    .unwrap();
    assert!(
        lookup_request(&copied, request.request_id).is_ok(),
        "settled replay follows stable project identity across directory instances"
    );
    let locator = format!(
        "derivatives/ExploreASL_GUI/processing/history/runs/{}.json",
        terminal.run_id
    );
    fs::create_dir_all(copied.join(&locator).parent().unwrap()).unwrap();
    fs::copy(settled.join(&locator), copied.join(&locator)).unwrap();
    acknowledge(&copied, terminal.run_id, terminal.revision).unwrap();
    admit(&copied, self::request(&copied)).unwrap();
}

#[test]
fn compaction_retries_every_published_boundary_and_releases_current() {
    for fault in [
        "beforeCurrentRemoval",
        "beforeAcknowledge",
        "afterAcknowledge",
        "beforeRequestBinding",
        "afterRequestBinding",
        "beforeRunLocator",
        "afterRunLocator",
        "afterCurrentUnlink",
        "afterCurrentRemoval",
    ] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let terminal = terminal(temp.path(), request(temp.path()));
        crate::processing::journal::inject_fault(fault);
        assert!(
            acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err(),
            "{fault} must interrupt"
        );
        acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
        assert!(
            !temp.path().join(CURRENT_RECORD).exists(),
            "{fault} stranded full record"
        );
        let next = admit(temp.path(), request(temp.path())).unwrap();
        acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
        assert_eq!(records(temp.path()).unwrap()[0].run_id, next.run_id);
    }
}

#[test]
fn assembled_configuration_uses_executor_root_without_mutating_reserved_configuration() {
    use crate::execution::profile::ExecutionProfile;

    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let input = request(temp.path());
    let matlab = input.execution_profile.clone();
    let apptainer = ExecutionProfile::Apptainer {
        id: "container".into(),
        label: "Apptainer".into(),
        sif_path: "unused.sif".into(),
        apptainer_path: "unused".into(),
        explore_asl_version: None,
    };
    let host_root = temp.path().to_str().unwrap();
    for (source, profile, expected) in [
        ("bids", matlab.clone(), Some(host_root)),
        ("bids", apptainer.clone(), Some("/data")),
        ("dicom", matlab, None),
        ("dicom", apptainer, None),
    ] {
        let mut record = ProcessingRecord::new(
            temp.path(),
            input.clone(),
            expected_targets(&input, &[]).unwrap(),
        )
        .unwrap();
        record.data_source = source.into();
        record.request.execution_profile = profile;
        for stale in [false, true] {
            // Admission strips opts; also exercise assembly's stale-field replacement/removal.
            if stale {
                record.request.data_par["x"]["opts"] =
                    serde_json::json!({"subjectFolder": "/stale/project"});
            }
            let reserved = record.request.data_par.clone();
            let digest = request_digest(&record.request).unwrap();
            let assembled = record.assembled_configuration().unwrap();
            assert_eq!(
                assembled["x"]["opts"].get("subjectFolder"),
                expected.map(serde_json::Value::from).as_ref(),
                "source={source}, profile={}, stale={stale}",
                record.request.execution_profile.id(),
            );
            assert_eq!(record.request.data_par, reserved);
            assert_eq!(request_digest(&record.request).unwrap(), digest);
            assert_eq!(record.project_root, temp.path());
            assert_eq!(record.request.project_root, temp.path());
        }
    }
}

#[test]
fn native_destinations_are_canonical_before_storage_and_replay() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let mut input = request(temp.path());
    input.data_par["x"]["opts"] = serde_json::json!({"subjectFolder": temp.path()});
    input.data_par["x"]["WMHsegmAlg"] = serde_json::json!("LGA");
    input.data_par["x"]["dataset"] =
        serde_json::json!({"subjectRegexp":"renderer", "ForceInclusionList":["ignored"]});
    let first = admit(temp.path(), input.clone()).unwrap();
    assert_eq!(
        first.assembled_configuration().unwrap()["x"]["WMHsegmAlg"],
        "LGA"
    );
    assert!(
        !fs::read_to_string(temp.path().join(CURRENT_RECORD))
            .unwrap()
            .contains(&temp.path().display().to_string())
    );
    input.data_par["x"].as_object_mut().unwrap().remove("opts");
    input.data_par["x"]
        .as_object_mut()
        .unwrap()
        .remove("dataset");
    assert_eq!(
        admit(temp.path(), input.clone()).unwrap().run_id,
        first.run_id
    );
    assert_eq!(
        request_digest(&input).unwrap(),
        request_digest(&first.request).unwrap()
    );
}

#[test]
fn actual_project_identity_is_checked_before_public_current_and_historical_replay() {
    for historical in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let state = state_with_active_project(temp.path());
        let input = request(temp.path());
        let terminal = terminal(temp.path(), input.clone());
        if historical {
            acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
        }
        fs::write(
            temp.path().join("project.easl"),
            br#"{"projectMeta":{"id":"other-project","dataSource":"bids"}}"#,
        )
        .unwrap();
        assert!(
            crate::processing::runs::reserve_request_impl(
                &state,
                input,
                ProcessingAdmission {
                    project_root: temp.path().into()
                }
            )
            .is_err(),
            "historical={historical}"
        );
        assert!(acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err());
    }
}

#[test]
fn rolled_back_journal_compacts_then_allows_replacement() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let current = admit(temp.path(), request(temp.path())).unwrap();
    let mut transaction = crate::processing::transaction::LaunchTransaction::plan(
        temp.path(),
        &current.run_id.to_string(),
        &[false, false, true],
        "",
        false,
    )
    .unwrap();
    transaction.prepare(b"new").unwrap();
    transaction.rollback().unwrap();
    let mut terminal = current.clone();
    terminal.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
    persist(&terminal, Some(&current)).unwrap();
    acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
    admit(temp.path(), request(temp.path())).unwrap();
}

#[test]
fn missing_manifest_with_unknown_residue_blocks_new_admission() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let residue = temp.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/runs/{}/backups/0",
        Uuid::new_v4()
    ));
    fs::create_dir_all(residue.parent().unwrap()).unwrap();
    fs::write(&residue, b"unknown").unwrap();
    assert!(admit(temp.path(), request(temp.path())).is_err());
    assert_eq!(fs::read(residue).unwrap(), b"unknown");
}

#[test]
fn terminal_summary_bounds_actual_json_bytes_before_acknowledgement() {
    let cases = [
        (
            "legacy",
            "legacy-project-id".into(),
            "\u{0001}".repeat(4000),
        ),
        (
            "oversized-ascii",
            "p".repeat(4097),
            "diagnostic".repeat(4000),
        ),
        (
            "escaped-id",
            "\u{0001}".repeat(1024),
            "解析に失敗しました 🧠".repeat(4000),
        ),
        (
            "boundary-ascii",
            "p".repeat(4096),
            "diagnostic".repeat(4000),
        ),
        ("unicode-id", "研究計画 🧠".repeat(1024), "🦀".repeat(4000)),
    ];
    let mut failures = Vec::new();
    for (case, project_id, text) in cases {
        let temp = tempfile::tempdir().unwrap();
        let write_project = |id: &str| {
            fs::write(
                temp.path().join("project.easl"),
                serde_json::to_vec(
                    &serde_json::json!({"projectMeta":{"id":id,"dataSource":"bids"}}),
                )
                .unwrap(),
            )
            .unwrap();
        };
        write_project(&project_id);
        let mut input = request(temp.path());
        input.project_id = project_id.clone();
        if let crate::execution::profile::ExecutionProfile::Matlab { id, .. } =
            &mut input.execution_profile
        {
            *id = text.clone();
        }
        let current = admit(temp.path(), input).unwrap();
        let mut terminal = current.clone();
        terminal.error = Some(ProcessingError {
            code: text.clone(),
            message: text,
        });
        terminal.set_lifecycle(ProcessingLifecycle::Failed).unwrap();
        persist(&terminal, Some(&current)).unwrap();
        let replay = match acknowledge(temp.path(), terminal.run_id, terminal.revision) {
            Ok(replay) => replay,
            Err(error) => {
                failures.push(format!("{case}: {error}"));
                continue;
            }
        };
        assert!(serde_json::to_vec(&replay).unwrap().len() <= 4096, "{case}");
        assert!(!temp.path().join(CURRENT_RECORD).exists());
        assert_eq!(
            lookup_request(temp.path(), current.request.request_id)
                .unwrap()
                .unwrap(),
            replay
        );
        assert_eq!(
            acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap(),
            replay
        );
        let locator = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/history/runs/{}.json",
            terminal.run_id
        ));
        assert!(fs::metadata(locator).unwrap().len() <= 4096, "{case}");
        // Compare the complete identity; equal prefixes cannot authorize replay.
        write_project(&format!("{project_id}x"));
        assert!(
            lookup_request(temp.path(), current.request.request_id).is_err(),
            "{case}"
        );
        assert!(
            acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err(),
            "{case}"
        );
        write_project(&project_id);
        let mut replacement = request(temp.path());
        replacement.project_id = project_id;
        admit(temp.path(), replacement).unwrap();
    }
    assert!(
        failures.is_empty(),
        "admitted requests must compact: {failures:?}"
    );
}

#[test]
fn uncertain_initial_reservation_requires_durability_repair_before_replay() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let input = request(temp.path());
    crate::processing::journal::inject_fault("afterRecordReplace");
    assert!(admit(temp.path(), input.clone()).is_err());
    assert!(temp.path().join(CURRENT_RECORD).exists());
    crate::processing::journal::inject_fault("beforeAuthoritySync");
    assert!(
        admit(temp.path(), input.clone()).is_err(),
        "visible record must not imply durability"
    );
    crate::processing::journal::inject_fault("");
    admit(temp.path(), input).unwrap();
}

#[test]
fn visible_compaction_and_removal_require_durability_repair() {
    for fault in [
        "afterRequestBinding",
        "afterRunLocator",
        "afterCurrentUnlink",
    ] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let terminal = terminal(temp.path(), request(temp.path()));
        let repair_path = match fault {
            "afterRequestBinding" => format!(
                "derivatives/ExploreASL_GUI/processing/history/requests/{}.json",
                terminal.request.request_id
            ),
            "afterRunLocator" => format!(
                "derivatives/ExploreASL_GUI/processing/history/runs/{}.json",
                terminal.run_id
            ),
            _ => CURRENT_RECORD.into(),
        };
        let publish_fault = if fault == "afterCurrentUnlink" {
            fault.to_string()
        } else {
            format!("afterRecordReplace:{repair_path}")
        };
        crate::processing::journal::inject_fault(&publish_fault);
        let error = acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap_err();
        assert!(
            error.to_string().contains("durability uncertain"),
            "{error:#}"
        );
        crate::processing::journal::inject_fault(&format!("beforeAuthoritySync:{repair_path}"));
        assert!(
            acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err(),
            "{fault} repair must fail closed"
        );
        crate::processing::journal::inject_fault("");
        acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
        admit(temp.path(), request(temp.path())).unwrap();
    }
}

#[test]
fn copied_unresolved_current_refuses_replay_and_replacement() {
    let original = tempfile::tempdir().unwrap();
    let copied = tempfile::tempdir().unwrap();
    project(original.path());
    project(copied.path());
    let input = request(original.path());
    admit(original.path(), input.clone()).unwrap();
    let path = copied.path().join(CURRENT_RECORD);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::copy(original.path().join(CURRENT_RECORD), &path).unwrap();
    let before = fs::read(&path).unwrap();
    let mut relocated = input;
    relocated.project_root = copied.path().into();
    assert!(admit(copied.path(), relocated).is_err());
    assert!(admit(copied.path(), request(copied.path())).is_err());
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn compact_schema_rejects_identity_revision_and_outcome_corruption() {
    for field in [
        "version",
        "projectIdDigest",
        "runId",
        "terminalRevision",
        "outcome",
        "requestDigest",
        "workerCount",
    ] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let terminal = terminal(temp.path(), request(temp.path()));
        acknowledge(temp.path(), terminal.run_id, terminal.revision).unwrap();
        let path = temp.path().join(format!(
            "derivatives/ExploreASL_GUI/processing/history/requests/{}.json",
            terminal.request.request_id
        ));
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match field {
            "version" => value[field] = 99.into(),
            "projectIdDigest" => value[field] = "0".repeat(64).into(),
            "runId" => value[field] = Uuid::nil().to_string().into(),
            "terminalRevision" => value[field] = 0.into(),
            "outcome" => value[field] = "completed".into(),
            "workerCount" => value["summary"][field] = 0.into(),
            _ => value[field] = "bad-digest".into(),
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(
            lookup_request(temp.path(), terminal.request.request_id).is_err(),
            "{field}"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn durable_processing_terminal_survives_shutdown_and_blocks_setup_import_until_exact_ack() {
    use tauri::Manager;
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let app = tauri::test::mock_builder()
        .manage(crate::app::state::AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = app.state::<crate::app::state::AppState>();
    crate::project::ownership::own_project(&state, temp.path());
    let terminal = terminal(temp.path(), request(temp.path()));
    state.processing_state.lock().unwrap().current_run =
        Some(ProcessingRun::from_record(terminal.clone()));
    assert!(crate::project::lifecycle::shutdown_project_runtime_impl(&state).success);
    assert!(
        crate::processing::runs::get_active_run_impl(&state)
            .unwrap()
            .is_some()
    );
    assert!(crate::project::ownership::for_setup(&state, temp.path()).is_err());
    let error = crate::import::reserve_import_run(
        app.state(),
        vec!["subject".into()],
        "plan".into(),
        "profile".into(),
        None,
        false,
    )
    .unwrap_err();
    assert!(crate::project::ownership::ensure_processing_released(&state).is_err());
    assert_eq!(error.message, "Import could not be prepared.");
    assert!(error.details.is_empty());
    assert!(
        crate::processing::acknowledge_processing_run(
            app.state(),
            terminal.run_id,
            terminal.revision + 1
        )
        .is_err()
    );
    assert!(crate::project::ownership::for_setup(&state, temp.path()).is_err());
    crate::processing::acknowledge_processing_run(app.state(), terminal.run_id, terminal.revision)
        .unwrap();
    assert!(crate::project::ownership::for_setup(&state, temp.path()).is_ok());
    assert!(crate::project::ownership::ensure_processing_released(&state).is_ok());
    // Once processing releases authority, import reaches its own plan validation.
    let error = crate::import::reserve_import_run(
        app.state(),
        vec!["subject".into()],
        "plan".into(),
        "profile".into(),
        None,
        false,
    )
    .unwrap_err();
    assert_eq!(error.message, "Import could not be prepared.");
    assert!(error.details.is_empty());
}

#[test]
fn same_request_reservation_finishes_interrupted_acknowledgement() {
    for fault in ["afterAcknowledge", "beforeCurrentRemoval"] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let state = state_with_active_project(temp.path());
        let mut sparse = request(temp.path());
        sparse.data_par = serde_json::json!({"x": {}});
        let terminal = terminal(temp.path(), sparse);
        state.processing_state.lock().unwrap().current_run =
            Some(ProcessingRun::from_record(terminal.clone()));
        crate::processing::journal::inject_fault(fault);
        assert!(acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err());
        let replay = crate::processing::runs::reserve_request_impl(
            &state,
            terminal.request.clone(),
            ProcessingAdmission {
                project_root: temp.path().into(),
            },
        )
        .unwrap();
        assert!(
            matches!(replay, ProcessingReservation::Historical { .. }),
            "{fault}"
        );
        assert!(!temp.path().join(CURRENT_RECORD).exists());
        crate::processing::runs::reserve_request_impl(
            &state,
            request(temp.path()),
            ProcessingAdmission {
                project_root: temp.path().into(),
            },
        )
        .unwrap();
    }
}

#[test]
fn interrupted_initial_reservation_retries_one_fixed_record_without_launch_effects() {
    for fault in [
        "beforeRecordWrite",
        "afterRecordReplace",
        "afterRecordWrite",
    ] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let input = request(temp.path());
        crate::processing::journal::inject_fault(fault);
        assert!(admit(temp.path(), input.clone()).is_err(), "{fault}");
        assert!(
            !temp
                .path()
                .join("derivatives/ExploreASL_GUI/processing/runs")
                .exists()
        );
        assert!(
            !temp
                .path()
                .join("derivatives/ExploreASL_GUI/execution/latest-attempt.json")
                .exists()
        );
        let retained = records(temp.path()).unwrap().pop();
        let reserved = admit(temp.path(), input).unwrap();
        if let Some(retained) = retained {
            assert_eq!(reserved.run_id, retained.run_id);
        }
        assert_eq!(records(temp.path()).unwrap().len(), 1);
    }
}

#[test]
fn replacement_admission_reconciles_already_acknowledged_current() {
    for fault in [
        "afterAcknowledge",
        "beforeCurrentRemoval",
        "afterCurrentUnlink",
    ] {
        let temp = tempfile::tempdir().unwrap();
        project(temp.path());
        let state = state_with_active_project(temp.path());
        let terminal = terminal(temp.path(), request(temp.path()));
        state.processing_state.lock().unwrap().current_run =
            Some(ProcessingRun::from_record(terminal.clone()));
        crate::processing::journal::inject_fault(fault);
        assert!(acknowledge(temp.path(), terminal.run_id, terminal.revision).is_err());
        let reply = crate::processing::runs::reserve_request_impl(
            &state,
            request(temp.path()),
            ProcessingAdmission {
                project_root: temp.path().into(),
            },
        )
        .unwrap();
        let ProcessingReservation::Current { snapshot } = reply else {
            panic!("new reservation expected")
        };
        assert_ne!(snapshot.run_id, terminal.run_id.to_string());
        assert_eq!(
            records(temp.path()).unwrap()[0].run_id.to_string(),
            snapshot.run_id
        );
    }
}
