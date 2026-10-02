use super::*;
use std::io::Write;
use tempfile::NamedTempFile;

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
    assert_eq!(outputs.coverage, Some(91.0));
    assert_eq!(outputs.spatial_cov, Some(71.0));
    assert_eq!(outputs.motion, vec![0.1, 0.2]);
    assert_eq!(outputs.motion_exclusion_pct, Some(15.0));
}

#[test]
fn test_extract_subject_qc_outputs_empty_asl() {
    let mut tmp_file = NamedTempFile::new().unwrap();
    let sample_json = r#"{"ASL": {}}"#;
    tmp_file.write_all(sample_json.as_bytes()).unwrap();

    let outputs = extract_subject_qc_outputs(tmp_file.path()).unwrap();
    assert_eq!(outputs.coverage, None);
    assert_eq!(outputs.spatial_cov, None);
    assert!(outputs.motion.is_empty());
    assert_eq!(outputs.motion_exclusion_pct, None);
}
