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
}

impl ExecutionProfile {
    pub fn id(&self) -> &str {
        match self {
            ExecutionProfile::Matlab { id, .. } => id,
        }
    }

    pub fn validate(&self) -> InternalValidation {
        match self {
            ExecutionProfile::Matlab {
                matlab_path,
                explore_asl_path,
                ..
            } => validate_matlab_profile(matlab_path, explore_asl_path),
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
        if let Some(version) = file_name.strip_prefix("VERSION_") {
            if !version.is_empty() {
                return Some(version.to_string());
            }
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
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!("exploreasl-gui-profile-{name}-{suffix}"))
    }

    fn make_matlab_profile(matlab_path: &str, explore_asl_path: &str) -> ExecutionProfile {
        ExecutionProfile::Matlab {
            id: "00000000-0000-4000-8000-000000000001".to_string(),
            label: "Test Profile".to_string(),
            matlab_path: matlab_path.to_string(),
            explore_asl_path: explore_asl_path.to_string(),
            explore_asl_version: None,
        }
    }

    fn create_executable(path: &Path) {
        fs::write(path, "#!/bin/sh\n").expect("executable file should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))
                .expect("executable permissions should be set");
        }
    }

    fn create_exploreasl_root(path: &Path, with_version: bool) {
        fs::create_dir_all(path).expect("exploreasl root should be created");
        fs::write(path.join("ExploreASL.m"), "").expect("ExploreASL.m should be created");
        if with_version {
            fs::write(path.join("VERSION_1.11.0"), "").expect("version file should be created");
        }
    }

    #[test]
    fn execution_profile_id_returns_profile_id() {
        let profile = make_matlab_profile("/tmp/matlab", "/tmp/exploreasl");

        assert_eq!(profile.id(), "00000000-0000-4000-8000-000000000001");
    }

    #[test]
    fn validate_accepts_valid_matlab_profile_paths() {
        let matlab = unique_temp_path("valid-matlab");
        let exploreasl = unique_temp_path("valid-exploreasl");
        create_executable(&matlab);
        create_exploreasl_root(&exploreasl, true);

        let profile = make_matlab_profile(&matlab.to_string_lossy(), &exploreasl.to_string_lossy());
        let validation = profile.validate();

        assert!(validation.valid);
        assert!(validation.errors.is_empty());
        assert_eq!(validation.explore_asl_version, Some("1.11.0".to_string()));
        assert_eq!(
            validation.matlab_path,
            Some(matlab.to_string_lossy().to_string())
        );
        assert_eq!(validation.explore_asl_path, Some(exploreasl.clone()));

        let _ = fs::remove_file(matlab);
        let _ = fs::remove_dir_all(exploreasl);
    }

    #[test]
    fn validate_rejects_missing_matlab_executable() {
        let missing_matlab = unique_temp_path("missing-matlab").join("matlab");
        let exploreasl = unique_temp_path("exploreasl-for-missing-matlab");
        create_exploreasl_root(&exploreasl, false);

        let profile = make_matlab_profile(
            &missing_matlab.to_string_lossy(),
            &exploreasl.to_string_lossy(),
        );
        let validation = profile.validate();

        assert!(!validation.valid);
        assert_eq!(validation.errors.len(), 1);
        assert!(validation.errors[0].contains("MATLAB executable not found"));
        assert!(validation.matlab_path.is_none());
        assert_eq!(validation.explore_asl_path, Some(exploreasl.clone()));

        let _ = fs::remove_dir_all(exploreasl);
    }

    #[test]
    fn validate_rejects_missing_exploreasl_main_file() {
        let matlab = unique_temp_path("matlab-for-missing-exploreasl");
        let exploreasl = unique_temp_path("missing-exploreasl-main");
        create_executable(&matlab);
        fs::create_dir_all(&exploreasl).expect("exploreasl dir should be created");

        let profile = make_matlab_profile(&matlab.to_string_lossy(), &exploreasl.to_string_lossy());
        let validation = profile.validate();

        assert!(!validation.valid);
        assert_eq!(validation.errors.len(), 1);
        assert!(validation.errors[0].contains("ExploreASL.m not found"));
        assert_eq!(
            validation.matlab_path,
            Some(matlab.to_string_lossy().to_string())
        );
        assert!(validation.explore_asl_path.is_none());

        let _ = fs::remove_file(matlab);
        let _ = fs::remove_dir_all(exploreasl);
    }

    #[test]
    fn validate_all_execution_profiles_returns_one_result_per_profile() {
        let matlab = unique_temp_path("valid-matlab-batch");
        let exploreasl = unique_temp_path("valid-exploreasl-batch");
        create_executable(&matlab);
        create_exploreasl_root(&exploreasl, true);

        let valid = make_matlab_profile(&matlab.to_string_lossy(), &exploreasl.to_string_lossy());
        let invalid =
            make_matlab_profile("/definitely/missing/matlab", &exploreasl.to_string_lossy());

        let results = validate_all_execution_profiles(vec![valid.clone(), invalid])
            .expect("batch validation should succeed");

        assert_eq!(results.len(), 2);
        assert!(results[0].valid);
        assert!(!results[1].valid);
        assert_eq!(results[0].id, valid.id());
        assert_eq!(results[1].errors.len(), 1);

        let _ = fs::remove_file(matlab);
        let _ = fs::remove_dir_all(exploreasl);
    }
}
