use super::*;

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

    fn make_apptainer_profile(sif_path: &str, apptainer_path: &str) -> ExecutionProfile {
        ExecutionProfile::Apptainer {
            id: "00000000-0000-4000-8000-000000000002".to_string(),
            label: "Apptainer Test Profile".to_string(),
            sif_path: sif_path.to_string(),
            apptainer_path: apptainer_path.to_string(),
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

    #[cfg(unix)]
    fn create_apptainer_stub(path: &Path, version: &str) {
        use std::os::unix::fs::PermissionsExt;

        fs::write(
            path,
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'apptainer version 1'; exit 0; fi\nif [ \"$1\" = \"exec\" ]; then echo 'VERSION_{version}'; exit 0; fi\nexit 1\n"
            ),
        )
        .expect("apptainer stub should be written");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .expect("apptainer stub should be executable");
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

    #[cfg(unix)]
    #[test]
    fn validate_accepts_apptainer_profile_and_detects_container_version() {
        let apptainer = unique_temp_path("apptainer-stub");
        let sif = unique_temp_path("exploreasl-image").with_extension("sif");
        create_apptainer_stub(&apptainer, "1.11.0");
        fs::write(&sif, "fake SIF").expect("SIF placeholder should be written");

        let profile = make_apptainer_profile(&sif.to_string_lossy(), &apptainer.to_string_lossy());
        let validation = profile.validate();

        assert!(validation.valid);
        assert!(validation.errors.is_empty());
        assert_eq!(validation.explore_asl_version, Some("1.11.0".to_string()));
        assert_eq!(
            validation.apptainer_path,
            Some(apptainer.to_string_lossy().to_string())
        );
        assert_eq!(validation.sif_path, Some(sif.clone()));

        let _ = fs::remove_file(apptainer);
        let _ = fs::remove_file(sif);
    }

    #[test]
    fn validate_rejects_missing_apptainer_sif_image() {
        let missing_sif = unique_temp_path("missing-image").with_extension("sif");
        let profile = make_apptainer_profile(&missing_sif.to_string_lossy(), "/missing/apptainer");

        let validation = profile.validate();

        assert!(!validation.valid);
        assert!(
            validation
                .errors
                .iter()
                .any(|error| error.contains("SIF image not found"))
        );
        assert!(validation.sif_path.is_none());
    }

    #[test]
    fn resolve_apptainer_uses_singularity_fallback_for_default_command() {
        use crate::apptainer::resolve_apptainer_executable_with_path;

        let bin_dir = unique_temp_path("apptainer-fallback-bin");
        fs::create_dir_all(&bin_dir).expect("bin directory should be created");
        let singularity = bin_dir.join("singularity");
        create_executable(&singularity);

        let resolved =
            resolve_apptainer_executable_with_path("apptainer", &bin_dir.to_string_lossy());

        assert_eq!(
            resolved.expect("singularity fallback should resolve"),
            singularity
        );
        let _ = fs::remove_dir_all(bin_dir);
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
