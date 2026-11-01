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
        (anyhow!("rawdata must be a directory"), "conflict"),
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
        let value =
            serde_json::to_value(command_error(error.context("private setup context"))).unwrap();
        assert_eq!(value["kind"], kind);
        assert!(!value.to_string().contains("private"));
        if kind == "failed" {
            assert_eq!(value["details"], "");
        } else {
            assert_ne!(value["details"], value["message"]);
            assert!(!value["details"].as_str().unwrap().is_empty());
        }
        assert!(
            value["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
    }
}

#[test]
fn setup_worker_failures_stay_failed_without_classifying_diagnostic_text() {
    let value = serde_json::to_value(SetupCommandError::failed(anyhow!(
        "private worker panic: stale conflict durability"
    )))
    .unwrap();
    assert_eq!(value["kind"], "failed");
    assert_eq!(value["message"], "Project setup could not be completed.");
    assert_eq!(value["details"], "");
}

#[test]
fn command_errors_report_completed_rollback() {
    let root = TempDir::new().unwrap();
    let plans = SetupPlans::default();
    let plan = preflight_for_state(
        &plans,
        root.path().to_string_lossy().into_owned(),
        SetupMode::Bids,
        Some(String::from_utf8(project("bids")).unwrap()),
    )
    .unwrap();
    let _guard = inject_setup_fault(SetupFault::CandidateCreate);
    let error = commit_for_state(&plans, &plan.plan_id).unwrap_err();
    assert!(matches!(
        command_error(error),
        SetupCommandError::Rollback { .. }
    ));
    drop(_guard);
}

#[test]
fn completed_rollback_takes_precedence_over_the_original_failure() {
    for cause in [
        "could not synchronize directory",
        "project.easl already exists",
        "Setup plan expired",
    ] {
        let error = command_error(anyhow!("Setup changes rolled back after failure: {cause}"));
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["kind"], "rollback");
        assert!(value["details"].as_str().unwrap().contains("restored"));
    }
}

#[test]
fn failed_rollback_keeps_recovery_guidance_even_when_the_original_error_was_a_conflict() {
    let error = command_error(anyhow!(
        "Setup failed (project.easl already exists); recovery required (could not synchronize changes rolled back earlier)"
    ));
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["kind"], "recovery_required");
    assert!(value["details"].as_str().unwrap().contains("unchanged"));
}
