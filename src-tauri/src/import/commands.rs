use super::pipeline::run_import_pipeline_impl;
use super::relocation::RelocationPlan;
use super::runs::{
    acknowledge_import_run_for_state, attach_import_run_for_state,
    confirm_import_worker_stopped_for_state, fail_preparing_run_for_id,
    get_active_import_run_for_state, plan_import_relocation_for_state,
    reserve_import_run_for_state,
};
use super::staging::{StagingEntry, StagingPreflightResult, preflight_staging_plan_for_state};
use super::supervisor::stop_import_run_for_state;
use super::types::{
    ImportCommandError, ImportRunSnapshot, ImportStructuredError, ImportSubjectStatus,
};
use crate::app::state::AppState;
use crate::error::{CommandError, IntoCommandResult};
use crate::execution::profile::ExecutionProfile;
use serde_json::Value;
use tauri::{AppHandle, Runtime, State};

#[tauri::command]
#[specta::specta]
pub fn preflight_staging_plan(
    state: State<'_, AppState>,
    staging_entries: Vec<StagingEntry>,
) -> Result<StagingPreflightResult, CommandError> {
    Ok(preflight_staging_plan_for_state(&state, &staging_entries))
}

#[tauri::command]
#[specta::specta]
pub fn plan_import_relocation(
    state: State<'_, AppState>,
    subject_list: Vec<String>,
) -> Result<RelocationPlan, CommandError> {
    plan_import_relocation_for_state(&state, &subject_list).into_command_result()
}

/// Admission only.  This persists Preparing before any staging filesystem work.
#[tauri::command]
#[specta::specta]
pub fn reserve_import_run(
    state: State<'_, AppState>,
    subject_list: Vec<String>,
    relocation_plan_id: String,
    profile_id: String,
    subjects_to_preserve: Option<Vec<String>>,
    preserve_staging: bool,
) -> Result<ImportRunSnapshot, CommandError> {
    reserve_import_run_for_state(
        &state,
        subject_list,
        relocation_plan_id,
        profile_id,
        subjects_to_preserve.unwrap_or_default(),
        preserve_staging,
    )
    .map_err(|error| CommandError::from_error(&error, "Import could not be prepared."))
}

#[tauri::command]
#[specta::specta]
pub fn get_active_import_run(
    state: State<'_, AppState>,
) -> Result<Option<ImportRunSnapshot>, CommandError> {
    get_active_import_run_for_state(&state).into_command_result()
}

#[tauri::command]
#[specta::specta]
pub fn attach_import_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ImportRunSnapshot, CommandError> {
    attach_import_run_for_state(&state, &run_id).into_command_result()
}

/// Launch is exact-run scoped.  It returns a snapshot, never a PID.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub fn launch_import_run<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    run_id: String,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    execution_profile: ExecutionProfile,
    subject_list: Vec<String>,
    relocation_plan_id: String,
) -> Result<ImportRunSnapshot, ImportCommandError> {
    let launch_result = run_import_pipeline_impl(
        app,
        &state,
        staging_entries,
        sourcestructure_json,
        studypar_json,
        execution_profile,
        subject_list,
        None,
        run_id.clone(),
        relocation_plan_id,
    );
    settle_launch_result(&state, &run_id, launch_result)
}

pub(super) fn settle_launch_result(
    state: &AppState,
    run_id: &str,
    launch_result: Result<(), ImportCommandError>,
) -> Result<ImportRunSnapshot, ImportCommandError> {
    if let Err(error) = &launch_result {
        log::error!("[IMPORT] run={run_id} launch failed: {error}");
    }
    match launch_result {
        Ok(_) => attach_import_run_for_state(state, run_id).map_err(ImportCommandError::from),
        Err(error) => match attach_import_run_for_state(state, run_id) {
            Ok(snapshot) if snapshot.lifecycle == super::types::ImportLifecycle::Failed => {
                Ok(snapshot)
            }
            _ => match fail_preparing_run_for_id(
                state,
                run_id,
                ImportStructuredError {
                    code: match &error {
                        ImportCommandError::Preflight { .. } => "preflight",
                        ImportCommandError::Operational { .. } => "launch",
                    }
                    .to_string(),
                    message: format!("{error}"),
                    subject: None,
                    staging_issues: match &error {
                        ImportCommandError::Preflight { issues, .. } => Some(issues.clone()),
                        ImportCommandError::Operational { .. } => None,
                    },
                },
            ) {
                Ok(Some(snapshot)) => Ok(snapshot),
                Ok(None) => Err(error),
                Err(persist_error) => Err(ImportCommandError::from(persist_error)),
            },
        },
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_import_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ImportRunSnapshot, CommandError> {
    stop_import_run_for_state(&state, &run_id).into_command_result()
}

#[tauri::command]
#[specta::specta]
pub fn confirm_import_worker_stopped(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ImportRunSnapshot, CommandError> {
    confirm_import_worker_stopped_for_state(&state, &run_id).into_command_result()
}

#[tauri::command]
#[specta::specta]
pub fn acknowledge_import_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), CommandError> {
    acknowledge_import_run_for_state(&state, &run_id).into_command_result()
}

#[tauri::command]
#[specta::specta]
pub fn read_import_status(
    state: State<'_, AppState>,
) -> Result<Vec<ImportSubjectStatus>, CommandError> {
    super::status::read_import_status_for_state(&state).into_command_result()
}
