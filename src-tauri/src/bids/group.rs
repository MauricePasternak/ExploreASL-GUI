use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::bids::scan::{BidsSession, BidsSubject};
use crate::bids::schema::BidsAslMetadata;
use crate::bids::sidecar::{
    canonicalize_number, extract_fingerprint, find_asl_context_for, parse_sidecar,
};
use crate::bids::vendor::{
    derive_labeling_type, derive_m0_type, derive_sequence, derive_vendor,
    normalize_pulse_sequence_for_fingerprint, suggest_label,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSubject {
    pub subject_label: String,
    pub session_labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarGroup {
    pub fingerprint_hash: String,
    pub label: String,
    pub vendor: String,
    pub sequence: String,
    pub labeling_type: String,
    pub bids_params: BidsAslMetadata,
    pub subjects: Vec<GroupSubject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsSidecarScan {
    pub groups: Vec<SidecarGroup>,
    pub skipped: Vec<String>,
}

/// Compute a deterministic SHA-256 hash over canonicalized fingerprint key-value pairs.
///
/// Keys sorted alphabetically; values canonicalized per type rules (D5, D6).
pub fn compute_group_hash(fingerprint: &HashMap<String, Value>) -> String {
    let mut hasher = Sha256::new();

    // Sort keys alphabetically
    let mut keys: Vec<&String> = fingerprint.keys().collect();
    keys.sort();

    for key in keys {
        hasher.update(key.as_bytes());
        hasher.update(b"=");
        let val = &fingerprint[key];
        match val {
            Value::String(s) => hasher.update(s.as_bytes()),
            Value::Null => hasher.update(b"null"),
            Value::Array(arr) => {
                for (i, item) in arr.iter().enumerate() {
                    if i > 0 {
                        hasher.update(b",");
                    }
                    match item {
                        Value::String(s) => hasher.update(s.as_bytes()),
                        Value::Number(n) => {
                            if let Some(f) = n.as_f64() {
                                hasher.update(canonicalize_number(f).as_bytes());
                            }
                        }
                        _ => {}
                    }
                }
            }
            Value::Bool(b) => {
                if *b {
                    hasher.update(b"true");
                } else {
                    hasher.update(b"false");
                }
            }
            Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    hasher.update(canonicalize_number(f).as_bytes());
                }
            }
            _ => {}
        }
        hasher.update(b";");
    }

    format!("{:x}", hasher.finalize())
}

/// Find the BidsSubject that owns a given sidecar path.
fn find_subject_for_sidecar<'a>(
    sidecar_path: &Path,
    subjects: &'a [BidsSubject],
) -> Option<(&'a BidsSubject, &'a BidsSession)> {
    let sidecar_str = sidecar_path.to_string_lossy();
    for subject in subjects {
        for session in &subject.sessions {
            for sc in &session.asl_sidecars {
                if sc == sidecar_str.as_ref() {
                    return Some((subject, session));
                }
            }
        }
    }
    None
}

/// Derive BidsAslMetadata from a parsed sidecar JSON + derived M0Type + ASLContext.
fn derive_bids_metadata(
    sidecar: &Value,
    m0_type: &str,
    asl_context: Option<&str>,
) -> BidsAslMetadata {
    BidsAslMetadata {
        arterial_spin_labeling_type: sidecar
            .get("ArterialSpinLabelingType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        post_labeling_delay: sidecar.get("PostLabelingDelay").cloned(),
        mr_acquisition_type: sidecar
            .get("MRAcquisitionType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        magnetic_field_strength: sidecar
            .get("MagneticFieldStrength")
            .and_then(|v| v.as_f64()),
        echo_time: sidecar.get("EchoTime").and_then(|v| v.as_f64()),
        labeling_duration: sidecar.get("LabelingDuration").cloned(),
        pcasl_type: sidecar
            .get("PCASLType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        casl_type: sidecar
            .get("CASLType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        labeling_pulse_average_gradient: sidecar
            .get("LabelingPulseAverageGradient")
            .and_then(|v| v.as_f64()),
        labeling_pulse_maximum_gradient: sidecar
            .get("LabelingPulseMaximumGradient")
            .and_then(|v| v.as_f64()),
        labeling_pulse_average_b1: sidecar
            .get("LabelingPulseAverageB1")
            .and_then(|v| v.as_f64()),
        labeling_pulse_duration: sidecar
            .get("LabelingPulseDuration")
            .and_then(|v| v.as_f64()),
        labeling_pulse_interval: sidecar
            .get("LabelingPulseInterval")
            .and_then(|v| v.as_f64()),
        bolus_cut_off_flag: sidecar.get("BolusCutOffFlag").and_then(|v| v.as_bool()),
        bolus_cut_off_delay_time: sidecar.get("BolusCutOffDelayTime").cloned(),
        bolus_cut_off_technique: sidecar
            .get("BolusCutOffTechnique")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        background_suppression: sidecar
            .get("BackgroundSuppression")
            .and_then(|v| v.as_bool()),
        background_suppression_number_pulses: sidecar
            .get("BackgroundSuppressionNumberPulses")
            .and_then(|v| v.as_f64()),
        background_suppression_pulse_time: sidecar.get("BackgroundSuppressionPulseTime").cloned(),
        vascular_crushing: sidecar.get("VascularCrushing").and_then(|v| v.as_bool()),
        repetition_time_preparation: sidecar
            .get("RepetitionTimePreparation")
            .and_then(|v| v.as_f64()),
        flip_angle: sidecar.get("FlipAngle").cloned(),
        slice_timing: sidecar.get("SliceTiming").cloned(),
        pulse_sequence_type: sidecar
            .get("PulseSequenceType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        manufacturer: sidecar
            .get("Manufacturer")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        m0_type: Some(m0_type.to_string()),
        m0_gm_scale_factor: sidecar.get("M0_GMScaleFactor").and_then(|v| v.as_f64()),
        asl_context: asl_context.map(|s| s.to_string()),
        dataset_type: sidecar
            .get("DatasetType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        labeling_type: sidecar
            .get("LabelingType")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        dummy_scan_position_in_asl4d: sidecar.get("DummyScanPositionInASL4D").cloned(),
        repetition_time_preparation_m0: sidecar.get("RepetitionTimePreparationM0").cloned(),
    }
}

/// Group subjects by fingerprint hash.
///
/// Iterates sidecars, parses, injects ASL context, extracts fingerprint, hashes, groups.
/// Skipped = subjects with perf but missing sidecar or missing/unparseable aslcontext.tsv.
pub fn group_by_fingerprint(
    sidecar_paths: &[PathBuf],
    subjects: &[BidsSubject],
) -> Result<BidsSidecarScan, String> {
    // Map: hash → (SidecarGroup-under-construction, first sidecar JSON)
    use std::collections::BTreeMap;

    // We'll collect: hash → (group_data, first_subject_context, first_sidecar)
    struct GroupAccum {
        fingerprint_hash: String,
        subjects: Vec<GroupSubject>,
        first_context: Option<String>,
        first_sidecar: Option<Value>,
        // Per-spec D8: the group's M0Type is the DERIVED value for the first
        // subject in the group. Stored separately because the fingerprint
        // hash already reflects derived M0Type for each subject (see loop
        // below), so we can't re-derive after grouping without per-subject
        // filesystem access — and the first subject is the canonical specimen.
        first_m0_type: Option<String>,
    }

    let mut groups_map: BTreeMap<String, GroupAccum> = BTreeMap::new();
    let mut skipped = Vec::new();
    let mut invalid_sessions = std::collections::HashSet::new();

    // Pre-scan sessions for missing or unparseable sidecars, or missing aslcontext (Gap C Fix)
    for subject in subjects {
        for session in &subject.sessions {
            if !session.has_perf {
                continue;
            }
            if session.asl_files.is_empty() {
                continue;
            }

            let key = format!("{}_{}", subject.subject_label, session.session_label);
            let mut is_invalid = session.asl_sidecars.len() < session.asl_files.len();

            if !is_invalid {
                for sc in &session.asl_sidecars {
                    let sc_path = Path::new(sc);
                    if find_asl_context_for(sc_path).is_none() {
                        is_invalid = true;
                        break;
                    }
                    if parse_sidecar(sc_path).is_err() {
                        is_invalid = true;
                        break;
                    }
                }
            }

            if is_invalid {
                skipped.push(key.clone());
                invalid_sessions.insert(key);
            }
        }
    }

    // Track which subjects have been processed
    let mut processed_subject_sessions: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    for sidecar_path in sidecar_paths {
        let Some((subject, session)) = find_subject_for_sidecar(sidecar_path, subjects) else {
            // Sidecar not in any subject's asl_sidecars — skip
            continue;
        };

        let subject_session_key = format!("{}_{}", subject.subject_label, session.session_label);
        if invalid_sessions.contains(&subject_session_key) {
            continue;
        }
        processed_subject_sessions.insert(subject_session_key.clone());

        // Parse sidecar
        let sidecar = match parse_sidecar(sidecar_path) {
            Ok(s) => s,
            Err(_) => {
                // Should already be handled by pre-scan, but keeping as safeguard
                if invalid_sessions.insert(subject_session_key.clone()) {
                    skipped.push(subject_session_key);
                }
                continue;
            }
        };

        // Find and parse ASL context
        let ctx_path = find_asl_context_for(sidecar_path);
        let asl_context = match ctx_path {
            Some(ref p) => match std::fs::read_to_string(p) {
                Ok(content) => {
                    // Parse volume types from TSV
                    let mut types = Vec::new();
                    for (i, line) in content.lines().enumerate() {
                        if i == 0 {
                            continue;
                        }
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        types.push(line.split('\t').next().unwrap_or(line).trim().to_string());
                    }
                    Some(types.join(","))
                }
                Err(_) => {
                    if invalid_sessions.insert(subject_session_key.clone()) {
                        skipped.push(subject_session_key);
                    }
                    continue;
                }
            },
            None => {
                // Missing aslcontext.tsv — skip this subject/session
                if invalid_sessions.insert(subject_session_key.clone()) {
                    skipped.push(subject_session_key);
                }
                continue;
            }
        };

        // Inject ASLContext into sidecar params
        let mut params = sidecar.as_object().cloned().unwrap_or_default();
        if let Some(ref ctx) = asl_context {
            params.insert("ASLContext".to_string(), Value::String(ctx.clone()));
        }

        // Derive M0Type per-subject BEFORE fingerprinting (D8 spec rule):
        // sidecar's M0Type is NOT trusted for fingerprinting except Estimate.
        // The derived value governs the group hash so subjects with the same
        // scanner/sequence (but different raw sidecar M0Type labels caused by
        // converter inconsistency) still group together.
        let sidecar_m0type = sidecar.get("M0Type").and_then(|v| v.as_str());
        let perf_path = sidecar_path.parent().unwrap_or(Path::new("."));
        let derived_m0 = derive_m0_type(perf_path, asl_context.as_deref(), sidecar_m0type);

        // Extract fingerprint, then override M0Type entry with the derived
        // value so the hash reflects the DERIVED M0Type, not the raw sidecar
        // string.
        let mut fp = extract_fingerprint(&sidecar);
        fp.insert("M0Type".to_string(), Value::String(derived_m0.clone()));
        let hash = compute_group_hash(&fp);

        // Add to group
        let group = groups_map
            .entry(hash.clone())
            .or_insert_with(|| GroupAccum {
                fingerprint_hash: hash,
                subjects: Vec::new(),
                first_context: asl_context.clone(),
                first_sidecar: Some(sidecar.clone()),
                first_m0_type: Some(derived_m0.clone()),
            });

        group.subjects.push(GroupSubject {
            subject_label: subject.subject_label.clone(),
            session_labels: vec![session.session_label.clone()],
        });
    }

    // Merge duplicate GroupSubject entries by subject_label
    for accum in groups_map.values_mut() {
        merge_group_subjects(&mut accum.subjects);
    }

    // Now check for subjects with perf but no sidecar in sidecar_paths
    for subject in subjects {
        for session in &subject.sessions {
            if !session.has_perf {
                continue;
            }
            let key = format!("{}_{}", subject.subject_label, session.session_label);
            if invalid_sessions.contains(&key) {
                continue;
            }
            if !processed_subject_sessions.contains(&key) && session.asl_files.is_empty() {
                // Subject has perf dir but no ASL files — not skipped, just no data
                continue;
            }
            if !processed_subject_sessions.contains(&key) && !session.asl_files.is_empty() {
                // Subject has ASL files but no sidecar in sidecar_paths
                skipped.push(key);
            }
        }
    }

    // Build final groups
    let mut groups = Vec::new();
    for (_hash, accum) in groups_map {
        let first_sidecar = accum
            .first_sidecar
            .unwrap_or(Value::Object(serde_json::Map::new()));

        // Derive vendor, sequence, labeling_type, m0_type from first sidecar
        let manufacturer = first_sidecar.get("Manufacturer").and_then(|v| v.as_str());
        let vendor = derive_vendor(manufacturer);

        let acq_type = first_sidecar
            .get("MRAcquisitionType")
            .and_then(|v| v.as_str());
        let pulse_seq_raw = first_sidecar
            .get("PulseSequenceType")
            .and_then(|v| v.as_str());
        let pulse_seq = pulse_seq_raw.and_then(normalize_pulse_sequence_for_fingerprint);
        let sequence = derive_sequence(acq_type, pulse_seq.as_deref());

        let asl_type = first_sidecar
            .get("ArterialSpinLabelingType")
            .and_then(|v| v.as_str());
        let labeling_type = derive_labeling_type(asl_type);

        // Use the derived M0Type cached for the first subject (D8). Avoids
        // re-deriving post-hoc, which would only have access to the first
        // subject's filesystem state.
        let m0_type = accum.first_m0_type.unwrap_or_else(|| "Absent".to_string());
        let asl_context_str = accum.first_context.as_deref();

        let bids_params = derive_bids_metadata(&first_sidecar, &m0_type, asl_context_str);

        // Use canonical vendor name (substring-derived) per spec wording:
        // "Manufacturer: canonical vendor name from substring detection".
        // Passing raw manufacturer sidecar string would yield labels like
        // "SIEMENS_3T_..." when sidecars contain uppercased vendor strings.
        // Treat "UnknownVendor" as missing so the slot is omitted rather
        // than producing an "Unknown" placeholder per spec.
        let canonical_vendor_for_label = if vendor == "UnknownVendor" {
            None
        } else {
            Some(vendor.as_str())
        };
        let label = suggest_label(
            canonical_vendor_for_label,
            first_sidecar
                .get("MagneticFieldStrength")
                .and_then(|v| v.as_f64()),
            asl_type,
            acq_type,
            Some(&m0_type),
        );

        groups.push(SidecarGroup {
            fingerprint_hash: accum.fingerprint_hash,
            label,
            vendor,
            sequence,
            labeling_type,
            bids_params,
            subjects: accum.subjects,
        });
    }

    // Deduplicate skipped
    skipped.sort();
    skipped.dedup();

    // Apply label collision resolution (D16)
    apply_label_collisions(&mut groups);

    log::info!(
        "group_by_fingerprint: {} groups, {} skipped, {} sidecars processed",
        groups.len(),
        skipped.len(),
        sidecar_paths.len()
    );

    Ok(BidsSidecarScan { groups, skipped })
}

/// Merge duplicate GroupSubject entries, accumulating session_labels.
fn merge_group_subjects(subjects: &mut Vec<GroupSubject>) {
    use std::collections::BTreeMap;

    let mut merged: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for subject in subjects.drain(..) {
        let entry = merged.entry(subject.subject_label).or_default();
        for session in subject.session_labels {
            if !entry.contains(&session) {
                entry.push(session);
            }
        }
    }

    for (subject_label, mut session_labels) in merged {
        session_labels.sort();
        subjects.push(GroupSubject {
            subject_label,
            session_labels,
        });
    }
    subjects.sort_by(|a, b| a.subject_label.cmp(&b.subject_label));
}

/// Apply label collision resolution per D16.
///
/// When multiple groups produce the same auto-suggested label:
/// - Sort groups by subject count DESC
/// - Tiebreak by sorted subject list head alphabetically
/// - Tertiary tiebreak by full sorted subject list
/// - First group retains unadorned label
/// - Subsequent groups get _(2), _(3), etc.
fn apply_label_collisions(groups: &mut [SidecarGroup]) {
    // Group indices by label
    let mut label_to_indices: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (i, group) in groups.iter().enumerate() {
        label_to_indices
            .entry(group.label.clone())
            .or_default()
            .push(i);
    }

    for indices in label_to_indices.values() {
        if indices.len() <= 1 {
            continue;
        }
        log::info!(
            "apply_label_collisions: collision on '{}' with {} groups",
            groups[indices[0]].label,
            indices.len()
        );

        // Sort indices by: subject count DESC, then sorted subject head, then full sorted subjects
        let mut sorted_indices = indices.clone();
        sorted_indices.sort_by(|&a, &b| {
            let ga = &groups[a];
            let gb = &groups[b];

            // Subject count DESC
            let count_cmp = gb.subjects.len().cmp(&ga.subjects.len());
            if count_cmp != std::cmp::Ordering::Equal {
                return count_cmp;
            }

            // Tiebreak: sorted subject head alphabetically
            let mut heads_a: Vec<&str> = ga
                .subjects
                .iter()
                .map(|s| s.subject_label.as_str())
                .collect();
            let mut heads_b: Vec<&str> = gb
                .subjects
                .iter()
                .map(|s| s.subject_label.as_str())
                .collect();
            heads_a.sort();
            heads_b.sort();

            let head_cmp = heads_a.first().cmp(&heads_b.first());
            if head_cmp != std::cmp::Ordering::Equal {
                return head_cmp;
            }

            // Tertiary: full sorted subject list
            heads_a.cmp(&heads_b)
        });

        // First keeps unadorned label, rest get _(2), _(3), etc.
        for (rank, &idx) in sorted_indices.iter().enumerate().skip(1) {
            groups[idx].label = format!("{}_({})", groups[idx].label, rank + 1);
        }
    }
}

#[cfg(test)]
mod tests {
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

        let sidecar_paths = vec![perf1.join("sub-01_asl.json"), perf2.join("sub-02_asl.json")];

        let subjects = vec![
            BidsSubject {
                subject_label: "sub-01".to_string(),
                subject_dir: root.join("sub-01").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf1
                            .join("sub-01_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![perf1.join("sub-01_asl.json").to_string_lossy().to_string()],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
            BidsSubject {
                subject_label: "sub-02".to_string(),
                subject_dir: root.join("sub-02").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf2
                            .join("sub-02_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![perf2.join("sub-02_asl.json").to_string_lossy().to_string()],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
        ];

        let result = group_by_fingerprint(&sidecar_paths, &subjects).unwrap();
        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.groups[0].subjects.len(), 2);
        assert!(result.skipped.is_empty());
    }

    #[test]
    fn test_group_by_fingerprint_multi_group() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let sidecar1 =
            r#"{"MagneticFieldStrength": 3, "Manufacturer": "Siemens", "EchoTime": 0.014}"#;
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

        let sidecar_paths = vec![perf1.join("sub-01_asl.json"), perf2.join("sub-02_asl.json")];

        let subjects = vec![
            BidsSubject {
                subject_label: "sub-01".to_string(),
                subject_dir: root.join("sub-01").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf1
                            .join("sub-01_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![perf1.join("sub-01_asl.json").to_string_lossy().to_string()],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
            BidsSubject {
                subject_label: "sub-02".to_string(),
                subject_dir: root.join("sub-02").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf2
                            .join("sub-02_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![perf2.join("sub-02_asl.json").to_string_lossy().to_string()],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
        ];

        let result = group_by_fingerprint(&sidecar_paths, &subjects).unwrap();
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

        let sidecar_paths = vec![perf1.join("sub-01_asl.json")];

        let subjects = vec![
            BidsSubject {
                subject_label: "sub-01".to_string(),
                subject_dir: root.join("sub-01").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf1
                            .join("sub-01_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![perf1.join("sub-01_asl.json").to_string_lossy().to_string()],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
            BidsSubject {
                subject_label: "sub-02".to_string(),
                subject_dir: root.join("sub-02").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf2
                            .join("sub-02_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![],
                    has_m0: false,
                    anat_files: vec![],
                }],
            },
        ];

        let result = group_by_fingerprint(&sidecar_paths, &subjects).unwrap();
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

        let sidecar_paths = vec![perf1.join("sub-01_run-1_asl.json")];

        let subjects = vec![BidsSubject {
            subject_label: "sub-01".to_string(),
            subject_dir: root.join("sub-01").to_string_lossy().to_string(),
            sessions: vec![BidsSession {
                session_label: "1".to_string(),
                session_dir: None,
                has_explicit_session: false,
                has_perf: true,
                has_anat: false,
                asl_files: vec![
                    crate::bids::scan::AslFile {
                        path: perf1
                            .join("sub-01_run-1_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: Some("1".to_string()),
                        acquisition_label: None,
                    },
                    crate::bids::scan::AslFile {
                        path: perf1
                            .join("sub-01_run-2_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: Some("2".to_string()),
                        acquisition_label: None,
                    },
                ],
                asl_sidecars: vec![
                    perf1
                        .join("sub-01_run-1_asl.json")
                        .to_string_lossy()
                        .to_string(),
                ],
                has_m0: false,
                anat_files: vec![],
            }],
        }];

        let result = group_by_fingerprint(&sidecar_paths, &subjects).unwrap();
        assert_eq!(result.groups.len(), 0);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0], "sub-01_1");
    }

    #[test]
    fn test_group_by_fingerprint_derived_m0type_governs_over_raw_sidecar_label() {
        // D8 spec scenario: sidecar's M0Type (non-Estimate) is NOT trusted for
        // fingerprinting — the derived value governs. Two subjects with
        // different raw sidecar M0Type strings but identical derived M0Type
        // (and identical other 14 fingerprint fields) MUST group together.
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

        let sidecar_paths = vec![
            perf_a.join("sub-01_asl.json"),
            perf_b.join("sub-02_asl.json"),
        ];

        let subjects = vec![
            BidsSubject {
                subject_label: "sub-01".to_string(),
                subject_dir: root.join("sub-01").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf_a
                            .join("sub-01_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![
                        perf_a.join("sub-01_asl.json").to_string_lossy().to_string(),
                    ],
                    has_m0: true,
                    anat_files: vec![],
                }],
            },
            BidsSubject {
                subject_label: "sub-02".to_string(),
                subject_dir: root.join("sub-02").to_string_lossy().to_string(),
                sessions: vec![BidsSession {
                    session_label: "1".to_string(),
                    session_dir: None,
                    has_explicit_session: false,
                    has_perf: true,
                    has_anat: false,
                    asl_files: vec![crate::bids::scan::AslFile {
                        path: perf_b
                            .join("sub-02_asl.nii.gz")
                            .to_string_lossy()
                            .to_string(),
                        run_label: None,
                        acquisition_label: None,
                    }],
                    asl_sidecars: vec![
                        perf_b.join("sub-02_asl.json").to_string_lossy().to_string(),
                    ],
                    has_m0: true,
                    anat_files: vec![],
                }],
            },
        ];

        let result = group_by_fingerprint(&sidecar_paths, &subjects).unwrap();
        // Both subjects have identical other-14 fingerprint fields and both
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
}
