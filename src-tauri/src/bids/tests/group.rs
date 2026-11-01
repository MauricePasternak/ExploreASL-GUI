use super::*;
use std::fs;
use tempfile::TempDir;

// ---- compute_group_hash ----

#[test]
fn test_compute_group_hash_deterministic() {
    let mut fp = HashMap::new();
    fp.insert(
        "MagneticFieldStrength".to_string(),
        Value::String("3.000".to_string()),
    );
    fp.insert(
        "Manufacturer".to_string(),
        Value::String("Siemens".to_string()),
    );

    let hash1 = compute_group_hash(&fp);
    let hash2 = compute_group_hash(&fp);
    assert_eq!(hash1, hash2);
    assert!(!hash1.is_empty());
}

#[test]
fn test_compute_group_hash_different_values() {
    let mut fp1 = HashMap::new();
    fp1.insert(
        "MagneticFieldStrength".to_string(),
        Value::String("3.000".to_string()),
    );

    let mut fp2 = HashMap::new();
    fp2.insert(
        "MagneticFieldStrength".to_string(),
        Value::String("1.500".to_string()),
    );

    assert_ne!(compute_group_hash(&fp1), compute_group_hash(&fp2));
}

#[test]
fn test_compute_group_hash_key_order_independent() {
    let mut fp1 = HashMap::new();
    fp1.insert("A".to_string(), Value::String("1".to_string()));
    fp1.insert("B".to_string(), Value::String("2".to_string()));

    let mut fp2 = HashMap::new();
    fp2.insert("B".to_string(), Value::String("2".to_string()));
    fp2.insert("A".to_string(), Value::String("1".to_string()));

    assert_eq!(compute_group_hash(&fp1), compute_group_hash(&fp2));
}

// ---- group_by_fingerprint ----

#[test]
fn test_group_by_fingerprint_single_group() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let sidecar_json = r#"{
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
            "PulseSequenceType": "3D_SPRIAL",
            "EchoTime": 0.014
        }"#;

    let context_tsv = "volume_type\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\ncontrol\nlabel\n";

    let perf1 = root.join("sub-01").join("perf");
    let perf2 = root.join("sub-02").join("perf");
    fs::create_dir_all(&perf1).unwrap();
    fs::create_dir_all(&perf2).unwrap();
    fs::write(perf1.join("sub-01_asl.json"), sidecar_json).unwrap();
    fs::write(perf1.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf1.join("sub-01_aslcontext.tsv"), context_tsv).unwrap();
    fs::write(perf2.join("sub-02_asl.json"), sidecar_json).unwrap();
    fs::write(perf2.join("sub-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf2.join("sub-02_aslcontext.tsv"), context_tsv).unwrap();

    let subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
    let result = group_by_fingerprint(root, &subjects).unwrap();
    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].subjects.len(), 2);
    assert!(result.skipped.is_empty());
}

#[test]
fn test_group_by_fingerprint_multi_group() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let sidecar1 = r#"{"MagneticFieldStrength": 3, "Manufacturer": "Siemens", "EchoTime": 0.014}"#;
    let sidecar2 =
        r#"{"MagneticFieldStrength": 1.5, "Manufacturer": "Philips", "EchoTime": 0.020}"#;

    let perf1 = root.join("sub-01").join("perf");
    let perf2 = root.join("sub-02").join("perf");
    fs::create_dir_all(&perf1).unwrap();
    fs::create_dir_all(&perf2).unwrap();
    fs::write(perf1.join("sub-01_asl.json"), sidecar1).unwrap();
    fs::write(perf1.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(
        perf1.join("sub-01_aslcontext.tsv"),
        "volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    fs::write(perf2.join("sub-02_asl.json"), sidecar2).unwrap();
    fs::write(perf2.join("sub-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(
        perf2.join("sub-02_aslcontext.tsv"),
        "volume_type\ncontrol\nlabel\n",
    )
    .unwrap();

    let subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
    let result = group_by_fingerprint(root, &subjects).unwrap();
    assert_eq!(result.groups.len(), 2);
    assert!(result.skipped.is_empty());
}

#[test]
fn test_group_by_fingerprint_skipped_missing_sidecar() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let perf1 = root.join("sub-01").join("perf");
    let perf2 = root.join("sub-02").join("perf");
    fs::create_dir_all(&perf1).unwrap();
    fs::create_dir_all(&perf2).unwrap();
    fs::write(perf1.join("sub-01_asl.json"), r#"{"EchoTime": 0.014}"#).unwrap();
    fs::write(perf1.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    fs::write(
        perf1.join("sub-01_aslcontext.tsv"),
        "volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    // sub-02: has ASL NIfTI but NO sidecar JSON
    fs::write(perf2.join("sub-02_asl.nii.gz"), b"fake").unwrap();
    let orphan = root.join("sub-03/perf");
    fs::create_dir_all(&orphan).unwrap();
    fs::write(orphan.join("sub-03_asl.json"), "{}").unwrap();
    fs::write(
        orphan.join("sub-03_aslcontext.tsv"),
        "volume_type\ncontrol\n",
    )
    .unwrap();

    let subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
    let result = group_by_fingerprint(root, &subjects).unwrap();
    assert_eq!(result.groups.len(), 1);
    assert_eq!(result.groups[0].subjects.len(), 1);
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(result.skipped[0], "sub-02_1");
}

#[test]
fn test_group_by_fingerprint_skipped_partial_missing_sidecar() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let perf1 = root.join("sub-01").join("perf");
    fs::create_dir_all(&perf1).unwrap();
    fs::write(
        perf1.join("sub-01_run-1_asl.json"),
        r#"{"EchoTime": 0.014}"#,
    )
    .unwrap();
    fs::write(perf1.join("sub-01_run-1_asl.nii.gz"), b"fake").unwrap();
    fs::write(
        perf1.join("sub-01_run-1_aslcontext.tsv"),
        "volume_type\ncontrol\nlabel\n",
    )
    .unwrap();
    // run-2 has NIfTI but NO sidecar
    fs::write(perf1.join("sub-01_run-2_asl.nii.gz"), b"fake").unwrap();
    // Equal JSON/image counts cannot substitute for an actual association.
    fs::write(perf1.join("sub-01_run-3_asl.json"), "{}").unwrap();
    fs::write(
        perf1.join("sub-01_run-2_aslcontext.tsv"),
        "volume_type\ncontrol\n",
    )
    .unwrap();

    let subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
    let result = group_by_fingerprint(root, &subjects).unwrap();
    assert_eq!(result.groups.len(), 0);
    assert_eq!(result.skipped.len(), 1);
    assert_eq!(result.skipped[0], "sub-01_1");
}

#[test]
fn test_group_by_fingerprint_derived_m0type_governs_over_raw_sidecar_label() {
    // D8 spec scenario: sidecar's M0Type (non-Estimate) is NOT trusted for
    // fingerprinting — the derived value governs. Two subjects with
    // different raw sidecar M0Type strings but identical derived M0Type
    // (and identical remaining fingerprint fields) MUST group together.
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // Subject A: sidecar says "Included" (wrong/legacy), but filesystem
    // contains _m0scan.nii.gz → derived = "Separate".
    // Subject B: sidecar says "Absent", but filesystem also contains
    // _m0scan.nii.gz → derived = "Separate".
    let sidecar_a = r#"{
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
            "PulseSequenceType": "3D_GRASE",
            "EchoTime": 0.014
        }"#;
    let sidecar_b = sidecar_a.replace(r#""M0Type": "Included""#, r#""M0Type": "Absent""#);

    let context_tsv = "volume_type\ncontrol\nlabel\n";

    let perf_a = root.join("sub-01").join("perf");
    let perf_b = root.join("sub-02").join("perf");
    fs::create_dir_all(&perf_a).unwrap();
    fs::create_dir_all(&perf_b).unwrap();
    fs::write(perf_a.join("sub-01_asl.json"), sidecar_a).unwrap();
    fs::write(perf_a.join("sub-01_asl.nii.gz"), b"fake").unwrap();
    // Filesystem-present m0scan ⇒ derived "Separate"
    fs::write(perf_a.join("sub-01_m0scan.nii.gz"), b"fake").unwrap();
    fs::write(perf_a.join("sub-01_aslcontext.tsv"), context_tsv).unwrap();
    fs::write(perf_b.join("sub-02_asl.json"), sidecar_b).unwrap();
    fs::write(perf_b.join("sub-02_asl.nii.gz"), b"fake").unwrap();
    fs::write(perf_b.join("sub-02_m0scan.nii.gz"), b"fake").unwrap();
    fs::write(perf_b.join("sub-02_aslcontext.tsv"), context_tsv).unwrap();

    let subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
    let result = group_by_fingerprint(root, &subjects).unwrap();
    // Both subjects have identical remaining fingerprint fields and both
    // derive M0Type=Separate (m0scan file present). MUST group together
    // despite raw sidecar M0Type differing ("Included" vs "Absent").
    assert_eq!(
        result.groups.len(),
        1,
        "subjects with differing raw sidecar M0Type but same derived M0Type must group; got {} groups",
        result.groups.len()
    );
    assert_eq!(result.groups[0].subjects.len(), 2);
    // Group's params.m0_type reflects the DERIVED value, not the raw sidecar value.
    assert_eq!(
        result.groups[0].bids_params.m0_type.as_deref(),
        Some("Separate")
    );
    // Label reflects derived M0Type per the spec scenario for #5b.
    assert_eq!(result.groups[0].label, "Siemens_3T_PCASL_3D_Separate");
    assert!(result.skipped.is_empty());
}

// ---- apply_label_collisions ----

#[test]
fn timing_array_order_separates_acquisitions() {
    for field in [
        "PostLabelingDelay",
        "LabelingDuration",
        "BolusCutOffDelayTime",
    ] {
        let a = serde_json::json!({field: [1.0, 1.5, 2.0]});
        let b = serde_json::json!({field: [2.0, 1.5, 1.0]});
        assert_ne!(
            compute_group_hash(&extract_fingerprint(&a)),
            compute_group_hash(&extract_fingerprint(&b)),
            "{field}"
        );
    }
}

#[test]
fn projected_acquisition_fields_participate_in_fingerprint() {
    let absent = compute_group_hash(&extract_fingerprint(&serde_json::json!({})));
    for (field, value) in [
        ("PCASLType", serde_json::json!("balanced")),
        ("CASLType", serde_json::json!("continuous")),
        ("LabelingPulseAverageGradient", serde_json::json!(0.5)),
        ("LabelingPulseMaximumGradient", serde_json::json!(5.0)),
        ("LabelingPulseAverageB1", serde_json::json!(1.5)),
        ("LabelingPulseDuration", serde_json::json!(0.01)),
        ("LabelingPulseInterval", serde_json::json!(0.02)),
        ("BolusCutOffFlag", serde_json::json!(true)),
        ("BackgroundSuppressionPulseTime", serde_json::json!([1, 2])),
        ("VascularCrushing", serde_json::json!(true)),
        ("FlipAngle", serde_json::json!(90)),
        ("SliceTiming", serde_json::json!([0, 0.1])),
        ("M0_GMScaleFactor", serde_json::json!(1.2)),
        ("DatasetType", serde_json::json!("raw")),
        ("LabelingType", serde_json::json!("PCASL")),
        ("DummyScanPositionInASL4D", serde_json::json!([1])),
        ("RepetitionTimePreparationM0", serde_json::json!(4.0)),
    ] {
        assert_ne!(
            compute_group_hash(&extract_fingerprint(&serde_json::json!({field: value}))),
            absent,
            "{field}"
        );
    }
}

#[test]
fn group_params_do_not_claim_first_members_differing_raw_values() {
    let tmp = TempDir::new().unwrap();
    for (subject, echo, manufacturer) in [
        ("sub-01", 0.0141, "SIEMENS"),
        ("sub-02", 0.0142, "Siemens"),
        ("sub-03", 0.0141, "SIEMENS"),
    ] {
        let perf = tmp.path().join(subject).join("perf");
        fs::create_dir_all(&perf).unwrap();
        let sidecar = serde_json::json!({
            "EchoTime": echo, "Manufacturer": manufacturer,
            "PostLabelingDelay": [2.0, 1.0, 2.0]
        });
        fs::write(
            perf.join(format!("{subject}_asl.json")),
            sidecar.to_string(),
        )
        .unwrap();
        fs::write(perf.join(format!("{subject}_asl.nii")), b"fake").unwrap();
        fs::write(
            perf.join(format!("{subject}_aslcontext.tsv")),
            "volume_type\ncontrol\nlabel\n",
        )
        .unwrap();
    }
    let subjects = crate::bids::scan::parse_bids_structure(tmp.path()).unwrap();
    for subjects in [subjects.clone(), subjects.into_iter().rev().collect()] {
        let scan = group_by_fingerprint(tmp.path(), &subjects).unwrap();
        assert_eq!(scan.groups.len(), 1);
        let group = &scan.groups[0];
        assert_eq!(group.subjects.len(), 3);
        assert_eq!(group.vendor, "Siemens");
        assert!(group.bids_params.echo_time.is_none());
        assert!(group.bids_params.manufacturer.is_none());
        assert_eq!(
            group.bids_params.post_labeling_delay,
            Some(serde_json::json!([2.0, 1.0, 2.0]))
        );
        assert!(scan.skipped.is_empty());
    }
}

#[test]
fn multi_run_membership_and_late_context_contracts() {
    for (mode, group_count, skipped, context) in [
        ("same", 1, false, Some("control,label")),
        ("different", 2, false, Some("control,label")),
        ("metadata", 2, false, Some("control,label")),
        ("different_context", 1, false, None),
        ("malformed", 0, false, None),
        ("empty_context", 0, false, None),
        ("negative_scale", 0, false, None),
        ("invalid_timing", 0, false, None),
        ("null_timing", 0, false, None),
        ("invalid_pulses", 0, false, None),
        ("numeric_strings", 1, false, Some("control,label")),
        ("unreadable", 1, true, Some("control,label")),
    ] {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let perf = root.join("sub-01/perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(root.join("asl.json"), r#"{"EchoTime":0.01}"#).unwrap();
        if mode == "numeric_strings" {
            fs::write(
                root.join("asl.json"),
                serde_json::json!({
                    "PostLabelingDelay": " , 1.8, , ", "LabelingDuration": "1.8,, 2e0",
                    "BolusCutOffDelayTime": "0, 1.2", "FlipAngle": "90",
                    "BackgroundSuppressionPulseTime": ",", "SliceTiming": "0, 0.1",
                    "DummyScanPositionInASL4D": "  ", "RepetitionTimePreparationM0": " 4, "
                })
                .to_string(),
            )
            .unwrap();
        }
        for run in ["01", "02", "03"] {
            fs::write(perf.join(format!("sub-01_run-{run}_asl.nii")), b"fake").unwrap();
            let delta = if run == "02" { 0.0002 } else { 0.0001 };
            let invalid = match mode {
                "negative_scale" => Some(serde_json::json!({"M0_GMScaleFactor": -delta})),
                "invalid_timing" => Some(serde_json::json!({"PostLabelingDelay": 0.01 - delta})),
                "null_timing" if run != "02" => {
                    Some(serde_json::json!({"PostLabelingDelay": null}))
                }
                "invalid_pulses" => Some(
                    serde_json::json!({"BackgroundSuppression": true, "BackgroundSuppressionNumberPulses": -1.0 - delta}),
                ),
                _ => None,
            };
            if let Some(invalid) = invalid {
                fs::write(
                    perf.join(format!("sub-01_run-{run}_asl.json")),
                    invalid.to_string(),
                )
                .unwrap();
            }
            let bytes: &[u8] = if mode == "unreadable" && run == "02" {
                &[0xff]
            } else if mode == "different_context" && run == "02" {
                b"volume_type\ncontrol\nlabel\ncontrol\nlabel\n"
            } else if mode == "malformed" && run == "02" {
                b"not_a_header\nunexpected_b\n"
            } else if mode == "malformed" && run == "03" {
                b"not_a_header\n unexpected_a\textra\n\n"
            } else if mode == "empty_context" {
                b"volume_type\n\n"
            } else {
                b"volume_type\n control\textra\n\n label \n"
            };
            fs::write(perf.join(format!("sub-01_run-{run}_aslcontext.tsv")), bytes).unwrap();
        }
        if mode == "different" || mode == "unreadable" {
            fs::write(perf.join("sub-01_run-03_asl.json"), r#"{"EchoTime":0.02}"#).unwrap();
        }
        if mode == "metadata" {
            fs::write(
                perf.join("sub-01_run-03_asl.json"),
                r#"{"SliceTiming":[0,0.1]}"#,
            )
            .unwrap();
        }
        let mut subjects = crate::bids::scan::parse_bids_structure(root).unwrap();
        subjects[0].sessions[0]
            .asl_files
            .sort_by(|a, b| a.path.cmp(&b.path));
        let scan = group_by_fingerprint(root, &subjects);
        if group_count == 0 {
            let error = format!("{:#}", scan.unwrap_err());
            assert!(
                error.contains("Invalid metadata for image"),
                "{mode}: {error}"
            );
            assert!(error.contains("bidsParams."), "{mode}: {error}");
            continue;
        }
        let scan = scan.unwrap();
        assert_eq!(scan.groups.len(), group_count, "{mode}");
        assert_eq!(!scan.skipped.is_empty(), skipped, "{mode}");
        if skipped {
            assert_eq!(scan.skipped, ["sub-01_1"]);
        }
        for group in &scan.groups {
            assert_eq!(group.subjects.len(), 1);
            assert_eq!(group.subjects[0].session_labels, ["1"]);
            assert_eq!(group.bids_params.asl_context.as_deref(), context, "{mode}");
            if mode == "numeric_strings" {
                assert_eq!(
                    group.bids_params.post_labeling_delay,
                    Some(serde_json::json!(" , 1.8, , "))
                );
                assert_eq!(
                    group.bids_params.repetition_time_preparation_m0,
                    Some(serde_json::json!(" 4, "))
                );
            }
            assert_eq!(
                group.bids_params.m0_type.as_deref(),
                Some("Absent"),
                "{mode}"
            );
        }
    }
}

#[test]
fn test_apply_label_collisions_three_groups_same_label() {
    // D16: 3 groups with same label, subject counts 10, 10, 5
    // Two tied at 10: alphabetically-first subject gets unadorned
    use crate::bids::schema::BidsAslMetadata;

    let make_group = |label: &str, subjects: Vec<GroupSubject>| -> SidecarGroup {
        SidecarGroup {
            fingerprint_hash: "test".to_string(),
            label: label.to_string(),
            vendor: "Siemens".to_string(),
            sequence: "3D_test".to_string(),
            labeling_type: "PASL".to_string(),
            bids_params: BidsAslMetadata::default(),
            subjects,
        }
    };

    let make_subjects = |prefix: &str, count: usize| -> Vec<GroupSubject> {
        (1..=count)
            .map(|i| GroupSubject {
                subject_label: format!("{}-{:03}", prefix, i),
                session_labels: vec!["1".to_string()],
            })
            .collect()
    };

    let mut groups = vec![
        make_group(
            "Siemens_3T_PASL_3D_Absent",
            make_subjects("B", 10), // B-001..B-010 (alphabetically second)
        ),
        make_group(
            "Siemens_3T_PASL_3D_Absent",
            make_subjects("A", 10), // A-001..A-010 (alphabetically first)
        ),
        make_group(
            "Siemens_3T_PASL_3D_Absent",
            make_subjects("C", 5), // C-001..C-005 (smallest)
        ),
    ];

    apply_label_collisions(&mut groups);

    // A group (10 subjects, head "A-001") gets unadorned
    // B group (10 subjects, head "B-001") gets _(2)
    // C group (5 subjects) gets _(3)

    // Find each group by its subject prefix
    let a_group = groups
        .iter()
        .find(|g| g.subjects[0].subject_label.starts_with("A-"))
        .unwrap();
    let b_group = groups
        .iter()
        .find(|g| g.subjects[0].subject_label.starts_with("B-"))
        .unwrap();
    let c_group = groups
        .iter()
        .find(|g| g.subjects[0].subject_label.starts_with("C-"))
        .unwrap();

    assert_eq!(a_group.label, "Siemens_3T_PASL_3D_Absent");
    assert_eq!(b_group.label, "Siemens_3T_PASL_3D_Absent_(2)");
    assert_eq!(c_group.label, "Siemens_3T_PASL_3D_Absent_(3)");
}

#[test]
fn test_apply_label_collisions_no_collision() {
    use crate::bids::schema::BidsAslMetadata;

    let mut groups = vec![
        SidecarGroup {
            fingerprint_hash: "h1".to_string(),
            label: "Siemens_3T".to_string(),
            vendor: "Siemens".to_string(),
            sequence: "3D_test".to_string(),
            labeling_type: "CASL".to_string(),
            bids_params: BidsAslMetadata::default(),
            subjects: vec![GroupSubject {
                subject_label: "sub-01".to_string(),
                session_labels: vec!["1".to_string()],
            }],
        },
        SidecarGroup {
            fingerprint_hash: "h2".to_string(),
            label: "Philips_1.5T".to_string(),
            vendor: "Philips".to_string(),
            sequence: "2D_test".to_string(),
            labeling_type: "PASL".to_string(),
            bids_params: BidsAslMetadata::default(),
            subjects: vec![GroupSubject {
                subject_label: "sub-02".to_string(),
                session_labels: vec!["1".to_string()],
            }],
        },
    ];

    apply_label_collisions(&mut groups);

    // No collisions — labels unchanged
    assert_eq!(groups[0].label, "Siemens_3T");
    assert_eq!(groups[1].label, "Philips_1.5T");
}
