use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::tracing::CommandTrace;

#[path = "matlab_tests.rs"]
#[cfg(test)]
mod matlab_tests;

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
            if p.is_file()
                && is_matlab_executable(&p)
                && let Ok(canonical) = fs::canonicalize(&p)
                && seen.insert(canonical)
            {
                paths.push(p);
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
            if candidate.is_file()
                && is_matlab_executable(&candidate)
                && let Ok(canonical) = fs::canonicalize(&candidate)
                && seen.insert(canonical)
            {
                paths.push(candidate);
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
                    if candidate.is_file()
                        && is_matlab_executable(&candidate)
                        && let Ok(canonical) = fs::canonicalize(&candidate)
                        && seen.insert(canonical)
                    {
                        paths.push(candidate);
                    }
                }
            }
        }
    }
}

fn matlab_executable_candidates(bin_dir: &Path) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
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
    let output = match crate::apptainer::create_system_command(binary)
        .args(["-batch", "disp(version('-release'))"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            log::warn!(
                "[COMMAND] which_matlab — failed to spawn {:?}: {}",
                binary,
                e
            );
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

    log::info!("[COMMAND] which_matlab — {:?} stdout: {:?}", binary, stdout);

    if release.is_empty() {
        log::warn!(
            "[COMMAND] which_matlab — {:?} produced empty output",
            binary
        );
        return None;
    }

    Some(format!("R{}", release))
}

/// Prefer filesystem metadata over launching MATLAB (which can take many seconds
/// and starve the UI while the preparing spinner should keep animating).
pub fn probe_matlab_version_fast(matlab_path: &Path) -> Option<String> {
    if matlab_path.as_os_str().is_empty() {
        return None;
    }

    let resolved = fs::canonicalize(matlab_path).unwrap_or_else(|_| matlab_path.to_path_buf());

    if let Some(from_xml) = read_matlab_version_info_xml(&resolved) {
        return Some(from_xml);
    }

    release_from_path(&resolved)
}

fn read_matlab_version_info_xml(start: &Path) -> Option<String> {
    let mut current = if start.is_file() {
        start.parent().unwrap_or(start).to_path_buf()
    } else {
        start.to_path_buf()
    };

    for _ in 0..8 {
        let candidate = current.join("VersionInfo.xml");
        if candidate.is_file()
            && let Ok(contents) = fs::read_to_string(&candidate)
        {
            if let Some(release) = extract_xml_tag(&contents, "release") {
                let release = release.trim();
                if !release.is_empty() {
                    return Some(if release.starts_with('R') {
                        release.to_string()
                    } else {
                        format!("R{release}")
                    });
                }
            }
            if let Some(version) = extract_xml_tag(&contents, "version") {
                let version = version.trim();
                if !version.is_empty() {
                    return Some(version.to_string());
                }
            }
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent.to_path_buf(),
            _ => break,
        }
    }
    None
}

fn extract_xml_tag(contents: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = contents.find(&open)? + open.len();
    let end = contents[start..].find(&close)? + start;
    Some(contents[start..end].trim().to_string())
}

fn release_from_path(path: &Path) -> Option<String> {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        // Standard Win/Linux: .../R2022b/...
        // macOS app bundle: .../MATLAB_R2022b.app/...
        let candidate = name
            .strip_prefix("MATLAB_")
            .map(|rest| rest.strip_suffix(".app").unwrap_or(rest))
            .unwrap_or(name.as_ref());
        if let Some(rest) = candidate.strip_prefix('R') {
            let mut chars = rest.chars();
            let year: String = chars.by_ref().take(4).collect();
            if year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()) {
                let letter = chars.next();
                if matches!(letter, Some('a' | 'b')) && chars.next().is_none() {
                    return Some(format!("R{year}{}", letter.unwrap()));
                }
            }
        }
    }
    None
}

pub fn probe_matlab_version(matlab_path: &Path) -> Result<String, String> {
    if let Some(fast) = probe_matlab_version_fast(matlab_path) {
        log::info!(
            "[COMMAND] capture_environment_versions — matlab fast path: {}",
            fast
        );
        return Ok(fast);
    }

    // Last resort: launching MATLAB is slow and CPU-heavy; keep a short timeout.
    let (tx, rx) = mpsc::channel();
    let binary = matlab_path.to_path_buf();
    let timeout = Duration::from_secs(20);

    thread::spawn(move || {
        let result = run_matlab_full_version(&binary);
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Some(version)) => Ok(version),
        Ok(None) => Err("matlab probe failed to execute or returned empty output".to_string()),
        Err(mpsc::RecvTimeoutError::Timeout) => Err("matlab probe timed out".to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("matlab probe thread disconnected".to_string())
        }
    }
}

fn run_matlab_full_version(binary: &Path) -> Option<String> {
    let output = match crate::apptainer::create_system_command(binary)
        .args(["-batch", "disp(version)"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(_) => return None,
    };

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout.trim();
    if version.is_empty() {
        return None;
    }
    Some(version.to_string())
}
