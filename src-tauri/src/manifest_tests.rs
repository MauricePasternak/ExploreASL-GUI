use super::*;

#[test]
fn returns_unknown_on_missing_version_files() {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("easl-gui-version-missing-{}", ts));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    let result = capture_environment_versions_impl(
        tmp.to_string_lossy().to_string(),
        "/nonexistent/matlab".to_string(),
    );
    assert_eq!(result.explore_asl, "unknown");
    assert_eq!(result.matlab, "unknown");

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn reads_version_from_version_file() {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("easl-gui-version-file-{}", ts));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    fs::write(tmp.join("VERSION_1.0.0"), "").unwrap();

    let result = capture_environment_versions_impl(
        tmp.to_string_lossy().to_string(),
        "/nonexistent/matlab".to_string(),
    );
    assert_eq!(result.explore_asl, "1.0.0");

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn returns_none_when_population_mtime_file_missing() {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("easl-gui-mtime-missing-{}", ts));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    let result = read_population_ready_mtime(tmp.to_string_lossy().to_string());
    assert_eq!(result, None);

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn returns_mtime_when_population_file_present() {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("easl-gui-mtime-present-{}", ts));
    let _ = fs::remove_dir_all(&tmp);

    let pop_dir = tmp
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Population")
        .join("xASL_module_Population");
    fs::create_dir_all(&pop_dir).unwrap();
    fs::write(pop_dir.join("999_ready.status"), "").unwrap();

    let result = read_population_ready_mtime(tmp.to_string_lossy().to_string());
    assert!(result.is_some());

    let _ = fs::remove_dir_all(&tmp);
}

fn ts_dir(prefix: &str) -> std::path::PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tmp = std::env::temp_dir().join(format!("{}-{}", prefix, ts));
    let _ = fs::remove_dir_all(&tmp);
    tmp
}

#[test]
fn test_read_prior_modules_mtimes() {
    let tmp = ts_dir("easl-gui-prior-mtime");

    // Happy path: Lock ready status files exist for Structural and ASL
    let struct_dir = tmp
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_Structural")
        .join("sub-01_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_dir).unwrap();
    let struct_ready = struct_dir.join("999_ready.status");
    fs::write(&struct_ready, "").unwrap();

    let asl_dir = tmp
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_ASL")
        .join("sub-01_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&asl_dir).unwrap();
    let asl_ready = asl_dir.join("999_ready.status");
    fs::write(&asl_ready, "").unwrap();

    let result =
        read_prior_modules_mtimes_impl(&tmp, &["sub-01_01".to_string(), "sub-02_01".to_string()]);

    assert!(result.get("sub-01_01").unwrap().is_some());
    assert_eq!(result.get("sub-02_01").unwrap(), &None);

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_prior_modules_mtimes_log_fallback() {
    let tmp = ts_dir("easl-gui-prior-mtime-log");

    // Log fallback: Ready files missing, but valid logs are present in project derivatives log folder
    let log_dir = tmp.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();

    fs::write(
        log_dir.join("xASL_module_Structural_sub-01_01.log"),
        "processing complete successfully",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-01_01_ASL_1.log"),
        "processing complete successfully",
    )
    .unwrap();

    let result = read_prior_modules_mtimes_impl(&tmp, &["sub-01_01".to_string()]);

    let mtime_ms = result.get("sub-01_01").unwrap().unwrap();
    assert!(mtime_ms > 0);

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_prior_modules_mtimes_multiple_asl_runs() {
    let tmp = ts_dir("easl-gui-prior-mtime-multirun");

    let lock_base = tmp
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_ASL")
        .join("sub-01_01");

    let asl_dir1 = lock_base.join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&asl_dir1).unwrap();
    let ready1 = asl_dir1.join("999_ready.status");
    fs::write(&ready1, "").unwrap();

    std::thread::sleep(std::time::Duration::from_millis(50));

    let asl_dir2 = lock_base.join("xASL_module_ASL_ASL_2");
    fs::create_dir_all(&asl_dir2).unwrap();
    let ready2 = asl_dir2.join("999_ready.status");
    fs::write(&ready2, "").unwrap();

    let result = read_prior_modules_mtimes_impl(&tmp, &["sub-01_01".to_string()]);

    let mtime_ms = result.get("sub-01_01").unwrap().unwrap();

    let mtime_1 = ready1
        .metadata()
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let mtime_2 = ready2
        .metadata()
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    assert_eq!(mtime_ms, std::cmp::max(mtime_1, mtime_2));

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_prior_modules_mtimes_empty_and_missing() {
    let missing = std::path::PathBuf::from("/nonexistent/path/here");
    let result_missing = read_prior_modules_mtimes_impl(&missing, &["sub-01_01".to_string()]);
    assert_eq!(result_missing.get("sub-01_01").unwrap(), &None);

    let result_empty = read_prior_modules_mtimes_impl(&missing, &[]);
    assert!(result_empty.is_empty());
}

#[test]
fn test_read_prior_modules_mtimes_staging_lock_dir() {
    let tmp = ts_dir("easl-gui-prior-mtime-staging-lock");

    // ASL run lock lives only in .easl_staging, not in derivatives
    let asl_dir = tmp
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("lock")
        .join("xASL_module_ASL")
        .join("sub-01_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(&asl_dir).unwrap();
    fs::write(asl_dir.join("999_ready.status"), "").unwrap();

    let result = read_prior_modules_mtimes_impl(&tmp, &["sub-01_01".to_string()]);

    let mtime_ms = result.get("sub-01_01").unwrap();
    assert!(mtime_ms.is_some(), "staging lock ready must be discovered");
    assert!(mtime_ms.unwrap() > 0);

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_prior_modules_mtimes_staging_log_dir() {
    let tmp = ts_dir("easl-gui-prior-mtime-staging-log");

    // Logs live only in .easl_staging derivatives log folder
    let log_dir = tmp
        .join(".easl_staging")
        .join("derivatives")
        .join("ExploreASL")
        .join("log");
    fs::create_dir_all(&log_dir).unwrap();
    fs::write(
        log_dir.join("xASL_module_Structural_sub-01_01.log"),
        "processing complete successfully",
    )
    .unwrap();
    fs::write(
        log_dir.join("xASL_module_ASL_sub-01_01_ASL_1.log"),
        "processing complete successfully",
    )
    .unwrap();

    let result = read_prior_modules_mtimes_impl(&tmp, &["sub-01_01".to_string()]);

    let mtime_ms = result.get("sub-01_01").unwrap();
    assert!(
        mtime_ms.is_some(),
        "staging log fallback must be discovered"
    );
    assert!(mtime_ms.unwrap() > 0);

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_read_prior_modules_mtimes_multi_subject_no_cross_contamination() {
    let tmp = ts_dir("easl-gui-prior-mtime-multi-subject");

    // Shared log dir with logs for two subjects; only subject A's ASL_1 log
    // should map to A, only subject B's ASL_2 log should map to B.
    let log_dir = tmp.join("derivatives").join("ExploreASL").join("log");
    fs::create_dir_all(&log_dir).unwrap();

    let a_struct = log_dir.join("xASL_module_Structural_sub-A_01.log");
    let a_asl = log_dir.join("xASL_module_ASL_sub-A_01_ASL_1.log");
    let b_struct = log_dir.join("xASL_module_Structural_sub-B_01.log");
    let b_asl = log_dir.join("xASL_module_ASL_sub-B_01_ASL_2.log");
    fs::write(&a_struct, "ok").unwrap();
    fs::write(&a_asl, "ok").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    fs::write(&b_struct, "ok").unwrap();
    fs::write(&b_asl, "ok").unwrap();

    let result =
        read_prior_modules_mtimes_impl(&tmp, &["sub-A_01".to_string(), "sub-B_01".to_string()]);

    let a_mtime = result.get("sub-A_01").unwrap().unwrap();
    let b_mtime = result.get("sub-B_01").unwrap().unwrap();

    let a_expected = b_struct
        .metadata()
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    // B's ASL run 2 log was written last, so B should be strictly newer than A
    assert!(
        b_mtime > a_mtime,
        "B mtime {} must be newer than A mtime {} — cross-contamination suspected",
        b_mtime,
        a_mtime
    );
    // A's mtime should equal the max of its own two logs (the ASL log, written after struct)
    let a_asl_mtime = a_asl
        .metadata()
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert_eq!(a_mtime, a_asl_mtime);
    // Sanity: A's expected ref is less than B's struct mtime (proves no leak)
    assert!(a_mtime < a_expected);

    let _ = fs::remove_dir_all(&tmp);
}
