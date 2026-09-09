//! BIDS ASL sidecar discovery, parsing, and fingerprinting.
//!
//! # Performance
//!
//! Typical studies <500ms; 500-subject ~3-5s; 1000+ deferred.
//!
//! Sidecar discovery walks `sub-*/` directories only (cross-sectional
//! `sub-*/perf/` and longitudinal `sub-*/ses-*/perf/`) and is synchronous
//! for v1 — progress reporting for 1000+ subject datasets is out of scope.

use anyhow::{Context, Result as AnyResult};
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
pub fn parse_sidecar(path: &Path) -> AnyResult<Value> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open sidecar {}", path.display()))?;
    let parsed: Value = serde_json::from_reader(file)
        .inspect_err(|error| {
            log::warn!("Failed to parse sidecar JSON {}: {}", path.display(), error);
        })
        .with_context(|| format!("Failed to parse sidecar JSON {}", path.display()))?;
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
pub fn parse_asl_context(path: &Path) -> AnyResult<String> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read ASL context {}", path.display()))?;

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
) -> AnyResult<()> {
    let ctx_path = find_asl_context_for(sidecar_path)
        .with_context(|| format!("Missing aslcontext.tsv for {}", sidecar_path.display()))?;
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
#[path = "tests/sidecar.rs"]
mod tests;
