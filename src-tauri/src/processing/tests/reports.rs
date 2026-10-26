use super::common::*;
use crate::processing::reports::*;
use std::fs;

#[test]
fn test_list_subject_reports_and_read_report_image() {
    let root = unique_temp_path("test-qc-reports");
    let derivatives = root
        .join("derivatives")
        .join("ExploreASL")
        .join("Population");

    let t1_dir = derivatives.join("T1Check");
    let asl_dir = derivatives.join("ASLCheck");
    let m0_dir = derivatives.join("M0Reg_ASL");

    fs::create_dir_all(&t1_dir).unwrap();
    fs::create_dir_all(&asl_dir).unwrap();
    fs::create_dir_all(&m0_dir).unwrap();

    fs::write(
        t1_dir.join("Tra_Seg_rT1_sub-001Philips_01_rc2T1_sub-001Philips_01.jpg"),
        b"structural_axial_bytes",
    )
    .unwrap();
    fs::write(
        t1_dir.join("Cor_Seg_rT1_sub-001Philips_01_rc2T1_sub-001Philips_01.jpg"),
        b"structural_coronal_bytes",
    )
    .unwrap();

    fs::write(
        asl_dir.join("Tra_Reg_qCBF_sub-001Philips_01_ASL_1_PV_pWM_sub-001Philips_01_Contour.jpg"),
        b"asl_run1_axial_bytes",
    )
    .unwrap();
    fs::write(
        asl_dir.join("Cor_Reg_qCBF_sub-001Philips_01_ASL_1_PV_pWM_sub-001Philips_01_Contour.jpg"),
        b"asl_run1_coronal_bytes",
    )
    .unwrap();

    fs::write(
        m0_dir.join(
            "Tra_Reg_noSmooth_M0_sub-001Philips_01_ASL_1_PV_pGM_sub-001Philips_01_Contour.jpg",
        ),
        b"m0_run1_axial_bytes",
    )
    .unwrap();
    fs::write(
        m0_dir.join(
            "Cor_Reg_noSmooth_M0_sub-001Philips_01_ASL_1_PV_pGM_sub-001Philips_01_Contour.jpg",
        ),
        b"m0_run1_coronal_bytes",
    )
    .unwrap();

    let list = list_subject_reports(root.to_string_lossy().to_string())
        .expect("list_subject_reports should succeed");

    assert_eq!(list.len(), 3);

    let struct_entry = list.iter().find(|x| x.module == "structural").unwrap();
    assert_eq!(struct_entry.subject_session, "sub-001Philips_01");
    assert_eq!(struct_entry.run, None);

    let asl_entry = list.iter().find(|x| x.module == "asl").unwrap();
    assert_eq!(asl_entry.subject_session, "sub-001Philips_01");
    assert_eq!(asl_entry.run, Some("1".to_string()));

    let m0_entry = list.iter().find(|x| x.module == "m0").unwrap();
    assert_eq!(m0_entry.subject_session, "sub-001Philips_01");
    assert_eq!(m0_entry.run, Some("1".to_string()));

    let img_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "axial".to_string(),
    )
    .expect("read structural axial should succeed");
    assert_eq!(img_bytes, b"structural_axial_bytes");

    let img_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "coronal".to_string(),
    )
    .expect("read structural coronal should succeed");
    assert_eq!(img_bytes_cor, b"structural_coronal_bytes");

    let asl_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "asl".to_string(),
        Some("1".to_string()),
        "axial".to_string(),
    )
    .expect("read asl axial should succeed");
    assert_eq!(asl_bytes, b"asl_run1_axial_bytes");

    let asl_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "asl".to_string(),
        Some("1".to_string()),
        "coronal".to_string(),
    )
    .expect("read asl coronal should succeed");
    assert_eq!(asl_bytes_cor, b"asl_run1_coronal_bytes");

    let m0_bytes = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "m0".to_string(),
        Some("1".to_string()),
        "axial".to_string(),
    )
    .expect("read m0 axial should succeed");
    assert_eq!(m0_bytes, b"m0_run1_axial_bytes");

    let m0_bytes_cor = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "m0".to_string(),
        Some("1".to_string()),
        "coronal".to_string(),
    )
    .expect("read m0 coronal should succeed");
    assert_eq!(m0_bytes_cor, b"m0_run1_coronal_bytes");

    let err = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-nonexistent_01".to_string(),
        "structural".to_string(),
        None,
        "axial".to_string(),
    );
    assert!(err.is_err());
    let missing = err.unwrap_err();
    assert_eq!(missing.message, "The report image could not be opened.");
    assert!(
        missing
            .details
            .contains("required file or folder could not be found")
    );
    assert!(!missing.details.contains("sub-nonexistent"));

    let err_view = read_report_image(
        root.to_string_lossy().to_string(),
        "sub-001Philips_01".to_string(),
        "structural".to_string(),
        None,
        "sagittal".to_string(),
    );
    assert!(err_view.is_err());
    let unknown_view = err_view.unwrap_err();
    assert_eq!(
        unknown_view.message,
        "The report image could not be opened."
    );
    assert!(unknown_view.details.is_empty());

    let _ = fs::remove_dir_all(root);
}
