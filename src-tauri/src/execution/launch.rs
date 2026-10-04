//! Cancellable pre-launch checks, bounded probes, and container cache warmup.
//! Import and processing own their scientific run/result policy.
use super::{
    command::create_system_command, executables::validate_matlab_executable,
    profile::ExecutionProfile,
};
use crate::process::{CancellationToken, run_probe};
use anyhow::{Context, Result, bail};
use std::{path::Path, process::Command, time::Duration};
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
            crate::execution::profile::validate_exploreasl_path(explore_asl_path)?;
            Ok(create_system_command(matlab))
        }
        ExecutionProfile::Apptainer {
            apptainer_path,
            sif_path,
            ..
        } => {
            let executable =
                crate::execution::apptainer::resolve_apptainer_executable(apptainer_path)?;
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
        &crate::execution::apptainer::mcr_cache_path(),
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
            crate::execution::apptainer::CONTAINER_DATA_ROOT
        ),
        "--bind",
        &format!("{}:{}", cache.display(), cache.display()),
        "--env",
        &format!("MCR_CACHE_ROOT={}", cache.display()),
        &sif.to_string_lossy(),
        "/bin/bash",
        crate::execution::apptainer::EXPLOREASL_SCRIPT,
        crate::execution::apptainer::MCR_PATH,
    ]);
    if !probe(command, Duration::from_secs(300), cancellation)?.success {
        bail!("MCR cache warmup failed");
    }
    Ok(())
}
