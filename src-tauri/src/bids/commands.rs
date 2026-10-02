use crate::bids::group::{BidsSidecarScan, group_by_fingerprint};
use crate::bids::scan::{asl_json_path_for, parse_bids_structure};
use crate::bids::setup::{self, SetupCommandError, SetupCommitResult, SetupMode, SetupPlan};
use crate::bids::sidecar::find_asl_sidecars;
use crate::error::IntoCommandResult;
use crate::tracing::CommandTrace;
use anyhow::Result as AnyResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Manager;

fn setup_app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf, SetupCommandError> {
    app.path()
        .app_data_dir()
        .map_err(|error| SetupCommandError::Failed {
            message: format!("Could not resolve platform app-data directory: {error}"),
        })
}

/// Repair is available only for the active project. Unlike new-project
/// preflight, accepting a renderer-selected root here would let arbitrary IPC
/// select a different existing source tree for a mutating repair commit.
fn verify_active_repair_root(
    state: &crate::app_state::AppState,
    requested_root: &Path,
) -> AnyResult<()> {
    let active_root = state
        .active_project_root
        .lock()
        .map_err(|_| anyhow::anyhow!("Active project state lock was poisoned"))?
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No active project is available for BIDS setup repair"))?
        .canonicalize()?;
    let requested_root = requested_root.canonicalize()?;
    if active_root != requested_root {
        anyhow::bail!("BIDS setup repair must target the active project root");
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsCheckResult {
    pub is_bids: bool,
    pub has_dataset_description: bool,
    pub dataset_desc_error: Option<String>,
    pub bids_version: Option<String>,
    pub asl_subject_count: u32,
    pub asl_session_count: u32,
    pub total_subject_count: u32,
    pub missing_sidecars: Vec<String>,
    pub missing_aslcontext_count: u32,
    pub has_perf_directory: bool,
    pub is_cross_sectional: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn check_bids_dataset(
    state: tauri::State<'_, crate::app_state::AppState>,
    app: tauri::AppHandle,
    root_path: String,
) -> Result<BidsCheckResult, String> {
    let trace = CommandTrace::new("check_bids_dataset");
    trace.arg("root_path", &root_path);

    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| "Project transition lock was poisoned".to_string())?;
    let root = Path::new(&root_path);
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve platform app-data directory: {error}"))?;
    let ownership = crate::project_ownership::for_setup(&state, root)?;
    setup::recover_root_owned(&app_data, &ownership).into_command_result()?;
    let result = check_bids_dataset_impl(root).into_command_result()?;
    trace.success(&result);
    Ok(result)
}

pub(crate) fn check_bids_dataset_impl(root: &Path) -> AnyResult<BidsCheckResult> {
    // Step 1: Check dataset_description.json
    let desc_path = root.join("dataset_description.json");
    let has_dataset_description = desc_path.exists();
    let mut dataset_desc_error: Option<String> = None;
    let mut bids_version: Option<String> = None;

    if has_dataset_description {
        match fs::read_to_string(&desc_path) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    bids_version = json
                        .get("BIDSVersion")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                Err(e) => {
                    log::warn!("Corrupt dataset_description.json: {}", e);
                    dataset_desc_error = Some(e.to_string());
                }
            },
            Err(e) => {
                log::warn!("Failed to read dataset_description.json: {}", e);
                dataset_desc_error = Some(e.to_string());
            }
        }
    }

    // Step 2: Parse BIDS structure
    let bids_subjects = parse_bids_structure(root)?;
    log::debug!(
        "check_bids_dataset: parsed {} subjects from {}",
        bids_subjects.len(),
        root.display()
    );

    // Step 3: Count ASL subjects/sessions and collect missing sidecars
    let mut asl_subject_count: u32 = 0;
    let mut asl_session_count: u32 = 0;
    let mut missing_sidecars: Vec<String> = Vec::new();
    let mut missing_aslcontext_count: u32 = 0;
    let mut has_perf_directory = false;
    let mut is_longitudinal = false;
    let total_subject_count = bids_subjects.len() as u32;

    for subject in &bids_subjects {
        let mut subject_has_asl = false;
        let explicit_sessions_with_content = subject
            .sessions
            .iter()
            .filter(|s| s.has_explicit_session && (s.has_perf || s.has_anat))
            .count();

        if explicit_sessions_with_content > 1 {
            is_longitudinal = true;
        }

        for session in &subject.sessions {
            if session.has_perf {
                has_perf_directory = true;
            }

            if !session.has_perf {
                continue;
            }

            let mut session_has_missing_sidecars = false;
            let mut session_has_asl_files = false;

            for asl_file in &session.asl_files {
                session_has_asl_files = true;
                let nii_path = Path::new(&asl_file.path);
                let json_path = asl_json_path_for(nii_path);

                if !json_path.exists() {
                    session_has_missing_sidecars = true;
                    continue;
                }

                let ctx_path = crate::bids::sidecar::find_asl_context_for(&json_path);
                if ctx_path.is_none() {
                    missing_aslcontext_count += 1;
                }
            }

            let session_has_valid_asl = session_has_asl_files && !session_has_missing_sidecars;

            if session_has_valid_asl {
                subject_has_asl = true;
                asl_session_count += 1;
            } else if session_has_asl_files {
                let stripped_label = subject
                    .subject_label
                    .strip_prefix("sub-")
                    .unwrap_or(&subject.subject_label);
                missing_sidecars.push(format!("sub-{}_{}", stripped_label, session.session_label));
            }
        }

        if subject_has_asl {
            asl_subject_count += 1;
        }
    }

    let is_bids = asl_subject_count >= 1;
    let is_cross_sectional = !is_longitudinal;

    log::debug!(
        "check_bids_dataset: is_bids={} asl_subjects={} asl_sessions={} missing_sidecars={} missing_aslcontext={}",
        is_bids,
        asl_subject_count,
        asl_session_count,
        missing_sidecars.len(),
        missing_aslcontext_count
    );

    // Step 6: error if not BIDS
    let error = if !is_bids {
        if total_subject_count == 0 {
            Some("No BIDS subjects found".to_string())
        } else {
            Some("No valid ASL BIDS data found".to_string())
        }
    } else {
        None
    };

    Ok(BidsCheckResult {
        is_bids,
        has_dataset_description,
        dataset_desc_error,
        bids_version,
        asl_subject_count,
        asl_session_count,
        total_subject_count,
        missing_sidecars,
        missing_aslcontext_count,
        has_perf_directory,
        is_cross_sectional,
        error,
    })
}

// --- scan_bids_sidecars command ---

#[tauri::command]
pub fn scan_bids_sidecars(root_path: String) -> Result<BidsSidecarScan, String> {
    let trace = CommandTrace::new("scan_bids_sidecars");
    trace.arg("root_path", &root_path);

    let root = Path::new(&root_path);
    let result = scan_bids_sidecars_impl(root).into_command_result()?;
    trace.success(&result);
    Ok(result)
}

fn scan_bids_sidecars_impl(root: &Path) -> AnyResult<BidsSidecarScan> {
    let subjects = parse_bids_structure(root)?;
    log::debug!(
        "scan_bids_sidecars: {} subjects, {} total sessions",
        subjects.len(),
        subjects.iter().map(|s| s.sessions.len()).sum::<usize>()
    );
    let sidecar_paths = find_asl_sidecars(root);
    log::debug!(
        "scan_bids_sidecars: found {} sidecar paths",
        sidecar_paths.len()
    );
    Ok(group_by_fingerprint(&sidecar_paths, &subjects))
}

#[tauri::command]
pub fn preflight_bids_project_mutations(
    state: tauri::State<'_, crate::app_state::AppState>,
    app: tauri::AppHandle,
    root_path: String,
    mode: SetupMode,
    canonical_project_bytes: String,
) -> Result<SetupPlan, SetupCommandError> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| SetupCommandError::Failed {
            message: "Project transition lock was poisoned".into(),
        })?;
    let app_data = setup_app_data(&app)?;
    let ownership = crate::project_ownership::for_setup(&state, Path::new(&root_path))
        .map_err(anyhow::Error::msg)
        .map_err(setup::command_error)?;
    setup::recover_root_owned(&app_data, &ownership).map_err(setup::command_error)?;
    setup::preflight_for_state(
        &state.setup_plans,
        root_path,
        mode,
        Some(canonical_project_bytes),
    )
    .map_err(setup::command_error)
}

#[tauri::command]
pub fn preflight_bids_setup_repair(
    state: tauri::State<'_, crate::app_state::AppState>,
    app: tauri::AppHandle,
    root_path: String,
) -> Result<SetupPlan, SetupCommandError> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| SetupCommandError::Failed {
            message: "Project transition lock was poisoned".into(),
        })?;
    verify_active_repair_root(&state, Path::new(&root_path)).map_err(setup::command_error)?;
    let app_data = setup_app_data(&app)?;
    let ownership = crate::project_ownership::for_setup(&state, Path::new(&root_path))
        .map_err(anyhow::Error::msg)
        .map_err(setup::command_error)?;
    setup::recover_root_owned(&app_data, &ownership).map_err(setup::command_error)?;
    setup::preflight_for_state(&state.setup_plans, root_path, SetupMode::Repair, None)
        .map_err(setup::command_error)
}

#[tauri::command]
pub fn commit_bids_project_mutations(
    state: tauri::State<'_, crate::app_state::AppState>,
    app: tauri::AppHandle,
    plan_id: String,
) -> Result<SetupCommitResult, SetupCommandError> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| SetupCommandError::Failed {
            message: "Project transition lock was poisoned".into(),
        })?;
    let app_data = setup_app_data(&app)?;
    setup::commit_for_app_state(&state, &plan_id, &app_data).map_err(setup::command_error)
}

#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
