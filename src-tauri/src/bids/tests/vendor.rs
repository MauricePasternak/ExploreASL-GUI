use super::*;

#[test]
fn test_normalize_manufacturer_for_fingerprint() {
    assert_eq!(
        normalize_manufacturer_for_fingerprint("SIEMENS TrioTim"),
        Some("Siemens".to_string())
    );
    assert_eq!(normalize_manufacturer_for_fingerprint("Canon"), None);
}

#[test]
fn test_normalize_pulse_sequence_for_fingerprint() {
    assert_eq!(
        normalize_pulse_sequence_for_fingerprint("3D_SPIRAL"),
        Some("spiral".to_string())
    );
    assert_eq!(normalize_pulse_sequence_for_fingerprint("unknown"), None);
}

#[test]
fn test_derive_vendor_siemens() {
    assert_eq!(derive_vendor(Some("Siemens")), "Siemens");
    assert_eq!(derive_vendor(Some("SIEMENS TrioTim")), "Siemens");
    assert_eq!(derive_vendor(Some("siemens healthineers")), "Siemens");
}

#[test]
fn test_derive_vendor_philips() {
    assert_eq!(derive_vendor(Some("Philips")), "Philips");
    assert_eq!(derive_vendor(Some("PHILIPS")), "Philips");
}

#[test]
fn test_derive_vendor_ge() {
    assert_eq!(derive_vendor(Some("GE MEDICAL SYSTEMS")), "GE_product");
    assert_eq!(derive_vendor(Some("ge healthcare")), "GE_product");
}

#[test]
fn test_derive_vendor_unknown() {
    assert_eq!(
        derive_vendor(Some("Canon Medical Systems")),
        "UnknownVendor"
    );
    assert_eq!(derive_vendor(None), "UnknownVendor");
}

#[test]
fn derived_vendor_uses_fingerprint_normalization() {
    for manufacturer in ["Siemens", "Siemns", "Philps", "ge_healthcare", "Canon"] {
        assert_eq!(
            derive_vendor(Some(manufacturer)),
            normalize_manufacturer_for_fingerprint(manufacturer)
                .unwrap_or_else(|| "UnknownVendor".to_string())
        );
    }
}

// ---- derive_m0_type ----

#[test]
fn test_derive_m0_type_estimate_honored() {
    let tmp = tempfile::TempDir::new().unwrap();
    let perf = tmp.path().join("perf");
    std::fs::create_dir(&perf).unwrap();

    // Sidecar says Estimate, no m0 file, no m0scan in context
    assert_eq!(
        derive_m0_type(&perf, Some("control,label"), Some("Estimate")),
        "Estimate"
    );
}

#[test]
fn test_derive_m0_type_separate_m0_file() {
    let tmp = tempfile::TempDir::new().unwrap();
    let perf = tmp.path().join("perf");
    std::fs::create_dir(&perf).unwrap();
    std::fs::write(perf.join("sub-01_m0scan.nii.gz"), b"fake").unwrap();

    // m0scan file present, sidecar says Included (ignored)
    assert_eq!(
        derive_m0_type(&perf, Some("control,label"), Some("Included")),
        "Separate"
    );
}

#[test]
fn test_derive_m0_type_included_in_context() {
    let tmp = tempfile::TempDir::new().unwrap();
    let perf = tmp.path().join("perf");
    std::fs::create_dir(&perf).unwrap();

    // No m0scan file, but aslcontext has m0scan
    assert_eq!(
        derive_m0_type(&perf, Some("m0scan,control,label"), None),
        "Included"
    );
}

#[test]
fn test_derive_m0_type_absent() {
    let tmp = tempfile::TempDir::new().unwrap();
    let perf = tmp.path().join("perf");
    std::fs::create_dir(&perf).unwrap();

    assert_eq!(
        derive_m0_type(&perf, Some("control,label"), Some("Absent")),
        "Absent"
    );
}

// ---- suggest_label ----

#[test]
fn test_suggest_label_full() {
    assert_eq!(
        suggest_label(
            Some("Siemens"),
            Some(3.0),
            Some("PCASL"),
            Some("3D"),
            Some("Included")
        ),
        "Siemens_3T_PCASL_3D_Included"
    );
}

#[test]
fn test_suggest_label_missing_segments() {
    assert_eq!(
        suggest_label(Some("Philips"), None, Some("PCASL"), Some("2D"), None),
        "Philips_PCASL_2D"
    );
}

#[test]
fn test_suggest_label_float_strength() {
    assert_eq!(
        suggest_label(
            Some("Siemens"),
            Some(1.5),
            Some("PASL"),
            Some("2D"),
            Some("Absent")
        ),
        "Siemens_1.5T_PASL_2D_Absent"
    );
}
