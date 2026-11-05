use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn get_test_temp_dir() -> tempfile::TempDir {
    // Keep executable fixtures on the crate filesystem, not a possibly noexec temp mount.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_dir = manifest_dir.join("target");
    let _ = fs::create_dir_all(&target_dir);
    tempfile::tempdir_in(&target_dir).unwrap()
}

#[cfg(unix)]
pub(crate) fn write_executable(path: &Path, contents: &str) {
    // Open writable script descriptors only after exec, outside the multithreaded
    // test process. Sibling spawns cannot inherit them and cause ETXTBSY.
    assert!(
        std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "printf '%s' \"$2\" > \"$1\" && chmod 755 \"$1\"",
                "fixture-writer",
            ])
            .arg(path)
            .arg(contents)
            .status()
            .unwrap()
            .success()
    );
}

pub(crate) fn create_executable(path: &Path) {
    #[cfg(not(unix))]
    fs::write(path, "#!/bin/sh\n").expect("executable file should be written");
    #[cfg(unix)]
    write_executable(path, "#!/bin/sh\n");
}
