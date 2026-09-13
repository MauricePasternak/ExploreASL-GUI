//! Native preparation reads intent once and installs only journal-owned artifacts.
use super::{
    journal::relative, record::ProcessingRecord, transaction::LaunchTransaction,
    types::ProcessingVersions,
};
use crate::{execution_profile::ExecutionProfile, fs_safety::ProjectDirectory};
use anyhow::{Result, bail};
use easl_execution_runtime::process::CancellationToken;
use std::{process::Command, time::Duration};

pub(crate) fn versions(
    profile: &ExecutionProfile,
    command: &Command,
    cancellation: CancellationToken,
) -> Result<ProcessingVersions> {
    let (explore_asl, matlab) = match profile {
        ExecutionProfile::Matlab {
            explore_asl_path, ..
        } => {
            let explore = crate::execution_profile::get_exploreasl_version(std::path::Path::new(
                explore_asl_path,
            ))
            .unwrap_or_else(|| "unknown".into());
            let mut probe = crate::apptainer::create_system_command(command.get_program());
            probe
                .current_dir(std::env::temp_dir())
                .args(["-batch", "disp(version)"]);
            let matlab = if let Some(version) = crate::matlab::probe_matlab_version_fast(
                std::path::Path::new(command.get_program()),
            ) {
                version
            } else {
                match crate::execution_managed::probe(
                    probe,
                    Duration::from_secs(15),
                    cancellation.clone(),
                ) {
                    Ok(output) if output.success => {
                        String::from_utf8_lossy(&output.stdout).trim().to_string()
                    }
                    Ok(_) => "unknown".into(),
                    Err(error) => {
                        // The bounded probe retains its scope through settlement.
                        // Non-timeout failure keeps the historical unknown fallback.
                        if error
                            .downcast_ref::<std::io::Error>()
                            .is_some_and(|e| e.kind() == std::io::ErrorKind::TimedOut)
                        {
                            return Err(error);
                        }
                        "unknown".into()
                    }
                }
            };
            (
                explore,
                if matlab.is_empty() {
                    "unknown".into()
                } else {
                    matlab
                },
            )
        }
        ExecutionProfile::Apptainer {
            apptainer_path,
            sif_path,
            ..
        } => {
            let executable = crate::apptainer::resolve_apptainer_executable(apptainer_path)?;
            let mut probe = crate::apptainer::create_system_command(executable);
            probe.args([
                "exec",
                "--cleanenv",
                sif_path.trim(),
                "ls",
                "/opt/xasl/xASL_latest/",
            ]);
            let output =
                crate::execution_managed::probe(probe, Duration::from_secs(15), cancellation)?;
            (
                if output.success {
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .find_map(|s| s.trim().strip_prefix("VERSION_"))
                        .unwrap_or("unknown")
                        .to_string()
                } else {
                    "unknown".into()
                },
                "unknown".into(),
            )
        }
    };
    Ok(ProcessingVersions {
        explore_asl,
        matlab,
        gui: env!("CARGO_PKG_VERSION").into(),
    })
}

fn read_optional(directory: &ProjectDirectory, path: &str) -> Result<Option<String>> {
    let relative = relative(path)?;
    match directory.entry_identity(&relative) {
        Ok((false, _, _)) => {}
        Ok(_) => bail!("Participant input must be a safe regular file: {path}"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    match directory.read_regular(&relative) {
        Ok(bytes) => Ok(String::from_utf8(bytes).ok()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            log::warn!(
                "Could not read participant input {path}; preserving merge fallback: {error}"
            );
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn prepare(record: &ProcessingRecord) -> Result<LaunchTransaction> {
    let root = &record.project_root;
    let inventory = super::subjects::list_subjects(
        root.to_string_lossy().into(),
        Some(record.data_source.clone()),
    )
    .map_err(anyhow::Error::msg)?;
    if super::record::expected_targets(&record.request, &inventory)? != record.expected_targets {
        bail!("Native processing inventory changed after reservation; reserve a new request");
    }
    let directory = ProjectDirectory::open(root)?;
    // DICOM never reads root TSV. Root JSON is never read for participant generation.
    let root_tsv = if record.data_source == "bids" {
        read_optional(&directory, "participants.tsv")?
    } else {
        None
    };
    let tsv = read_optional(&directory, "derivatives/ExploreASL/participants.tsv")?;
    let json = read_optional(&directory, "derivatives/ExploreASL/participants.json")?;
    let selected = if record.request.selected_subject_sessions.is_empty() {
        inventory
            .iter()
            .map(|s| s.subject_session.clone())
            .collect::<Vec<_>>()
    } else {
        record.request.selected_subject_sessions.clone()
    };
    let participants = super::participants::merge(
        &selected,
        &inventory,
        &record.request.participants,
        root_tsv.as_deref(),
        tsv.as_deref(),
        json.as_deref(),
    );
    let mut installations = vec![(
        "derivatives/ExploreASL/dataPar.json".into(),
        serde_json::to_vec_pretty(&record.assembled_configuration()?)?,
    )];
    for (path, bytes) in [
        ("derivatives/ExploreASL/participants.tsv", participants.tsv),
        (
            "derivatives/ExploreASL/participants.json",
            participants.json,
        ),
    ] {
        if let Some(bytes) = bytes {
            installations.push((path.into(), bytes.into_bytes()));
        }
    }
    let mut transaction = LaunchTransaction::plan(
        root,
        &record.run_id.to_string(),
        &super::runs::selected_modules_to_b_process(&record.request.selected_modules)
            .map_err(anyhow::Error::msg)?,
        &super::runs::selected_subject_sessions_regexp(&record.request.selected_subject_sessions),
        record.request.rerun_bids2legacy,
    )?;
    transaction.prepare_artifacts(&installations)?;
    Ok(transaction)
}
