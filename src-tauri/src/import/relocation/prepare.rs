use super::candidate::{
    candidate_payload, populate_reserved_candidate, remove_candidate_wrapper,
    require_owned_fingerprint, reservation_token, reserve_candidate, sync_payload_rename,
    validate_candidate_marker, validate_ready_candidate,
};
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt};
#[cfg(test)]
use super::fault_injection::{create_collision, substitute, take};
use super::filesystem::{is_already_exists, path_exists, rename_no_replace, sync_parent};
use super::journal::write_journal;
use super::paths::{relative_owned, safe_join, subject_dir};
use super::planning::source_artifacts;
use super::types::{ArtifactPhase, ArtifactRole, DatasetPhase, RelocationJournal, SubjectPhase};
use anyhow::Context;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

pub(super) fn prepare_dataset(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    if journal.dataset.phase != DatasetPhase::Planned {
        return Ok(());
    }
    let source = staging.join("rawdata/dataset_description.json");
    let candidate = safe_join(root, &journal.dataset.candidate)?;
    let destination = safe_join(root, &journal.dataset.destination)?;
    let token = reservation_token(&candidate);
    journal.dataset.reservation_token = Some(token.clone());
    journal.dataset.phase = DatasetPhase::ReservationIntent;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetReservationIntent)?;
    reserve_candidate(root, &candidate, &token)?;
    interrupt(FaultPoint::InterruptAfterDatasetReservationOperation)?;
    journal.dataset.phase = DatasetPhase::CandidateReserved;
    write_journal(root, journal)?;
    sync_parent(candidate.parent().expect("dataset candidate parent"))?;
    interrupt(FaultPoint::InterruptAfterDatasetReserved)?;
    journal.dataset.phase = DatasetPhase::PopulationIntent;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetPopulationIntent)?;
    validate_candidate_marker(&candidate, journal.dataset.reservation_token.as_deref())?;
    let fingerprint = populate_reserved_candidate(&source, &candidate)?;
    interrupt(FaultPoint::InterruptAfterDatasetPopulationOperation)?;
    journal.dataset.fingerprint = Some(fingerprint);
    journal.dataset.phase = DatasetPhase::CandidateReady;
    write_journal(root, journal)?;
    #[cfg(test)]
    substitute(FaultPoint::SubstituteDatasetAfterCandidateReady, &candidate)?;
    interrupt(FaultPoint::InterruptAfterDatasetCandidateReady)?;
    journal.dataset.phase = DatasetPhase::InstallIntent;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetInstallIntent)?;
    fail(FaultPoint::DatasetInstall).context("Dataset description install failed")?;
    #[cfg(test)]
    if take(FaultPoint::DatasetCollision) {
        create_collision(&destination)?;
    }
    validate_ready_candidate(
        &candidate,
        journal.dataset.reservation_token.as_deref(),
        journal.dataset.fingerprint.as_deref(),
    )?;
    match rename_no_replace(&candidate_payload(&candidate), &destination) {
        Ok(()) => {
            sync_payload_rename(&candidate, &destination)?;
            #[cfg(test)]
            substitute(FaultPoint::SubstituteDatasetAfterInstall, &destination)?;
            require_owned_fingerprint(
                &destination,
                journal.dataset.fingerprint.as_deref(),
                "Installed dataset description",
            )?;
            interrupt(FaultPoint::InterruptAfterDatasetInstallOperation)?;
            journal.dataset.phase = DatasetPhase::Installed;
        }
        Err(error) if is_already_exists(&error) => {
            // Persist the concurrent winner before deleting our candidate.
            // Recovery can then preserve the unowned destination whether the
            // wrapper deletion itself is observed before or after a crash.
            journal.dataset.phase = DatasetPhase::ExistingWon;
            write_journal(root, journal)?;
            remove_candidate_wrapper(
                &candidate,
                journal.dataset.reservation_token.as_deref(),
                journal.dataset.fingerprint.as_deref(),
                false,
            )?;
        }
        Err(error) => {
            return Err(format!(
                "Failed to atomically install dataset description without replacement: {error}"
            )
            .into());
        }
    }
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterDatasetInstall)
}

pub(super) fn prepare_subject(
    root: &Path,
    staging: &Path,
    journal: &mut RelocationJournal,
    index: usize,
) -> RelocationTransactionResult<()> {
    let subject_name = journal.subjects[index].subject.clone();
    let current_sources = source_artifacts(root, staging, &subject_name)?
        .into_iter()
        .map(|(_, destination)| relative_owned(root, &destination))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let planned_sources = journal.subjects[index]
        .artifacts
        .iter()
        .filter(|artifact| artifact.role == ArtifactRole::Replacement)
        .map(|artifact| artifact.destination.clone())
        .collect::<BTreeSet<_>>();
    if current_sources != planned_sources {
        return Err(format!(
            "Staged ancillary artifact set changed before relocation for {subject_name}"
        )
        .into());
    }
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        if journal.subjects[index].artifacts[artifact_index].role != ArtifactRole::Replacement {
            continue;
        }
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        let candidate_relative = journal.subjects[index].artifacts[artifact_index]
            .candidate
            .clone()
            .expect("validated candidate");
        let candidate = safe_join(root, &candidate_relative)?;
        let source = if destination == root.join("rawdata").join(subject_dir(&subject_name)) {
            staging.join("rawdata").join(subject_dir(&subject_name))
        } else if destination == crate::import::import_lock_dir_for_relocation(root, &subject_name)
        {
            crate::import::import_lock_dir_for_relocation(staging, &subject_name)
        } else {
            staging
                .join("derivatives/ExploreASL/log")
                .join(destination.file_name().expect("log name"))
        };
        if destination == root.join("rawdata").join(subject_dir(&subject_name)) {
            if !path_exists(&source)? {
                return Err(format!("Missing staged rawdata directory for {subject_name}").into());
            }
            let metadata = fs::symlink_metadata(&source).with_context(|| {
                format!("Failed to inspect staged rawdata {}", source.display())
            })?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(format!(
                    "Staged rawdata for {subject_name} must be a regular directory"
                )
                .into());
            }
            if fs::read_dir(&source)
                .with_context(|| {
                    format!(
                        "Failed to read staged rawdata directory {}",
                        source.display()
                    )
                })?
                .next()
                .is_none()
            {
                return Err(format!("Empty staged rawdata directory for {subject_name}").into());
            }
        }
        let token = reservation_token(&candidate);
        journal.subjects[index].artifacts[artifact_index].reservation_token = Some(token.clone());
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::ReservationIntent;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterCandidateReservationIntent)?;
        reserve_candidate(root, &candidate, &token)?;
        interrupt(FaultPoint::InterruptAfterCandidateReservationOperation)?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::CandidateReserved;
        write_journal(root, journal)?;
        sync_parent(candidate.parent().expect("candidate parent"))?;
        interrupt(FaultPoint::InterruptAfterCandidateReserved)?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::PopulationIntent;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterCandidatePopulationIntent)?;
        validate_candidate_marker(
            &candidate,
            journal.subjects[index].artifacts[artifact_index]
                .reservation_token
                .as_deref(),
        )?;
        let fingerprint = populate_reserved_candidate(&source, &candidate)?;
        interrupt(FaultPoint::InterruptAfterCandidatePopulationOperation)?;
        journal.subjects[index].artifacts[artifact_index].candidate_fingerprint = Some(fingerprint);
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::CandidateReady;
        write_journal(root, journal)?;
        #[cfg(test)]
        substitute(FaultPoint::SubstituteAfterCandidateReady, &candidate)?;
    }
    journal.subjects[index].phase = SubjectPhase::Prepared;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterCandidateReady)
}
