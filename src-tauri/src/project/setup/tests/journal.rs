use std::fs;
use tempfile::TempDir;

use super::super::filesystem::{
    find_owned_sibling, fixed_path, hash, inspect, owned_sibling, random_id, relative_to_root,
    safe_relative,
};
use super::super::journal::{
    JOURNAL_VERSION, OperationPhase, PendingEntry, PendingRegistry, REGISTRY_VERSION,
    TransactionPhase, initial_journal, journal_bytes, journal_path, load_registry, read_journal,
    register_pending, registry_path, remove_pending, update_operation, validate_journal,
    validate_registry_entry, write_journal,
};
use super::super::planning::preflight;
use super::super::transaction::create_candidate;
use super::super::{SetupMode, recover_all};
use super::common::{entry_for, identities, project};

#[test]
fn journal_registry_and_candidate_paths_reject_tampering_and_collisions() {
    let root = TempDir::new().unwrap();
    let destination = root.path().join(".bidsignore");
    let transaction = "transaction-00000000-0000-0000-0000-000000000001";
    let (candidate, fingerprint) =
        create_candidate(root.path(), &destination, transaction, b"exact\n").unwrap();
    assert_eq!(fs::read(root.path().join(&candidate)).unwrap(), b"exact\n");
    assert_eq!(fingerprint.hash.as_deref(), Some(hash(b"exact\n").as_str()));
    assert!(safe_relative(&candidate).is_ok());
    assert!(owned_sibling(&destination, transaction, "candidate", "x").is_err());
    let entry = PendingEntry {
        registry_id: "registry-1".into(),
        transaction_id: transaction.into(),
        journal_id: "journal-1".into(),
        root: root.path().display().to_string(),
        journal_name: "wrong.json".into(),
    };
    assert!(validate_registry_entry(&entry).is_err());
    fs::write(root.path().join(&candidate), b"foreign").unwrap();
    assert!(find_owned_sibling(&destination, transaction, "candidate", &fingerprint).is_err());
}

#[test]
fn journal_and_registry_schemas_are_versioned_strict_and_cross_bound() {
    let root = TempDir::new().unwrap();
    let app_data = TempDir::new().unwrap();
    let plan = preflight(root.path(), SetupMode::Bids, Some(project("bids"))).unwrap();
    let (transaction_id, journal_id, registry_id) = identities();
    assert_ne!(transaction_id, journal_id);
    assert_ne!(transaction_id, registry_id);
    assert_ne!(journal_id, registry_id);
    let journal = initial_journal(
        &plan,
        transaction_id.clone(),
        journal_id.clone(),
        registry_id.clone(),
    )
    .unwrap();
    let entry = entry_for(root.path(), transaction_id, journal_id.clone(), registry_id);

    let registry = PendingRegistry {
        version: REGISTRY_VERSION,
        entries: vec![entry.clone()],
    };
    assert_eq!(
        serde_json::to_value(&journal).unwrap()["version"],
        JOURNAL_VERSION
    );
    assert_eq!(
        serde_json::to_value(&registry).unwrap()["version"],
        REGISTRY_VERSION
    );

    let mut malformed = serde_json::to_value(&registry).unwrap();
    malformed["unexpected"] = serde_json::json!(true);
    fs::write(
        registry_path(app_data.path()),
        serde_json::to_vec(&malformed).unwrap(),
    )
    .unwrap();
    assert!(load_registry(app_data.path()).is_err());

    register_pending(app_data.path(), entry.clone()).unwrap_err();
    fs::remove_file(registry_path(app_data.path())).unwrap();
    register_pending(app_data.path(), entry.clone()).unwrap();
    write_journal(root.path(), &journal).unwrap();

    let mut foreign = journal.clone();
    foreign.registry_id = random_id("registry");
    fs::write(
        journal_path(root.path(), &journal_id),
        journal_bytes(&foreign).unwrap(),
    )
    .unwrap();
    assert!(recover_all(app_data.path()).is_err());
    assert_eq!(load_registry(app_data.path()).unwrap().entries, vec![entry]);
}

#[test]
fn initial_journal_and_registry_claims_never_replace_foreign_files() {
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
    let journal_path = journal_path(root.path(), &journal_id);
    fs::write(&journal_path, b"foreign journal").unwrap();
    assert!(write_journal(root.path(), &journal).is_err());
    assert_eq!(fs::read(&journal_path).unwrap(), b"foreign journal");

    let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
    fs::write(registry_path(app_data.path()), b"foreign registry").unwrap();
    assert!(register_pending(app_data.path(), entry).is_err());
    assert_eq!(
        fs::read(registry_path(app_data.path())).unwrap(),
        b"foreign registry"
    );
}

#[cfg(unix)]
#[test]
fn journal_and_registry_updates_are_same_parent_replacements_not_truncates() {
    use std::os::unix::fs::MetadataExt;

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
    write_journal(root.path(), &journal).unwrap();
    let root_journal = journal_path(root.path(), &journal_id);
    let before_journal_inode = fs::metadata(&root_journal).unwrap().ino();
    journal.phase = TransactionPhase::Preparing;
    write_journal(root.path(), &journal).unwrap();
    assert_ne!(
        before_journal_inode,
        fs::metadata(&root_journal).unwrap().ino()
    );

    let entry = entry_for(root.path(), transaction_id, journal_id, registry_id);
    register_pending(app_data.path(), entry.clone()).unwrap();
    let registry = registry_path(app_data.path());
    let before_registry_inode = fs::metadata(&registry).unwrap().ino();
    remove_pending(app_data.path(), &entry.registry_id).unwrap();
    assert_ne!(
        before_registry_inode,
        fs::metadata(&registry).unwrap().ino()
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
    let candidate = owned_sibling(&target, &transaction_id, "candidate", "0").unwrap();
    let backup = owned_sibling(&target, &transaction_id, "backup", "1").unwrap();
    journal.operations[1].candidate = Some(relative_to_root(root.path(), &candidate).unwrap());
    journal.operations[1].backup = Some(relative_to_root(root.path(), &backup).unwrap());
    assert!(
        journal.operations[1]
            .candidate
            .as_deref()
            .unwrap()
            .starts_with('.')
    );
    validate_journal(root.path(), &journal).unwrap();
    journal.operations[1].candidate = Some("../outside".into());
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
    for (index, phase) in [
        OperationPhase::CandidateIntent,
        OperationPhase::BackupIntent,
        OperationPhase::InstallIntent,
    ]
    .into_iter()
    .enumerate()
    {
        update_operation(root.path(), &mut journal, index, phase).unwrap();
        let persisted = read_journal(root.path(), &journal.journal_id).unwrap();
        assert_eq!(persisted.operations[index].phase, phase);
        assert!(
            inspect(
                &fixed_path(root.path(), &persisted.operations[index].destination).unwrap(),
                true
            )
            .unwrap()
            .kind
                == persisted.operations[index].before.kind
        );
    }
}
