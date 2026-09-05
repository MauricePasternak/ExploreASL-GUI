use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH, ensure_mcr_cache};
use crate::execution_profile::ExecutionProfile;
use crate::import_parser::*;
use crate::process_control::{
    force_kill_process, send_termination_signal, validate_process_id, wait_for_process_exit,
};
use crate::processing::ProcessState;
pub use crate::staging::StagingEntry;
use crate::staging::{
    StagingPreflightResult, StagingValidationIssue, compile_staging_plan,
    execute_compiled_staging_plan, portable_key, preflight_staging_plan_for_state,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub(crate) const RESERVED_IMPORT_PID: u32 = 0;
const IMPORT_STATUS_FILES: [&str; 3] = [
    "010_DCM2NII.status",
    "020_NII2BIDS.status",
    "999_ready.status",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportLifecycle {
    Idle,
    Preparing,
    Running,
    Terminal,
}

#[derive(Debug)]
pub struct ImportState {
    pub lifecycle: ImportLifecycle,
    pub ownership_generation: u64,
    /// Frontend-generated correlation metadata. Native ownership remains the
    /// authoritative generation; this value only prevents queued WebView
    /// events from being accepted by a later frontend request.
    pub run_request_id: String,
    pub child_pid: Option<u32>,
    pub supervisor_handle: Option<thread::JoinHandle<()>>,
    pub termination_requested_for: Option<u32>,
    pub staging_root: PathBuf,
    pub project_root: PathBuf,
    pub failed_subjects: Vec<String>,
    pub succeeded_subjects: Vec<String>,
    pub subject_list: Vec<String>,
    pub relocation_plan_id: Option<String>,
}

impl ImportState {
    pub fn new(staging_root: PathBuf, project_root: PathBuf, subject_list: Vec<String>) -> Self {
        Self {
            lifecycle: ImportLifecycle::Terminal,
            ownership_generation: 0,
            run_request_id: String::new(),
            child_pid: None,
            supervisor_handle: None,
            termination_requested_for: None,
            staging_root,
            project_root,
            failed_subjects: Vec::new(),
            succeeded_subjects: Vec::new(),
            subject_list,
            relocation_plan_id: None,
        }
    }
}

impl Default for ImportState {
    fn default() -> Self {
        Self {
            lifecycle: ImportLifecycle::Idle,
            ownership_generation: 0,
            run_request_id: String::new(),
            child_pid: None,
            supervisor_handle: None,
            termination_requested_for: None,
            staging_root: PathBuf::new(),
            project_root: PathBuf::new(),
            failed_subjects: Vec::new(),
            succeeded_subjects: Vec::new(),
            subject_list: Vec::new(),
            relocation_plan_id: None,
        }
    }
}

pub struct AppState {
    pub import_state: Mutex<ImportState>,
    pub import_generation: AtomicU64,
    pub processing_state: Mutex<ProcessState>,
    /// Serializes active-project replacement with processing launch/shutdown.
    /// A launch holds this through its run-scoped filesystem mutations and spawn
    /// registration, so a direct IPC caller cannot mutate an old root after a
    /// project transition has started.
    pub project_transition: Mutex<()>,
    pub active_project_root: Mutex<Option<PathBuf>>,
    pub active_data: Mutex<Option<crate::visualization::ActiveData>>,
    pub relocation_plans: Mutex<BTreeMap<String, crate::import_relocation::RelocationPlan>>,
    pub relocation_plan_sequence: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            import_state: Mutex::new(ImportState::default()),
            import_generation: AtomicU64::new(0),
            processing_state: Mutex::new(ProcessState::default()),
            project_transition: Mutex::new(()),
            active_project_root: Mutex::new(None),
            active_data: Mutex::new(None),
            relocation_plans: Mutex::new(BTreeMap::new()),
            relocation_plan_sequence: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportCommandError {
    Preflight { issues: Vec<StagingValidationIssue> },
    Operational { message: String },
}

impl From<String> for ImportCommandError {
    fn from(message: String) -> Self {
        Self::Operational { message }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSubjectStatus {
    pub subject: String,
    pub status: ImportSubjectStatusKind,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportSubjectStatusKind {
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPrepareComplete {
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatlabExitError {
    pub exit_code: i32,
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRawEventPayload {
    pub line: String,
    pub run_request_id: String,
    pub ownership_generation: u64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStructuredEventPayload {
    #[serde(flatten)]
    pub event: ImportStructuredEvent,
    pub run_request_id: String,
    pub ownership_generation: u64,
}

pub fn cleanup_staging_root(staging_root: &Path) -> Result<(), String> {
    if staging_root.exists() {
        fs::remove_dir_all(staging_root).map_err(|e| {
            format!(
                "Failed to remove staging directory {}: {}",
                staging_root.display(),
                e
            )
        })?;
    }

    Ok(())
}

fn import_lock_dir(root: &Path, subject: &str) -> PathBuf {
    root.join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Import")
        .join(subject)
        .join("xASL_module_Import")
}

/// Relocation owns lock paths natively; callers never supply these roots over IPC.
pub(crate) fn import_lock_dir_for_relocation(root: &Path, subject: &str) -> PathBuf {
    import_lock_dir(root, subject)
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

pub fn clean_import_status_paths(staging_root: &Path, subjects: &[String]) -> Result<(), String> {
    validate_subject_components(subjects)?;

    for subject in subjects {
        let lock_dir = import_lock_dir(staging_root, subject);
        for file_name in IMPORT_STATUS_FILES {
            match fs::remove_file(lock_dir.join(file_name)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Failed to remove import status file {} for subject {}: {}",
                        file_name, subject, error
                    ));
                }
            }
        }
    }

    Ok(())
}

fn validate_owned_subjects(owned_subjects: &[String], subjects: &[String]) -> Result<(), String> {
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

fn owned_subject_spelling<'a>(owned_subjects: &'a [String], subject: &str) -> Option<&'a str> {
    let key = portable_key(subject);
    owned_subjects
        .iter()
        .find(|owned| portable_key(owned) == key)
        .map(String::as_str)
}

fn contains_portable_subject(subjects: &[String], subject: &str) -> bool {
    owned_subject_spelling(subjects, subject).is_some()
}

fn validate_preserved_subjects_are_disjoint(
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

fn with_owned_import_roots<T>(
    state: &AppState,
    operation: impl FnOnce(&mut ImportState, &Path, &Path) -> Result<T, String>,
) -> Result<T, String> {
    let active_project_root_guard = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned".to_string())?;
    let active_project_root = active_project_root_guard
        .as_ref()
        .ok_or_else(|| "No active project root".to_string())?;
    let active_project_root = fs::canonicalize(active_project_root).map_err(|error| {
        format!(
            "Failed to canonicalize active project root {}: {error}",
            active_project_root.display()
        )
    })?;

    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    if import_state.project_root.as_os_str().is_empty()
        || import_state.staging_root.as_os_str().is_empty()
    {
        return Err("No active import ownership".to_string());
    }
    if import_state.lifecycle != ImportLifecycle::Terminal {
        return Err("Import process has not reached terminal state".to_string());
    }

    let import_project_root = fs::canonicalize(&import_state.project_root).map_err(|error| {
        format!(
            "Failed to canonicalize import project root {}: {error}",
            import_state.project_root.display()
        )
    })?;
    if import_project_root != active_project_root {
        return Err("Import ownership does not match the active project root".to_string());
    }

    let expected_staging_root = active_project_root.join(crate::staging::STAGING_DIRECTORY);
    if import_state.staging_root != expected_staging_root {
        return Err("Import ownership has a malformed staging root".to_string());
    }
    if let Ok(metadata) = fs::symlink_metadata(&expected_staging_root)
        && metadata.file_type().is_symlink()
    {
        return Err("Import ownership staging root must not be a symlink".to_string());
    }
    if expected_staging_root.exists()
        && fs::canonicalize(&expected_staging_root).map_err(|error| {
            format!(
                "Failed to canonicalize import staging root {}: {error}",
                expected_staging_root.display()
            )
        })? != expected_staging_root
    {
        return Err("Import ownership staging root is not canonical".to_string());
    }

    let result = operation(
        &mut import_state,
        &active_project_root,
        &expected_staging_root,
    );
    drop(import_state);
    drop(active_project_root_guard);
    result
}

fn clean_import_status_for_state(state: &AppState) -> Result<(), String> {
    with_owned_import_roots(state, |import_state, _, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.failed_subjects)?;
        clean_import_status_paths(staging_root, &import_state.failed_subjects)
    })
}

fn move_import_output_for_state(
    state: &AppState,
    debug_mode: bool,
    cleanup_staging: bool,
) -> Result<crate::import_relocation::RelocationOutcome, String> {
    let _transition = state
        .project_transition
        .lock()
        .map_err(|_| "Project transition lock was poisoned".to_string())?;
    with_owned_import_roots(state, |import_state, project_root, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.succeeded_subjects)?;
        let plan_id = import_state
            .relocation_plan_id
            .as_ref()
            .ok_or_else(|| "Import ownership has no confirmed relocation plan".to_string())?;
        let plan = state
            .relocation_plans
            .lock()
            .map_err(|_| "Relocation plan state lock was poisoned".to_string())?
            .get(plan_id)
            .cloned()
            .ok_or_else(|| "Confirmed relocation plan is unavailable".to_string())?;
        let outcome = crate::import_relocation::relocate(
            &plan,
            import_state.ownership_generation,
            staging_root,
            &import_state.succeeded_subjects,
            cleanup_staging,
            debug_mode,
        )?;

        if debug_mode
            && cleanup_staging
            && !outcome.subjects.is_empty()
            && outcome.subjects.iter().all(|subject| {
                matches!(
                    subject.status,
                    crate::import_relocation::RelocationSubjectStatus::Committed
                )
            })
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

fn copy_lock_files_for_state(state: &AppState, subjects: &[String]) -> Result<(), String> {
    with_owned_import_roots(state, |import_state, project_root, staging_root| {
        validate_owned_subjects(&import_state.subject_list, &import_state.succeeded_subjects)?;
        validate_owned_subjects(&import_state.succeeded_subjects, subjects)?;
        copy_lock_files_paths(project_root, staging_root, subjects)
    })
}

pub fn copy_lock_files_paths(
    project_root: &Path,
    staging_root: &Path,
    subjects: &[String],
) -> Result<(), String> {
    validate_staging_root(staging_root)?;
    validate_project_root_for_staging(staging_root, project_root)?;
    validate_subject_components(subjects)?;

    for subject in subjects {
        let source_dir = import_lock_dir(project_root, subject);
        let destination_dir = import_lock_dir(staging_root, subject);
        fs::create_dir_all(&destination_dir).map_err(|error| {
            format!(
                "Failed to create staging lock directory {}: {}",
                destination_dir.display(),
                error
            )
        })?;

        for file_name in IMPORT_STATUS_FILES {
            let source = source_dir.join(file_name);
            let destination = destination_dir.join(file_name);
            fs::copy(&source, &destination).map_err(|error| {
                format!(
                    "Failed to copy lock file {} to {}: {}",
                    source.display(),
                    destination.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

pub fn move_import_output_paths(
    staging_root: &Path,
    project_root: &Path,
    succeeded_subjects: &[String],
    debug_mode: bool,
    cleanup_staging: bool,
) -> Result<(), String> {
    validate_staging_root(staging_root)?;
    validate_project_root_for_staging(staging_root, project_root)?;
    validate_subject_components(succeeded_subjects)?;

    let mut plan = crate::import_relocation::create_plan(
        project_root,
        succeeded_subjects,
        "direct-test-plan".to_string(),
    )?;
    crate::import_relocation::bind_plan(&mut plan, project_root, succeeded_subjects, 0)?;
    let outcome = crate::import_relocation::relocate(
        &plan,
        0,
        staging_root,
        succeeded_subjects,
        cleanup_staging,
        debug_mode,
    )?;
    if debug_mode
        && cleanup_staging
        && !outcome.subjects.is_empty()
        && outcome.subjects.iter().all(|subject| {
            matches!(
                subject.status,
                crate::import_relocation::RelocationSubjectStatus::Committed
            )
        })
    {
        copy_import_configs(staging_root, project_root)?;
    }
    if !outcome.subjects.iter().all(|subject| {
        matches!(
            subject.status,
            crate::import_relocation::RelocationSubjectStatus::Committed
        )
    }) {
        return Err(format!(
            "One or more subject relocations failed: {:?}",
            outcome.subjects
        ));
    }

    Ok(())
}

pub fn validate_project_root_for_staging(
    staging_root: &Path,
    project_root: &Path,
) -> Result<(), String> {
    validate_staging_root(staging_root)?;

    let normalized_staging_root = normalize_path_for_validation(staging_root)?;
    let normalized_project_root = normalize_path_for_validation(project_root)?;
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

fn normalize_path_for_validation(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path)
            .map_err(|error| format!("Failed to canonicalize {}: {}", path.display(), error));
    }

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
    let parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Failed to canonicalize parent {}: {}",
            parent.display(),
            error
        )
    })?;

    Ok(parent.join(file_name))
}

fn copy_import_configs(staging_root: &Path, project_root: &Path) -> Result<(), String> {
    let destination_dir = project_root.join("derivatives").join("ExploreASL_GUI");
    fs::create_dir_all(&destination_dir).map_err(|error| {
        format!(
            "Failed to create GUI derivatives directory {}: {}",
            destination_dir.display(),
            error
        )
    })?;

    for file_name in ["sourcestructure.json", "studyPar.json"] {
        let source = staging_root.join(file_name);
        if source.exists() {
            fs::copy(&source, destination_dir.join(file_name)).map_err(|error| {
                format!(
                    "Failed to copy import config {}: {}",
                    source.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

pub fn rollback_preparation_failure(staging_root: &Path, error: String) -> String {
    let _ = cleanup_staging_root(staging_root);
    error
}

pub fn validate_staging_root(staging_root: &Path) -> Result<(), String> {
    if staging_root.file_name().and_then(|name| name.to_str()) != Some(".easl_staging") {
        return Err(format!(
            "staging_root must end with .easl_staging: {}",
            staging_root.display()
        ));
    }

    Ok(())
}

pub fn validate_import_not_running(state: &ImportState) -> Result<(), String> {
    match state.lifecycle {
        ImportLifecycle::Preparing => Err("An import is already preparing".to_string()),
        ImportLifecycle::Running => Err(match state.child_pid {
            Some(pid) => format!("An import is already running with process PID {pid}"),
            None => "An import is already running".to_string(),
        }),
        ImportLifecycle::Idle | ImportLifecycle::Terminal => Ok(()),
    }
}

pub(crate) fn mark_import_terminal_if_matches(
    state: &mut ImportState,
    generation: u64,
    child_pid: u32,
) -> bool {
    if state.ownership_generation == generation
        && state.lifecycle == ImportLifecycle::Running
        && state.child_pid == Some(child_pid)
    {
        state.child_pid = None;
        state.lifecycle = ImportLifecycle::Terminal;
        true
    } else {
        false
    }
}

pub fn validate_non_empty_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    if staging_entries.is_empty() {
        return Err("staging_entries must contain at least one staging entry".to_string());
    }
    if subject_list.is_empty() {
        return Err("subject_list must contain at least one subject".to_string());
    }

    Ok(())
}

pub fn validate_subject_scope(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    let mut staging_subjects = BTreeMap::new();
    for entry in staging_entries {
        staging_subjects
            .entry(portable_key(&entry.subject))
            .or_insert_with(|| entry.subject.clone());
    }

    let mut declared_subjects = BTreeMap::new();
    for subject in subject_list {
        declared_subjects
            .entry(portable_key(subject))
            .or_insert_with(|| subject.clone());
    }

    let undeclared = staging_subjects
        .iter()
        .filter(|(key, _)| !declared_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();
    let missing = declared_subjects
        .iter()
        .filter(|(key, _)| !staging_subjects.contains_key(*key))
        .map(|(_, subject)| subject.as_str())
        .collect::<Vec<_>>();

    if undeclared.is_empty() && missing.is_empty() {
        return Ok(());
    }

    let mut details = Vec::new();
    if !undeclared.is_empty() {
        details.push(format!(
            "undeclared staging subjects: {}",
            undeclared.join(", ")
        ));
    }
    if !missing.is_empty() {
        details.push(format!(
            "declared subjects without staging entries: {}",
            missing.join(", ")
        ));
    }

    Err(format!(
        "Import subject scope mismatch: {}",
        details.join("; ")
    ))
}

pub fn validate_import_request_inputs(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<(), String> {
    validate_non_empty_inputs(staging_entries, subject_list)?;
    validate_subject_scope(staging_entries, subject_list)
}

fn normalize_staging_subject_spelling(
    staging_entries: &[StagingEntry],
    subject_list: &[String],
) -> Result<Vec<StagingEntry>, String> {
    let mut owned_by_key = BTreeMap::new();
    for subject in subject_list {
        let key = portable_key(subject);
        if owned_by_key.insert(key, subject.as_str()).is_some() {
            return Err("Import subject list contains portable-equivalent duplicates".to_string());
        }
    }

    staging_entries
        .iter()
        .map(|entry| {
            let canonical = owned_by_key
                .get(&portable_key(&entry.subject))
                .ok_or_else(|| {
                    format!(
                        "Staging entry subject is not in the declared import scope: {}",
                        entry.subject
                    )
                })?;
            let mut normalized = entry.clone();
            normalized.subject = (*canonical).to_string();
            Ok(normalized)
        })
        .collect()
}

pub fn validate_matlab_executable(matlab_path: &str) -> Result<String, String> {
    let matlab_path = validate_string_input("matlab_path", matlab_path)?;

    if is_path_like(&matlab_path) {
        let path = Path::new(&matlab_path);
        validate_executable_file(path)?;
        return Ok(matlab_path);
    }

    let path_var = env::var_os("PATH")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_default();
    find_executable_on_path(&matlab_path, &path_var)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| format!("MATLAB executable not found on PATH: {}", matlab_path))
}

fn is_path_like(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute() || value.contains('/') || value.contains('\\')
}

fn validate_executable_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("MATLAB executable not found: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("MATLAB path is not a file: {}", path.display()));
    }
    if !is_executable_file(path) {
        return Err(format!(
            "MATLAB executable is not executable: {}",
            path.display()
        ));
    }

    Ok(())
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(not(any(unix, windows)))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

pub fn find_executable_on_path(command: &str, path_var: &str) -> Option<PathBuf> {
    if command.trim().is_empty() || is_path_like(command) {
        return None;
    }

    for dir in env::split_paths(path_var) {
        for candidate in executable_candidates(&dir, command) {
            if candidate.is_file() && is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(windows)]
fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    let command_path = Path::new(command);
    if command_path.extension().is_some() {
        return vec![dir.join(command)];
    }

    let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|ext| !ext.is_empty())
        .map(|ext| dir.join(format!("{command}{ext}")))
        .chain(std::iter::once(dir.join(command)))
        .collect()
}

#[cfg(not(windows))]
fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

#[cfg(test)]
fn reserve_import_state(
    state: &AppState,
    staging_root: PathBuf,
    project_root: PathBuf,
    run_request_id: String,
    subject_list: Vec<String>,
) -> Result<u64, String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    validate_import_not_running(&import_state)?;
    *import_state = ImportState::new(staging_root, project_root, subject_list);
    import_state.run_request_id = run_request_id;
    let generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    import_state.ownership_generation = generation;
    import_state.lifecycle = ImportLifecycle::Preparing;
    import_state.child_pid = Some(RESERVED_IMPORT_PID);

    Ok(generation)
}

#[derive(Debug, PartialEq, Eq)]
struct ImportReservation {
    generation: u64,
    preserved_subjects: Vec<String>,
}

fn validate_terminal_import_ownership(
    import_state: &ImportState,
    active_project_root: &Path,
    expected_staging_root: &Path,
) -> Result<(), String> {
    if import_state.project_root.as_os_str().is_empty()
        || import_state.staging_root.as_os_str().is_empty()
    {
        return Err("No active import ownership".to_string());
    }
    if import_state.lifecycle != ImportLifecycle::Terminal {
        return Err("Import process has not reached terminal state".to_string());
    }
    if fs::canonicalize(&import_state.project_root).map_err(|error| {
        format!(
            "Failed to canonicalize import project root {}: {error}",
            import_state.project_root.display()
        )
    })? != active_project_root
    {
        return Err("Import ownership does not match the active project root".to_string());
    }
    if import_state.staging_root != expected_staging_root {
        return Err("Import ownership has a malformed staging root".to_string());
    }
    if let Ok(metadata) = fs::symlink_metadata(expected_staging_root)
        && metadata.file_type().is_symlink()
    {
        return Err("Import ownership staging root must not be a symlink".to_string());
    }
    if expected_staging_root.exists()
        && fs::canonicalize(expected_staging_root).map_err(|error| {
            format!(
                "Failed to canonicalize import staging root {}: {error}",
                expected_staging_root.display()
            )
        })? != expected_staging_root
    {
        return Err("Import ownership staging root is not canonical".to_string());
    }
    Ok(())
}

fn reserve_import_state_for_run(
    state: &AppState,
    staging_root: PathBuf,
    project_root: PathBuf,
    run_request_id: String,
    subject_list: Vec<String>,
    subjects_to_preserve: Option<Vec<String>>,
    relocation_plan_id: String,
) -> Result<ImportReservation, String> {
    // Hold active-project and import ownership locks through authorization and
    // replacement. The project transition uses the active-project lock, while
    // the supervisor uses import ownership, so neither can interleave here.
    let active_project_root_guard = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned".to_string())?;
    let active_project_root = active_project_root_guard
        .as_ref()
        .ok_or_else(|| "No active project root".to_string())?;
    let active_project_root = fs::canonicalize(active_project_root).map_err(|error| {
        format!(
            "Failed to canonicalize active project root {}: {error}",
            active_project_root.display()
        )
    })?;
    let expected_staging_root = active_project_root.join(crate::staging::STAGING_DIRECTORY);
    if project_root != active_project_root || staging_root != expected_staging_root {
        return Err("Compiled staging plan does not match the active project root".to_string());
    }

    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    validate_import_not_running(&import_state)?;

    let requested_preserved_subjects = subjects_to_preserve.unwrap_or_default();
    let mut preserved_subjects = requested_preserved_subjects.clone();
    if !preserved_subjects.is_empty() {
        validate_subject_components(&preserved_subjects)?;
        validate_preserved_subjects_are_disjoint(&subject_list, &preserved_subjects)?;
        validate_terminal_import_ownership(
            &import_state,
            &active_project_root,
            &expected_staging_root,
        )?;
        validate_owned_subjects(&import_state.subject_list, &preserved_subjects)?;
        if preserved_subjects
            .iter()
            .any(|subject| contains_portable_subject(&import_state.failed_subjects, subject))
        {
            return Err("Retry preserve subjects include a failed subject".to_string());
        }
        validate_owned_subjects(&import_state.succeeded_subjects, &preserved_subjects)?;
        preserved_subjects = requested_preserved_subjects
            .iter()
            .map(|subject| {
                owned_subject_spelling(&import_state.subject_list, subject)
                    .expect("validated preserved subject")
                    .to_string()
            })
            .collect();
    }

    *import_state = ImportState::new(staging_root, project_root, subject_list);
    import_state.relocation_plan_id = Some(relocation_plan_id);
    import_state.run_request_id = run_request_id;
    let generation = state.import_generation.fetch_add(1, Ordering::Relaxed) + 1;
    import_state.ownership_generation = generation;
    import_state.lifecycle = ImportLifecycle::Preparing;
    import_state.child_pid = Some(RESERVED_IMPORT_PID);

    Ok(ImportReservation {
        generation,
        preserved_subjects,
    })
}

fn validate_relocation_plan_for_run(
    state: &AppState,
    plan_id: &str,
    project_root: &Path,
    subjects: &[String],
) -> Result<(), String> {
    let plans = state
        .relocation_plans
        .lock()
        .map_err(|_| "Relocation plan state lock was poisoned".to_string())?;
    let plan = plans
        .get(plan_id)
        .ok_or_else(|| "Confirmed relocation plan is unavailable".to_string())?;
    crate::import_relocation::validate_plan_scope(plan, project_root, subjects)
}

fn bind_relocation_plan_for_run(
    state: &AppState,
    plan_id: &str,
    project_root: &Path,
    subjects: &[String],
    generation: u64,
) -> Result<(), String> {
    let mut plans = state
        .relocation_plans
        .lock()
        .map_err(|_| "Relocation plan state lock was poisoned".to_string())?;
    let plan = plans
        .get_mut(plan_id)
        .ok_or_else(|| "Confirmed relocation plan is unavailable".to_string())?;
    crate::import_relocation::bind_plan(plan, project_root, subjects, generation)
}

fn clear_reserved_import(state: &AppState, generation: u64) {
    if let Ok(mut import_state) = state.import_state.lock()
        && import_state.ownership_generation == generation
        && import_state.lifecycle == ImportLifecycle::Preparing
    {
        *import_state = ImportState::default();
    }
}

fn rollback_reserved_preparation_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: String,
) -> String {
    clear_reserved_import(state, generation);
    rollback_preparation_failure(staging_root, error)
}

fn rollback_process_spawn_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    process_name: &str,
    executable_path: &str,
    error: std::io::Error,
) -> ImportCommandError {
    let message = if error.kind() == std::io::ErrorKind::NotFound {
        format!("{process_name} executable not found: {executable_path}")
    } else {
        format!("Failed to spawn {process_name} import process: {error}")
    };
    ImportCommandError::from(rollback_reserved_preparation_failure(
        state,
        generation,
        staging_root,
        message,
    ))
}

fn cleanup_after_prepare_event_failure(
    state: &AppState,
    generation: u64,
    staging_root: &Path,
    error: String,
) -> String {
    if clear_matching_import(state, generation) {
        rollback_preparation_failure(staging_root, error)
    } else {
        error
    }
}

fn set_reserved_import_pid(
    state: &AppState,
    generation: u64,
    child_pid: u32,
) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Preparing
        || import_state.child_pid != Some(RESERVED_IMPORT_PID)
    {
        return Err(
            "Import state changed before process tracking could be established".to_string(),
        );
    }

    import_state.child_pid = Some(child_pid);
    import_state.lifecycle = ImportLifecycle::Running;
    Ok(())
}

fn clear_matching_import(state: &AppState, generation: u64) -> bool {
    if let Ok(mut import_state) = state.import_state.lock()
        && import_state.ownership_generation == generation
    {
        *import_state = ImportState::default();
        return true;
    }
    false
}

fn emit_prepare_complete_for_running_import<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    generation: u64,
    child_pid: u32,
) -> Result<bool, String> {
    let import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Running
        || import_state.child_pid != Some(child_pid)
    {
        return Ok(false);
    }

    // Keep ownership locked through emission so a replacement reservation cannot
    // receive this generation's readiness notification.
    app.emit(
        "ImportPrepareComplete",
        ImportPrepareComplete {
            run_request_id: import_state.run_request_id.clone(),
            ownership_generation: generation,
        },
    )
    .map_err(|error| format!("Failed to emit ImportPrepareComplete: {error}"))?;
    Ok(true)
}

fn set_import_supervisor_handle(
    state: &AppState,
    generation: u64,
    child_pid: u32,
    supervisor_handle: thread::JoinHandle<()>,
) -> Result<(), (String, thread::JoinHandle<()>)> {
    let mut import_state = match state.import_state.lock() {
        Ok(import_state) => import_state,
        Err(_) => {
            return Err((
                "Import state lock was poisoned".to_string(),
                supervisor_handle,
            ));
        }
    };

    if import_state.ownership_generation != generation
        || import_state.lifecycle != ImportLifecycle::Running
        || import_state.child_pid != Some(child_pid)
    {
        return Err((
            format!(
                "Import state changed before supervisor tracking could be established for PID {child_pid}"
            ),
            supervisor_handle,
        ));
    }

    import_state.supervisor_handle = Some(supervisor_handle);
    Ok(())
}

fn read_pipe_lines<R>(
    reader: R,
    source: ImportOutputLineSource,
    sender: mpsc::Sender<ImportOutputLine>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) => {
                    let output_line = ImportOutputLine { source, line };
                    if sender.send(output_line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    })
}

fn record_import_results(
    import_state: &mut ImportState,
    generation: u64,
    event: &ImportStructuredEvent,
) -> bool {
    if import_state.ownership_generation != generation {
        return false;
    }

    match event {
        ImportStructuredEvent::ImportFailed { subject, .. }
            if owned_subject_spelling(&import_state.subject_list, subject).is_some() =>
        {
            let canonical = owned_subject_spelling(&import_state.subject_list, subject)
                .expect("guarded owned subject")
                .to_string();
            if !contains_portable_subject(&import_state.failed_subjects, &canonical) {
                import_state.failed_subjects.push(canonical.clone());
            }
            import_state
                .succeeded_subjects
                .retain(|owned| portable_key(owned) != portable_key(&canonical));
        }
        ImportStructuredEvent::SubjectComplete { subject, .. }
            if owned_subject_spelling(&import_state.subject_list, subject).is_some()
                && !contains_portable_subject(&import_state.failed_subjects, subject) =>
        {
            let canonical = owned_subject_spelling(&import_state.subject_list, subject)
                .expect("guarded owned subject")
                .to_string();
            if !contains_portable_subject(&import_state.succeeded_subjects, &canonical) {
                import_state.succeeded_subjects.push(canonical);
            }
        }
        ImportStructuredEvent::ImportComplete => {
            let succeeded = import_state
                .subject_list
                .iter()
                .filter(|subject| {
                    !contains_portable_subject(&import_state.failed_subjects, subject)
                })
                .cloned()
                .collect();
            import_state.succeeded_subjects = succeeded;
        }
        _ => {}
    }
    true
}

fn canonicalize_import_event_subject(
    event: &mut ImportStructuredEvent,
    owned_subjects: &[String],
) -> bool {
    let subject = match event {
        ImportStructuredEvent::SubjectStart { subject, .. }
        | ImportStructuredEvent::SubjectComplete { subject, .. }
        | ImportStructuredEvent::ImportFailed { subject, .. }
        | ImportStructuredEvent::Dcm2NiiStatus { subject, .. } => subject,
        ImportStructuredEvent::ImportComplete => return true,
    };
    let Some(canonical) = owned_subject_spelling(owned_subjects, subject) else {
        return false;
    };
    if subject != canonical {
        *subject = canonical.to_string();
    }
    true
}

fn emit_structured_events<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    events: Vec<ImportStructuredEvent>,
) -> bool {
    let mut saw_import_complete = false;
    for mut event in events {
        if matches!(event, ImportStructuredEvent::ImportComplete) {
            saw_import_complete = true;
            continue;
        }
        let state = app.state::<AppState>();
        let emitted = state
            .import_state
            .lock()
            .ok()
            .is_some_and(|mut import_state| {
                if !canonicalize_import_event_subject(&mut event, &import_state.subject_list) {
                    return false;
                }
                if !record_import_results(&mut import_state, generation, &event) {
                    return false;
                }
                // Hold ownership through the event so a later reservation cannot
                // receive output from this generation.
                let _ = app.emit(
                    "import-structured-event",
                    ImportStructuredEventPayload {
                        event,
                        run_request_id: import_state.run_request_id.clone(),
                        ownership_generation: generation,
                    },
                );
                true
            });
        if emitted {
            continue;
        }
    }
    saw_import_complete
}

pub fn mark_import_termination_requested(state: &mut ImportState, pid: u32) {
    if state.child_pid == Some(pid) {
        state.termination_requested_for = Some(pid);
    }
}

pub fn should_emit_matlab_exit_error(
    state: &mut ImportState,
    child_pid: u32,
    success: bool,
) -> bool {
    if success {
        if state.termination_requested_for == Some(child_pid) {
            state.termination_requested_for = None;
        }
        return false;
    }

    if state.termination_requested_for == Some(child_pid) {
        state.termination_requested_for = None;
        return false;
    }

    true
}

fn stream_import_output<R: Runtime>(
    app: &AppHandle<R>,
    generation: u64,
    output_line: ImportOutputLine,
    parser: &mut ImportOutputParser,
) -> bool {
    let is_progress = progress_bar_re().is_match(&output_line.line);
    if !is_progress {
        let trimmed = output_line.line.trim().to_string();
        if !parser.is_duplicate(&trimmed) {
            parser.record_line(trimmed);
            let state = app.state::<AppState>();
            let _ = state.import_state.lock().ok().and_then(|import_state| {
                if import_state.ownership_generation != generation {
                    return None;
                }
                // Hold ownership through the event so stale raw output cannot
                // be delivered after a replacement reservation.
                app.emit(
                    "import-raw-event",
                    ImportRawEventPayload {
                        line: output_line.line.clone(),
                        run_request_id: import_state.run_request_id.clone(),
                        ownership_generation: generation,
                    },
                )
                .ok()
            });
        }
    }

    emit_structured_events(
        app,
        generation,
        parser.push_line(&output_line.line, output_line.source),
    )
}

fn supervise_import_process<R: Runtime>(
    app: AppHandle<R>,
    generation: u64,
    child_pid: u32,
    mut child: Child,
    subject_list: Vec<String>,
    start_receiver: mpsc::Receiver<()>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        if !start_supervisor_or_reap(&mut child, start_receiver) {
            return;
        }
        let (sender, receiver) = mpsc::channel();
        let stdout_thread = child
            .stdout
            .take()
            .map(|stdout| read_pipe_lines(stdout, ImportOutputLineSource::Stdout, sender.clone()));
        let stderr_thread = child
            .stderr
            .take()
            .map(|stderr| read_pipe_lines(stderr, ImportOutputLineSource::Stderr, sender.clone()));
        drop(sender);

        let mut parser = ImportOutputParser::new(&subject_list);
        let mut saw_import_complete = false;
        for output_line in receiver {
            saw_import_complete |= stream_import_output(&app, generation, output_line, &mut parser);
        }

        if let Some(handle) = stdout_thread {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_thread {
            let _ = handle.join();
        }
        let finished_events = parser.finish();
        if let Ok(status) = child.wait() {
            let state = app.state::<AppState>();
            let _ = state.import_state.lock().ok().and_then(|mut import_state| {
                if !mark_import_terminal_if_matches(&mut import_state, generation, child_pid) {
                    return None;
                }

                let should_emit_exit_error =
                    should_emit_matlab_exit_error(&mut import_state, child_pid, status.success());
                for event in finished_events {
                    if matches!(event, ImportStructuredEvent::ImportComplete) {
                        saw_import_complete = true;
                        continue;
                    }
                    if record_import_results(&mut import_state, generation, &event) {
                        let _ = app.emit(
                            "import-structured-event",
                            ImportStructuredEventPayload {
                                event,
                                run_request_id: import_state.run_request_id.clone(),
                                ownership_generation: generation,
                            },
                        );
                    }
                }
                if status.success()
                    && saw_import_complete
                    && record_import_results(
                        &mut import_state,
                        generation,
                        &ImportStructuredEvent::ImportComplete,
                    )
                {
                    let _ = app.emit(
                        "import-structured-event",
                        ImportStructuredEventPayload {
                            event: ImportStructuredEvent::ImportComplete,
                            run_request_id: import_state.run_request_id.clone(),
                            ownership_generation: generation,
                        },
                    );
                }
                if should_emit_exit_error {
                    let _ = app.emit(
                        "MatlabExitError",
                        MatlabExitError {
                            exit_code: status.code().unwrap_or(-1),
                            run_request_id: import_state.run_request_id.clone(),
                            ownership_generation: generation,
                        },
                    );
                }
                Some(())
            });
        }
    })
}

fn start_supervisor_or_reap(child: &mut Child, start_receiver: mpsc::Receiver<()>) -> bool {
    if start_receiver.recv().is_ok() {
        return true;
    }

    let _ = child.kill();
    let _ = child.wait();
    false
}

fn spawn_matlab_import_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
    log::info!(
        "[IMPORT] Spawning MATLAB process: {} with batch: {}",
        matlab_path,
        batch
    );
    let mut command = crate::apptainer::create_system_command(matlab_path);
    command
        .arg("-batch")
        .arg(batch)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        // GenerateConsoleCtrlEvent uses the child PID as the process group id.
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
    }

    command.spawn()
}

pub(crate) fn build_apptainer_import_args(staging_root: &Path, sif_path: &Path) -> Vec<String> {
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

fn spawn_apptainer_import_process(apptainer_path: &str, args: &[String]) -> std::io::Result<Child> {
    log::info!(
        "[IMPORT] Spawning Apptainer import process: {} args: {:?}",
        apptainer_path,
        args
    );
    let mut command = crate::apptainer::create_system_command(apptainer_path);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
    }

    command.spawn()
}

fn take_matching_supervisor_handle(
    state: &AppState,
    generation: u64,
    pid: u32,
) -> Option<thread::JoinHandle<()>> {
    state.import_state.lock().ok().and_then(|mut import_state| {
        if import_state.ownership_generation != generation {
            return None;
        }
        match import_state.lifecycle {
            ImportLifecycle::Running if import_state.child_pid == Some(pid) => {
                import_state.child_pid = None;
                import_state.lifecycle = ImportLifecycle::Terminal;
                import_state.supervisor_handle.take()
            }
            // The supervisor may have observed exit before a stopper takes its
            // handle. The generation guard still makes this handle exclusive.
            ImportLifecycle::Terminal => import_state.supervisor_handle.take(),
            _ => None,
        }
    })
}

pub fn authorize_stop_import_pid(state: &AppState, pid: u32) -> Result<(), String> {
    let import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    authorize_import_state_pid(&import_state, pid)
}

fn authorize_import_state_pid(import_state: &ImportState, pid: u32) -> Result<(), String> {
    if import_state.lifecycle == ImportLifecycle::Preparing && pid == RESERVED_IMPORT_PID {
        return Err("Import is still preparing and cannot be stopped yet".to_string());
    }
    validate_process_id(pid)?;
    if import_state.lifecycle == ImportLifecycle::Preparing {
        return Err("Import is still preparing and cannot be stopped yet".to_string());
    }

    if import_state.lifecycle != ImportLifecycle::Running {
        return Err("No import process is currently running".to_string());
    }
    match import_state.child_pid {
        None => Err("No import process is currently running".to_string()),
        Some(active_pid) if active_pid != pid => Err(format!(
            "Requested PID {pid} does not match active import PID {active_pid}"
        )),
        Some(_) => Ok(()),
    }
}

fn clear_matching_termination_intent(import_state: &mut ImportState, generation: u64, pid: u32) {
    if import_state.ownership_generation == generation
        && import_state.child_pid == Some(pid)
        && import_state.termination_requested_for == Some(pid)
    {
        import_state.termination_requested_for = None;
    }
}

fn confirm_import_termination_with(
    state: &AppState,
    pid: u32,
    send_signal: impl FnOnce(u32) -> Result<(), String>,
    force_kill: impl FnOnce(u32) -> Result<(), String>,
    mut wait_for_exit: impl FnMut(u32, Duration) -> Result<bool, String>,
) -> Result<u64, String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    validate_process_id(pid)?;
    authorize_import_state_pid(&import_state, pid)?;
    let generation = import_state.ownership_generation;

    // Keep ownership locked until Stop succeeds or its intent has been removed.
    // The supervisor waits on its child before acquiring this mutex, so its
    // terminal exit decision cannot consume a provisional termination intent.
    send_signal(pid)?;
    mark_import_termination_requested(&mut import_state, pid);

    let result = match wait_for_exit(pid, Duration::from_secs(5)) {
        Ok(true) => Ok(()),
        Ok(false) => match force_kill(pid) {
            Ok(()) => match wait_for_exit(pid, Duration::from_secs(1)) {
                Ok(true) => Ok(()),
                Ok(false) => Err(format!(
                    "Import process {pid} could not be confirmed stopped"
                )),
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };

    if result.is_err() {
        clear_matching_termination_intent(&mut import_state, generation, pid);
    }
    result.map(|()| generation)
}

fn stop_import_pid_with(
    state: &AppState,
    pid: u32,
    send_signal: impl FnOnce(u32) -> Result<(), String>,
    force_kill: impl FnOnce(u32) -> Result<(), String>,
    wait_for_exit: impl FnMut(u32, Duration) -> Result<bool, String>,
) -> Result<(), String> {
    let generation =
        confirm_import_termination_with(state, pid, send_signal, force_kill, wait_for_exit)?;

    if let Some(handle) = take_matching_supervisor_handle(state, generation, pid) {
        let _ = handle.join();
    }

    Ok(())
}

pub fn stop_import_pid(state: &AppState, pid: u32) -> Result<(), String> {
    stop_import_pid_with(
        state,
        pid,
        send_termination_signal,
        force_kill_process,
        wait_for_process_exit,
    )
}

pub fn stop_import_pid_for_exit(state: &AppState, pid: u32) -> Result<(), String> {
    let generation = confirm_import_termination_with(
        state,
        pid,
        send_termination_signal,
        force_kill_process,
        wait_for_process_exit,
    )?;

    let _ = take_matching_supervisor_handle(state, generation, pid);

    Ok(())
}

pub fn stop_running_import_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let (lifecycle, pid) = {
        let import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        (import_state.lifecycle, import_state.child_pid)
    };

    match (lifecycle, pid) {
        (ImportLifecycle::Preparing, Some(RESERVED_IMPORT_PID)) => Ok(false),
        (_, Some(pid)) => {
            validate_process_id(pid)?;
            stop_import_pid_for_exit(&state, pid)?;
            Ok(true)
        }
        (_, None) => Ok(false),
    }
}

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
) -> Result<crate::import_relocation::RelocationPlan, String> {
    validate_subject_components(&subject_list)?;
    let root = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No active project root".to_string())?;
    let sequence = state
        .relocation_plan_sequence
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let plan_id = format!("relocation-{}-{timestamp}-{sequence}", std::process::id());
    let plan = crate::import_relocation::create_plan(&root, &subject_list, plan_id.clone())?;
    state
        .relocation_plans
        .lock()
        .map_err(|_| "Relocation plan state lock was poisoned".to_string())?
        .insert(plan_id, plan.clone());
    Ok(plan)
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
    validate_import_request_inputs(&staging_entries, &subject_list)?;
    let staging_entries = normalize_staging_subject_spelling(&staging_entries, &subject_list)?;
    if run_request_id.trim().is_empty() {
        return Err("run_request_id must not be empty".to_string().into());
    }
    if relocation_plan_id.trim().is_empty() {
        return Err("relocation_plan_id must not be empty".to_string().into());
    }

    if !sourcestructure_json.is_object() {
        return Err("sourcestructure_json must be a JSON object"
            .to_string()
            .into());
    }
    if !studypar_json.is_object() {
        return Err("studypar_json must be a JSON object".to_string().into());
    }

    let validation = execution_profile.validate();
    if !validation.valid {
        return Err(validation.errors.join("; ").into());
    }

    enum ImportExecution {
        Matlab {
            matlab_path: String,
            exploreasl_path: PathBuf,
        },
        Apptainer {
            apptainer_path: String,
            sif_path: PathBuf,
        },
    }

    let execution = match execution_profile {
        ExecutionProfile::Matlab { .. } => ImportExecution::Matlab {
            matlab_path: validation
                .matlab_path
                .expect("validated matlab profile should include matlab path"),
            exploreasl_path: validation
                .explore_asl_path
                .expect("validated matlab profile should include exploreasl path"),
        },
        ExecutionProfile::Apptainer { .. } => ImportExecution::Apptainer {
            apptainer_path: validation
                .apptainer_path
                .expect("validated Apptainer profile should include executable path"),
            sif_path: validation
                .sif_path
                .expect("validated Apptainer profile should include SIF path"),
        },
    };

    let compiled_plan = compile_staging_plan(
        state
            .active_project_root
            .lock()
            .map_err(|_| "Active project state lock was poisoned".to_string())?
            .clone(),
        &staging_entries,
    )
    .map_err(|result| ImportCommandError::Preflight {
        issues: result.issues,
    })?;
    // All operations after validation use the immutable, canonical plan root.
    let staging_root = compiled_plan.staging_root.clone();
    let project_root = compiled_plan
        .staging_root
        .parent()
        .expect("compiled staging root has a parent")
        .to_path_buf();
    let stream_subject_list = subject_list.clone();
    // Reject foreign, stale-scope, and already-consumed plans before replacing
    // import ownership or touching staging.
    validate_relocation_plan_for_run(&state, &relocation_plan_id, &project_root, &subject_list)?;
    let reservation = reserve_import_state_for_run(
        &state,
        staging_root.clone(),
        project_root.clone(),
        run_request_id,
        subject_list,
        subjects_to_preserve,
        relocation_plan_id.clone(),
    )?;
    let generation = reservation.generation;
    if let Err(error) = bind_relocation_plan_for_run(
        &state,
        &relocation_plan_id,
        &project_root,
        &stream_subject_list,
        generation,
    ) {
        clear_reserved_import(&state, generation);
        return Err(error.into());
    }

    cleanup_staging_root(&staging_root).map_err(|error| {
        ImportCommandError::from(rollback_reserved_preparation_failure(
            &state,
            generation,
            &staging_root,
            error,
        ))
    })?;

    execute_compiled_staging_plan(&compiled_plan).map_err(|error| {
        ImportCommandError::from(rollback_reserved_preparation_failure(
            &state,
            generation,
            &staging_root,
            error,
        ))
    })?;

    fs::create_dir_all(&staging_root).map_err(|e| {
        ImportCommandError::from(rollback_reserved_preparation_failure(
            &state,
            generation,
            &staging_root,
            format!(
                "Failed to create staging directory {}: {}",
                staging_root.display(),
                e
            ),
        ))
    })?;
    write_config_json(
        &staging_root.join("sourcestructure.json"),
        &sourcestructure_json,
    )
    .map_err(|e| {
        ImportCommandError::from(rollback_reserved_preparation_failure(
            &state,
            generation,
            &staging_root,
            e,
        ))
    })?;
    write_config_json(&staging_root.join("studyPar.json"), &studypar_json).map_err(|e| {
        ImportCommandError::from(rollback_reserved_preparation_failure(
            &state,
            generation,
            &staging_root,
            e,
        ))
    })?;

    if !reservation.preserved_subjects.is_empty() {
        copy_lock_files_paths(
            &project_root,
            &staging_root,
            &reservation.preserved_subjects,
        )
        .map_err(|e| {
            ImportCommandError::from(rollback_reserved_preparation_failure(
                &state,
                generation,
                &staging_root,
                e,
            ))
        })?;
    }

    let mut child = match execution {
        ImportExecution::Matlab {
            matlab_path,
            exploreasl_path,
        } => {
            let batch = format!(
                "addpath('{}'); ExploreASL('{}', [1,1,0], 0, 0)",
                escape_matlab_string(&exploreasl_path.to_string_lossy()),
                escape_matlab_string(&staging_root.to_string_lossy()),
            );
            spawn_matlab_import_process(&matlab_path, &batch).map_err(|error| {
                rollback_process_spawn_failure(
                    &state,
                    generation,
                    &staging_root,
                    "MATLAB",
                    &matlab_path,
                    error,
                )
            })?
        }
        ImportExecution::Apptainer {
            apptainer_path,
            sif_path,
        } => {
            ensure_mcr_cache(&apptainer_path, &sif_path, &staging_root).map_err(|error| {
                ImportCommandError::from(rollback_reserved_preparation_failure(
                    &state,
                    generation,
                    &staging_root,
                    error,
                ))
            })?;
            let args = build_apptainer_import_args(&staging_root, &sif_path);
            spawn_apptainer_import_process(&apptainer_path, &args).map_err(|error| {
                rollback_process_spawn_failure(
                    &state,
                    generation,
                    &staging_root,
                    "Apptainer",
                    &apptainer_path,
                    error,
                )
            })?
        }
    };
    let child_pid = child.id();

    if let Err(err) = set_reserved_import_pid(&state, generation, child_pid) {
        let _ = child.kill();
        let _ = child.wait();
        if clear_matching_import(&state, generation) {
            let _ = cleanup_staging_root(&staging_root);
        }
        return Err(err.into());
    }

    // Keep the supervisor gated until readiness is delivered. This gives a
    // failed readiness emission one owner that can terminate and reap the
    // child before staging and matching ownership are released.
    let (start_sender, start_receiver) = mpsc::channel();
    let supervisor_handle = supervise_import_process(
        app.clone(),
        generation,
        child_pid,
        child,
        stream_subject_list,
        start_receiver,
    );
    if let Err((err, supervisor_handle)) =
        set_import_supervisor_handle(&state, generation, child_pid, supervisor_handle)
    {
        drop(start_sender);
        let _ = supervisor_handle.join();
        if clear_matching_import(&state, generation) {
            let _ = cleanup_staging_root(&staging_root);
        }
        return Err(err.into());
    }

    match emit_prepare_complete_for_running_import(&app, &state, generation, child_pid) {
        Ok(true) => {}
        Ok(false) => {
            drop(start_sender);
            if let Some(handle) = take_matching_supervisor_handle(&state, generation, child_pid) {
                let _ = handle.join();
            }
            let error = cleanup_after_prepare_event_failure(
                &state,
                generation,
                &staging_root,
                "Import state changed before ImportPrepareComplete could be emitted".to_string(),
            );
            return Err(error.into());
        }
        Err(error) => {
            drop(start_sender);
            if let Some(handle) = take_matching_supervisor_handle(&state, generation, child_pid) {
                let _ = handle.join();
            }
            let error =
                cleanup_after_prepare_event_failure(&state, generation, &staging_root, error);
            return Err(error.into());
        }
    }
    if start_sender.send(()).is_err() {
        if let Some(handle) = take_matching_supervisor_handle(&state, generation, child_pid) {
            let _ = handle.join();
        }
        let error = cleanup_after_prepare_event_failure(
            &state,
            generation,
            &staging_root,
            "Import supervisor stopped before it could begin".to_string(),
        );
        return Err(error.into());
    }

    Ok(child_pid)
}

#[tauri::command]
pub fn stop_import(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    stop_import_pid(&state, pid)
}

#[tauri::command]
pub fn stop_active_import(state: State<'_, AppState>) -> Result<(), String> {
    let (lifecycle, pid) = {
        let import_state = state
            .import_state
            .lock()
            .map_err(|_| "Import state lock was poisoned".to_string())?;
        (import_state.lifecycle, import_state.child_pid)
    };

    match (lifecycle, pid) {
        (ImportLifecycle::Preparing, Some(RESERVED_IMPORT_PID)) => {
            Err("Import is still preparing and cannot be stopped yet".to_string())
        }
        (_, Some(pid)) => {
            validate_process_id(pid)?;
            stop_import_pid(&state, pid)
        }
        (_, None) => Err("No import process is currently running".to_string()),
    }
}

#[tauri::command]
pub fn clean_import_status(state: State<'_, AppState>) -> Result<(), String> {
    clean_import_status_for_state(&state)
}

#[tauri::command]
pub fn move_import_output(
    state: State<'_, AppState>,
    debug_mode: bool,
    cleanup_staging: bool,
) -> Result<crate::import_relocation::RelocationOutcome, String> {
    move_import_output_for_state(&state, debug_mode, cleanup_staging)
}

#[tauri::command]
pub fn copy_lock_files(state: State<'_, AppState>, subjects: Vec<String>) -> Result<(), String> {
    copy_lock_files_for_state(&state, &subjects)
}

#[tauri::command]
pub async fn read_import_status(project_root: String) -> Result<Vec<ImportSubjectStatus>, String> {
    let project_root = validate_path_input("project_root", &project_root)?;

    let lock_base = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Import");

    if !lock_base.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&lock_base).map_err(|e| {
        format!(
            "Failed to read lock directory {}: {}",
            lock_base.display(),
            e
        )
    })?;

    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to inspect entry {}: {}", entry.path().display(), e))?;

        if !metadata.is_dir() {
            continue;
        }

        let subject = entry.file_name().to_string_lossy().to_string();
        let subject_lock_dir = lock_base.join(&subject).join("xASL_module_Import");

        if !subject_lock_dir.exists() {
            continue;
        }

        let ready_path = subject_lock_dir.join("999_ready.status");
        if ready_path.exists() {
            results.push(ImportSubjectStatus {
                subject,
                status: ImportSubjectStatusKind::Completed,
            });
        } else {
            let has_status_files = fs::read_dir(&subject_lock_dir)
                .ok()
                .map(|dir_entries| {
                    dir_entries
                        .filter_map(|e| e.ok())
                        .any(|e| e.path().extension().is_some_and(|ext| ext == "status"))
                })
                .unwrap_or(false);

            if has_status_files {
                results.push(ImportSubjectStatus {
                    subject,
                    status: ImportSubjectStatusKind::Failed,
                });
            }
        }
    }

    Ok(results)
}

fn validate_string_input(name: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{} must not be empty", name));
    }

    Ok(trimmed.to_string())
}

fn validate_path_input(name: &str, value: &str) -> Result<PathBuf, String> {
    validate_string_input(name, value).map(PathBuf::from)
}

fn write_config_json(path: &Path, value: &Value) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize {}: {}", path.display(), e))?;
    fs::write(path, contents).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
#[path = "import_tests.rs"]
mod import_tests;
