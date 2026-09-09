use std::path::Path;

/// Check if a directory name is a BIDS subject directory (starts with "sub-").
pub fn is_subject_dir(name: &str) -> bool {
    name.starts_with("sub-")
}

/// Check if a directory name is a BIDS session directory (starts with "ses-").
pub fn is_session_dir(name: &str) -> bool {
    name.starts_with("ses-")
}

/// Resolved session label with explicitness metadata (D2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSession {
    pub session_label: String,
    pub has_explicit_session: bool,
}

/// Resolve session labels for a subject directory.
///
/// If explicit `ses-*` directories exist, returns their labels (stripped of "ses-" prefix)
/// with `has_explicit_session = true`.
/// If no `ses-*` but `perf/` or `anat/` present directly, returns one session with
/// label `"1"` and `has_explicit_session = false` (D2).
/// Otherwise returns empty vec.
pub fn resolve_sessions(subject_dir: &Path) -> Vec<ResolvedSession> {
    let mut sessions = Vec::new();
    let mut has_ses_dirs = false;

    if let Ok(entries) = std::fs::read_dir(subject_dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type()
                && ft.is_dir()
            {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_session_dir(&name) {
                    has_ses_dirs = true;
                    sessions.push(ResolvedSession {
                        session_label: name.strip_prefix("ses-").unwrap().to_string(),
                        has_explicit_session: true,
                    });
                }
            }
        }
    }

    if has_ses_dirs {
        sessions.sort_by(|a, b| a.session_label.cmp(&b.session_label));
        return sessions;
    }

    // Cross-sectional: check for perf/ or anat/ directly under subject
    let has_perf = subject_dir.join("perf").is_dir();
    let has_anat = subject_dir.join("anat").is_dir();

    if has_perf || has_anat {
        return vec![ResolvedSession {
            session_label: "1".to_string(),
            has_explicit_session: false,
        }];
    }

    Vec::new()
}

#[cfg(test)]
#[path = "tests/path.rs"]
mod tests;
