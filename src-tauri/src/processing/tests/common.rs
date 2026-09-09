use crate::app_state::AppState;
use crate::execution_profile::ExecutionProfile;
use crate::processing::pipeline::run_pipeline_with;
use crate::processing::types::ProcessingRunSnapshot;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn state_with_active_project(root: &Path) -> Arc<AppState> {
    let state = Arc::new(AppState::default());
    *state.active_project_root.lock().unwrap() = Some(root.canonicalize().unwrap());
    state
}

pub(crate) fn invoke_launch_expected_before_profile_validation(
    state: &AppState,
    run_id: &str,
    b_process: &[bool],
    workers: u32,
) -> Result<ProcessingRunSnapshot, String> {
    let profile = ExecutionProfile::Matlab {
        id: "unused".to_string(),
        label: "Unused".to_string(),
        matlab_path: "/unused/matlab".to_string(),
        explore_asl_path: "/unused/ExploreASL".to_string(),
        explore_asl_version: None,
    };
    run_pipeline_with(
        state,
        run_id,
        &profile,
        "must-not-be-written",
        b_process,
        workers,
        "",
        false,
        |_| panic!("request must resolve before profile validation"),
        |_, _, _| panic!("request cannot warm MCR"),
        |_| -> Result<(u32, ()), String> { panic!("request cannot spawn") },
        |_, _, ()| panic!("request cannot supervise"),
        || panic!("request cannot stagger"),
        |()| panic!("request cannot terminate a child"),
    )
}

pub(crate) fn unique_temp_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("exploreasl-gui-proc-{name}-{suffix}"))
}

pub(crate) fn create_lock_tree(root: &Path) {
    let lock = root.join("derivatives").join("ExploreASL").join("lock");

    let struct_sub = lock
        .join("xASL_module_Structural")
        .join("sub-001_01")
        .join("xASL_module_Structural");
    fs::create_dir_all(&struct_sub).unwrap();
    fs::write(struct_sub.join("060_Segment_T1w.status"), "").unwrap();
    fs::write(struct_sub.join("999_ready.status"), "").unwrap();

    let asl_run = lock
        .join("xASL_module_ASL")
        .join("sub-001_01")
        .join("xASL_module_ASL_ASL_1");
    fs::create_dir_all(asl_run.join("locked")).unwrap();
    fs::write(asl_run.join("ASL.status"), "").unwrap();

    let pop = lock
        .join("xASL_module_Population")
        .join("xASL_module_Population");
    fs::create_dir_all(&pop).unwrap();
    fs::write(pop.join("999_ready.status"), "").unwrap();
}
