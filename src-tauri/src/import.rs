use crate::commands::{create_symlink_tree, SymlinkEntry};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const RESERVED_IMPORT_PID: u32 = 0;
const IMPORT_STATUS_FILES: [&str; 3] = [
    "010_DCM2NII.status",
    "020_NII2BIDS.status",
    "999_ready.status",
];
pub const SUBJECT_START_RE: &str = r"Subject: ([A-Za-z0-9_-]+), Module:";
pub const JOB_ITERATION_RE: &str = r"Job-iteration (\d+) stopped at .+ and took (\d+) seconds";
pub const NII2BIDS_FAILED_RE: &str = r"NII2BIDS failed for (.+)";
pub const DCM2NII_FAILED_RE: &str = r"DCM2NII failed for (.+)";
pub const IMPORT_COMPLETE_RE: &str = r"xASL_module_Import completed 100%";
pub const STATUS_CODE_RE: &str = r"status: (-?\d+)";
pub const MESSAGE_LINE_RE: &str = r"Message:\s*(.*)";
pub const PROGRESS_BAR_RE: &str = r"^[\d%\s]+$";

#[derive(Debug)]
pub struct ImportState {
    pub child_pid: Option<u32>,
    pub supervisor_handle: Option<thread::JoinHandle<()>>,
    pub termination_requested_for: Option<u32>,
    pub staging_root: PathBuf,
    pub project_root: PathBuf,
    pub failed_subjects: Vec<String>,
    pub succeeded_subjects: Vec<String>,
    pub subject_list: Vec<String>,
}

impl ImportState {
    pub fn new(staging_root: PathBuf, project_root: PathBuf, subject_list: Vec<String>) -> Self {
        Self {
            child_pid: None,
            supervisor_handle: None,
            termination_requested_for: None,
            staging_root,
            project_root,
            failed_subjects: Vec::new(),
            succeeded_subjects: Vec::new(),
            subject_list,
        }
    }
}

impl Default for ImportState {
    fn default() -> Self {
        Self::new(PathBuf::new(), PathBuf::new(), Vec::new())
    }
}

#[derive(Default)]
pub struct AppState {
    pub import_state: Mutex<ImportState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagingEntry {
    pub subject: String,
    pub session: String,
    pub run: String,
    pub modality: String,
    pub source_path: String,
}

impl StagingEntry {
    pub fn into_symlink_entry(self) -> SymlinkEntry {
        SymlinkEntry {
            subject: self.subject,
            session: self.session,
            run: self.run,
            modality: self.modality,
            source_path: self.source_path,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImportStructuredEvent {
    SubjectStart {
        subject: String,
        step: String,
    },
    SubjectComplete {
        subject: String,
        duration_secs: u64,
    },
    ImportFailed {
        subject: String,
        step: String,
        message: String,
    },
    ImportComplete,
    Dcm2NiiStatus {
        subject: String,
        exit_code: i32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRawEvent {
    pub line: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportPrepareComplete;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatlabExitError {
    pub exit_code: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportOutputLineSource {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportOutputLine {
    pub source: ImportOutputLineSource,
    pub line: String,
}

impl ImportOutputLine {
    pub fn stdout(line: impl Into<String>) -> Self {
        Self {
            source: ImportOutputLineSource::Stdout,
            line: line.into(),
        }
    }

    pub fn stderr(line: impl Into<String>) -> Self {
        Self {
            source: ImportOutputLineSource::Stderr,
            line: line.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedImportStream {
    pub raw_events: Vec<ImportRawEvent>,
    pub structured_events: Vec<ImportStructuredEvent>,
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
    succeeded_subjects: Option<&[String]>,
    debug_mode: bool,
) -> Result<(), String> {
    validate_staging_root(staging_root)?;
    validate_project_root_for_staging(staging_root, project_root)?;

    match succeeded_subjects {
        None => move_full_import_output(staging_root, project_root, debug_mode),
        Some(subjects) => {
            validate_subject_components(subjects)?;
            move_partial_import_output(staging_root, project_root, subjects)
        }
    }
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

fn move_full_import_output(
    staging_root: &Path,
    project_root: &Path,
    debug_mode: bool,
) -> Result<(), String> {
    let project_rawdata = project_root.join("rawdata");
    let project_derivatives = project_root.join("derivatives");
    remove_dir_if_exists(&project_rawdata)?;
    remove_dir_if_exists(&project_derivatives)?;

    move_dir_if_exists(&staging_root.join("rawdata"), &project_rawdata)?;
    move_dir_if_exists(&staging_root.join("derivatives"), &project_derivatives)?;

    if debug_mode {
        copy_import_configs(staging_root, project_root)?;
        fs::create_dir_all(staging_root).map_err(|error| {
            format!(
                "Failed to preserve staging directory {}: {}",
                staging_root.display(),
                error
            )
        })?;
    } else {
        cleanup_staging_root(staging_root)?;
    }

    Ok(())
}

fn move_partial_import_output(
    staging_root: &Path,
    project_root: &Path,
    subjects: &[String],
) -> Result<(), String> {
    copy_dataset_description_if_missing(staging_root, project_root)?;

    for subject in subjects {
        let source_subject_rawdata = staging_root.join("rawdata").join(format!("sub-{subject}"));
        let destination_subject_rawdata =
            project_root.join("rawdata").join(format!("sub-{subject}"));
        if source_subject_rawdata.exists() {
            copy_dir_replace(&source_subject_rawdata, &destination_subject_rawdata)?;
        }

        let source_lock_dir = import_lock_dir(staging_root, subject);
        let destination_lock_dir = import_lock_dir(project_root, subject);
        if source_lock_dir.exists() {
            copy_dir_replace(&source_lock_dir, &destination_lock_dir)?;
        }

        copy_matching_subject_logs(staging_root, project_root, subject)?;
    }

    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove directory {}: {}",
            path.display(),
            error
        )),
    }
}

fn move_dir_if_exists(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create destination parent {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    fs::rename(source, destination).map_err(|error| {
        format!(
            "Failed to move {} to {}: {}",
            source.display(),
            destination.display(),
            error
        )
    })
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

fn copy_dataset_description_if_missing(
    staging_root: &Path,
    project_root: &Path,
) -> Result<(), String> {
    let source = staging_root
        .join("rawdata")
        .join("dataset_description.json");
    let destination = project_root
        .join("rawdata")
        .join("dataset_description.json");
    if !source.exists() || destination.exists() {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create rawdata directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    fs::copy(&source, &destination).map_err(|error| {
        format!(
            "Failed to copy dataset description {} to {}: {}",
            source.display(),
            destination.display(),
            error
        )
    })?;

    Ok(())
}

fn copy_matching_subject_logs(
    staging_root: &Path,
    project_root: &Path,
    subject: &str,
) -> Result<(), String> {
    let source_log_dir = staging_root
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if !source_log_dir.exists() {
        return Ok(());
    }

    let destination_log_dir = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&destination_log_dir).map_err(|error| {
        format!(
            "Failed to create log directory {}: {}",
            destination_log_dir.display(),
            error
        )
    })?;

    let subject_marker = format!("sub-{subject}");
    for entry in fs::read_dir(&source_log_dir).map_err(|error| {
        format!(
            "Failed to read log directory {}: {}",
            source_log_dir.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to read log entry: {}", error))?;
        let file_name = entry.file_name();
        if file_name.to_string_lossy().contains(&subject_marker) && entry.path().is_file() {
            fs::copy(entry.path(), destination_log_dir.join(file_name)).map_err(|error| {
                format!(
                    "Failed to copy import log for subject {}: {}",
                    subject, error
                )
            })?;
        }
    }

    Ok(())
}

fn copy_dir_replace(source: &Path, destination: &Path) -> Result<(), String> {
    remove_dir_if_exists(destination)?;
    copy_dir_recursive(source, destination)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create destination directory {}: {}",
            destination.display(),
            error
        )
    })?;

    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Failed to read source directory {}: {}",
            source.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {}", error))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = entry.metadata().map_err(|error| {
            format!(
                "Failed to inspect source path {}: {}",
                source_path.display(),
                error
            )
        })?;

        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
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
    match state.child_pid {
        Some(RESERVED_IMPORT_PID) => Err("An import is already preparing".to_string()),
        Some(pid) => Err(format!(
            "An import is already running with process PID {pid}"
        )),
        None => Ok(()),
    }
}

pub fn clear_import_child_pid_if_matches(state: &mut ImportState, child_pid: u32) {
    if state.child_pid == Some(child_pid) {
        state.child_pid = None;
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

fn reserve_import_state(
    state: &AppState,
    staging_root: PathBuf,
    project_root: PathBuf,
    subject_list: Vec<String>,
) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    validate_import_not_running(&import_state)?;
    *import_state = ImportState::new(staging_root, project_root, subject_list);
    import_state.child_pid = Some(RESERVED_IMPORT_PID);

    Ok(())
}

fn clear_reserved_import(state: &AppState) {
    if let Ok(mut import_state) = state.import_state.lock() {
        clear_import_child_pid_if_matches(&mut import_state, RESERVED_IMPORT_PID);
    }
}

fn rollback_reserved_preparation_failure(
    state: &AppState,
    staging_root: &Path,
    error: String,
) -> String {
    clear_reserved_import(state);
    rollback_preparation_failure(staging_root, error)
}

fn cleanup_after_prepare_event_failure(
    state: &AppState,
    staging_root: &Path,
    error: String,
) -> String {
    rollback_reserved_preparation_failure(state, staging_root, error)
}

fn set_reserved_import_pid(state: &AppState, child_pid: u32) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    if import_state.child_pid != Some(RESERVED_IMPORT_PID) {
        return Err(
            "Import state changed before process tracking could be established".to_string(),
        );
    }

    import_state.child_pid = Some(child_pid);
    Ok(())
}

fn set_import_supervisor_handle(
    state: &AppState,
    child_pid: u32,
    supervisor_handle: thread::JoinHandle<()>,
) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;

    if import_state.child_pid.is_some() && import_state.child_pid != Some(child_pid) {
        return Err(format!(
            "Import state changed before supervisor tracking could be established for PID {child_pid}"
        ));
    }

    import_state.supervisor_handle = Some(supervisor_handle);
    Ok(())
}

fn subject_start_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(SUBJECT_START_RE).expect("subject start regex should compile"))
}

fn job_iteration_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(JOB_ITERATION_RE).expect("job iteration regex should compile"))
}

fn nii2bids_failed_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(NII2BIDS_FAILED_RE).expect("NII2BIDS failure regex should compile")
    })
}

fn dcm2nii_failed_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(DCM2NII_FAILED_RE).expect("DCM2NII failure regex should compile"))
}

fn import_complete_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(IMPORT_COMPLETE_RE).expect("import complete regex should compile"))
}

fn status_code_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(STATUS_CODE_RE).expect("status code regex should compile"))
}

fn message_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(MESSAGE_LINE_RE).expect("message line regex should compile"))
}

fn progress_bar_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(PROGRESS_BAR_RE).expect("progress bar regex should compile"))
}

#[derive(Debug)]
struct PendingFailure {
    subject: String,
    step: String,
    message: String,
}

#[derive(Debug)]
struct ImportOutputParser {
    subject_list: Vec<String>,
    current_subject: Option<String>,
    pending_failures: Vec<PendingFailure>,
    failed_subjects: std::collections::HashSet<String>,
    current_step: String,
}

impl ImportOutputParser {
    fn new(subject_list: &[String]) -> Self {
        Self {
            subject_list: subject_list.to_vec(),
            current_subject: None,
            pending_failures: Vec::new(),
            failed_subjects: std::collections::HashSet::new(),
            current_step: "DCM2NII".to_string(),
        }
    }

    fn push_line(&mut self, line: &str, source: ImportOutputLineSource) -> Vec<ImportStructuredEvent> {
        if !self.pending_failures.is_empty() {
            if let Some(captures) = message_line_re().captures(line) {
                let detail = captures
                    .get(1)
                    .map(|value| value.as_str().trim())
                    .unwrap_or_default();
                for failure in &mut self.pending_failures {
                    if !detail.is_empty() {
                        failure.message.push('\n');
                        failure.message.push_str(detail);
                    }
                }
                return Vec::new();
            }

            let mut events = self.flush_pending_failures();
            if line.trim().is_empty() {
                return events;
            }
            events.extend(self.parse_non_message_line(line, source));
            return events;
        }

        self.parse_non_message_line(line, source)
    }

    fn finish(&mut self) -> Vec<ImportStructuredEvent> {
        self.flush_pending_failures()
    }

    fn parse_non_message_line(&mut self, line: &str, source: ImportOutputLineSource) -> Vec<ImportStructuredEvent> {
        if source == ImportOutputLineSource::Stdout {
            if line.contains("DICOM to NIFTI CONVERSION") {
                self.current_step = "DCM2NII".to_string();
            } else if line.contains("NIFTI to BIDS CONVERSION") {
                self.current_step = "NII2BIDS".to_string();
                if let Some(ref subject) = self.current_subject {
                    return vec![ImportStructuredEvent::SubjectStart {
                        subject: subject.clone(),
                        step: self.current_step.clone(),
                    }];
                }
            }

            if let Some(captures) = subject_start_re().captures(line) {
                if let Some(subject) = captures.get(1).map(|value| value.as_str().to_string()) {
                    self.current_subject = Some(subject.clone());
                    self.current_step = "DCM2NII".to_string();
                    return vec![ImportStructuredEvent::SubjectStart {
                        subject,
                        step: self.current_step.clone(),
                    }];
                }
            }

            if let Some(captures) = job_iteration_re().captures(line) {
                if let (Some(subject), Some(duration)) = (
                    self.current_subject.clone(),
                    captures
                        .get(2)
                        .and_then(|value| value.as_str().parse::<u64>().ok()),
                ) {
                    if !self.failed_subjects.contains(&subject) {
                        return vec![ImportStructuredEvent::SubjectComplete {
                            subject,
                            duration_secs: duration,
                        }];
                    } else {
                        return Vec::new();
                    }
                }
            }

            if import_complete_re().is_match(line) {
                return vec![ImportStructuredEvent::ImportComplete];
            }

            if let Some(captures) = status_code_re().captures(line) {
                if let (Some(subject), Some(exit_code)) = (
                    self.current_subject.clone(),
                    captures
                        .get(1)
                        .and_then(|value| value.as_str().parse::<i32>().ok()),
                ) {
                    return vec![ImportStructuredEvent::Dcm2NiiStatus { subject, exit_code }];
                }
            }
        }

        if let Some(captures) = nii2bids_failed_re().captures(line) {
            self.set_pending_failures("NII2BIDS", captures.get(1), line);
            return Vec::new();
        }

        if let Some(captures) = dcm2nii_failed_re().captures(line) {
            self.set_pending_failures("DCM2NII", captures.get(1), line);
        }

        Vec::new()
    }

    fn set_pending_failures(
        &mut self,
        step: &str,
        description: Option<regex::Match<'_>>,
        fallback_message: &str,
    ) {
        let description = description
            .map(|value| value.as_str())
            .unwrap_or(fallback_message);

        let mut pending = Vec::new();
        for subject in &self.subject_list {
            if description.contains(subject) {
                self.failed_subjects.insert(subject.clone());
                pending.push(PendingFailure {
                    subject: subject.clone(),
                    step: step.to_string(),
                    message: fallback_message.to_string(),
                });
            }
        }
        self.pending_failures = pending;
    }

    fn flush_pending_failures(&mut self) -> Vec<ImportStructuredEvent> {
        self.pending_failures
            .drain(..)
            .map(|failure| ImportStructuredEvent::ImportFailed {
                subject: failure.subject,
                step: failure.step,
                message: failure.message,
            })
            .collect()
    }
}

pub fn parse_import_lines(lines: &[String], subject_list: &[String]) -> Vec<ImportStructuredEvent> {
    let mut parser = ImportOutputParser::new(subject_list);
    let mut events = Vec::new();

    for line in lines {
        events.extend(parser.push_line(line, ImportOutputLineSource::Stdout));
    }
    events.extend(parser.finish());

    events
}

pub fn parse_import_stream_lines(
    lines: &[ImportOutputLine],
    subject_list: &[String],
) -> ParsedImportStream {
    let mut parser = ImportOutputParser::new(subject_list);
    let mut raw_events = Vec::new();
    let mut structured_events = Vec::new();

    for output_line in lines {
        raw_events.push(ImportRawEvent {
            line: output_line.line.clone(),
        });

        structured_events.extend(parser.push_line(&output_line.line, output_line.source));
    }
    structured_events.extend(parser.finish());
    ParsedImportStream {
        raw_events,
        structured_events,
    }
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

fn emit_structured_events(app: &AppHandle, events: Vec<ImportStructuredEvent>) {
    for event in events {
        let _ = app.emit("import-structured-event", event);
    }
}

fn emit_matlab_exit_error(app: &AppHandle, exit_code: i32) {
    let _ = app.emit("MatlabExitError", MatlabExitError { exit_code });
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
        return false;
    }

    if state.termination_requested_for == Some(child_pid) {
        state.termination_requested_for = None;
        return false;
    }

    true
}

fn stream_import_output(
    app: &AppHandle,
    output_line: ImportOutputLine,
    parser: &mut ImportOutputParser,
) {
    if !progress_bar_re().is_match(&output_line.line) {
        let _ = app.emit(
            "import-raw-event",
            ImportRawEvent {
                line: output_line.line.clone(),
            },
        );
    }

    emit_structured_events(app, parser.push_line(&output_line.line, output_line.source));
}

fn supervise_import_process(
    app: AppHandle,
    child_pid: u32,
    mut child: Child,
    subject_list: Vec<String>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
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
        for output_line in receiver {
            stream_import_output(&app, output_line, &mut parser);
        }

        if let Some(handle) = stdout_thread {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_thread {
            let _ = handle.join();
        }
        emit_structured_events(&app, parser.finish());

        if let Ok(status) = child.wait() {
            let state = app.state::<AppState>();
            let should_emit = state
                .import_state
                .lock()
                .map(|mut import_state| {
                    should_emit_matlab_exit_error(&mut import_state, child_pid, status.success())
                })
                .unwrap_or(!status.success());
            if should_emit {
                emit_matlab_exit_error(&app, status.code().unwrap_or(-1));
            }
        }

        let state = app.state::<AppState>();
        if let Ok(mut import_state) = state.import_state.lock() {
            clear_import_child_pid_if_matches(&mut import_state, child_pid);
        };
    })
}

fn spawn_matlab_import_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
    let mut command = Command::new(matlab_path);
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

    command.spawn()
}

#[cfg(unix)]
fn send_termination_signal(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    kill(Pid::from_raw(pid as i32), Signal::SIGTERM)
        .map_err(|error| format!("Failed to send SIGTERM to PID {pid}: {error}"))
}

#[cfg(windows)]
fn send_termination_signal(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent;

    let ok = unsafe { GenerateConsoleCtrlEvent(1, pid) };
    if ok == 0 {
        return Err(format!("Failed to send CTRL_BREAK_EVENT to PID {pid}"));
    }

    Ok(())
}

#[cfg(unix)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    kill(Pid::from_raw(pid as i32), Signal::SIGKILL)
        .map_err(|error| format!("Failed to send SIGKILL to PID {pid}: {error}"))
}

#[cfg(windows)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        return Err(format!("Failed to open PID {pid} for termination"));
    }

    let ok = unsafe { TerminateProcess(handle, 1) };
    unsafe {
        CloseHandle(handle);
    }
    if ok == 0 {
        return Err(format!("Failed to terminate PID {pid}"));
    }

    Ok(())
}

fn wait_for_pid_to_clear_or_exit(state: &AppState, pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let state_cleared = state
            .import_state
            .lock()
            .map(|import_state| import_state.child_pid != Some(pid))
            .unwrap_or(true);
        if state_cleared || !process_exists(pid) {
            return true;
        }

        if Instant::now() >= deadline {
            return false;
        }

        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    use nix::errno::Errno;
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    match kill(Pid::from_raw(pid as i32), None) {
        Ok(()) => true,
        Err(Errno::ESRCH) => false,
        Err(_) => true,
    }
}

#[cfg(windows)]
fn process_exists(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, SYNCHRONIZE,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return false;
    }

    let result = unsafe { WaitForSingleObject(handle, 0) };
    unsafe {
        CloseHandle(handle);
    }

    result == WAIT_TIMEOUT
}

fn take_matching_supervisor_handle(state: &AppState, pid: u32) -> Option<thread::JoinHandle<()>> {
    state.import_state.lock().ok().and_then(|mut import_state| {
        if import_state.child_pid == Some(pid) {
            import_state.child_pid = None;
            import_state.supervisor_handle.take()
        } else {
            None
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
    if pid == RESERVED_IMPORT_PID {
        return Err("Import is still preparing and cannot be stopped yet".to_string());
    }

    match import_state.child_pid {
        None => Err("No import process is currently running".to_string()),
        Some(RESERVED_IMPORT_PID) => {
            Err("Import is still preparing and cannot be stopped yet".to_string())
        }
        Some(active_pid) if active_pid != pid => Err(format!(
            "Requested PID {pid} does not match active import PID {active_pid}"
        )),
        Some(_) => Ok(()),
    }
}

fn mark_import_termination_requested_for_state(state: &AppState, pid: u32) -> Result<(), String> {
    let mut import_state = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?;
    authorize_import_state_pid(&import_state, pid)?;
    mark_import_termination_requested(&mut import_state, pid);
    Ok(())
}

pub fn stop_import_pid(state: &AppState, pid: u32) -> Result<(), String> {
    mark_import_termination_requested_for_state(state, pid)?;
    send_termination_signal(pid)?;

    if !wait_for_pid_to_clear_or_exit(state, pid, Duration::from_secs(5)) {
        force_kill_process(pid)?;
        let _ = wait_for_pid_to_clear_or_exit(state, pid, Duration::from_secs(1));
    }

    if let Some(handle) = take_matching_supervisor_handle(state, pid) {
        let _ = handle.join();
    }

    Ok(())
}

pub fn stop_import_pid_for_exit(state: &AppState, pid: u32) -> Result<(), String> {
    mark_import_termination_requested_for_state(state, pid)?;
    send_termination_signal(pid)?;

    if !wait_for_pid_to_clear_or_exit(state, pid, Duration::from_secs(5)) {
        force_kill_process(pid)?;
    }

    let _ = take_matching_supervisor_handle(state, pid);

    Ok(())
}

pub fn stop_running_import_for_exit(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pid = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned".to_string())?
        .child_pid;

    if let Some(pid) = pid {
        if pid != RESERVED_IMPORT_PID {
            stop_import_pid_for_exit(&state, pid)?;
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub fn run_import_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    staging_root: String,
    staging_entries: Vec<StagingEntry>,
    sourcestructure_json: Value,
    studypar_json: Value,
    matlab_path: String,
    exploreasl_path: String,
    subject_list: Vec<String>,
) -> Result<u32, String> {
    let staging_root = validate_path_input("staging_root", &staging_root)?;
    validate_staging_root(&staging_root)?;
    let exploreasl_path = validate_string_input("exploreasl_path", &exploreasl_path)?;
    validate_non_empty_inputs(&staging_entries, &subject_list)?;

    if !sourcestructure_json.is_object() {
        return Err("sourcestructure_json must be a JSON object".to_string());
    }
    if !studypar_json.is_object() {
        return Err("studypar_json must be a JSON object".to_string());
    }
    let matlab_path = validate_matlab_executable(&matlab_path)?;

    let project_root = derive_project_root(&staging_root);
    let stream_subject_list = subject_list.clone();
    reserve_import_state(&state, staging_root.clone(), project_root, subject_list)?;

    cleanup_staging_root(&staging_root).map_err(|e| {
        clear_reserved_import(&state);
        e
    })?;

    let symlink_entries = staging_entries
        .into_iter()
        .map(StagingEntry::into_symlink_entry)
        .collect();
    create_symlink_tree(symlink_entries, staging_root.to_string_lossy().to_string())
        .map_err(|e| rollback_reserved_preparation_failure(&state, &staging_root, e))?;

    fs::create_dir_all(&staging_root).map_err(|e| {
        rollback_reserved_preparation_failure(
            &state,
            &staging_root,
            format!(
                "Failed to create staging directory {}: {}",
                staging_root.display(),
                e
            ),
        )
    })?;
    write_config_json(
        &staging_root.join("sourcestructure.json"),
        &sourcestructure_json,
    )
    .map_err(|e| rollback_reserved_preparation_failure(&state, &staging_root, e))?;
    write_config_json(&staging_root.join("studyPar.json"), &studypar_json)
        .map_err(|e| rollback_reserved_preparation_failure(&state, &staging_root, e))?;

    app.emit("ImportPrepareComplete", ImportPrepareComplete)
        .map_err(|e| {
            cleanup_after_prepare_event_failure(
                &state,
                &staging_root,
                format!("Failed to emit ImportPrepareComplete: {}", e),
            )
        })?;

    let batch = format!(
        "addpath('{}'); ExploreASL('{}', [1,1,0], 0, 0)",
        escape_matlab_string(&exploreasl_path),
        escape_matlab_string(&staging_root.to_string_lossy()),
    );
    let mut child = spawn_matlab_import_process(&matlab_path, &batch).map_err(|e| {
        clear_reserved_import(&state);
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("MATLAB executable not found: {}", matlab_path)
        } else {
            format!("Failed to spawn MATLAB import process: {}", e)
        }
    })?;
    let child_pid = child.id();

    if let Err(err) = set_reserved_import_pid(&state, child_pid) {
        let _ = child.kill();
        let _ = child.wait();
        clear_reserved_import(&state);
        return Err(err);
    }

    let supervisor_handle = supervise_import_process(app, child_pid, child, stream_subject_list);
    if let Err(err) = set_import_supervisor_handle(&state, child_pid, supervisor_handle) {
        clear_reserved_import(&state);
        return Err(err);
    }

    Ok(child_pid)
}

#[tauri::command]
pub fn stop_import(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    stop_import_pid(&state, pid)
}

#[tauri::command]
pub fn clean_import_status(staging_root: String, subjects: Vec<String>) -> Result<(), String> {
    let staging_root = validate_path_input("staging_root", &staging_root)?;
    validate_staging_root(&staging_root)?;
    clean_import_status_paths(&staging_root, &subjects)
}

#[tauri::command]
pub fn move_import_output(
    staging_root: String,
    project_root: String,
    succeeded_subjects: Option<Vec<String>>,
    debug_mode: bool,
) -> Result<(), String> {
    let staging_root = validate_path_input("staging_root", &staging_root)?;
    let project_root = validate_path_input("project_root", &project_root)?;
    move_import_output_paths(
        &staging_root,
        &project_root,
        succeeded_subjects.as_deref(),
        debug_mode,
    )
}

#[tauri::command]
pub fn copy_lock_files(
    project_root: String,
    staging_root: String,
    subjects: Vec<String>,
) -> Result<(), String> {
    let project_root = validate_path_input("project_root", &project_root)?;
    let staging_root = validate_path_input("staging_root", &staging_root)?;
    validate_staging_root(&staging_root)?;
    copy_lock_files_paths(&project_root, &staging_root, &subjects)
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

fn derive_project_root(staging_root: &Path) -> PathBuf {
    staging_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| staging_root.to_path_buf())
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
mod tests {
    use super::{
        authorize_stop_import_pid, clean_import_status_paths, cleanup_after_prepare_event_failure,
        cleanup_staging_root, clear_import_child_pid_if_matches, copy_lock_files_paths,
        find_executable_on_path, mark_import_termination_requested, move_import_output_paths,
        parse_import_lines, parse_import_stream_lines, reserve_import_state,
        rollback_preparation_failure, should_emit_matlab_exit_error,
        take_matching_supervisor_handle, validate_import_not_running, validate_matlab_executable,
        validate_non_empty_inputs, validate_project_root_for_staging, validate_staging_root,
        validate_subject_components, AppState, ImportOutputLine, ImportOutputLineSource,
        ImportState, ImportStructuredEvent, MatlabExitError, StagingEntry, RESERVED_IMPORT_PID,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!("exploreasl-gui-{name}-{suffix}"))
    }

    #[test]
    fn import_state_new_tracks_roots_and_subjects() {
        let staging_root = PathBuf::from("/tmp/project/.easl_staging");
        let project_root = PathBuf::from("/tmp/project");
        let subject_list = vec!["sub-001".to_string(), "sub-002".to_string()];

        let state = ImportState::new(
            staging_root.clone(),
            project_root.clone(),
            subject_list.clone(),
        );

        assert_eq!(state.child_pid, None);
        assert_eq!(state.staging_root, staging_root);
        assert_eq!(state.project_root, project_root);
        assert!(state.failed_subjects.is_empty());
        assert!(state.succeeded_subjects.is_empty());
        assert_eq!(state.subject_list, subject_list);
        assert!(state.supervisor_handle.is_none());
    }

    #[test]
    fn cleanup_staging_root_removes_existing_directory() {
        let staging_root = unique_temp_path("staging-cleanup");
        fs::create_dir_all(staging_root.join("sourcedata"))
            .expect("test staging directory should be created");
        fs::write(staging_root.join("sourcedata").join("marker.txt"), "stale")
            .expect("test marker should be written");

        cleanup_staging_root(&staging_root).expect("cleanup should remove staging root");

        assert!(!staging_root.exists());
    }

    #[test]
    fn validate_staging_root_requires_easl_staging_leaf() {
        let invalid_root = PathBuf::from("/tmp/project/rawdata");

        let error =
            validate_staging_root(&invalid_root).expect_err("non-staging root should be rejected");

        assert_eq!(
            error,
            "staging_root must end with .easl_staging: /tmp/project/rawdata"
        );
    }

    #[test]
    fn validate_staging_root_accepts_easl_staging_leaf() {
        let staging_root = PathBuf::from("/tmp/project/.easl_staging");

        validate_staging_root(&staging_root)
            .expect("staging root ending in .easl_staging should be accepted");
    }

    #[test]
    fn staging_entry_deserializes_frontend_source_path_and_converts_to_symlink_entry() {
        let entry: StagingEntry = serde_json::from_value(serde_json::json!({
            "subject": "sub-001",
            "session": "01",
            "run": "01",
            "modality": "ASL4D",
            "sourcePath": "/dicom/sub-001/asl"
        }))
        .expect("frontend staging entry should deserialize");

        let symlink_entry = entry.into_symlink_entry();

        assert_eq!(symlink_entry.subject, "sub-001");
        assert_eq!(symlink_entry.session, "01");
        assert_eq!(symlink_entry.run, "01");
        assert_eq!(symlink_entry.modality, "ASL4D");
        assert_eq!(symlink_entry.source_path, "/dicom/sub-001/asl");
    }

    #[test]
    fn rollback_preparation_failure_removes_partial_staging_and_preserves_error() {
        let staging_root = unique_temp_path("staging-rollback");
        fs::create_dir_all(staging_root.join("sourcedata").join("sub-001"))
            .expect("partial staging directory should be created");
        fs::write(
            staging_root
                .join("sourcedata")
                .join("sub-001")
                .join("marker.txt"),
            "partial",
        )
        .expect("partial staging marker should be written");

        let error = rollback_preparation_failure(&staging_root, "config write failed".to_string());

        assert_eq!(error, "config write failed");
        assert!(!staging_root.exists());
    }

    #[test]
    fn cleanup_after_prepare_event_failure_clears_reserved_state_and_removes_staging() {
        let app_state = AppState::default();
        let staging_root = unique_temp_path("prepare-event-failure");
        fs::create_dir_all(staging_root.join("sourcedata").join("sub-001"))
            .expect("prepared staging directory should be created");
        reserve_import_state(
            &app_state,
            staging_root.clone(),
            staging_root
                .parent()
                .expect("staging root should have parent")
                .to_path_buf(),
            vec!["sub-001".to_string()],
        )
        .expect("import state should be reserved");

        let error = cleanup_after_prepare_event_failure(
            &app_state,
            &staging_root,
            "Failed to emit ImportPrepareComplete: closed".to_string(),
        );

        assert_eq!(error, "Failed to emit ImportPrepareComplete: closed");
        assert!(!staging_root.exists());
        let state = app_state
            .import_state
            .lock()
            .expect("import state lock should be available");
        assert_eq!(state.child_pid, None);
    }

    #[test]
    fn validate_non_empty_inputs_rejects_empty_staging_entries_before_mutation() {
        let error = validate_non_empty_inputs(&[], &["sub-001".to_string()])
            .expect_err("empty staging entries should be rejected");

        assert_eq!(
            error,
            "staging_entries must contain at least one staging entry"
        );
    }

    #[test]
    fn validate_non_empty_inputs_rejects_empty_subject_list_before_mutation() {
        let entries = vec![StagingEntry {
            subject: "sub-001".to_string(),
            session: "01".to_string(),
            run: "01".to_string(),
            modality: "ASL4D".to_string(),
            source_path: "/dicom/sub-001/asl".to_string(),
        }];

        let error = validate_non_empty_inputs(&entries, &[])
            .expect_err("empty subject list should be rejected");

        assert_eq!(error, "subject_list must contain at least one subject");
    }

    #[test]
    fn validate_matlab_executable_rejects_missing_path_like_value() {
        let missing = unique_temp_path("missing-matlab").join("matlab");

        let error = validate_matlab_executable(&missing.to_string_lossy())
            .expect_err("missing matlab path should be rejected");

        assert!(error.contains("MATLAB executable not found"));
    }

    #[test]
    fn validate_matlab_executable_rejects_directory_path() {
        let matlab_dir = unique_temp_path("matlab-dir");
        fs::create_dir_all(&matlab_dir).expect("test matlab dir should be created");

        let error = validate_matlab_executable(&matlab_dir.to_string_lossy())
            .expect_err("directory should not be accepted as matlab executable");

        assert!(error.contains("MATLAB path is not a file"));

        let _ = fs::remove_dir_all(matlab_dir);
    }

    #[cfg(unix)]
    #[test]
    fn validate_matlab_executable_rejects_non_executable_file() {
        use std::os::unix::fs::PermissionsExt;

        let matlab = unique_temp_path("matlab-non-executable");
        fs::write(&matlab, "#!/bin/sh\n").expect("test matlab file should be written");
        fs::set_permissions(&matlab, fs::Permissions::from_mode(0o644))
            .expect("test matlab permissions should be set");

        let error = validate_matlab_executable(&matlab.to_string_lossy())
            .expect_err("non-executable matlab file should be rejected");

        assert!(error.contains("MATLAB executable is not executable"));

        let _ = fs::remove_file(matlab);
    }

    #[cfg(unix)]
    #[test]
    fn validate_matlab_executable_accepts_executable_file() {
        use std::os::unix::fs::PermissionsExt;

        let matlab = unique_temp_path("matlab-executable");
        fs::write(&matlab, "#!/bin/sh\n").expect("test matlab file should be written");
        fs::set_permissions(&matlab, fs::Permissions::from_mode(0o755))
            .expect("test matlab permissions should be set");

        let validated = validate_matlab_executable(&matlab.to_string_lossy())
            .expect("executable matlab file should be accepted");

        assert_eq!(validated, matlab.to_string_lossy());

        let _ = fs::remove_file(matlab);
    }

    #[test]
    fn find_executable_on_path_accepts_bare_command_from_supplied_path() {
        let bin_dir = unique_temp_path("matlab-path-bin");
        fs::create_dir_all(&bin_dir).expect("test bin dir should be created");
        let matlab = bin_dir.join("matlab");
        fs::write(&matlab, "#!/bin/sh\n").expect("test matlab command should be written");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&matlab, fs::Permissions::from_mode(0o755))
                .expect("test matlab command permissions should be set");
        }

        let found = find_executable_on_path("matlab", &bin_dir.to_string_lossy())
            .expect("bare matlab command should be found on supplied PATH");

        assert_eq!(found, matlab);

        let _ = fs::remove_dir_all(bin_dir);
    }

    #[test]
    fn validate_import_not_running_rejects_active_child_pid() {
        let mut state = ImportState::new(
            PathBuf::from("/tmp/project/.easl_staging"),
            PathBuf::from("/tmp/project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);

        let error = validate_import_not_running(&state)
            .expect_err("active import pid should reject a new import");

        assert_eq!(error, "An import is already running with process PID 42");
    }

    #[test]
    fn clear_import_child_pid_if_matches_only_clears_matching_pid() {
        let mut state = ImportState::new(
            PathBuf::from("/tmp/project/.easl_staging"),
            PathBuf::from("/tmp/project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);

        clear_import_child_pid_if_matches(&mut state, 7);
        assert_eq!(state.child_pid, Some(42));

        clear_import_child_pid_if_matches(&mut state, 42);
        assert_eq!(state.child_pid, None);
    }

    #[test]
    fn authorize_stop_import_pid_rejects_no_active_import() {
        let state = AppState::default();

        let error = authorize_stop_import_pid(&state, 42)
            .expect_err("stop should reject when no import is active");

        assert_eq!(error, "No import process is currently running");
    }

    #[test]
    fn authorize_stop_import_pid_rejects_reserved_import_pid() {
        let state = AppState::default();
        {
            let mut import_state = state
                .import_state
                .lock()
                .expect("import state lock should be available");
            import_state.child_pid = Some(RESERVED_IMPORT_PID);
        }

        let error = authorize_stop_import_pid(&state, RESERVED_IMPORT_PID)
            .expect_err("reserved import PID must not be signaled");

        assert_eq!(error, "Import is still preparing and cannot be stopped yet");
    }

    #[test]
    fn authorize_stop_import_pid_rejects_mismatched_pid() {
        let state = AppState::default();
        {
            let mut import_state = state
                .import_state
                .lock()
                .expect("import state lock should be available");
            import_state.child_pid = Some(42);
        }

        let error = authorize_stop_import_pid(&state, 7)
            .expect_err("stop should reject PIDs not owned by import state");

        assert_eq!(error, "Requested PID 7 does not match active import PID 42");
    }

    #[test]
    fn authorize_stop_import_pid_accepts_matching_active_pid() {
        let state = AppState::default();
        {
            let mut import_state = state
                .import_state
                .lock()
                .expect("import state lock should be available");
            import_state.child_pid = Some(42);
        }

        authorize_stop_import_pid(&state, 42).expect("matching import PID should be accepted");
    }

    #[test]
    fn validate_subject_components_rejects_path_traversal_and_separators() {
        for invalid_subject in ["", ".", "..", "../evil", "evil/subject", "evil\\subject"] {
            let error = validate_subject_components(&[invalid_subject.to_string()])
                .expect_err("invalid subject path component should be rejected");

            assert!(error.contains("Invalid subject"));
        }
    }

    #[test]
    fn validate_subject_components_accepts_single_path_components() {
        validate_subject_components(&["BADDIE_ses-01_run-1".to_string()])
            .expect("single path component subject should be accepted");
    }

    #[test]
    fn validate_project_root_for_staging_rejects_mismatched_roots() {
        let staging_root = unique_temp_path("root-mismatch-staging").join(".easl_staging");
        let project_root = unique_temp_path("root-mismatch-project");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        fs::create_dir_all(&project_root).expect("project root should be created");

        let error = validate_project_root_for_staging(&staging_root, &project_root)
            .expect_err("project root must be the staging parent");

        assert!(error.contains("project_root must be the parent of staging_root"));

        let _ = fs::remove_dir_all(
            staging_root
                .parent()
                .expect("staging root should have parent"),
        );
        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn validate_project_root_for_staging_accepts_staging_parent() {
        let project_root = unique_temp_path("root-match-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");

        validate_project_root_for_staging(&staging_root, &project_root)
            .expect("project root parent should be accepted");

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_rejects_project_root_mismatch_before_deleting_outputs() {
        let project_root = unique_temp_path("move-mismatch-project");
        let staging_parent = unique_temp_path("move-mismatch-staging-parent");
        let staging_root = staging_parent.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        fs::create_dir_all(project_root.join("rawdata"))
            .expect("project rawdata should be created");
        fs::write(project_root.join("rawdata").join("keep.txt"), "keep")
            .expect("project marker should be written");

        let error = move_import_output_paths(&staging_root, &project_root, None, false)
            .expect_err("mismatched project root should be rejected");

        assert!(error.contains("project_root must be the parent of staging_root"));
        assert_eq!(
            fs::read_to_string(project_root.join("rawdata").join("keep.txt"))
                .expect("project marker should remain"),
            "keep"
        );

        let _ = fs::remove_dir_all(project_root);
        let _ = fs::remove_dir_all(staging_parent);
    }

    #[test]
    fn copy_lock_files_rejects_project_root_mismatch_before_writing_staging() {
        let project_root = unique_temp_path("copy-mismatch-project");
        let staging_parent = unique_temp_path("copy-mismatch-staging-parent");
        let staging_root = staging_parent.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");
        write_status_files(&project_root, "BADDIE");

        let error = copy_lock_files_paths(&project_root, &staging_root, &["BADDIE".to_string()])
            .expect_err("mismatched project root should be rejected");

        assert!(error.contains("project_root must be the parent of staging_root"));
        assert!(!import_lock_dir(&staging_root, "BADDIE").exists());

        let _ = fs::remove_dir_all(project_root);
        let _ = fs::remove_dir_all(staging_parent);
    }

    #[test]
    fn clean_import_status_rejects_traversal_subjects() {
        let staging_root = unique_temp_path("clean-traversal").join(".easl_staging");

        let error = clean_import_status_paths(&staging_root, &["../evil".to_string()])
            .expect_err("traversal subject should be rejected");

        assert!(error.contains("Invalid subject"));
    }

    #[test]
    fn copy_lock_files_rejects_traversal_subjects() {
        let project_root = unique_temp_path("copy-traversal-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");

        let error =
            copy_lock_files_paths(&project_root, &staging_root, &["evil/subject".to_string()])
                .expect_err("separator subject should be rejected");

        assert!(error.contains("Invalid subject"));

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_partial_rejects_traversal_subjects() {
        let project_root = unique_temp_path("move-partial-traversal");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(&staging_root).expect("staging root should be created");

        let error = move_import_output_paths(
            &staging_root,
            &project_root,
            Some(&["..".to_string()]),
            false,
        )
        .expect_err("partial move should reject traversal subjects");

        assert!(error.contains("Invalid subject"));

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn intentional_termination_suppresses_matlab_exit_error_once() {
        let mut state = ImportState::new(
            PathBuf::from("/tmp/project/.easl_staging"),
            PathBuf::from("/tmp/project"),
            vec!["sub-001".to_string()],
        );
        state.child_pid = Some(42);
        mark_import_termination_requested(&mut state, 42);

        assert!(!should_emit_matlab_exit_error(&mut state, 42, false));
        assert!(should_emit_matlab_exit_error(&mut state, 42, false));
    }

    #[test]
    fn supervisor_handle_cleanup_preserves_termination_intent_until_exit_decision() {
        let state = AppState::default();
        {
            let mut import_state = state
                .import_state
                .lock()
                .expect("import state lock should be available");
            import_state.child_pid = Some(42);
            mark_import_termination_requested(&mut import_state, 42);
        }

        let handle = take_matching_supervisor_handle(&state, 42);
        assert!(handle.is_none());

        let mut import_state = state
            .import_state
            .lock()
            .expect("import state lock should be available");
        assert_eq!(import_state.child_pid, None);
        assert_eq!(import_state.termination_requested_for, Some(42));
        assert!(!should_emit_matlab_exit_error(&mut import_state, 42, false));
        assert_eq!(import_state.termination_requested_for, None);
    }

    #[test]
    fn successful_matlab_exit_does_not_emit_exit_error() {
        let mut state = ImportState::new(
            PathBuf::from("/tmp/project/.easl_staging"),
            PathBuf::from("/tmp/project"),
            vec!["sub-001".to_string()],
        );

        assert!(!should_emit_matlab_exit_error(&mut state, 42, true));
    }

    #[test]
    fn parser_emits_subject_start_from_module_line() {
        let events = parse_import_lines(
            &["Subject: BADDIE, Module: xASL_module_Import".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::SubjectStart {
                subject: "BADDIE".to_string(),
                step: "DCM2NII".to_string(),
            }]
        );
    }

    #[test]
    fn parser_emits_subject_completion_with_duration_for_current_subject() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 42
                },
            ]
        );
    }

    #[test]
    fn parser_emits_import_complete_from_completion_line() {
        let events = parse_import_lines(
            &["xASL_module_Import completed 100%".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(events, vec![ImportStructuredEvent::ImportComplete]);
    }

    #[test]
    fn parser_matches_nii2bids_failure_subject_substring_and_message_lines() {
        let events = parse_import_lines(
            &[
                "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1".to_string(),
                "Message: LabelingDuration has invalid value".to_string(),
                "Message: Check studyPar.json".to_string(),
                "".to_string(),
            ],
            &["BADDIE".to_string(), "GOODIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::ImportFailed {
                subject: "BADDIE".to_string(),
                step: "NII2BIDS".to_string(),
                message: "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1\nLabelingDuration has invalid value\nCheck studyPar.json".to_string(),
            }]
        );
    }

    #[test]
    fn parser_matches_dcm2nii_failure_subject_substring() {
        let events = parse_import_lines(
            &["DCM2NII failed for source folder BADDIE_ses-01_run-1".to_string()],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![ImportStructuredEvent::ImportFailed {
                subject: "BADDIE".to_string(),
                step: "DCM2NII".to_string(),
                message: "DCM2NII failed for source folder BADDIE_ses-01_run-1".to_string(),
            }]
        );
    }

    #[test]
    fn parser_emits_dcm2nii_status_with_current_subject_context() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "status: 1".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::Dcm2NiiStatus {
                    subject: "BADDIE".to_string(),
                    exit_code: 1
                },
            ]
        );
    }

    #[test]
    fn parser_does_not_emit_subject_completion_if_subject_failed() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1".to_string(),
                "Message: LabelingDuration has invalid value".to_string(),
                "".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["BADDIE".to_string()],
        );

        assert!(events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed { .. })));
        assert!(!events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
    }

    #[test]
    fn parser_user_reported_failure() {
        let events = parse_import_lines(
            &[
                "Subject: C9ORF059Siemens, Module: xASL_module_Import".to_string(),
                "[=========================================== CONVERT RUN ======================================]".to_string(),
                "Converting subject C9ORF059Siemens, session 11, run ASL_1, scan sub-C9ORF059Siemens_ses-11_T1w ...".to_string(),
                "scan sub-C9ORF059Siemens_ses-11_T2w ...".to_string(),
                "scan sub-C9ORF059Siemens_ses-11_asl ...".to_string(),
                "Warning: The following user-defined/DICOM fields and DICOM-Phoenix fields differ:  SoftwareVersions PostLabelingDelay BolusCutOffDelayTime".to_string(),
                "".to_string(),
                "[==============================================================================================]".to_string(),
                "NII2BIDS failed for perfusion image of C9ORF059Siemens_ses-11_run-1".to_string(),
                "Message: Unknown value in BIDS fields M0Type".to_string(),
                "xASL_imp_NII2BIDS_Subject_DefineM0Type, line 47...".to_string(),
                "Continuing...".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 42 seconds".to_string(),
            ],
            &["C9ORF059Siemens".to_string()],
        );

        assert!(events.iter().any(|e| matches!(e, ImportStructuredEvent::ImportFailed {
            ref subject,
            ref step,
            ref message,
        } if subject == "C9ORF059Siemens" && step == "NII2BIDS" && message.contains("Unknown value in BIDS fields M0Type"))));
        assert!(!events.iter().any(|e| matches!(e, ImportStructuredEvent::SubjectComplete { .. })));
    }

    #[test]
    fn parser_detects_step_transitions_and_updates_subject_start_step() {
        let events = parse_import_lines(
            &[
                "Subject: BADDIE, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 1 stopped at 12:34:56 and took 10 seconds".to_string(),
                "Subject: GOODIE, Module: xASL_module_Import".to_string(),
                "DICOM to NIFTI CONVERSION".to_string(),
                "NIFTI to BIDS CONVERSION".to_string(),
                "Job-iteration 2 stopped at 12:35:56 and took 15 seconds".to_string(),
            ],
            &["BADDIE".to_string(), "GOODIE".to_string()],
        );

        assert_eq!(
            events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "NII2BIDS".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 10
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "GOODIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectStart {
                    subject: "GOODIE".to_string(),
                    step: "NII2BIDS".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "GOODIE".to_string(),
                    duration_secs: 15
                },
            ]
        );
    }

    #[test]
    fn stream_parser_logs_stderr_without_mutating_stdout_parser_state() {
        let parsed = parse_import_stream_lines(
            &[
                ImportOutputLine::stderr("Subject: NOISY, Module: xASL_module_Import"),
                ImportOutputLine::stdout("Subject: BADDIE, Module: xASL_module_Import"),
                ImportOutputLine::stderr(
                    "Job-iteration 99 stopped at 12:34:56 and took 999 seconds",
                ),
                ImportOutputLine::stdout("Job-iteration 1 stopped at 12:35:56 and took 42 seconds"),
            ],
            &["BADDIE".to_string(), "NOISY".to_string()],
        );

        assert_eq!(
            parsed
                .raw_events
                .iter()
                .map(|event| event.line.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Subject: NOISY, Module: xASL_module_Import",
                "Subject: BADDIE, Module: xASL_module_Import",
                "Job-iteration 99 stopped at 12:34:56 and took 999 seconds",
                "Job-iteration 1 stopped at 12:35:56 and took 42 seconds",
            ]
        );
        assert_eq!(
            parsed.structured_events,
            vec![
                ImportStructuredEvent::SubjectStart {
                    subject: "BADDIE".to_string(),
                    step: "DCM2NII".to_string(),
                },
                ImportStructuredEvent::SubjectComplete {
                    subject: "BADDIE".to_string(),
                    duration_secs: 42
                },
            ]
        );
    }

    #[test]
    fn import_output_line_constructors_tag_stream_source() {
        assert_eq!(
            ImportOutputLine::stdout("ready").source,
            ImportOutputLineSource::Stdout
        );
        assert_eq!(
            ImportOutputLine::stderr("warning").source,
            ImportOutputLineSource::Stderr
        );
    }

    fn import_lock_dir(root: &std::path::Path, subject: &str) -> PathBuf {
        root.join("derivatives")
            .join("ExploreASL")
            .join("lock")
            .join("xASL_module_Import")
            .join(subject)
            .join("xASL_module_Import")
    }

    fn write_status_files(root: &std::path::Path, subject: &str) {
        let lock_dir = import_lock_dir(root, subject);
        fs::create_dir_all(&lock_dir).expect("lock dir should be created");
        for file_name in [
            "010_DCM2NII.status",
            "020_NII2BIDS.status",
            "999_ready.status",
        ] {
            fs::write(lock_dir.join(file_name), file_name).expect("status file should be written");
        }
    }

    #[test]
    fn clean_import_status_removes_only_expected_status_files_and_ignores_missing() {
        let staging_root = unique_temp_path("clean-import-status");
        write_status_files(&staging_root, "BADDIE");
        let lock_dir = import_lock_dir(&staging_root, "BADDIE");
        fs::write(lock_dir.join("keep.status"), "keep").expect("extra file should be written");

        clean_import_status_paths(
            &staging_root,
            &["BADDIE".to_string(), "MISSING".to_string()],
        )
        .expect("cleaning import statuses should succeed");

        assert!(!lock_dir.join("010_DCM2NII.status").exists());
        assert!(!lock_dir.join("020_NII2BIDS.status").exists());
        assert!(!lock_dir.join("999_ready.status").exists());
        assert_eq!(
            fs::read_to_string(lock_dir.join("keep.status")).expect("extra file should remain"),
            "keep"
        );

        let _ = fs::remove_dir_all(staging_root);
    }

    #[test]
    fn copy_lock_files_copies_expected_status_files_and_creates_destination_dirs() {
        let project_root = unique_temp_path("copy-lock-project");
        let staging_root = project_root.join(".easl_staging");
        write_status_files(&project_root, "BADDIE");

        copy_lock_files_paths(&project_root, &staging_root, &["BADDIE".to_string()])
            .expect("lock files should be copied");

        let staging_lock_dir = import_lock_dir(&staging_root, "BADDIE");
        for file_name in [
            "010_DCM2NII.status",
            "020_NII2BIDS.status",
            "999_ready.status",
        ] {
            assert_eq!(
                fs::read_to_string(staging_lock_dir.join(file_name))
                    .expect("copied status file should exist"),
                file_name
            );
        }

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_full_success_replaces_project_outputs_and_removes_staging() {
        let project_root = unique_temp_path("move-full-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(project_root.join("rawdata").join("old"))
            .expect("old project rawdata should be created");
        fs::create_dir_all(project_root.join("derivatives").join("old"))
            .expect("old project derivatives should be created");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-BADDIE"))
            .expect("staging rawdata should be created");
        fs::write(
            staging_root
                .join("rawdata")
                .join("sub-BADDIE")
                .join("asl.nii"),
            "asl",
        )
        .expect("staging rawdata file should be written");
        write_status_files(&staging_root, "BADDIE");
        fs::write(staging_root.join("sourcestructure.json"), "{}")
            .expect("sourcestructure should be written");
        fs::write(staging_root.join("studyPar.json"), "{}").expect("studyPar should be written");

        move_import_output_paths(&staging_root, &project_root, None, false)
            .expect("full move should succeed");

        assert!(project_root
            .join("rawdata")
            .join("sub-BADDIE")
            .join("asl.nii")
            .exists());
        assert!(import_lock_dir(&project_root, "BADDIE")
            .join("010_DCM2NII.status")
            .exists());
        assert!(!project_root.join("rawdata").join("old").exists());
        assert!(!project_root.join("derivatives").join("old").exists());
        assert!(!staging_root.exists());

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_full_success_debug_preserves_staging_and_copies_configs() {
        let project_root = unique_temp_path("move-full-debug-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata")).expect("staging rawdata should exist");
        fs::create_dir_all(staging_root.join("derivatives"))
            .expect("staging derivatives should exist");
        fs::write(
            staging_root.join("sourcestructure.json"),
            "{\"source\":true}",
        )
        .expect("sourcestructure should be written");
        fs::write(staging_root.join("studyPar.json"), "{\"study\":true}")
            .expect("studyPar should be written");

        move_import_output_paths(&staging_root, &project_root, None, true)
            .expect("debug full move should succeed");

        assert!(staging_root.exists());
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("derivatives")
                    .join("ExploreASL_GUI")
                    .join("sourcestructure.json")
            )
            .expect("sourcestructure config should be copied"),
            "{\"source\":true}"
        );
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("derivatives")
                    .join("ExploreASL_GUI")
                    .join("studyPar.json")
            )
            .expect("studyPar config should be copied"),
            "{\"study\":true}"
        );

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_partial_success_copies_succeeded_subject_artifacts_only() {
        let project_root = unique_temp_path("move-partial-project");
        let staging_root = project_root.join(".easl_staging");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-BADDIE"))
            .expect("succeeded rawdata should exist");
        fs::create_dir_all(staging_root.join("rawdata").join("sub-FAILED"))
            .expect("failed rawdata should exist");
        fs::write(
            staging_root
                .join("rawdata")
                .join("sub-BADDIE")
                .join("asl.nii"),
            "asl",
        )
        .expect("succeeded rawdata should be written");
        fs::write(
            staging_root
                .join("rawdata")
                .join("dataset_description.json"),
            "{\"Name\":\"Study\"}",
        )
        .expect("dataset description should be written");
        write_status_files(&staging_root, "BADDIE");
        write_status_files(&staging_root, "FAILED");
        let log_dir = staging_root
            .join("derivatives")
            .join("ExploreASL")
            .join("log");
        fs::create_dir_all(&log_dir).expect("log dir should exist");
        fs::write(log_dir.join("import_sub-BADDIE.log"), "ok").expect("matching log should exist");
        fs::write(log_dir.join("import_sub-FAILED.log"), "bad").expect("other log should exist");

        move_import_output_paths(
            &staging_root,
            &project_root,
            Some(&["BADDIE".to_string()]),
            false,
        )
        .expect("partial move should succeed");

        assert!(staging_root.exists());
        assert!(project_root
            .join("rawdata")
            .join("sub-BADDIE")
            .join("asl.nii")
            .exists());
        assert!(!project_root.join("rawdata").join("sub-FAILED").exists());
        assert_eq!(
            fs::read_to_string(
                project_root
                    .join("rawdata")
                    .join("dataset_description.json")
            )
            .expect("dataset description should be copied"),
            "{\"Name\":\"Study\"}"
        );
        assert!(import_lock_dir(&project_root, "BADDIE")
            .join("999_ready.status")
            .exists());
        assert!(!import_lock_dir(&project_root, "FAILED").exists());
        assert!(project_root
            .join("derivatives")
            .join("ExploreASL")
            .join("log")
            .join("import_sub-BADDIE.log")
            .exists());
        assert!(!project_root
            .join("derivatives")
            .join("ExploreASL")
            .join("log")
            .join("import_sub-FAILED.log")
            .exists());

        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn move_import_output_rejects_destructive_delete_outside_easl_staging_leaf() {
        let project_root = unique_temp_path("move-safety-project");
        let unsafe_staging_root = project_root.join("not-staging");

        let error = move_import_output_paths(&unsafe_staging_root, &project_root, None, false)
            .expect_err("non .easl_staging roots should be rejected");

        assert!(error.contains("staging_root must end with .easl_staging"));
        let _ = fs::remove_dir_all(project_root);
    }

    #[test]
    fn matlab_exit_error_serializes_exit_code() {
        let value = serde_json::to_value(MatlabExitError { exit_code: 42 })
            .expect("MatlabExitError should serialize");

        assert_eq!(value, serde_json::json!({ "exitCode": 42 }));
    }
}
