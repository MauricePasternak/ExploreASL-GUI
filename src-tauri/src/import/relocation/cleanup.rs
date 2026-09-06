use super::candidate::require_owned_fingerprint;
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{path_exists, remove_proven, sync_parent};
use super::paths::safe_join;
use super::rollback::{
    cleanup_candidate, cleanup_dataset_candidate, dataset_should_remain, rollback_dataset,
    validate_candidate_for_phase, validate_dataset_candidate_for_phase,
};
use super::types::{ArtifactPhase, ArtifactRole, DatasetPhase, RelocationJournal, SubjectPhase};
use std::path::Path;

pub(super) fn cleanup_after_terminal(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    fail(FaultPoint::Cleanup)?;
    // Validate every installed replacement and retained backup before deleting
    // any old authoritative copy.
    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        for artifact in &subject.artifacts {
            let destination = safe_join(root, &artifact.destination)?;
            match artifact.role {
                ArtifactRole::Replacement => {
                    if artifact.phase != ArtifactPhase::Installed {
                        return Err("Committed replacement has no installed state"
                            .to_string()
                            .into());
                    }
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Committed installed destination",
                    )?;
                    validate_candidate_for_phase(root, artifact)?;
                }
                ArtifactRole::Removal if path_exists(&destination)? => {
                    return Err("Committed removal destination reappeared"
                        .to_string()
                        .into());
                }
                ArtifactRole::Removal => {}
            }
            let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
            if path_exists(&backup)? {
                require_owned_fingerprint(
                    &backup,
                    artifact.backup_fingerprint.as_deref(),
                    "Committed transaction backup",
                )?;
            }
        }
    }
    if dataset_should_remain(journal) && journal.dataset.phase == DatasetPhase::Installed {
        let destination = safe_join(root, &journal.dataset.destination)?;
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Committed dataset description",
        )?;
        validate_dataset_candidate_for_phase(root, &journal.dataset)?;
    }

    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        for artifact in &subject.artifacts {
            if artifact.role == ArtifactRole::Replacement {
                cleanup_candidate(root, artifact)?;
            }
            let backup = safe_join(root, artifact.backup.as_deref().expect("validated backup"))?;
            if path_exists(&backup)? {
                if artifact.role == ArtifactRole::Replacement {
                    let destination = safe_join(root, &artifact.destination)?;
                    require_owned_fingerprint(
                        &destination,
                        artifact.candidate_fingerprint.as_deref(),
                        "Committed installed destination before backup cleanup",
                    )?;
                }
                remove_proven(
                    &backup,
                    artifact.backup_fingerprint.as_deref(),
                    "committed transaction backup",
                )?;
                sync_parent(backup.parent().expect("backup parent"))?;
            }
        }
    }
    if !dataset_should_remain(journal) {
        rollback_dataset(root, journal)?;
    } else if matches!(
        journal.dataset.phase,
        DatasetPhase::Installed | DatasetPhase::ExistingWon
    ) {
        cleanup_dataset_candidate(root, &journal.dataset)?;
    }
    Ok(())
}
