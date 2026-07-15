use super::types::ReportFileInfo;
use super::utils::normalize_asl_run_id_opt;
use crate::tracing::CommandTrace;
use std::fs;
use std::path::PathBuf;

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
    if let Ok(entries) = fs::read_dir(&t1_check) {
        let t1_re = regex::Regex::new(r"^Tra_Seg_rT1_(sub-[^_]+_\d+)_rc2T1_")
            .expect("T1 report pattern should compile");
        let reports = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let caps = t1_re.captures(&name)?;
                let sub_ses = caps.get(1)?.as_str().to_string();
                Some(ReportFileInfo {
                    module: "structural".to_string(),
                    subject_session: sub_ses,
                    run: None,
                })
            });
        results.extend(reports);
    }

    // 2. ASL Reports in ASLCheck
    let asl_check = population.join("ASLCheck");
    if let Ok(entries) = fs::read_dir(&asl_check) {
        let asl_re = regex::Regex::new(r"^Tra_Reg_qCBF_(sub-[^_]+_\d+)_ASL_(\d+)_PV_pWM_")
            .expect("ASL report pattern should compile");
        let reports = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let caps = asl_re.captures(&name)?;
                let sub_ses = caps.get(1)?.as_str().to_string();
                let run_val = caps.get(2).map(|m| m.as_str().to_string());
                Some(ReportFileInfo {
                    module: "asl".to_string(),
                    subject_session: sub_ses,
                    run: run_val,
                })
            });
        results.extend(reports);
    }

    // 3. M0 Reports in M0Reg_ASL
    let m0_check = population.join("M0Reg_ASL");
    if let Ok(entries) = fs::read_dir(&m0_check) {
        let m0_re = regex::Regex::new(r"^Tra_Reg_noSmooth_M0_(sub-[^_]+_\d+)_ASL_(\d+)_PV_pGM_")
            .expect("M0 report pattern should compile");
        let reports = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let caps = m0_re.captures(&name)?;
                let sub_ses = caps.get(1)?.as_str().to_string();
                let run_val = caps.get(2).map(|m| m.as_str().to_string());
                Some(ReportFileInfo {
                    module: "m0".to_string(),
                    subject_session: sub_ses,
                    run: run_val,
                })
            });
        results.extend(reports);
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
            let run_str = normalize_asl_run_id_opt(run.as_deref());
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
            let run_str = normalize_asl_run_id_opt(run.as_deref());
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
