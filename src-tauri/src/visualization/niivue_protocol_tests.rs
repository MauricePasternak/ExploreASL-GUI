use super::*;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn setup_pseudo_real_project(real_nii_gz_path: &Path) -> (TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();

    let pop_dir = root.join("derivatives/ExploreASL/Population");
    fs::create_dir_all(&pop_dir).unwrap();

    let dest_path = pop_dir.join("qCBF_sub-TEST_01_ASL_1.nii.gz");
    fs::copy(real_nii_gz_path, &dest_path).unwrap();

    (temp, root)
}

#[test]
fn test_resolve_niivue_request_with_real_data() {
    let workspace_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let real_nii_gz_path = workspace_dir
        .join("../test/fixtures/derivatives/ExploreASL/Population/qCBF_sub-mock_1_ASL_1.nii.gz");

    assert!(
        real_nii_gz_path.exists(),
        "Real test NIfTI file not found at {:?}",
        real_nii_gz_path
    );

    let (_temp, root) = setup_pseudo_real_project(&real_nii_gz_path);

    // Test resolving with a .nii.gz extension request
    let uri_path = "/localhost/qCBF/sub-TEST_01/ASL_1.nii.gz";
    let res = resolve_niivue_request(root.clone(), uri_path).unwrap();
    assert_eq!(res.1, "application/gzip");
    assert!(res.0.ends_with("qCBF_sub-TEST_01_ASL_1.nii.gz"));
    assert!(res.0.exists());

    // Test resolving with a .nii extension request (falls back to .nii.gz)
    let uri_path_nii = "/localhost/qCBF/sub-TEST_01/ASL_1.nii";
    let res_nii = resolve_niivue_request(root.clone(), uri_path_nii).unwrap();
    assert_eq!(res_nii.1, "application/gzip");
    assert!(res_nii.0.ends_with("qCBF_sub-TEST_01_ASL_1.nii.gz"));

    // Test resolving without extension
    let uri_path_no_ext = "/localhost/qCBF/sub-TEST_01/ASL_1";
    let res_no_ext = resolve_niivue_request(root.clone(), uri_path_no_ext).unwrap();
    assert_eq!(res_no_ext.1, "application/gzip");
    assert!(res_no_ext.0.ends_with("qCBF_sub-TEST_01_ASL_1.nii.gz"));
}

#[test]
fn test_resolve_niivue_request_errors() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();

    // 1. Missing segments
    let err = resolve_niivue_request(root.clone(), "/localhost/qCBF").unwrap_err();
    assert_eq!(err.0, http::StatusCode::BAD_REQUEST);

    // 2. Unknown volume type
    let err = resolve_niivue_request(root.clone(), "/localhost/unknown/sub-01/ASL_1").unwrap_err();
    assert_eq!(err.0, http::StatusCode::NOT_FOUND);

    // 3. File not found
    let pop_dir = root.join("derivatives/ExploreASL/Population");
    fs::create_dir_all(&pop_dir).unwrap();
    let err = resolve_niivue_request(root.clone(), "/localhost/qCBF/sub-01/ASL_1").unwrap_err();
    assert_eq!(err.0, http::StatusCode::NOT_FOUND);
}

#[cfg(unix)]
#[test]
fn test_resolve_niivue_request_symlink_traversal() {
    use std::os::unix::fs::symlink;

    let temp_outside = tempfile::tempdir().unwrap();
    let outside_file = temp_outside.path().join("qCBF_sub-01_ASL_1.nii.gz");
    fs::write(&outside_file, b"outside").unwrap();

    let (_temp_root, root) = setup_pseudo_real_project(&outside_file);
    let pop_dir = root.join("derivatives/ExploreASL/Population");
    let inside_file = pop_dir.join("qCBF_sub-TEST_01_ASL_1.nii.gz");
    fs::remove_file(&inside_file).unwrap();

    symlink(&outside_file, &inside_file).unwrap();

    let err = resolve_niivue_request(root, "/localhost/qCBF/sub-TEST_01/ASL_1").unwrap_err();
    assert_eq!(err.0, http::StatusCode::FORBIDDEN);
}
