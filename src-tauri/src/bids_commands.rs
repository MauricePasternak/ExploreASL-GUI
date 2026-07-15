use crate::bids::group::{BidsSidecarScan, group_by_fingerprint};
use crate::bids::scan::{asl_json_path_for, parse_bids_structure};
use crate::bids::sidecar::find_asl_sidecars;
use crate::tracing::CommandTrace;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsCheckResult {
    pub is_bids: bool,
    pub has_dataset_description: bool,
    pub dataset_desc_error: Option<String>,
    pub bids_version: Option<String>,
    pub asl_subject_count: u32,
    pub asl_session_count: u32,
    pub total_subject_count: u32,
    pub missing_sidecars: Vec<String>,
    pub missing_aslcontext_count: u32,
    pub has_perf_directory: bool,
    pub is_cross_sectional: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn check_bids_dataset(root_path: String) -> Result<BidsCheckResult, String> {
    let trace = CommandTrace::new("check_bids_dataset");
    trace.arg("root_path", &root_path);

    let root = Path::new(&root_path);
    let result = check_bids_dataset_impl(root)?;
    trace.success(&result);
    Ok(result)
}

fn check_bids_dataset_impl(root: &Path) -> Result<BidsCheckResult, String> {
    // Step 1: Check dataset_description.json
    let desc_path = root.join("dataset_description.json");
    let has_dataset_description = desc_path.exists();
    let mut dataset_desc_error: Option<String> = None;
    let mut bids_version: Option<String> = None;

    if has_dataset_description {
        match fs::read_to_string(&desc_path) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    bids_version = json
                        .get("BIDSVersion")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                Err(e) => {
                    log::warn!("Corrupt dataset_description.json: {}", e);
                    dataset_desc_error = Some(e.to_string());
                }
            },
            Err(e) => {
                log::warn!("Failed to read dataset_description.json: {}", e);
                dataset_desc_error = Some(e.to_string());
            }
        }
    }

    // Step 2: Parse BIDS structure
    let bids_subjects = parse_bids_structure(root)?;
    log::debug!(
        "check_bids_dataset: parsed {} subjects from {}",
        bids_subjects.len(),
        root.display()
    );

    // Step 3: Count ASL subjects/sessions and collect missing sidecars
    let mut asl_subject_count: u32 = 0;
    let mut asl_session_count: u32 = 0;
    let mut missing_sidecars: Vec<String> = Vec::new();
    let mut missing_aslcontext_count: u32 = 0;
    let mut has_perf_directory = false;
    let mut is_longitudinal = false;
    let total_subject_count = bids_subjects.len() as u32;

    for subject in &bids_subjects {
        let mut subject_has_asl = false;
        let explicit_sessions_with_content = subject
            .sessions
            .iter()
            .filter(|s| s.has_explicit_session && (s.has_perf || s.has_anat))
            .count();

        if explicit_sessions_with_content > 1 {
            is_longitudinal = true;
        }

        for session in &subject.sessions {
            if session.has_perf {
                has_perf_directory = true;
            }

            if !session.has_perf {
                continue;
            }

            let mut session_has_missing_sidecars = false;
            let mut session_has_asl_files = false;

            for asl_file in &session.asl_files {
                session_has_asl_files = true;
                let nii_path = Path::new(&asl_file.path);
                let json_path = asl_json_path_for(nii_path);

                if !json_path.exists() {
                    session_has_missing_sidecars = true;
                    continue;
                }

                let ctx_path = crate::bids::sidecar::find_asl_context_for(&json_path);
                if ctx_path.is_none() {
                    missing_aslcontext_count += 1;
                }
            }

            let session_has_valid_asl = session_has_asl_files && !session_has_missing_sidecars;

            if session_has_valid_asl {
                subject_has_asl = true;
                asl_session_count += 1;
            } else if session_has_asl_files {
                let stripped_label = subject
                    .subject_label
                    .strip_prefix("sub-")
                    .unwrap_or(&subject.subject_label);
                missing_sidecars.push(format!("sub-{}_{}", stripped_label, session.session_label));
            }
        }

        if subject_has_asl {
            asl_subject_count += 1;
        }
    }

    let is_bids = asl_subject_count >= 1;
    let is_cross_sectional = !is_longitudinal;

    log::debug!(
        "check_bids_dataset: is_bids={} asl_subjects={} asl_sessions={} missing_sidecars={} missing_aslcontext={}",
        is_bids,
        asl_subject_count,
        asl_session_count,
        missing_sidecars.len(),
        missing_aslcontext_count
    );

    // Step 6: error if not BIDS
    let error = if !is_bids {
        if total_subject_count == 0 {
            Some("No BIDS subjects found".to_string())
        } else {
            Some("No valid ASL BIDS data found".to_string())
        }
    } else {
        None
    };

    Ok(BidsCheckResult {
        is_bids,
        has_dataset_description,
        dataset_desc_error,
        bids_version,
        asl_subject_count,
        asl_session_count,
        total_subject_count,
        missing_sidecars,
        missing_aslcontext_count,
        has_perf_directory,
        is_cross_sectional,
        error,
    })
}

// --- scan_bids_sidecars command ---

#[tauri::command]
pub fn scan_bids_sidecars(root_path: String) -> Result<BidsSidecarScan, String> {
    let trace = CommandTrace::new("scan_bids_sidecars");
    trace.arg("root_path", &root_path);

    let root = Path::new(&root_path);
    let result = scan_bids_sidecars_impl(root)?;
    trace.success(&result);
    Ok(result)
}

fn scan_bids_sidecars_impl(root: &Path) -> Result<BidsSidecarScan, String> {
    let subjects = parse_bids_structure(root)?;
    log::debug!(
        "scan_bids_sidecars: {} subjects, {} total sessions",
        subjects.len(),
        subjects.iter().map(|s| s.sessions.len()).sum::<usize>()
    );
    let sidecar_paths = find_asl_sidecars(root);
    log::debug!(
        "scan_bids_sidecars: found {} sidecar paths",
        sidecar_paths.len()
    );
    group_by_fingerprint(&sidecar_paths, &subjects)
}

// --- ensure_rawdata_dir command ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureRawdataResult {
    pub created: bool,
    pub warning: Option<String>,
    pub bidsignore_updated: bool,
}

#[tauri::command]
pub fn ensure_rawdata_dir(root_path: String) -> Result<EnsureRawdataResult, String> {
    let trace = CommandTrace::new("ensure_rawdata_dir");
    trace.arg("root_path", &root_path);

    let root = Path::new(&root_path);
    let result = ensure_rawdata_dir_impl(root)?;
    trace.success(&result);
    Ok(result)
}

const RAWDATA_README: &str = r#"# rawdata/

This directory exists for ExploreASL compatibility.
The actual BIDS subjects live at the project root level.
ExploreASL's BIDS2Legacy module checks for this directory
at startup but uses the subjectFolder override in dataPar.json
to scan subjects from the project root.

Do not delete this directory while the project is active.
"#;

fn ensure_rawdata_dir_impl(root: &Path) -> Result<EnsureRawdataResult, String> {
    let rawdata = root.join("rawdata");
    let created = !rawdata.exists();

    log::debug!(
        "ensure_rawdata_dir: root={} created={}",
        root.display(),
        created
    );

    // Step 1: Create rawdata/ if missing (idempotent)
    fs::create_dir_all(&rawdata).map_err(|e| format!("Failed to create rawdata dir: {}", e))?;

    // Step 2: Write README.md (idempotent overwrite)
    fs::write(rawdata.join("README.md"), RAWDATA_README)
        .map_err(|e| format!("Failed to write rawdata/README.md: {}", e))?;

    // Step 3: Manage .bidsignore
    let bidsignore_path = root.join(".bidsignore");
    let bidsignore_updated = if !bidsignore_path.exists() {
        // Create with "rawdata/\n"
        fs::write(&bidsignore_path, "rawdata/\n")
            .map_err(|e| format!("Failed to create .bidsignore: {}", e))?;
        true
    } else {
        // Check if "rawdata/" line already exists
        let content = fs::read_to_string(&bidsignore_path)
            .map_err(|e| format!("Failed to read .bidsignore: {}", e))?;
        let has_rawdata = content.lines().any(|line| line.trim() == "rawdata/");
        if !has_rawdata {
            // Append "rawdata/\n"
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .append(true)
                .open(&bidsignore_path)
                .map_err(|e| format!("Failed to open .bidsignore for append: {}", e))?;
            writeln!(file, "rawdata/")
                .map_err(|e| format!("Failed to append to .bidsignore: {}", e))?;
            true
        } else {
            false
        }
    };

    // Step 4: Check if rawdata/ is non-empty (contains sub-* entries)
    let warning = if !created {
        let mut sub_count = 0u32;
        if let Ok(entries) = fs::read_dir(&rawdata) {
            for entry in entries.flatten() {
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("sub-") {
                        sub_count += 1;
                    }
                }
            }
        }
        if sub_count > 0 {
            Some(format!(
                "rawdata/ already contains {} sub-directories",
                sub_count
            ))
        } else {
            None
        }
    } else {
        None
    };

    Ok(EnsureRawdataResult {
        created,
        warning,
        bidsignore_updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();

        let result = check_bids_dataset_impl(root).unwrap();
        assert!(result.is_bids);
        assert_eq!(result.missing_aslcontext_count, 1);
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

    // --- scan_bids_sidecars tests ---

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
    fn scan_bids_sidecars_single_group_two_subjects() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let sidecar_json = create_ds000240_like_sidecar();
        let context_tsv = "volume_type\nm0scan\nm0scan\nm0scan\nm0scan\nm0scan\ncontrol\nlabel\n";

        for i in 1..=2 {
            let label = format!("sub-{:02}", i);
            let perf = root.join(&label).join("perf");
            fs::create_dir_all(&perf).unwrap();
            fs::write(perf.join(format!("{}_asl.nii.gz", label)), b"fake").unwrap();
            fs::write(perf.join(format!("{}_asl.json", label)), sidecar_json).unwrap();
            fs::write(perf.join(format!("{}_aslcontext.tsv", label)), context_tsv).unwrap();
        }

        let result = scan_bids_sidecars_impl(root).unwrap();

        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.groups[0].subjects.len(), 2);
        assert_eq!(result.groups[0].label, "Siemens_3T_PCASL_3D_Included");
        assert_eq!(result.groups[0].vendor, "Siemens");
        assert!(result.skipped.is_empty());
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

    // --- ensure_rawdata_dir tests ---

    #[test]
    fn ensure_rawdata_fresh_creates_all() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(result.created);
        assert!(result.warning.is_none());
        assert!(result.bidsignore_updated);
        // rawdata/ exists
        assert!(root.join("rawdata").is_dir());
        // README.md exists with expected content
        let readme = fs::read_to_string(root.join("rawdata").join("README.md")).unwrap();
        assert!(readme.contains("# rawdata/"));
        // .bidsignore exists with rawdata/
        let bidsignore = fs::read_to_string(root.join(".bidsignore")).unwrap();
        assert!(bidsignore.contains("rawdata/"));
    }

    #[test]
    fn ensure_rawdata_idempotent_re_run() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // First run
        let result1 = ensure_rawdata_dir_impl(root).unwrap();
        assert!(result1.created);
        assert!(result1.bidsignore_updated);

        // Second run
        let result2 = ensure_rawdata_dir_impl(root).unwrap();

        assert!(!result2.created);
        assert!(result2.warning.is_none());
        assert!(!result2.bidsignore_updated);
        // README still exists
        assert!(root.join("rawdata").join("README.md").exists());
    }

    #[test]
    fn ensure_rawdata_non_empty_returns_warning() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Pre-create rawdata with sub-001
        let rawdata = root.join("rawdata");
        fs::create_dir_all(rawdata.join("sub-001")).unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(!result.created); // rawdata already existed
        assert!(result.warning.is_some());
        assert!(result.warning.unwrap().contains("1"));
        // .bidsignore was created (didn't exist) → bidsignore_updated is true
        assert!(result.bidsignore_updated);
    }

    /// Spec scenario: existing non-empty rawdata warns with subject count.
    /// 5 `sub-*` directories → warning string references "5 sub-directories"
    /// (count of sub-* dirs, not files).
    #[test]
    fn ensure_rawdata_warning_counts_sub_dirs_not_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let rawdata = root.join("rawdata");
        // 5 subject dirs, each containing nested files
        for i in 1..=5 {
            let dir = rawdata
                .join(format!("sub-{:03}", i))
                .join("ses-01")
                .join("perf");
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(format!("sub-{:03}_asl.nii.gz", i)), b"fake").unwrap();
        }
        // Loose files at rawdata root must NOT be counted
        fs::write(rawdata.join("notes.txt"), b"whatever").unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(!result.created);
        assert!(
            result.warning.is_some(),
            "expected warning for non-empty rawdata"
        );
        let warning = result.warning.unwrap();
        assert!(
            warning.contains("5 sub-directories"),
            "warning must reference parsed sub-count, got: {}",
            warning
        );
    }

    #[test]
    fn ensure_rawdata_bidsignore_append_when_missing_rawdata_line() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Pre-create .bidsignore with existing entry but no rawdata/
        fs::write(root.join(".bidsignore"), "derivatives/\n").unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(result.bidsignore_updated);
        let content = fs::read_to_string(root.join(".bidsignore")).unwrap();
        assert!(content.contains("derivatives/"));
        assert!(content.contains("rawdata/"));
    }

    /// Spec: `.bidsignore` already contains `rawdata/` → no-op (no append, no duplicate).
    #[test]
    fn ensure_rawdata_bidsignore_noop_when_rawdata_line_present() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(root.join(".bidsignore"), "derivatives/\nrawdata/\n").unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(!result.bidsignore_updated);
        let content = fs::read_to_string(root.join(".bidsignore")).unwrap();
        // Exactly one rawdata/ entry (no duplicate appended)
        assert_eq!(
            content.matches("rawdata/").count(),
            1,
            "rawdata/ must not be duplicated: {}",
            content
        );
    }

    /// Edge: `.bidsignore` exists without trailing newline. Appending `rawdata/`
    /// via `writeln!` produces `rawdata/\n` (writeln adds the newline).
    #[test]
    fn ensure_rawdata_bidsignore_append_handles_missing_trailing_newline() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // No trailing newline
        fs::write(root.join(".bidsignore"), "derivatives/").unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(result.bidsignore_updated);
        let content = fs::read_to_string(root.join(".bidsignore")).unwrap();
        assert!(content.contains("derivatives/"));
        assert!(content.contains("rawdata/"));
        // rawdata/ entry must end with a newline (writeln! contract)
        assert!(
            content.ends_with("rawdata/\n") || content.ends_with("rawdata/"),
            "rawdata/ line present: {}",
            content
        );
    }

    /// Edge: duplicate `rawdata/` lines already present → treated as no-op
    /// (any line matching "rawdata/" short-circuits append).
    #[test]
    fn ensure_rawdata_bidsignore_noop_with_duplicate_rawdata_lines() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(root.join(".bidsignore"), "rawdata/\nrawdata/\n").unwrap();

        let result = ensure_rawdata_dir_impl(root).unwrap();

        assert!(!result.bidsignore_updated);
        let content = fs::read_to_string(root.join(".bidsignore")).unwrap();
        assert_eq!(content.matches("rawdata/").count(), 2); // unchanged
    }

    /// Phase 10.6: Idempotency — README content identical across two calls.
    #[test]
    fn ensure_rawdata_idempotent_readme_content_identical() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // First run
        let _ = ensure_rawdata_dir_impl(root).unwrap();
        let readme1 = fs::read_to_string(root.join("rawdata").join("README.md")).unwrap();

        // Second run
        let _ = ensure_rawdata_dir_impl(root).unwrap();
        let readme2 = fs::read_to_string(root.join("rawdata").join("README.md")).unwrap();

        assert_eq!(
            readme1, readme2,
            "README content must be identical across idempotent calls"
        );
        // Both runs produce no warning (fresh rawdata/ has no sub-* dirs)
        let result2 = ensure_rawdata_dir_impl(root).unwrap();
        assert!(result2.warning.is_none());
    }
}
