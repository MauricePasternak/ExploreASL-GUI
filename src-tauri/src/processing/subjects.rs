use super::types::SubjectInfo;
use super::utils::normalize_asl_run_id_opt;
use crate::tracing::CommandTrace;
use std::path::PathBuf;

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

            // Map BIDS run labels (or absent) to ExploreASL legacy numeric IDs ("1","2",…).
            let mut asl_runs: Vec<String> = session
                .asl_files
                .iter()
                .map(|f| normalize_asl_run_id_opt(f.run_label.as_deref()))
                .collect();
            asl_runs.sort_by(|a, b| {
                a.parse::<u32>()
                    .unwrap_or(0)
                    .cmp(&b.parse::<u32>().unwrap_or(0))
            });
            asl_runs.dedup();

            // Fallback: if perf dir exists but no ASL files found, default to ["1"]
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
