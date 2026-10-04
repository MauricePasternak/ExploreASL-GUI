use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn unique_temp_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("exploreasl-gui-{name}-{suffix}"))
}

pub(crate) fn get_test_temp_dir() -> tempfile::TempDir {
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
