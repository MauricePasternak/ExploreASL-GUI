use super::locks::{
    clear_stale_lock_dirs, delete_bids2legacy_locks, delete_status_files_for_modules,
};
use super::logs::delete_module_log_files;
use super::types::WorkerExited;
use super::utils::{ensure_lock_dir, escape_matlab_string};
use crate::apptainer::{CONTAINER_DATA_ROOT, EXPLOREASL_SCRIPT, MCR_PATH, ensure_mcr_cache};
use crate::execution_profile::{ExecutionProfile, get_exploreasl_version};
use crate::import::AppState;
use crate::tracing::CommandTrace;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

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

fn spawn_matlab_processing_process(matlab_path: &str, batch: &str) -> std::io::Result<Child> {
    log::info!(
        "[PIPELINE] Spawning MATLAB process: {} with batch: {}",
        matlab_path,
        batch
    );
    let mut command = crate::apptainer::create_system_command(matlab_path);
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

pub(crate) fn build_apptainer_processing_args(
    project_root: &Path,
    sif_path: &Path,
    b_process_str: &str,
    worker: usize,
    total_workers: usize,
) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--cleanenv".to_string(),
        "--writable-tmpfs".to_string(),
        "--bind".to_string(),
        format!("{}:{CONTAINER_DATA_ROOT}", project_root.display()),
        sif_path.to_string_lossy().to_string(),
        "/bin/bash".to_string(),
        EXPLOREASL_SCRIPT.to_string(),
        MCR_PATH.to_string(),
        CONTAINER_DATA_ROOT.to_string(),
        "0".to_string(),
        b_process_str.to_string(),
        "0".to_string(),
        worker.to_string(),
        total_workers.to_string(),
    ]
}

fn spawn_apptainer_processing_process(
    apptainer_path: &str,
    args: &[String],
) -> std::io::Result<Child> {
    log::info!(
        "[PIPELINE] Spawning Apptainer processing process: {} args: {:?}",
        apptainer_path,
        args
    );
    let mut command = crate::apptainer::create_system_command(apptainer_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

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
    use nix::sys::signal::{Signal, kill};
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
    use nix::sys::signal::{Signal, kill};
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), Signal::SIGKILL)
        .map_err(|error| format!("Failed to send SIGKILL to PID {pid}: {error}"))
}

#[cfg(windows)]
fn force_kill_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess};
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
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, WaitForSingleObject,
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let result = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) };
    result == WAIT_TIMEOUT
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
    rerun_bids2legacy: bool,
) -> Result<Vec<u32>, String> {
    let trace = CommandTrace::new("run_pipeline");
    trace.arg("project_root", &project_root);
    trace.arg("execution_profile_id", execution_profile.id());
    trace.arg("workers", workers.to_string());
    trace.arg("subject_regexp", &subject_regexp);
    trace.arg("rerun_bids2legacy", rerun_bids2legacy.to_string());

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

    enum ProcessingExecution {
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
        ExecutionProfile::Matlab {
            explore_asl_version,
            ..
        } => {
            let version = explore_asl_version.or(validation.explore_asl_version);
            log::info!(
                "ExploreASL version: {}",
                version.as_deref().unwrap_or("unknown")
            );
            ProcessingExecution::Matlab {
                matlab_path: validation
                    .matlab_path
                    .expect("validated matlab profile should include matlab path"),
                exploreasl_path: validation
                    .explore_asl_path
                    .expect("validated matlab profile should include exploreasl path"),
            }
        }
        ExecutionProfile::Apptainer { .. } => {
            log::info!(
                "ExploreASL version: {}",
                validation
                    .explore_asl_version
                    .as_deref()
                    .unwrap_or("unknown")
            );
            let apptainer_path = validation
                .apptainer_path
                .expect("validated Apptainer profile should include executable path");
            let sif_path = validation
                .sif_path
                .expect("validated Apptainer profile should include SIF path");
            ensure_mcr_cache(&apptainer_path, &sif_path, &project_root)?;
            ProcessingExecution::Apptainer {
                apptainer_path,
                sif_path,
            }
        }
    };

    write_data_par_json(&project_root, &data_par_json)?;

    let lock_root = ensure_lock_dir(&project_root)?;
    clear_stale_lock_dirs(&lock_root, &b_process)?;
    if rerun_bids2legacy {
        delete_bids2legacy_locks(&project_root, &subject_regexp)?;
    }
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
    let project_root_str = escape_matlab_string(&project_root.to_string_lossy());

    let mut pids = Vec::new();
    let n_workers = workers as usize;

    for i_worker in 1..=n_workers {
        // Stagger worker launches to avoid ExploreASL initialization races
        // that can cause early worker exits (exitCode 1).
        if i_worker > 1 {
            std::thread::sleep(std::time::Duration::from_secs(2));
        }

        let child = match &execution {
            ProcessingExecution::Matlab {
                matlab_path,
                exploreasl_path,
            } => {
                let exploreasl_str = escape_matlab_string(&exploreasl_path.to_string_lossy());
                let batch = format!(
                    "addpath('{}'); ExploreASL('{}', 0, [{}], 0, {}, {})",
                    exploreasl_str, project_root_str, b_process_str, i_worker, n_workers,
                );
                spawn_matlab_processing_process(matlab_path, &batch).map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        format!("MATLAB executable not found: {}", matlab_path)
                    } else {
                        format!("Failed to spawn MATLAB worker {}: {}", i_worker, e)
                    }
                })?
            }
            ProcessingExecution::Apptainer {
                apptainer_path,
                sif_path,
            } => {
                let args = build_apptainer_processing_args(
                    &project_root,
                    sif_path,
                    &b_process_str,
                    i_worker,
                    n_workers,
                );
                spawn_apptainer_processing_process(apptainer_path, &args).map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        format!("Apptainer executable not found: {}", apptainer_path)
                    } else {
                        format!("Failed to spawn Apptainer worker {}: {}", i_worker, e)
                    }
                })?
            }
        };

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
