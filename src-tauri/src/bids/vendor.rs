use std::path::Path;

/// Helper to fuzzy match tokens in a string split by delimiters against a target.
pub fn fuzzy_match_token(value: &str, target: &str, threshold: f64) -> bool {
    let lower_val = value.to_lowercase();
    let target_lower = target.to_lowercase();
    for token in lower_val.split(&['_', '-', ' '][..]) {
        if token.is_empty() {
            continue;
        }
        let sim = strsim::jaro_winkler(token, &target_lower);
        if sim >= threshold {
            return true;
        }
    }
    false
}

/// Normalize manufacturer string for fingerprint hashing (mirrors TS D9).
pub fn normalize_manufacturer_for_fingerprint(value: &str) -> Option<String> {
    let lower = value.to_lowercase();
    if lower.contains("siemens") {
        Some("Siemens".to_string())
    } else if lower.contains("philips") {
        Some("Philips".to_string())
    } else if lower.contains("ge") {
        Some("GE_product".to_string())
    } else {
        // Fallback fuzzy match
        if fuzzy_match_token(value, "siemens", 0.8) {
            Some("Siemens".to_string())
        } else if fuzzy_match_token(value, "philips", 0.8) {
            Some("Philips".to_string())
        } else if fuzzy_match_token(value, "ge", 0.8) || fuzzy_match_token(value, "ge_product", 0.8)
        {
            Some("GE_product".to_string())
        } else {
            None
        }
    }
}

/// Normalize pulse sequence type for fingerprint hashing (mirrors TS D9).
pub fn normalize_pulse_sequence_for_fingerprint(value: &str) -> Option<String> {
    let lower = value.to_lowercase();
    if lower.contains("ep2d")
        || lower.contains("epfid")
        || lower.contains("pepolar")
        || lower.contains("epi")
    {
        Some("EPI".to_string())
    } else if lower.contains("grase") || lower.contains("tgse") {
        Some("GRASE".to_string())
    } else if lower.contains("spiral") {
        Some("spiral".to_string())
    } else {
        // Fallback fuzzy match
        if fuzzy_match_token(value, "epi", 0.8)
            || fuzzy_match_token(value, "ep2d", 0.8)
            || fuzzy_match_token(value, "epfid", 0.8)
            || fuzzy_match_token(value, "pepolar", 0.8)
        {
            Some("EPI".to_string())
        } else if fuzzy_match_token(value, "grase", 0.8) || fuzzy_match_token(value, "tgse", 0.8) {
            Some("GRASE".to_string())
        } else if fuzzy_match_token(value, "spiral", 0.8) {
            Some("spiral".to_string())
        } else {
            None
        }
    }
}

/// Derive vendor name from manufacturer string (case-insensitive substring match).
pub fn derive_vendor(manufacturer: Option<&str>) -> String {
    let m = match manufacturer {
        Some(m) => m.to_lowercase(),
        None => return "UnknownVendor".to_string(),
    };

    if m.contains("siemens") {
        "Siemens".to_string()
    } else if m.contains("philips") {
        "Philips".to_string()
    } else if m.contains("ge") {
        "GE_product".to_string()
    } else {
        // Fallback fuzzy match
        if fuzzy_match_token(&m, "siemens", 0.8) {
            "Siemens".to_string()
        } else if fuzzy_match_token(&m, "philips", 0.8) {
            "Philips".to_string()
        } else if fuzzy_match_token(&m, "ge", 0.8) || fuzzy_match_token(&m, "ge_product", 0.8) {
            "GE_product".to_string()
        } else {
            "UnknownVendor".to_string()
        }
    }
}

/// Derive sequence type from MRAcquisitionType and PulseSequenceType.
pub fn derive_sequence(acq_type: Option<&str>, pulse_seq: Option<&str>) -> String {
    match (acq_type, pulse_seq) {
        (Some(acq), Some(pulse)) => {
            let clean_pulse = if pulse
                .to_lowercase()
                .starts_with(&format!("{}_", acq.to_lowercase()))
                || pulse
                    .to_lowercase()
                    .starts_with(&format!("{}-", acq.to_lowercase()))
            {
                pulse[acq.len() + 1..].to_string()
            } else if pulse.to_lowercase().starts_with(&acq.to_lowercase())
                && pulse.len() > acq.len()
            {
                pulse[acq.len()..].to_string()
            } else {
                pulse.to_string()
            };
            format!("{}_{}", acq, clean_pulse)
        }
        (Some(acq), None) => acq.to_string(),
        (None, Some(pulse)) => pulse.to_string(),
        (None, None) => "UnknownSequence".to_string(),
    }
}

/// Derive labeling type from ArterialSpinLabelingType.
pub fn derive_labeling_type(asl_type: Option<&str>) -> String {
    match asl_type {
        Some(t) => {
            let upper = t.to_uppercase();
            if upper.contains("PCASL") {
                "PCASL".to_string()
            } else if upper.contains("CASL") {
                "CASL".to_string()
            } else if upper.contains("PASL") {
                "PASL".to_string()
            } else {
                "UnknownLabelingType".to_string()
            }
        }
        None => "UnknownLabelingType".to_string(),
    }
}

/// Derive M0Type per D8.
///
/// 1. If sidecar's M0Type == "Estimate" → "Estimate"
/// 2. Else if *_m0scan.nii.gz present in perf_path → "Separate"
/// 3. Else if aslcontext contains "m0scan" → "Included"
/// 4. Else → "Absent"
pub fn derive_m0_type(
    perf_path: &Path,
    aslcontext: Option<&str>,
    sidecar_m0type: Option<&str>,
) -> String {
    // Rule 1: Trust sidecar's "Estimate"
    if let Some(m0type) = sidecar_m0type
        && m0type == "Estimate"
    {
        log::debug!(
            "derive_m0_type: sidecar=Estimate for {}",
            perf_path.display()
        );
        return "Estimate".to_string();
    }

    // Rule 2: Check for *_m0scan.nii.gz in perf_path
    if let Ok(entries) = std::fs::read_dir(perf_path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with("_m0scan.nii") || name.ends_with("_m0scan.nii.gz") {
                log::debug!(
                    "derive_m0_type: m0scan file found → Separate for {}",
                    perf_path.display()
                );
                return "Separate".to_string();
            }
        }
    }

    // Rule 3: Check aslcontext for "m0scan" token
    if let Some(ctx) = aslcontext
        && ctx.split(',').any(|t| t.trim() == "m0scan")
    {
        log::debug!(
            "derive_m0_type: aslcontext has m0scan → Included for {}",
            perf_path.display()
        );
        return "Included".to_string();
    }

    // Rule 4: Default
    log::debug!(
        "derive_m0_type: defaulting to Absent for {}",
        perf_path.display()
    );
    "Absent".to_string()
}

/// Suggest a label for a group based on sidecar parameters.
///
/// Pattern: "{Manufacturer}_{FieldStrength}T_{ASLType}_{AcqType}_{M0Type}"
/// Missing component → omit slot.
pub fn suggest_label(
    manufacturer: Option<&str>,
    field_strength: Option<f64>,
    asl_type: Option<&str>,
    acq_type: Option<&str>,
    m0_type: Option<&str>,
) -> String {
    let mut parts = Vec::new();

    if let Some(m) = manufacturer {
        parts.push(m.to_string());
    }

    if let Some(fs) = field_strength {
        // Format as integer if whole number
        if fs == fs.floor() {
            parts.push(format!("{}T", fs as i64));
        } else {
            parts.push(format!("{}T", fs));
        }
    }

    if let Some(at) = asl_type {
        parts.push(at.to_string());
    }

    if let Some(aq) = acq_type {
        parts.push(aq.to_string());
    }

    if let Some(m0) = m0_type {
        parts.push(m0.to_string());
    }

    parts.join("_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_manufacturer_for_fingerprint() {
        assert_eq!(
            normalize_manufacturer_for_fingerprint("SIEMENS TrioTim"),
            Some("Siemens".to_string())
        );
        assert_eq!(
            normalize_manufacturer_for_fingerprint("Siemns"),
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
        assert_eq!(
            normalize_pulse_sequence_for_fingerprint("3D_SPRIAL"),
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
    fn test_derive_sequence_full() {
        assert_eq!(derive_sequence(Some("3D"), Some("3D_SPIRAL")), "3D_SPIRAL");
    }

    #[test]
    fn test_derive_sequence_unknown() {
        assert_eq!(derive_sequence(None, None), "UnknownSequence");
    }

    #[test]
    fn test_derive_labeling_type_pcasl() {
        assert_eq!(derive_labeling_type(Some("PCASL")), "PCASL");
        assert_eq!(derive_labeling_type(Some("CASL")), "CASL");
    }

    #[test]
    fn test_derive_labeling_type_pasl() {
        assert_eq!(derive_labeling_type(Some("PASL")), "PASL");
    }

    #[test]
    fn test_derive_labeling_type_unknown() {
        assert_eq!(derive_labeling_type(Some("FAIR")), "UnknownLabelingType");
        assert_eq!(derive_labeling_type(None), "UnknownLabelingType");
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
}
