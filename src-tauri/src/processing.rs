use crate::execution_profile::{get_exploreasl_version, ExecutionProfile};
use crate::import::AppState;
use crate::tracing::CommandTrace;
use notify::{EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
    pub asl_runs: Vec<String>,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub filename: String,
    pub module: String,
    pub subject_session: String,
    pub run: Option<String>,
    pub has_error: bool,
}

pub(crate) fn is_mutex_related_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("mutex is locked")
}

pub(crate) fn check_log_for_error(path: &std::path::Path) -> bool {
    let file_size = match fs::metadata(path) {
        Ok(m) => m.len(),
        Err(_) => return false,
    };

    let offset = file_size.saturating_sub(2048);
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };

    use std::io::{Read, Seek, SeekFrom};
    if offset > 0 && file.seek(SeekFrom::Start(offset)).is_err() {
        return false;
    }

    let mut buf = vec![0u8; 2048];
    let bytes_read = match file.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };

    let content = String::from_utf8_lossy(&buf[..bytes_read]);
    content
        .lines()
        .any(|line| line.to_lowercase().contains("error") && !is_mutex_related_line(line))
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
pub fn list_subjects(
    project_root: String,
    data_source: Option<String>,
) -> Result<Vec<SubjectInfo>, String> {
    let trace = CommandTrace::new("list_subjects");
    trace.arg("project_root", &project_root);
    if let Some(ref ds) = data_source {
        trace.arg("data_source", ds);
    }

    let root = PathBuf::from(&project_root);
    let scan_root = if data_source.as_deref() == Some("bids") {
        root.clone()
    } else {
        root.join("rawdata")
    };

    if !scan_root.exists() {
        trace.success(&Vec::<SubjectInfo>::new());
        return Ok(Vec::new());
    }

    let bids_subjects = crate::bids::scan::parse_bids_structure(&scan_root)?;

    let mut subjects = Vec::new();
    for bids_sub in &bids_subjects {
        let subject_label = bids_sub
            .subject_label
            .strip_prefix("sub-")
            .unwrap_or(&bids_sub.subject_label)
            .to_string();

        for session in &bids_sub.sessions {
            let session_label = session.session_label.clone();
            let subject_session = format!("sub-{}_{}", subject_label, session_label);

            let mut asl_runs: Vec<String> = session
                .asl_files
                .iter()
                .filter_map(|f| f.run_label.clone())
                .collect();
            asl_runs.sort();
            asl_runs.dedup();

            // Fallback: if perf dir exists but no ASL files or no run labels found, default to ["1"]
            if asl_runs.is_empty() && session.has_perf {
                asl_runs.push("1".to_string());
            }

            subjects.push(SubjectInfo {
                subject_session,
                subject: subject_label.clone(),
                session: session_label,
                has_structural: !session.anat_files.is_empty(),
                has_asl: !session.asl_files.is_empty(),
                asl_runs,
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

    if has_ready {
        locked = false;
    }

    completed_steps.sort();

    let status = if has_ready {
        "complete".to_string()
    } else if has_status {
        "incomplete".to_string()
    } else {
        "pending".to_string()
    };
    (status, completed_steps, locked)
}

fn get_structural_completion_time(
    project_root: &Path,
    subject_session: &str,
) -> Option<std::time::SystemTime> {
    let ready_file = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Structural")
        .join(subject_session)
        .join("xASL_module_Structural")
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&ready_file) {
        if let Ok(mtime) = metadata.modified() {
            return Some(mtime);
        }
    }
    let log_dirs = exploreasl_log_dirs(project_root);
    for log_dir in log_dirs {
        let log_file = log_dir.join(format!("xASL_module_Structural_{}.log", subject_session));
        if log_file.is_file() && !check_log_for_error(&log_file) {
            if let Ok(metadata) = std::fs::metadata(&log_file) {
                if let Ok(mtime) = metadata.modified() {
                    return Some(mtime);
                }
            }
        }
    }
    None
}

fn get_asl_completion_time(
    project_root: &Path,
    subject_session: &str,
    run: &str,
) -> Option<std::time::SystemTime> {
    let ready_file = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_ASL")
        .join(subject_session)
        .join(format!("xASL_module_ASL_ASL_{}", run))
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&ready_file) {
        if let Ok(mtime) = metadata.modified() {
            return Some(mtime);
        }
    }
    let log_dirs = exploreasl_log_dirs(project_root);
    for log_dir in log_dirs {
        let log_file = log_dir.join(format!(
            "xASL_module_ASL_{}_ASL_{}.log",
            subject_session, run
        ));
        if log_file.is_file() && !check_log_for_error(&log_file) {
            if let Ok(metadata) = std::fs::metadata(&log_file) {
                if let Ok(mtime) = metadata.modified() {
                    return Some(mtime);
                }
            }
        }
    }
    None
}

fn find_asl_runs_from_logs(project_root: &Path, subject_session: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let log_dirs = exploreasl_log_dirs(project_root);
    let pattern = format!("xASL_module_ASL_{}_ASL_", subject_session);
    for log_dir in log_dirs {
        if let Ok(entries) = std::fs::read_dir(log_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with(&pattern) && name.ends_with(".log") {
                            if let Some(run_part) = name.strip_prefix(&pattern) {
                                if let Some(run_str) = run_part.strip_suffix(".log") {
                                    if !runs.contains(&run_str.to_string()) {
                                        runs.push(run_str.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    runs
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
    let mut subject_sessions = std::collections::HashSet::new();

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
            subject_sessions.insert(subject_session.clone());

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
            subject_sessions.insert(subject_session);
        }
    }

    // Check ASL status for all subject sessions
    for subject_session in &subject_sessions {
        let structural_time = get_structural_completion_time(&root, subject_session);
        let asl_subject_dir = lock_root.join("xASL_module_ASL").join(subject_session);

        let mut processed_runs = std::collections::HashSet::new();

        if asl_subject_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
                for run_entry in entries.flatten() {
                    if run_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        let run_name = run_entry.file_name().to_string_lossy().to_string();
                        if run_name.starts_with("xASL_module_ASL_ASL_") {
                            let (mut status, completed_steps, locked) =
                                determine_status(&run_entry.path());
                            let run = run_name
                                .strip_prefix("xASL_module_ASL_ASL_")
                                .map(|s| s.to_string());

                            if let Some(ref r) = run {
                                processed_runs.insert(r.clone());
                                if let Some(st) = structural_time {
                                    if let Some(at) =
                                        get_asl_completion_time(&root, subject_session, r)
                                    {
                                        if st > at {
                                            status = "outdated".to_string();
                                        }
                                    }
                                }
                            }

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
        }

        // Discover runs from logs that might have been cleared
        let runs_from_logs = find_asl_runs_from_logs(&root, subject_session);
        for run in runs_from_logs {
            if processed_runs.contains(&run) {
                continue;
            }
            if let Some(st) = structural_time {
                if let Some(at) = get_asl_completion_time(&root, subject_session, &run) {
                    if st > at {
                        statuses.push(SubjectModuleStatus {
                            subject_session: subject_session.clone(),
                            module_name: "xASL_module_ASL".to_string(),
                            run: Some(run),
                            status: "outdated".to_string(),
                            completed_steps: Vec::new(),
                            locked: false,
                        });
                    }
                }
            }
        }
    }

    // Population module
    let population_lock = lock_root.join("xASL_module_Population");
    let mut pop_status = "pending".to_string();
    let mut pop_completed_steps = Vec::new();
    let mut pop_locked = false;

    if population_lock.exists() {
        let module_lock = population_lock.join("xASL_module_Population");
        if module_lock.exists() {
            let (status, completed_steps, locked) = determine_status(&module_lock);
            pop_status = status;
            pop_completed_steps = completed_steps;
            pop_locked = locked;
        }
    }

    // Check if Population is outdated
    let mut pop_time = None;
    let pop_ready_file = lock_root
        .join("xASL_module_Population")
        .join("xASL_module_Population")
        .join("999_ready.status");
    if let Ok(metadata) = std::fs::metadata(&pop_ready_file) {
        if let Ok(mtime) = metadata.modified() {
            pop_time = Some(mtime);
        }
    }
    if pop_time.is_none() {
        let log_dirs = exploreasl_log_dirs(&root);
        for log_dir in log_dirs {
            let log_file = log_dir.join("xASL_module_Population.log");
            if log_file.is_file() && !check_log_for_error(&log_file) {
                if let Ok(metadata) = std::fs::metadata(&log_file) {
                    if let Ok(mtime) = metadata.modified() {
                        pop_time = Some(mtime);
                        break;
                    }
                }
            }
        }
    }

    if let Some(pt) = pop_time {
        let mut is_outdated = false;
        for ss in &subject_sessions {
            if let Some(st) = get_structural_completion_time(&root, ss) {
                if st > pt {
                    is_outdated = true;
                    break;
                }
            }
            let runs = find_asl_runs_from_logs(&root, ss);
            let mut all_runs = runs;
            let asl_subject_dir = lock_root.join("xASL_module_ASL").join(ss);
            if let Ok(entries) = std::fs::read_dir(&asl_subject_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("xASL_module_ASL_ASL_") {
                        if let Some(run_str) = name.strip_prefix("xASL_module_ASL_ASL_") {
                            if !all_runs.contains(&run_str.to_string()) {
                                all_runs.push(run_str.to_string());
                            }
                        }
                    }
                }
            }
            for run in all_runs {
                if let Some(at) = get_asl_completion_time(&root, ss, &run) {
                    if at > pt {
                        is_outdated = true;
                        break;
                    }
                }
            }
            if is_outdated {
                break;
            }
        }
        if is_outdated {
            pop_status = "outdated".to_string();
        }
    }

    if population_lock.exists() || pop_status == "outdated" {
        statuses.push(SubjectModuleStatus {
            subject_session: String::new(),
            module_name: "xASL_module_Population".to_string(),
            run: None,
            status: pop_status,
            completed_steps: pop_completed_steps,
            locked: pop_locked,
        });
    }

    trace.success(&statuses);
    Ok(statuses)
}

/// ExploreASL log directories, project root first so persisted logs win over staging copies.
fn exploreasl_log_dirs(project_root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    let project_log = project_root
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if project_log.is_dir() {
        dirs.push(project_log);
    }
    let staging_log = project_root
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    if staging_log.is_dir() {
        dirs.push(staging_log);
    }
    dirs
}

fn parse_module_log_file(
    file_name: &str,
    path: &std::path::Path,
    subject_session_re: &regex::Regex,
    import_subject_re: &regex::Regex,
    asl_run_re: &regex::Regex,
) -> Option<LogFileInfo> {
    let module = if file_name.starts_with("xASL_module_Structural") {
        "structural"
    } else if file_name.starts_with("xASL_module_ASL") {
        "asl"
    } else if file_name.starts_with("xASL_module_Import") {
        "import"
    } else if file_name.starts_with("xASL_module_Population") {
        "population"
    } else {
        return None;
    };

    let subject_identifier = if module == "import" {
        import_subject_re
            .find(file_name)
            .map(|m| m.as_str().to_string())
    } else if module == "population" {
        Some(String::new())
    } else {
        subject_session_re
            .find(file_name)
            .map(|m| m.as_str().to_string())
    };

    let subject_identifier_val = subject_identifier?;

    let run = if module == "asl" {
        asl_run_re
            .captures(file_name)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
    } else {
        None
    };

    Some(LogFileInfo {
        filename: file_name.to_string(),
        module: module.to_string(),
        subject_session: subject_identifier_val,
        run,
        has_error: check_log_for_error(path),
    })
}

#[tauri::command]
pub fn list_module_logs(project_root: String) -> Result<Vec<LogFileInfo>, String> {
    let trace = CommandTrace::new("list_module_logs");
    trace.arg("project_root", &project_root);

    let project_root = PathBuf::from(project_root);
    let log_dirs = exploreasl_log_dirs(&project_root);

    if log_dirs.is_empty() {
        trace.success(&Vec::<LogFileInfo>::new());
        return Ok(Vec::new());
    }

    let subject_session_re =
        regex::Regex::new(r"sub-[^_]+_\d+").expect("subject_session pattern should compile");

    let import_subject_re =
        regex::Regex::new(r"sub-[^_\s.]+").expect("import subject pattern should compile");

    let asl_run_re = regex::Regex::new(r"_ASL_(\d+)\.").expect("ASL run pattern should compile");

    let mut results = Vec::new();
    let mut seen_filenames = std::collections::HashSet::new();

    for log_dir in log_dirs {
        let entries = fs::read_dir(&log_dir)
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if seen_filenames.contains(&file_name) {
                continue;
            }

            let Some(info) = parse_module_log_file(
                &file_name,
                &entry.path(),
                &subject_session_re,
                &import_subject_re,
                &asl_run_re,
            ) else {
                continue;
            };

            seen_filenames.insert(file_name);
            results.push(info);
        }
    }

    trace.success(&results);
    Ok(results)
}

#[tauri::command]
pub fn read_module_logs(
    project_root: String,
    subject_session: String,
    module: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let trace = CommandTrace::new("read_module_logs");
    trace.arg("project_root", &project_root);
    trace.arg("subject_session", &subject_session);
    trace.arg("module", &module);

    let project_root = PathBuf::from(&project_root);
    let log_dirs = exploreasl_log_dirs(&project_root);

    if log_dirs.is_empty() {
        trace.success(&std::collections::HashMap::<String, String>::new());
        return Ok(std::collections::HashMap::new());
    }

    let module_prefix = match module.as_str() {
        "structural" => "xASL_module_Structural",
        "asl" => "xASL_module_ASL",
        "import" => "xASL_module_Import",
        "population" => "xASL_module_Population",
        _ => return Err(format!("Unknown module: {}", module)),
    };

    let search_prefix = if module == "population" {
        module_prefix.to_string()
    } else {
        format!("{}_{}", module_prefix, subject_session)
    };

    let mut results = std::collections::HashMap::new();

    for log_dir in log_dirs {
        let entries = fs::read_dir(&log_dir)
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read log entry: {}", e))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if !file_name.starts_with(&search_prefix) || results.contains_key(&file_name) {
                continue;
            }

            let content = match fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => {
                    let bytes = match fs::read(entry.path()) {
                        Ok(b) => b,
                        Err(e) => {
                            return Err(format!("Failed to read log file {}: {}", file_name, e));
                        }
                    };
                    String::from_utf8_lossy(&bytes).to_string()
                }
            };

            results.insert(file_name, content);
        }
    }

    trace.success(&results);
    Ok(results)
}

fn escape_matlab_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn spawn_matlab_processing_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
    let mut command = Command::new(matlab_path);
    command
        .arg("-batch")
        .arg(batch)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
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

fn write_data_par_json(project_root: &Path, data_par_json: &str) -> Result<(), String> {
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

fn ensure_lock_dir(project_root: &Path) -> Result<PathBuf, String> {
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

pub(crate) fn clear_stale_lock_dirs(lock_root: &Path, b_process: &[bool]) -> Result<(), String> {
    for (i, &enabled) in b_process.iter().enumerate() {
        if !enabled {
            continue;
        }
        clear_module_locked_dirs(lock_root, module_index_to_name(i))?;
    }
    Ok(())
}

fn clear_module_locked_dirs(lock_root: &Path, module_name: &str) -> Result<(), String> {
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
    for module_name in &[
        "xASL_module_Structural",
        "xASL_module_ASL",
        "xASL_module_Population",
    ] {
        clear_module_locked_dirs(&lock_root, module_name)?;
    }
    Ok(())
}

pub(crate) fn delete_status_files_for_modules(
    project_root: &Path,
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

        if module_name == "xASL_module_Population" {
            let pop_dir = module_lock_dir.join(module_name);
            if pop_dir.exists() {
                delete_status_files_in_dir(&pop_dir)?;
            }
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
                for run_entry in fs::read_dir(entry.path())
                    .map_err(|e| format!("Failed to read ASL subject lock dir: {}", e))?
                {
                    let run_entry =
                        run_entry.map_err(|e| format!("Failed to read run entry: {}", e))?;
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
    project_root: &Path,
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

        for entry in fs::read_dir(&log_dir)
            .map_err(|e| format!("Failed to read log dir {}: {}", log_dir.display(), e))?
        {
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
    execution_profile: ExecutionProfile,
    data_par_json: String,
    b_process: Vec<bool>,
    workers: u32,
    subject_regexp: String,
) -> Result<Vec<u32>, String> {
    let trace = CommandTrace::new("run_pipeline");
    trace.arg("project_root", &project_root);
    trace.arg("execution_profile_id", execution_profile.id());
    trace.arg("workers", workers.to_string());
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

    let validation = execution_profile.validate();
    if !validation.valid {
        return Err(validation.errors.join("; "));
    }

    let (matlab_path, exploreasl_path) = match execution_profile {
        ExecutionProfile::Matlab {
            explore_asl_version,
            ..
        } => {
            let matlab_path = validation
                .matlab_path
                .expect("validated matlab profile should include matlab path");
            let exploreasl_path = validation
                .explore_asl_path
                .expect("validated matlab profile should include exploreasl path");
            let version = explore_asl_version.or(validation.explore_asl_version);
            log::info!(
                "ExploreASL version: {}",
                version.as_deref().unwrap_or("unknown")
            );
            (matlab_path, exploreasl_path)
        }
    };

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
        // Stagger worker launches to avoid ExploreASL initialization races
        // that can cause early worker exits (exitCode 1).
        if i_worker > 1 {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }

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
                Some(
                    run_dir
                        .strip_prefix("xASL_module_ASL_ASL_")
                        .unwrap()
                        .to_string(),
                )
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
                Some(
                    run_dir
                        .strip_prefix("xASL_module_ASL_ASL_")
                        .unwrap()
                        .to_string(),
                )
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

    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

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
                                        if let Some(lock_event) =
                                            parse_lock_dir_path(&lock_root_clone, path)
                                        {
                                            log::info!(
                        "[WATCHER] LockCreated: module={} subject={:?} run={:?}",
                        lock_event.module,
                        lock_event.subject_session,
                        lock_event.run
                      );
                                            let _ = app_clone.emit("LockCreated", lock_event);
                                        }
                                    }
                                } else if let Some(status_event) =
                                    parse_lock_path(&lock_root_clone, path)
                                {
                                    log::info!(
                    "[WATCHER] StatusFileCreated: module={} subject={:?} step={} run={:?}",
                    status_event.module,
                    status_event.subject_session,
                    status_event.step_code,
                    status_event.run
                  );
                                    let _ = app_clone.emit("StatusFileCreated", status_event);
                                }
                            }
                        }
                        EventKind::Modify(_) => {
                            for path in &event.paths {
                                if !path.is_dir() {
                                    if let Some(status_event) =
                                        parse_lock_path(&lock_root_clone, path)
                                    {
                                        log::info!(
                      "[WATCHER] StatusFileModified: module={} subject={:?} step={} run={:?}",
                      status_event.module,
                      status_event.subject_session,
                      status_event.step_code,
                      status_event.run
                    );
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
                                        if let Some(lock_event) =
                                            parse_lock_dir_path(&lock_root_clone, path)
                                        {
                                            log::info!(
                        "[WATCHER] LockRemoved: module={} subject={:?} run={:?}",
                        lock_event.module,
                        lock_event.subject_session,
                        lock_event.run
                      );
                                            let _ = app_clone.emit("LockRemoved", lock_event);
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => match stop_rx.try_recv() {
                    Ok(()) | Err(mpsc::TryRecvError::Disconnected) => {
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                },
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

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportFileInfo {
    pub module: String, // "structural" | "asl"
    pub subject_session: String,
    pub run: Option<String>,
}

#[tauri::command]
pub fn list_subject_reports(project_root: String) -> Result<Vec<ReportFileInfo>, String> {
    let trace = CommandTrace::new("list_subject_reports");
    trace.arg("project_root", &project_root);

    let root = PathBuf::from(project_root);
    let population = root
        .join("derivatives")
        .join("ExploreASL")
        .join("Population");

    let mut results = Vec::new();

    // 1. Structural Reports in T1Check
    let t1_check = population.join("T1Check");
    if t1_check.exists() {
        let t1_re = regex::Regex::new(r"^Tra_Seg_rT1_(sub-[^_]+_\d+)_rc2T1_")
            .expect("T1 report pattern should compile");
        if let Ok(entries) = fs::read_dir(&t1_check) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        if let Some(caps) = t1_re.captures(&file_name) {
                            if let Some(sub_ses) = caps.get(1) {
                                results.push(ReportFileInfo {
                                    module: "structural".to_string(),
                                    subject_session: sub_ses.as_str().to_string(),
                                    run: None,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. ASL Reports in ASLCheck
    let asl_check = population.join("ASLCheck");
    if asl_check.exists() {
        let asl_re = regex::Regex::new(r"^Tra_Reg_qCBF_(sub-[^_]+_\d+)_ASL_(\d+)_PV_pWM_")
            .expect("ASL report pattern should compile");
        if let Ok(entries) = fs::read_dir(&asl_check) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        if let Some(caps) = asl_re.captures(&file_name) {
                            if let Some(sub_ses) = caps.get(1) {
                                let run_val = caps.get(2).map(|m| m.as_str().to_string());
                                results.push(ReportFileInfo {
                                    module: "asl".to_string(),
                                    subject_session: sub_ses.as_str().to_string(),
                                    run: run_val,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. M0 Reports in M0Reg_ASL
    let m0_check = population.join("M0Reg_ASL");
    if m0_check.exists() {
        let m0_re = regex::Regex::new(r"^Tra_Reg_noSmooth_M0_(sub-[^_]+_\d+)_ASL_(\d+)_PV_pGM_")
            .expect("M0 report pattern should compile");
        if let Ok(entries) = fs::read_dir(&m0_check) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        if let Some(caps) = m0_re.captures(&file_name) {
                            if let Some(sub_ses) = caps.get(1) {
                                let run_val = caps.get(2).map(|m| m.as_str().to_string());
                                results.push(ReportFileInfo {
                                    module: "m0".to_string(),
                                    subject_session: sub_ses.as_str().to_string(),
                                    run: run_val,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Deduplicate results
    results.sort_by(|a, b| {
        (&a.module, &a.subject_session, &a.run).cmp(&(&b.module, &b.subject_session, &b.run))
    });
    results.dedup_by(|a, b| {
        a.module == b.module && a.subject_session == b.subject_session && a.run == b.run
    });

    trace.success(&results);
    Ok(results)
}

#[tauri::command]
pub fn read_report_image(
    project_root: String,
    subject_session: String,
    module: String,
    run: Option<String>,
    view_type: String, // "axial" | "coronal"
) -> Result<Vec<u8>, String> {
    let trace = CommandTrace::new("read_report_image");
    trace.arg("project_root", &project_root);
    trace.arg("subject_session", &subject_session);
    trace.arg("module", &module);
    trace.arg("run", &run);
    trace.arg("view_type", &view_type);

    let root = PathBuf::from(&project_root);
    let population = root
        .join("derivatives")
        .join("ExploreASL")
        .join("Population");

    let file_name = match module.as_str() {
        "structural" => {
            let prefix = match view_type.as_str() {
                "axial" => "Tra_Seg_rT1",
                "coronal" => "Cor_Seg_rT1",
                _ => return Err(format!("Unknown view type: {}", view_type)),
            };
            format!(
                "{}_{}_rc2T1_{}.jpg",
                prefix, subject_session, subject_session
            )
        }
        "asl" => {
            let prefix = match view_type.as_str() {
                "axial" => "Tra_Reg_qCBF",
                "coronal" => "Cor_Reg_qCBF",
                _ => return Err(format!("Unknown view type: {}", view_type)),
            };
            let run_str = run.unwrap_or_else(|| "1".to_string());
            format!(
                "{}_{}_ASL_{}_PV_pWM_{}_Contour.jpg",
                prefix, subject_session, run_str, subject_session
            )
        }
        "m0" => {
            let prefix = match view_type.as_str() {
                "axial" => "Tra_Reg_noSmooth_M0",
                "coronal" => "Cor_Reg_noSmooth_M0",
                _ => return Err(format!("Unknown view type: {}", view_type)),
            };
            let run_str = run.unwrap_or_else(|| "1".to_string());
            format!(
                "{}_{}_ASL_{}_PV_pGM_{}_Contour.jpg",
                prefix, subject_session, run_str, subject_session
            )
        }
        _ => return Err(format!("Unknown module: {}", module)),
    };

    let sub_dir = match module.as_str() {
        "structural" => "T1Check",
        "asl" => "ASLCheck",
        "m0" => "M0Reg_ASL",
        _ => unreachable!(),
    };

    let img_path = population.join(sub_dir).join(&file_name);

    // Prevent directory traversal
    if !img_path.starts_with(&population) {
        return Err("Access denied: Invalid path".to_string());
    }

    if !img_path.exists() {
        return Err(format!("Report image not found: {}", file_name));
    }

    let bytes = fs::read(&img_path).map_err(|e| format!("Failed to read image file: {}", e))?;

    trace.success(&format!("Read {} bytes", bytes.len()));
    Ok(bytes)
}
