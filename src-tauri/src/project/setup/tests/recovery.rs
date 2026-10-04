use std::fs;
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault};
use super::super::filesystem::{fixed_path, random_id};
use super::super::journal::{
    OperationPhase, PendingEntry, TransactionPhase, initial_journal, journal_bytes, journal_name,
    journal_path, load_registry, register_pending, write_journal,
};
use super::super::planning::preflight;
use super::super::transaction::bytes_for;
use super::super::{
    SetupMode, SetupPlans, commit_for_state, preflight_for_state, recover_all, recover_at_startup,
    recover_root,
};
use super::common::{entry_for, identities, project};

#[test]
fn terminal_cleanup_is_retried_by_recovery() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
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
        commit_for_state(&plans, &plan.plan_id, app_data.path())
            .unwrap()
            .outcome,
        "committed"
    );
    drop(_guard);
    assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
    assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
}

#[test]
fn recovery_rolls_back_each_incomplete_phase_and_defers_unavailable_roots() {
    for phase in [
        TransactionPhase::Planned,
        TransactionPhase::Preparing,
        TransactionPhase::Committing,
        TransactionPhase::RecoveryRequired,
    ] {
        let root = TempDir::new().unwrap();
        let app_data = TempDir::new().unwrap();
        let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
        let transaction_id = random_id("transaction");
        let journal_id = random_id("journal");
        let registry_id = random_id("registry");
        let mut journal = initial_journal(
            &plan,
            transaction_id.clone(),
            journal_id.clone(),
            registry_id.clone(),
        )
        .unwrap();
        journal.phase = phase;
        let entry = PendingEntry {
            registry_id,
            transaction_id,
            journal_id: journal_id.clone(),
            root: root.path().canonicalize().unwrap().display().to_string(),
            journal_name: journal_name(&journal_id),
        };
        register_pending(app_data.path(), entry).unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(
            recover_all(app_data.path()).unwrap().recovered,
            1,
            "{phase:?}"
        );
        assert!(load_registry(app_data.path()).unwrap().entries.is_empty());
        assert!(!journal_path(root.path(), &journal_id).exists());
    }
    let app_data = TempDir::new().unwrap();
    let registry_id = random_id("registry");
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    register_pending(
        app_data.path(),
        PendingEntry {
            registry_id,
            transaction_id,
            journal_id: journal_id.clone(),
            root: app_data
                .path()
                .join("unavailable-root")
                .display()
                .to_string(),
            journal_name: journal_name(&journal_id),
        },
    )
    .unwrap();
    let summary = recover_all(app_data.path()).unwrap();
    assert_eq!(summary.deferred_roots.len(), 1);
    assert_eq!(load_registry(app_data.path()).unwrap().entries.len(), 1);
}

#[test]
fn recovery_blocks_divergent_journals_and_preserves_concurrent_rawdata_entries() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let transaction_id = random_id("transaction");
    let journal_id = random_id("journal");
    let registry_id = random_id("registry");
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
    register_pending(
        app_data.path(),
        PendingEntry {
            registry_id: registry_id.clone(),
            transaction_id,
            journal_id: journal_id.clone(),
            root: root.path().canonicalize().unwrap().display().to_string(),
            journal_name: journal_name(&journal_id),
        },
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    let mut foreign = journal.clone();
    foreign.registry_id = "foreign-registry".into();
    fs::write(
        journal_path(root.path(), &journal_id),
        journal_bytes(&foreign).unwrap(),
    )
    .unwrap();
    assert!(recover_root(app_data.path(), root.path()).is_err());
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
        let app_data = TempDir::new().unwrap();
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
        let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
        register_pending(app_data.path(), entry).unwrap();
        write_journal(root.path(), &journal).unwrap();
        assert_eq!(
            recover_all(app_data.path()).unwrap().recovered,
            1,
            "{phase:?}"
        );
    }

    // A complete valid after-state is the only incomplete journal state
    // allowed to finish forward.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
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
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_all(app_data.path()).unwrap().recovered, 1);
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert!(!journal_path(root.path(), &journal_id).exists());

    // Intent-only directory creation cannot establish ownership after a
    // crash. Recovery blocks and leaves both record and user entry intact.
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
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
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(
        fs::read(root.path().join("rawdata/concurrent")).unwrap(),
        b"keep"
    );
    assert!(journal_path(root.path(), &journal_id).exists());
}

#[test]
fn startup_and_targeted_recovery_settle_before_root_use_and_block_malformed_pairs() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    assert_eq!(recover_at_startup(app_data.path()).unwrap().recovered, 1);
    assert!(load_registry(app_data.path()).unwrap().entries.is_empty());

    let blocked_root = TempDir::new().unwrap();
    let blocked_app_data = TempDir::new().unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let entry = entry_for(
        blocked_root.path(),
        transaction_id,
        journal_id.clone(),
        registry_id,
    );
    register_pending(blocked_app_data.path(), entry).unwrap();
    fs::write(journal_path(blocked_root.path(), &journal_id), b"malformed").unwrap();
    assert!(recover_root(blocked_app_data.path(), blocked_root.path()).is_err());
    assert_eq!(
        load_registry(blocked_app_data.path())
            .unwrap()
            .entries
            .len(),
        1
    );
}

#[test]
fn startup_recovery_preserves_pending_journal_when_processing_evidence_is_malformed() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    register_pending(
        app_data.path(),
        entry_for(root.path(), transaction_id, journal_id.clone(), registry_id),
    )
    .unwrap();
    write_journal(root.path(), &journal).unwrap();
    let before = fs::read(journal_path(root.path(), &journal_id)).unwrap();
    // Malformed processing evidence must block the earliest setup mutation,
    // even before a project document has been installed or hydrated.
    let processing = root.path().join(crate::processing::record::CURRENT_RECORD);
    fs::create_dir_all(processing.parent().unwrap()).unwrap();
    fs::write(&processing, b"unsupported processing authority").unwrap();
    assert!(recover_at_startup(app_data.path()).is_err());
    assert!(recover_root(app_data.path(), root.path()).is_err());
    assert_eq!(
        fs::read(journal_path(root.path(), &journal_id)).unwrap(),
        before
    );
    assert_eq!(
        fs::read(&processing).unwrap(),
        b"unsupported processing authority"
    );
    fs::remove_file(processing).unwrap();
    assert_eq!(recover_at_startup(app_data.path()).unwrap().recovered, 1);
}
