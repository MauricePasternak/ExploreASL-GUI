//! Import preparation and launch for an admitted, exact-run reservation.
//!
//! `execution::launch` validates engines and warms shared caches. This workflow
//! prepares import staging and hands the spawned scope to the import supervisor.

use super::output::cleanup_staging_root;
use super::runs::{
    admit_reserved_import_launch, emit_running_snapshot, fail_admitted_preparation, persist,
    set_import_supervisor_handle, set_reserved_import_running,
};
use super::staging::{StagingEntry, compile_staging_plan, execute_compiled_staging_plan};
use super::status::copy_lock_files_paths;
use super::supervisor::{
    finish_cancelled_preparation, handoff_running_checkpoint_failure, supervise_import_process,
};
use super::types::{ImportCommandError, ImportLifecycle};
use super::validation::{normalize_staging_subject_spelling, validate_import_request_inputs};
use super::verification::prepare_generation;
use crate::app::state::AppState;
use crate::error::MutexExt;
use crate::execution::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH};
use crate::execution::launch::{validate_profile, warm_cache};
use crate::execution::profile::ExecutionProfile;
use crate::process::{CancellationToken, ProcessScope};
use crate::project::ownership;
use anyhow::{Context, Result as AnyResult, bail};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::mpsc;
use tauri::{AppHandle, Runtime};

fn build_apptainer_import_args(staging_root: &Path, sif_path: &Path) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--cleanenv".to_string(),
        "--writable-tmpfs".to_string(),
        "--bind".to_string(),
        format!("{}:{CONTAINER_DATA_ROOT}", staging_root.display()),
        sif_path.to_string_lossy().to_string(),
        "/bin/bash".to_string(),
        EXPLOREASL_SCRIPT.to_string(),
        MCR_PATH.to_string(),
        CONTAINER_DATA_ROOT.to_string(),
        "[1,1,0]".to_string(),
        "0".to_string(),
    ]
}

fn require_preparing(state: &AppState, generation: u64) -> AnyResult<()> {
    let run = state.import_state.lock_or_bail("Import state")?;
    if run.ownership_generation != generation
        || run.lifecycle != ImportLifecycle::Preparing
        || !run.launch_in_progress
    {
        bail!("Import preparation cancelled or obsolete");
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_import_pipeline_impl<R: Runtime>(
    app: AppHandle<R>,
    state: &AppState,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    execution_profile: ExecutionProfile,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    run_id: String,
    relocation_plan_id: String,
) -> Result<(), ImportCommandError> {
    let (reservation, compiled_plan, ownership) = {
        let _transition = state
            .project_transition
            .lock_or_bail("Project transition")?;
        ownership::ensure_not_shutting_down(state).map_err(anyhow::Error::msg)?;
        validate_import_request_inputs(&staging_entries, &subject_list)?;
        let entries = normalize_staging_subject_spelling(&staging_entries, &subject_list)?;
        if run_id.trim().is_empty() || relocation_plan_id.trim().is_empty() {
            return Err("run_id and relocation_plan_id must not be empty"
                .to_string()
                .into());
        }
        if !sourcestructure_json.is_object() || !studypar_json.is_object() {
            return Err("Import configs must be JSON objects".to_string().into());
        }
        if subjects_to_preserve
            .as_ref()
            .is_some_and(|subjects| !subjects.is_empty())
        {
            return Err(
                "Retry preservation must be authorized when reserving the import run"
                    .to_string()
                    .into(),
            );
        }
        let ownership = ownership::active(state).map_err(ImportCommandError::from)?;
        let plan = compile_staging_plan(Some(ownership.root().to_path_buf()), &entries)
            .map_err(|r| ImportCommandError::Preflight { issues: r.issues })?;
        let reservation = admit_reserved_import_launch(
            state,
            &run_id,
            &plan.staging_root,
            ownership.root(),
            &subject_list,
            &relocation_plan_id,
            execution_profile.id(),
        )?;
        (reservation, plan, ownership)
    };
    let generation = reservation.generation;
    let token = CancellationToken::default();
    {
        let mut run = state.import_state.lock_or_bail("Import state")?;
        if run.ownership_generation != generation || run.lifecycle != ImportLifecycle::Preparing {
            return Err("Import reservation became obsolete".to_string().into());
        }
        run.cancellation = Some(token.clone());
    }
    let preparation = (|| -> AnyResult<Option<ProcessScope>> {
        require_preparing(state, generation)?;
        let mut command = validate_profile(&execution_profile, token.clone())?;
        cleanup_staging_root(&compiled_plan.staging_root)?;
        execute_compiled_staging_plan(&compiled_plan)?;
        fs::create_dir_all(&compiled_plan.staging_root)?;
        write_config_json(
            &compiled_plan.staging_root.join("sourcestructure.json"),
            &sourcestructure_json,
        )?;
        write_config_json(
            &compiled_plan.staging_root.join("studyPar.json"),
            &studypar_json,
        )?;
        let staging_generation = prepare_generation(&compiled_plan.staging_root, &subject_list)?;
        {
            let mut run = state.import_state.lock_or_bail("Import state")?;
            run.staging_generation = staging_generation;
            persist(&run)?;
        }
        if !reservation.preserved_subjects.is_empty() {
            copy_lock_files_paths(
                ownership.root(),
                &compiled_plan.staging_root,
                &reservation.preserved_subjects,
            )?;
        }
        if let ExecutionProfile::Apptainer { sif_path, .. } = &execution_profile {
            warm_cache(
                command.get_program(),
                Path::new(sif_path.trim()),
                &compiled_plan.staging_root,
                token.clone(),
            )?;
        }
        match &execution_profile {
            ExecutionProfile::Matlab {
                explore_asl_path, ..
            } => {
                command.arg("-batch").arg(format!(
                    "addpath('{}'); ExploreASL('{}', [1,1,0], 0, 0)",
                    escape_matlab_string(explore_asl_path.trim()),
                    escape_matlab_string(&compiled_plan.staging_root.to_string_lossy())
                ));
            }
            ExecutionProfile::Apptainer { sif_path, .. } => {
                command.args(build_apptainer_import_args(
                    &compiled_plan.staging_root,
                    Path::new(sif_path.trim()),
                ));
            }
        };
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if token.is_cancelled() {
            bail!("Import preparation cancelled");
        }
        let scope = ProcessScope::spawn_with_cancellation(command, token.clone())?;
        let cancelling = {
            let run = state.import_state.lock_or_bail("Import state")?;
            run.lifecycle == ImportLifecycle::Cancelling
        };
        if cancelling {
            token.cancel();
        } else {
            if let Err(error) = set_reserved_import_running(state, generation) {
                // Running is the durable execution-commit boundary. If its
                // write fails after spawn, retain the scope under a live
                // Cancelling supervisor. A failed force/settlement attempt
                // must never turn this into an untracked Failed launch.
                handoff_running_checkpoint_failure(
                    app.clone(),
                    state,
                    generation,
                    scope,
                    subject_list.clone(),
                    error,
                )?;
                return Ok(None);
            }
        }
        Ok(Some(scope))
    })();
    let scope = match preparation {
        Ok(Some(scope)) => scope,
        Ok(None) => return Ok(()),
        Err(error) => {
            let mut run = state.import_state.lock_or_bail("Import state")?;
            run.launch_in_progress = false;
            let cancelling = run.lifecycle == ImportLifecycle::Cancelling;
            run.cancellation = None;
            drop(run);
            if cancelling {
                return finish_cancelled_preparation(state, generation)
                    .map(|_| ())
                    .map_err(ImportCommandError::from);
            }
            fail_admitted_preparation(state, generation, format!("{error:#}"))?;
            return Err(error.into());
        }
    };
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor =
        supervise_import_process(app.clone(), generation, scope, subject_list, start_receiver);
    if let Err((error, handle)) = set_import_supervisor_handle(state, generation, supervisor) {
        drop(start_sender);
        let _ = handle.join();
        return Err(error.into());
    }
    if let Ok(mut run) = state.import_state.lock()
        && run.ownership_generation == generation
    {
        run.launch_in_progress = false;
    }
    let _ = emit_running_snapshot(&app, state, generation);
    start_sender.send(()).map_err(|_| {
        ImportCommandError::from("Import supervisor stopped before observation".to_string())
    })?;
    Ok(())
}

fn write_config_json(path: &Path, value: &Value) -> AnyResult<()> {
    let contents = serde_json::to_string_pretty(value)
        .with_context(|| format!("Failed to serialize {}", path.display()))?;
    fs::write(path, contents).with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}
