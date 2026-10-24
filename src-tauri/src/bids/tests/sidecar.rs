use super::*;
use std::fs;
use tempfile::TempDir;

// ---- parse_sidecar ----

#[test]
fn test_parse_sidecar_valid_json() {
    let tmp = TempDir::new().unwrap();
    let json_path = tmp.path().join("test.json");
    fs::write(
        &json_path,
        r#"{"EchoTime": 0.0029, "Manufacturer": "Siemens"}"#,
    )
    .unwrap();

    let result = parse_sidecar(&json_path).unwrap();
    assert_eq!(result["EchoTime"], 0.0029);
    assert_eq!(result["Manufacturer"], "Siemens");
}

#[test]
fn test_parse_sidecar_invalid_json() {
    let tmp = TempDir::new().unwrap();
    let json_path = tmp.path().join("bad.json");
    fs::write(&json_path, "not json").unwrap();

    assert!(parse_sidecar(&json_path).is_err());
}

// ---- adjacent applicability ----

#[test]
fn test_adjacent_context_basic() {
    let tmp = TempDir::new().unwrap();
    let perf = tmp.path().join("sub-01").join("perf");
    fs::create_dir_all(&perf).unwrap();

    let sidecar_path = perf.join("sub-01_asl.json");
    fs::write(&sidecar_path, b"{}").unwrap();
    fs::write(perf.join("sub-01_aslcontext.tsv"), b"volume_type\n").unwrap();

    let image = perf.join("sub-01_asl.nii.gz");
    let sources = discover_metadata(tmp.path(), &image).unwrap();
    assert_eq!(sources.json_paths, vec![sidecar_path]);
    let ctx = sources.context_path.unwrap();
    assert_eq!(ctx, perf.join("sub-01_aslcontext.tsv"));
}

#[test]
fn test_adjacent_context_with_ses() {
    let tmp = TempDir::new().unwrap();
    let perf = tmp.path().join("sub-01").join("ses-01").join("perf");
    fs::create_dir_all(&perf).unwrap();

    let sidecar_path = perf.join("sub-01_ses-01_asl.json");
    fs::write(&sidecar_path, b"{}").unwrap();
    fs::write(perf.join("sub-01_ses-01_aslcontext.tsv"), b"volume_type\n").unwrap();

    let image = perf.join("sub-01_ses-01_asl.nii");
    let ctx = discover_metadata(tmp.path(), &image)
        .unwrap()
        .context_path
        .unwrap();
    assert_eq!(ctx, perf.join("sub-01_ses-01_aslcontext.tsv"));
}

// ---- parse_asl_context ----

#[test]
fn test_parse_asl_context_basic() {
    let tmp = TempDir::new().unwrap();
    let tsv_path = tmp.path().join("test_aslcontext.tsv");
    fs::write(
        &tsv_path,
        "volume_type\ncontrol\nlabel\nm0scan\ncontrol\nlabel\n",
    )
    .unwrap();

    let result = parse_asl_context(&tsv_path).unwrap();
    assert_eq!(result, "control,label,m0scan,control,label");
}

#[test]
fn test_parse_asl_context_empty() {
    let tmp = TempDir::new().unwrap();
    let tsv_path = tmp.path().join("empty_aslcontext.tsv");
    fs::write(&tsv_path, "volume_type\n").unwrap();

    let result = parse_asl_context(&tsv_path).unwrap();
    assert_eq!(result, "");
}

// ---- extract_fingerprint ----

#[test]
fn applicability_matches_exact_generic_entities() {
    for (candidate, applies) in [
        ("echo-2_acq-fast_asl.json", true),
        ("acq-slow_asl.json", false),
        ("acq-Fast_asl.json", false),
        ("run-1_asl.json", false),
        ("acq-fast_broken_asl.json", false),
        ("acq-fast_acq-fast_asl.json", false),
    ] {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(candidate), "{}").unwrap();
        let image = tmp.path().join("sub-01_echo-2_acq-fast_run-01_asl.nii");
        let sources = discover_metadata(tmp.path(), &image).unwrap();
        assert_eq!(!sources.json_paths.is_empty(), applies, "{candidate}");
    }
}

#[test]
fn applicability_stays_inside_image_ancestors_and_selected_root() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("dataset");
    let perf = root.join("sub-01/perf");
    fs::create_dir_all(&perf).unwrap();
    for directory in [
        tmp.path().to_path_buf(),
        root.join("sub-02"),
        root.join("derivatives"),
    ] {
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("asl.json"), "{}").unwrap();
        fs::write(directory.join("aslcontext.tsv"), "volume_type\ncontrol\n").unwrap();
    }
    fs::write(perf.join("sub-01_m0scan.json"), "{}").unwrap();
    fs::write(perf.join("sub-01_asl.json.bak"), "{}").unwrap();
    let sources = discover_metadata(&root, &perf.join("sub-01_asl.nii.gz")).unwrap();
    assert!(sources.json_paths.is_empty());
    assert!(sources.context_path.is_none());
}

#[test]
fn effective_json_replaces_whole_values_without_fingerprint_normalization() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let perf = root.join("sub-01/ses-01/perf");
    fs::create_dir_all(&perf).unwrap();
    for (path, json) in [
        (
            "asl.json",
            r#"{"Manufacturer":"Siemens","PostLabelingDelay":1,"array":[1,2],"object":{"old":1},"flag":true,"zero":7,"empty":[1],"nil":1}"#,
        ),
        (
            "sub-01/asl.json",
            r#"{"PostLabelingDelay":2,"unknown":"retained"}"#,
        ),
        (
            "sub-01/ses-01/asl.json",
            r#"{"PostLabelingDelay":3,"EchoTime":0.014}"#,
        ),
        (
            "sub-01/ses-01/perf/sub-01_ses-01_asl.json",
            r#"{"PostLabelingDelay":4,"array":[2,1],"object":{"new":2},"flag":false,"zero":0,"empty":[],"nil":null}"#,
        ),
    ] {
        fs::write(root.join(path), json).unwrap();
    }
    let sources = discover_metadata(root, &perf.join("sub-01_ses-01_asl.nii.gz")).unwrap();
    let effective = load_effective_json(&sources).unwrap();
    assert_eq!(
        effective,
        serde_json::json!({
            "Manufacturer":"Siemens", "PostLabelingDelay":4, "EchoTime":0.014,
            "unknown":"retained", "array":[2,1], "object":{"new":2},
            "flag":false, "zero":0, "empty":[], "nil":null
        })
    );
}

#[test]
fn effective_json_reports_unreadable_source() {
    let tmp = TempDir::new().unwrap();
    let source = tmp.path().join("asl.json");
    fs::write(&source, "{}").unwrap();
    let sources = discover_metadata(tmp.path(), &tmp.path().join("sub-01_asl.nii")).unwrap();
    fs::remove_file(&source).unwrap();
    let error = load_effective_json(&sources).unwrap_err().to_string();
    assert!(error.contains(source.to_str().unwrap()));
}

#[test]
fn test_extract_fingerprint_normalizes_manufacturer() {
    let sidecar_a: Value = serde_json::from_str(r#"{"Manufacturer": "SIEMENS"}"#).unwrap();
    let sidecar_b: Value = serde_json::from_str(r#"{"Manufacturer": "Siemens"}"#).unwrap();

    let fp_a = extract_fingerprint(&sidecar_a);
    let fp_b = extract_fingerprint(&sidecar_b);
    assert_eq!(fp_a["Manufacturer"], fp_b["Manufacturer"]);
    assert_eq!(fp_a["Manufacturer"], Value::String("Siemens".to_string()));
}

#[test]
fn test_extract_fingerprint_normalizes_pulse_sequence() {
    let sidecar_a: Value = serde_json::from_str(r#"{"PulseSequenceType": "3D_SPIRAL"}"#).unwrap();
    let sidecar_b: Value =
        serde_json::from_str(r#"{"PulseSequenceType": "spiral_readout"}"#).unwrap();

    let fp_a = extract_fingerprint(&sidecar_a);
    let fp_b = extract_fingerprint(&sidecar_b);
    assert_eq!(fp_a["PulseSequenceType"], fp_b["PulseSequenceType"]);
    assert_eq!(
        fp_a["PulseSequenceType"],
        Value::String("spiral".to_string())
    );
}

#[test]
fn test_extract_fingerprint_top_level_only() {
    // D4: top-level keys only. Nested global.const ignored.
    let sidecar: Value = serde_json::from_str(
        r#"{
            "EchoTime": 0.0029,
            "MagneticFieldStrength": 3,
            "Manufacturer": "Siemens",
            "global": {
                "const": {
                    "EchoTime": 10.03,
                    "MagneticFieldStrength": 7
                }
            }
        }"#,
    )
    .unwrap();

    let fp = extract_fingerprint(&sidecar);
    // EchoTime should be 0.0029 (top-level), not 10.03 (nested)
    assert_eq!(fp["EchoTime"], Value::String("0.003".to_string()));
    assert_eq!(
        fp["MagneticFieldStrength"],
        Value::String("3.000".to_string())
    );
}

#[test]
fn test_extract_fingerprint_absent_field_is_null() {
    // D4: keys absent at top-level → null in fingerprint
    let sidecar: Value = serde_json::from_str(r#"{"EchoTime": 0.0029}"#).unwrap();

    let fp = extract_fingerprint(&sidecar);
    assert_eq!(fp["MagneticFieldStrength"], Value::Null);
    assert_eq!(fp["Manufacturer"], Value::Null);
}

#[test]
fn test_extract_fingerprint_all_15_fields_present() {
    let sidecar: Value = serde_json::from_str(
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
        }"#,
    )
    .unwrap();

    let fp = extract_fingerprint(&sidecar);
    assert_eq!(fp.len(), 15);
    // All 15 fields should be present
    for field in FINGERPRINT_FIELDS {
        assert!(
            fp.contains_key(*field),
            "Missing fingerprint field: {}",
            field
        );
    }
}

// ---- Number canonicalization (D5) ----

#[test]
fn test_canonicalize_number_formats_integer_with_three_decimal_places() {
    assert_eq!(canonicalize_number(3.0), "3.000");
}

#[test]
fn test_canonicalize_number_rounding() {
    assert_eq!(canonicalize_number(0.0029), "0.003");
    assert_eq!(canonicalize_number(1.8), "1.800");
    assert_eq!(canonicalize_number(4.6), "4.600");
}

// ---- Array canonicalization (D6) ----

#[test]
fn test_canonicalize_array_sort_independence() {
    // [1.0, 1.5, 2.0] and [2.0, 1.5, 1.0] should produce same canonical form
    let arr1 = vec![Value::from(1.0), Value::from(1.5), Value::from(2.0)];
    let arr2 = vec![Value::from(2.0), Value::from(1.5), Value::from(1.0)];

    let canon1 = canonicalize_array(&arr1);
    let canon2 = canonicalize_array(&arr2);

    assert_eq!(canon1, canon2);
    // Should be ["1.000", "1.500", "2.000"]
    assert_eq!(canon1[0], Value::String("1.000".to_string()));
    assert_eq!(canon1[1], Value::String("1.500".to_string()));
    assert_eq!(canon1[2], Value::String("2.000".to_string()));
}

#[test]
fn test_canonicalize_array_strings_sorted() {
    let arr = vec![
        Value::String("control".to_string()),
        Value::String("m0scan".to_string()),
        Value::String("label".to_string()),
    ];
    let canon = canonicalize_array(&arr);
    assert_eq!(canon[0], Value::String("control".to_string()));
    assert_eq!(canon[1], Value::String("label".to_string()));
    assert_eq!(canon[2], Value::String("m0scan".to_string()));
}

#[test]
fn test_canonicalize_array_empty() {
    let arr: Vec<Value> = vec![];
    let canon = canonicalize_array(&arr);
    assert!(canon.is_empty());
}

#[test]
fn test_sidecar_variety_vendor_normalization() {
    use crate::bids::vendor::{derive_vendor, normalize_manufacturer_for_fingerprint};

    // Exact matches
    assert_eq!(
        normalize_manufacturer_for_fingerprint("Siemens"),
        Some("Siemens".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("Philips"),
        Some("Philips".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("GE"),
        Some("GE_product".to_string())
    );

    // Typos & capitalization variations
    assert_eq!(
        normalize_manufacturer_for_fingerprint("SIEMENS"),
        Some("Siemens".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("Siemns"),
        Some("Siemens".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("siemms"),
        Some("Siemens".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("Philps"),
        Some("Philips".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("philip"),
        Some("Philips".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("ge_healthcare"),
        Some("GE_product".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("g.e."),
        Some("GE_product".to_string())
    );
    assert_eq!(
        normalize_manufacturer_for_fingerprint("unknown_brand"),
        None
    );

    // derive_vendor verification
    assert_eq!(derive_vendor(Some("Siemns")), "Siemens");
    assert_eq!(derive_vendor(Some("Philps")), "Philips");
    assert_eq!(derive_vendor(Some("ge_healthcare")), "GE_product");
    assert_eq!(derive_vendor(Some("unknown")), "UnknownVendor");
}

#[test]
fn test_sidecar_variety_pulse_sequence_normalization() {
    use crate::bids::vendor::normalize_pulse_sequence_for_fingerprint;

    // EPI variants
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("epi"),
        Some("EPI".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("EPI"),
        Some("EPI".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("ep2d"),
        Some("EPI".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("epfid"),
        Some("EPI".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("pepolar"),
        Some("EPI".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("epii"),
        Some("EPI".to_string())
    ); // typo

    // GRASE variants
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("grase"),
        Some("GRASE".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("tgse"),
        Some("GRASE".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("3d-grase"),
        Some("GRASE".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("3d_tgse"),
        Some("GRASE".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("gras"),
        Some("GRASE".to_string())
    ); // typo

    // Spiral variants
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("spiral"),
        Some("spiral".to_string())
    );
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("3D_SPRIAL"),
        Some("spiral".to_string())
    ); // typo
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("3D_SPIRL"),
        Some("spiral".to_string())
    ); // typo
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("fse-spiral"),
        Some("spiral".to_string())
    );

    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("something_else"),
        None
    );
}

#[test]
fn test_sidecar_variety_labeling_type() {
    use crate::bids::vendor::derive_labeling_type;

    assert_eq!(derive_labeling_type(Some("PCASL")), "PCASL");
    assert_eq!(derive_labeling_type(Some("pcasl")), "PCASL");
    assert_eq!(derive_labeling_type(Some("CASL")), "CASL");
    assert_eq!(derive_labeling_type(Some("casl")), "CASL");
    assert_eq!(derive_labeling_type(Some("PASL")), "PASL");
    assert_eq!(derive_labeling_type(Some("pasl")), "PASL");
    assert_eq!(derive_labeling_type(Some("FAIR")), "UnknownLabelingType");
    assert_eq!(derive_labeling_type(None), "UnknownLabelingType");
}

#[test]
fn test_sidecar_sequence_derivation_duplication() {
    use crate::bids::vendor::derive_sequence;

    assert_eq!(derive_sequence(Some("3D"), Some("spiral")), "3D_spiral");
    assert_eq!(derive_sequence(Some("3D"), Some("3D_SPIRAL")), "3D_SPIRAL");
    assert_eq!(derive_sequence(Some("3D"), Some("3d_spiral")), "3D_spiral");
    assert_eq!(derive_sequence(Some("2D"), Some("2D_EPI")), "2D_EPI");
    assert_eq!(derive_sequence(Some("2D"), Some("2d-epi")), "2D_epi");
    assert_eq!(derive_sequence(None, Some("EPI")), "EPI");
    assert_eq!(derive_sequence(Some("3D"), None), "3D");
    assert_eq!(derive_sequence(None, None), "UnknownSequence");
}
