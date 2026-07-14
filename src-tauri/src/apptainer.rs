use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) const CONTAINER_DATA_ROOT: &str = "/data";
pub(crate) const EXPLOREASL_SCRIPT: &str = "/opt/xasl/xASL_latest/run_xASL_latest.sh";
pub(crate) const MCR_PATH: &str = "/opt/mcr/v97/";

pub(crate) fn resolve_apptainer_executable(command: &str) -> Result<String, String> {
    let path_var = env::var_os("PATH").unwrap_or_default();
    resolve_apptainer_executable_with_path(command, &path_var.to_string_lossy())
}

pub(crate) fn resolve_apptainer_executable_with_path(
    command: &str,
    path_var: &str,
) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("Apptainer executable path must not be empty".to_string());
    }

    if is_path_like(command) {
        validate_executable_path(Path::new(command))?;
        return Ok(command.to_string());
    }

    if let Some(path) = find_executable_on_path(command, path_var) {
        return Ok(path.to_string_lossy().to_string());
    }

    if command == "apptainer" {
        if let Some(path) = find_executable_on_path("singularity", path_var) {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "Apptainer executable not found on system PATH: {command}"
    ))
}

#[tauri::command]
pub async fn which_apptainer(custom_paths: Option<Vec<String>>) -> Vec<serde_json::Value> {
    let path_var = env::var_os("PATH").unwrap_or_default();
    let paths = discover_apptainer_paths(custom_paths.as_deref(), &path_var.to_string_lossy());

    let mut handles = Vec::with_capacity(paths.len());
    for (index, path) in paths.into_iter().enumerate() {
        handles.push(tauri::async_runtime::spawn_blocking(move || {
            let version = detect_apptainer_cli_version(&path);
            serde_json::json!({
                "id": format!("apptainer_{index}"),
                "label": format_apptainer_label(&path, version.as_deref()),
                "path": path.to_string_lossy(),
                "version": version,
            })
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }
    results
}

pub(crate) fn discover_apptainer_paths(
    custom_paths: Option<&[String]>,
    path_var: &str,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    let scan_all = custom_paths.is_none_or(|paths| paths.is_empty());

    if let Some(custom_paths) = custom_paths {
        for path in custom_paths {
            add_apptainer_candidate(Path::new(path.trim()), &mut paths, &mut seen);
        }
    }

    if scan_all {
        for directory in env::split_paths(path_var) {
            for candidate in apptainer_executable_candidates(&directory) {
                add_apptainer_candidate(&candidate, &mut paths, &mut seen);
            }
        }
    }

    paths
}

fn add_apptainer_candidate(
    candidate: &Path,
    paths: &mut Vec<PathBuf>,
    seen: &mut HashSet<PathBuf>,
) {
    if !candidate.as_os_str().is_empty() && candidate.is_file() && is_executable(candidate) {
        if let Ok(canonical) = fs::canonicalize(candidate) {
            if seen.insert(canonical) {
                paths.push(candidate.to_path_buf());
            }
        }
    }
}

fn apptainer_executable_candidates(directory: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for name in ["apptainer", "singularity"] {
        candidates.extend(executable_candidates_for_name(directory, name));
    }
    candidates
}

#[cfg(windows)]
fn executable_candidates_for_name(directory: &Path, name: &str) -> Vec<PathBuf> {
    let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(|extension| directory.join(format!("{name}{extension}")))
        .chain(std::iter::once(directory.join(name)))
        .collect()
}

#[cfg(not(windows))]
fn executable_candidates_for_name(directory: &Path, name: &str) -> Vec<PathBuf> {
    vec![directory.join(name)]
}

pub(crate) fn detect_apptainer_cli_version(binary: &Path) -> Option<String> {
    run_apptainer_version_command(binary)
        .ok()
        .and_then(|output| {
            parse_apptainer_cli_version(&String::from_utf8_lossy(&output.stdout))
                .or_else(|| parse_apptainer_cli_version(&String::from_utf8_lossy(&output.stderr)))
        })
}

pub(crate) fn parse_apptainer_cli_version(output: &str) -> Option<String> {
    let mut after_version = false;
    for token in output.split_whitespace() {
        let token = token.trim_matches(|character: char| {
            character == ':' || character == ',' || character == '(' || character == ')'
        });
        if token.eq_ignore_ascii_case("version") {
            after_version = true;
            continue;
        }
        if after_version && !token.is_empty() {
            return Some(token.to_string());
        }
    }

    output
        .split_whitespace()
        .map(|token| {
            token.trim_matches(|character: char| {
                character == ':' || character == ',' || character == '(' || character == ')'
            })
        })
        .find(|token| {
            token
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
        .map(str::to_string)
}

pub(crate) fn format_apptainer_label(binary: &Path, version: Option<&str>) -> String {
    let name = binary
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .map(|stem| {
            if stem.eq_ignore_ascii_case("singularity") {
                "Singularity"
            } else {
                "Apptainer"
            }
        })
        .unwrap_or("Apptainer");

    match version {
        Some(version) => format!("{name} {version}"),
        None => format!("{name} ({})", binary.display()),
    }
}

pub(crate) fn detect_apptainer_version(
    apptainer_path: &str,
    sif_path: &Path,
) -> Result<String, String> {
    let mut command = Command::new(apptainer_path);
    command.args([
        "exec",
        &sif_path.to_string_lossy(),
        "ls",
        "/opt/xasl/xASL_latest/",
    ]);

    let output = run_command_with_timeout(command, Duration::from_secs(5))
        .map_err(|error| format!("Version detection timed out or failed: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to run apptainer exec inside SIF: exit status {}",
            output.status
        ));
    }

    output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| std::str::from_utf8(line).ok())
        .filter_map(|line| line.trim().strip_prefix("VERSION_"))
        .find(|version| !version.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "Could not find VERSION_* file in container /opt/xasl/xASL_latest/".to_string()
        })
}

pub(crate) fn validate_apptainer_executable(apptainer_path: &str) -> Result<(), String> {
    let output = run_apptainer_version_command(Path::new(apptainer_path))
        .map_err(|error| format!("Failed to run Apptainer executable: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Apptainer executable failed --version with exit status {}",
            output.status
        ))
    }
}

fn run_apptainer_version_command(binary: &Path) -> Result<Output, String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    run_command_with_timeout(command, Duration::from_secs(5))
}

pub(crate) fn ensure_mcr_cache(
    apptainer_path: &str,
    sif_path: &Path,
    project_root: &Path,
) -> Result<(), String> {
    let cache_dir = mcr_cache_path();
    if cache_dir.exists() {
        return Ok(());
    }

    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Failed to create MCR cache directory {}: {error}",
            cache_dir.display()
        )
    })?;

    log::info!(
        "MCR cache not found at {}. Performing warm-up...",
        cache_dir.display()
    );

    let mut command = Command::new(apptainer_path);
    command.args([
        "exec",
        "--cleanenv",
        "--writable-tmpfs",
        "--bind",
        &format!("{}:{CONTAINER_DATA_ROOT}", project_root.display()),
        "--bind",
        &format!("{}:{}", cache_dir.display(), cache_dir.display()),
        "--env",
        &format!("MCR_CACHE_ROOT={}", cache_dir.display()),
        &sif_path.to_string_lossy(),
        "/bin/bash",
        EXPLOREASL_SCRIPT,
        MCR_PATH,
    ]);

    let status = match command.status() {
        Ok(status) => status,
        Err(error) => {
            let _ = fs::remove_dir_all(&cache_dir);
            return Err(format!("Failed to spawn MCR warmup command: {error}"));
        }
    };
    if !status.success() {
        let _ = fs::remove_dir_all(&cache_dir);
        return Err(format!(
            "MCR warmup run failed with exit status {status}. Check container permissions and MCR path."
        ));
    }

    Ok(())
}

pub(crate) fn mcr_cache_path() -> PathBuf {
    env::var_os("MCR_CACHE_ROOT")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".mcrCache9.7")))
        .unwrap_or_else(|| PathBuf::from(".mcrCache9.7"))
}

pub(crate) fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<Output, String> {
    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("Failed to collect command output: {error}"));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "command timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed while waiting for command: {error}"));
            }
        }
    }
}

fn find_executable_on_path(command: &str, path_var: &str) -> Option<PathBuf> {
    env::split_paths(path_var)
        .map(|directory| directory.join(command))
        .find(|candidate| candidate.is_file() && is_executable(candidate))
}

fn validate_executable_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!(
            "Apptainer executable not found: {}",
            path.display()
        ));
    }
    if !path.is_file() {
        return Err(format!("Apptainer path is not a file: {}", path.display()));
    }
    if !is_executable(path) {
        return Err(format!(
            "Apptainer executable is not executable: {}",
            path.display()
        ));
    }
    Ok(())
}

fn is_path_like(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() || value.contains('/') || value.contains('\\')
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
#[path = "apptainer_tests.rs"]
mod apptainer_tests;
