use crate::bids::path::{is_subject_dir, resolve_sessions};
use anyhow::{Context, Result as AnyResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
pub fn parse_bids_structure(bids_root: &Path) -> AnyResult<Vec<BidsSubject>> {
    let mut subjects = Vec::new();

    let entries = std::fs::read_dir(bids_root)
        .with_context(|| format!("Failed to read BIDS root {}", bids_root.display()))?;

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

            let (asl_files, has_m0, _) = if has_perf {
                scan_perf_dir(&perf_path)
            } else {
                (Vec::new(), false, Vec::new())
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

/// Scan a `perf/` directory for ASL images, M0, and structural files.
fn scan_perf_dir(perf_path: &Path) -> (Vec<AslFile>, bool, Vec<String>) {
    let mut asl_files = Vec::new();
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
            } else if is_m0_file(&name) {
                has_m0 = true;
            } else if is_anat_file(&name) {
                anat_files.push(path_str);
            }
        }
    }

    (asl_files, has_m0, anat_files)
}

#[cfg(test)]
#[path = "tests/scan.rs"]
mod tests;
