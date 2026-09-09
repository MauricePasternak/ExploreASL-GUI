use crate::import::status::import_lock_dir;
use crate::import::types::ImportSubjectOutcomeKind;
use crate::import::verification::{
    STAGING_GENERATION_MARKER, cleanup_failed_subject_status, prepare_generation, verify_subject,
};
use std::fs;
use std::path::Path;

fn ready(root: &Path, subject: &str) {
    let lock = import_lock_dir(root, subject);
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("999_ready.status"), "ready").unwrap();
    let rawdata = root.join("rawdata").join(format!("sub-{subject}"));
    fs::create_dir_all(&rawdata).unwrap();
    fs::write(rawdata.join("scan.nii"), "nii").unwrap();
}

#[test]
fn generation_preparation_is_exclusive_and_rejects_selected_stale_locks() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".easl_staging");
    fs::create_dir(&root).unwrap();
    let generation = prepare_generation(&root, &["ONE".to_string()]).unwrap();
    assert_eq!(
        fs::read_to_string(root.join(STAGING_GENERATION_MARKER)).unwrap(),
        generation
    );
    assert!(prepare_generation(&root, &["ONE".to_string()]).is_err());

    fs::remove_file(root.join(STAGING_GENERATION_MARKER)).unwrap();
    fs::create_dir_all(import_lock_dir(&root, "ONE")).unwrap();
    fs::write(
        import_lock_dir(&root, "ONE").join("999_ready.status"),
        "stale",
    )
    .unwrap();
    assert!(prepare_generation(&root, &["ONE".to_string()]).is_err());
}

#[test]
fn verifier_accepts_only_owned_regular_ready_and_nonempty_safe_rawdata() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".easl_staging");
    fs::create_dir(&root).unwrap();
    let generation = prepare_generation(&root, &["ONE".to_string()]).unwrap();
    ready(&root, "ONE");
    let outcome = verify_subject(&root, "ONE", &generation);
    assert_eq!(outcome.outcome, ImportSubjectOutcomeKind::Verified);
    assert!(outcome.ready_lock_verified && outcome.rawdata_verified);

    for (name, prepare, code) in [
        (
            "missing ready",
            Box::new(|root: &Path| {
                fs::remove_file(import_lock_dir(root, "ONE").join("999_ready.status")).unwrap();
            }) as Box<dyn Fn(&Path)>,
            "readyLockMissing",
        ),
        (
            "empty rawdata",
            Box::new(|root: &Path| {
                fs::remove_file(root.join("rawdata/sub-ONE/scan.nii")).unwrap();
            }),
            "rawdataMissing",
        ),
    ] {
        let case = tempfile::tempdir().unwrap();
        let case_root = case.path().join(".easl_staging");
        fs::create_dir(&case_root).unwrap();
        fs::write(case_root.join(STAGING_GENERATION_MARKER), &generation).unwrap();
        ready(&case_root, "ONE");
        prepare(&case_root);
        let outcome = verify_subject(&case_root, "ONE", &generation);
        assert_eq!(outcome.error.unwrap().code, code, "{name}");
    }
    assert_eq!(
        verify_subject(&root, "../escape", &generation)
            .error
            .unwrap()
            .code,
        "unsafeSubject"
    );
    assert_eq!(
        verify_subject(&root, "ONE", "wrong").error.unwrap().code,
        "stagingGeneration"
    );
}

#[test]
fn verifier_matrix_rejects_missing_stale_partial_and_mixed_subject_evidence_without_mutation() {
    type EvidenceSetup = Box<dyn Fn(&Path, &str)>;
    type EvidenceCase = (&'static str, EvidenceSetup, Option<&'static str>);
    let cases: Vec<EvidenceCase> = vec![
        ("fresh regular ready lock", Box::new(ready), None),
        (
            "missing lock",
            Box::new(|_, _| {}),
            Some("readyLockMissing"),
        ),
        (
            "wrong generation",
            Box::new(|root, _| {
                fs::write(root.join(STAGING_GENERATION_MARKER), "other").unwrap();
            }),
            Some("stagingGeneration"),
        ),
        (
            "empty rawdata",
            Box::new(|root, subject| {
                ready(root, subject);
                fs::remove_file(root.join(format!("rawdata/sub-{subject}/scan.nii"))).unwrap();
            }),
            Some("rawdataMissing"),
        ),
        (
            "partial status",
            Box::new(|root, subject| {
                let lock = import_lock_dir(root, subject);
                fs::create_dir_all(lock).unwrap();
                fs::write(
                    import_lock_dir(root, subject).join("010_DCM2NII.status"),
                    "partial",
                )
                .unwrap();
            }),
            Some("readyLockMissing"),
        ),
    ];
    for (name, setup, expected) in cases {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join(".easl_staging");
        fs::create_dir(&root).unwrap();
        let generation =
            prepare_generation(&root, &["ONE".to_string(), "TWO".to_string()]).unwrap();
        setup(&root, "ONE");
        let one = verify_subject(&root, "ONE", &generation);
        let two = verify_subject(&root, "TWO", &generation);
        assert_eq!(
            one.error.as_ref().map(|error| error.code.as_str()),
            expected,
            "{name}"
        );
        let expected_two = match expected {
            None => Some("readyLockMissing"),
            Some("stagingGeneration") => Some("stagingGeneration"),
            Some(_) => Some("readyLockMissing"),
        };
        assert_eq!(
            two.error.as_ref().map(|error| error.code.as_str()),
            expected_two,
            "{name}: mixed subject result"
        );
        if expected.is_none() {
            assert_eq!(one.outcome, ImportSubjectOutcomeKind::Verified, "{name}");
        }
        // Verification never repairs, deletes, or follows the malformed evidence.
        assert!(root.exists(), "{name}");
    }
}

#[cfg(unix)]
#[test]
fn verifier_rejects_symlinked_lock_parents_and_rawdata_entries() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".easl_staging");
    fs::create_dir(&root).unwrap();
    let generation = prepare_generation(&root, &["ONE".to_string()]).unwrap();
    ready(&root, "ONE");
    let raw = root.join("rawdata/sub-ONE");
    fs::remove_file(raw.join("scan.nii")).unwrap();
    symlink(temp.path().join("outside"), raw.join("scan.nii")).unwrap();
    assert_eq!(
        verify_subject(&root, "ONE", &generation)
            .error
            .unwrap()
            .code,
        "rawdataMissing"
    );

    // A ready lock parent is an authority boundary too: do not follow it
    // even when its target contains otherwise-valid evidence.
    let lock_parent = root.join("derivatives/ExploreASL/lock/xASL_module_Import/ONE");
    fs::remove_dir_all(&lock_parent).unwrap();
    let outside = temp.path().join("outside-lock");
    fs::create_dir_all(outside.join("xASL_module_Import")).unwrap();
    fs::write(outside.join("xASL_module_Import/999_ready.status"), "ready").unwrap();
    symlink(&outside, &lock_parent).unwrap();
    assert_eq!(
        verify_subject(&root, "ONE", &generation)
            .error
            .unwrap()
            .code,
        "readyLockUnsafe"
    );
}

#[cfg(unix)]
#[test]
fn verifier_rejects_ready_file_symlinks_and_special_filesystem_entries() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;

    fn fifo(path: &Path) {
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    }

    for case in ["ready-symlink", "ready-special", "rawdata-special"] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join(".easl_staging");
        fs::create_dir(&root).unwrap();
        let generation = prepare_generation(&root, &["ONE".to_string()]).unwrap();
        ready(&root, "ONE");
        let ready_path = import_lock_dir(&root, "ONE").join("999_ready.status");
        match case {
            "ready-symlink" => {
                let outside = temp.path().join("outside-ready");
                fs::write(&outside, "ready").unwrap();
                fs::remove_file(&ready_path).unwrap();
                symlink(&outside, &ready_path).unwrap();
            }
            "ready-special" => {
                fs::remove_file(&ready_path).unwrap();
                fifo(&ready_path);
            }
            "rawdata-special" => {
                let scan = root.join("rawdata/sub-ONE/scan.nii");
                fs::remove_file(&scan).unwrap();
                fifo(&scan);
            }
            _ => unreachable!(),
        }

        let outcome = verify_subject(&root, "ONE", &generation);
        assert_eq!(outcome.outcome, ImportSubjectOutcomeKind::Failed, "{case}");
        assert_eq!(
            outcome.error.unwrap().code,
            if case.starts_with("ready") {
                "readyLockUnsafe"
            } else {
                "rawdataMissing"
            },
            "{case}"
        );
        assert!(
            root.exists(),
            "verification must not mutate evidence: {case}"
        );
    }
}

#[cfg(unix)]
#[test]
fn verifier_does_not_follow_a_symlinked_generation_marker() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".easl_staging");
    fs::create_dir(&root).unwrap();
    let generation = prepare_generation(&root, &["ONE".to_string()]).unwrap();
    ready(&root, "ONE");
    let outside = temp.path().join("outside-marker");
    fs::write(&outside, &generation).unwrap();
    fs::remove_file(root.join(STAGING_GENERATION_MARKER)).unwrap();
    symlink(&outside, root.join(STAGING_GENERATION_MARKER)).unwrap();

    assert_eq!(
        verify_subject(&root, "ONE", &generation)
            .error
            .unwrap()
            .code,
        "stagingGeneration"
    );
    assert_eq!(fs::read_to_string(outside).unwrap(), generation);
}

#[test]
fn failed_status_cleanup_is_idempotent_and_never_removes_unsafe_entries() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".easl_staging");
    fs::create_dir(&root).unwrap();
    let lock = import_lock_dir(&root, "ONE");
    fs::create_dir_all(&lock).unwrap();
    fs::write(lock.join("010_DCM2NII.status"), "partial").unwrap();
    cleanup_failed_subject_status(&root, "ONE").unwrap();
    cleanup_failed_subject_status(&root, "ONE").unwrap();
    assert!(!lock.join("010_DCM2NII.status").exists());
}
