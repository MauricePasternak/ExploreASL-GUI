//! Shared managed process mechanisms. Domain launch/result policy stays with its owner.
use crate::{apptainer::create_system_command, execution_profile::ExecutionProfile};
use anyhow::{Context, Result, Result as AnyResult, anyhow, bail};
use easl_execution_runtime::process::{CancellationToken, run_probe};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
pub(crate) const SETTLE_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) struct ManagedProbeOutput {
    pub stdout: Vec<u8>,
    pub success: bool,
}

pub(crate) fn probe(
    command: Command,
    timeout: Duration,
    cancellation: CancellationToken,
) -> Result<ManagedProbeOutput> {
    let output = run_probe(command, 256 * 1024, timeout, cancellation)?;
    Ok(ManagedProbeOutput {
        stdout: output.stdout,
        success: output.status.success(),
    })
}

pub(crate) fn validate_profile(
    profile: &ExecutionProfile,
    cancellation: CancellationToken,
) -> Result<Command> {
    match profile {
        ExecutionProfile::Matlab {
            matlab_path,
            explore_asl_path,
            ..
        } => {
            let matlab = validate_matlab_executable(matlab_path)?;
            crate::execution_profile::validate_exploreasl_path(explore_asl_path)?;
            Ok(create_system_command(matlab))
        }
        ExecutionProfile::Apptainer {
            apptainer_path,
            sif_path,
            ..
        } => {
            let executable = crate::apptainer::resolve_apptainer_executable(apptainer_path)?;
            if !Path::new(sif_path.trim()).is_file() {
                bail!("SIF image is not a file: {}", sif_path);
            }
            let mut command = create_system_command(&executable);
            command.current_dir(std::env::temp_dir()).arg("--version");
            if !probe(command, Duration::from_secs(5), cancellation.clone())?.success {
                bail!("Apptainer executable failed --version");
            }
            let mut command = create_system_command(&executable);
            command.current_dir(std::env::temp_dir()).args([
                "exec",
                "--cleanenv",
                sif_path.trim(),
                "ls",
                "/opt/xasl/xASL_latest/",
            ]);
            let output = probe(command, Duration::from_secs(5), cancellation)?;
            if !output.success
                || !String::from_utf8_lossy(&output.stdout).lines().any(|s| {
                    s.trim()
                        .strip_prefix("VERSION_")
                        .is_some_and(|v| !v.is_empty())
                })
            {
                bail!("Could not find VERSION_* file in container");
            }
            Ok(create_system_command(executable))
        }
    }
}

pub(crate) fn warm_cache(
    executable: &std::ffi::OsStr,
    sif: &Path,
    staging: &Path,
    cancellation: CancellationToken,
) -> Result<()> {
    warm_cache_at(
        executable,
        sif,
        staging,
        &crate::apptainer::mcr_cache_path(),
        cancellation,
    )
}

pub(crate) fn warm_cache_at(
    executable: &std::ffi::OsStr,
    sif: &Path,
    staging: &Path,
    cache: &Path,
    cancellation: CancellationToken,
) -> Result<()> {
    if cache.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(cache).context("Failed to create MCR cache")?;
    // Global shared cache has no exclusive custody. Preserve bytes even on failure.
    let mut command = create_system_command(executable);
    command.args([
        "exec",
        "--cleanenv",
        "--writable-tmpfs",
        "--bind",
        &format!(
            "{}:{}",
            staging.display(),
            crate::apptainer::CONTAINER_DATA_ROOT
        ),
        "--bind",
        &format!("{}:{}", cache.display(), cache.display()),
        "--env",
        &format!("MCR_CACHE_ROOT={}", cache.display()),
        &sif.to_string_lossy(),
        "/bin/bash",
        crate::apptainer::EXPLOREASL_SCRIPT,
        crate::apptainer::MCR_PATH,
    ]);
    if !probe(command, Duration::from_secs(300), cancellation)?.success {
        bail!("MCR cache warmup failed");
    }
    Ok(())
}

pub fn validate_matlab_executable(matlab_path: &str) -> AnyResult<String> {
    let matlab_path = validate_string_input("matlab_path", matlab_path)?;

    if is_path_like(&matlab_path) {
        let path = Path::new(&matlab_path);
        validate_executable_file(path)?;
        return Ok(matlab_path);
    }

    let path_var = env::var_os("PATH")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_default();
    find_executable_on_path(&matlab_path, &path_var)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| anyhow!("MATLAB executable not found on PATH: {}", matlab_path))
}

pub(crate) fn is_path_like(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() || value.contains('/') || value.contains('\\')
}

pub(crate) fn validate_executable_file(path: &Path) -> AnyResult<()> {
    if !path.exists() {
        bail!("MATLAB executable not found: {}", path.display());
    }
    if !path.is_file() {
        bail!("MATLAB path is not a file: {}", path.display());
    }
    if !is_executable_file(path) {
        bail!("MATLAB executable is not executable: {}", path.display());
    }

    Ok(())
}

#[cfg(unix)]
pub(crate) fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
pub(crate) fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

pub fn find_executable_on_path(command: &str, path_var: &str) -> Option<PathBuf> {
    if command.trim().is_empty() || is_path_like(command) {
        return None;
    }

    for dir in env::split_paths(path_var) {
        for candidate in executable_candidates(&dir, command) {
            if candidate.is_file() && is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(windows)]
pub(crate) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    let command_path = Path::new(command);
    if command_path.extension().is_some() {
        return vec![dir.join(command)];
    }

    let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|ext| !ext.is_empty())
        .map(|ext| dir.join(format!("{command}{ext}")))
        .chain(std::iter::once(dir.join(command)))
        .collect()
}

#[cfg(not(windows))]
pub(crate) fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

pub(crate) fn validate_string_input(name: &str, value: &str) -> AnyResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{} must not be empty", name);
    }

    Ok(trimmed.to_string())
}
