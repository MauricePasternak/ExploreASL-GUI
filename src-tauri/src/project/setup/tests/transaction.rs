use anyhow::anyhow;
use std::fs;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault, take_install_observations};
use super::super::filesystem::{find_owned_sibling, hash, inspect, owned_sibling};
use super::super::journal::JOURNAL_PREFIX;
use super::super::planning::PLAN_TTL;
use super::super::transaction::{backup_for, create_candidate};
use super::super::{
    OperationKind, RAWDATA_MARKER_BYTES, RAWDATA_MARKER_PATH, SetupCommandError, SetupMode,
    SetupPlans, command_error, commit_for_state, preflight_for_state, recover_root, verify,
};
use super::common::{
    assert_confirmed_delta, changed_source_paths, project, source_snapshot, write_bids_fixture,
};

#[test]
fn source_tree_hash_integration_matrix_covers_commit_stale_rejection_and_recovery() {
    // Fresh BIDS-direct: detection, preflight, commit, then read-only
    // compatibility verification. Snapshots retain relative path, entry
    // type, size, and file-content hash for every source-tree entry.
    let fresh = TempDir::new().unwrap();
    write_bids_fixture(fresh.path(), None);
    let fresh_before = source_snapshot(fresh.path());
    assert!(
        crate::bids::commands::check_bids_dataset_impl(fresh.path())
            .unwrap()
            .is_bids
    );
    let fresh_plans = SetupPlans::default();
    let fresh_plan = preflight_for_state(
        &fresh_plans,
        fresh.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(
        source_snapshot(fresh.path()),
        fresh_before,
        "preflight is read-only"
    );
    commit_for_state(&fresh_plans, &fresh_plan.plan_id).unwrap();
    assert_confirmed_delta(fresh.path(), &fresh_before, &fresh_plan);
    let verified_before = source_snapshot(fresh.path());
    verify(fresh.path()).unwrap();
    assert_eq!(
        source_snapshot(fresh.path()),
        verified_before,
        "verification is read-only"
    );

    // DICOM-on-BIDS retains the BIDS source fixture but commits only its
    // reviewed project and ignore-file operations.
    let dicom = TempDir::new().unwrap();
    write_bids_fixture(dicom.path(), None);
    let dicom_before = source_snapshot(dicom.path());
    assert!(
        crate::bids::commands::check_bids_dataset_impl(dicom.path())
            .unwrap()
            .is_bids
    );
    let dicom_plans = SetupPlans::default();
    let dicom_plan = preflight_for_state(
        &dicom_plans,
        dicom.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(dicom.path()), dicom_before);
    commit_for_state(&dicom_plans, &dicom_plan.plan_id).unwrap();
    assert_confirmed_delta(dicom.path(), &dicom_before, &dicom_plan);
    assert!(!dicom.path().join("rawdata").exists());

    // Existing rawdata and a user README survive an LF ignore-file update.
    let existing_lf = TempDir::new().unwrap();
    write_bids_fixture(existing_lf.path(), Some(b"derivatives/\n"));
    fs::create_dir(existing_lf.path().join("rawdata")).unwrap();
    fs::write(
        existing_lf.path().join("rawdata/README.md"),
        b"user README\n",
    )
    .unwrap();
    let existing_lf_before = source_snapshot(existing_lf.path());
    let existing_lf_plans = SetupPlans::default();
    let existing_lf_plan = preflight_for_state(
        &existing_lf_plans,
        existing_lf.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(existing_lf.path()), existing_lf_before);
    commit_for_state(&existing_lf_plans, &existing_lf_plan.plan_id).unwrap();
    assert_confirmed_delta(existing_lf.path(), &existing_lf_before, &existing_lf_plan);
    assert_eq!(
        fs::read(existing_lf.path().join("rawdata/README.md")).unwrap(),
        b"user README\n"
    );

    // CRLF input keeps CRLF bytes exactly as previewed.
    let crlf = TempDir::new().unwrap();
    write_bids_fixture(crlf.path(), Some(b"derivatives/\r\nproject.easl\r\n"));
    let crlf_before = source_snapshot(crlf.path());
    let crlf_plans = SetupPlans::default();
    let crlf_plan = preflight_for_state(
        &crlf_plans,
        crlf.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert_eq!(source_snapshot(crlf.path()), crlf_before);
    commit_for_state(&crlf_plans, &crlf_plan.plan_id).unwrap();
    assert_confirmed_delta(crlf.path(), &crlf_before, &crlf_plan);
    assert!(
        fs::read(crlf.path().join(".bidsignore"))
            .unwrap()
            .windows(2)
            .any(|bytes| bytes == b"\r\n")
    );

    // A stale plan rejects before mutation. The external edit is the
    // baseline; the rejected confirmation itself has a zero tree delta.
    let stale = TempDir::new().unwrap();
    write_bids_fixture(stale.path(), None);
    let stale_plans = SetupPlans::default();
    let stale_plan = preflight_for_state(
        &stale_plans,
        stale.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(stale.path().join(".bidsignore"), b"external change\n").unwrap();
    let stale_before_commit = source_snapshot(stale.path());
    assert!(commit_for_state(&stale_plans, &stale_plan.plan_id).is_err());
    assert_eq!(
        source_snapshot(stale.path()),
        stale_before_commit,
        "stale commit is read-only"
    );

    // An interruption after durable commit but before terminal cleanup
    // leaves its journal. Recovery removes that evidence and settles on
    // exactly the reviewed after-state.
    let interrupted = TempDir::new().unwrap();
    write_bids_fixture(interrupted.path(), None);
    let interrupted_before = source_snapshot(interrupted.path());
    let interrupted_plans = SetupPlans::default();
    let interrupted_plan = preflight_for_state(
        &interrupted_plans,
        interrupted.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    {
        let _fault = inject_setup_fault(SetupFault::Cleanup);
        assert_eq!(
            commit_for_state(&interrupted_plans, &interrupted_plan.plan_id)
                .unwrap()
                .outcome,
            "committed"
        );
    }
    assert!(
        changed_source_paths(&interrupted_before, &source_snapshot(interrupted.path()))
            .iter()
            .any(|path| path.starts_with(JOURNAL_PREFIX))
    );
    assert_eq!(recover_root(interrupted.path()).unwrap().recovered, 1);
    assert_confirmed_delta(interrupted.path(), &interrupted_before, &interrupted_plan);
}

#[test]
fn repair_transaction_changes_only_reviewed_compatibility_paths() {
    let root = TempDir::new().unwrap();
    let original_project = project("bids");
    fs::write(root.path().join("project.easl"), &original_project).unwrap();
    fs::create_dir(root.path().join("rawdata")).unwrap();
    fs::write(root.path().join("rawdata/README.md"), b"keep exactly").unwrap();
    fs::write(root.path().join(".bidsignore"), b"derivatives/\r\n").unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Repair,
        None,
    )
    .unwrap();
    let reviewed_paths = plan
        .operations
        .iter()
        .filter(|operation| operation.operation != OperationKind::NoOp)
        .map(|operation| operation.path.as_str())
        .collect::<Vec<_>>();
    let result = commit_for_state(&plans, &plan.plan_id).unwrap();
    assert_eq!(result.project_path, None);
    assert_eq!(result.project_document, None);
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        original_project
    );
    assert_eq!(
        fs::read(root.path().join("rawdata/README.md")).unwrap(),
        b"keep exactly"
    );
    assert_eq!(
        fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        fs::read(root.path().join(".bidsignore")).unwrap(),
        b"derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );
    assert_eq!(reviewed_paths, vec![".bidsignore", RAWDATA_MARKER_PATH]);
}

#[test]
fn transaction_installs_project_last_and_replays_result() {
    let temp = TempDir::new().unwrap();
    let state = crate::app::state::AppState::default();
    let plan = crate::project::config::preflight_creation_for_state(
        &state,
        temp.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        "Native creation".into(),
        "validated-profile".into(),
    )
    .unwrap();
    let result = commit_for_state(&state.setup_plans, &plan.plan_id).unwrap();
    assert_eq!(result.outcome, "committed");
    assert_eq!(
        super::super::filesystem::hash(&fs::read(temp.path().join("project.easl")).unwrap()),
        plan.project_summary.unwrap().content_hash
    );
    assert_eq!(
        fs::read(temp.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        commit_for_state(&state.setup_plans, &plan.plan_id).unwrap(),
        result
    );
    let document = result.project_document.as_ref().unwrap();
    assert_eq!(document.project_meta.name, "Native creation");
    assert_eq!(
        document.mapping_state.source_data_path.as_deref(),
        Some(".")
    );
    assert_eq!(document.data_par, crate::project::model::DataPar::default());
    assert!(document.ui_state.processing.is_none());
    assert_eq!(document.ui_state.manifest.reviewers.len(), 1);
    assert_eq!(document.ui_state.manifest.reviewers[0].label, "Reviewer 1");
    assert_eq!(
        document
            .ui_state
            .import
            .as_ref()
            .unwrap()
            .selected_profile_id
            .as_deref(),
        Some("validated-profile")
    );
    let mut committed = result.clone();
    crate::project::config::retain_committed(&state, &mut committed).unwrap();
    let activated =
        crate::project::config::activate_for_state(&state, committed.candidate_id.unwrap(), false)
            .unwrap();
    assert_eq!(&activated.document, document);
}

#[test]
fn plan_admission_rejects_missing_expired_superseded_and_claimed_ids() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    assert!(commit_for_state(&plans, "missing").is_err());
    let first = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let second = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    assert!(commit_for_state(&plans, &first.plan_id).is_err());
    {
        let mut cache = plans.0.lock().unwrap();
        let plan = cache.get_mut(&second.plan_id).unwrap();
        plan.created = SystemTime::now() - PLAN_TTL - Duration::from_secs(1);
    }
    assert!(commit_for_state(&plans, &second.plan_id).is_err());
    let current = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Dicom,
        Some(String::from_utf8(project("dicom")).unwrap()),
    )
    .unwrap();
    plans
        .0
        .lock()
        .unwrap()
        .get_mut(&current.plan_id)
        .unwrap()
        .claimed = true;
    assert!(commit_for_state(&plans, &current.plan_id).is_err());
    assert!(!root.path().join("project.easl").exists());
}

#[test]
fn a_failed_claim_is_terminal_and_cannot_be_retried_with_reviewed_bytes() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(root.path().join(".bidsignore"), b"external change\n").unwrap();
    let first = commit_for_state(&plans, &plan.plan_id)
        .unwrap_err()
        .to_string();
    fs::remove_file(root.path().join(".bidsignore")).unwrap();
    let second = commit_for_state(&plans, &plan.plan_id)
        .unwrap_err()
        .to_string();
    assert_eq!(second, first);
    assert!(!root.path().join("project.easl").exists());
}

#[test]
fn replacement_revalidates_before_backup_and_fails_closed_on_swap() {
    let root = TempDir::new().unwrap();
    let target = root.path().join(".bidsignore");
    fs::write(&target, b"before\n").unwrap();
    let observed = inspect(&target, true).unwrap();
    fs::write(&target, b"swapped\n").unwrap();
    assert!(
        backup_for(
            root.path(),
            &target,
            "transaction-00000000-0000-0000-0000-000000000001",
            &observed,
        )
        .is_err()
    );
    assert_eq!(fs::read(target).unwrap(), b"swapped\n");
}

#[test]
fn candidates_are_exact_same_parent_create_new_and_backups_validate_fingerprints() {
    let root = TempDir::new().unwrap();
    let transaction = "transaction-00000000-0000-0000-0000-000000000001";
    let destination = root.path().join(".bidsignore");
    let collision = owned_sibling(&destination, transaction, "candidate", "0").unwrap();
    fs::write(&collision, b"foreign").unwrap();
    let (candidate, fingerprint) =
        create_candidate(root.path(), &destination, transaction, b"exact bytes\n").unwrap();
    let candidate_path = root.path().join(&candidate);
    assert_eq!(candidate_path.parent(), destination.parent());
    assert_ne!(candidate_path, collision);
    assert_eq!(fs::read(&candidate_path).unwrap(), b"exact bytes\n");
    assert_eq!(
        fingerprint.hash.as_deref(),
        Some(hash(b"exact bytes\n").as_str())
    );

    fs::write(&destination, b"before\n").unwrap();
    let before = inspect(&destination, true).unwrap();
    let backup_collision = owned_sibling(&destination, transaction, "backup", "0").unwrap();
    fs::write(&backup_collision, b"unowned").unwrap();
    let (backup, backup_fingerprint) =
        backup_for(root.path(), &destination, transaction, &before).unwrap();
    assert_ne!(root.path().join(&backup), backup_collision);
    assert_eq!(backup_fingerprint, before);
    assert_eq!(fs::read(backup_collision).unwrap(), b"unowned");
    fs::write(root.path().join(&backup), b"tampered").unwrap();
    assert_ne!(inspect(&root.path().join(&backup), true).unwrap(), before);
    fs::write(&candidate_path, b"foreign").unwrap();
    assert!(find_owned_sibling(&destination, transaction, "candidate", &fingerprint).is_err());
}

#[test]
fn fresh_and_existing_transactions_preserve_exact_bytes_and_project_is_last_visible() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    commit_for_state(&plans, &plan.plan_id).unwrap();
    assert_eq!(
        take_install_observations(),
        vec![
            (".easl-gui-managed".into(), false),
            (".bidsignore".into(), false),
            ("project.easl".into(), true),
        ]
    );
    assert_eq!(
        fs::read(root.path().join("project.easl")).unwrap(),
        project("bids")
    );
    assert_eq!(
        fs::read(root.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );

    let existing = TempDir::new().unwrap();
    fs::create_dir(existing.path().join("rawdata")).unwrap();
    fs::write(existing.path().join("rawdata/README.md"), b"keep").unwrap();
    fs::write(
        existing.path().join(RAWDATA_MARKER_PATH),
        RAWDATA_MARKER_BYTES,
    )
    .unwrap();
    fs::write(existing.path().join(".bidsignore"), b"user\r\n").unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        existing.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let first = commit_for_state(&plans, &plan.plan_id).unwrap();
    let second = commit_for_state(&plans, &plan.plan_id).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        fs::read(existing.path().join("rawdata/README.md")).unwrap(),
        b"keep"
    );
    assert_eq!(
        fs::read(existing.path().join(RAWDATA_MARKER_PATH)).unwrap(),
        RAWDATA_MARKER_BYTES
    );
    assert_eq!(
        fs::read(existing.path().join(".bidsignore")).unwrap(),
        b"user\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n"
    );
}

#[test]
fn commit_contract_returns_only_durable_result_and_structured_failures_without_activation() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let stale = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    fs::write(root.path().join(".bidsignore"), b"stale").unwrap();
    assert!(matches!(
        command_error(commit_for_state(&plans, &stale.plan_id).unwrap_err()),
        SetupCommandError::Stale { .. }
    ));
    assert!(!root.path().join("project.easl").exists());

    let conflict_root = TempDir::new().unwrap();
    fs::write(conflict_root.path().join("project.easl"), b"user project").unwrap();
    let conflict_plans = SetupPlans::default();
    let conflict = preflight_for_state(
        &conflict_plans,
        conflict_root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    assert!(matches!(
        command_error(commit_for_state(&conflict_plans, &conflict.plan_id).unwrap_err()),
        SetupCommandError::Conflict { .. }
    ));
    assert_eq!(
        fs::read(conflict_root.path().join("project.easl")).unwrap(),
        b"user project"
    );

    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _fault = inject_setup_fault(SetupFault::RootFlush);
    assert!(matches!(
        command_error(commit_for_state(&plans, &plan.plan_id).unwrap_err()),
        SetupCommandError::Rollback { .. }
    ));
    assert!(!root.path().join("project.easl").exists());

    assert!(matches!(
        command_error(anyhow!("could not synchronize directory")),
        SetupCommandError::UncertainDurability { .. }
    ));

    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().display().to_string(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let result = commit_for_state(&plans, &plan.plan_id).unwrap();
    assert_eq!(
        result.project_path.as_deref(),
        root.path().join("project.easl").to_str()
    );
    assert_eq!(
        result.project_document,
        Some(crate::project::validation::parse_document(&project("bids")).unwrap())
    );
}
