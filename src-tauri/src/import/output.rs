use super::relocation::{
    RelocationOutcome, RelocationSubjectStatus, bind_plan, create_plan, relocate,
};
use super::staging::{self, portable_key};
use super::state::validate_terminal_import_ownership;
use super::types::ImportState;
use super::validation::validate_staging_root;
use crate::app_state::AppState;
use anyhow::{Context, Result as AnyResult, anyhow, bail};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn cleanup_staging_root(staging_root: &Path) -> AnyResult<()> {
    if staging_root.exists() {
        fs::remove_dir_all(staging_root).with_context(|| {
            format!(
                "Failed to remove staging directory {}",
                staging_root.display()
            )
        })?;
    }

    Ok(())
}

pub fn validate_subject_components(subjects: &[String]) -> Result<(), String> {
    for subject in subjects {
        if subject.is_empty() || subject == "." || subject == ".." {
            return Err(format!("Invalid subject path component: {subject:?}"));
        }
        if subject.contains('/') || subject.contains('\\') {
            return Err(format!("Invalid subject path component: {subject:?}"));
        }

        let mut components = Path::new(subject).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => {}
            _ => return Err(format!("Invalid subject path component: {subject:?}")),
        }
    }

    Ok(())
}

pub(super) fn validate_owned_subjects(
    owned_subjects: &[String],
    subjects: &[String],
) -> Result<(), String> {
    if owned_subjects.is_empty() {
        return Err("Import ownership has no subjects".to_string());
    }
    validate_subject_components(owned_subjects)?;
    validate_subject_components(subjects)?;

    for subject in subjects {
        if owned_subject_spelling(owned_subjects, subject).is_none() {
            return Err(format!(
                "Subject is not owned by the active import: {subject}"
            ));
        }
    }

    Ok(())
}

pub(super) fn owned_subject_spelling<'a>(
    owned_subjects: &'a [String],
    subject: &str,
) -> Option<&'a str> {
    let key = portable_key(subject);
    owned_subjects
        .iter()
        .find(|owned| portable_key(owned) == key)
        .map(String::as_str)
}

pub(super) fn contains_portable_subject(subjects: &[String], subject: &str) -> bool {
    owned_subject_spelling(subjects, subject).is_some()
}

pub(super) fn validate_preserved_subjects_are_disjoint(
    subject_list: &[String],
    preserved_subjects: &[String],
) -> Result<(), String> {
    let run_subject_keys = subject_list
        .iter()
        .map(|subject| portable_key(subject))
        .collect::<std::collections::HashSet<_>>();
    if preserved_subjects
        .iter()
        .any(|subject| run_subject_keys.contains(&portable_key(subject)))
    {
        return Err("Retry preserve subjects overlap subjects selected for import".to_string());
    }

    Ok(())
}

pub(super) fn with_owned_import_roots<T>(
    state: &AppState,
    operation: impl FnOnce(&mut ImportState, &Path, &Path) -> AnyResult<T>,
) -> AnyResult<T> {
    let active_project_root_guard = state
        .active_project_root
        .lock()
        .map_err(|_| anyhow!("Active project state lock was poisoned"))?;
    let active_project_root = active_project_root_guard
        .as_ref()
        .ok_or_else(|| anyhow!("No active project root"))?;
    let active_project_root = fs::canonicalize(active_project_root).with_context(|| {
        format!(
            "Failed to canonicalize active project root {}",
            active_project_root.display()
        )
    })?;

    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| anyhow!("Import state lock was poisoned"))?;
    let expected_staging_root = active_project_root.join(staging::STAGING_DIRECTORY);
    validate_terminal_import_ownership(
        &import_state,
        &active_project_root,
        &expected_staging_root,
    )?;

    let result = operation(
        &mut import_state,
        &active_project_root,
        &expected_staging_root,
    );
    drop(import_state);
    drop(active_project_root_guard);
    result
}

pub(super) fn move_import_output_for_state(
    state: &AppState,
    debug_mode: bool,
    cleanup_staging: bool,
) -> AnyResult<RelocationOutcome> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| anyhow!("Project transition lock was poisoned"))?;
    with_owned_import_roots(state, |import_state, project_root, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.succeeded_subjects)
            .map_err(anyhow::Error::msg)?;
        let plan_id = import_state
            .relocation_plan_id
            .as_ref()
            .ok_or_else(|| anyhow!("Import ownership has no confirmed relocation plan"))?;
        let plan = state
            .relocation_plans
            .lock()
            .map_err(|_| anyhow!("Relocation plan state lock was poisoned"))?
            .get(plan_id)
            .cloned()
            .ok_or_else(|| anyhow!("Confirmed relocation plan is unavailable"))?;
        let outcome = relocate(
            &plan,
            import_state.ownership_generation,
            staging_root,
            &import_state.succeeded_subjects,
            cleanup_staging,
            debug_mode,
        )
        .map_err(anyhow::Error::msg)?;

        if debug_mode
            && cleanup_staging
            && !outcome.subjects.is_empty()
            && outcome
                .subjects
                .iter()
                .all(|subject| matches!(subject.status, RelocationSubjectStatus::Committed))
        {
            // Debug runs retain staging. Copy configs only after every subject
            // has durably committed; any copy failure remains visible to the
            // frontend and leaves terminal ownership/staging available.
            copy_import_configs(staging_root, project_root)?;
        }

        if outcome.staging_cleanup_complete {
            *import_state = ImportState::default();
        }
        Ok(outcome)
    })
}

pub fn move_import_output_paths(
    staging_root: &Path,
    project_root: &Path,
    succeeded_subjects: &[String],
    debug_mode: bool,
    cleanup_staging: bool,
) -> AnyResult<()> {
    validate_staging_root(staging_root).map_err(anyhow::Error::msg)?;
    validate_project_root_for_staging(staging_root, project_root).map_err(anyhow::Error::msg)?;
    validate_subject_components(succeeded_subjects).map_err(anyhow::Error::msg)?;

    let mut plan = create_plan(
        project_root,
        succeeded_subjects,
        "direct-test-plan".to_string(),
    )
    .map_err(anyhow::Error::msg)?;
    bind_plan(&mut plan, project_root, succeeded_subjects, 0).map_err(anyhow::Error::msg)?;
    let outcome = relocate(
        &plan,
        0,
        staging_root,
        succeeded_subjects,
        cleanup_staging,
        debug_mode,
    )
    .map_err(anyhow::Error::msg)?;
    if debug_mode
        && cleanup_staging
        && !outcome.subjects.is_empty()
        && outcome
            .subjects
            .iter()
            .all(|subject| matches!(subject.status, RelocationSubjectStatus::Committed))
    {
        copy_import_configs(staging_root, project_root)?;
    }
    if !outcome
        .subjects
        .iter()
        .all(|subject| matches!(subject.status, RelocationSubjectStatus::Committed))
    {
        bail!(
            "One or more subject relocations failed: {:?}",
            outcome.subjects
        );
    }

    Ok(())
}

pub fn validate_project_root_for_staging(
    staging_root: &Path,
    project_root: &Path,
) -> Result<(), String> {
    validate_staging_root(staging_root)?;

    let normalized_staging_root =
        normalize_path_for_validation(staging_root).map_err(|error| format!("{error:#}"))?;
    let normalized_project_root =
        normalize_path_for_validation(project_root).map_err(|error| format!("{error:#}"))?;
    let staging_parent = normalized_staging_root.parent().ok_or_else(|| {
        format!(
            "staging_root must have a parent directory: {}",
            staging_root.display()
        )
    })?;

    if staging_parent != normalized_project_root {
        return Err(format!(
            "project_root must be the parent of staging_root: project_root={}, staging_root={}",
            project_root.display(),
            staging_root.display()
        ));
    }

    Ok(())
}

pub(super) fn normalize_path_for_validation(path: &Path) -> AnyResult<PathBuf> {
    if path.exists() {
        return fs::canonicalize(path)
            .with_context(|| format!("Failed to canonicalize {}", path.display()));
    }

    let (parent, file_name) = validation_path_components(path).map_err(anyhow::Error::msg)?;
    let parent = fs::canonicalize(parent)
        .with_context(|| format!("Failed to canonicalize parent {}", parent.display()))?;

    Ok(parent.join(file_name))
}

pub(super) fn validation_path_components(path: &Path) -> Result<(&Path, &std::ffi::OsStr), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Path must have an existing parent for validation: {}",
            path.display()
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        format!(
            "Path must have a final component for validation: {}",
            path.display()
        )
    })?;

    Ok((parent, file_name))
}

pub(super) fn copy_import_configs(staging_root: &Path, project_root: &Path) -> AnyResult<()> {
    let destination_dir = project_root.join("derivatives").join("ExploreASL_GUI");
    fs::create_dir_all(&destination_dir).with_context(|| {
        format!(
            "Failed to create GUI derivatives directory {}",
            destination_dir.display()
        )
    })?;

    for file_name in ["sourcestructure.json", "studyPar.json"] {
        let source = staging_root.join(file_name);
        if source.exists() {
            fs::copy(&source, destination_dir.join(file_name))
                .with_context(|| format!("Failed to copy import config {}", source.display()))?;
        }
    }

    Ok(())
}
