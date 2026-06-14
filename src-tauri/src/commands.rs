use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use walkdir::WalkDir;

use crate::tracing::CommandTrace;

#[tauri::command]
pub async fn which_matlab(custom_paths: Option<Vec<String>>) -> Vec<serde_json::Value> {
    let trace = CommandTrace::new("which_matlab");
    let mut seen = HashSet::new();
    let mut paths: Vec<PathBuf> = Vec::new();

    let scan_all = match &custom_paths {
        None => true,
        Some(custom) => custom.is_empty(),
    };

    if let Some(custom) = custom_paths {
        for path_str in custom {
            if path_str.trim().is_empty() {
                continue;
            }
            let p = PathBuf::from(&path_str);
            if p.is_file() && is_matlab_executable(&p) {
                if let Ok(canonical) = fs::canonicalize(&p) {
                    if seen.insert(canonical) {
                        paths.push(p);
                    }
                }
            }
        }
    }

    if scan_all {
        find_matlab_on_path(&mut paths, &mut seen);
        find_matlab_standard_dirs(&mut paths, &mut seen);
    }

    log::info!(
        "[COMMAND] which_matlab — found {} candidate binaries",
        paths.len()
    );
    for p in &paths {
        log::info!("[COMMAND] which_matlab — candidate: {:?}", p);
    }

    let mut handles = Vec::new();
    for (i, path) in paths.into_iter().enumerate() {
        let handle = tauri::async_runtime::spawn_blocking(move || {
            let version = detect_matlab_version_impl(&path);
            log::info!(
                "[COMMAND] which_matlab — version for {:?}: {:?}",
                path,
                version
            );
            serde_json::json!({
                "id": format!("matlab_{}", i),
                "label": format!("MATLAB ({})", path.display()),
                "path": path.to_string_lossy(),
                "version": version,
            })
        });
        handles.push(handle);
    }

    let mut results: Vec<serde_json::Value> = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(item) = handle.await {
            results.push(item);
        }
    }

    trace.success(&results);
    results
}

fn find_matlab_on_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let path_var = env::var_os("PATH")
        .and_then(|v| v.into_string().ok())
        .unwrap_or_default();

    for dir in env::split_paths(&path_var) {
        for candidate in matlab_executable_candidates(&dir) {
            if candidate.is_file() && is_matlab_executable(&candidate) {
                if let Ok(canonical) = fs::canonicalize(&candidate) {
                    if seen.insert(canonical) {
                        paths.push(candidate);
                    }
                }
            }
        }
    }
}

fn find_matlab_standard_dirs(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    for search_root in matlab_search_roots() {
        if let Ok(entries) = fs::read_dir(&search_root) {
            for entry in entries.flatten() {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                let bin_dir = dir.join("bin");
                for candidate in matlab_executable_candidates(&bin_dir) {
                    if candidate.is_file() && is_matlab_executable(&candidate) {
                        if let Ok(canonical) = fs::canonicalize(&candidate) {
                            if seen.insert(canonical) {
                                paths.push(candidate);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn matlab_executable_candidates(bin_dir: &Path) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let pathext =
            env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        let mut candidates: Vec<PathBuf> = pathext
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(|ext| bin_dir.join(format!("matlab{}", ext)))
            .collect();
        candidates.push(bin_dir.join("matlab"));
        candidates
    }
    #[cfg(not(windows))]
    {
        vec![bin_dir.join("matlab")]
    }
}

#[cfg(not(any(unix, windows)))]
fn is_matlab_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(unix)]
fn is_matlab_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_matlab_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(target_os = "linux")]
fn matlab_search_roots() -> Vec<PathBuf> {
    vec![PathBuf::from("/usr/local/MATLAB")]
}

#[cfg(target_os = "macos")]
fn matlab_search_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/usr/local/MATLAB"),
    ]
}

#[cfg(target_os = "windows")]
fn matlab_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in &["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = env::var_os(key) {
            let p = PathBuf::from(pf).join("MATLAB");
            roots.push(p);
        }
    }
    roots.dedup();
    roots
}

fn detect_matlab_version_impl(binary: &Path) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    let binary = binary.to_path_buf();
    let timeout = Duration::from_secs(15);

    thread::spawn(move || {
        let result = run_matlab_release(&binary);
        let _ = tx.send(result);
    });

    rx.recv_timeout(timeout).ok().flatten()
}

fn run_matlab_release(binary: &Path) -> Option<String> {
    log::info!("[COMMAND] which_matlab — executing {:?}", binary);
    let output = match Command::new(binary)
        .args(["-batch", "disp(version('-release'))"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            log::warn!("[COMMAND] which_matlab — failed to spawn {:?}: {}", binary, e);
            return None;
        }
    };

    if !output.status.success() {
        log::warn!(
            "[COMMAND] which_matlab — {:?} exited with {}: {}",
            binary,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let release = stdout.trim();

    log::info!(
        "[COMMAND] which_matlab — {:?} stdout: {:?}",
        binary,
        stdout
    );

    if release.is_empty() {
        log::warn!("[COMMAND] which_matlab — {:?} produced empty output", binary);
        return None;
    }

    Some(format!("R{}", release))
}

#[tauri::command]
pub fn is_writable(path: &str) -> bool {
    let trace = CommandTrace::new("is_writable");
    trace.arg("path", path);
    let test_file = format!("{}/.easl_write_test", path);

    let result = fs::write(&test_file, b"").is_ok() && fs::remove_file(&test_file).is_ok();
    trace.success(&result);
    result
}

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
                    let kb: u64 = line
                        .split_whitespace()
                        .nth(1)?
                        .parse()
                        .ok()?;
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
    use windows_sys::Win32::System::Memory::GlobalMemoryStatusEx;
    use windows_sys::Win32::System::Memory::MEMORYSTATUSEX;

    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
        status.ullAvailPhys / 1024 / 1024
    } else {
        16_384
    }
}

/// Recursively walk a directory tree to find DICOM data locations.
///
/// If `b_match_directories` is true: returns relative paths to directories
/// containing at least one `.dcm` file.
///
/// If `b_match_directories` is false: returns relative paths to individual
/// `.dcm` files.
///
/// All paths are returned relative to `root`.
#[tauri::command]
pub fn walk_directory(
    root: String,
    max_depth: u32,
    b_match_directories: bool,
) -> Result<Vec<String>, String> {
    let trace = CommandTrace::new("walk_directory");
    trace.arg("root", &root);
    trace.arg("max_depth", max_depth);
    trace.arg("b_match_directories", b_match_directories);

    let root_path = Path::new(&root);

    if !root_path.exists() {
        let err = format!("Directory does not exist: {}", root);
        trace.error(&err);
        return Err(err);
    }

    if !root_path.is_dir() {
        let err = format!("Path is not a directory: {}", root);
        trace.error(&err);
        return Err(err);
    }

    let walker = WalkDir::new(&root)
        .max_depth(max_depth as usize)
        .follow_links(true);

    let result = if b_match_directories {
        let mut dcm_dirs = std::collections::HashSet::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(ext) = entry.path().extension() {
                    if ext.eq_ignore_ascii_case("dcm") {
                        if let Some(parent) = entry.path().parent() {
                            if let Ok(relative) = parent.strip_prefix(&root) {
                                dcm_dirs.insert(relative.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }

        let mut result: Vec<String> = dcm_dirs.into_iter().collect();
        result.sort();
        Ok(result)
    } else {
        let mut dcm_files = Vec::new();

        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(ext) = entry.path().extension() {
                    if ext.eq_ignore_ascii_case("dcm") {
                        if let Ok(relative) = entry.path().strip_prefix(&root) {
                            dcm_files.push(relative.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        dcm_files.sort();
        Ok(dcm_files)
    };

    match &result {
        Ok(val) => trace.success(&val),
        Err(err) => trace.error(&err),
    }
    result
}

/// Entry for creating a symlink in the staging tree.
#[derive(Debug, Deserialize, Serialize)]
pub struct SymlinkEntry {
    pub subject: String,
    pub session: String,
    pub run: String,
    pub modality: String,
    pub source_path: String,
}

/// Create the BIDS-compliant staging tree with symlinks (or copies on Windows).
///
/// Creates directories at:
///   staging_root/sourcedata/<Subject>/<Session>/<Run>/<Modality>/
///
/// Then symlinks (Linux/macOS) or copies (Windows) all files from source_path
/// into the corresponding staging directory.
#[tauri::command]
pub fn create_symlink_tree(
    mappings: Vec<SymlinkEntry>,
    staging_root: String,
) -> Result<(), String> {
    let trace = CommandTrace::new("create_symlink_tree");
    trace.arg("staging_root", &staging_root);
    trace.arg("mappings_count", mappings.len());

    let staging_base = Path::new(&staging_root).join("sourcedata");

    for entry in &mappings {
        let target_dir = staging_base
            .join(&entry.subject)
            .join(&entry.session)
            .join(&entry.run)
            .join(&entry.modality);

        fs::create_dir_all(&target_dir).map_err(|e| {
            let err = format!("Failed to create directory {}: {}", target_dir.display(), e);
            trace.error(&err);
            err
        })?;

        let source = Path::new(&entry.source_path);

        if source.is_dir() {
            let entries = fs::read_dir(source).map_err(|e| {
                let err = format!("Failed to read directory {}: {}", source.display(), e);
                trace.error(&err);
                err
            })?;

            for file_entry in entries.flatten() {
                if file_entry.file_type().is_ok_and(|ft| ft.is_file()) {
                    let target_file = target_dir.join(file_entry.file_name());
                    link_or_copy(&file_entry.path(), &target_file)?;
                }
            }
        } else if source.is_file() {
            let file_name = source.file_name().ok_or_else(|| {
                let err = format!("Invalid file path: {}", source.display());
                trace.error(&err);
                err
            })?;
            let target_file = target_dir.join(file_name);
            link_or_copy(source, &target_file)?;
        } else {
            let err = format!("Source path does not exist: {}", source.display());
            trace.error(&err);
            return Err(err);
        }
    }

    trace.success(&"ok");
    Ok(())
}

/// Create a symlink (Unix) or copy (Windows fallback) from source to target.
fn link_or_copy(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target).map_err(|e| {
            format!(
                "Failed to create symlink {} -> {}: {}",
                target.display(),
                source.display(),
                e
            )
        })
    }

    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(source, target).is_ok() {
            return Ok(());
        }
        if fs::hard_link(source, target).is_ok() {
            return Ok(());
        }
        fs::copy(source, target).map(|_| ()).map_err(|e| {
            format!(
                "Failed to copy {} -> {}: {}",
                source.display(),
                target.display(),
                e
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[cfg(unix)]
    #[test]
    fn detect_matlab_version_from_fake_binary() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("easl-gui-matlab-test-{}", ts));
        fs::create_dir_all(&dir).unwrap();

        let fake_matlab = dir.join("matlab");
        {
            let mut f = fs::File::create(&fake_matlab).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "echo '2022b'").unwrap();
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&fake_matlab, PermissionsExt::from_mode(0o755)).unwrap();
        }

        let version = run_matlab_release(&fake_matlab);
        assert_eq!(version, Some("R2022b".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn run_matlab_release_rejects_failure() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("easl-gui-matlab-fail-{}", ts));
        fs::create_dir_all(&dir).unwrap();

        let fake_matlab = dir.join("matlab");
        {
            let mut f = fs::File::create(&fake_matlab).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "echo nope >&2").unwrap();
            writeln!(f, "exit 1").unwrap();
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&fake_matlab, PermissionsExt::from_mode(0o755)).unwrap();
        }

        let version = run_matlab_release(&fake_matlab);
        assert_eq!(version, None);

        let _ = fs::remove_dir_all(&dir);
    }
}
