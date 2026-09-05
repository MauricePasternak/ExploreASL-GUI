use std::time::{Duration, Instant};

/// Validate a PID used by exact-child process-control APIs.
///
/// PID 0 has process-group semantics on Unix and for Windows console events.
/// Unix negative values also have process-group or broadcast semantics, so the
/// unsigned value must fit the strictly positive `pid_t` range.
pub(crate) fn validate_process_id(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("PID 0 is not a valid child process ID".to_string());
    }

    #[cfg(unix)]
    validate_unix_pid_range(pid)?;

    Ok(())
}

pub(crate) fn validate_process_ids(pids: &[u32]) -> Result<(), String> {
    pids.iter().try_for_each(|&pid| validate_process_id(pid))
}

#[cfg(unix)]
fn validate_unix_pid_range(pid: u32) -> Result<(), String> {
    if pid > i32::MAX as u32 {
        return Err(format!("PID {pid} exceeds the Unix positive PID range"));
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn checked_unix_pid(pid: u32) -> Result<nix::unistd::Pid, String> {
    validate_process_id(pid)?;
    Ok(nix::unistd::Pid::from_raw(pid as i32))
}

#[cfg(unix)]
pub(crate) fn send_termination_signal(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{Signal, kill};

    let pid = checked_unix_pid(pid)?;
    kill(pid, Signal::SIGTERM)
        .map_err(|error| format!("Failed to send SIGTERM to PID {}: {error}", pid.as_raw()))
}

#[cfg(windows)]
pub(crate) fn send_termination_signal(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent;

    validate_process_id(pid)?;
    let ok = unsafe { GenerateConsoleCtrlEvent(1, pid) };
    if ok == 0 {
        return Err(format!("Failed to send CTRL_BREAK_EVENT to PID {pid}"));
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn force_kill_process(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{Signal, kill};

    let pid = checked_unix_pid(pid)?;
    kill(pid, Signal::SIGKILL)
        .map_err(|error| format!("Failed to send SIGKILL to PID {}: {error}", pid.as_raw()))
}

#[cfg(windows)]
pub(crate) fn force_kill_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess};

    validate_process_id(pid)?;
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
pub(crate) fn process_exists(pid: u32) -> Result<bool, String> {
    use nix::errno::Errno;
    use nix::sys::signal::kill;

    let pid = checked_unix_pid(pid)?;
    match kill(pid, None) {
        Ok(()) | Err(Errno::EPERM) => Ok(true),
        Err(Errno::ESRCH) => Ok(false),
        Err(error) => Err(format!(
            "Failed to check whether PID {} exists: {error}",
            pid.as_raw()
        )),
    }
}

#[cfg(windows)]
pub(crate) fn process_exists(pid: u32) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, GetLastError, WAIT_FAILED,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, WaitForSingleObject,
    };

    validate_process_id(pid)?;
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return match unsafe { GetLastError() } {
            ERROR_INVALID_PARAMETER => Ok(false),
            ERROR_ACCESS_DENIED => Ok(true),
            error => Err(format!(
                "Failed to open PID {pid} to check whether it exists: OS error {error}"
            )),
        };
    }

    let result = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) };
    match result {
        WAIT_TIMEOUT => Ok(true),
        WAIT_OBJECT_0 => Ok(false),
        WAIT_FAILED => Err(format!(
            "Failed while checking whether PID {pid} exists: OS error {}",
            unsafe { GetLastError() }
        )),
        result => Err(format!(
            "Unexpected wait result {result} while checking PID {pid}"
        )),
    }
}

pub(crate) fn wait_for_process_exit(pid: u32, timeout: Duration) -> Result<bool, String> {
    validate_process_id(pid)?;
    let deadline = Instant::now() + timeout;
    loop {
        if !process_exists(pid)? {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_zero_is_rejected_by_pure_validation() {
        assert_eq!(
            validate_process_id(0).unwrap_err(),
            "PID 0 is not a valid child process ID"
        );
    }

    #[cfg(unix)]
    #[test]
    fn unsigned_max_is_rejected_by_pure_validation() {
        let error = validate_process_id(u32::MAX).unwrap_err();
        assert!(error.contains("exceeds the Unix positive PID range"));
    }

    #[cfg(unix)]
    #[test]
    fn first_value_above_unix_pid_range_is_rejected() {
        let pid = i32::MAX as u32 + 1;
        let error = checked_unix_pid(pid).unwrap_err();
        assert!(error.contains("exceeds the Unix positive PID range"));
    }

    #[cfg(unix)]
    #[test]
    fn valid_positive_pid_converts_exactly() {
        let pid = i32::MAX as u32;
        assert_eq!(checked_unix_pid(pid).unwrap().as_raw(), i32::MAX);
    }
}
