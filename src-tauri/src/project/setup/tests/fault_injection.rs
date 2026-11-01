use std::fs;
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault};
use super::super::journal::JOURNAL_PREFIX;
use super::super::{
    SetupCommandError, SetupMode, SetupPlans, command_error, commit_for_state, preflight_for_state,
};
use super::common::{project, source_snapshot};

#[test]
fn every_named_failure_stage_restores_before_state_or_keeps_recovery_evidence() {
    let rollback_faults = [
        SetupFault::JournalWrite,
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
        SetupFault::IgnoreInstall,
        SetupFault::ProjectInstall,
        SetupFault::ParentFlush,
        SetupFault::RootFlush,
        SetupFault::TerminalRecord,
    ];
    for fault in rollback_faults {
        let root = TempDir::new().unwrap();
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
            commit_for_state(&plans, &plan.plan_id).is_err(),
            "{fault:?}"
        );
        assert_eq!(source_snapshot(root.path()), before, "{fault:?}");
    }

    // Failure to record initial intent precedes every transaction mutation.
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::JournalWrite);
    let error = commit_for_state(&plans, &plan.plan_id).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::Failed { .. }
    ));
    assert_eq!(
        source_snapshot(root.path()),
        std::collections::BTreeMap::new()
    );

    // Terminal cleanup is deliberately non-destructive to the committed
    // result; its validated retry is covered by recovery.
    let root = TempDir::new().unwrap();
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
        commit_for_state(&plans, &plan.plan_id).unwrap().outcome,
        "committed"
    );
    assert!(root.path().join("project.easl").exists());
    assert!(fs::read_dir(root.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(JOURNAL_PREFIX)
    }));
}
