use super::candidate::{
    candidate_payload, require_owned_fingerprint, sync_payload_rename, validate_ready_candidate,
};
use super::error::RelocationTransactionResult;
use super::fault_injection::{FaultPoint, fail, interrupt, rollback_interruption_is_armed};
#[cfg(test)]
use super::fault_injection::{create_collision, substitute, take};
use super::filesystem::{rename_no_replace, sync_parent, tree_fingerprint};
use super::journal::write_journal;
use super::paths::safe_join;
use super::types::{
    ArtifactPhase, ArtifactRole, RelocationJournal, SubjectFailurePhase, SubjectPhase,
};
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
    // Validate every prepared payload before moving any authoritative path.
    *failure_phase = SubjectFailurePhase::CandidateVerification;
    for artifact in &journal.subjects[index].artifacts {
        if artifact.role != ArtifactRole::Replacement {
            continue;
        }
        let candidate = safe_join(
            root,
            artifact.candidate.as_deref().expect("validated candidate"),
        )?;
        validate_ready_candidate(
            &candidate,
            artifact.reservation_token.as_deref(),
            artifact.candidate_fingerprint.as_deref(),
        )?;
    }
    *failure_phase = SubjectFailurePhase::Backup;
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        let had_destination = journal.subjects[index].artifacts[artifact_index].had_destination;
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        let backup = safe_join(
            root,
            journal.subjects[index].artifacts[artifact_index]
                .backup
                .as_deref()
                .expect("validated backup"),
        )?;
        if had_destination {
            journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::BackupIntent;
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
            sync_parent(destination.parent().expect("destination parent"))?;
            let expected = journal.subjects[index].artifacts[artifact_index]
                .backup_fingerprint
                .as_deref()
                .ok_or_else(|| "Destination backup lacks its preflight fingerprint".to_string())?;
            if tree_fingerprint(&backup)? != expected {
                return Err(format!(
                    "Destination changed after relocation preflight: {}",
                    journal.subjects[index].artifacts[artifact_index].destination
                )
                .into());
            }
            interrupt(FaultPoint::InterruptAfterBackupOperation)?;
        }
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::BackedUp;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterBackup)?;
    }
    *failure_phase = SubjectFailurePhase::Install;
    for artifact_index in 0..journal.subjects[index].artifacts.len() {
        if journal.subjects[index].artifacts[artifact_index].role != ArtifactRole::Replacement {
            continue;
        }
        let candidate = safe_join(
            root,
            journal.subjects[index].artifacts[artifact_index]
                .candidate
                .as_deref()
                .expect("validated candidate"),
        )?;
        let destination = safe_join(
            root,
            &journal.subjects[index].artifacts[artifact_index].destination,
        )?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::InstallIntent;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterInstallIntent)?;
        if journal.subjects[index].artifacts[artifact_index]
            .destination
            .starts_with("rawdata/")
        {
            fail(FaultPoint::CandidateInstall)?;
        } else {
            fail(FaultPoint::AncillaryInstall)?;
        }
        #[cfg(test)]
        if take(FaultPoint::InstallCollision) {
            create_collision(&destination)?;
        }
        let payload = candidate_payload(&candidate);
        rename_no_replace(&payload, &destination).with_context(|| {
            format!(
                "Failed to install transaction candidate {} at {} without replacement",
                payload.display(),
                destination.display()
            )
        })?;
        #[cfg(test)]
        substitute(FaultPoint::SubstituteAfterInstall, &destination)?;
        sync_payload_rename(&candidate, &destination)?;
        require_owned_fingerprint(
            &destination,
            journal.subjects[index].artifacts[artifact_index]
                .candidate_fingerprint
                .as_deref(),
            "Installed transaction destination",
        )?;
        interrupt(FaultPoint::InterruptAfterInstallOperation)?;
        journal.subjects[index].artifacts[artifact_index].phase = ArtifactPhase::Installed;
        write_journal(root, journal)?;
        interrupt(FaultPoint::InterruptAfterInstall)?;
    }
    if rollback_interruption_is_armed() {
        return Err("Injected pre-commit failure for rollback interruption"
            .to_string()
            .into());
    }
    *failure_phase = SubjectFailurePhase::CommitVerification;
    for artifact in &journal.subjects[index].artifacts {
        if artifact.role == ArtifactRole::Replacement {
            let destination = safe_join(root, &artifact.destination)?;
            require_owned_fingerprint(
                &destination,
                artifact.candidate_fingerprint.as_deref(),
                "Installed destination before subject commit",
            )?;
        }
    }
    *failure_phase = SubjectFailurePhase::Commit;
    journal.subjects[index].phase = SubjectPhase::Committed;
    write_journal(root, journal)?;
    interrupt(FaultPoint::InterruptAfterCommit)
}
