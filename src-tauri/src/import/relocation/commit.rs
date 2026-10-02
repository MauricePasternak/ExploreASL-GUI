use super::candidate::require_owned_fingerprint;
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt, rollback_interruption_is_armed};
#[cfg(test)]
use super::fault_injection::{create_collision, take};
use super::filesystem::{rename_no_replace, sync_parent, tree_fingerprint};
use super::journal::write_journal;
use super::paths::safe_join;
use super::types::{RawdataPhase, RelocationJournal, SubjectFailurePhase, SubjectPhase};
use anyhow::Context;
use std::path::Path;

pub(super) fn commit_subject(
    root: &Path,
    journal: &mut RelocationJournal,
    index: usize,
    failure_phase: &mut SubjectFailurePhase,
) -> RelocationTransactionResult<()> {
    *failure_phase = SubjectFailurePhase::Journal;
    journal.subjects[index].phase = SubjectPhase::Committing;
    write_journal(root, journal)?;

    let candidate = safe_join(root, &journal.subjects[index].rawdata.candidate)?;
    let destination = safe_join(root, &journal.subjects[index].rawdata.destination)?;
    let backup = safe_join(root, &journal.subjects[index].rawdata.backup)?;
    require_owned_fingerprint(
        &candidate,
        journal.subjects[index]
            .rawdata
            .candidate_fingerprint
            .as_deref(),
        "Prepared rawdata candidate",
    )?;

    *failure_phase = SubjectFailurePhase::Backup;
    if journal.subjects[index].rawdata.had_destination {
        journal.subjects[index].rawdata.phase = RawdataPhase::BackupIntent;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterBackupIntent)?;
        fail(FaultPoint::DestinationBackup)?;
        #[cfg(test)]
        if take(FaultPoint::BackupCollision) {
            create_collision(&backup)?;
        }
        rename_no_replace(&destination, &backup).with_context(|| {
            format!(
                "Failed to back up destination {} to {} without replacement",
                destination.display(),
                backup.display()
            )
        })?;
        sync_parent(destination.parent().expect("rawdata parent"))?;
        let expected = journal.subjects[index]
            .rawdata
            .backup_fingerprint
            .as_deref()
            .ok_or_else(|| "Destination backup lacks its preflight fingerprint".to_string())?;
        if tree_fingerprint(&backup)? != expected {
            return Err("Destination changed after relocation preflight"
                .to_string()
                .into());
        }
        interrupt(FaultPoint::InterruptAfterBackupOperation)?;
    }
    journal.subjects[index].rawdata.phase = RawdataPhase::BackedUp;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterBackup)?;

    *failure_phase = SubjectFailurePhase::Install;
    journal.subjects[index].rawdata.phase = RawdataPhase::InstallIntent;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterInstallIntent)?;
    fail(FaultPoint::CandidateInstall)?;
    #[cfg(test)]
    if take(FaultPoint::InstallCollision) {
        create_collision(&destination)?;
    }
    rename_no_replace(&candidate, &destination).with_context(|| {
        format!(
            "Failed to install rawdata candidate {} at {} without replacement",
            candidate.display(),
            destination.display()
        )
    })?;
    sync_parent(candidate.parent().expect("candidate parent"))?;
    sync_parent(destination.parent().expect("destination parent"))?;
    require_owned_fingerprint(
        &destination,
        journal.subjects[index]
            .rawdata
            .candidate_fingerprint
            .as_deref(),
        "Installed rawdata destination",
    )?;
    interrupt(FaultPoint::InterruptAfterInstallOperation)?;
    journal.subjects[index].rawdata.phase = RawdataPhase::Installed;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterInstall)?;

    if rollback_interruption_is_armed() {
        return Err("Injected pre-commit failure for rollback interruption"
            .to_string()
            .into());
    }
    *failure_phase = SubjectFailurePhase::CommitVerification;
    require_owned_fingerprint(
        &destination,
        journal.subjects[index]
            .rawdata
            .candidate_fingerprint
            .as_deref(),
        "Installed destination before subject commit",
    )?;
    *failure_phase = SubjectFailurePhase::Commit;
    journal.subjects[index].phase = SubjectPhase::Committed;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterCommit)
}
