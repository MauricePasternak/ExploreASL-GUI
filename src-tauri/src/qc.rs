use anyhow::{Context, Result as AnyResult, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::IntoCommandResult;
use crate::tracing::CommandTrace;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QcMeasure {
    pub key: String,
    pub label: String,
    pub value: String,
}

fn format_qc_label(key: &str) -> String {
    let mut label = String::new();
    let mut capitalize = true;
    for c in key.chars() {
        if c == '_' {
            label.push(' ');
            capitalize = true;
        } else if capitalize {
            label.push(c.to_ascii_uppercase());
            capitalize = false;
        } else {
            label.push(c);
        }
    }
    label
}

fn format_json_value(val: &Value) -> String {
    match val {
        Value::Null => "".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.trim().to_string(),
        Value::Array(arr) => {
            if arr.is_empty() {
                return "".to_string();
            }
            let formatted_elements: Vec<String> = arr.iter().map(format_json_value).collect();
            let first = &formatted_elements[0];
            let all_same = formatted_elements.iter().all(|x| x == first);
            if all_same {
                first.clone()
            } else {
                formatted_elements.join(", ")
            }
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

pub fn extract_qc_measures(
    file_path: &Path,
    module: &str,
    run: Option<&str>,
) -> AnyResult<Vec<QcMeasure>> {
    if !file_path.exists() {
        bail!("QC collection file not found: {}", file_path.display());
    }

    let content = fs::read_to_string(file_path)
        .with_context(|| format!("Failed to read file {}", file_path.display()))?;

    let json: Value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse JSON in {}", file_path.display()))?;

    let mut measures = Vec::new();

    if module.eq_ignore_ascii_case("structural") {
        if let Some(structural_val) = json.get("Structural") {
            if let Some(obj) = structural_val.as_object() {
                for (k, v) in obj {
                    measures.push(QcMeasure {
                        key: k.clone(),
                        label: format_qc_label(k),
                        value: format_json_value(v),
                    });
                }
            } else {
                bail!("Field 'Structural' in JSON is not an object");
            }
        } else {
            bail!("Field 'Structural' not found in JSON");
        }
    } else if module.eq_ignore_ascii_case("asl") {
        if let Some(asl_val) = json.get("ASL") {
            if let Some(asl_obj) = asl_val.as_object() {
                let run_key = if let Some(r) = run {
                    let r_trimmed = r.trim_start_matches('0');
                    let key_option_1 = format!("ASL_{}", r);
                    let key_option_2 = format!("ASL_{}", r_trimmed);

                    if asl_obj.contains_key(&key_option_1) {
                        Some(key_option_1)
                    } else if asl_obj.contains_key(&key_option_2) {
                        Some(key_option_2)
                    } else {
                        asl_obj
                            .keys()
                            .find(|k| {
                                k.eq_ignore_ascii_case(&key_option_1)
                                    || k.eq_ignore_ascii_case(&key_option_2)
                                    || k.ends_with(&format!("_{}", r))
                                    || k.ends_with(&format!("_{}", r_trimmed))
                            })
                            .cloned()
                    }
                } else {
                    asl_obj.keys().find(|k| k.starts_with("ASL_")).cloned()
                };

                if let Some(key) = run_key {
                    if let Some(run_data) = asl_obj.get(&key) {
                        if let Some(obj) = run_data.as_object() {
                            for (k, v) in obj {
                                measures.push(QcMeasure {
                                    key: k.clone(),
                                    label: format_qc_label(k),
                                    value: format_json_value(v),
                                });
                            }
                        } else {
                            bail!("Field 'ASL.{}' in JSON is not an object", key);
                        }
                    } else {
                        bail!("Field 'ASL.{}' not found in JSON", key);
                    }
                } else {
                    bail!("No matching ASL run found in JSON for run: {:?}", run);
                }
            } else {
                bail!("Field 'ASL' in JSON is not an object");
            }
        } else {
            bail!("Field 'ASL' not found in JSON");
        }
    } else {
        bail!("Unsupported module: {}", module);
    }

    measures.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(measures)
}

#[tauri::command]
pub fn get_subject_session_qc(
    project_root: String,
    subject_session: String,
    module: String,
    run: Option<String>,
) -> Result<Vec<QcMeasure>, String> {
    let trace = CommandTrace::new("get_subject_session_qc");
    trace.arg("project_root", &project_root);
    trace.arg("subject_session", &subject_session);
    trace.arg("module", &module);
    trace.arg("run", &run);

    let Some(file_path) = find_qc_collection_file(&project_root, &subject_session) else {
        let session_dir = PathBuf::from(&project_root)
            .join("derivatives")
            .join("ExploreASL")
            .join(&subject_session);
        let err = if !session_dir.exists() {
            format!(
                "Subject session directory not found: {}",
                session_dir.display()
            )
        } else {
            format!("No QC collection file found in {}", session_dir.display())
        };
        trace.error(&err);
        return Err(err);
    };

    let result = extract_qc_measures(&file_path, &module, run.as_deref());
    match &result {
        Ok(measures) => trace.success(&format!("Found {} measures", measures.len())),
        Err(err) => trace.error(err),
    }
    result.into_command_result()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubjectQcOutputs {
    pub coverage: Option<f64>,
    pub spatial_cov: Option<f64>,
    pub motion: Vec<f64>,
    pub motion_exclusion_pct: Option<f64>,
}

fn val_to_f64(val: &Value) -> Option<f64> {
    match val {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Array(arr) => {
            if arr.is_empty() {
                None
            } else {
                val_to_f64(&arr[0])
            }
        }
        _ => None,
    }
}

pub fn find_qc_collection_file(project_root: &str, subject_session: &str) -> Option<PathBuf> {
    let session_dir = PathBuf::from(project_root)
        .join("derivatives")
        .join("ExploreASL")
        .join(subject_session);

    if !session_dir.exists() {
        return None;
    }

    let file_path = session_dir.join(format!("QC_collection_{}.json", subject_session));
    if file_path.exists() {
        return Some(file_path);
    }

    // Fallback: search for any QC_collection_*.json in the directory
    if let Ok(entries) = fs::read_dir(&session_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type()
                && file_type.is_file()
            {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("QC_collection_") && name.ends_with(".json") {
                    return Some(entry.path());
                }
            }
        }
    }

    None
}

pub fn extract_subject_qc_outputs(file_path: &Path) -> AnyResult<SubjectQcOutputs> {
    let content = fs::read_to_string(file_path)
        .with_context(|| format!("Failed to read file {}", file_path.display()))?;

    let json: Value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse JSON in {}", file_path.display()))?;

    let asl_val = json.get("ASL").context("Field 'ASL' not found in JSON")?;
    let asl_obj = asl_val
        .as_object()
        .context("Field 'ASL' in JSON is not an object")?;

    let mut coverages = Vec::new();
    let mut spatial_covs = Vec::new();
    let mut motions = Vec::new();
    let mut motion_exclusions = Vec::new();

    for (key, val) in asl_obj {
        if key.starts_with("ASL_")
            && let Some(run_obj) = val.as_object()
        {
            if let Some(cov_val) = run_obj.get("ASL_Coverage_Perc")
                && let Some(cov) = val_to_f64(cov_val)
            {
                coverages.push(cov);
            }
            if let Some(sc_val) = run_obj.get("SpatialCoV_GM_Perc")
                && let Some(sc) = val_to_f64(sc_val)
            {
                spatial_covs.push(sc);
            }
            if let Some(mot_val) = run_obj.get("MotionMean_mm")
                && let Some(mot) = val_to_f64(mot_val)
            {
                motions.push(mot);
            }
            if let Some(excl_val) = run_obj.get("MotionExcl_Perc")
                && let Some(excl) = val_to_f64(excl_val)
            {
                motion_exclusions.push(excl);
            }
        }
    }

    let coverage = if coverages.is_empty() {
        None
    } else {
        Some(coverages.iter().sum::<f64>() / coverages.len() as f64)
    };

    let spatial_cov = if spatial_covs.is_empty() {
        None
    } else {
        Some(spatial_covs.iter().sum::<f64>() / spatial_covs.len() as f64)
    };

    let motion_exclusion_pct = if motion_exclusions.is_empty() {
        None
    } else {
        Some(motion_exclusions.iter().sum::<f64>() / motion_exclusions.len() as f64)
    };

    Ok(SubjectQcOutputs {
        coverage,
        spatial_cov,
        motion: motions,
        motion_exclusion_pct,
    })
}

#[tauri::command]
pub fn get_all_subjects_qc(
    project_root: String,
    subject_sessions: Vec<String>,
) -> Result<std::collections::HashMap<String, SubjectQcOutputs>, String> {
    let trace = CommandTrace::new("get_all_subjects_qc");
    trace.arg("project_root", &project_root);
    trace.arg("subject_sessions_count", subject_sessions.len().to_string());

    let mut results = std::collections::HashMap::new();

    for ss in subject_sessions {
        if let Some(file_path) = find_qc_collection_file(&project_root, &ss) {
            match extract_subject_qc_outputs(&file_path) {
                Ok(outputs) => {
                    results.insert(ss, outputs);
                }
                Err(err) => {
                    log::warn!("Failed to extract QC for {}: {:#}", ss, err);
                }
            }
        }
    }

    trace.success(&format!("Batch fetched QC for {} subjects", results.len()));
    Ok(results)
}

#[cfg(test)]
#[path = "qc_tests.rs"]
mod tests;
