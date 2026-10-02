use super::candidate::require_owned_fingerprint;
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail};
use super::filesystem::{path_exists, remove_proven, sync_parent};
use super::paths::safe_join;
use super::rollback::{
    cleanup_candidate, cleanup_dataset_candidate, dataset_should_remain, rollback_dataset,
};
use super::types::{DatasetPhase, RawdataPhase, RelocationJournal, SubjectPhase};
use std::path::Path;

pub(super) fn cleanup_after_terminal(
    root: &Path,
    journal: &mut RelocationJournal,
) -> RelocationTransactionResult<()> {
    fail(FaultPoint::Cleanup)?;
    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        if subject.rawdata.phase != RawdataPhase::Installed {
            return Err("Committed subject has no installed rawdata state"
                .to_string()
                .into());
        }
        let destination = safe_join(root, &subject.rawdata.destination)?;
        require_owned_fingerprint(
            &destination,
            subject.rawdata.candidate_fingerprint.as_deref(),
            "Committed rawdata destination",
        )?;
        let backup = safe_join(root, &subject.rawdata.backup)?;
        if path_exists(&backup)? {
            require_owned_fingerprint(
                &backup,
                subject.rawdata.backup_fingerprint.as_deref(),
                "Committed rawdata backup",
            )?;
        }
    }
    if dataset_should_remain(journal) && journal.dataset.phase == DatasetPhase::Installed {
        let destination = safe_join(root, &journal.dataset.destination)?;
        require_owned_fingerprint(
            &destination,
            journal.dataset.fingerprint.as_deref(),
            "Committed dataset description",
        )?;
    }

    for subject in &journal.subjects {
        if subject.phase != SubjectPhase::Committed {
            continue;
        }
        cleanup_candidate(root, &subject.rawdata)?;
        let backup = safe_join(root, &subject.rawdata.backup)?;
        if path_exists(&backup)? {
            remove_proven(
                &backup,
                subject.rawdata.backup_fingerprint.as_deref(),
                "committed rawdata backup",
            )?;
            sync_parent(backup.parent().expect("backup parent"))?;
        }
    }
    if !dataset_should_remain(journal) {
        rollback_dataset(root, journal)?;
    } else if matches!(
        journal.dataset.phase,
        DatasetPhase::Installed | DatasetPhase::ExistingWon
    ) {
        cleanup_dataset_candidate(root, journal)?;
    }
    Ok(())
}
