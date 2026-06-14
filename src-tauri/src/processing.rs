use crate::import::AppState;
use crate::tracing::CommandTrace;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

#[derive(Debug)]
pub struct ProcessState {
  pub worker_pids: Vec<u32>,
  pub watcher_handle: Option<thread::JoinHandle<()>>,
  pub watcher_stop: Option<mpsc::Sender<()>>,
  pub project_root: PathBuf,
}

impl Default for ProcessState {
  fn default() -> Self {
    Self {
      worker_pids: Vec::new(),
      watcher_handle: None,
      watcher_stop: None,
      project_root: PathBuf::new(),
    }
  }
}

pub fn module_index_to_name(index: usize) -> &'static str {
  match index {
    0 => "xASL_module_Structural",
    1 => "xASL_module_ASL",
    2 => "xASL_module_Population",
    _ => panic!("Invalid module index: {}", index),
  }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInfo {
  pub subject_session: String,
  pub subject: String,
  pub session: String,
  pub has_structural: bool,
  #[serde(rename = "hasASL")]
  pub has_asl: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectModuleStatus {
  pub subject_session: String,
  #[serde(rename = "module")]
  pub module_name: String,
  pub run: Option<String>,
  pub status: String,
  pub completed_steps: Vec<String>,
  pub locked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerExited {
  pub pid: u32,
  pub exit_code: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFileCreated {
  pub module: String,
  pub subject_session: Option<String>,
  pub step_code: String,
  pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockCreated {
  pub module: String,
  pub subject_session: Option<String>,
  pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockRemoved {
  pub module: String,
  pub subject_session: Option<String>,
  pub run: Option<String>,
}

#[tauri::command]
pub fn list_subjects(project_root: String) -> Result<Vec<SubjectInfo>, String> {
  let trace = CommandTrace::new("list_subjects");
  trace.arg("project_root", &project_root);

  let root = PathBuf::from(project_root);
  let rawdata = root.join("rawdata");
  if !rawdata.exists() {
    trace.success(&Vec::<SubjectInfo>::new());
    return Ok(Vec::new());
  }

  let mut subjects = Vec::new();
  for entry in std::fs::read_dir(&rawdata).map_err(|e| format!("Failed to read rawdata: {}", e))? {
    let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
    if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
      continue;
    }
    let file_name = entry.file_name().to_string_lossy().to_string();
    if !file_name.starts_with("sub-") {
      continue;
    }
    let subject = file_name.strip_prefix("sub-").unwrap().to_string();
    let subject_path = entry.path();

    for ses_entry in
      std::fs::read_dir(&subject_path).map_err(|e| format!("Failed to read subject dir: {}", e))?
    {
      let ses_entry = ses_entry.map_err(|e| format!("Failed to read session entry: {}", e))?;
      if !ses_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
        continue;
      }
      let ses_name = ses_entry.file_name().to_string_lossy().to_string();
      if !ses_name.starts_with("ses-") {
        continue;
      }
      let session = ses_name.strip_prefix("ses-").unwrap().to_string();
      let session_path = ses_entry.path();

      let has_structural = session_path.join("anat").exists();
      let has_asl = session_path.join("perf").exists();
      let subject_session = format!("sub-{}_{}", subject, session);

      subjects.push(SubjectInfo {
        subject_session,
        subject: subject.clone(),
        session,
        has_structural,
        has_asl,
      });
    }
  }

  trace.success(&subjects);
  Ok(subjects)
}

pub(crate) fn determine_status(dir: &std::path::Path) -> (String, Vec<String>, bool) {
  let mut has_status = false;
  let mut has_ready = false;
  let mut locked = false;
  let mut completed_steps = Vec::new();

  if dir.join("locked").exists() {
    locked = true;
  }

  for entry in WalkDir::new(dir).min_depth(1) {
    let entry = entry.unwrap();
    let path = entry.path();
    if path.is_file() {
      if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
        if file_name.ends_with(".status") {
          has_status = true;
          let step_name = file_name.trim_end_matches(".status").to_string();
          if step_name == "999_ready" {
            has_ready = true;
          } else {
            completed_steps.push(step_name);
          }
        }
      }
    }
  }

  let status = if has_ready {
    "complete".to_string()
  } else if has_status {
    "incomplete".to_string()
  } else {
    "pending".to_string()
  };
  (status, completed_steps, locked)
}

#[tauri::command]
pub fn read_lock_status(project_root: String) -> Result<Vec<SubjectModuleStatus>, String> {
  let trace = CommandTrace::new("read_lock_status");
  trace.arg("project_root", &project_root);

  let root = PathBuf::from(project_root);
  let lock_root = root.join("derivatives").join("ExploreASL").join("lock");
  if !lock_root.exists() {
    trace.success(&Vec::<SubjectModuleStatus>::new());
    return Ok(Vec::new());
  }

  let mut statuses = Vec::new();

  // Structural module
  let structural_lock = lock_root.join("xASL_module_Structural");
  if structural_lock.exists() {
    for entry in std::fs::read_dir(&structural_lock)
      .map_err(|e| format!("Failed to read structural lock: {}", e))?
    {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
        continue;
      }
      let subject_session = entry.file_name().to_string_lossy().to_string();
      let module_lock = entry.path().join("xASL_module_Structural");
      if module_lock.exists() {
        let (status, completed_steps, locked) = determine_status(&module_lock);
        statuses.push(SubjectModuleStatus {
          subject_session,
          module_name: "xASL_module_Structural".to_string(),
          run: None,
          status,
          completed_steps,
          locked,
        });
      }
    }
  }

  // ASL module
  let asl_lock = lock_root.join("xASL_module_ASL");
  if asl_lock.exists() {
    for entry in
      std::fs::read_dir(&asl_lock).map_err(|e| format!("Failed to read ASL lock: {}", e))?
    {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
        continue;
      }
      let subject_session = entry.file_name().to_string_lossy().to_string();
      for run_entry in std::fs::read_dir(entry.path())
        .map_err(|e| format!("Failed to read ASL subject session lock: {}", e))?
      {
        let run_entry = run_entry.map_err(|e| format!("Failed to read run entry: {}", e))?;
        if !run_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
          continue;
        }
        let run_name = run_entry.file_name().to_string_lossy().to_string();
        if run_name.starts_with("xASL_module_ASL_ASL_") {
          let (status, completed_steps, locked) = determine_status(&run_entry.path());
          let run = run_name
            .strip_prefix("xASL_module_ASL_ASL_")
            .map(|s| s.to_string());
          statuses.push(SubjectModuleStatus {
            subject_session: subject_session.clone(),
            module_name: "xASL_module_ASL".to_string(),
            run,
            status,
            completed_steps,
            locked,
          });
        }
      }
    }
  }

  // Population module
  let population_lock = lock_root.join("xASL_module_Population");
  if population_lock.exists() {
    let module_lock = population_lock.join("xASL_module_Population");
    if module_lock.exists() {
      let (status, completed_steps, locked) = determine_status(&module_lock);
      statuses.push(SubjectModuleStatus {
        subject_session: String::new(),
        module_name: "xASL_module_Population".to_string(),
        run: None,
        status,
        completed_steps,
        locked,
      });
    }
  }

  trace.success(&statuses);
  Ok(statuses)
}

fn escape_matlab_string(value: &str) -> String {
  value.replace('\'', "''")
}

fn spawn_matlab_processing_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
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
  unsafe { CloseHandle(handle) };
  if ok == 0 {
    return Err(format!("Failed to terminate PID {pid}"));
  }
  Ok(())
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
  unsafe { CloseHandle(handle) };
  result == WAIT_TIMEOUT
}

fn validate_matlab_path(matlab_path: &str) -> Result<String, String> {
  use crate::import::validate_matlab_executable;
  validate_matlab_executable(matlab_path)
}

fn validate_exploreasl_path(path: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(path.trim());
  if !path.exists() {
    return Err(format!("ExploreASL path not found: {}", path.display()));
  }
  let main_file = path.join("ExploreASL.m");
  if !main_file.exists() {
    return Err(format!("ExploreASL.m not found in {}", path.display()));
  }
  Ok(path)
}

fn get_exploreasl_version(path: &PathBuf) -> Option<String> {
  let entries = match fs::read_dir(path) {
    Ok(entries) => entries,
    Err(_) => return None,
  };
  for entry in entries.flatten() {
    let file_name = entry.file_name().to_string_lossy().to_string();
    if let Some(version) = file_name.strip_prefix("VERSION_") {
      if !version.is_empty() {
        return Some(version.to_string());
      }
    }
  }
  None
}

#[tauri::command]
pub fn detect_exploreasl_version(explore_asl_path: String) -> Option<String> {
  let trace = CommandTrace::new("detect_exploreasl_version");
  trace.arg("explore_asl_path", &explore_asl_path);

  let path = PathBuf::from(explore_asl_path.trim());
  let version = if path.exists() {
    get_exploreasl_version(&path)
  } else {
    None
  };

  trace.success(&version);
  version
}

fn write_data_par_json(project_root: &PathBuf, data_par_json: &str) -> Result<(), String> {
  let data_par_dir = project_root.join("derivatives").join("ExploreASL");
  fs::create_dir_all(&data_par_dir).map_err(|e| {
    format!(
      "Failed to create ExploreASL derivatives dir {}: {}",
      data_par_dir.display(),
      e
    )
  })?;
  let data_par_path = data_par_dir.join("dataPar.json");
  fs::write(&data_par_path, data_par_json)
    .map_err(|e| format!("Failed to write {}: {}", data_par_path.display(), e))
}

fn ensure_lock_dir(project_root: &PathBuf) -> Result<PathBuf, String> {
  let lock_dir = project_root
    .join("derivatives")
    .join("ExploreASL")
    .join("lock");
  fs::create_dir_all(&lock_dir).map_err(|e| {
    format!(
      "Failed to create lock directory {}: {}",
      lock_dir.display(),
      e
    )
  })?;
  Ok(lock_dir)
}

pub(crate) fn clear_stale_lock_dirs(lock_root: &PathBuf, b_process: &[bool]) -> Result<(), String> {
  for (i, &enabled) in b_process.iter().enumerate() {
    if !enabled {
      continue;
    }
    clear_module_locked_dirs(lock_root, module_index_to_name(i))?;
  }
  Ok(())
}

fn clear_module_locked_dirs(lock_root: &PathBuf, module_name: &str) -> Result<(), String> {
  let module_lock = lock_root.join(module_name);
  if !module_lock.exists() {
    return Ok(());
  }
  for entry in WalkDir::new(&module_lock).min_depth(1) {
    let entry = match entry {
      Ok(e) => e,
      Err(_) => continue,
    };
    if entry.file_type().is_dir() {
      let path = entry.path();
      if path
          .file_name()
          .and_then(|n| n.to_str())
          .map(|n| n == "locked")
          .unwrap_or(false)
      {
        if let Err(e) = fs::remove_dir_all(path) {
          if e.kind() != std::io::ErrorKind::NotFound {
            return Err(format!(
              "Failed to clear stale locked dir {}: {}",
              path.display(),
              e
            ));
          }
        }
      }
    }
  }
  Ok(())
}

#[tauri::command]
pub fn clear_stale_locks(project_root: String) -> Result<(), String> {
  let lock_root = PathBuf::from(&project_root)
    .join("derivatives")
    .join("ExploreASL")
    .join("lock");
  if !lock_root.exists() {
    return Ok(());
  }
  for module_name in &["xASL_module_Structural", "xASL_module_ASL", "xASL_module_Population"] {
    clear_module_locked_dirs(&lock_root, module_name)?;
  }
  Ok(())
}

pub(crate) fn delete_status_files_for_modules(
  project_root: &PathBuf,
  b_process: &[bool],
  subject_regexp: &str,
) -> Result<(), String> {
  let lock_root = project_root
    .join("derivatives")
    .join("ExploreASL")
    .join("lock");
  if !lock_root.exists() {
    return Ok(());
  }

  let subject_re = if subject_regexp.is_empty() {
    None
  } else {
    Some(
      regex::Regex::new(subject_regexp)
        .map_err(|e| format!("Invalid subject regexp '{}': {}", subject_regexp, e))?,
    )
  };

  for (i, &enabled) in b_process.iter().enumerate() {
    if !enabled {
      continue;
    }
    let module_name = module_index_to_name(i);
    let module_lock_dir = lock_root.join(module_name);
    if !module_lock_dir.exists() {
      continue;
    }

    for entry in fs::read_dir(&module_lock_dir).map_err(|e| {
      format!(
        "Failed to read lock dir {}: {}",
        module_lock_dir.display(),
        e
      )
    })? {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
        continue;
      }
      let subject_name = entry.file_name().to_string_lossy().to_string();

      if let Some(ref re) = subject_re {
        if !re.is_match(&subject_name) {
          continue;
        }
      }

      if module_name == "xASL_module_ASL" {
        for run_entry in fs::read_dir(entry.path()).map_err(|e| {
          format!("Failed to read ASL subject lock dir: {}", e)
        })? {
          let run_entry = run_entry.map_err(|e| format!("Failed to read run entry: {}", e))?;
          if !run_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
          }
          let run_name = run_entry.file_name().to_string_lossy().to_string();
          if run_name.starts_with("xASL_module_ASL_ASL_") {
            delete_status_files_in_dir(&run_entry.path())?;
          }
        }
      } else {
        let subject_module_dir = entry.path().join(module_name);
        if subject_module_dir.exists() {
          delete_status_files_in_dir(&subject_module_dir)?;
        }
      }
    }
  }

  Ok(())
}

fn delete_status_files_in_dir(dir: &PathBuf) -> Result<(), String> {
  for entry in WalkDir::new(dir).min_depth(1) {
    let entry = entry.map_err(|e| format!("WalkDir error: {}", e))?;
    let path = entry.path();
    if path.is_file() {
      if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
        if file_name.ends_with(".status") {
          match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
              return Err(format!(
                "Failed to delete status file {}: {}",
                path.display(),
                e
              ));
            }
          }
        }
      }
    }
  }
  Ok(())
}

pub(crate) fn delete_module_log_files(
  project_root: &PathBuf,
  b_process: &[bool],
  subject_regexp: &str,
) -> Result<(), String> {
  let log_dir = project_root
    .join("derivatives")
    .join("ExploreASL")
    .join("log");
  if !log_dir.exists() {
    return Ok(());
  }

  let subject_re = if subject_regexp.is_empty() {
    None
  } else {
    Some(
      regex::Regex::new(subject_regexp)
        .map_err(|e| format!("Invalid subject regexp '{}': {}", subject_regexp, e))?,
    )
  };

  let subject_session_re =
    regex::Regex::new(r"sub-[^_]+_\d+").expect("subject_session pattern should compile");

  for (i, &enabled) in b_process.iter().enumerate() {
    if !enabled {
      continue;
    }
    let module_name = module_index_to_name(i);
    let prefix = module_name.to_string();

    for entry in fs::read_dir(&log_dir).map_err(|e| {
      format!("Failed to read log dir {}: {}", log_dir.display(), e)
    })? {
      let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
      let file_name = entry.file_name().to_string_lossy().to_string();

      if !file_name.starts_with(&prefix) {
        continue;
      }

      let should_delete = match &subject_re {
        Some(re) => {
          if let Some(mat) = subject_session_re.find(&file_name) {
            re.is_match(mat.as_str())
          } else {
            true
          }
        }
        None => true,
      };

      if should_delete {
        match fs::remove_file(entry.path()) {
          Ok(()) => {}
          Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
          Err(e) => {
            return Err(format!(
              "Failed to delete log file {}: {}",
              entry.path().display(),
              e
            ));
          }
        }
      }
    }
  }

  Ok(())
}

fn supervise_processing_worker(
  app: AppHandle,
  child_pid: u32,
  mut child: Child,
) -> thread::JoinHandle<()> {
  thread::spawn(move || {
    let exit_code = match child.wait() {
      Ok(status) => status.code().unwrap_or(-1),
      Err(_) => -1,
    };

    let _ = app.emit(
      "WorkerExited",
      WorkerExited {
        pid: child_pid,
        exit_code,
      },
    );

    let state = app.state::<AppState>();
    let clear_result = state.processing_state.lock().map(|mut ps| {
      ps.worker_pids.retain(|&pid| pid != child_pid);
    });
    drop(clear_result);
  })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn run_pipeline(
  app: AppHandle,
  state: State<'_, AppState>,
  project_root: String,
  matlab_path: String,
  explore_asl_path: String,
  data_par_json: String,
  b_process: Vec<bool>,
  workers: u32,
  subject_regexp: String,
) -> Result<Vec<u32>, String> {
  let trace = CommandTrace::new("run_pipeline");
  trace.arg("project_root", &project_root);
  trace.arg("matlab_path", &matlab_path);
  trace.arg("explore_asl_path", &explore_asl_path);
  trace.arg("workers", &workers.to_string());
  trace.arg("subject_regexp", &subject_regexp);

  if workers == 0 {
    return Err("workers must be at least 1".to_string());
  }
  if b_process.len() != 3 {
    return Err("b_process must have exactly 3 elements".to_string());
  }
  if !b_process.iter().any(|&b| b) {
    return Err("At least one processing module must be enabled".to_string());
  }

  let project_root = PathBuf::from(project_root.trim());
  if !project_root.exists() {
    return Err(format!(
      "Project root not found: {}",
      project_root.display()
    ));
  }

  let matlab_path = validate_matlab_path(&matlab_path)?;
  let exploreasl_path = validate_exploreasl_path(&explore_asl_path)?;

  {
    let version = get_exploreasl_version(&exploreasl_path);
    log::info!(
      "ExploreASL version: {}",
      version.as_deref().unwrap_or("unknown")
    );
  }

  write_data_par_json(&project_root, &data_par_json)?;

  let lock_root = ensure_lock_dir(&project_root)?;
  clear_stale_lock_dirs(&lock_root, &b_process)?;
  delete_status_files_for_modules(&project_root, &b_process, &subject_regexp)?;
  delete_module_log_files(&project_root, &b_process, &subject_regexp)?;

  {
    let mut processing_state = state
      .processing_state
      .lock()
      .map_err(|_| "Processing state lock was poisoned".to_string())?;
    if !processing_state.worker_pids.is_empty() {
      return Err(format!(
        "Processing already running with PIDs: {:?}",
        processing_state.worker_pids
      ));
    }
    processing_state.project_root = project_root.clone();
  }

  let b_process_str = b_process
    .iter()
    .map(|&b| if b { "1" } else { "0" })
    .collect::<Vec<_>>()
    .join(",");
  let exploreasl_str = escape_matlab_string(&exploreasl_path.to_string_lossy());
  let project_root_str = escape_matlab_string(&project_root.to_string_lossy());

  let mut pids = Vec::new();
  let n_workers = workers as usize;

  for i_worker in 1..=n_workers {
    let batch = format!(
      "addpath('{}'); ExploreASL('{}', 0, [{}], 0, {}, {})",
      exploreasl_str, project_root_str, b_process_str, i_worker, n_workers,
    );

    let child = spawn_matlab_processing_process(&matlab_path, &batch).map_err(|e| {
      if e.kind() == std::io::ErrorKind::NotFound {
        format!("MATLAB executable not found: {}", matlab_path)
      } else {
        format!("Failed to spawn MATLAB worker {}: {}", i_worker, e)
      }
    })?;

    let child_pid = child.id();

    {
      let mut processing_state = state
        .processing_state
        .lock()
        .map_err(|_| "Processing state lock was poisoned".to_string())?;
      processing_state.worker_pids.push(child_pid);
    }

    let _supervisor_handle = supervise_processing_worker(app.clone(), child_pid, child);

    pids.push(child_pid);
  }

  trace.success(&pids);
  Ok(pids)
}

#[tauri::command]
pub fn kill_pipeline(state: State<'_, AppState>) -> Result<(), String> {
  let trace = CommandTrace::new("kill_pipeline");

  let pids: Vec<u32> = state
    .processing_state
    .lock()
    .map_err(|_| "Processing state lock was poisoned".to_string())?
    .worker_pids
    .clone();

  if pids.is_empty() {
    trace.success(&());
    return Ok(());
  }

  for &pid in &pids {
    let _ = send_termination_signal(pid);
  }

  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    let all_dead = pids.iter().all(|&pid| !process_exists(pid));
    if all_dead {
      break;
    }
    if Instant::now() >= deadline {
      break;
    }
    thread::sleep(Duration::from_millis(100));
  }

  for &pid in &pids {
    if process_exists(pid) {
      let _ = force_kill_process(pid);
    }
  }

  {
    let mut processing_state = state
      .processing_state
      .lock()
      .map_err(|_| "Processing state lock was poisoned".to_string())?;
    processing_state.worker_pids.clear();
  }

  trace.success(&());
  Ok(())
}

fn parse_lock_path(
  lock_root: &std::path::Path,
  path: &std::path::Path,
) -> Option<StatusFileCreated> {
  let relative = path.strip_prefix(lock_root).ok()?;
  let parts: Vec<&str> = relative.iter().map(|p| p.to_str().unwrap_or("")).collect();

  if parts.len() < 2 {
    return None;
  }

  let module = parts[0].to_string();
  let file_name = parts.last()?.to_string();

  if !file_name.ends_with(".status") {
    return None;
  }

  let step_code = file_name.trim_end_matches(".status").to_string();

  match module.as_str() {
    "xASL_module_Structural" => {
      // lock/xASL_module_Structural/sub-X_Y/xASL_module_Structural/step.status
      if parts.len() < 4 {
        return None;
      }
      let subject_session = Some(parts[1].to_string());
      Some(StatusFileCreated {
        module,
        subject_session,
        step_code,
        run: None,
      })
    }
    "xASL_module_ASL" => {
      // lock/xASL_module_ASL/sub-X_Y/xASL_module_ASL_ASL_N/step.status
      if parts.len() < 4 {
        return None;
      }
      let subject_session = Some(parts[1].to_string());
      let run_dir = parts[2].to_string();
      let run = if run_dir.starts_with("xASL_module_ASL_ASL_") {
        Some(run_dir.strip_prefix("xASL_module_ASL_ASL_").unwrap().to_string())
      } else {
        None
      };
      Some(StatusFileCreated {
        module,
        subject_session,
        step_code,
        run,
      })
    }
    "xASL_module_Population" => {
      // lock/xASL_module_Population/xASL_module_Population/step.status
      Some(StatusFileCreated {
        module,
        subject_session: None,
        step_code,
        run: None,
      })
    }
    _ => None,
  }
}

fn parse_lock_dir_path(lock_root: &std::path::Path, path: &std::path::Path) -> Option<LockCreated> {
  let relative = path.strip_prefix(lock_root).ok()?;
  let parts: Vec<&str> = relative.iter().map(|p| p.to_str().unwrap_or("")).collect();

  if parts.is_empty() {
    return None;
  }

  let module = parts[0].to_string();

  match module.as_str() {
    "xASL_module_Structural" => {
      // lock/xASL_module_Structural/sub-X_Y/xASL_module_Structural/locked
      if parts.len() < 4 {
        return None;
      }
      let subject_session = Some(parts[1].to_string());
      Some(LockCreated {
        module,
        subject_session,
        run: None,
      })
    }
    "xASL_module_ASL" => {
      // lock/xASL_module_ASL/sub-X_Y/xASL_module_ASL_ASL_N/locked
      if parts.len() < 4 {
        return None;
      }
      let subject_session = Some(parts[1].to_string());
      let run_dir = parts[2].to_string();
      let run = if run_dir.starts_with("xASL_module_ASL_ASL_") {
        Some(run_dir.strip_prefix("xASL_module_ASL_ASL_").unwrap().to_string())
      } else {
        None
      };
      Some(LockCreated {
        module,
        subject_session,
        run,
      })
    }
    "xASL_module_Population" => {
      // lock/xASL_module_Population/xASL_module_Population/locked
      Some(LockCreated {
        module,
        subject_session: None,
        run: None,
      })
    }
    _ => None,
  }
}

#[tauri::command]
pub fn watch_lock_dir(
  app: AppHandle,
  state: State<'_, AppState>,
  project_root: String,
) -> Result<(), String> {
  let trace = CommandTrace::new("watch_lock_dir");
  trace.arg("project_root", &project_root);

  // Prevent starting multiple watcher threads
  {
    let processing_state = state
      .processing_state
      .lock()
      .map_err(|_| "Processing state lock was poisoned".to_string())?;
    if processing_state.watcher_stop.is_some() {
      trace.success(&());
      return Ok(());
    }
  }

  let root = PathBuf::from(project_root.trim());
  let lock_root = root.join("derivatives").join("ExploreASL").join("lock");
  if !lock_root.exists() {
    std::fs::create_dir_all(&lock_root).map_err(|e| {
      format!(
        "Failed to create lock directory {}: {}",
        lock_root.display(),
        e
      )
    })?;
  }

  let lock_root_clone = lock_root.clone();
  let app_clone = app.clone();

  let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
  let (stop_tx, stop_rx) = mpsc::channel::<()>();

  let mut watcher =
    notify::recommended_watcher(tx).map_err(|e| format!("Failed to create file watcher: {}", e))?;

  watcher
    .watch(&lock_root, RecursiveMode::Recursive)
    .map_err(|e| format!("Failed to watch lock directory: {}", e))?;

  let watcher_thread = thread::spawn(move || {
    loop {
      match rx.recv_timeout(Duration::from_millis(50)) {
        Ok(event_result) => {
          let event = match event_result {
            Ok(ev) => ev,
            Err(e) => {
              log::error!("Watch error: {}", e);
              continue;
            }
          };

          match event.kind {
            EventKind::Create(_) => {
              for path in &event.paths {
                if path.is_dir() {
                  let relative = match path.strip_prefix(&lock_root_clone) {
                    Ok(r) => r,
                    Err(_) => continue,
                  };
                  let last = match relative.file_name().and_then(|f| f.to_str()) {
                    Some(name) => name,
                    None => continue,
                  };
                  if last == "locked" {
                    if let Some(lock_event) = parse_lock_dir_path(&lock_root_clone, path) {
                      log::info!("[WATCHER] LockCreated: module={} subject={:?} run={:?}", lock_event.module, lock_event.subject_session, lock_event.run);
                      let _ = app_clone.emit("LockCreated", lock_event);
                    }
                  }
                } else if let Some(status_event) = parse_lock_path(&lock_root_clone, path) {
                  log::info!("[WATCHER] StatusFileCreated: module={} subject={:?} step={} run={:?}", status_event.module, status_event.subject_session, status_event.step_code, status_event.run);
                  let _ = app_clone.emit("StatusFileCreated", status_event);
                }
              }
            }
            EventKind::Modify(_) => {
              for path in &event.paths {
                if !path.is_dir() {
                  if let Some(status_event) = parse_lock_path(&lock_root_clone, path) {
                    log::info!("[WATCHER] StatusFileModified: module={} subject={:?} step={} run={:?}", status_event.module, status_event.subject_session, status_event.step_code, status_event.run);
                    let _ = app_clone.emit("StatusFileCreated", status_event);
                  }
                }
              }
            }
            EventKind::Remove(_) => {
              for path in &event.paths {
                if path.is_dir() {
                  let relative = match path.strip_prefix(&lock_root_clone) {
                    Ok(r) => r,
                    Err(_) => continue,
                  };
                  let last = match relative.file_name().and_then(|f| f.to_str()) {
                    Some(name) => name,
                    None => continue,
                  };
                  if last == "locked" {
                    if let Some(lock_event) = parse_lock_dir_path(&lock_root_clone, path) {
                      log::info!("[WATCHER] LockRemoved: module={} subject={:?} run={:?}", lock_event.module, lock_event.subject_session, lock_event.run);
                      let _ = app_clone.emit("LockRemoved", lock_event);
                    }
                  }
                }
              }
            }
            _ => {}
          }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
          match stop_rx.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => {
              break;
            }
            Err(mpsc::TryRecvError::Empty) => {}
          }
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
          log::warn!("[WATCHER] Event channel disconnected");
          break;
        }
      }
    }
    log::info!("[WATCHER] Stopped");
    drop(watcher);
  });

  {
    let mut processing_state = state
      .processing_state
      .lock()
      .map_err(|_| "Processing state lock was poisoned".to_string())?;
    processing_state.watcher_handle = Some(watcher_thread);
    processing_state.watcher_stop = Some(stop_tx);
  }

  trace.success(&());
  Ok(())
}

#[tauri::command]
pub fn stop_watch_lock_dir(state: State<'_, AppState>) -> Result<(), String> {
  let (handle, stop_tx) = {
    let mut processing_state = state
      .processing_state
      .lock()
      .map_err(|_| "Processing state lock was poisoned".to_string())?;
    let handle = processing_state.watcher_handle.take();
    let stop = processing_state.watcher_stop.take();
    (handle, stop)
  };

  if let Some(sender) = stop_tx {
    let _ = sender.send(());
  }

  if let Some(handle) = handle {
    let _ = handle.join();
  }

  Ok(())
}



#[path = "processing_tests.rs"]
mod processing_tests;

pub fn stop_running_processing_for_exit(app: &AppHandle) -> Result<bool, String> {
  let state = app.state::<AppState>();
  let pids: Vec<u32> = state
    .processing_state
    .lock()
    .map_err(|_| "Processing state lock was poisoned".to_string())?
    .worker_pids
    .clone();

  if pids.is_empty() {
    return Ok(false);
  }

  for &pid in &pids {
    let _ = send_termination_signal(pid);
  }

  let deadline = Instant::now() + Duration::from_secs(5);
  loop {
    let all_dead = pids.iter().all(|&pid| !process_exists(pid));
    if all_dead {
      break;
    }
    if Instant::now() >= deadline {
      break;
    }
    thread::sleep(Duration::from_millis(100));
  }

  for &pid in &pids {
    if process_exists(pid) {
      let _ = force_kill_process(pid);
    }
  }

  let mut processing_state = state
    .processing_state
    .lock()
    .map_err(|_| "Processing state lock was poisoned".to_string())?;
  processing_state.worker_pids.clear();

  let stop_tx = processing_state.watcher_stop.take();
  let handle = processing_state.watcher_handle.take();
  drop(processing_state);

  if let Some(sender) = stop_tx {
    let _ = sender.send(());
  }
  if let Some(handle) = handle {
    let _ = handle.join();
  }

  Ok(true)
}
