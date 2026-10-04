//! Host CPU and memory information for worker configuration.
use crate::tracing::CommandTrace;

#[tauri::command]
pub fn get_cpu_cores() -> usize {
    let trace = CommandTrace::new("get_cpu_cores");
    let cores = num_cpus::get_physical();
    trace.success(&cores);
    cores
}

#[tauri::command]
pub fn get_available_memory_mb() -> u64 {
    let trace = CommandTrace::new("get_available_memory_mb");
    let mb = available_memory_mb_impl();
    trace.success(&mb);
    mb
}

#[cfg(target_os = "linux")]
fn available_memory_mb_impl() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|contents| {
            for line in contents.lines() {
                if line.starts_with("MemAvailable:") {
                    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
                    return Some(kb / 1024);
                }
            }
            None
        })
        .unwrap_or(16_384)
}

#[cfg(target_os = "macos")]
fn available_memory_mb_impl() -> u64 {
    use std::process::Command;
    Command::new("sysctl")
        .arg("-n")
        .arg("hw.memsize")
        .output()
        .ok()
        .and_then(|output| {
            let s = String::from_utf8_lossy(&output.stdout);
            let bytes: u64 = s.trim().parse().ok()?;
            Some(bytes / 1024 / 1024)
        })
        .unwrap_or(16_384)
}

#[cfg(target_os = "windows")]
fn available_memory_mb_impl() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GlobalMemoryStatusEx;
    use windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX;

    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
        status.ullAvailPhys / 1024 / 1024
    } else {
        16_384
    }
}
