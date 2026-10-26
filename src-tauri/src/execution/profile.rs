//! Execution profile schema and UI-facing validation results.
//! Cancellable pre-launch checks live in launch; run policy stays in import/processing.
use super::apptainer::{
    detect_apptainer_version, resolve_apptainer_executable, validate_apptainer_executable,
};
use super::executables::validate_matlab_executable;
use crate::error::CommandError;
use anyhow::{Result as AnyResult, bail};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExecutionProfile {
    #[serde(rename = "matlab")]
    Matlab {
        id: String,
        label: String,
        #[serde(rename = "matlabPath")]
        matlab_path: String,
        #[serde(rename = "exploreAslPath")]
        explore_asl_path: String,
        #[serde(
            rename = "exploreAslVersion",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        explore_asl_version: Option<String>,
    },
    #[serde(rename = "apptainer")]
    Apptainer {
        id: String,
        label: String,
        #[serde(rename = "sifPath")]
        sif_path: String,
        #[serde(rename = "apptainerPath", default = "default_apptainer_path")]
        apptainer_path: String,
        #[serde(
            rename = "exploreAslVersion",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        explore_asl_version: Option<String>,
    },
}

fn default_apptainer_path() -> String {
    "apptainer".to_string()
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileValidationResult {
    pub id: String,
    pub valid: bool,
    pub errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explore_asl_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InternalValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub explore_asl_version: Option<String>,
    pub matlab_path: Option<String>,
    pub explore_asl_path: Option<PathBuf>,
    pub apptainer_path: Option<String>,
    pub sif_path: Option<PathBuf>,
}

impl ExecutionProfile {
    pub fn id(&self) -> &str {
        match self {
            ExecutionProfile::Matlab { id, .. } => id,
            ExecutionProfile::Apptainer { id, .. } => id,
        }
    }

    pub fn validate(&self) -> InternalValidation {
        match self {
            ExecutionProfile::Matlab {
                matlab_path,
                explore_asl_path,
                ..
            } => validate_matlab_profile(matlab_path, explore_asl_path),
            ExecutionProfile::Apptainer {
                sif_path,
                apptainer_path,
                ..
            } => validate_apptainer_profile(sif_path, apptainer_path),
        }
    }

    pub fn to_validation_result(&self, validation: InternalValidation) -> ProfileValidationResult {
        ProfileValidationResult {
            id: self.id().to_string(),
            valid: validation.valid,
            errors: validation.errors,
            explore_asl_version: validation.explore_asl_version,
        }
    }
}

pub(crate) fn validate_exploreasl_path(path: &str) -> AnyResult<PathBuf> {
    let path = PathBuf::from(path.trim());
    if !path.exists() {
        bail!("ExploreASL path not found: {}", path.display());
    }
    let main_file = path.join("ExploreASL.m");
    if !main_file.exists() {
        bail!("ExploreASL.m not found in {}", path.display());
    }
    Ok(path)
}

pub(crate) fn get_exploreasl_version(path: &Path) -> Option<String> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return None,
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(version) = file_name.strip_prefix("VERSION_")
            && !version.is_empty()
        {
            return Some(version.to_string());
        }
    }
    None
}

fn validate_matlab_profile(matlab_path: &str, explore_asl_path: &str) -> InternalValidation {
    let mut errors = Vec::new();
    let mut validated_matlab_path = None;
    let mut validated_explore_asl_path = None;

    match validate_matlab_executable(matlab_path) {
        Ok(path) => validated_matlab_path = Some(path),
        Err(error) => {
            log::error!("[PROFILE] MATLAB executable validation failed: {error:#}");
            errors.push(format!(
                "MATLAB executable not found or unavailable: {}. Select the MATLAB executable file and check its execute permissions.",
                matlab_path.trim()
            ));
        }
    }

    match validate_exploreasl_path(explore_asl_path) {
        Ok(path) => validated_explore_asl_path = Some(path),
        Err(error) => {
            log::error!("[PROFILE] ExploreASL folder validation failed: {error:#}");
            errors.push(format!(
                "ExploreASL.m not found at this path: {}. Select the ExploreASL folder containing ExploreASL.m.",
                explore_asl_path.trim()
            ));
        }
    }

    let explore_asl_version = validated_explore_asl_path
        .as_ref()
        .and_then(|path| get_exploreasl_version(path));

    InternalValidation {
        valid: errors.is_empty(),
        errors,
        explore_asl_version,
        matlab_path: validated_matlab_path,
        explore_asl_path: validated_explore_asl_path,
        apptainer_path: None,
        sif_path: None,
    }
}

fn validate_apptainer_profile(sif_path: &str, apptainer_path: &str) -> InternalValidation {
    let mut errors = Vec::new();
    let sif_value = sif_path.trim();
    let validated_sif_path = if sif_value.is_empty() {
        log::error!("[PROFILE] SIF path must not be empty");
        errors.push("No SIF image selected. Select an ExploreASL SIF file.".to_string());
        None
    } else {
        let sif = PathBuf::from(sif_value);
        if !sif.exists() {
            log::error!(
                "[PROFILE] SIF image not found at this path: {}",
                sif.display()
            );
            errors.push(format!(
                "SIF image not found at this path: {}. Select an existing ExploreASL SIF file.",
                sif.display()
            ));
            None
        } else if !sif.is_file() {
            log::error!("[PROFILE] SIF image path is not a file: {}", sif.display());
            errors.push(format!(
                "SIF image path is not a file: {}. Select an ExploreASL SIF file, not a folder.",
                sif.display()
            ));
            None
        } else {
            Some(sif)
        }
    };

    let validated_apptainer_path = match resolve_apptainer_executable(apptainer_path) {
        Ok(path) => match validate_apptainer_executable(&path) {
            Ok(()) => Some(path),
            Err(error) => {
                log::error!("[PROFILE] Apptainer executable validation failed: {error:#}");
                errors.push(
                    "Apptainer could not run its executable check. Check the Apptainer or Singularity installation and execute permissions, then validate again."
                        .to_string(),
                );
                None
            }
        },
        Err(error) => {
            log::error!("[PROFILE] Apptainer executable resolution failed: {error:#}");
            errors.push(format!(
                "Apptainer executable not found or unavailable: {}. Select an installed Apptainer or Singularity executable and check its execute permissions.",
                apptainer_path.trim()
            ));
            None
        }
    };

    let explore_asl_version = match (&validated_apptainer_path, &validated_sif_path) {
        (Some(apptainer), Some(sif)) => match detect_apptainer_version(apptainer, sif) {
            Ok(version) => Some(version),
            Err(error) => {
                log::error!("[PROFILE] Apptainer container validation failed: {error:#}");
                errors.push(
                    "Apptainer could not run the selected container. Check that the SIF image is an ExploreASL container and that Apptainer can run it on this computer, then validate again."
                        .to_string(),
                );
                None
            }
        },
        _ => None,
    };

    InternalValidation {
        valid: errors.is_empty(),
        errors,
        explore_asl_version,
        matlab_path: None,
        explore_asl_path: None,
        apptainer_path: validated_apptainer_path,
        sif_path: validated_sif_path,
    }
}

#[tauri::command]
#[specta::specta]
pub fn validate_execution_profile(
    execution_profile: ExecutionProfile,
) -> Result<ProfileValidationResult, CommandError> {
    let validation = execution_profile.validate();
    Ok(execution_profile.to_validation_result(validation))
}

#[tauri::command]
#[specta::specta]
pub fn validate_all_execution_profiles(
    execution_profiles: Vec<ExecutionProfile>,
) -> Result<Vec<ProfileValidationResult>, CommandError> {
    Ok(execution_profiles
        .iter()
        .map(|profile| {
            let validation = profile.validate();
            profile.to_validation_result(validation)
        })
        .collect())
}
