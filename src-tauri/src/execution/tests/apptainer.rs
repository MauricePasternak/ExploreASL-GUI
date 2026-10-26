use super::common::*;
use crate::execution::apptainer::*;
#[cfg(unix)]
use crate::execution::command::sanitize_ld_library_path;
use crate::execution::command::should_redirect_cwd;
use std::env;
#[cfg(unix)]
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(unix)]
fn apptainer_stub(root: &Path, script: &str) -> PathBuf {
    let binary = root.join("apptainer");
    write_executable(&binary, &format!("#!/bin/sh\n{script}\n"));
    binary
}

#[cfg(unix)]
#[test]
fn apptainer_probes_drain_and_bound_both_pipes() {
    let root = tempfile::tempdir().unwrap();
    let binary = apptainer_stub(
        root.path(),
        "if [ \"$1\" = --version ]; then printf 'apptainer version 1.5.2\\n'; else\n[ \"$2\" = --cleanenv ] && [ \"$4\" = ls ] && [ \"$5\" = /opt/xasl/xASL_latest/ ] || exit 9\nprintf 'VERSION_1.11.0\\n'; fi\npwd >&2\nhead -c 300000 /dev/zero | tr '\\000' x\nhead -c 300000 /dev/zero | tr '\\000' e >&2",
    );

    let output = run_apptainer_version_command(&binary).unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 256 * 1024);
    assert_eq!(output.stderr.len(), 256 * 1024);
    assert!(output.stdout_truncated && output.stderr_truncated);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(
        fs::canonicalize(stderr.lines().next().unwrap()).unwrap(),
        fs::canonicalize(env::temp_dir()).unwrap()
    );
    assert_eq!(
        detect_apptainer_cli_version(&binary).as_deref(),
        Some("1.5.2")
    );
    assert_eq!(
        detect_apptainer_version(binary.to_str().unwrap(), &root.path().join("image.sif")).unwrap(),
        "1.11.0"
    );
}

#[cfg(unix)]
#[test]
fn apptainer_probes_preserve_failure_status_and_image_stderr() {
    let root = tempfile::tempdir().unwrap();
    let binary = apptainer_stub(
        root.path(),
        "echo 'apptainer version 1.5.2' >&2\necho 'cannot read image' >&2\nexit 7",
    );

    assert_eq!(
        detect_apptainer_cli_version(&binary).as_deref(),
        Some("1.5.2")
    );

    assert!(
        validate_apptainer_executable(binary.to_str().unwrap())
            .unwrap_err()
            .to_string()
            .contains('7')
    );
    let error = detect_apptainer_version(binary.to_str().unwrap(), &root.path().join("image.sif"))
        .unwrap_err();
    assert!(error.to_string().contains("cannot read image"));
    assert!(error.to_string().contains('7'));
}

#[cfg(unix)]
#[test]
fn apptainer_discovery_and_profile_timeout_settle_supported_scopes() {
    use crate::execution::profile::ExecutionProfile;
    use std::time::Instant;

    for image_probe in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let binary = apptainer_stub(
            root.path(),
            &format!(
                "if [ {image_probe} = true ] && [ \"$1\" = --version ]; then echo 'apptainer version 1.5.2'; exit 0; fi\ncd \"$(dirname \"$0\")\"\ntrap 'wait \"$child\"; exit 0' TERM\nsleep 20 &\nchild=$!\nprintf '%s %s' \"$$\" \"$child\" > scope-pids\nwait \"$child\""
            ),
        );
        let started = Instant::now();
        if image_probe {
            let sif = root.path().join("image.sif");
            fs::write(&sif, "fixture").unwrap();
            let profile = ExecutionProfile::Apptainer {
                id: "fixture".into(),
                label: "fixture".into(),
                apptainer_path: binary.to_string_lossy().into_owned(),
                sif_path: sif.to_string_lossy().into_owned(),
                explore_asl_version: None,
            };
            let validation = profile.validate();
            assert!(!validation.valid);
            assert!(validation.explore_asl_version.is_none());
            assert!(
                validation
                    .errors
                    .iter()
                    .any(|error| error.contains("Apptainer could not run the selected container"))
            );
        } else {
            let results = tauri::async_runtime::block_on(which_apptainer(Some(vec![
                binary.to_string_lossy().into_owned(),
            ])));
            assert_eq!(results.len(), 1);
            assert!(results[0]["version"].is_null());
        }
        assert!(started.elapsed() >= Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(15));
        let pids = fs::read_to_string(root.path().join("scope-pids")).unwrap();
        let pids: Vec<i32> = pids
            .split_whitespace()
            .map(|pid| pid.parse().unwrap())
            .collect();
        for pid in [pids[0], pids[1], -pids[0]] {
            assert_eq!(
                unsafe { libc::kill(pid, 0) },
                -1,
                "scope member {pid} survived probe"
            );
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
        }
    }
}

#[test]
fn mcr_cache_path_prefers_explicit_environment_variable() {
    let cache = unique_temp_path("mcr-cache");
    let previous = env::var_os("MCR_CACHE_ROOT");
    unsafe {
        env::set_var("MCR_CACHE_ROOT", &cache);
    }

    assert_eq!(mcr_cache_path(), cache);

    match previous {
        Some(value) => unsafe {
            env::set_var("MCR_CACHE_ROOT", value);
        },
        None => unsafe {
            env::remove_var("MCR_CACHE_ROOT");
        },
    }
}

#[test]
fn parses_cli_version_from_apptainer_output() {
    assert_eq!(
        parse_apptainer_cli_version("apptainer version 1.5.2\n"),
        Some("1.5.2".to_string())
    );
    assert_eq!(
        parse_apptainer_cli_version("apptainer version 1.5.2-rc1"),
        Some("1.5.2-rc1".to_string())
    );
}

#[test]
fn formats_labels_from_binary_name_and_version() {
    assert_eq!(
        format_apptainer_label(Path::new("/usr/bin/apptainer"), Some("1.5.2")),
        "Apptainer 1.5.2"
    );
    assert_eq!(
        format_apptainer_label(Path::new("/usr/bin/singularity"), Some("4.1.0")),
        "Singularity 4.1.0"
    );
}

#[cfg(unix)]
#[test]
fn discovers_all_apptainer_and_singularity_candidates_on_path() {
    use std::os::unix::fs::PermissionsExt;

    let root = unique_temp_path("discover-multiple");
    let first_bin = root.join("first");
    let second_bin = root.join("second");
    fs::create_dir_all(&first_bin).expect("first bin should be created");
    fs::create_dir_all(&second_bin).expect("second bin should be created");

    for path in [first_bin.join("apptainer"), second_bin.join("singularity")] {
        fs::write(&path, "#!/bin/sh\n").expect("candidate should be written");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .expect("candidate should be executable");
    }

    let path_var = env::join_paths([&first_bin, &second_bin])
        .expect("PATH entries should join")
        .to_string_lossy()
        .to_string();
    let paths = discover_apptainer_paths(None, &path_var);

    assert_eq!(
        paths,
        vec![first_bin.join("apptainer"), second_bin.join("singularity")]
    );
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn custom_apptainer_paths_are_deduplicated_and_skip_path_scan() {
    use std::os::unix::fs::PermissionsExt;

    let root = unique_temp_path("discover-custom");
    fs::create_dir_all(&root).expect("candidate directory should be created");
    let candidate = root.join("custom-apptainer");
    let path_candidate = candidate.to_string_lossy().to_string();
    fs::write(&candidate, "#!/bin/sh\n").expect("candidate should be written");
    fs::set_permissions(&candidate, fs::Permissions::from_mode(0o755))
        .expect("candidate should be executable");

    let paths = discover_apptainer_paths(
        Some(&[path_candidate.clone(), path_candidate]),
        "/a/path/that/must/not/be/scanned",
    );

    assert_eq!(paths, vec![candidate]);
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn sanitize_ld_library_path_strips_appimage_mounts() {
    let appdir = "/tmp/.mount_TestAppImage123";
    let ld = format!("{appdir}/usr/lib:/usr/local/lib:/opt/other/lib");

    let result = sanitize_ld_library_path(&ld, Some(appdir));

    assert_eq!(result, vec!["/usr/local/lib", "/opt/other/lib"]);
}

#[cfg(unix)]
#[test]
fn sanitize_ld_library_path_strips_tmp_mount_prefixes() {
    let ld = "/tmp/.mount_ABC/usr/lib:/usr/lib:/tmp/.mount_XYZ/lib";

    let result = sanitize_ld_library_path(ld, None);

    assert_eq!(result, vec!["/usr/lib"]);
}

#[cfg(unix)]
#[test]
fn sanitize_ld_library_path_preserves_non_appimage_paths() {
    let ld = "/usr/local/lib:/opt/cuda/lib64";

    let result = sanitize_ld_library_path(ld, Some("/tmp/.mount_Foo"));

    assert_eq!(result, vec!["/usr/local/lib", "/opt/cuda/lib64"]);
}

#[cfg(unix)]
#[test]
fn sanitize_ld_library_path_returns_empty_when_all_stripped() {
    let appdir = "/tmp/.mount_Only";
    let ld = format!("{appdir}/lib:{appdir}/usr/lib");

    let result = sanitize_ld_library_path(&ld, Some(appdir));

    assert!(result.is_empty());
}

#[test]
fn should_redirect_cwd_detects_appimage_mount() {
    assert!(should_redirect_cwd("/tmp/.mount_Foo/app", None));
    assert!(should_redirect_cwd("/home/user/.mount_Bar/bin", None));
}

#[test]
fn run_should_redirect_cwd_detects_appdir_prefix() {
    assert!(should_redirect_cwd(
        "/tmp/.mount_AppDir/subdir",
        Some("/tmp/.mount_AppDir")
    ));
}

#[test]
fn run_should_redirect_cwd_rejects_normal_paths() {
    assert!(!should_redirect_cwd("/home/user/projects", None));
    assert!(!should_redirect_cwd("/opt/bin", Some("/tmp/.mount_App")));
}
