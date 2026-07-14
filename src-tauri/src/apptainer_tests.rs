use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("exploreasl-gui-apptainer-{name}-{suffix}"))
    }

    #[cfg(unix)]
    #[test]
    fn command_timeout_kills_a_long_running_process() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 1"]);

        let error = run_command_with_timeout(command, Duration::from_millis(20))
            .expect_err("long-running command should time out");

        assert!(error.contains("timed out"));
    }

    #[test]
    fn mcr_cache_path_prefers_explicit_environment_variable() {
        let cache = unique_temp_path("mcr-cache");
        let previous = env::var_os("MCR_CACHE_ROOT");
        env::set_var("MCR_CACHE_ROOT", &cache);

        assert_eq!(mcr_cache_path(), cache);

        match previous {
            Some(value) => env::set_var("MCR_CACHE_ROOT", value),
            None => env::remove_var("MCR_CACHE_ROOT"),
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
}
