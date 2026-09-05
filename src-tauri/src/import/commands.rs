use super::output::move_import_output_for_state;
use super::pipeline::{self, stop_active_import_for_state, stop_import_pid};
use super::relocation::{RelocationOutcome, RelocationPlan};
use super::staging::{StagingEntry, StagingPreflightResult, preflight_staging_plan_for_state};
use super::state::plan_import_relocation_for_state;
use super::status::{
    clean_import_status_for_state, copy_lock_files_for_state, read_import_status_impl,
};
use super::types::{ImportCommandError, ImportSubjectStatus};
use super::validation::validate_path_input;
use crate::app_state::AppState;
use crate::error::IntoCommandResult;
use crate::execution_profile::ExecutionProfile;
use serde_json::Value;
use tauri::{AppHandle, Runtime, State};

#[tauri::command]
pub fn preflight_staging_plan(
    state: State<'_, AppState>,
    staging_entries: Vec<StagingEntry>,
) -> Result<StagingPreflightResult, String> {
    Ok(preflight_staging_plan_for_state(&state, &staging_entries))
}

/// Read-only destination inventory. Root and scope come only from native active
/// project ownership; frontend receives no absolute filesystem paths.
#[tauri::command]
pub fn plan_import_relocation(
    state: State<'_, AppState>,
    subject_list: Vec<String>,
) -> Result<RelocationPlan, String> {
    plan_import_relocation_for_state(&state, &subject_list)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_import_pipeline<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    execution_profile: ExecutionProfile,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    run_request_id: String,
    relocation_plan_id: String,
) -> Result<u32, ImportCommandError> {
    pipeline::run_import_pipeline_impl(
        app,
        &state,
        staging_entries,
        sourcestructure_json,
        studypar_json,
        execution_profile,
        subject_list,
        subjects_to_preserve,
        run_request_id,
        relocation_plan_id,
    )
}

#[tauri::command]
pub fn stop_import(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    stop_import_pid(&state, pid)
}

#[tauri::command]
pub fn stop_active_import(state: State<'_, AppState>) -> Result<(), String> {
    stop_active_import_for_state(&state)
}

#[tauri::command]
pub fn clean_import_status(state: State<'_, AppState>) -> Result<(), String> {
    clean_import_status_for_state(&state).into_command_result()
}

#[tauri::command]
pub fn move_import_output(
    state: State<'_, AppState>,
    debug_mode: bool,
    cleanup_staging: bool,
) -> Result<RelocationOutcome, String> {
    move_import_output_for_state(&state, debug_mode, cleanup_staging).into_command_result()
}

#[tauri::command]
pub fn copy_lock_files(state: State<'_, AppState>, subjects: Vec<String>) -> Result<(), String> {
    copy_lock_files_for_state(&state, &subjects).into_command_result()
}

#[tauri::command]
pub async fn read_import_status(project_root: String) -> Result<Vec<ImportSubjectStatus>, String> {
    let project_root = validate_path_input("project_root", &project_root)?;
    read_import_status_impl(project_root).into_command_result()
}
