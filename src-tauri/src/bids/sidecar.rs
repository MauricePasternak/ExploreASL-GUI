//! Image-owned BIDS metadata inheritance, parsing, and fingerprinting.

use anyhow::{Context, Result as AnyResult};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

/// Parse complete extensions before suffix and exact, nonduplicated entity pairs.
fn filename_identity<'a>(
    name: &'a str,
    extension: &str,
) -> Option<(&'a str, HashMap<&'a str, &'a str>)> {
    let stem = name.strip_suffix(extension)?;
    let mut tokens = stem.rsplit('_');
    let suffix = tokens.next()?;
    if suffix.is_empty() || suffix.contains('-') {
        return None;
    }
    let mut entities = HashMap::new();
    for token in tokens {
        let (key, value) = token.split_once('-')?;
        if key.is_empty()
            || value.is_empty()
            || value.contains('-')
            || entities.insert(key, value).is_some()
        {
            return None;
        }
    }
    Some((suffix, entities))
}

pub struct ApplicableMetadata {
    /// Ordered from selected root to image directory.
    pub json_paths: Vec<PathBuf>,
    pub context_path: Option<PathBuf>,
}

/// Discover associations without reading JSON or TSV contents.
pub fn discover_metadata(root: &Path, image: &Path) -> AnyResult<ApplicableMetadata> {
    let directory = image
        .parent()
        .context("ASL image has no parent directory")?;
    anyhow::ensure!(
        directory.starts_with(root),
        "ASL image {} is outside selected root {}",
        image.display(),
        root.display()
    );
    let name = image
        .file_name()
        .and_then(|n| n.to_str())
        .context("Invalid ASL image filename")?;
    let (suffix, entities) = filename_identity(name, ".nii.gz")
        .or_else(|| filename_identity(name, ".nii"))
        .with_context(|| format!("Invalid ASL image identity {}", image.display()))?;
    anyhow::ensure!(suffix == "asl", "Not an ASL image: {}", image.display());
    let mut result = ApplicableMetadata {
        json_paths: Vec::new(),
        context_path: None,
    };
    for ancestor in directory.ancestors() {
        let mut json = Vec::new();
        let mut context = Vec::new();
        for entry in std::fs::read_dir(ancestor).with_context(|| {
            format!(
                "Cannot inspect {} for image {}",
                ancestor.display(),
                image.display()
            )
        })? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            for (extension, expected_suffix, candidates) in [
                (".json", "asl", &mut json),
                (".tsv", "aslcontext", &mut context),
            ] {
                if let Some((candidate_suffix, candidate_entities)) =
                    filename_identity(name, extension)
                    && candidate_suffix == expected_suffix
                    && candidate_entities
                        .iter()
                        .all(|(key, value)| entities.get(key) == Some(value))
                {
                    candidates.push(entry.path());
                }
            }
        }
        for candidates in [&json, &context] {
            anyhow::ensure!(
                candidates.len() <= 1,
                "Ambiguous metadata for image {}: {}",
                image.display(),
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        result.json_paths.extend(json);
        if result.context_path.is_none() {
            result.context_path = context.pop();
        }
        if ancestor == root {
            break;
        }
    }
    result.json_paths.reverse();
    Ok(result)
}

/// Merge whole top-level values, retaining all keys independently of projection.
pub fn load_effective_json(sources: &ApplicableMetadata) -> AnyResult<Value> {
    anyhow::ensure!(
        !sources.json_paths.is_empty(),
        "Missing applicable ASL JSON metadata"
    );
    let mut effective = serde_json::Map::new();
    for path in &sources.json_paths {
        let parsed = parse_sidecar(path)?;
        let object = parsed
            .as_object()
            .with_context(|| format!("ASL JSON must be an object: {}", path.display()))?;
        effective.extend(object.clone());
    }
    Ok(Value::Object(effective))
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
