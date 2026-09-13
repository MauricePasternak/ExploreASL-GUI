use crate::app_state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn state_with_active_project(root: &Path) -> Arc<AppState> {
    let state = Arc::new(AppState::default());
    crate::project_ownership_tests::own_project(&state, &root.canonicalize().unwrap());
    state
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
