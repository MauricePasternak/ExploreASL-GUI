//! Apptainer/Singularity discovery, container versions, and container path constants.
use super::command::create_system_command;
use crate::process::{CancellationToken, ProbeOutput, run_probe};
use anyhow::{Context, Result as AnyResult, bail};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(crate) const CONTAINER_DATA_ROOT: &str = "/data";
pub(crate) const EXPLOREASL_SCRIPT: &str = "/opt/xasl/xASL_latest/run_xASL_latest.sh";
pub(crate) const MCR_PATH: &str = "/opt/mcr/v97/";

pub(crate) fn resolve_apptainer_executable(command: &str) -> AnyResult<String> {
    let path_var = env::var_os("PATH").unwrap_or_default();
    resolve_apptainer_executable_with_path(command, &path_var.to_string_lossy())
}

pub(crate) fn resolve_apptainer_executable_with_path(
    command: &str,
    path_var: &str,
) -> AnyResult<String> {
    let command = command.trim();
    if command.is_empty() {
        bail!("Apptainer executable path must not be empty");
    }

    if is_path_like(command) {
        validate_executable_path(Path::new(command))?;
        return Ok(command.to_string());
    }

    if let Some(path) = find_executable_on_path(command, path_var) {
        return Ok(path.to_string_lossy().to_string());
    }

    if command == "apptainer"
        && let Some(path) = find_executable_on_path("singularity", path_var)
    {
        return Ok(path.to_string_lossy().to_string());
    }

    bail!("Apptainer executable not found on system PATH: {command}")
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
    if !candidate.as_os_str().is_empty()
        && candidate.is_file()
        && is_executable(candidate)
        && let Ok(canonical) = fs::canonicalize(candidate)
        && seen.insert(canonical)
    {
        paths.push(candidate.to_path_buf());
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

pub(crate) fn detect_apptainer_version(apptainer_path: &str, sif_path: &Path) -> AnyResult<String> {
    log::info!(
        "[APPTAINER] Detecting ExploreASL version for SIF: {} using executable: {}",
        sif_path.display(),
        apptainer_path
    );

    let mut command = create_system_command(apptainer_path);
    command.current_dir(env::temp_dir());
    command.args([
        "exec",
        "--cleanenv",
        &sif_path.to_string_lossy(),
        "ls",
        "/opt/xasl/xASL_latest/",
    ]);

    let output = run_probe(
        command,
        256 * 1024,
        Duration::from_secs(5),
        CancellationToken::default(),
    )
    .inspect_err(|error| {
        log::error!("[APPTAINER] Version detection timed out or failed: {error:#}")
    })
    .context("Version detection timed out or failed")?;

    if !output.status.success() {
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "[APPTAINER] exec failed inside SIF. Exit status: {}. stdout: {:?}, stderr: {:?}",
            output.status,
            stdout_str,
            stderr_str
        );
        let detail = if stderr_str.trim().is_empty() {
            format!("{}", output.status)
        } else {
            format!("{}: {}", output.status, stderr_str.trim())
        };
        bail!("Failed to run apptainer exec inside SIF ({detail})");
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let version = output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| std::str::from_utf8(line).ok())
        .filter_map(|line| line.trim().strip_prefix("VERSION_"))
        .find(|version| !version.is_empty())
        .map(str::to_string);

    match version {
        Some(v) => {
            log::info!("[APPTAINER] Successfully detected ExploreASL version: {v}");
            Ok(v)
        }
        None => {
            let msg = format!(
                "Could not find VERSION_* file in container /opt/xasl/xASL_latest/. Container output was: {:?}",
                stdout_str
            );
            log::error!("[APPTAINER] {msg}");
            bail!("Could not find VERSION_* file in container /opt/xasl/xASL_latest/")
        }
    }
}

pub(crate) fn validate_apptainer_executable(apptainer_path: &str) -> AnyResult<()> {
    log::info!(
        "[APPTAINER] Validating Apptainer executable: {}",
        apptainer_path
    );
    let output = run_apptainer_version_command(Path::new(apptainer_path))
        .inspect_err(|error| {
            log::error!("[APPTAINER] Failed to run Apptainer executable: {error:#}")
        })
        .context("Failed to run Apptainer executable")?;
    if output.status.success() {
        let version_str = String::from_utf8_lossy(&output.stdout);
        log::info!(
            "[APPTAINER] Executable validated successfully: {}",
            version_str.trim()
        );
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "[APPTAINER] Executable validation failed: status={}, stderr={:?}",
            output.status,
            stderr
        );
        bail!(
            "Apptainer executable failed --version with status {}",
            output.status
        )
    }
}

pub(crate) fn run_apptainer_version_command(binary: &Path) -> AnyResult<ProbeOutput> {
    let mut command = create_system_command(binary);
    command.current_dir(env::temp_dir());
    command.arg("--version");
    Ok(run_probe(
        command,
        256 * 1024,
        Duration::from_secs(5),
        CancellationToken::default(),
    )?)
}

pub(crate) fn mcr_cache_path() -> PathBuf {
    env::var_os("MCR_CACHE_ROOT")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".mcrCache9.7")))
        .unwrap_or_else(|| PathBuf::from(".mcrCache9.7"))
}

fn find_executable_on_path(command: &str, path_var: &str) -> Option<PathBuf> {
    env::split_paths(path_var)
        .map(|directory| directory.join(command))
        .find(|candidate| candidate.is_file() && is_executable(candidate))
}

fn validate_executable_path(path: &Path) -> AnyResult<()> {
    if !path.exists() {
        bail!("Apptainer executable not found: {}", path.display());
    }
    if !path.is_file() {
        bail!("Apptainer path is not a file: {}", path.display());
    }
    if !is_executable(path) {
        bail!("Apptainer executable is not executable: {}", path.display());
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
