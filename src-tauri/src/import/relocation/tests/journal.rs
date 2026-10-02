use std::fs;
use std::path::Path;

use tempfile::tempdir;

use super::super::candidate::create_owned_parent_dirs;
use super::super::journal::{
    JOURNAL_VERSION, journal_path, journal_temp_path, read_journal, validate_journal, write_journal,
};
use super::super::paths::project_identity;
use super::super::types::{
    DatasetPhase, JournalDataset, JournalRawdata, JournalSubject, RawdataPhase, RelocationJournal,
    SubjectPhase,
};

fn planned_journal(root: &Path) -> RelocationJournal {
    RelocationJournal {
        version: JOURNAL_VERSION,
        project_identity: project_identity(root),
        generation: 7,
        plan_id: "plan".to_string(),
        plan_fingerprint: "first".to_string(),
        dataset: JournalDataset {
            source_present: false,
            destination_existed: false,
            destination: "rawdata/dataset_description.json".to_string(),
            candidate: "rawdata/.dataset_description.json.easl-relocation-plan-run-candidate"
                .to_string(),
            phase: DatasetPhase::NotRequired,
            fingerprint: None,
        },
        subjects: vec![JournalSubject {
            subject: "A".to_string(),
            phase: SubjectPhase::Planned,
            derived_reconciled: false,
            rawdata: JournalRawdata {
                destination: "rawdata/sub-A".to_string(),
                candidate: "rawdata/.sub-A.easl-relocation-plan-A-candidate".to_string(),
                backup: "rawdata/.sub-A.easl-relocation-plan-A-backup".to_string(),
                had_destination: false,
                phase: RawdataPhase::Planned,
                candidate_fingerprint: None,
                backup_fingerprint: None,
            },
        }],
        terminal_outcome: None,
    }
}

#[test]
fn journal_v3_replacement_is_atomic_and_keeps_run_ownership() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    let mut journal = planned_journal(root);
    write_journal(root, &journal).unwrap();
    journal.plan_fingerprint = "second".to_string();
    write_journal(root, &journal).unwrap();

    let stored = read_journal(root).unwrap().unwrap();
    assert_eq!(stored.version, 3);
    assert_eq!(stored.generation, 7);
    assert_eq!(stored.plan_id, "plan");
    assert_eq!(stored.plan_fingerprint, "second");
    assert!(!journal_temp_path(root, &journal).exists());
}

#[test]
fn journal_rejects_foreign_run_and_escaping_or_mismatched_paths() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    let mut journal = planned_journal(root);
    journal.project_identity = "foreign".to_string();
    assert!(validate_journal(root, &journal).is_err());

    let mut escaping = planned_journal(root);
    escaping.subjects[0].rawdata.destination = "../outside".to_string();
    assert!(validate_journal(root, &escaping).is_err());

    let mut mismatched = planned_journal(root);
    mismatched.subjects[0].rawdata.backup =
        "rawdata/.sub-B.easl-relocation-plan-B-backup".to_string();
    assert!(validate_journal(root, &mismatched).is_err());
}

#[test]
fn exact_stale_next_journal_temp_name_cannot_block_persistence() {
    let workspace = tempdir().unwrap();
    let root = workspace.path();
    let journal = planned_journal(root);
    let stale = journal_temp_path(root, &journal);
    fs::write(&stale, b"foreign stale temp").unwrap();
    write_journal(root, &journal).unwrap();
    assert_eq!(fs::read(&stale).unwrap(), b"foreign stale temp");
    assert!(journal_path(root).exists());
}

#[cfg(unix)]
#[test]
fn owned_parent_creation_rejects_nested_symlink_ancestor() {
    use std::os::unix::fs::symlink;

    let workspace = tempdir().unwrap();
    let root = workspace.path().join("project");
    let external = workspace.path().join("external");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&external).unwrap();
    symlink(&external, root.join("derivatives")).unwrap();

    assert!(create_owned_parent_dirs(&root, &root.join("derivatives/ExploreASL/log")).is_err());
    assert!(!external.join("ExploreASL").exists());
}
