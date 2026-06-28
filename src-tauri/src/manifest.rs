use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::tracing::CommandTrace;

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentVersions {
    pub explore_asl: String,
    pub matlab: String,
}

fn read_exploreasl_version_file(explore_asl_path: &Path) -> Result<String, String> {
    let entries = fs::read_dir(explore_asl_path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(version) = file_name.strip_prefix("VERSION_") {
            if !version.is_empty() {
                return Ok(version.to_string());
            }
        }
    }
    Err("no VERSION_* file found".to_string())
}

fn probe_matlab_version(matlab_path: &Path) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    let binary = matlab_path.to_path_buf();
    let timeout = Duration::from_secs(15);

    thread::spawn(move || {
        let result = run_matlab_full_version(&binary);
        let _ = tx.send(result);
    });

    rx.recv_timeout(timeout)
        .ok()
        .flatten()
        .ok_or_else(|| "matlab probe timed out or failed".to_string())
}

fn run_matlab_full_version(binary: &Path) -> Option<String> {
    let output = match Command::new(binary)
        .args(["-batch", "disp(version)"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(_) => return None,
    };

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.trim();
    if version.is_empty() {
        return None;
    }
    Some(version.to_string())
}

#[tauri::command]
pub fn capture_environment_versions(
    explore_asl_path: String,
    matlab_path: String,
) -> EnvironmentVersions {
    let trace = CommandTrace::new("capture_environment_versions");
    trace.arg("explore_asl_path", &explore_asl_path);
    trace.arg("matlab_path", &matlab_path);

    let explore_asl = read_exploreasl_version_file(&PathBuf::from(explore_asl_path.trim()))
        .unwrap_or_else(|_| "unknown".to_string());
    let matlab = probe_matlab_version(&PathBuf::from(matlab_path.trim()))
        .unwrap_or_else(|_| "unknown".to_string());

    let result = EnvironmentVersions {
        explore_asl,
        matlab,
    };
    trace.success(&result);
    result
}

#[tauri::command]
pub fn read_population_ready_mtime(project_root: String) -> Option<i64> {
    let trace = CommandTrace::new("read_population_ready_mtime");
    trace.arg("project_root", &project_root);

    let p = PathBuf::from(&project_root)
        .join("derivatives")
        .join("ExploreASL")
        .join("xASL_module_Population")
        .join("xASL_module_Population")
        .join("999_ready.status");

    let result = p.metadata().ok().and_then(|m| {
        m.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        })
    });

    trace.success(&result);
    result
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn returns_unknown_on_missing_version_files() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("easl-gui-version-missing-{}", ts));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let result = capture_environment_versions(
            tmp.to_string_lossy().to_string(),
            "/nonexistent/matlab".to_string(),
        );
        assert_eq!(result.explore_asl, "unknown");
        assert_eq!(result.matlab, "unknown");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reads_version_from_version_file() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("easl-gui-version-file-{}", ts));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        fs::write(tmp.join("VERSION_1.0.0"), "").unwrap();

        let result = capture_environment_versions(
            tmp.to_string_lossy().to_string(),
            "/nonexistent/matlab".to_string(),
        );
        assert_eq!(result.explore_asl, "1.0.0");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn probes_matlab_version() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("easl-gui-matlab-probe-{}", ts));
        fs::create_dir_all(&dir).unwrap();

        let fake_matlab = dir.join("matlab");
        {
            let mut f = fs::File::create(&fake_matlab).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "echo '9.13.0.2126072 (R2022b)'").unwrap();
        }

        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fake_matlab, PermissionsExt::from_mode(0o755)).unwrap();

        let tmp = std::env::temp_dir().join(format!("easl-gui-version-matlab-tmp-{}", ts));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let result = capture_environment_versions(
            tmp.to_string_lossy().to_string(),
            fake_matlab.to_string_lossy().to_string(),
        );
        assert_eq!(result.matlab, "9.13.0.2126072 (R2022b)");

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn returns_none_when_population_mtime_file_missing() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("easl-gui-mtime-missing-{}", ts));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let result = read_population_ready_mtime(tmp.to_string_lossy().to_string());
        assert_eq!(result, None);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn returns_mtime_when_population_file_present() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("easl-gui-mtime-present-{}", ts));
        let _ = fs::remove_dir_all(&tmp);

        let pop_dir = tmp
            .join("derivatives")
            .join("ExploreASL")
            .join("xASL_module_Population")
            .join("xASL_module_Population");
        fs::create_dir_all(&pop_dir).unwrap();
        fs::write(pop_dir.join("999_ready.status"), "").unwrap();

        let result = read_population_ready_mtime(tmp.to_string_lossy().to_string());
        assert!(result.is_some());

        let _ = fs::remove_dir_all(&tmp);
    }
}
