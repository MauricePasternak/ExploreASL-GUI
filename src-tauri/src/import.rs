use crate::commands::{create_symlink_tree, SymlinkEntry};
use crate::import_parser::*;
use crate::processing::ProcessState;
use serde::Deserialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const RESERVED_IMPORT_PID: u32 = 0;
const IMPORT_STATUS_FILES: [&str; 3] = [
    "010_DCM2NII.status",
    "020_NII2BIDS.status",
    "999_ready.status",
];

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

pub struct AppState {
    pub import_state: Mutex<ImportState>,
    pub processing_state: Mutex<ProcessState>,
    pub active_project_root: Mutex<Option<PathBuf>>,
    pub active_data: std::sync::Mutex<Option<crate::visualization::ActiveData>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            import_state: Mutex::new(ImportState::default()),
            processing_state: Mutex::new(ProcessState::default()),
            active_project_root: Mutex::new(None),
            active_data: std::sync::Mutex::new(None),
        }
    }
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
pub struct ImportPrepareComplete;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatlabExitError {
    pub exit_code: i32,
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
    let is_progress = progress_bar_re().is_match(&output_line.line);
    if !is_progress {
        let trimmed = output_line.line.trim().to_string();
        if !parser.is_duplicate(&trimmed) {
            parser.record_line(trimmed);
            let _ = app.emit(
                "import-raw-event",
                ImportRawEvent {
                    line: output_line.line.clone(),
                },
            );
        }
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
#[allow(clippy::too_many_arguments)]
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
    subjects_to_preserve: Option<Vec<String>>,
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
    reserve_import_state(
        &state,
        staging_root.clone(),
        project_root.clone(),
        subject_list,
    )?;

    cleanup_staging_root(&staging_root).inspect_err(|_| {
        clear_reserved_import(&state);
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

    if let Some(ref subjects) = subjects_to_preserve {
        if !subjects.is_empty() {
            copy_lock_files_paths(&project_root, &staging_root, subjects)
                .map_err(|e| rollback_reserved_preparation_failure(&state, &staging_root, e))?;
        }
    }

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
#[path = "import_tests.rs"]
mod import_tests;
