use super::common::*;
use crate::execution::apptainer::resolve_apptainer_executable_with_path;
use crate::execution::profile::*;
use std::fs;
use std::path::Path;

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

#[cfg(unix)]
fn create_apptainer_stub(path: &Path, version: &str) {
    write_executable(
        path,
        &format!(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'apptainer version 1'; exit 0; fi\nif [ \"$1\" = \"exec\" ]; then echo 'VERSION_{version}'; exit 0; fi\nexit 1\n"
        ),
    );
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
    assert!(validation.errors[0].contains(missing_matlab.to_str().unwrap()));
    assert!(validation.errors[0].contains("Select the MATLAB executable file"));
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
    assert!(validation.errors[0].contains(exploreasl.to_str().unwrap()));
    assert!(validation.errors[0].contains("Select the ExploreASL folder"));
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

#[cfg(unix)]
#[test]
fn validation_results_explain_probe_failures_without_raw_diagnostics() {
    let root = tempfile::tempdir().unwrap();
    let apptainer = root.path().join("apptainer");
    let sif = root.path().join("image.sif");
    fs::write(&sif, "fake SIF").unwrap();

    for container_probe in [false, true] {
        write_executable(
            &apptainer,
            &format!(
                "#!/bin/sh\nif [ {container_probe} = true ] && [ \"$1\" = --version ]; then echo 'apptainer version 1'; exit 0; fi\nprintf '\\033[31mraw-diagnostic: setuid helper unavailable\\033[0m\\n' >&2\nexit 7\n"
            ),
        );
        let profile = make_apptainer_profile(&sif.to_string_lossy(), &apptainer.to_string_lossy());
        let single = validate_execution_profile(profile.clone()).unwrap();
        let batch = validate_all_execution_profiles(vec![profile]).unwrap();

        for result in [single, batch.into_iter().next().unwrap()] {
            assert!(!result.valid);
            assert_eq!(result.errors.len(), 1);
            assert!(result.explore_asl_version.is_none());
            let message = &result.errors[0];
            assert!(message.contains(if container_probe {
                "Apptainer could not run the selected container"
            } else {
                "Apptainer could not run its executable check"
            }));
            assert!(message.contains("Check"));
            assert!(message.contains("then validate again"));
            for diagnostic in [
                "raw-diagnostic",
                "setuid",
                "\u{1b}",
                "status",
                "--version",
                "Caused by",
            ] {
                assert!(
                    !message.contains(diagnostic),
                    "leaked diagnostic: {message}"
                );
            }
        }
    }
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
fn validate_distinguishes_missing_and_not_file_sif_paths() {
    let root = tempfile::tempdir().unwrap();
    let missing_sif = root.path().join("missing.sif");
    let missing_apptainer = root.path().join("missing-apptainer");

    for (sif, explanation) in [
        (missing_sif.as_path(), "SIF image not found at this path"),
        (root.path(), "SIF image path is not a file"),
    ] {
        let profile =
            make_apptainer_profile(&sif.to_string_lossy(), &missing_apptainer.to_string_lossy());
        let result = validate_execution_profile(profile).unwrap();

        assert!(!result.valid);
        assert_eq!(result.errors.len(), 2);
        assert!(result.explore_asl_version.is_none());
        assert!(result.errors[0].contains(explanation));
        assert!(result.errors[0].contains(sif.to_str().unwrap()));
        assert!(result.errors[0].contains("Select an"));
        assert!(result.errors[1].contains("Apptainer executable"));
        assert!(result.errors[1].contains(missing_apptainer.to_str().unwrap()));
        assert!(result.errors[1].contains("Select an installed Apptainer or Singularity"));
    }
}

#[test]
fn resolve_apptainer_uses_singularity_fallback_for_default_command() {
    let bin_dir = unique_temp_path("apptainer-fallback-bin");
    fs::create_dir_all(&bin_dir).expect("bin directory should be created");
    let singularity = bin_dir.join("singularity");
    create_executable(&singularity);

    let resolved = resolve_apptainer_executable_with_path("apptainer", &bin_dir.to_string_lossy());

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
    let invalid = make_matlab_profile("/definitely/missing/matlab", &exploreasl.to_string_lossy());

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
