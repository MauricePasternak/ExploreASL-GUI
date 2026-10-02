use super::*;
use tempfile::TempDir;
use walkdir::WalkDir;

#[derive(Debug, PartialEq, Eq)]
struct SourceEntry {
    kind: EntryKind,
    len: u64,
    digest: Option<String>,
}
fn source_snapshot(root: &Path) -> BTreeMap<PathBuf, SourceEntry> {
    WalkDir::new(root)
        .follow_links(false)
        // The selected root itself is not a source-tree entry. Its
        // directory size is filesystem-dependent and would otherwise
        // obscure the reviewed child-path delta.
        .min_depth(1)
        .into_iter()
        .map(|entry| entry.unwrap())
        // OS ownership bootstrap directories are GUI authority, outside
        // reviewed BIDS mutations. Keep every other entry (including unknown
        // GUI files) in the byte inventory.
        .filter(|entry| {
            let relative = entry.path().strip_prefix(root).unwrap();
            !(entry.file_type().is_dir()
                && [
                    "derivatives",
                    "derivatives/ExploreASL_GUI",
                    "derivatives/ExploreASL_GUI/execution",
                ]
                .iter()
                .any(|path| relative == Path::new(path)))
        })
        .map(|entry| {
            let path = entry.path();
            let metadata = fs::symlink_metadata(path).unwrap();
            let kind = if metadata.file_type().is_symlink() {
                EntryKind::Symlink
            } else if metadata.is_dir() {
                EntryKind::Directory
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let digest = metadata.is_file().then(|| hash(&fs::read(path).unwrap()));
            (
                path.strip_prefix(root).unwrap().to_path_buf(),
                SourceEntry {
                    kind,
                    len: metadata.len(),
                    digest,
                },
            )
        })
        .collect()
}
fn changed_source_paths(
    before: &BTreeMap<PathBuf, SourceEntry>,
    after: &BTreeMap<PathBuf, SourceEntry>,
) -> BTreeSet<String> {
    before
        .keys()
        .chain(after.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .collect()
}
fn reviewed_changed_paths(plan: &SetupPlan) -> BTreeSet<String> {
    let mut paths = plan
        .operations
        .iter()
        .filter(|operation| operation.operation != OperationKind::NoOp)
        .map(|operation| operation.path.trim_end_matches('/').to_owned())
        .collect::<BTreeSet<_>>();
    // A reviewed no-op directory changes its metadata when a separately
    // reviewed child marker is installed. It remains an explicitly
    // disclosed operation path, unlike an unrelated parent directory.
    for operation in &plan.operations {
        if operation.path.ends_with('/')
            && paths.iter().any(|path| path.starts_with(&operation.path))
        {
            paths.insert(operation.path.trim_end_matches('/').to_owned());
        }
    }
    paths
}
fn assert_confirmed_delta(root: &Path, before: &BTreeMap<PathBuf, SourceEntry>, plan: &SetupPlan) {
    let after = source_snapshot(root);
    assert_eq!(
        changed_source_paths(before, &after),
        reviewed_changed_paths(plan),
        "only reviewed, confirmed operation paths may differ: {:?}",
        plan.operations
    );
    for operation in &plan.operations {
        if let Some(preview) = &operation.text_preview {
            assert_eq!(
                fs::read(root.join(operation.path.trim_end_matches('/'))).unwrap(),
                preview.as_bytes(),
                "{} must equal its reviewed text preview",
                operation.path
            );
        }
    }
    if let Some(summary) = &plan.project_summary {
        assert_eq!(
            hash(&fs::read(root.join("project.easl")).unwrap()),
            summary.content_hash,
            "project.easl must equal the reviewed project summary hash"
        );
    }
}
fn write_bids_fixture(root: &Path, bidsignore: Option<&[u8]>) {
    fs::write(
        root.join("dataset_description.json"),
        br#"{"Name":"Source snapshot fixture","BIDSVersion":"1.9.0"}"#,
    )
    .unwrap();
    fs::create_dir_all(root.join("sub-01/perf")).unwrap();
    fs::write(root.join("sub-01/perf/sub-01_asl.nii.gz"), b"nii bytes").unwrap();
    fs::write(root.join("sub-01/perf/sub-01_asl.json"), b"{}").unwrap();
    fs::write(
        root.join("sub-01/perf/sub-01_aslcontext.tsv"),
        b"volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    if let Some(bytes) = bidsignore {
        fs::write(root.join(".bidsignore"), bytes).unwrap();
    }
}
fn project(source: &str) -> Vec<u8> {
    serde_json::to_string_pretty(&serde_json::json!({
        "schemaVersion": 1,
        "projectMeta": {
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "name",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "lastOpened": "2026-01-01T00:00:00.000Z",
            "currentPhase": "import",
            "dataSource": source,
        },
        "uiState": {},
        "mappingState": {},
        "dataPar": {},
    }))
    .unwrap()
    .into_bytes()
}
fn identities() -> (String, String, String) {
    (
        random_id("transaction"),
        random_id("journal"),
        random_id("registry"),
    )
}
fn entry_for(
    root: &Path,
    transaction_id: String,
    journal_id: String,
    registry_id: String,
) -> PendingEntry {
    PendingEntry {
        registry_id,
        transaction_id,
        journal_name: journal_name(&journal_id),
        journal_id,
        root: root.canonicalize().unwrap().to_string_lossy().into_owned(),
    }
}
#[test]
fn marker_classification_matrix_preserves_readme_and_confines_fixed_paths() {
    let root = TempDir::new().unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Absent
    );
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"user bytes").unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Absent
    );
    fs::write(root.path().join(RAWDATA_MARKER_PATH), RAWDATA_MARKER_BYTES).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Exact
    );
    fs::write(root.path().join(RAWDATA_MARKER_PATH), b"foreign").unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Foreign
    );
    assert_eq!(
        fs::read(root.path().join("rawdata/README.md")).unwrap(),
        b"user bytes"
    );
    assert!(fixed_path(root.path(), "../rawdata/.easl-gui-managed").is_err());
    assert!(fixed_path(root.path(), "rawdata/README.md").is_err());
}
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
fn source_tree_hash_integration_matrix_covers_review_cancel_stale_failure_and_recovery() {
    // Fresh BIDS-direct: detection, preflight, commit, then read-only
    // compatibility verification. Snapshots retain relative path, entry
    // type, size, and file-content hash for every source-tree entry.
    let fresh = TempDir::new().unwrap();
    let fresh_app_data = TempDir::new().unwrap();
    write_bids_fixture(fresh.path(), None);
    let fresh_before = source_snapshot(fresh.path());
    assert!(
        crate::bids::commands::check_bids_dataset_impl(fresh.path())
            .unwrap()
            .is_bids
    );
    let fresh_plans = SetupPlans::default();
    let fresh_plan = preflight_for_state(
        &fresh_plans,
        fresh.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(
        source_snapshot(fresh.path()),
        fresh_before,
        "preflight is read-only"
    );
    commit_for_state(&fresh_plans, &fresh_plan.plan_id, fresh_app_data.path()).unwrap();
    assert_confirmed_delta(fresh.path(), &fresh_before, &fresh_plan);
    let verified_before = source_snapshot(fresh.path());
    verify(fresh.path()).unwrap();
    assert_eq!(
        source_snapshot(fresh.path()),
        verified_before,
        "verification is read-only"
    );

    // DICOM-on-BIDS retains the BIDS source fixture but commits only its
    // reviewed project and ignore-file operations.
    let dicom = TempDir::new().unwrap();
    let dicom_app_data = TempDir::new().unwrap();
    write_bids_fixture(dicom.path(), None);
    let dicom_before = source_snapshot(dicom.path());
    assert!(
        crate::bids::commands::check_bids_dataset_impl(dicom.path())
            .unwrap()
            .is_bids
    );
    let dicom_plans = SetupPlans::default();
    let dicom_plan = preflight_for_state(
        &dicom_plans,
        dicom.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(dicom.path()), dicom_before);
    commit_for_state(&dicom_plans, &dicom_plan.plan_id, dicom_app_data.path()).unwrap();
    assert_confirmed_delta(dicom.path(), &dicom_before, &dicom_plan);
    assert!(!dicom.path().join("rawdata").exists());

    // Existing rawdata and a user README survive an LF ignore-file update.
    let existing_lf = TempDir::new().unwrap();
    let existing_lf_app_data = TempDir::new().unwrap();
    write_bids_fixture(existing_lf.path(), Some(b"derivatives/\n"));
    fs::create_dir(existing_lf.path().join("rawdata")).unwrap();
    fs::write(
        existing_lf.path().join("rawdata/README.md"),
        b"user README\n",
    )
    .unwrap();
    let existing_lf_before = source_snapshot(existing_lf.path());
    let existing_lf_plans = SetupPlans::default();
    let existing_lf_plan = preflight_for_state(
        &existing_lf_plans,
        existing_lf.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(existing_lf.path()), existing_lf_before);
    commit_for_state(
        &existing_lf_plans,
        &existing_lf_plan.plan_id,
        existing_lf_app_data.path(),
    )
    .unwrap();
    assert_confirmed_delta(existing_lf.path(), &existing_lf_before, &existing_lf_plan);
    assert_eq!(
        fs::read(existing_lf.path().join("rawdata/README.md")).unwrap(),
        b"user README\n"
    );

    // CRLF input keeps CRLF bytes exactly as previewed.
    let crlf = TempDir::new().unwrap();
    let crlf_app_data = TempDir::new().unwrap();
    write_bids_fixture(crlf.path(), Some(b"derivatives/\r\nproject.easl\r\n"));
    let crlf_before = source_snapshot(crlf.path());
    let crlf_plans = SetupPlans::default();
    let crlf_plan = preflight_for_state(
        &crlf_plans,
        crlf.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(crlf.path()), crlf_before);
    commit_for_state(&crlf_plans, &crlf_plan.plan_id, crlf_app_data.path()).unwrap();
    assert_confirmed_delta(crlf.path(), &crlf_before, &crlf_plan);
    assert!(
        fs::read(crlf.path().join(".bidsignore"))
            .unwrap()
            .windows(2)
            .any(|bytes| bytes == b"\r\n")
    );

    // Scan, mode changes, malformed-project preflight, and cancellation
    // (dropping plans without confirmation) never mutate the source tree.
    let cancelled = TempDir::new().unwrap();
    write_bids_fixture(cancelled.path(), Some(b"user\n"));
    let cancelled_before = source_snapshot(cancelled.path());
    crate::bids::commands::check_bids_dataset_impl(cancelled.path()).unwrap();
    let cancelled_bids =
        preflight(cancelled.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let cancelled_dicom =
        preflight(cancelled.path(), SetupMode::Dicom, Some(project("dicom"))).unwrap();
    assert!(
        preflight(
            cancelled.path(),
            SetupMode::Bids,
            Some(b"not-json".to_vec())
        )
        .is_err()
    );
    drop((cancelled_bids, cancelled_dicom));
    assert_eq!(
        source_snapshot(cancelled.path()),
        cancelled_before,
        "cancel is read-only"
    );

    // A stale plan rejects before mutation. The external edit is the
    // baseline; the rejected confirmation itself has a zero tree delta.
    let stale = TempDir::new().unwrap();
    let stale_app_data = TempDir::new().unwrap();
    write_bids_fixture(stale.path(), None);
    let stale_plans = SetupPlans::default();
    let stale_plan = preflight_for_state(
        &stale_plans,
        stale.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(stale.path().join(".bidsignore"), b"external change\n").unwrap();
    let stale_before_commit = source_snapshot(stale.path());
    assert!(commit_for_state(&stale_plans, &stale_plan.plan_id, stale_app_data.path()).is_err());
    assert_eq!(
        source_snapshot(stale.path()),
        stale_before_commit,
        "stale commit is read-only"
    );

    // Ordinary commit failure rolls back every owned path to the exact
    // source snapshot, including LF/CRLF-sensitive file bytes.
    let failed = TempDir::new().unwrap();
    let failed_app_data = TempDir::new().unwrap();
    write_bids_fixture(failed.path(), Some(b"before\r\n"));
    let failed_before = source_snapshot(failed.path());
    let failed_plans = SetupPlans::default();
    let failed_plan = preflight_for_state(
        &failed_plans,
        failed.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    {
        let _fault = inject_setup_fault(SetupFault::RootFlush);
        assert!(
            commit_for_state(&failed_plans, &failed_plan.plan_id, failed_app_data.path()).is_err()
        );
    }
    assert_eq!(
        source_snapshot(failed.path()),
        failed_before,
        "failed commit rolls back"
    );

    // An interruption after durable commit but before terminal cleanup
    // leaves its journal. Recovery removes that evidence and settles on
    // exactly the reviewed after-state.
    let interrupted = TempDir::new().unwrap();
    let interrupted_app_data = TempDir::new().unwrap();
    write_bids_fixture(interrupted.path(), None);
    let interrupted_before = source_snapshot(interrupted.path());
    let interrupted_plans = SetupPlans::default();
    let interrupted_plan = preflight_for_state(
        &interrupted_plans,
        interrupted.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    {
        let _fault = inject_setup_fault(SetupFault::Cleanup);
        assert_eq!(
            commit_for_state(
                &interrupted_plans,
                &interrupted_plan.plan_id,
                interrupted_app_data.path(),
            )
            .unwrap()
            .outcome,
            "committed"
        );
    }
    assert!(
        changed_source_paths(&interrupted_before, &source_snapshot(interrupted.path()))
            .iter()
            .any(|path| path.starts_with(JOURNAL_PREFIX))
    );
    assert_eq!(
        recover_all(interrupted_app_data.path()).unwrap().recovered,
        1
    );
    assert_confirmed_delta(interrupted.path(), &interrupted_before, &interrupted_plan);
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
fn repair_transaction_changes_only_reviewed_compatibility_paths() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let original_project = project("bids");
    fs::write(root.path().join("project.easl"), &original_project).unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"keep exactly").unwrap();
    fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Repair,
        None,
    )
    .unwrap();
    let reviewed_paths = plan
        .operations
        .iter()
        .filter(|operation| operation.operation != OperationKind::NoOp)
        .map(|operation| operation.path.as_str())
        .collect::<Vec<_>>();
    let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
    assert_eq!(result.project_path, None);
    assert_eq!(result.canonical_project_bytes, None);
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        original_project
    );
    assert_eq!(
        fs::read(root.path().join("rawdata/README.md")).unwrap(),
        b"keep exactly"
    );
    assert_eq!(
        fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        fs::read(root.path().join(".bidsignore")).unwrap(),
        b"derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );
    assert_eq!(reviewed_paths, vec![".bidsignore", RAWDATA_MARKER_PATH]);
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
#[cfg(unix)]
#[test]
fn marker_wrong_type_and_symlink_are_never_followed() {
    use std::os::unix::fs::symlink;
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::create_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Unsafe
    );
    fs::remove_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    let outside = TempDir::new().unwrap();
    let external = outside.path().join("marker");
    fs::write(&external, RAWDATA_MARKER_BYTES).unwrap();
    symlink(&external, root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Unsafe
    );
    assert_eq!(fs::read(external).unwrap(), RAWDATA_MARKER_BYTES);
}
#[test]
fn transaction_installs_project_last_and_replays_result() {
    let temp = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        temp.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
    assert_eq!(result.outcome, "committed");
    assert_eq!(
        fs::read(temp.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert_eq!(
        fs::read(temp.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap(),
        result
    );
}
#[test]
fn transaction_matrix_preserves_existing_rawdata_and_omits_dicom_compatibility() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"user readme").unwrap();
    fs::write(root.path().join(RAWDATA_MARKER_PATH), RAWDATA_MARKER_BYTES).unwrap();
    fs::write(root.path().join(".bidsignore"), b"user\r\n").unwrap();
    let plans = SetupPlans::default();
    let bids = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    commit_for_state(&plans, &bids.plan_id, app_data.path()).unwrap();
    assert_eq!(
        fs::read(root.path().join("rawdata/README.md")).unwrap(),
        b"user readme"
    );
    assert_eq!(
        fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        fs::read(root.path().join(".bidsignore")).unwrap(),
        b"user\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );

    let dicom_root = TempDir::new().unwrap();
    let dicom_plans = SetupPlans::default();
    let dicom = preflight_for_state(
        &dicom_plans,
        dicom_root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    commit_for_state(&dicom_plans, &dicom.plan_id, app_data.path()).unwrap();
    assert!(!dicom_root.path().join("rawdata").exists());
    assert_eq!(
        fs::read(dicom_root.path().join("project.easl")).unwrap(),
        project("dicom")
    );
}
#[test]
fn stale_plan_has_no_writes() {
    let temp = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        temp.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(temp.path().join(".bidsignore"), b"changed\n").unwrap();
    assert!(commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err());
    assert!(!temp.path().join("project.easl").exists());
}
#[test]
fn plan_admission_rejects_missing_expired_superseded_and_claimed_ids() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    assert!(commit_for_state(&plans, "missing", app_data.path()).is_err());
    let first = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let second = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    assert!(commit_for_state(&plans, &first.plan_id, app_data.path()).is_err());
    {
        let mut cache = plans.0.lock().unwrap();
        let plan = cache.get_mut(&second.plan_id).unwrap();
        plan.created = SystemTime::now() - PLAN_TTL - Duration::from_secs(1);
    }
    assert!(commit_for_state(&plans, &second.plan_id, app_data.path()).is_err());
    let current = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    plans
        .0
        .lock()
        .unwrap()
        .get_mut(&current.plan_id)
        .unwrap()
        .claimed = true;
    assert!(commit_for_state(&plans, &current.plan_id, app_data.path()).is_err());
    assert!(!root.path().join("project.easl").exists());
}
#[test]
fn a_failed_claim_is_terminal_and_cannot_be_retried_with_reviewed_bytes() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(root.path().join(".bidsignore"), b"external change\n").unwrap();
    let first = commit_for_state(&plans, &plan.plan_id, app_data.path())
        .unwrap_err()
        .to_string();
    fs::remove_file(root.path().join(".bidsignore")).unwrap();
    let second = commit_for_state(&plans, &plan.plan_id, app_data.path())
        .unwrap_err()
        .to_string();
    assert_eq!(second, first);
    assert!(!root.path().join("project.easl").exists());
}
#[test]
fn malformed_registry_and_path_escape_fail_closed() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join(REGISTRY_FILE), b"not json").unwrap();
    assert!(recover_all(temp.path()).is_err());
    assert!(safe_relative("../escape").is_err());
    assert!(safe_relative("/escape").is_err());
}
#[test]
fn journal_registry_and_candidate_paths_reject_tampering_and_collisions() {
    let root = TempDir::new().unwrap();
    let destination = root.path().join(".bidsignore");
    let transaction = "transaction-00000000-0000-0000-0000-000000000001";
    let (candidate, fingerprint) =
        create_candidate(root.path(), &destination, transaction, b"exact\n").unwrap();
    assert_eq!(fs::read(root.path().join(&candidate)).unwrap(), b"exact\n");
    assert_eq!(fingerprint.hash.as_deref(), Some(hash(b"exact\n").as_str()));
    assert!(safe_relative(&candidate).is_ok());
    assert!(owned_sibling(&destination, transaction, "candidate", "x").is_err());
    let entry = PendingEntry {
        registry_id: "registry-1".into(),
        transaction_id: transaction.into(),
        journal_id: "journal-1".into(),
        root: root.path().display().to_string(),
        journal_name: "wrong.json".into(),
    };
    assert!(validate_registry_entry(&entry).is_err());
    fs::write(root.path().join(&candidate), b"foreign").unwrap();
    assert!(find_owned_sibling(&destination, transaction, "candidate", &fingerprint).is_err());
}
#[test]
fn replacement_revalidates_before_backup_and_fails_closed_on_swap() {
    let root = TempDir::new().unwrap();
    let target = root.path().join(".bidsignore");
    fs::write(&target, b"before\n").unwrap();
    let observed = inspect(&target, true).unwrap();
    fs::write(&target, b"swapped\n").unwrap();
    assert!(
        backup_for(
            root.path(),
            &target,
            "transaction-00000000-0000-0000-0000-000000000001",
            &observed,
        )
        .is_err()
    );
    assert_eq!(fs::read(target).unwrap(), b"swapped\n");
}
#[test]
fn ordinary_faults_restore_before_state_or_leave_terminal_recovery() {
    for fault in [
        SetupFault::RegistryWrite,
        SetupFault::JournalWrite,
        SetupFault::CandidateCreate,
        SetupFault::CandidateWrite,
        SetupFault::CandidateFlush,
        SetupFault::CandidateVerify,
        SetupFault::RawdataCreate,
        SetupFault::IntentRecord,
        SetupFault::BackupRename,
        SetupFault::Install,
        SetupFault::ParentFlush,
        SetupFault::TerminalRecord,
    ] {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        fs::write(root.path().join(".bidsignore"), b"user-ignore\r\n").unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _guard = inject_setup_fault(fault);
        assert!(
            commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
            "{fault:?}"
        );
        assert_eq!(
            fs::read(root.path().join(".bidsignore")).unwrap(),
            b"user-ignore\r\n",
            "{fault:?}"
        );
        assert!(!root.path().join("project.easl").exists(), "{fault:?}");
        assert!(!root.path().join("rawdata").exists(), "{fault:?}");
    }
}
#[test]
fn every_structured_command_error_category_has_a_stable_wire_kind() {
    let cases = [
        (anyhow!("Setup plan expired"), "stale"),
        (anyhow!("marker must be regular"), "conflict"),
        (anyhow!("changes rolled back"), "rollback"),
        (
            anyhow!("could not synchronize directory"),
            "uncertain_durability",
        ),
        (
            anyhow!("recovery required after ambiguous swap"),
            "recovery_required",
        ),
        (anyhow!("unexpected"), "failed"),
    ];
    for (error, kind) in cases {
        let value = serde_json::to_value(command_error(error)).unwrap();
        assert_eq!(value["kind"], kind);
        assert!(
            value["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
    }
}
#[test]
fn command_errors_distinguish_rollback_from_pending_recovery() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _guard = inject_setup_fault(SetupFault::CandidateCreate);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::Rollback { .. }
    ));
    drop(_guard);

    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _guard = inject_setup_fault(SetupFault::JournalWrite);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::RecoveryRequired { .. }
    ));
}
#[test]
fn terminal_cleanup_is_retried_by_recovery() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _guard = inject_setup_fault(SetupFault::Cleanup);
    assert_eq!(
        commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap()
            .outcome,
        "committed"
    );
    drop(_guard);
    assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
    assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
}
#[test]
fn recovery_rolls_back_each_incomplete_phase_and_defers_unavailable_roots() {
    for phase in [
        TransactionPhase::Planned,
        TransactionPhase::Preparing,
        TransactionPhase::Committing,
        TransactionPhase::RecoveryRequired,
    ] {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let transaction_id = random_id("transaction");
        let journal_id = random_id("journal");
        let registry_id = random_id("registry");
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.phase = phase;
        let entry = PendingEntry {
            registry_id,
            transaction_id,
            journal_id: journal_id.clone(),
            root: root.path().canonicalize().unwrap().display().to_string(),
            journal_name: journal_name(&journal_id),
        };
        register_pending(app_data.path(), entry).unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(
            recover_all(app_data.path()).unwrap().recovered,
            1,
            "{phase:?}"
        );
        assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
        assert!(!journal_path(root.path(), &journal_id).exists());
    }
    let app_data = TempDir::new().unwrap();
    let registry_id = random_id("registry");
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    register_pending(
        app_data.path(),
        PendingEntry {
            registry_id,
            transaction_id,
            journal_id: journal_id.clone(),
            root: app_data
                .path()
                .join("unavailable-root")
                .display()
                .to_string(),
            journal_name: journal_name(&journal_id),
        },
    )
    .unwrap();
    let summary = recover_all(app_data.path()).unwrap();
    assert_eq!(summary.deferred_roots.len(), 1);
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
}
#[test]
fn recovery_blocks_divergent_journals_and_preserves_concurrent_rawdata_entries() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    let registry_id = random_id("registry");
    let mut journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    journal.directory_phase = OperationPhase::Created;
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
    register_pending(
        app_data.path(),
        PendingEntry {
            registry_id: registry_id.clone(),
            transaction_id,
            journal_id: journal_id.clone(),
            root: root.path().canonicalize().unwrap().display().to_string(),
            journal_name: journal_name(&journal_id),
        },
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    let mut foreign = journal.clone();
    foreign.registry_id = "foreign-registry".into();
    fs::write(
        journal_path(root.path(), &journal_id),
        journal_bytes(&foreign).unwrap(),
    )
    .unwrap();
    assert!(recover_root(app_data.path(), root.path()).is_err());
}

#[test]
fn journal_and_registry_schemas_are_versioned_strict_and_cross_bound() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    assert_ne!(transaction_id, journal_id);
    assert_ne!(transaction_id, registry_id);
    assert_ne!(journal_id, registry_id);
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    let entry = entry_for(root.path(), transaction_id, journal_id.clone(), registry_id);

    let registry = PendingRegistry {
        version: REGISTRY_VERSION,
        entries: vec![entry.clone()],
    };
    assert_eq!(
        serde_json::to_value(&journal).unwrap()["version"],
        JOURNAL_VERSION
    );
    assert_eq!(
        serde_json::to_value(&registry).unwrap()["version"],
        REGISTRY_VERSION
    );

    let mut malformed = serde_json::to_value(&registry).unwrap();
    malformed["unexpected"] = serde_json::json!(true);
    fs::write(
        registry_path(app_data.path()),
        serde_json::to_vec(&malformed).unwrap(),
    )
    .unwrap();
    assert!(load_registry(app_data.path()).is_err());

    register_pending(app_data.path(), entry.clone()).unwrap_err();
    fs::remove_file(registry_path(app_data.path())).unwrap();
    register_pending(app_data.path(), entry.clone()).unwrap();
    write_journal(root.path(), &journal).unwrap();

    let mut foreign = journal.clone();
    foreign.registry_id = random_id("registry");
    fs::write(
        journal_path(root.path(), &journal_id),
        journal_bytes(&foreign).unwrap(),
    )
    .unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(load_registry(app_data.path()).unwrap().entries, vec![entry]);
}

#[test]
fn initial_journal_and_registry_claims_never_replace_foreign_files() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    let journal_path = journal_path(root.path(), &journal_id);
    fs::write(&journal_path, b"foreign journal").unwrap();
    assert!(write_journal(root.path(), &journal).is_err());
    assert_eq!(fs::read(&journal_path).unwrap(), b"foreign journal");

    let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
    fs::write(registry_path(app_data.path()), b"foreign registry").unwrap();
    assert!(register_pending(app_data.path(), entry).is_err());
    assert_eq!(
        fs::read(registry_path(app_data.path())).unwrap(),
        b"foreign registry"
    );
}

#[cfg(unix)]
#[test]
fn journal_and_registry_updates_are_same_parent_replacements_not_truncates() {
    use std::os::unix::fs::MetadataExt;

    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    let root_journal = journal_path(root.path(), &journal_id);
    let before_journal_inode = fs::metadata(&root_journal).unwrap().ino();
    journal.phase = TransactionPhase::Preparing;
    write_journal(root.path(), &journal).unwrap();
    assert_ne!(
        before_journal_inode,
        fs::metadata(&root_journal).unwrap().ino()
    );

    let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
    register_pending(app_data.path(), entry.clone()).unwrap();
    let registry = registry_path(app_data.path());
    let before_registry_inode = fs::metadata(&registry).unwrap().ino();
    remove_pending(app_data.path(), &entry.registry_id).unwrap();
    assert_ne!(
        before_registry_inode,
        fs::metadata(&registry).unwrap().ino()
    );
}

#[test]
fn journal_paths_are_relative_owned_siblings_and_reject_escape_or_links() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal =
        initial_journal(&plan, transaction_id.clone(), journal_id, registry_id).unwrap();
    let target = fixed_path(root.path(), ".bidsignore").unwrap();
    let candidate = owned_sibling(&target, &transaction_id, "candidate", "0").unwrap();
    let backup = owned_sibling(&target, &transaction_id, "backup", "1").unwrap();
    journal.operations[1].candidate = Some(relative_to_root(root.path(), &candidate).unwrap());
    journal.operations[1].backup = Some(relative_to_root(root.path(), &backup).unwrap());
    assert!(
        journal.operations[1]
            .candidate
            .as_deref()
            .unwrap()
            .starts_with('.')
    );
    validate_journal(root.path(), &journal).unwrap();
    journal.operations[1].candidate = Some("../outside".into());
    assert!(validate_journal(root.path(), &journal).is_err());

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let (transaction_id, journal_id, registry_id) = identities();
        let clean =
            initial_journal(&plan, transaction_id, journal_id.clone(), registry_id).unwrap();
        let path = journal_path(root.path(), &journal_id);
        symlink(root.path().join("outside"), &path).unwrap();
        assert!(write_journal(root.path(), &clean).is_err());
    }
}

#[test]
fn durable_intents_precede_directory_candidate_backup_and_install_mutations() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(&plan, transaction_id, journal_id, registry_id).unwrap();
    write_journal(root.path(), &journal).unwrap();

    journal.directory_phase = OperationPhase::CreateIntent;
    write_journal(root.path(), &journal).unwrap();
    assert!(!root.path().join("rawdata").exists());
    for (index, phase) in [
        OperationPhase::CandidateIntent,
        OperationPhase::BackupIntent,
        OperationPhase::InstallIntent,
    ]
    .into_iter()
    .enumerate()
    {
        update_operation(root.path(), &mut journal, index, phase).unwrap();
        let persisted = read_journal(root.path(), &journal.journal_id).unwrap();
        assert_eq!(persisted.operations[index].phase, phase);
        assert!(
            inspect(
                &fixed_path(root.path(), &persisted.operations[index].destination).unwrap(),
                true
            )
            .unwrap()
            .kind
                == persisted.operations[index].before.kind
        );
    }
}

#[test]
fn candidates_are_exact_same_parent_create_new_and_backups_validate_fingerprints() {
    let root = TempDir::new().unwrap();
    let transaction = "transaction-00000000-0000-0000-0000-000000000001";
    let destination = root.path().join(".bidsignore");
    let collision = owned_sibling(&destination, transaction, "candidate", "0").unwrap();
    fs::write(&collision, b"foreign").unwrap();
    let (candidate, fingerprint) =
        create_candidate(root.path(), &destination, transaction, b"exact bytes\n").unwrap();
    let candidate_path = root.path().join(&candidate);
    assert_eq!(candidate_path.parent(), destination.parent());
    assert_ne!(candidate_path, collision);
    assert_eq!(fs::read(&candidate_path).unwrap(), b"exact bytes\n");
    assert_eq!(
        fingerprint.hash.as_deref(),
        Some(hash(b"exact bytes\n").as_str())
    );

    fs::write(&destination, b"before\n").unwrap();
    let before = inspect(&destination, true).unwrap();
    let backup_collision = owned_sibling(&destination, transaction, "backup", "0").unwrap();
    fs::write(&backup_collision, b"unowned").unwrap();
    let (backup, backup_fingerprint) =
        backup_for(root.path(), &destination, transaction, &before).unwrap();
    assert_ne!(root.path().join(&backup), backup_collision);
    assert_eq!(backup_fingerprint, before);
    assert_eq!(fs::read(backup_collision).unwrap(), b"unowned");
    fs::write(root.path().join(&backup), b"tampered").unwrap();
    assert_ne!(inspect(&root.path().join(&backup), true).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn directory_flush_reports_supported_on_unix() {
    let root = TempDir::new().unwrap();
    assert!(sync_parent(root.path()).unwrap());
}

#[cfg(not(unix))]
#[test]
fn directory_flush_reports_reduced_durability_when_unsupported() {
    let root = TempDir::new().unwrap();
    assert!(!sync_parent(root.path()).unwrap());
}

#[test]
fn fresh_and_existing_transactions_preserve_exact_bytes_and_project_is_last_visible() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
    assert_eq!(
        take_install_observations(),
        vec![
            (".easl-gui-managed".into(), false),
            (".bidsignore".into(), false),
            ("project.easl".into(), true),
        ]
    );
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert_eq!(
        fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );

    let existing = TempDir::new().unwrap();
    let existing_app_data = TempDir::new().unwrap();
    fs::create_dir(existing.path().join("rawdata")).unwrap();
    fs::write(existing.path().join("rawdata/README.md"), b"keep").unwrap();
    fs::write(
        existing.path().join(RAWDATA_MARKER_PATH),
        RAWDATA_MARKER_BYTES,
    )
    .unwrap();
    fs::write(existing.path().join(".bidsignore"), b"user\r\n").unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        existing.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let first = commit_for_state(&plans, &plan.plan_id, existing_app_data.path()).unwrap();
    let second = commit_for_state(&plans, &plan.plan_id, existing_app_data.path()).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        fs::read(existing.path().join("rawdata/README.md")).unwrap(),
        b"keep"
    );
    assert_eq!(
        fs::read(existing.path().join(".bidsignore")).unwrap(),
        b"user\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );
}

#[test]
fn dicom_transaction_omits_rawdata_and_marker() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
    assert!(!root.path().join("rawdata").exists());
    assert!(!root.path().join(RAWDATA_MARKER_PATH).exists());
}

#[test]
fn every_named_failure_stage_restores_before_state_or_keeps_recovery_evidence() {
    let rollback_faults = [
        SetupFault::RegistryWrite,
        SetupFault::CandidateCreate,
        SetupFault::CandidateWrite,
        SetupFault::CandidateFlush,
        SetupFault::CandidateVerify,
        SetupFault::RawdataCreate,
        SetupFault::IntentRecord,
        SetupFault::RawdataIntent,
        SetupFault::CandidateIntent,
        SetupFault::BackupIntent,
        SetupFault::InstallIntent,
        SetupFault::BackupRename,
        SetupFault::Install,
        SetupFault::MarkerInstall,
        SetupFault::IgnoreInstall,
        SetupFault::ProjectInstall,
        SetupFault::ParentFlush,
        SetupFault::RootFlush,
        SetupFault::TerminalRecord,
    ];
    for fault in rollback_faults {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        fs::write(root.path().join(".bidsignore"), b"before\r\n").unwrap();
        let before = source_snapshot(root.path());
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(fault);
        assert!(
            commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
            "{fault:?}"
        );
        assert_eq!(source_snapshot(root.path()), before, "{fault:?}");
    }

    // A root journal write failure happens after global intent and before
    // the journal exists. It must report recovery-required and preserve
    // discovery evidence rather than guessing that cleanup is safe.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::JournalWrite);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::RecoveryRequired { .. }
    ));
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);

    // Terminal cleanup is deliberately non-destructive to the committed
    // result; its validated retry is covered by recovery.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::Cleanup);
    assert_eq!(
        commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap()
            .outcome,
        "committed"
    );
    assert!(root.path().join("project.easl").exists());
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
}

#[test]
fn recovery_handles_every_phase_finish_forward_and_preserves_ambiguous_intents() {
    for phase in [
        TransactionPhase::Planned,
        TransactionPhase::Preparing,
        TransactionPhase::Committing,
        TransactionPhase::Committed,
        TransactionPhase::RollingBack,
        TransactionPhase::RolledBack,
        TransactionPhase::RecoveryRequired,
    ] {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.phase = phase;
        let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
        register_pending(app_data.path(), entry).unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(
            recover_all(app_data.path()).unwrap().recovered,
            1,
            "{phase:?}"
        );
    }

    // A complete valid after-state is the only incomplete journal state
    // allowed to finish forward.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    for operation in &journal.operations {
        fs::write(
            fixed_path(root.path(), &operation.destination).unwrap(),
            bytes_for(&plan, &operation.destination).unwrap(),
        )
        .unwrap();
    }
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert!(!journal_path(root.path(), &journal_id).exists());

    // Intent-only directory creation cannot establish ownership after a
    // crash. Recovery blocks and leaves both record and user entry intact.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    journal.directory_phase = OperationPhase::CreateIntent;
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    assert!(journal_path(root.path(), &journal_id).exists());
}

#[test]
fn startup_and_targeted_recovery_settle_before_root_use_and_block_malformed_pairs() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_at_startup(app_data.path()).unwrap().recovered, 1);
    assert!(load_registry(app_data.path()).unwrap().entries.is_empty());

    let blocked_root = TempDir::new().unwrap();
    let blocked_app_data = TempDir::new().unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let entry = entry_for(
        blocked_root.path(),
        transaction_id,
        journal_id.clone(),
        registry_id,
    );
    register_pending(blocked_app_data.path(), entry).unwrap();
    fs::write(journal_path(blocked_root.path(), &journal_id), b"malformed").unwrap();
    assert!(recover_root(blocked_app_data.path(), blocked_root.path()).is_err());
    assert_eq!(
        load_registry(blocked_app_data.path())
            .unwrap()
            .entries
            .len(),
        1
    );
}

#[test]
fn commit_contract_returns_only_durable_result_and_structured_failures_without_activation() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let stale = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(root.path().join(".bidsignore"), b"stale").unwrap();
    assert!(matches!(
        command_error(commit_for_state(&plans, &stale.plan_id, app_data.path()).unwrap_err()),
        SetupCommandError::Stale { .. }
    ));
    assert!(!root.path().join("project.easl").exists());

    let conflict_root = TempDir::new().unwrap();
    let conflict_app_data = TempDir::new().unwrap();
    fs::write(conflict_root.path().join("project.easl"), b"user project").unwrap();
    let conflict_plans = SetupPlans::default();
    let conflict = preflight_for_state(
        &conflict_plans,
        conflict_root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert!(matches!(
        command_error(
            commit_for_state(&conflict_plans, &conflict.plan_id, conflict_app_data.path())
                .unwrap_err()
        ),
        SetupCommandError::Conflict { .. }
    ));
    assert_eq!(
        fs::read(conflict_root.path().join("project.easl")).unwrap(),
        b"user project"
    );

    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::RootFlush);
    assert!(matches!(
        command_error(commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err()),
        SetupCommandError::Rollback { .. }
    ));
    assert!(!root.path().join("project.easl").exists());

    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::JournalWrite);
    assert!(matches!(
        command_error(commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err()),
        SetupCommandError::RecoveryRequired { .. }
    ));
    assert!(!root.path().join("project.easl").exists());
    assert!(matches!(
        command_error(anyhow!("could not synchronize directory")),
        SetupCommandError::UncertainDurability { .. }
    ));

    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let result = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap();
    assert_eq!(
        result.project_path.as_deref(),
        root.path().join("project.easl").to_str()
    );
    assert_eq!(
        result.canonical_project_bytes.as_deref(),
        std::str::from_utf8(&project("bids")).ok()
    );
    assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
}

#[test]
fn startup_recovery_preserves_pending_journal_when_processing_evidence_is_malformed() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    let before = fs::read(journal_path(root.path(), &journal_id)).unwrap();
    // Malformed processing evidence must block the earliest setup mutation,
    // even before a project document has been installed or hydrated.
    let processing = root.path().join(crate::processing::record::CURRENT_RECORD);
    fs::create_dir_all(processing.parent().unwrap()).unwrap();
    fs::write(&processing, b"unsupported processing authority").unwrap();
    assert!(recover_at_startup(app_data.path()).is_err());
    assert!(recover_root(app_data.path(), root.path()).is_err());
    assert_eq!(
        fs::read(journal_path(root.path(), &journal_id)).unwrap(),
        before
    );
    assert_eq!(
        fs::read(&processing).unwrap(),
        b"unsupported processing authority"
    );
    fs::remove_file(processing).unwrap();
    assert_eq!(recover_at_startup(app_data.path()).unwrap().recovered, 1);
}
