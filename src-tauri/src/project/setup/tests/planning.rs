use std::fs::{self, File};
use tempfile::TempDir;

use super::super::filesystem::MAX_TEXT_BYTES;
use super::super::planning::preflight;
use super::super::{
    IgnorePlan, OperationKind, RAWDATA_MARKER_BYTES, RAWDATA_MARKER_PATH, SetupMode, SetupPlans,
    commit_for_state, plan_bidsignore, preflight_for_state, verify,
};
use super::common::{project, source_snapshot};
use crate::project::validation::{parse_summary, validate_canonical_project_v1};

#[test]
fn snapshots_prove_detection_and_all_preflight_paths_are_read_only() {
    let root = TempDir::new().unwrap();
    fs::create_dir_all(root.path().join("sub-01/perf")).unwrap();
    fs::write(root.path().join("sub-01/perf/sub-01_asl.nii.gz"), b"nii").unwrap();
    fs::write(root.path().join("sub-01/perf/sub-01_asl.json"), b"{}").unwrap();
    fs::write(
        root.path().join("sub-01/perf/sub-01_aslcontext.tsv"),
        b"volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
    let before = source_snapshot(root.path());
    crate::bids::commands::check_bids_dataset_impl(root.path()).unwrap();
    let bids = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let dicom = preflight(root.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
    assert_ne!(bids.displayed.plan_id, dicom.displayed.plan_id);
    assert!(preflight(root.path(), SetupMode::Bids, Some(b"not-json".to_vec())).is_err());
    // Dropping an uncommitted plan is cancellation; it must not need cleanup.
    drop((bids, dicom));
    assert_eq!(source_snapshot(root.path()), before);
}

#[test]
fn planning_accepts_the_canonical_schema_v1_envelope_only() {
    let summary = parse_summary(&project("bids")).unwrap();
    assert_eq!(summary.schema_version, "1");
    assert!(
        parse_summary(
            br#"{"version":"0.1.0","projectMeta":{"id":"id","name":"name","dataSource":"bids"}}"#
        )
        .is_err()
    );
}

#[test]
fn canonical_project_validation_rejects_untrusted_shape_and_path_payloads() {
    let valid: serde_json::Value = serde_json::from_slice(&project("bids")).unwrap();
    assert!(validate_canonical_project_v1(&valid).is_ok());
    let mut processing_settings = valid.clone();
    processing_settings["dataPar"] = serde_json::json!({
        "bPVCGaussianMM": 1,
        "ExternalQuantificationSmoothGaussianMM": [5.5, 5, 1.5],
        "bMasking": [0, 0, 0, 0]
    });
    assert!(validate_canonical_project_v1(&processing_settings).is_ok());
    processing_settings["dataPar"]["bPVCGaussianMM"] = serde_json::json!(2);
    assert!(validate_canonical_project_v1(&processing_settings).is_err());
    for mutation in [
        ("schemaVersion", serde_json::json!(2)),
        ("uiState", serde_json::json!([])),
        (
            "mappingState",
            serde_json::json!({"sourceDataPath":"../escape"}),
        ),
        ("dataPar", serde_json::json!([])),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut invalid = valid.clone();
        invalid
            .as_object_mut()
            .unwrap()
            .insert(mutation.0.into(), mutation.1);
        assert!(
            validate_canonical_project_v1(&invalid).is_err(),
            "{}",
            mutation.0
        );
    }
    let mut invalid = valid;
    invalid["projectMeta"]["currentPhase"] = serde_json::json!("other");
    assert!(validate_canonical_project_v1(&invalid).is_err());
}

#[test]
fn canonical_project_bytes_reject_noncanonical_encoding_and_schema_refinements() {
    let valid = project("bids");
    assert!(parse_summary(&valid).is_ok());
    assert!(parse_summary(format!("{}\n", String::from_utf8_lossy(&valid)).as_bytes()).is_err());
    assert!(parse_summary(
            br#"{"schemaVersion":1,"projectMeta":{"id":"11111111-1111-4111-8111-111111111111","name":"name","createdAt":"2026-01-01T00:00:00.000Z","lastOpened":"2026-01-01T00:00:00.000Z","currentPhase":"import","dataSource":"bids"},"uiState":{},"mappingState":{},"dataPar":{}}"#
        ).is_err());

    // ProjectMetaSchema accepts legacy non-UUID project identifiers and
    // arbitrary timestamp strings; the native boundary must not reject a
    // project that the persisted frontend schema accepts.
    let mut legacy: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    legacy["projectMeta"]["id"] = serde_json::json!("legacy-project-id");
    legacy["projectMeta"]["createdAt"] = serde_json::json!("legacy date");
    legacy["projectMeta"]["lastOpened"] = serde_json::json!("another legacy date");
    let legacy = serde_json::to_string_pretty(&legacy).unwrap();
    assert!(parse_summary(legacy.as_bytes()).is_ok());

    let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    invalid["dataPar"]["ApplyQuantification"] = serde_json::json!([0, 0, 0]);
    let invalid = serde_json::to_string_pretty(&invalid).unwrap();
    assert!(parse_summary(invalid.as_bytes()).is_err());

    let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    invalid["mappingState"]["sourceDataPath"] = serde_json::json!("../outside");
    let invalid = serde_json::to_string_pretty(&invalid).unwrap();
    assert!(parse_summary(invalid.as_bytes()).is_err());

    let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    invalid["uiState"]["datapar"] = serde_json::json!("not-an-object");
    let invalid = serde_json::to_string_pretty(&invalid).unwrap();
    assert!(parse_summary(invalid.as_bytes()).is_err());

    let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    invalid["uiState"]["dataVis"] = serde_json::json!({"pointSize":"large"});
    let invalid = serde_json::to_string_pretty(&invalid).unwrap();
    assert!(parse_summary(invalid.as_bytes()).is_err());
}

#[test]
fn ignore_bytes_cover_newline_edges() {
    assert_eq!(
        plan_bidsignore(None, SetupMode::Bids).unwrap().bytes,
        b"project.easl\n.easl_staging\nrawdata/\n"
    );
    assert_eq!(
        plan_bidsignore(Some(b"derivatives/"), SetupMode::Bids)
            .unwrap()
            .bytes,
        b"derivatives/\nproject.easl\n.easl_staging\nrawdata/\n"
    );
    assert_eq!(
        plan_bidsignore(Some(b"derivatives/\r"), SetupMode::Bids)
            .unwrap()
            .bytes,
        b"derivatives/\r\nproject.easl\n.easl_staging\nrawdata/\n"
    );
    assert_eq!(
        plan_bidsignore(Some(b"derivatives/\r\nproject.easl\r\n"), SetupMode::Bids)
            .unwrap()
            .bytes,
        b"derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );
    let exact = b" project.easl \r\n.easl_staging\nrawdata/\nrawdata/\n";
    assert_eq!(
        plan_bidsignore(Some(exact), SetupMode::Bids).unwrap(),
        IgnorePlan {
            operation: OperationKind::NoOp,
            bytes: exact.to_vec()
        }
    );
    assert!(plan_bidsignore(Some(b"\xff"), SetupMode::Bids).is_err());
}

#[test]
fn inspection_and_planning_are_read_only() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("rawdata")).unwrap();
    fs::write(temp.path().join("rawdata/README.md"), b"user").unwrap();
    fs::create_dir(temp.path().join("rawdata/sub-01")).unwrap();
    let before = fs::read(temp.path().join("rawdata/README.md")).unwrap();
    let plan = preflight(temp.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    assert!(plan.displayed.conflicts.is_empty());
    assert!(plan.displayed.warnings[0].contains("1 sub-*"));
    assert_eq!(
        fs::read(temp.path().join("rawdata/README.md")).unwrap(),
        before
    );
    assert!(!temp.path().join(RAWDATA_MARKER_PATH).exists());
}

#[test]
fn repair_preflight_excludes_project_and_preserves_legacy_entries_without_writes() {
    for marker in [
        None,
        Some(RAWDATA_MARKER_BYTES),
        Some(b"foreign".as_slice()),
    ] {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("project.easl"), project("bids")).unwrap();
        fs::create_dir(root.path().join("rawdata")).unwrap();
        fs::write(root.path().join("rawdata/README.md"), b"user readme").unwrap();
        fs::create_dir(root.path().join("rawdata/sub-existing")).unwrap();
        fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
        if let Some(bytes) = marker {
            fs::write(root.path().join(RAWDATA_MARKER_PATH), bytes).unwrap();
        }
        let before = source_snapshot(root.path());
        let plan = preflight(root.path(), SetupMode::Repair, None).unwrap();
        assert!(
            plan.displayed
                .operations
                .iter()
                .all(|operation| operation.path != "project.easl")
        );
        assert!(plan.displayed.preserves_readme);
        assert!(
            plan.displayed
                .warnings
                .iter()
                .any(|warning| warning.contains("sub-*"))
        );
        if marker == Some(b"foreign".as_slice()) {
            assert!(!plan.displayed.conflicts.is_empty());
        }
        assert_eq!(source_snapshot(root.path()), before);
    }

    let missing = TempDir::new().unwrap();
    fs::write(missing.path().join("project.easl"), project("bids")).unwrap();
    let plan = preflight(missing.path(), SetupMode::Repair, None).unwrap();
    assert!(
        plan.displayed
            .operations
            .iter()
            .any(|operation| operation.path == "rawdata/"
                && operation.operation == OperationKind::Create)
    );
    assert!(
        plan.displayed
            .operations
            .iter()
            .any(|operation| operation.path == RAWDATA_MARKER_PATH)
    );
}

#[test]
fn repair_requires_an_existing_bids_project_and_revalidates_its_identity() {
    let root = TempDir::new().unwrap();
    let before = source_snapshot(root.path());
    assert!(preflight(root.path(), SetupMode::Repair, None).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::write(root.path().join("project.easl"), project("dicom")).unwrap();
    let before = source_snapshot(root.path());
    assert!(preflight(root.path(), SetupMode::Repair, None).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::write(root.path().join("project.easl"), project("bids")).unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Repair,
        None,
    )
    .unwrap();
    fs::write(root.path().join("project.easl"), project("dicom")).unwrap();
    let before_commit = source_snapshot(root.path());
    assert!(commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before_commit);
}

#[test]
fn verification_is_read_only_and_rejects_missing_altered_and_wrong_type_setup() {
    let root = TempDir::new().unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::create_dir(root.path().join("rawdata")).unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::write(root.path().join(RAWDATA_MARKER_PATH), b"altered").unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::remove_file(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    fs::create_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);
}

#[cfg(unix)]
#[test]
fn verification_rejects_symlinked_marker_without_following_it() {
    use std::os::unix::fs::symlink;
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    let external = outside.path().join("marker");
    fs::write(&external, RAWDATA_MARKER_BYTES).unwrap();
    symlink(&external, root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);
    assert_eq!(fs::read(external).unwrap(), RAWDATA_MARKER_BYTES);
}

#[test]
fn marker_conflicts_and_dicom_omits_compatibility() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("rawdata")).unwrap();
    fs::write(temp.path().join(RAWDATA_MARKER_PATH), b"foreign").unwrap();
    assert!(
        !preflight(temp.path(), SetupMode::Bids, Some(project("bids")))
            .unwrap()
            .displayed
            .conflicts
            .is_empty()
    );
    let other = TempDir::new().unwrap();
    let plan = preflight(other.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
    assert!(
        plan.displayed
            .operations
            .iter()
            .all(|op| !op.path.starts_with("rawdata"))
    );
}

#[test]
fn plan_serialization_is_display_only_and_complete_for_both_modes() {
    let root = TempDir::new().unwrap();
    let bids = preflight(root.path(), SetupMode::Bids, Some(project("bids")))
        .unwrap()
        .displayed;
    let json = serde_json::to_value(&bids).unwrap();
    assert_eq!(json["mode"], "bids");
    assert!(json["planId"].as_str().unwrap().starts_with("setup-"));
    assert_eq!(
        json["rootPath"],
        root.path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );
    assert_eq!(
        json["projectSummary"]["contentHash"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    assert!(
        json["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|op| op["path"] == RAWDATA_MARKER_PATH
                && op["textPreview"].as_str()
                    == Some("{\"kind\":\"bids-direct-rawdata\",\"version\":1}\n"))
    );
    assert_eq!(json["preservesReadme"], true);
    assert!(!json["temporaryArtifacts"].as_array().unwrap().is_empty());
    let dicom = preflight(root.path(), SetupMode::Dicom, Some(project("dicom")))
        .unwrap()
        .displayed;
    assert!(
        dicom
            .operations
            .iter()
            .all(|operation| !operation.path.starts_with("rawdata"))
    );
}

#[test]
fn unsafe_ignore_inputs_are_conflicts_without_writes() {
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join(".bidsignore")).unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    assert!(!plan.displayed.conflicts.is_empty());
    assert!(root.path().join(".bidsignore").is_dir());

    let large = TempDir::new().unwrap();
    File::create(large.path().join(".bidsignore"))
        .unwrap()
        .set_len(MAX_TEXT_BYTES + 1)
        .unwrap();
    let plan = preflight(large.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    assert!(
        plan.displayed
            .conflicts
            .iter()
            .any(|conflict| conflict.contains("inspection limit"))
    );
}

#[cfg(unix)]
#[test]
fn symlinked_control_paths_are_conflicts() {
    use std::os::unix::fs::symlink;
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("ignore"), b"outside").unwrap();
    symlink(
        outside.path().join("ignore"),
        root.path().join(".bidsignore"),
    )
    .unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    assert!(!plan.displayed.conflicts.is_empty());
    assert_eq!(fs::read(outside.path().join("ignore")).unwrap(), b"outside");
}
