use super::common::*;
use crate::execution::matlab::*;
use std::fs;
use std::path::PathBuf;
#[cfg(unix)]
use std::process::Command;
use std::time::Duration;

// From manifest.rs tests:
#[test]
fn reads_matlab_version_from_version_info_xml() {
    let temp = get_test_temp_dir();
    let root = temp.path();
    let bin = root.join("R2022b").join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(
        root.join("R2022b").join("VersionInfo.xml"),
        r#"<?xml version="1.0"?><MathWorks_version_info><version>9.13.0</version><release>R2022b</release></MathWorks_version_info>"#,
    )
    .unwrap();
    let matlab = bin.join("matlab");
    fs::write(&matlab, "#!/bin/sh\necho should-not-run\n").unwrap();

    let version = probe_matlab_version_fast(&matlab).unwrap();
    assert_eq!(version, "R2022b");
}

#[test]
fn reads_matlab_release_from_path_component() {
    let path = PathBuf::from("/opt/MATLAB/R2024a/bin/matlab");
    assert_eq!(release_from_path(&path), Some("R2024a".to_string()));
}

#[test]
fn reads_matlab_release_from_macos_app_bundle_path() {
    let path = PathBuf::from("/Applications/MATLAB_R2022b.app/bin/matlab");
    assert_eq!(release_from_path(&path), Some("R2022b".to_string()));
}

// From commands.rs tests:
#[cfg(unix)]
#[test]
fn detect_matlab_version_from_fake_binary() {
    let temp = get_test_temp_dir();
    let dir = temp.path();

    let fake_matlab = dir.join("matlab");
    write_executable(&fake_matlab, "#!/bin/sh\necho '2022b'\n");

    let debug_output = Command::new(&fake_matlab)
        .args(["-batch", "disp(version('-release'))"])
        .output();

    let version = detect_matlab_version_impl(&fake_matlab);
    assert_eq!(
        version,
        Some("R2022b".to_string()),
        "Failed to get version. Debug output: {:?}",
        debug_output
    );
}

#[cfg(unix)]
#[test]
fn detect_matlab_version_rejects_failure() {
    let temp = get_test_temp_dir();
    let dir = temp.path();

    let fake_matlab = dir.join("matlab");
    write_executable(&fake_matlab, "#!/bin/sh\necho nope >&2\nexit 1\n");

    let version = detect_matlab_version_impl(&fake_matlab);
    assert_eq!(version, None);
}

#[cfg(unix)]
#[test]
fn matlab_discovery_timeout_settles_supported_scope() {
    use std::time::Instant;

    let temp = get_test_temp_dir();
    let binary = temp.path().join("matlab");
    // Finite fixture also self-cleans if the old detached implementation returns early.
    write_executable(
        &binary,
        "#!/bin/sh\ncd \"$(dirname \"$0\")\"\ntrap 'wait \"$child\"; exit 0' TERM\nsleep 30 &\nchild=$!\nprintf '%s %s' \"$$\" \"$child\" > scope-pids\nwait \"$child\"\n",
    );

    let started = Instant::now();
    let results = tauri::async_runtime::block_on(which_matlab(Some(vec![
        binary.to_string_lossy().into_owned(),
    ])));

    assert_eq!(results.len(), 1);
    assert!(results[0]["version"].is_null());
    assert!(started.elapsed() >= Duration::from_secs(15));
    assert!(started.elapsed() < Duration::from_secs(25));
    let pids = fs::read_to_string(temp.path().join("scope-pids")).unwrap();
    let pids: Vec<i32> = pids
        .split_whitespace()
        .map(|pid| pid.parse().unwrap())
        .collect();
    for pid in [pids[0], pids[1], -pids[0]] {
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "scope member {pid} survived discovery"
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
}
