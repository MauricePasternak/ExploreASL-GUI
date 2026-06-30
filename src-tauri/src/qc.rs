use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::tracing::CommandTrace;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QcMeasure {
    pub key: String,
    pub label: String,
    pub value: String,
}

fn translate_key(key: &str) -> String {
    match key {
        // Structural measures
        "T1w_GM_ICV_Ratio" => "Ratio of Gray Matter vs Intra-cortical Volume".to_string(),
        "T1w_WM_ICV_Ratio" => "Ratio of White Matter vs Intra-cortical Volume".to_string(),
        "T1w_CSF_ICV_Ratio" => "Ratio of Cerebrospinal Fluid vs Intra-cortical Volume".to_string(),
        "T1w_GM_vol_mL" => "Gray Matter Volume (mL)".to_string(),
        "T1w_WM_vol_mL" => "White Matter Volume (mL)".to_string(),
        "T1w_CSF_vol_mL" => "Cerebrospinal Fluid Volume (mL)".to_string(),
        "T1w_ICV_vol_mL" => "Total Intra-cortical Volume (mL)".to_string(),
        "T1w_WMref_vol_mL" => "White Matter Reference Volume (mL)".to_string(),
        "T1w_SD_WMref" => "Standard Deviation of White Matter Reference".to_string(),
        "T1w_SNR_GM_Ratio" => "Signal-to-Noise Ratio (SNR) in Gray Matter".to_string(),
        "T1w_CNR_GM_WM_Ratio" => {
            "Contrast-to-Noise Ratio (CNR) between Gray and White Matter".to_string()
        }
        "T1w_FBER_WMref_Ratio" => {
            "Foreground-to-Background Energy Ratio (FBER) in WM Reference".to_string()
        }
        "T1w_EFC_bits" => "Entropy Focus Criterion (EFC)".to_string(),
        "T1w_Mean_AI_Perc" => "Mean Asymmetry Index (%)".to_string(),
        "T1w_SD_AI_Perc" => "Standard Deviation of Asymmetry Index (%)".to_string(),
        "T1w_LR_flip_YesNo" => "Left-Right Flip (Yes/No)".to_string(),
        "T1w_IQR_Perc" => "Inter-quartile Range of T1w (%)".to_string(),

        // ASL measures
        "TC_ASL2T1w_Perc" => "Temporal Correlation of ASL to T1w (%)".to_string(),
        "ASL_tSNR_GM_Ratio" => "Temporal SNR in Gray Matter".to_string(),
        "ASL_tSNR_WM_Ratio" => "Temporal SNR in White Matter".to_string(),
        "ASL_tSNR_CSF_Ratio" => "Temporal SNR in Cerebrospinal Fluid".to_string(),
        "ASL_tSNR_WMref_Ratio" => "Temporal SNR in White Matter Reference".to_string(),
        "ASL_tSNR_GMWM_Ratio" => "Temporal SNR in Gray and White Matter".to_string(),
        "ASL_tSNR_GMWM_WMref_Ratio" => "Temporal SNR in GM/WM vs WM Reference".to_string(),
        "ASL_tSNR_Physio2Thermal_Ratio" => "Physiological to Thermal Noise Ratio".to_string(),
        "ASL_tSNR_Slope_Corr" => "tSNR Slope Correction".to_string(),
        "ASL_Coverage_Perc" => "ASL Brain Coverage (%)".to_string(),
        "TC_CBF2template" => "Temporal Correlation of CBF to Template".to_string(),
        "TC_M02template" => "Temporal Correlation of M0 to Template".to_string(),
        "LR_flip_YesNo" => "Left-Right Flip (Yes/No)".to_string(),
        "MotionMean_mm" => "Mean Subject Motion (mm)".to_string(),
        "MotionExcl_Perc" => "Percentage of Excluded Volumes due to Motion (%)".to_string(),
        "MotionMax_mm" => "Maximum Subject Motion (mm)".to_string(),
        "MotionSD_mm" => "Standard Deviation of Subject Motion (mm)".to_string(),
        "CBF_GM_Median_mL100gmin" => "Median Gray Matter CBF (mL/100g/min)".to_string(),
        "CBF_GM_PVC2_mL100gmin" => "PVC Gray Matter CBF (mL/100g/min)".to_string(),
        "CBF_WM_PVC2_mL100gmin" => "PVC White Matter CBF (mL/100g/min)".to_string(),
        "CBF_GM_WM_Ratio" => "Ratio of Gray Matter vs White Matter CBF".to_string(),
        "SpatialCoV_GM_Perc" => "Spatial Coefficient of Variation in Gray Matter (%)".to_string(),
        "SoftwareVersions" => "Software Version".to_string(),
        "PulseSequenceType" => "Pulse Sequence Type".to_string(),
        "MRAcquisitionType" => "MR Acquisition Type".to_string(),
        "EchoTime_ms" => "Echo Time (ms)".to_string(),
        "LabelingDuration_ms" => "Labeling Duration (ms)".to_string(),
        "BackgroundSuppressionNumberPulses" => "Background Suppression Pulses Count".to_string(),
        "SliceReadoutTime_ms" => "Slice Readout Time (ms)".to_string(),
        "LabelingType" => "Labeling Type".to_string(),
        "Initial_PLD_ms" => "Initial Post-label Delay (ms)".to_string(),
        "NumberOfAverages" => "Number of Averages".to_string(),
        "Vendor" => "Scanner Vendor".to_string(),
        "M0" => "M0 Calibration Method".to_string(),
        "uniqueEchoTime" => "Unique Echo Time (ms)".to_string(),
        "nUniqueEchoTime" => "Number of Unique Echo Times".to_string(),
        "uniqueInitial_PLD" => "Unique Post-label Delay (ms)".to_string(),
        "nUniqueInitial_PLD" => "Number of Unique PLDs".to_string(),
        "uniqueLabelingDuration" => "Unique Labeling Duration (ms)".to_string(),
        "nUniqueLabelingDuration" => "Number of Unique Labeling Durations".to_string(),
        "Matrix" => "Imaging Matrix Size".to_string(),
        "VoxelSize_mm" => "Voxel Size (mm)".to_string(),
        "RigidBody2Anat_mm" => "Rigid-body Coregistration to Anatomy (mm)".to_string(),
        "nRMSE_Perc" => "Normalized Root Mean Square Error (%)".to_string(),
        "RMSE_Perc" => "Root Mean Square Error (%)".to_string(),
        "Mean_SSIM_Perc" => "Mean Structural Similarity Index (SSIM) (%)".to_string(),
        "PeakSNR_Ratio" => "Peak Signal-to-Noise Ratio (PSNR)".to_string(),
        "AI_Perc" => "Asymmetry Index (%)".to_string(),

        // General / Common keys
        "Version_CAT12" => "CAT12 Version".to_string(),
        "Version_LST" => "LST Version".to_string(),
        "Version_FSL" => "FSL Version".to_string(),
        "Version_ExploreASL" => "ExploreASL Version".to_string(),
        "Version_ExploreASL_Git_commit" => "ExploreASL Git Commit".to_string(),
        "Version_Matlab" => "MATLAB Version".to_string(),
        "Version_SPM12" => "SPM12 Version".to_string(),
        "ID" => "Subject Session ID".to_string(),

        // Fallback translation
        other => {
            let mut label = String::new();
            let mut capitalize = true;
            for c in other.chars() {
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
    }
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
) -> Result<Vec<QcMeasure>, String> {
    if !file_path.exists() {
        return Err(format!(
            "QC collection file not found: {}",
            file_path.display()
        ));
    }

    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path.display(), e))?;

    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON in {}: {}", file_path.display(), e))?;

    let mut measures = Vec::new();

    if module.eq_ignore_ascii_case("structural") {
        if let Some(structural_val) = json.get("Structural") {
            if let Some(obj) = structural_val.as_object() {
                for (k, v) in obj {
                    measures.push(QcMeasure {
                        key: k.clone(),
                        label: translate_key(k),
                        value: format_json_value(v),
                    });
                }
            } else {
                return Err("Field 'Structural' in JSON is not an object".to_string());
            }
        } else {
            return Err("Field 'Structural' not found in JSON".to_string());
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
                                    label: translate_key(k),
                                    value: format_json_value(v),
                                });
                            }
                        } else {
                            return Err(format!("Field 'ASL.{}' in JSON is not an object", key));
                        }
                    } else {
                        return Err(format!("Field 'ASL.{}' not found in JSON", key));
                    }
                } else {
                    return Err(format!(
                        "No matching ASL run found in JSON for run: {:?}",
                        run
                    ));
                }
            } else {
                return Err("Field 'ASL' in JSON is not an object".to_string());
            }
        } else {
            return Err("Field 'ASL' not found in JSON".to_string());
        }
    } else {
        return Err(format!("Unsupported module: {}", module));
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

    let session_dir = PathBuf::from(&project_root)
        .join("derivatives")
        .join("ExploreASL")
        .join(&subject_session);

    if !session_dir.exists() {
        let err = format!(
            "Subject session directory not found: {}",
            session_dir.display()
        );
        trace.error(&err);
        return Err(err);
    }

    let mut file_path = session_dir.join(format!("QC_collection_{}.json", subject_session));

    if !file_path.exists() {
        let mut found = false;
        if let Ok(entries) = fs::read_dir(&session_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("QC_collection_") && name.ends_with(".json") {
                            file_path = entry.path();
                            found = true;
                            break;
                        }
                    }
                }
            }
        }
        if !found {
            let err = format!("No QC collection file found in {}", session_dir.display());
            trace.error(&err);
            return Err(err);
        }
    }

    let result = extract_qc_measures(&file_path, &module, run.as_deref());
    match &result {
        Ok(measures) => trace.success(&format!("Found {} measures", measures.len())),
        Err(err) => trace.error(err),
    }
    result
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubjectQcOutputs {
    pub coverage: f64,
    pub spatial_cov: f64,
    pub motion: Vec<f64>,
    pub motion_exclusion_pct: f64,
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
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("QC_collection_") && name.ends_with(".json") {
                        return Some(entry.path());
                    }
                }
            }
        }
    }

    None
}

pub fn extract_subject_qc_outputs(file_path: &Path) -> Result<SubjectQcOutputs, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path.display(), e))?;

    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON in {}: {}", file_path.display(), e))?;

    let asl_val = json
        .get("ASL")
        .ok_or("Field 'ASL' not found in JSON".to_string())?;
    let asl_obj = asl_val
        .as_object()
        .ok_or("Field 'ASL' in JSON is not an object".to_string())?;

    let mut coverages = Vec::new();
    let mut spatial_covs = Vec::new();
    let mut motions = Vec::new();
    let mut motion_exclusions = Vec::new();

    for (key, val) in asl_obj {
        if key.starts_with("ASL_") {
            if let Some(run_obj) = val.as_object() {
                if let Some(cov_val) = run_obj.get("ASL_Coverage_Perc") {
                    if let Some(cov) = val_to_f64(cov_val) {
                        coverages.push(cov);
                    }
                }
                if let Some(sc_val) = run_obj.get("SpatialCoV_GM_Perc") {
                    if let Some(sc) = val_to_f64(sc_val) {
                        spatial_covs.push(sc);
                    }
                }
                if let Some(mot_val) = run_obj.get("MotionMean_mm") {
                    if let Some(mot) = val_to_f64(mot_val) {
                        motions.push(mot);
                    }
                }
                if let Some(excl_val) = run_obj.get("MotionExcl_Perc") {
                    if let Some(excl) = val_to_f64(excl_val) {
                        motion_exclusions.push(excl);
                    }
                }
            }
        }
    }

    let coverage = if coverages.is_empty() {
        0.0
    } else {
        coverages.iter().sum::<f64>() / coverages.len() as f64
    };

    let spatial_cov = if spatial_covs.is_empty() {
        0.0
    } else {
        spatial_covs.iter().sum::<f64>() / spatial_covs.len() as f64
    };

    let motion_exclusion_pct = if motion_exclusions.is_empty() {
        0.0
    } else {
        motion_exclusions.iter().sum::<f64>() / motion_exclusions.len() as f64
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
                    log::warn!("Failed to extract QC for {}: {}", ss, err);
                }
            }
        }
    }

    trace.success(&format!("Batch fetched QC for {} subjects", results.len()));
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_translate_key() {
        assert_eq!(
            translate_key("T1w_GM_ICV_Ratio"),
            "Ratio of Gray Matter vs Intra-cortical Volume"
        );
        assert_eq!(
            translate_key("ASL_tSNR_GM_Ratio"),
            "Temporal SNR in Gray Matter"
        );
        assert_eq!(
            translate_key("Unrecognized_Key_Name"),
            "Unrecognized Key Name"
        );
    }

    #[test]
    fn test_format_json_value() {
        assert_eq!(format_json_value(&Value::Null), "");
        assert_eq!(format_json_value(&Value::Bool(true)), "true");
        assert_eq!(
            format_json_value(&Value::Number(serde_json::Number::from_f64(1.23).unwrap())),
            "1.23"
        );
        assert_eq!(
            format_json_value(&Value::String("  hello  ".to_string())),
            "hello"
        );

        let same_arr = Value::Array(vec![
            Value::String("9.991".to_string()),
            Value::String(" 9.991 ".to_string()),
        ]);
        assert_eq!(format_json_value(&same_arr), "9.991");

        let diff_arr = Value::Array(vec![
            Value::String("0".to_string()),
            Value::String("133.333".to_string()),
        ]);
        assert_eq!(format_json_value(&diff_arr), "0, 133.333");
    }

    #[test]
    fn test_extract_qc_measures_structural() {
        let mut tmp_file = NamedTempFile::new().unwrap();
        let sample_json = r#"{
            "Structural": {
                "T1w_GM_ICV_Ratio": 0.437,
                "T1w_GM_vol_mL": 640
            },
            "ASL": {}
        }"#;
        tmp_file.write_all(sample_json.as_bytes()).unwrap();

        let measures = extract_qc_measures(tmp_file.path(), "structural", None).unwrap();
        assert_eq!(measures.len(), 2);
        assert_eq!(measures[0].key, "T1w_GM_ICV_Ratio");
        assert_eq!(
            measures[0].label,
            "Ratio of Gray Matter vs Intra-cortical Volume"
        );
        assert_eq!(measures[0].value, "0.437");
    }

    #[test]
    fn test_extract_qc_measures_asl() {
        let mut tmp_file = NamedTempFile::new().unwrap();
        let sample_json = r#"{
            "Structural": {},
            "ASL": {
                "ASL_1": {
                    "EchoTime_ms": ["9.991", "9.991"],
                    "SliceReadoutTime_ms": ["0", "133.333"],
                    "Vendor": "Philips"
                }
            }
        }"#;
        tmp_file.write_all(sample_json.as_bytes()).unwrap();

        let measures = extract_qc_measures(tmp_file.path(), "asl", Some("1")).unwrap();
        assert_eq!(measures.len(), 3);

        let echo_time = measures.iter().find(|m| m.key == "EchoTime_ms").unwrap();
        assert_eq!(echo_time.label, "Echo Time (ms)");
        assert_eq!(echo_time.value, "9.991");

        let readout_time = measures
            .iter()
            .find(|m| m.key == "SliceReadoutTime_ms")
            .unwrap();
        assert_eq!(readout_time.value, "0, 133.333");

        let vendor = measures.iter().find(|m| m.key == "Vendor").unwrap();
        assert_eq!(vendor.value, "Philips");
    }

    #[test]
    fn test_val_to_f64() {
        assert_eq!(
            val_to_f64(&Value::Number(serde_json::Number::from_f64(1.23).unwrap())),
            Some(1.23)
        );
        assert_eq!(val_to_f64(&Value::String("2.34".to_string())), Some(2.34));
        assert_eq!(
            val_to_f64(&Value::Array(vec![Value::Number(
                serde_json::Number::from_f64(3.45).unwrap()
            )])),
            Some(3.45)
        );
        assert_eq!(val_to_f64(&Value::Null), None);
    }

    #[test]
    fn test_extract_subject_qc_outputs_multi_run() {
        let mut tmp_file = NamedTempFile::new().unwrap();
        let sample_json = r#"{
            "ASL": {
                "ASL_1": {
                    "ASL_Coverage_Perc": 90.0,
                    "SpatialCoV_GM_Perc": 70.0,
                    "MotionMean_mm": 0.1,
                    "MotionExcl_Perc": 10
                },
                "ASL_2": {
                    "ASL_Coverage_Perc": 92.0,
                    "SpatialCoV_GM_Perc": 72.0,
                    "MotionMean_mm": 0.2,
                    "MotionExcl_Perc": 20
                }
            }
        }"#;
        tmp_file.write_all(sample_json.as_bytes()).unwrap();

        let outputs = extract_subject_qc_outputs(tmp_file.path()).unwrap();
        assert_eq!(outputs.coverage, 91.0);
        assert_eq!(outputs.spatial_cov, 71.0);
        assert_eq!(outputs.motion, vec![0.1, 0.2]);
        assert_eq!(outputs.motion_exclusion_pct, 15.0);
    }
}
