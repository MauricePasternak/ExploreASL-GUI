//! Test-only deterministic fault points and commit observations.
use anyhow::Result;
#[cfg(test)]
use anyhow::bail;
#[cfg(test)]
use std::cell::RefCell;
use std::path::Path;

/// Deterministic transaction fault points. Compiled into tests only; production
/// code has no environment-variable or renderer-controlled failure path.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupFault {
    JournalWrite,
    CandidateCreate,
    CandidateWrite,
    CandidateFlush,
    CandidateVerify,
    RawdataCreate,
    IntentRecord,
    RawdataIntent,
    CandidateIntent,
    BackupIntent,
    InstallIntent,
    BackupRename,
    Install,
    MarkerInstall,
    IgnoreInstall,
    ProjectInstall,
    ParentFlush,
    RootFlush,
    TerminalRecord,
    Cleanup,
}
#[cfg(test)]
thread_local! { static SETUP_FAULT: RefCell<Option<SetupFault>> = const { RefCell::new(None) }; }
// Test-only commit observation. It records visibility at each successful file
// installation without adding an externally controllable production hook.
#[cfg(test)]
thread_local! {
    static SETUP_INSTALL_OBSERVATIONS: RefCell<Vec<(String, bool)>> = const { RefCell::new(Vec::new()) };
}
#[cfg(test)]
pub struct SetupFaultGuard;
#[cfg(test)]
impl Drop for SetupFaultGuard {
    fn drop(&mut self) {
        SETUP_FAULT.with(|fault| *fault.borrow_mut() = None);
    }
}
#[cfg(test)]
pub fn inject_setup_fault(fault: SetupFault) -> SetupFaultGuard {
    SETUP_FAULT.with(|active| *active.borrow_mut() = Some(fault));
    SetupFaultGuard
}
#[cfg(test)]
pub(super) fn take_install_observations() -> Vec<(String, bool)> {
    SETUP_INSTALL_OBSERVATIONS.with(|observations| std::mem::take(&mut *observations.borrow_mut()))
}
pub(super) fn observe_install(_destination: &Path) {
    #[cfg(test)]
    SETUP_INSTALL_OBSERVATIONS.with(|observations| {
        let project_visible = _destination
            .parent()
            .is_some_and(|parent| parent.join("project.easl").is_file());
        observations.borrow_mut().push((
            _destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned(),
            project_visible,
        ));
    });
}
pub(super) fn fail(_fault: &str) -> Result<()> {
    #[cfg(test)]
    {
        let selected = match _fault {
            "journal" => SetupFault::JournalWrite,
            "candidate-create" => SetupFault::CandidateCreate,
            "candidate-write" => SetupFault::CandidateWrite,
            "candidate-flush" => SetupFault::CandidateFlush,
            "candidate-verify" => SetupFault::CandidateVerify,
            "rawdata-create" => SetupFault::RawdataCreate,
            "intent" => SetupFault::IntentRecord,
            "rawdata-intent" => SetupFault::RawdataIntent,
            "candidate-intent" => SetupFault::CandidateIntent,
            "backup-intent" => SetupFault::BackupIntent,
            "install-intent" => SetupFault::InstallIntent,
            "backup" => SetupFault::BackupRename,
            "install" => SetupFault::Install,
            "install-marker" => SetupFault::MarkerInstall,
            "install-ignore" => SetupFault::IgnoreInstall,
            "install-project" => SetupFault::ProjectInstall,
            "flush" => SetupFault::ParentFlush,
            "root-flush" => SetupFault::RootFlush,
            "terminal" => SetupFault::TerminalRecord,
            "cleanup" => SetupFault::Cleanup,
            _ => return Ok(()),
        };
        let hit = SETUP_FAULT.with(|active| {
            let mut active = active.borrow_mut();
            if *active == Some(selected) {
                active.take();
                true
            } else {
                false
            }
        });
        if hit {
            bail!("Injected setup failure at {_fault}");
        }
    }
    Ok(())
}
