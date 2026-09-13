use super::common::*;
use crate::execution_profile::get_exploreasl_version;
use crate::processing::pipeline::*;
use std::{fs, path::PathBuf};
#[test]
fn apptainer_processing_args_bind_project_root_to_data() {
    let args = build_apptainer_processing_args(
        PathBuf::from("/data/project").as_path(),
        PathBuf::from("/images/exploreasl.sif").as_path(),
        "[1,0,1]",
        2,
        4,
    );

    assert_eq!(
        args,
        vec![
            "exec",
            "--cleanenv",
            "--writable-tmpfs",
            "--bind",
            "/data/project:/data",
            "/images/exploreasl.sif",
            "/bin/bash",
            "/opt/xasl/xASL_latest/run_xASL_latest.sh",
            "/opt/mcr/v97/",
            "/data",
            "0",
            "[1,0,1]",
            "0",
            "2",
            "4",
        ]
    );
}

// -------------------------------------------------------------------------
// get_exploreasl_version
// -------------------------------------------------------------------------

#[test]
fn get_exploreasl_version_finds_version_file() {
    let root = unique_temp_path("version-find");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_1.11.0"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, Some("1.11.0".to_string()));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_finds_beta_version() {
    let root = unique_temp_path("version-beta");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, Some("2.0.0_BETA".to_string()));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_returns_none_when_no_version_file() {
    let root = unique_temp_path("version-none");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("ExploreASL.m"), "").unwrap();
    fs::write(root.join("README.md"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert_eq!(version, None);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn get_exploreasl_version_returns_none_when_dir_missing() {
    let root = unique_temp_path("version-missing");

    let version = get_exploreasl_version(&root);

    assert_eq!(version, None);
}

#[test]
fn get_exploreasl_version_returns_first_when_multiple() {
    let root = unique_temp_path("version-multi");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("VERSION_1.11.0"), "").unwrap();
    fs::write(root.join("VERSION_2.0.0_BETA"), "").unwrap();

    let version = get_exploreasl_version(&root);

    assert!(version == Some("1.11.0".to_string()) || version == Some("2.0.0_BETA".to_string()));

    let _ = fs::remove_dir_all(root);
}
