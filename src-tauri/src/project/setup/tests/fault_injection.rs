use std::fs;
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault};
use super::super::journal::load_registry;
use super::super::{
    SetupCommandError, SetupMode, SetupPlans, command_error, commit_for_state, preflight_for_state,
};
use super::common::{project, source_snapshot};

#[test]
fn ordinary_faults_restore_before_state_or_leave_terminal_recovery() {
    for fault in [
        SetupFault::RegistryWrite,
        SetupFault::JournalWrite,
        SetupFault::CandidateCreate,
        SetupFault::CandidateWrite,
        SetupFault::CandidateFlush,
        SetupFault::CandidateVerify,
        SetupFault::RawdataCreate,
        SetupFault::IntentRecord,
        SetupFault::BackupRename,
        SetupFault::Install,
        SetupFault::ParentFlush,
        SetupFault::TerminalRecord,
    ] {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        fs::write(root.path().join(".bidsignore"), b"user-ignore\r\n").unwrap();
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().to_string_lossy().into_owned(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _guard = inject_setup_fault(fault);
        assert!(
            commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
            "{fault:?}"
        );
        assert_eq!(
            fs::read(root.path().join(".bidsignore")).unwrap(),
            b"user-ignore\r\n",
            "{fault:?}"
        );
        assert!(!root.path().join("project.easl").exists(), "{fault:?}");
        assert!(!root.path().join("rawdata").exists(), "{fault:?}");
    }
}

#[test]
fn every_named_failure_stage_restores_before_state_or_keeps_recovery_evidence() {
    let rollback_faults = [
        SetupFault::RegistryWrite,
        SetupFault::CandidateCreate,
        SetupFault::CandidateWrite,
        SetupFault::CandidateFlush,
        SetupFault::CandidateVerify,
        SetupFault::RawdataCreate,
        SetupFault::IntentRecord,
        SetupFault::RawdataIntent,
        SetupFault::CandidateIntent,
        SetupFault::BackupIntent,
        SetupFault::InstallIntent,
        SetupFault::BackupRename,
        SetupFault::Install,
        SetupFault::MarkerInstall,
        SetupFault::IgnoreInstall,
        SetupFault::ProjectInstall,
        SetupFault::ParentFlush,
        SetupFault::RootFlush,
        SetupFault::TerminalRecord,
    ];
    for fault in rollback_faults {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        fs::write(root.path().join(".bidsignore"), b"before\r\n").unwrap();
        let before = source_snapshot(root.path());
        let plans = SetupPlans::default();
        let plan = preflight_for_state(
            &plans,
            root.path().display().to_string(),
            SetupMode::Bids,
            Some(String::from_utf8(project("bids")).unwrap()),
        )
        .unwrap();
        let _fault = inject_setup_fault(fault);
        assert!(
            commit_for_state(&plans, &plan.plan_id, app_data.path()).is_err(),
            "{fault:?}"
        );
        assert_eq!(source_snapshot(root.path()), before, "{fault:?}");
    }

    // A root journal write failure happens after global intent and before
    // the journal exists. It must report recovery-required and preserve
    // discovery evidence rather than guessing that cleanup is safe.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::JournalWrite);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::RecoveryRequired { .. }
    ));
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);

    // Terminal cleanup is deliberately non-destructive to the committed
    // result; its validated retry is covered by recovery.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::Cleanup);
    assert_eq!(
        commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap()
            .outcome,
        "committed"
    );
    assert!(root.path().join("project.easl").exists());
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
}
