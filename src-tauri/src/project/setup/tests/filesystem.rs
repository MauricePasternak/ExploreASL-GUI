use tempfile::TempDir;

use super::super::filesystem::{fixed_path, hash, sync_parent};

#[test]
fn hashes_preserve_sha256_hex_format() {
    assert_eq!(
        hash(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        hash(b"286"),
        "00328ce57bbc14b33bd6695bc8eb32cdf2fb5f3a7d89ec14a42825e15d39df60"
    );
}

#[test]
fn fixed_paths_reject_traversal_and_uncontrolled_entries() {
    let root = TempDir::new().unwrap();
    assert!(fixed_path(root.path(), "../project.easl").is_err());
    assert!(fixed_path(root.path(), "rawdata/README.md").is_err());
}

#[cfg(unix)]
#[test]
fn directory_flush_reports_supported_on_unix() {
    let root = TempDir::new().unwrap();
    assert!(sync_parent(root.path()).unwrap());
}

#[cfg(not(unix))]
#[test]
fn directory_flush_reports_reduced_durability_when_unsupported() {
    let root = TempDir::new().unwrap();
    assert!(!sync_parent(root.path()).unwrap());
}
