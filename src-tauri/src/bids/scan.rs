use crate::bids::path::{is_subject_dir, resolve_sessions};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsSubject {
    pub subject_label: String,
    pub subject_dir: String,
    pub sessions: Vec<BidsSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsSession {
    pub session_label: String,
    pub session_dir: Option<String>,
    pub has_explicit_session: bool,
    pub has_perf: bool,
    pub has_anat: bool,
    pub asl_files: Vec<AslFile>,
    pub asl_sidecars: Vec<String>,
    pub has_m0: bool,
    pub anat_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AslFile {
    pub path: String,
    pub run_label: Option<String>,
    pub acquisition_label: Option<String>,
}

/// Scan a BIDS directory structure and return structured subject/session info.
///
/// Path-agnostic: scans whatever path it receives for `sub-*/` directories.
/// Handles cross-sectional (sub-*/perf/) and longitudinal (sub-*/ses-*/perf/) layouts.
pub fn parse_bids_structure(bids_root: &Path) -> Result<Vec<BidsSubject>, String> {
    let mut subjects = Vec::new();

    let entries = std::fs::read_dir(bids_root)
        .map_err(|e| format!("Failed to read BIDS root {}: {}", bids_root.display(), e))?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_subject_dir(&name) {
            continue;
        }

        let subject_dir = entry.path();
        let subject_label = name.clone();

        let subject_anat_files = scan_anat_dir(&subject_dir.join("anat"));

        let session_labels = resolve_sessions(&subject_dir);
        let mut sessions = Vec::new();

        for resolved in session_labels {
            let has_explicit_session = resolved.has_explicit_session;
            let ses_label = resolved.session_label;

            let (session_dir_path, has_explicit_dir) = if has_explicit_session {
                (Some(subject_dir.join(format!("ses-{}", ses_label))), true)
            } else {
                (None, false)
            };

            let base_path = if let Some(ref sd) = session_dir_path {
                sd.clone()
            } else {
                subject_dir.clone()
            };

            let perf_path = base_path.join("perf");
            let has_perf = perf_path.is_dir();
            let session_anat_path = base_path.join("anat");
            let session_anat_files = scan_anat_dir(&session_anat_path);
            let mut anat_files = session_anat_files.clone();
            if anat_files.is_empty() {
                anat_files = subject_anat_files.clone();
            }
            let has_anat = !anat_files.is_empty();

            let (asl_files, asl_sidecars, has_m0, _) = if has_perf {
                scan_perf_dir(&perf_path)
            } else {
                (Vec::new(), Vec::new(), false, Vec::new())
            };

            sessions.push(BidsSession {
                session_label: ses_label,
                session_dir: if has_explicit_dir {
                    Some(base_path.to_string_lossy().to_string())
                } else {
                    None
                },
                has_explicit_session: has_explicit_dir,
                has_perf,
                has_anat,
                asl_files,
                asl_sidecars,
                has_m0,
                anat_files,
            });
        }

        subjects.push(BidsSubject {
            subject_label,
            subject_dir: subject_dir.to_string_lossy().to_string(),
            sessions,
        });
    }

    log::debug!(
        "parse_bids_structure: {} subjects from {}",
        subjects.len(),
        bids_root.display()
    );

    Ok(subjects)
}

/// Extract run label from filename if `run-XX` entity present.
fn extract_run_label(filename: &str) -> Option<String> {
    let stem = if let Some(s) = filename.strip_suffix(".nii.gz") {
        s
    } else if let Some(s) = filename.strip_suffix(".json") {
        s
    } else if let Some(pos) = filename.rfind('.') {
        &filename[..pos]
    } else {
        filename
    };

    for part in stem.split('_') {
        if let Some(val) = part.strip_prefix("run-") {
            return Some(val.to_string());
        }
    }
    None
}

/// Extract acquisition label from filename if `acq-XX` entity present.
fn extract_acquisition_label(filename: &str) -> Option<String> {
    let stem = if let Some(s) = filename.strip_suffix(".nii.gz") {
        s
    } else if let Some(s) = filename.strip_suffix(".json") {
        s
    } else if let Some(pos) = filename.rfind('.') {
        &filename[..pos]
    } else {
        filename
    };

    for part in stem.split('_') {
        if let Some(val) = part.strip_prefix("acq-") {
            return Some(val.to_string());
        }
    }
    None
}

/// Check if filename is an ASL NIfTI file.
fn is_asl_nifti(name: &str) -> bool {
    name.ends_with("_asl.nii") || name.ends_with("_asl.nii.gz")
}

/// Check if filename is an ASL sidecar JSON.
fn is_asl_json(name: &str) -> bool {
    name.ends_with("_asl.json")
}

/// Check if filename is an M0 scan file.
fn is_m0_file(name: &str) -> bool {
    name.ends_with("_m0scan.nii")
        || name.ends_with("_m0scan.nii.gz")
        || name.ends_with("_m0scan.json")
}

/// Check if filename is a T1w structural.
fn is_t1w(name: &str) -> bool {
    name.ends_with("_T1w.nii") || name.ends_with("_T1w.nii.gz")
}

/// Check if filename is a T2w structural.
fn is_t2w(name: &str) -> bool {
    name.ends_with("_T2w.nii") || name.ends_with("_T2w.nii.gz")
}

/// Check if filename is a FLAIR structural.
fn is_flair(name: &str) -> bool {
    name.ends_with("_FLAIR.nii") || name.ends_with("_FLAIR.nii.gz")
}

/// Check if filename is any structural file.
fn is_anat_file(name: &str) -> bool {
    is_t1w(name) || is_t2w(name) || is_flair(name)
}

/// Scan an `anat/` directory for structural NIfTI files.
fn scan_anat_dir(anat_path: &Path) -> Vec<String> {
    let mut anat_files = Vec::new();
    if !anat_path.is_dir() {
        return anat_files;
    }
    if let Ok(entries) = std::fs::read_dir(anat_path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_anat_file(&name) {
                anat_files.push(entry.path().to_string_lossy().to_string());
            }
        }
    }
    anat_files.sort();
    anat_files
}

/// Scan a `perf/` directory for ASL files, sidecars, M0, and structural files.
fn scan_perf_dir(perf_path: &Path) -> (Vec<AslFile>, Vec<String>, bool, Vec<String>) {
    let mut asl_files = Vec::new();
    let mut asl_sidecars = Vec::new();
    let mut has_m0 = false;
    let mut anat_files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(perf_path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path_str = entry.path().to_string_lossy().to_string();

            if is_asl_nifti(&name) {
                asl_files.push(AslFile {
                    path: path_str,
                    run_label: extract_run_label(&name),
                    acquisition_label: extract_acquisition_label(&name),
                });
            } else if is_asl_json(&name) {
                asl_sidecars.push(path_str);
            } else if is_m0_file(&name) {
                has_m0 = true;
            } else if is_anat_file(&name) {
                anat_files.push(path_str);
            }
        }
    }

    (asl_files, asl_sidecars, has_m0, anat_files)
}

/// Resolve the JSON sidecar path for an ASL NIfTI file.
pub fn asl_json_path_for(nii_path: &Path) -> PathBuf {
    if let Some(path_str) = nii_path.to_str() {
        if let Some(base) = path_str.strip_suffix(".nii.gz") {
            return PathBuf::from(format!("{}.json", base));
        }
        if let Some(base) = path_str.strip_suffix(".nii") {
            return PathBuf::from(format!("{}.json", base));
        }
    }
    nii_path.with_extension("json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_cross_sectional_dataset(root: &Path) {
        let sub = root.join("sub-01");
        let perf = sub.join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
        fs::write(
            perf.join("sub-01_aslcontext.tsv"),
            b"volume_type\ncontrol\nlabel\n",
        )
        .unwrap();

        let sub2 = root.join("sub-02");
        let perf2 = sub2.join("perf");
        fs::create_dir_all(&perf2).unwrap();
        fs::write(perf2.join("sub-02_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf2.join("sub-02_asl.json"), b"{}").unwrap();
    }

    fn create_longitudinal_dataset(root: &Path) {
        let ses1_perf = root.join("sub-01").join("ses-01").join("perf");
        let ses2_perf = root.join("sub-01").join("ses-02").join("perf");
        fs::create_dir_all(&ses1_perf).unwrap();
        fs::create_dir_all(&ses2_perf).unwrap();
        fs::write(ses1_perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(ses1_perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();
        fs::write(ses2_perf.join("sub-01_ses-02_asl.nii.gz"), b"fake").unwrap();
        fs::write(ses2_perf.join("sub-01_ses-02_asl.json"), b"{}").unwrap();
    }

    #[test]
    fn test_parse_bids_structure_cross_sectional_default_session() {
        let tmp = TempDir::new().unwrap();
        create_cross_sectional_dataset(tmp.path());

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        assert_eq!(subjects.len(), 2);

        let sub01 = subjects
            .iter()
            .find(|s| s.subject_label == "sub-01")
            .unwrap();
        assert_eq!(sub01.sessions.len(), 1);
        assert_eq!(sub01.sessions[0].session_label, "1");
        assert!(!sub01.sessions[0].has_explicit_session);
        assert!(sub01.sessions[0].has_perf);
        assert_eq!(sub01.sessions[0].asl_files.len(), 1);
    }

    #[test]
    fn test_parse_bids_structure_longitudinal_sessions() {
        let tmp = TempDir::new().unwrap();
        create_longitudinal_dataset(tmp.path());

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        assert_eq!(subjects.len(), 1);

        let sub01 = &subjects[0];
        assert_eq!(sub01.sessions.len(), 2);

        let labels: Vec<&str> = sub01
            .sessions
            .iter()
            .map(|s| s.session_label.as_str())
            .collect();
        assert!(labels.contains(&"01"));
        assert!(labels.contains(&"02"));
        assert!(sub01.sessions.iter().all(|s| s.has_explicit_session));
    }

    #[test]
    fn test_parse_bids_structure_explicit_ses1() {
        // Phase 11.3 edge case: explicit `ses-1` directory —
        // `has_explicit_session = true` while `session_label = "1"`.
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("ses-1").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_ses-1_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_ses-1_asl.json"), b"{}").unwrap();

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        assert_eq!(subjects.len(), 1);
        // parse_bids_structure stores the directory name including the
        // `sub-` prefix; the frontend strips it via stripSubjectPrefix when
        // emitting SubjectRow.subject.
        assert_eq!(subjects[0].subject_label, "sub-01");
        assert_eq!(subjects[0].sessions.len(), 1);
        assert_eq!(subjects[0].sessions[0].session_label, "1");
        assert!(subjects[0].sessions[0].has_explicit_session);
        assert!(subjects[0].sessions[0].has_perf);
    }

    #[test]
    fn test_parse_bids_structure_subject_anat_inherited_by_session() {
        let tmp = TempDir::new().unwrap();
        let anat = tmp.path().join("sub-01").join("anat");
        fs::create_dir_all(&anat).unwrap();
        fs::write(anat.join("sub-01_T1w.nii.gz"), b"fake").unwrap();

        let perf = tmp.path().join("sub-01").join("ses-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_ses-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_ses-01_asl.json"), b"{}").unwrap();

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        let session = &subjects[0].sessions[0];
        assert!(session.has_anat);
        assert_eq!(session.anat_files.len(), 1);
        assert!(session.anat_files[0].contains("_T1w.nii.gz"));
    }

    #[test]
    fn test_parse_bids_structure_skips_non_sub_dirs() {
        let tmp = TempDir::new().unwrap();

        fs::create_dir(tmp.path().join("derivatives")).unwrap();
        fs::create_dir(tmp.path().join("sourcedata")).unwrap();
        fs::create_dir(tmp.path().join("notes")).unwrap();
        fs::create_dir(tmp.path().join("rawdata")).unwrap();

        create_cross_sectional_dataset(tmp.path());

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        assert_eq!(subjects.len(), 2);
        assert!(subjects.iter().all(|s| s.subject_label.starts_with("sub-")));
    }

    #[test]
    fn test_parse_bids_structure_with_m0_file() {
        let tmp = TempDir::new().unwrap();
        let perf = tmp.path().join("sub-01").join("perf");
        fs::create_dir_all(&perf).unwrap();
        fs::write(perf.join("sub-01_asl.nii.gz"), b"fake").unwrap();
        fs::write(perf.join("sub-01_asl.json"), b"{}").unwrap();
        fs::write(perf.join("sub-01_m0scan.nii.gz"), b"fake").unwrap();

        let subjects = parse_bids_structure(tmp.path()).unwrap();
        assert_eq!(subjects.len(), 1);
        assert!(subjects[0].sessions[0].has_m0);
    }

    #[test]
    fn test_extract_run_label_present() {
        assert_eq!(
            extract_run_label("sub-01_run-2_asl.nii.gz"),
            Some("2".to_string())
        );
        assert_eq!(
            extract_run_label("sub-01_ses-01_run-01_asl.json"),
            Some("01".to_string())
        );
    }

    #[test]
    fn test_extract_run_label_absent() {
        assert_eq!(extract_run_label("sub-01_asl.nii.gz"), None);
    }

    #[test]
    fn test_extract_acquisition_label() {
        assert_eq!(
            extract_acquisition_label("sub-01_acq-highres_asl.nii.gz"),
            Some("highres".to_string())
        );
        assert_eq!(extract_acquisition_label("sub-01_asl.nii.gz"), None);
    }

    #[test]
    fn test_asl_json_path_for_nii_gz() {
        let path = PathBuf::from("/data/sub-01_asl.nii.gz");
        assert_eq!(
            asl_json_path_for(&path),
            PathBuf::from("/data/sub-01_asl.json")
        );
    }
}
