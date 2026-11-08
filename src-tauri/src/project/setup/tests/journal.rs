use std::fs;
use tempfile::TempDir;

use super::super::filesystem::{
    fixed_path, inspect, owned_sibling, random_id, relative_to_root, safe_relative,
};
use super::super::journal::{
    OperationPhase, initial_journal, journal_path, read_journal, update_operation,
    validate_journal, write_journal,
};
use super::super::planning::preflight;
use super::super::{OperationKind, SetupMode, recover_root};
use super::common::{identities, project, source_snapshot};

#[test]
fn journal_recovery_preserves_unsupported_and_foreign_evidence() {
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
    assert_eq!(
        journal
            .operations
            .iter()
            .map(|op| op.destination.as_str())
            .collect::<Vec<_>>(),
        plan.displayed
            .operations
            .iter()
            .filter(|op| op.path != "rawdata/" && op.operation != OperationKind::NoOp)
            .map(|op| op.path.as_str())
            .collect::<Vec<_>>()
    );
    for (field, value) in [
        ("version", serde_json::json!(99)),
        ("root", serde_json::json!(root.path().join("foreign"))),
        ("journal_id", serde_json::json!(random_id("journal"))),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut invalid = serde_json::to_value(&journal).unwrap();
        invalid[field] = value;
        fs::write(
            journal_path(root.path(), &journal_id),
            serde_json::to_vec(&invalid).unwrap(),
        )
        .unwrap();
        let before = source_snapshot(root.path());
        assert!(recover_root(root.path()).is_err(), "{field}");
        assert_eq!(source_snapshot(root.path()), before, "{field}");
    }
}

#[test]
fn initial_journal_claim_never_replaces_foreign_files() {
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
    let journal_path = journal_path(root.path(), &journal_id);
    fs::write(&journal_path, b"foreign journal").unwrap();
    assert!(write_journal(root.path(), &journal).is_err());
    assert_eq!(fs::read(&journal_path).unwrap(), b"foreign journal");
}

#[cfg(unix)]
#[test]
fn journal_updates_are_same_parent_replacements_not_truncates() {
    use super::super::journal::TransactionPhase;
    use std::os::unix::fs::MetadataExt;

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
    write_journal(root.path(), &journal).unwrap();
    let root_journal = journal_path(root.path(), &journal_id);
    let before_journal_inode = fs::metadata(&root_journal).unwrap().ino();
    journal.phase = TransactionPhase::Preparing;
    write_journal(root.path(), &journal).unwrap();
    assert_ne!(
        before_journal_inode,
        fs::metadata(&root_journal).unwrap().ino()
    );
}

#[test]
fn journal_paths_are_relative_owned_siblings_and_reject_escape_or_links() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal =
        initial_journal(&plan, transaction_id.clone(), journal_id, registry_id).unwrap();
    let target = fixed_path(root.path(), ".bidsignore").unwrap();
    assert!(safe_relative("../escape").is_err());
    assert!(safe_relative("/escape").is_err());
    assert!(owned_sibling(&target, &transaction_id, "candidate", "x").is_err());
    let candidate = owned_sibling(&target, &transaction_id, "candidate", "0").unwrap();
    let backup = owned_sibling(&target, &transaction_id, "backup", "1").unwrap();
    journal.operations[0].candidate = Some(relative_to_root(root.path(), &candidate).unwrap());
    journal.operations[0].backup = Some(relative_to_root(root.path(), &backup).unwrap());
    assert!(
        journal.operations[0]
            .candidate
            .as_deref()
            .unwrap()
            .starts_with('.')
    );
    validate_journal(root.path(), &journal).unwrap();
    journal.operations[0].candidate = Some("../outside".into());
    assert!(validate_journal(root.path(), &journal).is_err());
    journal.operations[0].candidate = None;
    journal.operations[0].destination = "rawdata/README.md".into();
    assert!(validate_journal(root.path(), &journal).is_err());

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let (transaction_id, journal_id, registry_id) = identities();
        let clean =
            initial_journal(&plan, transaction_id, journal_id.clone(), registry_id).unwrap();
        let path = journal_path(root.path(), &journal_id);
        symlink(root.path().join("outside"), &path).unwrap();
        assert!(write_journal(root.path(), &clean).is_err());
        assert!(recover_root(root.path()).is_err());
        assert!(
            fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}

#[test]
fn durable_intents_precede_directory_candidate_backup_and_install_mutations() {
    let root = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    let mut journal = initial_journal(&plan, transaction_id, journal_id, registry_id).unwrap();
    write_journal(root.path(), &journal).unwrap();

    journal.directory_phase = OperationPhase::CreateIntent;
    write_journal(root.path(), &journal).unwrap();
    assert!(!root.path().join("rawdata").exists());
    for phase in [
        OperationPhase::CandidateIntent,
        OperationPhase::BackupIntent,
        OperationPhase::InstallIntent,
    ] {
        update_operation(root.path(), &mut journal, 0, phase).unwrap();
        let persisted = read_journal(root.path(), &journal.journal_id).unwrap();
        assert_eq!(persisted.operations[0].phase, phase);
        assert!(
            inspect(
                &fixed_path(root.path(), &persisted.operations[0].destination).unwrap(),
                true
            )
            .unwrap()
            .kind
                == persisted.operations[0].before.kind
        );
    }
}
