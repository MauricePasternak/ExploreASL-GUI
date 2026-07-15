use crate::apptainer::{
    detect_apptainer_version, resolve_apptainer_executable, validate_apptainer_executable,
};
use crate::import::validate_matlab_executable;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
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

pub(crate) fn validate_exploreasl_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.exists() {
        return Err(format!("ExploreASL path not found: {}", path.display()));
    }
    let main_file = path.join("ExploreASL.m");
    if !main_file.exists() {
        return Err(format!("ExploreASL.m not found in {}", path.display()));
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
        Err(error) => errors.push(error),
    }

    match validate_exploreasl_path(explore_asl_path) {
        Ok(path) => validated_explore_asl_path = Some(path),
        Err(error) => errors.push(error),
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
        errors.push("SIF path must not be empty".to_string());
        None
    } else {
        let sif = PathBuf::from(sif_value);
        if !sif.exists() {
            errors.push(format!(
                "SIF image not found at this path: {}",
                sif.display()
            ));
            None
        } else if !sif.is_file() {
            errors.push(format!("SIF image path is not a file: {}", sif.display()));
            None
        } else {
            Some(sif)
        }
    };

    let validated_apptainer_path = match resolve_apptainer_executable(apptainer_path) {
        Ok(path) => match validate_apptainer_executable(&path) {
            Ok(()) => Some(path),
            Err(error) => {
                errors.push(error);
                None
            }
        },
        Err(error) => {
            errors.push(error);
            None
        }
    };

    let explore_asl_version = match (&validated_apptainer_path, &validated_sif_path) {
        (Some(apptainer), Some(sif)) => match detect_apptainer_version(apptainer, sif) {
            Ok(version) => Some(version),
            Err(error) => {
                errors.push(error);
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
pub fn validate_execution_profile(
    execution_profile: ExecutionProfile,
) -> Result<ProfileValidationResult, String> {
    let validation = execution_profile.validate();
    Ok(execution_profile.to_validation_result(validation))
}

#[tauri::command]
pub fn validate_all_execution_profiles(
    execution_profiles: Vec<ExecutionProfile>,
) -> Result<Vec<ProfileValidationResult>, String> {
    Ok(execution_profiles
        .iter()
        .map(|profile| {
            let validation = profile.validate();
            profile.to_validation_result(validation)
        })
        .collect())
}

#[cfg(test)]
#[path = "execution_profile_tests.rs"]
mod execution_profile_tests;
