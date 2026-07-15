use super::*;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn get_test_temp_dir() -> tempfile::TempDir {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_dir = manifest_dir.join("target");
    let _ = fs::create_dir_all(&target_dir);
    tempfile::tempdir_in(&target_dir).unwrap()
}

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

    let version = probe_matlab_version(&matlab).unwrap();
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
    {
        let mut f = fs::File::create(&fake_matlab).unwrap();
        writeln!(f, "#!/bin/sh").unwrap();
        writeln!(f, "echo '2022b'").unwrap();
        f.sync_all().unwrap();
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fake_matlab, PermissionsExt::from_mode(0o755)).unwrap();
    }

    let debug_output = Command::new(&fake_matlab)
        .args(["-batch", "disp(version('-release'))"])
        .output();

    let version = run_matlab_release(&fake_matlab);
    assert_eq!(
        version,
        Some("R2022b".to_string()),
        "Failed to get version. Debug output: {:?}",
        debug_output
    );
}

#[cfg(unix)]
#[test]
fn run_matlab_release_rejects_failure() {
    let temp = get_test_temp_dir();
    let dir = temp.path();

    let fake_matlab = dir.join("matlab");
    {
        let mut f = fs::File::create(&fake_matlab).unwrap();
        writeln!(f, "#!/bin/sh").unwrap();
        writeln!(f, "echo nope >&2").unwrap();
        writeln!(f, "exit 1").unwrap();
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fake_matlab, PermissionsExt::from_mode(0o755)).unwrap();
    }

    let version = run_matlab_release(&fake_matlab);
    assert_eq!(version, None);
}
