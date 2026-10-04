use anyhow::anyhow;
use tempfile::TempDir;

use super::super::fault_injection::{SetupFault, inject_setup_fault};
use super::super::{
    SetupCommandError, SetupMode, SetupPlans, command_error, commit_for_state, preflight_for_state,
};
use super::common::project;

#[test]
fn every_structured_command_error_category_has_a_stable_wire_kind() {
    let cases = [
        (anyhow!("Setup plan expired"), "stale"),
        (anyhow!("marker must be regular"), "conflict"),
        (anyhow!("changes rolled back"), "rollback"),
        (
            anyhow!("could not synchronize directory"),
            "uncertain_durability",
        ),
        (
            anyhow!("recovery required after ambiguous swap"),
            "recovery_required",
        ),
        (anyhow!("unexpected"), "failed"),
    ];
    for (error, kind) in cases {
        let value = serde_json::to_value(command_error(error)).unwrap();
        assert_eq!(value["kind"], kind);
        assert!(
            value["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
    }
}

#[test]
fn command_errors_distinguish_rollback_from_pending_recovery() {
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
    let _guard = inject_setup_fault(SetupFault::CandidateCreate);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::Rollback { .. }
    ));
    drop(_guard);

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
    let _guard = inject_setup_fault(SetupFault::JournalWrite);
    let error = commit_for_state(&plans, &plan.plan_id, app_data.path()).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::RecoveryRequired { .. }
    ));
}
