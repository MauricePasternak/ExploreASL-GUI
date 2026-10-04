use super::walk_directory;

#[test]
fn discovers_dicom_files_and_containing_directories() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("subject")).unwrap();
    for file in ["subject/scan.DCM", "subject/other.dcm", "subject/notes.txt"] {
        std::fs::write(root.path().join(file), b"").unwrap();
    }
    let path = root.path().to_string_lossy().into_owned();
    assert_eq!(
        walk_directory(path.clone(), 2, true).unwrap(),
        vec!["subject"]
    );
    let expected = ["subject/other.dcm", "subject/scan.DCM"].map(|file| {
        std::path::PathBuf::from(file)
            .to_string_lossy()
            .into_owned()
    });
    assert_eq!(walk_directory(path.clone(), 2, false).unwrap(), expected);
    assert!(walk_directory(path, 1, false).unwrap().is_empty());
    assert!(
        walk_directory(
            root.path().join("missing").to_string_lossy().into_owned(),
            2,
            false
        )
        .is_err()
    );
}
