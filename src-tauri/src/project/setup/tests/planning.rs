use std::fs::{self, File};
use tempfile::TempDir;

use super::super::filesystem::MAX_TEXT_BYTES;
use super::super::planning::preflight;
use super::super::{
    IgnorePlan, OperationKind, SetupMode, SetupPlans, commit_for_state, plan_bidsignore,
    preflight_for_state, verify,
};
use super::common::{project, source_snapshot};
use crate::project::validation::{ProjectParseError, parse_document, parse_summary};

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
fn planning_accepts_the_current_schema_envelope_only() {
    let summary = parse_summary(&project("bids")).unwrap();
    assert_eq!(summary.schema_version, "2");
    assert!(
        parse_summary(
            br#"{"version":"0.1.0","projectMeta":{"id":"id","name":"name","dataSource":"bids"}}"#
        )
        .is_err()
    );
    for envelope in [
        serde_json::json!({"schemaVersion": 1}),
        serde_json::json!({"schemaVersion": 3}),
    ] {
        assert!(matches!(
            parse_document(&serde_json::to_vec(&envelope).unwrap()),
            Err(ProjectParseError::Unsupported { .. })
        ));
    }
    assert!(matches!(
        parse_document(br#"{"schemaVersion":"2"}"#),
        Err(ProjectParseError::Malformed { .. })
    ));
    for malformed in [b"{".as_slice(), br#"{"schemaVersion":2}"#, b"{}"] {
        assert!(matches!(
            parse_document(malformed),
            Err(ProjectParseError::Malformed { .. })
        ));
    }
}

#[test]
fn canonical_project_validation_rejects_untrusted_shape_and_path_payloads() {
    let valid: serde_json::Value = serde_json::from_slice(&project("bids")).unwrap();
    assert!(parse_document(&serde_json::to_vec(&valid).unwrap()).is_ok());
    let mut processing_settings = valid.clone();
    processing_settings["dataPar"] = serde_json::json!({
        "bPVCGaussianMM": 1,
        "ExternalQuantificationSmoothGaussianMM": [5.5, 5, 1.5],
        "bMasking": [0, 0, 0, 0]
    });
    assert!(parse_document(&serde_json::to_vec(&processing_settings).unwrap()).is_ok());
    processing_settings["dataPar"]["bPVCGaussianMM"] = serde_json::json!(2);
    assert!(parse_document(&serde_json::to_vec(&processing_settings).unwrap()).is_err());
    for mode in [
        serde_json::json!("separate_scan"),
        serde_json::json!("UseControlAsM0"),
        serde_json::json!("Absent"),
        serde_json::json!(0.0),
    ] {
        processing_settings["dataPar"]["bPVCGaussianMM"] = serde_json::json!(0);
        processing_settings["dataPar"]["M0"] = mode.clone();
        let parsed = parse_document(&serde_json::to_vec(&processing_settings).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(parsed.data_par).unwrap()["M0"], mode);
    }
    for mutation in [
        ("schemaVersion", serde_json::json!(1)),
        ("uiState", serde_json::json!([])),
        (
            "mappingState",
            serde_json::json!({"sourceDataPath":"../escape"}),
        ),
        (
            "mappingState",
            serde_json::json!({"metadataGroups":[{"id":"g","label":"Group","bidsParams":{"ASLContext":"other"}}]}),
        ),
        ("dataPar", serde_json::json!([])),
        (
            "dataPar",
            serde_json::json!({"ApplyQuantification":[1,0,-0.1,0,1,0]}),
        ),
        (
            "dataPar",
            serde_json::json!({"ApplyQuantification":[1,0,1.1,0,1,0]}),
        ),
        ("dataPar", serde_json::json!({"TissueThreshold":[-0.1]})),
        ("dataPar", serde_json::json!({"TissueThreshold":[1.1]})),
        ("dataPar", serde_json::json!({"M0":"InvalidValue"})),
        ("dataPar", serde_json::json!({"PVCNativeSpaceKernel":[5,5]})),
        ("dataPar", serde_json::json!({"bPVCGaussianMM":true})),
        (
            "mappingState",
            serde_json::json!({"rawPaths":["subject/../../outside"]}),
        ),
        (
            "uiState",
            serde_json::json!({"dataVis":{"qcbfSource":{"relativePath":"../outside.tsv","fileHash":"hash"}},"manifest":valid["uiState"]["manifest"]}),
        ),
        ("uiState", serde_json::json!({})),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut invalid = valid.clone();
        invalid
            .as_object_mut()
            .unwrap()
            .insert(mutation.0.into(), mutation.1);
        assert!(
            parse_document(&serde_json::to_vec(&invalid).unwrap()).is_err(),
            "{}",
            mutation.0
        );
    }
    let mut invalid = valid;
    invalid["projectMeta"]["currentPhase"] = serde_json::json!("other");
    let error = parse_document(&serde_json::to_vec(&invalid).unwrap()).unwrap_err();
    assert!(error.to_string().contains("projectMeta.currentPhase"));
    for (metadata, accepted) in [
        (serde_json::json!({"PostLabelingDelay":1800}), false),
        (serde_json::json!({"PostLabelingDelay":[1.8,0.005]}), false),
        (
            serde_json::json!({"PostLabelingDelay":[0,0.01,10],"M0_GMScaleFactor":1,"BackgroundSuppression":true}),
            true,
        ),
        (serde_json::json!({"M0_GMScaleFactor":0}), false),
        (
            serde_json::json!({"BackgroundSuppression":true,"BackgroundSuppressionNumberPulses":0}),
            false,
        ),
        (
            serde_json::json!({"BackgroundSuppression":false,"BackgroundSuppressionNumberPulses":0}),
            true,
        ),
        (
            serde_json::json!({"PostLabelingDelay":0.01,"BackgroundSuppression":true,"BackgroundSuppressionNumberPulses":2}),
            true,
        ),
    ] {
        let mut document: serde_json::Value = serde_json::from_slice(&project("bids")).unwrap();
        document["mappingState"]["metadataGroups"] =
            serde_json::json!([{"id":"g","label":"Group","bidsParams":metadata}]);
        assert_eq!(
            parse_document(&serde_json::to_vec(&document).unwrap()).is_ok(),
            accepted,
            "{metadata}"
        );
    }
}

#[test]
fn current_manifest_checks_registered_identity_unicode_and_fail_reason() {
    let mut current: serde_json::Value = serde_json::from_slice(&project("bids")).unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    current["uiState"]["manifest"]["reviewers"][0]["label"] = serde_json::json!("界".repeat(100));
    current["uiState"]["manifest"]["verdicts"][id] =
        serde_json::json!({"sub-01_01": {"status": "pass", "notes": "界".repeat(500), "setAt": 1}});
    assert!(parse_document(&serde_json::to_vec(&current).unwrap()).is_ok());
    let mut oversized_label = current["uiState"]["manifest"]["reviewers"].clone();
    oversized_label[0]["label"] = serde_json::json!("界".repeat(101));
    for (field, value) in [
        ("reviewers", oversized_label),
        (
            "verdicts",
            serde_json::json!({id:{"sub-01_01":{"status":"pass","notes":"界".repeat(501),"setAt":1}}}),
        ),
        (
            "activeReviewerId",
            serde_json::json!("22222222-2222-4222-8222-222222222222"),
        ),
        (
            "verdicts",
            serde_json::json!({"22222222-2222-4222-8222-222222222222": {}}),
        ),
        (
            "verdicts",
            serde_json::json!({id: {"sub-01_01": {"status": "fail", "setAt": 1}}}),
        ),
    ] {
        let mut invalid = current.clone();
        invalid["uiState"]["manifest"][field] = value;
        assert!(
            parse_document(&serde_json::to_vec(&invalid).unwrap()).is_err(),
            "{field}"
        );
    }
}

#[test]
fn current_project_bytes_accept_json_formatting_and_reject_invalid_known_fields() {
    let valid = project("bids");
    assert!(parse_summary(&valid).is_ok());
    let mut encoded: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    encoded["uiState"]["import"] = serde_json::json!({"mostRecentConfig":"encoded snapshot"});
    assert!(
        parse_document(&serde_json::to_vec(&encoded).unwrap())
            .unwrap_err()
            .to_string()
            .contains("uiState.import.mostRecentConfig")
    );
    let with_newline = format!("{}\n", String::from_utf8_lossy(&valid));
    assert!(parse_summary(with_newline.as_bytes()).is_ok());
    assert_ne!(
        parse_summary(&valid).unwrap().content_hash,
        parse_summary(with_newline.as_bytes()).unwrap().content_hash
    );
    let mut snapshot: serde_json::Value =
        serde_json::from_slice(&super::common::project("bids")).unwrap();
    let baseline = serde_json::json!({"sourceDataPath":"../outside","pathPatterns":[],"tokenizerConfigs":{},"bMatchDirectories":true,"modalityAliases":[],"sessionAliases":[],"runAliases":[],"subjectRenames":[],"metadataGroups":[],"subjectRows":[]});
    snapshot["uiState"]["import"] = serde_json::json!({"mostRecentConfig":baseline});
    assert!(
        parse_document(&serde_json::to_vec(&snapshot).unwrap())
            .unwrap_err()
            .to_string()
            .contains("uiState.import.mostRecentConfig.sourceDataPath")
    );

    // Project metadata strings have no reviewer-specific UUID/UTC constraint.
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
    assert_eq!(plan.displayed.operations[0].path, "rawdata/");
    assert_eq!(plan.displayed.operations[0].operation, OperationKind::NoOp);
    assert_eq!(
        fs::read(temp.path().join("rawdata/README.md")).unwrap(),
        before
    );
}

#[test]
fn repair_preflight_excludes_project_and_preserves_legacy_entries_without_writes() {
    let root = TempDir::new().unwrap();
    fs::write(root.path().join("project.easl"), project("bids")).unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"user readme").unwrap();
    fs::create_dir(root.path().join("rawdata/sub-existing")).unwrap();
    fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
    let before = source_snapshot(root.path());
    let plan = preflight(root.path(), SetupMode::Repair, None).unwrap();
    assert!(
        plan.displayed
            .operations
            .iter()
            .all(|operation| operation.path != "project.easl")
    );
    assert!(plan.displayed.conflicts.is_empty());
    assert!(plan.displayed.preserves_readme);
    assert!(
        plan.displayed
            .warnings
            .iter()
            .any(|warning| warning.contains("sub-*"))
    );
    assert_eq!(source_snapshot(root.path()), before);

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
    assert!(commit_for_state(&plans, &plan.plan_id).is_err());
    assert_eq!(source_snapshot(root.path()), before_commit);
}

#[test]
fn verification_is_read_only_and_requires_a_rawdata_directory() {
    let root = TempDir::new().unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::write(root.path().join("rawdata"), b"user file").unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);

    fs::remove_file(root.path().join("rawdata")).unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    let before = source_snapshot(root.path());
    verify(root.path()).unwrap();
    assert_eq!(source_snapshot(root.path()), before);
}

#[cfg(unix)]
#[test]
fn verification_rejects_symlinked_rawdata_without_following_it() {
    use std::os::unix::fs::symlink;
    let root = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("README.md"), b"outside").unwrap();
    symlink(outside.path(), root.path().join("rawdata")).unwrap();
    let before = source_snapshot(root.path());
    assert!(verify(root.path()).is_err());
    assert_eq!(source_snapshot(root.path()), before);
    assert_eq!(
        fs::read(outside.path().join("README.md")).unwrap(),
        b"outside"
    );
}

#[test]
fn rawdata_file_conflicts_and_dicom_omits_compatibility() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("rawdata"), b"user file").unwrap();
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
fn plan_serialization_is_display_only_and_ordered_for_all_modes() {
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
            .any(|op| op["path"] == ".bidsignore"
                && op["textPreview"].as_str() == Some("project.easl\n.easl_staging\nrawdata/\n"))
    );
    assert_eq!(
        bids.operations
            .iter()
            .map(|op| op.path.as_str())
            .collect::<Vec<_>>(),
        ["rawdata/", ".bidsignore", "project.easl"]
    );
    assert_eq!(json["preservesReadme"], true);
    assert!(!json["temporaryArtifacts"].as_array().unwrap().is_empty());
    let dicom = preflight(root.path(), SetupMode::Dicom, Some(project("dicom")))
        .unwrap()
        .displayed;
    assert_eq!(
        dicom
            .operations
            .iter()
            .map(|op| op.path.as_str())
            .collect::<Vec<_>>(),
        [".bidsignore", "project.easl"]
    );
    fs::write(root.path().join("project.easl"), project("bids")).unwrap();
    let repair = preflight(root.path(), SetupMode::Repair, None)
        .unwrap()
        .displayed;
    assert_eq!(
        repair
            .operations
            .iter()
            .map(|op| op.path.as_str())
            .collect::<Vec<_>>(),
        ["rawdata/", ".bidsignore"]
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
