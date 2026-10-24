use super::*;
use crate::app::state::AppState;
use std::fs;
use tempfile::TempDir;

/// Helper: create a ds000240-like dataset with N subjects, each having ASL + sidecar.
fn create_bids_dataset(root: &Path, n_subjects: usize, include_dataset_desc: bool) {
    if include_dataset_desc {
        fs::write(
            root.join("dataset_description.json"),
            r#"{"Name": "Test", "BIDSVersion": "1.8.0"}"#,
        )
        .unwrap();
    }
    for i in 1..=n_subjects {
        let label = format!("sub-{:02}", i);
        let perf = root.join(&label).join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join(format!("{}_asl.nii.gz", label)), b"fake").unwrap();
        fs::write(perf.join(format!("{}_asl.json", label)), b"{}").unwrap();
        fs::write(
            perf.join(format!("{}_aslcontext.tsv", label)),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
    }
}

// Scenario 1: Valid BIDS dataset with ASL
#[test]
fn check_bids_valid_dataset_with_asl() {
    let tmp = TempDir::new().unwrap();
    create_bids_dataset(tmp.path(), 25, true);

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(result.is_bids);
    assert!(result.has_dataset_description);
    assert_eq!(result.bids_version, Some("1.8.0".to_string()));
    assert_eq!(result.asl_subject_count, 25);
    assert_eq!(result.total_subject_count, 25);
    assert!(result.error.is_none());
    assert!(result.missing_sidecars.is_empty());
}

// Scenario 2: ASL subjects without dataset_description.json
#[test]
fn check_bids_asl_without_dataset_description() {
    let tmp = TempDir::new().unwrap();
    create_bids_dataset(tmp.path(), 10, false);

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(result.is_bids);
    assert!(!result.has_dataset_description);
    assert!(result.bids_version.is_none());
    assert_eq!(result.asl_subject_count, 10);
    assert!(result.error.is_none());
}

// Scenario 3: Corrupt dataset_description.json but ASL present
#[test]
fn check_bids_corrupt_dataset_description() {
    let tmp = TempDir::new().unwrap();
    create_bids_dataset(tmp.path(), 12, false);
    // Write corrupt JSON
    fs::write(
        tmp.path().join("dataset_description.json"),
        r#"{"Name": "Test", "BIDSVersion": }"#,
    )
    .unwrap();

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(result.is_bids);
    assert!(result.has_dataset_description);
    assert!(result.dataset_desc_error.is_some());
    assert_eq!(result.asl_subject_count, 12);
    assert!(result.error.is_none());
}

// Scenario 4: Empty or non-BIDS folder
#[test]
fn check_bids_empty_folder() {
    let tmp = TempDir::new().unwrap();

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(!result.is_bids);
    assert_eq!(result.total_subject_count, 0);
    assert!(result.error.is_some());
}

// Scenario 5: Subjects present but no ASL sidecars
#[test]
fn check_bids_subjects_without_asl() {
    let tmp = TempDir::new().unwrap();
    for i in 1..=5 {
        let label = format!("sub-{:02}", i);
        let anat = tmp.path().join(&label).join("anat");
        fs::create_dir_all(&anat).unwrap();
        fs::write(anat.join(format!("{}_T1w.nii.gz", label)), b"fake").unwrap();
    }

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(!result.is_bids);
    assert_eq!(result.total_subject_count, 5);
    assert_eq!(result.asl_subject_count, 0);
    assert!(result.missing_sidecars.is_empty());
    assert!(!result.has_perf_directory);
    assert_eq!(
        result.error.as_deref(),
        Some("No valid ASL BIDS data found")
    );
}

/// Variant: perf/ dirs exist but no sidecar JSONs → missing_sidecars populated
/// AND has_perf_directory = true (any perf/ found).
#[test]
fn check_bids_perf_present_no_sidecars_has_perf_directory_true() {
    let tmp = TempDir::new().unwrap();
    for i in 1..=5 {
        let label = format!("sub-{:02}", i);
        let perf = tmp.path().join(&label).join("perf");
        fs::create_dir_all(&perf).unwrap();
        // ASL NIfTI present but no matching _asl.json sidecar
        fs::write(perf.join(format!("{}_asl.nii.gz", label)), b"fake").unwrap();
    }

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(!result.is_bids);
    assert_eq!(result.asl_subject_count, 0);
    assert_eq!(result.missing_sidecars.len(), 5);
    // ANY perf/ found → has_perf_directory = true
    assert!(result.has_perf_directory);
    assert_eq!(
        result.error.as_deref(),
        Some("No valid ASL BIDS data found")
    );
}

// Scenario 6: Cross-sectional detection
#[test]
fn check_bids_cross_sectional_detected() {
    let tmp = TempDir::new().unwrap();
    // ds000240 style: no ses-* dirs, subjects have perf/ directly
    create_bids_dataset(tmp.path(), 5, true);

    let result = check_bids_dataset_impl(tmp.path()).unwrap();

    assert!(result.is_bids);
    assert!(result.is_cross_sectional);
}

/// Longitudinal: subject with two explicit sessions → is_cross_sectional = false.
#[test]
fn check_bids_longitudinal_multi_session_subject() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    for ses in ["01", "02"] {
        let perf = root
            .join("sub-01")
            .join(format!("ses-{}", ses))
            .join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join(format!("sub-01_ses-{}_asl.nii.gz", ses)), b"fake").unwrap();
        fs::write(perf.join(format!("sub-01_ses-{}_asl.json", ses)), b"{}").unwrap();
        fs::write(
            perf.join(format!("sub-01_ses-{}_aslcontext.tsv", ses)),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
    }

    let result = check_bids_dataset_impl(root).unwrap();
    assert!(result.is_bids);
    assert!(!result.is_cross_sectional);
}

/// Single explicit session per subject remains cross-sectional.
#[test]
fn check_bids_single_explicit_session_per_subject_is_cross_sectional() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    for i in 1..=5 {
        let label = format!("sub-{:02}", i);
        let perf = root.join(&label).join("ses-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join(format!("{}_ses-01_asl.nii.gz", label)), b"fake").unwrap();
        fs::write(perf.join(format!("{}_ses-01_asl.json", label)), b"{}").unwrap();
        fs::write(
            perf.join(format!("{}_ses-01_aslcontext.tsv", label)),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
    }

    let result = check_bids_dataset_impl(root).unwrap();
    assert!(result.is_bids);
    assert!(result.is_cross_sectional);
}

#[test]
fn check_bids_missing_aslcontext_counted() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let perf = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_run-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_run-01_asl.json"), b"{}").unwrap();
    fs::write(perf.join("sub-01_run-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_run-02_asl.json"), b"{}").unwrap();

    let result = check_bids_dataset_impl(root).unwrap();
    assert!(result.is_bids);
    assert_eq!(result.asl_subject_count, 1);
    assert_eq!(result.asl_session_count, 1);
    assert_eq!(result.missing_aslcontext_count, 2);
    assert!(result.missing_sidecars.is_empty());
}

#[test]
fn check_bids_uncompressed_nii_accepted() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let perf = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
    fs::write(
        perf.join("sub-01_aslcontext.tsv"),
        b"volume_type\ncontrol\nlabel\n",
    )
    .unwrap();

    let result = check_bids_dataset_impl(root).unwrap();
    assert!(result.is_bids);
    assert_eq!(result.asl_subject_count, 1);
}

#[test]
fn repair_root_must_match_native_active_project_ownership() {
    let active = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let state = AppState::default();
    assert!(verify_active_repair_root(&state, active.path()).is_err());
    crate::project::ownership::own_project(&state, &active.path().canonicalize().unwrap());
    assert!(verify_active_repair_root(&state, active.path()).is_ok());
    assert!(verify_active_repair_root(&state, other.path()).is_err());
}

// --- scan_bids_sidecars tests ---

#[test]
fn committed_inheritance_fixture_has_expected_effective_metadata() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/bids-inheritance");
    let detected = check_bids_dataset_impl(&root).unwrap();
    assert!(detected.is_bids);
    assert_eq!(detected.bids_version.as_deref(), Some("1.11.2"));
    assert_eq!(
        (detected.asl_subject_count, detected.asl_session_count),
        (2, 2)
    );
    assert!(detected.missing_sidecars.is_empty());
    assert_eq!(detected.missing_aslcontext_count, 0);
    let scan = scan_bids_sidecars_impl(&root).unwrap();
    assert!(scan.skipped.is_empty());
    assert_eq!(scan.groups.len(), 2);
    for (subject, pld, duration, echo, context) in [
        ("sub-01", 2.1, 1.6, 0.012, "label,control,label,control"),
        ("sub-02", 1.8, 1.8, 0.014, "control,label,control,label"),
    ] {
        let group = scan
            .groups
            .iter()
            .find(|group| {
                group
                    .subjects
                    .iter()
                    .any(|member| member.subject_label == subject)
            })
            .unwrap();
        assert_eq!(group.subjects.len(), 1);
        assert_eq!(group.subjects[0].session_labels, ["01"]);
        assert_eq!(group.vendor, "Siemens");
        assert_eq!(
            group.bids_params.post_labeling_delay,
            Some(serde_json::json!(pld))
        );
        assert_eq!(
            group.bids_params.labeling_duration,
            Some(serde_json::json!(duration))
        );
        assert_eq!(group.bids_params.echo_time, Some(echo));
        assert_eq!(group.bids_params.asl_context.as_deref(), Some(context));
        assert_eq!(group.bids_params.m0_type.as_deref(), Some("Absent"));
    }
}

fn create_ds000240_like_sidecar() -> &'static str {
    r#"{
            "ArterialSpinLabelingType": "PCASL",
            "PostLabelingDelay": 1.8,
            "MRAcquisitionType": "3D",
            "MagneticFieldStrength": 3,
            "Manufacturer": "Siemens",
            "ManufacturersModelName": "Prisma",
            "M0Type": "Included",
            "BackgroundSuppression": true,
            "BolusCutOffDelayTime": 0,
            "BolusCutOffTechnique": "Q2TIPS",
            "LabelingDuration": 1.8,
            "BackgroundSuppressionNumberPulses": 4,
            "RepetitionTimePreparation": 4.6,
            "PulseSequenceType": "3D_SPIRAL",
            "EchoTime": 0.014
        }"#
}

#[test]
fn inherited_metadata_detects_and_reviews_two_subjects() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let sidecar_json = create_ds000240_like_sidecar();
    let context_tsv = "volume_type\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\ncontrol\nlabel\n";

    fs::write(root.join("asl.json"), sidecar_json).unwrap();
    fs::write(root.join("aslcontext.tsv"), context_tsv).unwrap();

    for i in 1..=2 {
        let label = format!("sub-{:02}", i);
        let perf = root.join(&label).join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join(format!("{}_asl.nii.gz", label)), b"fake").unwrap();
    }

    let paths = [
        root.join("asl.json"),
        root.join("aslcontext.tsv"),
        root.join("sub-01/perf/sub-01_asl.nii.gz"),
        root.join("sub-02/perf/sub-02_asl.nii.gz"),
    ];
    let before: Vec<_> = paths.iter().map(|path| fs::read(path).unwrap()).collect();
    let detected = check_bids_dataset_impl(root).unwrap();
    assert!(detected.is_bids);
    assert_eq!(detected.asl_subject_count, 2);
    assert_eq!(detected.asl_session_count, 2);
    assert!(detected.missing_sidecars.is_empty());
    assert_eq!(detected.missing_aslcontext_count, 0);
    let result = scan_bids_sidecars_impl(root).unwrap();

    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].subjects.len(), 2);
    assert_eq!(result.groups[0].label, "Siemens_3T_PCASL_3D_Included");
    assert_eq!(result.groups[0].vendor, "Siemens");
    assert!(result.skipped.is_empty());
    assert_eq!(result.groups[0].subjects[0].subject_label, "sub-01");
    assert_eq!(result.groups[0].subjects[1].subject_label, "sub-02");
    assert_eq!(
        before,
        paths
            .iter()
            .map(|path| fs::read(path).unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(fs::read_dir(root).unwrap().count(), 4);
    for subject in ["sub-01", "sub-02"] {
        assert_eq!(
            fs::read_dir(root.join(subject).join("perf"))
                .unwrap()
                .count(),
            1
        );
    }

    let perf = root.join("sub-01/perf");
    fs::write(perf.join("sub-01_run-02_asl.nii"), b"fake").unwrap();
    fs::write(root.join("sub-01/asl.json"), r#"{"EchoTime":0.03}"#).unwrap();
    fs::write(root.join("sub-01/aslcontext.tsv"), "volume_type\nlabel\n").unwrap();
    fs::write(perf.join("aslcontext.tsv"), "volume_type\ncontrol\nlabel\n").unwrap();
    let detected = check_bids_dataset_impl(root).unwrap();
    assert_eq!(
        (detected.asl_subject_count, detected.asl_session_count),
        (2, 2)
    );
    let scan = scan_bids_sidecars_impl(root).unwrap();
    assert!(scan.skipped.is_empty());
    assert_eq!(scan.groups.len(), 2);
    let group = scan
        .groups
        .iter()
        .find(|g| g.subjects[0].subject_label == "sub-01")
        .unwrap();
    assert_eq!(group.bids_params.echo_time, Some(0.03));
    assert_eq!(group.bids_params.manufacturer.as_deref(), Some("Siemens"));
    assert_eq!(
        group.bids_params.asl_context.as_deref(),
        Some("control,label")
    );
    assert_eq!(group.subjects[0].session_labels, ["1"]);
    fs::write(perf.join("sub-01_m0scan.nii.gz"), b"fake").unwrap();
    let scan = scan_bids_sidecars_impl(root).unwrap();
    let group = scan
        .groups
        .iter()
        .find(|g| g.subjects[0].subject_label == "sub-01")
        .unwrap();
    assert_eq!(group.bids_params.m0_type.as_deref(), Some("Separate"));
}

#[test]
fn ambiguous_associations_error_in_detection_and_skip_only_affected_review_session() {
    for (shared, exact) in [
        ("acq-fast_asl.json", "sub-01_acq-fast_run-01_asl.json"),
        (
            "acq-fast_aslcontext.tsv",
            "sub-01_acq-fast_run-01_aslcontext.tsv",
        ),
    ] {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        create_bids_dataset(root, 1, false);
        let perf = root.join("sub-01/ses-02/perf");
        fs::create_dir_all(&perf).unwrap();
        let image = perf.join("sub-01_acq-fast_run-01_asl.nii");
        fs::write(&image, b"fake").unwrap();
        fs::write(root.join("asl.json"), "{}").unwrap();
        fs::write(root.join("aslcontext.tsv"), "volume_type\ncontrol\n").unwrap();
        for name in [shared, exact] {
            fs::write(perf.join(name), "{}").unwrap();
        }
        let error = check_bids_dataset_impl(root).unwrap_err().to_string();
        for path in [&image, &perf.join(shared), &perf.join(exact)] {
            assert!(error.contains(path.to_str().unwrap()), "{error}");
        }
        // An explicit session supersedes this subject's cross-sectional perf/.
        let unaffected = root.join("sub-02/perf");
        fs::create_dir_all(&unaffected).unwrap();
        fs::write(unaffected.join("sub-02_asl.nii"), b"fake").unwrap();
        let scan = scan_bids_sidecars_impl(root).unwrap();
        assert_eq!(scan.skipped, ["sub-01_02"]);
        assert_eq!(scan.groups[0].subjects[0].subject_label, "sub-02");
    }
}

#[test]
fn invalid_ancestor_json_is_detected_structurally_but_not_bypassed_during_review() {
    for invalid in ["not json", "[]"] {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        create_bids_dataset(root, 2, false);
        let source = root.join("sub-01/asl.json");
        fs::write(&source, invalid).unwrap();
        assert_eq!(check_bids_dataset_impl(root).unwrap().asl_subject_count, 2);
        let image = root.join("sub-01/perf/sub-01_asl.nii.gz");
        let sources = crate::bids::sidecar::discover_metadata(root, &image).unwrap();
        assert!(
            crate::bids::sidecar::load_effective_json(&sources)
                .unwrap_err()
                .to_string()
                .contains(source.to_str().unwrap())
        );
        let scan = scan_bids_sidecars_impl(root).unwrap();
        assert_eq!(scan.skipped, ["sub-01_1"]);
        assert_eq!(scan.groups[0].subjects[0].subject_label, "sub-02");
    }
}

/// Spec scenario: ds000240 single-group scan with 25 subjects.
/// Asserts `groups[0].subjects.len() == 25`, label and vendor exactly.
#[test]
fn scan_bids_sidecars_ds000240_single_group_25_subjects() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let sidecar_json = create_ds000240_like_sidecar();
    let context_tsv = "volume_type\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\ncontrol\nlabel\n";

    for i in 1..=25 {
        let label = format!("sub-{:02}", i);
        let perf = root.join(&label).join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join(format!("{}_asl.nii.gz", label)), b"fake").unwrap();
        fs::write(perf.join(format!("{}_asl.json", label)), sidecar_json).unwrap();
        fs::write(perf.join(format!("{}_aslcontext.tsv", label)), context_tsv).unwrap();
    }

    let result = scan_bids_sidecars_impl(root).unwrap();

    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].subjects.len(), 25);
    assert_eq!(result.groups[0].label, "Siemens_3T_PCASL_3D_Included");
    assert_eq!(result.groups[0].vendor, "Siemens");
    assert!(result.skipped.is_empty());
}

/// Spec wording: "Manufacturer: canonical vendor name from substring
/// detection". Sidecar containing uppercased "SIEMENS" must produce
/// label "Siemens_3T_..." not "SIEMENS_3T_...".
#[test]
fn scan_bids_sidecars_canonicalizes_uppercased_vendor_in_label() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    // Sidecar manufacturer is uppercased.
    let sidecar_json = create_ds000240_like_sidecar().replace(
        "\"Manufacturer\": \"Siemens\"",
        "\"Manufacturer\": \"SIEMENS\"",
    );
    let context_tsv = "volume_type\nm0scan\ncontrol\nlabel\n";

    let perf = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();
    fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf.join("sub-01_asl.json"), sidecar_json).unwrap();
    fs::write(perf.join("sub-01_aslcontext.tsv"), context_tsv).unwrap();

    let result = scan_bids_sidecars_impl(root).unwrap();

    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].vendor, "Siemens");
    assert_eq!(result.groups[0].label, "Siemens_3T_PCASL_3D_Included");
}

#[test]
fn scan_bids_sidecars_missing_aslcontext_skips_subject() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let sidecar_json = create_ds000240_like_sidecar();
    let context_tsv = "volume_type\ncontrol\nlabel\n";

    // sub-01: has aslcontext → included
    let perf1 = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf1).unwrap();
    fs::write(perf1.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf1.join("sub-01_asl.json"), sidecar_json).unwrap();
    fs::write(perf1.join("sub-01_aslcontext.tsv"), context_tsv).unwrap();

    // sub-05: NO aslcontext → skipped
    let perf5 = root.join("sub-05").join("perf");
    fs::create_dir_all(&perf5).unwrap();
    fs::write(perf5.join("sub-05_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf5.join("sub-05_asl.json"), sidecar_json).unwrap();
    // No aslcontext.tsv!

    let result = scan_bids_sidecars_impl(root).unwrap();

    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].subjects.len(), 1);
    assert_eq!(result.groups[0].subjects[0].subject_label, "sub-01");
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(result.skipped[0], "sub-05_1"); // cross-sectional = session "1"
}
