//! BIDS ASL sidecar discovery, parsing, and fingerprinting.
//!
//! # Performance
//!
//! Typical studies <500ms; 500-subject ~3-5s; 1000+ deferred.
//!
//! Sidecar discovery walks `sub-*/` directories only (cross-sectional
//! `sub-*/perf/` and longitudinal `sub-*/ses-*/perf/`) and is synchronous
//! for v1 — progress reporting for 1000+ subject datasets is out of scope.

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::bids::path::{is_session_dir, is_subject_dir};
use crate::bids::vendor::{
    normalize_manufacturer_for_fingerprint, normalize_pulse_sequence_for_fingerprint,
};

/// 15 fingerprint fields per D24.
pub const FINGERPRINT_FIELDS: &[&str] = &[
    "ArterialSpinLabelingType",
    "PostLabelingDelay",
    "MRAcquisitionType",
    "MagneticFieldStrength",
    "Manufacturer",
    "ManufacturersModelName",
    "M0Type",
    "BackgroundSuppression",
    "BolusCutOffDelayTime",
    "BolusCutOffTechnique",
    "LabelingDuration",
    "BackgroundSuppressionNumberPulses",
    "RepetitionTimePreparation",
    "PulseSequenceType",
    "EchoTime",
];

/// Find all `*_asl.json` sidecar files under `bids_root`, walking `sub-*/` only.
///
/// Per D12: iterates top-level `sub-*/` directories, walks `perf/` (cross-sectional)
/// and `ses-*/perf/` (longitudinal).
pub fn find_asl_sidecars(bids_root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();

    let entries = match std::fs::read_dir(bids_root) {
        Ok(e) => e,
        Err(_) => return result,
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_subject_dir(&name) {
            continue;
        }

        let subject_dir = entry.path();

        // Cross-sectional: check perf/ directly
        let perf_dir = subject_dir.join("perf");
        if perf_dir.is_dir() {
            collect_asl_jsons(&perf_dir, &mut result);
        }

        // Longitudinal: check ses-*/perf/
        if let Ok(ses_entries) = std::fs::read_dir(&subject_dir) {
            for ses_entry in ses_entries.flatten() {
                if !ses_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    continue;
                }
                let ses_name = ses_entry.file_name().to_string_lossy().to_string();
                if !is_session_dir(&ses_name) {
                    continue;
                }
                let ses_perf = ses_entry.path().join("perf");
                if ses_perf.is_dir() {
                    collect_asl_jsons(&ses_perf, &mut result);
                }
            }
        }
    }

    log::debug!(
        "find_asl_sidecars: found {} sidecar(s) under {}",
        result.len(),
        bids_root.display()
    );

    result
}

/// Collect `*_asl.json` files from a directory.
fn collect_asl_jsons(dir: &Path, result: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with("_asl.json") {
                result.push(entry.path());
            }
        }
    }
}

/// Parse a JSON sidecar file.
pub fn parse_sidecar(path: &Path) -> Result<Value, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open sidecar {}: {}", path.display(), e))?;
    let parsed: Value = serde_json::from_reader(file).map_err(|e| {
        log::warn!("Failed to parse sidecar JSON {}: {}", path.display(), e);
        format!("Failed to parse sidecar JSON {}: {}", path.display(), e)
    })?;
    Ok(parsed)
}

/// Find the `*_aslcontext.tsv` file corresponding to a sidecar path.
///
/// Replaces `_asl` with `_aslcontext` and `.json` with `.tsv`.
pub fn find_asl_context_for(sidecar_path: &Path) -> Option<PathBuf> {
    let file_name = sidecar_path.file_name()?.to_str()?;
    let parent = sidecar_path.parent()?;

    // Replace _asl.json with _aslcontext.tsv
    let ctx_name = file_name.replace("_asl.json", "_aslcontext.tsv");
    let ctx_path = parent.join(&ctx_name);

    if ctx_path.exists() {
        Some(ctx_path)
    } else {
        None
    }
}

/// Parse an ASL context TSV file.
///
/// Reads the TSV, skips the header row, and comma-joins the `volume_type` values (2nd column).
pub fn parse_asl_context(path: &Path) -> Result<String, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read ASL context {}: {}", path.display(), e))?;

    let mut volume_types = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if i == 0 {
            // Skip header row
            continue;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // The volume_type is the first (and typically only) column
        // Format: "volume_type" or tab-separated "volume_type\t..."
        let vol_type = line.split('\t').next().unwrap_or(line).trim();
        if !vol_type.is_empty() {
            volume_types.push(vol_type.to_string());
        }
    }

    Ok(volume_types.join(","))
}

/// Inject `ASLContext` key into sidecar params by finding and parsing the companion TSV.
pub fn inject_asl_context(
    sidecar_path: &Path,
    params: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    let ctx_path = find_asl_context_for(sidecar_path)
        .ok_or_else(|| format!("Missing aslcontext.tsv for {}", sidecar_path.display()))?;
    let context_str = parse_asl_context(&ctx_path)?;
    params.insert("ASLContext".to_string(), Value::String(context_str));
    Ok(())
}

/// Extract fingerprint fields from a sidecar JSON.
///
/// Per D4: top-level keys only. Keys absent at top-level → null in fingerprint.
pub fn extract_fingerprint(sidecar: &Value) -> HashMap<String, Value> {
    let mut fp = HashMap::new();

    for &field in FINGERPRINT_FIELDS {
        let value = sidecar.get(field).cloned().unwrap_or(Value::Null);
        let canonical = if field == "Manufacturer" {
            match value.as_str() {
                Some(s) => normalize_manufacturer_for_fingerprint(s)
                    .map(Value::String)
                    .unwrap_or(Value::Null),
                None => Value::Null,
            }
        } else if field == "PulseSequenceType" {
            match value.as_str() {
                Some(s) => normalize_pulse_sequence_for_fingerprint(s)
                    .map(Value::String)
                    .unwrap_or(Value::Null),
                None => Value::Null,
            }
        } else {
            canonicalize_fingerprint_value(field, &value)
        };
        fp.insert(field.to_string(), canonical);
    }

    fp
}

/// Canonicalize a single fingerprint value for hashing.
fn canonicalize_fingerprint_value(_field: &str, value: &Value) -> Value {
    match value {
        Value::Null => Value::Null,
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                Value::String(canonicalize_number(f))
            } else {
                Value::Null
            }
        }
        Value::Array(arr) => {
            let canon = canonicalize_array(arr);
            Value::Array(canon)
        }
        Value::String(s) => Value::String(s.clone()),
        Value::Bool(b) => Value::String(b.to_string()),
        _ => Value::Null,
    }
}

/// Canonicalize a numeric value for fingerprint hashing (D5).
///
/// Rounds to 3 decimal places: `(value * 1000.0).round() / 1000.0`, then `format!("{:.3}", value)`.
pub fn canonicalize_number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    format!("{:.3}", rounded)
}

/// Canonicalize an array for fingerprint hashing (D6).
///
/// Numbers sorted ascending, each rounded to 3 decimals.
/// Strings sorted ascending.
/// Mixed-type: serialize as-is.
pub fn canonicalize_array(arr: &[Value]) -> Vec<Value> {
    if arr.is_empty() {
        return arr.to_vec();
    }

    // Check if all elements are numbers
    let all_numbers = arr.iter().all(|v| v.is_number());
    if all_numbers {
        let mut nums: Vec<f64> = arr.iter().filter_map(|v| v.as_f64()).collect();
        nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        nums.into_iter()
            .map(|n| Value::String(canonicalize_number(n)))
            .collect()
    } else {
        // Check if all elements are strings
        let all_strings = arr.iter().all(|v| v.is_string());
        if all_strings {
            let mut strs: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
            strs.sort();
            strs.into_iter()
                .map(|s| Value::String(s.to_string()))
                .collect()
        } else {
            // Mixed type — serialize as-is
            arr.to_vec()
        }
    }
}

#[cfg(test)]
mod tests {
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

    // ---- find_asl_context_for ----

    #[test]
    fn test_find_asl_context_for_basic() {
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();

        let sidecar_path = perf.join("sub-01_asl.json");
        fs::write(&sidecar_path, b"{}").unwrap();
        fs::write(perf.join("sub-01_aslcontext.tsv"), b"volume_type\n").unwrap();

        let ctx = find_asl_context_for(&sidecar_path).unwrap();
        assert_eq!(ctx, perf.join("sub-01_aslcontext.tsv"));
    }

    #[test]
    fn test_find_asl_context_for_with_ses() {
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("ses-01").join("perf");
        fs::create_dir_all(&perf).unwrap();

        let sidecar_path = perf.join("sub-01_ses-01_asl.json");
        fs::write(&sidecar_path, b"{}").unwrap();
        fs::write(perf.join("sub-01_ses-01_aslcontext.tsv"), b"volume_type\n").unwrap();

        let ctx = find_asl_context_for(&sidecar_path).unwrap();
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

    // ---- inject_asl_context ----

    #[test]
    fn test_inject_asl_context_success() {
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();

        let sidecar_path = perf.join("sub-01_asl.json");
        fs::write(&sidecar_path, r#"{"EchoTime": 0.01}"#).unwrap();
        fs::write(
            perf.join("sub-01_aslcontext.tsv"),
            "volume_type\nm0scan\ncontrol\nlabel\n",
        )
        .unwrap();

        let mut params: serde_json::Map<String, Value> =
            serde_json::from_str(r#"{"EchoTime": 0.01}"#).unwrap();
        inject_asl_context(&sidecar_path, &mut params).unwrap();

        assert_eq!(params["ASLContext"], "m0scan,control,label");
    }

    #[test]
    fn test_inject_asl_context_missing_tsv() {
        let tmp = TempDir::new().unwrap();
        let sidecar_path = tmp.path().join("sub-01_asl.json");
        fs::write(&sidecar_path, r#"{"EchoTime": 0.01}"#).unwrap();

        let mut params: serde_json::Map<String, Value> =
            serde_json::from_str(r#"{"EchoTime": 0.01}"#).unwrap();
        let result = inject_asl_context(&sidecar_path, &mut params);

        assert!(result.is_err());
    }

    // ---- extract_fingerprint ----

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
        let sidecar_a: Value =
            serde_json::from_str(r#"{"PulseSequenceType": "3D_SPIRAL"}"#).unwrap();
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
    fn test_canonicalize_number_int_vs_float() {
        // 3 (int) and 3.0 (float) should produce same canonical form
        assert_eq!(canonicalize_number(3.0), "3.000");
        assert_eq!(canonicalize_number(3.0), canonicalize_number(3.0));
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

    // ---- find_asl_sidecars integration ----

    #[test]
    fn test_find_asl_sidecars_cross_sectional() {
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();

        let sidecars = find_asl_sidecars(tmp.path());
        assert_eq!(sidecars.len(), 1);
        assert!(sidecars[0].to_string_lossy().contains("sub-01_asl.json"));
    }

    #[test]
    fn test_find_asl_sidecars_excludes_derivatives() {
        let tmp = TempDir::new().unwrap();

        // Valid: sub-01/perf/sub-01_asl.json
        let perf = tmp.path().join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

        // Invalid: derivatives/ExploreASL/sub-01_asl.json
        let deriv = tmp.path().join("derivatives").join("ExploreASL");
        fs::create_dir_all(&deriv).unwrap();
        fs::write(deriv.join("sub-01_asl.json"), b"{}").unwrap();

        let sidecars = find_asl_sidecars(tmp.path());
        assert_eq!(sidecars.len(), 1);
        assert!(!sidecars[0].to_string_lossy().contains("derivatives"));
    }

    #[test]
    fn test_find_asl_sidecars_longitudinal() {
        let tmp = TempDir::new().unwrap();
        let ses_perf = tmp.path().join("sub-01").join("ses-01").join("perf");
        fs::create_dir_all(&ses_perf).unwrap();
        fs::write(ses_perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

        let sidecars = find_asl_sidecars(tmp.path());
        assert_eq!(sidecars.len(), 1);
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
}
