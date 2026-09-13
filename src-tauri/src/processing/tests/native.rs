use crate::{
    app_state::AppState,
    execution_profile::ExecutionProfile,
    processing::{record::*, types::*},
};
use std::{
    fs,
    time::{Duration, Instant},
};
use tauri::Manager;

#[cfg(unix)]
fn fixture(
    script: &str,
    source: &str,
    workers: u32,
) -> (
    tempfile::TempDir,
    tauri::App<tauri::test::MockRuntime>,
    String,
) {
    fixture_with_profile(script, source, workers, |_, _| {})
}

#[cfg(unix)]
fn fixture_with_profile(
    script: &str,
    source: &str,
    workers: u32,
    configure: impl FnOnce(&std::path::Path, &mut ExecutionProfile),
) -> (
    tempfile::TempDir,
    tauri::App<tauri::test::MockRuntime>,
    String,
) {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::write(
        root.join("project.easl"),
        serde_json::to_vec(
            &serde_json::json!({"projectMeta":{"id":"native-processing","dataSource":source}}),
        )
        .unwrap(),
    )
    .unwrap();
    fs::create_dir_all(root.join("installation")).unwrap();
    fs::write(root.join("installation/ExploreASL.m"), "% fixture").unwrap();
    fs::write(root.join("installation/VERSION_1.2.3"), "").unwrap();
    let matlab = root.join("matlab");
    fs::write(&matlab, format!("#!/bin/sh\ncase \"$*\" in *'disp(version)'*) printf R2025b; exit 0;; esac\ncd '{}'\n{}\n", root.display(), script)).unwrap();
    fs::set_permissions(&matlab, fs::Permissions::from_mode(0o700)).unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = app.state::<AppState>();
    crate::project_ownership_tests::own_project(&state, root);
    let mut request = ProcessingRequest {
        request_id: uuid::Uuid::new_v4(),
        project_id: "native-processing".into(),
        project_root: root.into(),
        selected_modules: vec!["population".into()],
        selected_subject_sessions: vec![],
        execution_profile: ExecutionProfile::Matlab {
            id: "profile".into(),
            label: "fixture".into(),
            matlab_path: matlab.display().to_string(),
            explore_asl_path: root.join("installation").display().to_string(),
            explore_asl_version: Some("renderer-stale-version".into()),
        },
        data_par: serde_json::json!({"x":{"settings":{}}}),
        participants: ParticipantInputs::default(),
        workers,
        rerun_bids2legacy: false,
    };
    configure(root, &mut request.execution_profile);
    let result = crate::processing::runs::reserve_request_impl(
        &state,
        request,
        ProcessingAdmission {
            project_root: root.into(),
        },
    )
    .unwrap();
    let ProcessingReservation::Current { snapshot } = result else {
        panic!("expected current")
    };
    (temp, app, snapshot.run_id)
}

const READY: &str = "mkdir -p derivatives/ExploreASL/lock/xASL_module_Population/xASL_module_Population\nprintf ready > derivatives/ExploreASL/lock/xASL_module_Population/xASL_module_Population/999_ready.status";

#[cfg(unix)]
#[test]
fn acknowledgement_refuses_live_run_promptly_then_cancel_preserves_committed_output() {
    let (root, app, run_id) = fixture(
        &format!("{READY}\nprintf started > started\nsleep 30"),
        "dicom",
        1,
    );
    crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !root.path().join("started").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let handle = app.handle().clone();
    let id = run_id.parse().unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    let ack = std::thread::spawn(move || {
        let result = crate::processing::acknowledge_processing_run(handle.state(), id, 1);
        send.send(result).unwrap();
    });
    let immediate = receive.recv_timeout(Duration::from_millis(200));
    let result =
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id.clone())
            .unwrap();
    ack.join().unwrap();
    assert!(
        immediate.is_ok_and(|result| result.is_err()),
        "acknowledgement waited on live scientific worker"
    );
    assert_eq!(result.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(result.execution_committed);
    assert!(
        root.path()
            .join("derivatives/ExploreASL/dataPar.json")
            .is_file()
    );
    assert!(root.path().join("derivatives/ExploreASL/lock/xASL_module_Population/xASL_module_Population/999_ready.status").is_file());
    assert!(
        app.state::<AppState>()
            .processing_state
            .lock()
            .unwrap()
            .watcher_handle
            .is_none()
    );
}

#[cfg(unix)]
fn terminal(app: &tauri::App<tauri::test::MockRuntime>, run_id: &str) -> ProcessingRunSnapshot {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let snapshot =
            crate::processing::runs::attach_run_impl(&app.state::<AppState>(), run_id).unwrap();
        if snapshot.lifecycle.is_terminal() {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "native owner failed to terminalize: {snapshot:?}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(unix)]
#[test]
fn native_completion_audits_targets_without_renderer_and_keeps_nonzero_failure() {
    for (script, expected) in [
        (READY.to_string(), ProcessingLifecycle::Completed),
        ("exit 0".into(), ProcessingLifecycle::Failed),
        (format!("{READY}\nexit 7"), ProcessingLifecycle::Failed),
        (
            format!(
                "{READY}\ntouch -t 200001010000 derivatives/ExploreASL/lock/xASL_module_Population/xASL_module_Population/999_ready.status"
            ),
            ProcessingLifecycle::Failed,
        ),
    ] {
        let (root, app, run_id) = fixture(&script, "dicom", 1);
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
        let result = terminal(&app, &run_id);
        assert_eq!(result.lifecycle, expected);
        assert_eq!(result.logical_exits.len(), 1);
        assert_eq!(
            result
                .terminal_summary
                .as_ref()
                .unwrap()
                .explore_asl_version
                .as_deref(),
            Some("1.2.3")
        );
        let persisted = records(root.path()).unwrap().pop().unwrap();
        assert_eq!(
            persisted.snapshot().terminal_revision,
            result.terminal_revision
        );
    }
}

#[cfg(unix)]
#[test]
fn bids_verification_fails_before_configuration_and_historical_status_mutation() {
    let (root, app, run_id) = fixture(READY, "bids", 1);
    let path = root.path().join("derivatives/ExploreASL");
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("dataPar.json"), "prior").unwrap();
    let _ = crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone());
    let result = terminal(&app, &run_id);
    assert_eq!(result.lifecycle, ProcessingLifecycle::Failed);
    assert_eq!(result.error.as_ref().unwrap().code, "bidsCompatibility");
    assert_eq!(fs::read(path.join("dataPar.json")).unwrap(), b"prior");
    assert!(!result.terminal_summary.unwrap().execution_committed);
}

#[cfg(unix)]
#[test]
fn first_and_partial_spawn_failure_keep_commit_and_settle_owned_workers() {
    for workers in [1, 2] {
        let script = format!(
            "{READY}\nrm ./matlab\nprintf partial > derivatives/ExploreASL/result.nii\nsleep 30"
        );
        let (root, app, run_id) = fixture(&script, "dicom", workers);
        if workers == 1 {
            let executable = root.path().join("matlab");
            let script = fs::read_to_string(&executable)
                .unwrap()
                .replace("printf R2025b; exit 0", "rm \"$0\"; printf R2025b; exit 0");
            fs::write(executable, script).unwrap();
        }
        let derivative = root.path().join("derivatives/ExploreASL");
        fs::create_dir_all(&derivative).unwrap();
        fs::write(derivative.join("dataPar.json"), "prior configuration").unwrap();
        let ready =
            derivative.join("lock/xASL_module_Population/xASL_module_Population/999_ready.status");
        fs::create_dir_all(ready.parent().unwrap()).unwrap();
        fs::write(&ready, "historical").unwrap();
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
        let result = terminal(&app, &run_id);
        assert_eq!(result.lifecycle, ProcessingLifecycle::Failed);
        assert!(result.execution_committed);
        assert_ne!(
            fs::read(derivative.join("dataPar.json")).unwrap(),
            b"prior configuration"
        );
        if workers == 1 {
            assert!(!ready.exists());
        } else {
            assert_eq!(fs::read(derivative.join("result.nii")).unwrap(), b"partial");
            assert_eq!(fs::read(&ready).unwrap(), b"ready");
        }
        let state = app.state::<AppState>();
        assert!(
            state
                .processing_state
                .lock()
                .unwrap()
                .cancellation
                .is_none()
        );
        assert!(
            state
                .processing_state
                .lock()
                .unwrap()
                .watcher_handle
                .is_none()
        );
    }
}

#[cfg(unix)]
#[test]
fn cancellation_before_launch_is_durable_and_has_no_scientific_effect() {
    let (root, app, run_id) = fixture(READY, "dicom", 1);
    let cancelled =
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id.clone())
            .unwrap();
    assert_eq!(cancelled.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(!cancelled.execution_committed);
    assert_eq!(
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id).unwrap(),
        cancelled
    );
    assert!(
        !root
            .path()
            .join("derivatives/ExploreASL/dataPar.json")
            .exists()
    );
    assert!(
        records(root.path())
            .unwrap()
            .pop()
            .unwrap()
            .cancellation_requested
    );
}

#[test]
fn acknowledgement_cleans_committed_archive_and_keeps_terminal_on_cleanup_failure() {
    let (root, app, run_id) = fixture(READY, "dicom", 1);
    let derivative = root.path().join("derivatives/ExploreASL");
    fs::create_dir_all(&derivative).unwrap();
    fs::write(derivative.join("dataPar.json"), "prior").unwrap();
    crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
    let result = terminal(&app, &run_id);
    crate::processing::pipeline::reap_supervisor(&app.state::<AppState>()).unwrap();
    let backup = root.path().join(format!(
        "derivatives/ExploreASL_GUI/processing/runs/{run_id}/backups/0"
    ));
    assert!(backup.is_file());
    fs::write(&backup, "foreign replacement").unwrap();
    assert!(
        crate::processing::acknowledge_processing_run(
            app.state(),
            run_id.parse().unwrap(),
            result.terminal_revision.unwrap()
        )
        .is_err(),
        "archive cleanup must precede acknowledgement"
    );
    assert_eq!(
        crate::processing::runs::attach_run_impl(&app.state::<AppState>(), &run_id).unwrap(),
        result
    );
    fs::write(&backup, "prior").unwrap();
    let replay = crate::processing::acknowledge_processing_run(
        app.state(),
        run_id.parse().unwrap(),
        result.terminal_revision.unwrap(),
    )
    .unwrap();
    assert!(replay.acknowledged);
    assert!(
        !backup.exists(),
        "acknowledged settled archive remained pinned"
    );
}

#[cfg(unix)]
#[test]
fn native_participant_reads_preserve_bids_roots_and_skip_dicom_root_inputs() {
    for source in ["bids", "dicom"] {
        let (root, app, run_id) = fixture(READY, source, 1);
        let root_json = root.path().join("participants.json");
        let private = root.path().join("private.json");
        fs::write(&private, b"private-root-json").unwrap();
        std::os::unix::fs::symlink(&private, &root_json).unwrap();
        let root_tsv = root.path().join("participants.tsv");
        if source == "bids" {
            fs::create_dir(root.path().join("rawdata")).unwrap();
            fs::write(
                root.path().join(crate::bids::setup::RAWDATA_MARKER_PATH),
                crate::bids::setup::RAWDATA_MARKER_BYTES,
            )
            .unwrap();
            fs::create_dir_all(root.path().join("sub-01/perf")).unwrap();
            fs::write(root.path().join("sub-01/perf/sub-01_asl.nii"), b"fixture").unwrap();
            fs::write(
                &root_tsv,
                b"participant_id\tsite\tAge\nsub-01\tCenter A\t42\n",
            )
            .unwrap();
        } else {
            std::os::unix::fs::symlink(&private, &root_tsv).unwrap();
        }
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
        assert_eq!(
            terminal(&app, &run_id).lifecycle,
            ProcessingLifecycle::Completed
        );
        assert_eq!(fs::read(&private).unwrap(), b"private-root-json");
        assert!(
            fs::symlink_metadata(&root_json)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        if source == "bids" {
            assert_eq!(
                fs::read(&root_tsv).unwrap(),
                b"participant_id\tsite\tAge\nsub-01\tCenter A\t42\n"
            );
            assert_eq!(
                fs::read_to_string(root.path().join("derivatives/ExploreASL/participants.tsv"))
                    .unwrap(),
                "participant_id\tsession\tsite\tAge\nsub-01_1\tASL_1\tCenter A\t42\n"
            );
        } else {
            assert!(
                !root
                    .path()
                    .join("derivatives/ExploreASL/participants.tsv")
                    .exists()
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn failed_launch_publication_can_settle_exact_reservation_without_restart() {
    for point in ["beforeRecordWrite", "afterRecordReplace"] {
        let (root, app, run_id) = fixture(READY, "dicom", 1);
        crate::processing::journal::inject_fault(point);
        assert!(
            crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone())
                .is_err()
        );
        let result =
            crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id).unwrap();
        assert_eq!(result.lifecycle, ProcessingLifecycle::Cancelled, "{point}");
        assert!(
            !root
                .path()
                .join("derivatives/ExploreASL/dataPar.json")
                .exists()
        );
        assert!(
            records(root.path())
                .unwrap()
                .pop()
                .unwrap()
                .cancellation_requested
        );
    }
}

#[cfg(unix)]
#[test]
fn native_version_capture_prefers_filesystem_metadata_and_falls_back_to_unknown() {
    for fast in [true, false] {
        let (root, app, run_id) = fixture(READY, "dicom", 1);
        let matlab = root.path().join("matlab");
        let script = fs::read_to_string(&matlab)
            .unwrap()
            .replace("printf R2025b; exit 0", "exit 1");
        fs::write(&matlab, script).unwrap();
        if fast {
            fs::write(
                root.path().join("VersionInfo.xml"),
                "<release>R2024a</release>",
            )
            .unwrap();
        } else {
            fs::remove_file(root.path().join("installation/VERSION_1.2.3")).unwrap();
        }
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
        let result = terminal(&app, &run_id);
        assert_eq!(result.lifecycle, ProcessingLifecycle::Completed);
        let versions = result.versions.unwrap();
        assert_eq!(versions.matlab, if fast { "R2024a" } else { "unknown" });
        assert_eq!(versions.explore_asl, if fast { "1.2.3" } else { "unknown" });
    }
}

#[cfg(unix)]
#[test]
fn visible_cancellation_after_publication_error_still_stops_live_worker() {
    let (root, app, run_id) = fixture(
        &format!("{READY}\nprintf started > started\nsleep 30"),
        "dicom",
        1,
    );
    crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !root.path().join("started").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    crate::processing::journal::inject_fault("afterRecordReplace");
    assert!(
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id.clone())
            .is_err()
    );
    let result = terminal(&app, &run_id);
    assert_eq!(result.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(result.execution_committed);
}

#[cfg(unix)]
#[test]
fn padded_matlab_profile_consumes_validated_path_without_changing_request() {
    let script = format!(
        r#"case "$2" in "addpath('$PWD/installation'); ExploreASL("*) ;; *) exit 41;; esac
{READY}"#
    );
    let (root, app, run_id) = fixture_with_profile(&script, "dicom", 1, |_, profile| {
        let ExecutionProfile::Matlab {
            explore_asl_path, ..
        } = profile
        else {
            unreachable!()
        };
        *explore_asl_path = format!("  {explore_asl_path}  ");
    });
    let reserved = records(root.path()).unwrap().pop().unwrap().request;
    crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
    let result = terminal(&app, &run_id);
    assert_eq!(
        result.lifecycle,
        ProcessingLifecycle::Completed,
        "{result:?}"
    );
    assert_eq!(result.versions.unwrap().explore_asl, "1.2.3");
    assert!(
        reserved
            .same_content(&records(root.path()).unwrap().pop().unwrap().request)
            .unwrap()
    );
}

#[cfg(unix)]
#[test]
fn padded_apptainer_profile_consumes_validated_image_for_warmup_and_cached_launch() {
    const CHILD: &str = "EASL_PADDED_PROFILE_CHILD";
    if std::env::var_os(CHILD).is_none() {
        // Isolate MCR cache environment in a child test process; no global env
        // changes or user-cache mutations may race other native tests.
        let root = tempfile::tempdir().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "processing::tests::native::padded_apptainer_profile_consumes_validated_image_for_warmup_and_cached_launch", "--nocapture"])
            .env(CHILD, "1")
            .env("MCR_CACHE_ROOT", root.path().join("cache"))
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let cache = crate::apptainer::mcr_cache_path();
    for cached in [false, true] {
        if cached {
            fs::create_dir_all(&cache).unwrap();
        }
        let version_probe = if cached {
            "exit 42"
        } else {
            "printf 'VERSION_1.2.3\\n'; exit 0"
        };
        let script = format!(
            r#"if [ "$1" = '--version' ]; then printf 'apptainer 1.2'; exit 0; fi
for arg in "$@"; do
    case "$arg" in *image.sif*) [ "$arg" = "$PWD/image.sif" ] || exit 42;; esac
done
case "$*" in
    *'ls /opt/xasl/xASL_latest/'*) count=$(grep -c '^probe$' invocations 2>/dev/null || true); printf 'probe\n' >> invocations; if [ "$count" -gt 0 ]; then {version_probe}; else printf 'VERSION_1.2.3\n'; exit 0; fi;;
esac
if [ "$#" -eq 15 ]; then
    printf 'science\n' >> invocations
    {READY}
else
    printf 'warmup\n' >> invocations
fi"#
        );
        let (root, app, run_id) = fixture_with_profile(&script, "dicom", 1, |root, profile| {
            fs::write(root.join("image.sif"), b"fixture").unwrap();
            *profile = ExecutionProfile::Apptainer {
                id: "profile".into(),
                label: "padded fixture".into(),
                apptainer_path: root.join("matlab").display().to_string(),
                sif_path: format!("  {}  ", root.join("image.sif").display()),
                explore_asl_version: Some("renderer-stale-version".into()),
            };
        });
        let reserved = records(root.path()).unwrap().pop().unwrap().request;
        crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
        let result = terminal(&app, &run_id);
        assert_eq!(
            result.lifecycle,
            ProcessingLifecycle::Completed,
            "cached={cached}: {result:?}"
        );
        assert_eq!(
            result.versions.unwrap().explore_asl,
            if cached { "unknown" } else { "1.2.3" }
        );
        assert_eq!(
            fs::read_to_string(root.path().join("invocations")).unwrap(),
            if cached {
                "probe\nprobe\nscience\n"
            } else {
                "probe\nwarmup\nprobe\nscience\n"
            }
        );
        assert!(
            reserved
                .same_content(&records(root.path()).unwrap().pop().unwrap().request)
                .unwrap()
        );
    }
}

#[cfg(unix)]
#[test]
fn stop_during_processing_warmup_cancels_the_shared_preparation_scope() {
    const CHILD: &str = "EASL_STOP_WARMUP_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let cache = tempfile::tempdir().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "processing::tests::native::stop_during_processing_warmup_cancels_the_shared_preparation_scope", "--nocapture"])
            .env(CHILD, "1")
            .env("MCR_CACHE_ROOT", cache.path().join("cache"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let script = r#"
if [ "$1" = '--version' ]; then printf 'apptainer 1.2'; exit 0; fi
case "$*" in *'ls /opt/xasl/xASL_latest/'*) printf 'VERSION_1.2.3\n'; exit 0;; esac
if [ "$#" -ne 15 ]; then printf warm > warm; sleep 30; fi
"#;
    let (root, app, run_id) = fixture_with_profile(script, "dicom", 1, |root, profile| {
        fs::write(root.join("image.sif"), b"fixture").unwrap();
        *profile = ExecutionProfile::Apptainer {
            id: "profile".into(),
            label: "fixture".into(),
            apptainer_path: root.join("matlab").display().to_string(),
            sif_path: root.join("image.sif").display().to_string(),
            explore_asl_version: None,
        };
    });
    crate::processing::run_pipeline(app.handle().clone(), app.state(), run_id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !root.path().join("warm").exists() {
        assert!(Instant::now() < deadline, "warmup did not start");
        std::thread::sleep(Duration::from_millis(10));
    }
    let start = Instant::now();
    let result =
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id).unwrap();
    assert_eq!(result.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(start.elapsed() < Duration::from_secs(8));
}

#[cfg(unix)]
#[test]
fn shutdown_and_release_retain_real_durable_cleanup_until_exact_retry() {
    let (root, app, run_id) = fixture(READY, "dicom", 1);
    let mut transaction = crate::processing::transaction::LaunchTransaction::plan(
        root.path(),
        &run_id,
        &[false, false, true],
        "",
        false,
    )
    .unwrap();
    transaction.prepare(b"new").unwrap();
    drop(transaction);
    let foreign = root.path().join("derivatives/ExploreASL/lock/foreign.txt");
    fs::write(&foreign, b"preserve").unwrap();
    let state = app.state::<AppState>();
    let pending =
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id.clone())
            .unwrap();
    assert_eq!(pending.available_action, AvailableAction::RetryCleanup);
    assert!(!pending.lifecycle.is_terminal());
    assert!(!crate::project_runtime::shutdown_project_runtime_impl(&state).success);
    assert!(crate::visualization::clear_active_project_impl(&state).is_err());
    assert_eq!(fs::read(&foreign).unwrap(), b"preserve");
    let durable = records(root.path()).unwrap().pop().unwrap();
    assert_eq!(durable.run_id.to_string(), run_id);
    assert_eq!(durable.available_action, AvailableAction::RetryCleanup);
    fs::remove_file(foreign).unwrap();
    let settled =
        crate::processing::kill_pipeline(app.handle().clone(), app.state(), run_id).unwrap();
    assert_eq!(settled.lifecycle, ProcessingLifecycle::Cancelled);
    assert!(
        !root
            .path()
            .join("derivatives/ExploreASL/dataPar.json")
            .exists()
    );
}
