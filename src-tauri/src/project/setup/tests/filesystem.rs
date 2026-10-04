use std::fs;
use tempfile::TempDir;

use super::super::filesystem::{fixed_path, safe_relative, sync_parent};
use super::super::journal::REGISTRY_FILE;
use super::super::{
    MarkerClassification, RAWDATA_MARKER_BYTES, RAWDATA_MARKER_PATH, classify_marker, recover_all,
};

#[test]
fn marker_classification_matrix_preserves_readme_and_confines_fixed_paths() {
    let root = TempDir::new().unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Absent
    );
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"user bytes").unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Absent
    );
    fs::write(root.path().join(RAWDATA_MARKER_PATH), RAWDATA_MARKER_BYTES).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Exact
    );
    fs::write(root.path().join(RAWDATA_MARKER_PATH), b"foreign").unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Foreign
    );
    assert_eq!(
        fs::read(root.path().join("rawdata/README.md")).unwrap(),
        b"user bytes"
    );
    assert!(fixed_path(root.path(), "../rawdata/.easl-gui-managed").is_err());
    assert!(fixed_path(root.path(), "rawdata/README.md").is_err());
}

#[cfg(unix)]
#[test]
fn marker_wrong_type_and_symlink_are_never_followed() {
    use std::os::unix::fs::symlink;
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::create_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Unsafe
    );
    fs::remove_dir(root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    let outside = TempDir::new().unwrap();
    let external = outside.path().join("marker");
    fs::write(&external, RAWDATA_MARKER_BYTES).unwrap();
    symlink(&external, root.path().join(RAWDATA_MARKER_PATH)).unwrap();
    assert_eq!(
        classify_marker(root.path()).unwrap(),
        MarkerClassification::Unsafe
    );
    assert_eq!(fs::read(external).unwrap(), RAWDATA_MARKER_BYTES);
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

#[test]
fn malformed_registry_and_path_escape_fail_closed() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join(REGISTRY_FILE), b"not json").unwrap();
    assert!(recover_all(temp.path()).is_err());
    assert!(safe_relative("../escape").is_err());
    assert!(safe_relative("/escape").is_err());
}
