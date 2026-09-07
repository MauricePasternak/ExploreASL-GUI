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
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ---- is_subject_dir / is_session_dir ----

    #[test]
    fn test_is_subject_dir_true() {
        assert!(is_subject_dir("sub-001"));
        assert!(is_subject_dir("sub-01"));
        assert!(is_subject_dir("sub-CONTROL"));
    }

    #[test]
    fn test_is_subject_dir_false() {
        assert!(!is_subject_dir("derivatives"));
        assert!(!is_subject_dir("sourcedata"));
        assert!(!is_subject_dir("ses-01"));
        assert!(!is_subject_dir("README.md"));
    }

    #[test]
    fn test_is_session_dir_true() {
        assert!(is_session_dir("ses-01"));
        assert!(is_session_dir("ses-baseline"));
    }

    #[test]
    fn test_is_session_dir_false() {
        assert!(!is_session_dir("sub-01"));
        assert!(!is_session_dir("perf"));
        assert!(!is_session_dir("anat"));
    }

    // ---- resolve_sessions ----

    #[test]
    fn test_resolve_sessions_cross_sectional_default() {
        // ds000240 style: sub-01/perf/ with no ses-* dirs
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("perf")).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_label, "1");
        assert!(!sessions[0].has_explicit_session);
    }

    #[test]
    fn test_resolve_sessions_explicit_ses01() {
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("ses-01")).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_label, "01");
        assert!(sessions[0].has_explicit_session);
    }

    #[test]
    fn test_resolve_sessions_non_numeric_baseline() {
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("ses-baseline")).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_label, "baseline");
        assert!(sessions[0].has_explicit_session);
    }

    #[test]
    fn test_resolve_sessions_longitudinal() {
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("ses-01")).unwrap();
        fs::create_dir(sub_dir.join("ses-02")).unwrap();

        let mut sessions = resolve_sessions(&sub_dir);
        sessions.sort_by(|a, b| a.session_label.cmp(&b.session_label));
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_label, "01");
        assert_eq!(sessions[1].session_label, "02");
        assert!(sessions.iter().all(|s| s.has_explicit_session));
    }

    #[test]
    fn test_resolve_sessions_cross_sectional_anat_only() {
        // No ses-* dirs, but has anat/ directly
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("anat")).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_label, "1");
        assert!(!sessions[0].has_explicit_session);
    }

    #[test]
    fn test_resolve_sessions_explicit_ses1() {
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();
        fs::create_dir(sub_dir.join("ses-1")).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_label, "1");
        assert!(sessions[0].has_explicit_session);
    }

    #[test]
    fn test_resolve_sessions_no_perf_no_anat_no_ses() {
        // Empty subject dir: no ses, no perf, no anat
        let tmp = TempDir::new().unwrap();
        let sub_dir = tmp.path().join("sub-01");
        fs::create_dir(&sub_dir).unwrap();

        let sessions = resolve_sessions(&sub_dir);
        assert!(sessions.is_empty());
    }
}
