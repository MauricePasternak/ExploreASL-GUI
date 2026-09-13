use easl_execution_runtime::fs_safety::{
    ProjectDirectory, ProjectRelativePath, atomic_replace, rename_no_replace, sync_directory,
};
use std::fs;
use std::io;
use tempfile::tempdir;

#[test]
fn project_relative_path_rejects_escape_components() {
    for path in ["", ".", "../escape", "safe/../escape"] {
        assert!(ProjectRelativePath::new(path).is_err(), "accepted {path:?}");
    }
    assert!(ProjectRelativePath::new("safe/file").is_ok());
}

#[test]
fn project_relative_path_rejects_embedded_nul() {
    for path in [
        "\0record",
        "record\0",
        "record\0suffix",
        "records\0suffix/record",
    ] {
        let error = ProjectRelativePath::new(path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{path:?}");
    }
}

#[test]
fn capability_no_replace_rejects_nul_without_mutating_prefix_paths() {
    for destination_exists in [false, true] {
        for (source, destination) in [
            ("candidate\0suffix", "record"),
            ("candidate", "record\0suffix"),
        ] {
            let root = tempdir().unwrap();
            fs::write(root.path().join("candidate"), b"candidate").unwrap();
            if destination_exists {
                fs::write(root.path().join("record"), b"prior").unwrap();
            }
            let authority = ProjectDirectory::open(root.path()).unwrap();
            let rename = || -> io::Result<()> {
                authority.rename_regular_file_no_replace(
                    &ProjectRelativePath::new(source)?,
                    &ProjectRelativePath::new(destination)?,
                )
            };

            assert_eq!(rename().unwrap_err().kind(), io::ErrorKind::InvalidInput);
            assert_eq!(
                fs::read(root.path().join("candidate")).unwrap(),
                b"candidate"
            );
            if destination_exists {
                assert_eq!(fs::read(root.path().join("record")).unwrap(), b"prior");
            } else {
                assert!(!root.path().join("record").exists());
            }
        }
    }
}

#[cfg(unix)]
#[test]
fn project_directory_rejects_symlinked_authority_component() {
    let root = tempdir().unwrap();
    let foreign = tempdir().unwrap();
    std::os::unix::fs::symlink(foreign.path(), root.path().join("derivatives")).unwrap();

    assert!(
        ProjectDirectory::open(root.path())
            .unwrap()
            .open_regular(&ProjectRelativePath::new("derivatives/record.json").unwrap())
            .is_err()
    );
}

#[test]
fn no_replace_preserves_existing_destination() {
    let root = tempdir().unwrap();
    let source = root.path().join("candidate");
    let destination = root.path().join("record");
    fs::write(&source, b"candidate").unwrap();
    fs::write(&destination, b"prior").unwrap();

    let error = rename_no_replace(&source, &destination).unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read(&source).unwrap(), b"candidate");
    assert_eq!(fs::read(&destination).unwrap(), b"prior");
}

#[test]
fn capability_no_replace_preserves_existing_destination() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("records")).unwrap();
    let authority = ProjectDirectory::open(root.path()).unwrap();
    for prefix in ["", "records/"] {
        let source = ProjectRelativePath::new(format!("{prefix}candidate")).unwrap();
        let destination = ProjectRelativePath::new(format!("{prefix}record")).unwrap();
        fs::write(root.path().join(source.as_path()), b"candidate").unwrap();
        fs::write(root.path().join(destination.as_path()), b"prior").unwrap();

        let error = authority
            .rename_regular_file_no_replace(&source, &destination)
            .unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(authority.read_regular(&source).unwrap(), b"candidate");
        assert_eq!(authority.read_regular(&destination).unwrap(), b"prior");
    }
}

#[test]
fn capability_no_replace_publishes_candidate() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("records")).unwrap();
    let authority = ProjectDirectory::open(root.path()).unwrap();
    let source = ProjectRelativePath::new("candidate").unwrap();
    let destination = ProjectRelativePath::new("records/record").unwrap();
    fs::write(root.path().join(source.as_path()), b"candidate").unwrap();

    authority
        .rename_regular_file_no_replace(&source, &destination)
        .unwrap();

    assert!(!root.path().join(source.as_path()).exists());
    assert_eq!(authority.read_regular(&destination).unwrap(), b"candidate");
}

#[cfg(unix)]
#[test]
fn open_regular_rejects_fifo_without_waiting_for_writer() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::process::{Child, Command};
    use std::time::{Duration, Instant};

    const CHILD_ROOT: &str = "EASL_FIFO_REJECTION_TEST_ROOT";
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        let authority = ProjectDirectory::open(root).unwrap();
        let path = ProjectRelativePath::new("record").unwrap();
        let error = authority.open_regular(&path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        return;
    }

    // Reap the child even when the bounded assertion fails. A thread would
    // leave the original blocking FIFO open alive after a timeout.
    struct ReapedChild(Child);
    impl Drop for ReapedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    let root = tempdir().unwrap();
    let fifo = CString::new(root.path().join("record").as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let mut child = ReapedChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "open_regular_rejects_fifo_without_waiting_for_writer",
                "--nocapture",
            ])
            .env(CHILD_ROOT, root.path())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success(), "FIFO rejection child failed: {status}");
            break;
        }
        assert!(
            Instant::now() < deadline,
            "open_regular blocked on a FIFO with no writer"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(windows)]
#[test]
fn project_directory_pins_root_until_capability_is_dropped() {
    let parent = tempdir().unwrap();
    let root = parent.path().join("project");
    let moved = parent.path().join("moved");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("record"), b"authority").unwrap();
    let authority = ProjectDirectory::open(&root).unwrap();

    assert!(fs::rename(&root, &moved).is_err());
    assert_eq!(
        authority
            .read_regular(&ProjectRelativePath::new("record").unwrap())
            .unwrap(),
        b"authority"
    );
    drop(authority);
    fs::rename(&root, &moved).unwrap();
}

#[test]
fn atomic_replace_makes_candidate_visible() {
    let root = tempdir().unwrap();
    let source = root.path().join("candidate");
    let destination = root.path().join("record");
    fs::write(&source, b"candidate").unwrap();
    fs::write(&destination, b"prior").unwrap();

    atomic_replace(&source, &destination).unwrap();

    assert!(!source.exists());
    assert_eq!(fs::read(&destination).unwrap(), b"candidate");
}

#[test]
fn sync_directory_reports_platform_support() {
    let root = tempdir().unwrap();

    let outcome = sync_directory(root.path()).unwrap();

    #[cfg(unix)]
    assert!(outcome.is_supported());
    #[cfg(not(unix))]
    assert!(!outcome.is_supported());
}

#[test]
fn cleanup_owned_candidate_removes_owned_regular_file() {
    let root = tempdir().unwrap();
    let candidate = ProjectRelativePath::new("candidate").unwrap();
    fs::write(root.path().join(candidate.as_path()), b"owned").unwrap();
    let directory = ProjectDirectory::open(root.path()).unwrap();

    assert!(directory.cleanup_owned_candidate(&candidate).unwrap());
    assert!(!root.path().join(candidate.as_path()).exists());
}

#[cfg(unix)]
#[test]
fn cleanup_owned_candidate_preserves_symlink_and_target() {
    let root = tempdir().unwrap();
    let foreign = tempdir().unwrap();
    let target = foreign.path().join("target");
    let candidate = ProjectRelativePath::new("candidate").unwrap();
    fs::write(&target, b"foreign").unwrap();
    std::os::unix::fs::symlink(&target, root.path().join(candidate.as_path())).unwrap();
    let directory = ProjectDirectory::open(root.path()).unwrap();

    assert!(directory.cleanup_owned_candidate(&candidate).is_err());
    assert!(
        fs::symlink_metadata(root.path().join(candidate.as_path()))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read(target).unwrap(), b"foreign");
}

#[cfg(unix)]
#[test]
fn replacement_rejects_parent_swapped_after_authority_open() {
    let root = tempdir().unwrap();
    let foreign = tempdir().unwrap();
    fs::create_dir_all(root.path().join("records")).unwrap();
    fs::write(root.path().join("records/candidate"), b"candidate").unwrap();
    fs::write(foreign.path().join("record"), b"foreign").unwrap();
    let authority = ProjectDirectory::open(root.path()).unwrap();
    let candidate = ProjectRelativePath::new("records/candidate").unwrap();
    let record = ProjectRelativePath::new("records/record").unwrap();

    fs::rename(
        root.path().join("records"),
        root.path().join("records-moved"),
    )
    .unwrap();
    std::os::unix::fs::symlink(foreign.path(), root.path().join("records")).unwrap();

    assert!(authority.replace_regular_file(&candidate, &record).is_err());
    assert_eq!(fs::read(foreign.path().join("record")).unwrap(), b"foreign");
}

#[cfg(windows)]
#[test]
fn junction_authority_component_is_rejected_and_foreign_bytes_preserved() {
    use std::process::Command;
    let project = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    std::fs::write(foreign.path().join("record.json"), b"foreign").unwrap();
    let junction = project.path().join("authority");
    assert!(
        Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(foreign.path())
            .status()
            .unwrap()
            .success()
    );
    let directory = ProjectDirectory::open(project.path()).unwrap();
    assert!(
        directory
            .read_regular(&ProjectRelativePath::new("authority/record.json").unwrap())
            .is_err()
    );
    assert_eq!(
        std::fs::read(foreign.path().join("record.json")).unwrap(),
        b"foreign"
    );
    std::fs::remove_dir(junction).unwrap();
}

#[test]
fn journal_capabilities_retain_file_witness_and_confine_directory_operations() {
    let root = tempdir().unwrap();
    let directory = ProjectDirectory::open(root.path()).unwrap();
    let relative = |p| ProjectRelativePath::new(p).unwrap();
    directory
        .create_dir_all_durable(&relative("owned/backups"))
        .unwrap();
    fs::write(root.path().join("owned/candidate"), b"owned").unwrap();
    directory
        .hard_link_regular_no_replace(&relative("owned/candidate"), &relative("owned/installed"))
        .unwrap();
    assert_eq!(
        directory
            .entry_identity(&relative("owned/candidate"))
            .unwrap(),
        directory
            .entry_identity(&relative("owned/installed"))
            .unwrap()
    );
    assert!(
        directory
            .hard_link_regular_no_replace(
                &relative("owned/candidate"),
                &relative("owned/installed")
            )
            .is_err()
    );
    assert!(
        directory
            .remove_empty_directory(&relative("owned"))
            .is_err()
    );
    directory
        .rename_entry_no_replace(&relative("owned/backups"), &relative("owned/moved"))
        .unwrap();
    assert!(
        directory
            .directory_names(&relative("owned"))
            .unwrap()
            .contains(&"moved".into())
    );
    directory
        .remove_empty_directory(&relative("owned/moved"))
        .unwrap();
    assert_eq!(
        directory
            .read_regular(&relative("owned/installed"))
            .unwrap(),
        b"owned"
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.path().join("owned"), root.path().join("link")).unwrap();
        assert!(directory.directory_names(&relative("link")).is_err());
        assert!(
            directory
                .entry_identity(&relative("link/candidate"))
                .is_err()
        );
        assert!(
            directory
                .rename_entry_no_replace(&relative("link/candidate"), &relative("owned/foreign"))
                .is_err()
        );
    }
}
