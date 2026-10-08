use std::fs;
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault};
use super::super::filesystem::fixed_path;
use super::super::journal::{
    OperationPhase, TransactionPhase, initial_journal, journal_path, write_journal,
};
use super::super::planning::preflight;
use super::super::transaction::bytes_for;
use super::super::{
    SetupCommandError, SetupMode, SetupPlans, command_error, commit_for_state, preflight_for_state,
    recover_root,
};
use super::common::{identities, project};

#[test]
fn terminal_cleanup_is_retried_by_recovery() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _guard = inject_setup_fault(SetupFault::Cleanup);
    assert_eq!(
        commit_for_state(&plans, &plan.plan_id).unwrap().outcome,
        "committed"
    );
    drop(_guard);
    let unrelated = TempDir::new().unwrap();
    fs::write(
        unrelated.path().join(".easl-gui-setup-foreign.json"),
        b"keep",
    )
    .unwrap();
    assert_eq!(recover_root(root.path()).unwrap().recovered, 1);
    assert_eq!(
        fs::read(unrelated.path().join(".easl-gui-setup-foreign.json")).unwrap(),
        b"keep"
    );
    assert!(!fs::read_dir(root.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(super::super::journal::JOURNAL_PREFIX)
    }));
}

#[test]
fn recovery_preserves_concurrent_rawdata_entries() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    journal.directory_phase = OperationPhase::Created;
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(matches!(
        command_error(recover_root(root.path()).unwrap_err()),
        SetupCommandError::RecoveryRequired { .. }
    ));
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    assert!(journal_path(root.path(), &journal_id).exists());
}

#[test]
fn recovery_handles_every_phase_finish_forward_and_preserves_ambiguous_intents() {
    for phase in [
        TransactionPhase::Planned,
        TransactionPhase::Preparing,
        TransactionPhase::Committing,
        TransactionPhase::Committed,
        TransactionPhase::RollingBack,
        TransactionPhase::RolledBack,
        TransactionPhase::RecoveryRequired,
    ] {
        let root = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let (transaction_id, journal_id, registry_id) = identities();
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.phase = phase;
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(recover_root(root.path()).unwrap().recovered, 1, "{phase:?}");
        assert!(!journal_path(root.path(), &journal_id).exists());
    }

    // A complete valid after-state is the only incomplete journal state
    // allowed to finish forward.
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    for operation in &journal.operations {
        fs::write(
            fixed_path(root.path(), &operation.destination).unwrap(),
            bytes_for(&plan, &operation.destination).unwrap(),
        )
        .unwrap();
    }
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_root(root.path()).unwrap().recovered, 1);
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert!(!journal_path(root.path(), &journal_id).exists());

    // Intent-only directory creation cannot establish ownership after a
    // crash. Recovery blocks and leaves both record and user entry intact.
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    journal.directory_phase = OperationPhase::CreateIntent;
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/concurrent"), b"keep").unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(recover_root(root.path()).is_err());
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    assert!(journal_path(root.path(), &journal_id).exists());
}

#[test]
fn selected_root_recovery_settles_before_root_use_and_preserves_malformed_journals() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_root(root.path()).unwrap().recovered, 1);
    assert!(!journal_path(root.path(), &journal_id).exists());

    let blocked_root = TempDir::new().unwrap();
    let (_, journal_id, _) = identities();
    fs::write(journal_path(blocked_root.path(), &journal_id), b"malformed").unwrap();
    assert!(recover_root(blocked_root.path()).is_err());
    assert_eq!(
        fs::read(journal_path(blocked_root.path(), &journal_id)).unwrap(),
        b"malformed"
    );
}

#[test]
fn selected_root_recovery_preserves_journal_when_processing_evidence_is_malformed() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    let before = fs::read(journal_path(root.path(), &journal_id)).unwrap();
    // Malformed processing evidence must block the earliest setup mutation,
    // even before a project document has been installed or hydrated.
    let processing = root.path().join(crate::processing::record::CURRENT_RECORD);
    fs::create_dir_all(processing.parent().unwrap()).unwrap();
    fs::write(&processing, b"unsupported processing authority").unwrap();
    assert!(recover_root(root.path()).is_err());
    assert_eq!(
        fs::read(journal_path(root.path(), &journal_id)).unwrap(),
        before
    );
    assert_eq!(
        fs::read(&processing).unwrap(),
        b"unsupported processing authority"
    );
    fs::remove_file(processing).unwrap();
    assert_eq!(recover_root(root.path()).unwrap().recovered, 1);
}
