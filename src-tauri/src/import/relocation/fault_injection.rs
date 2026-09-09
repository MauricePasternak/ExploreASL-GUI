use super::error::{RelocationTransactionError, RelocationTransactionResult};
#[cfg(test)]
use anyhow::Context;
use anyhow::{Result as AnyResult, bail};
#[cfg(test)]
use std::cell::RefCell;
#[cfg(test)]
use std::fs;
#[cfg(test)]
use std::path::Path;

/// Deterministic filesystem-operation failures used only by transaction tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaultPoint {
    CandidateCreate,
    RecursiveCopy,
    FileSync,
    ParentSync,
    HashVerification,
    SourceMutation,
    JournalPersist,
    DestinationBackup,
    CandidateInstall,
    AncillaryInstall,
    InsufficientSpace,
    #[cfg(test)]
    BackupCollision,
    #[cfg(test)]
    InstallCollision,
    DatasetInstall,
    #[cfg(test)]
    DatasetCollision,
    OutcomePersist,
    Cleanup,
    JournalCleanup,
    Rollback,
    InterruptAfterDatasetInstall,
    InterruptAfterDatasetReserved,
    InterruptAfterCandidateReserved,
    InterruptAfterCandidateReservationIntent,
    InterruptAfterCandidateReservationOperation,
    InterruptAfterCandidatePopulationIntent,
    InterruptAfterCandidatePopulationOperation,
    InterruptAfterDatasetReservationIntent,
    InterruptAfterDatasetReservationOperation,
    InterruptAfterDatasetPopulationIntent,
    InterruptAfterDatasetPopulationOperation,
    InterruptAfterDatasetCandidateReady,
    InterruptAfterDatasetInstallIntent,
    InterruptAfterDatasetInstallOperation,
    InterruptAfterCandidateReady,
    InterruptAfterBackupIntent,
    InterruptAfterBackupOperation,
    InterruptAfterBackup,
    InterruptAfterInstallIntent,
    InterruptAfterInstallOperation,
    InterruptAfterInstall,
    InterruptAfterCommit,
    #[cfg(test)]
    SubstituteAfterCandidateReady,
    #[cfg(test)]
    SubstituteAfterInstall,
    #[cfg(test)]
    SubstituteDatasetAfterCandidateReady,
    #[cfg(test)]
    SubstituteDatasetAfterInstall,
    InterruptRollbackAfterIntent,
    InterruptRollbackAfterDestinationRemoval,
    InterruptRollbackAfterBackupRestore,
    InterruptRollbackAfterCandidateCleanup,
    InterruptDatasetRollbackAfterIntent,
    InterruptDatasetRollbackAfterDestinationRemoval,
    InterruptDatasetRollbackAfterCandidateCleanup,
    PayloadParentSync,
    PayloadRenameSourceSync,
    PayloadRenameDestinationSync,
    WrapperDeleteParentSync,
}

impl FaultPoint {
    pub const fn label(self) -> &'static str {
        match self {
            Self::CandidateCreate => "candidate-create",
            Self::RecursiveCopy => "recursive-copy",
            Self::FileSync => "file-sync",
            Self::ParentSync => "parent-sync",
            Self::HashVerification => "hash-verification",
            Self::SourceMutation => "source-mutation",
            Self::JournalPersist => "journal-persist",
            Self::DestinationBackup => "destination-backup",
            Self::CandidateInstall => "candidate-install",
            Self::AncillaryInstall => "ancillary-install",
            Self::InsufficientSpace => "insufficient-space",
            #[cfg(test)]
            Self::BackupCollision => "backup-collision",
            #[cfg(test)]
            Self::InstallCollision => "install-collision",
            Self::DatasetInstall => "dataset-install",
            #[cfg(test)]
            Self::DatasetCollision => "dataset-collision",
            Self::OutcomePersist => "outcome-persist",
            Self::Cleanup => "cleanup",
            Self::JournalCleanup => "journal-cleanup",
            Self::Rollback => "rollback",
            Self::InterruptAfterDatasetInstall => "interrupt-after-dataset-install",
            Self::InterruptAfterDatasetReserved => "interrupt-after-dataset-reserved",
            Self::InterruptAfterCandidateReserved => "interrupt-after-candidate-reserved",
            Self::InterruptAfterCandidateReservationIntent => {
                "interrupt-after-candidate-reservation-intent"
            }
            Self::InterruptAfterCandidateReservationOperation => {
                "interrupt-after-candidate-reservation-operation"
            }
            Self::InterruptAfterCandidatePopulationIntent => {
                "interrupt-after-candidate-population-intent"
            }
            Self::InterruptAfterCandidatePopulationOperation => {
                "interrupt-after-candidate-population-operation"
            }
            Self::InterruptAfterDatasetReservationIntent => {
                "interrupt-after-dataset-reservation-intent"
            }
            Self::InterruptAfterDatasetReservationOperation => {
                "interrupt-after-dataset-reservation-operation"
            }
            Self::InterruptAfterDatasetPopulationIntent => {
                "interrupt-after-dataset-population-intent"
            }
            Self::InterruptAfterDatasetPopulationOperation => {
                "interrupt-after-dataset-population-operation"
            }
            Self::InterruptAfterDatasetCandidateReady => "interrupt-after-dataset-candidate-ready",
            Self::InterruptAfterDatasetInstallIntent => "interrupt-after-dataset-install-intent",
            Self::InterruptAfterDatasetInstallOperation => {
                "interrupt-after-dataset-install-operation"
            }
            Self::InterruptAfterCandidateReady => "interrupt-after-candidate-ready",
            Self::InterruptAfterBackupIntent => "interrupt-after-backup-intent",
            Self::InterruptAfterBackupOperation => "interrupt-after-backup-operation",
            Self::InterruptAfterBackup => "interrupt-after-backup",
            Self::InterruptAfterInstallIntent => "interrupt-after-install-intent",
            Self::InterruptAfterInstallOperation => "interrupt-after-install-operation",
            Self::InterruptAfterInstall => "interrupt-after-install",
            Self::InterruptAfterCommit => "interrupt-after-commit",
            #[cfg(test)]
            Self::SubstituteAfterCandidateReady => "substitute-after-candidate-ready",
            #[cfg(test)]
            Self::SubstituteAfterInstall => "substitute-after-install",
            #[cfg(test)]
            Self::SubstituteDatasetAfterCandidateReady => {
                "substitute-dataset-after-candidate-ready"
            }
            #[cfg(test)]
            Self::SubstituteDatasetAfterInstall => "substitute-dataset-after-install",
            Self::InterruptRollbackAfterIntent => "interrupt-rollback-after-intent",
            Self::InterruptRollbackAfterDestinationRemoval => {
                "interrupt-rollback-after-destination-removal"
            }
            Self::InterruptRollbackAfterBackupRestore => "interrupt-rollback-after-backup-restore",
            Self::InterruptRollbackAfterCandidateCleanup => {
                "interrupt-rollback-after-candidate-cleanup"
            }
            Self::InterruptDatasetRollbackAfterIntent => "interrupt-dataset-rollback-after-intent",
            Self::InterruptDatasetRollbackAfterDestinationRemoval => {
                "interrupt-dataset-rollback-after-destination-removal"
            }
            Self::InterruptDatasetRollbackAfterCandidateCleanup => {
                "interrupt-dataset-rollback-after-candidate-cleanup"
            }
            Self::PayloadParentSync => "payload-parent-sync",
            Self::PayloadRenameSourceSync => "payload-rename-source-sync",
            Self::PayloadRenameDestinationSync => "payload-rename-destination-sync",
            Self::WrapperDeleteParentSync => "wrapper-delete-parent-sync",
        }
    }

    #[cfg(test)]
    const fn is_rollback_interruption(self) -> bool {
        matches!(
            self,
            Self::InterruptRollbackAfterIntent
                | Self::InterruptRollbackAfterDestinationRemoval
                | Self::InterruptRollbackAfterBackupRestore
                | Self::InterruptRollbackAfterCandidateCleanup
        )
    }
}

#[cfg(test)]
thread_local! {
    static FAILURE_POINT: RefCell<Option<FaultPoint>> = const { RefCell::new(None) };
}

#[cfg(test)]
pub struct RelocationFailureGuard;

#[cfg(test)]
impl Drop for RelocationFailureGuard {
    fn drop(&mut self) {
        FAILURE_POINT.with(|point| *point.borrow_mut() = None);
    }
}

#[cfg(test)]
pub fn inject_relocation_failure(point: FaultPoint) -> RelocationFailureGuard {
    FAILURE_POINT.with(|active| *active.borrow_mut() = Some(point));
    RelocationFailureGuard
}

#[cfg(test)]
pub(super) fn take(point: FaultPoint) -> bool {
    FAILURE_POINT.with(|active| {
        let mut active = active.borrow_mut();
        if *active == Some(point) {
            active.take();
            true
        } else {
            false
        }
    })
}

#[cfg(not(test))]
pub(super) fn take(_: FaultPoint) -> bool {
    false
}

pub(super) fn fail(point: FaultPoint) -> AnyResult<()> {
    if take(point) {
        bail!("Injected relocation failure at {}", point.label())
    } else {
        Ok(())
    }
}

pub(super) fn interrupt(point: FaultPoint) -> RelocationTransactionResult<()> {
    if take(point) {
        Err(RelocationTransactionError::Interrupted {
            point: point.label().to_string(),
        })
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn substitute(point: FaultPoint, path: &Path) -> AnyResult<()> {
    if !take(point) {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("Failed to inspect fault-injection path {}", path.display()))?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .with_context(|| format!("Failed to remove fault-injection path {}", path.display()))?;
        fs::create_dir(path)
            .with_context(|| format!("Failed to create fault-injection path {}", path.display()))?;
        fs::write(path.join("foreign"), b"foreign")
            .with_context(|| format!("Failed to write fault-injection path {}", path.display()))?;
    } else {
        fs::write(path, b"foreign")
            .with_context(|| format!("Failed to write fault-injection path {}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn create_collision(path: &Path) -> AnyResult<()> {
    let parent = path.parent().context("Collision path has no parent")?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Failed to create collision parent {}", parent.display()))?;
    fs::write(path, b"concurrent-unowned")
        .with_context(|| format!("Failed to create collision at {}", path.display()))
}

#[cfg(test)]
pub(super) fn rollback_interruption_is_armed() -> bool {
    FAILURE_POINT.with(|active| {
        active
            .borrow()
            .is_some_and(|point| point.is_rollback_interruption())
    })
}

#[cfg(not(test))]
pub(super) fn rollback_interruption_is_armed() -> bool {
    false
}

#[cfg(test)]
#[path = "tests/fault_injection.rs"]
mod tests;
