use crate::import::{ImportState, relocation::RelocationPlan};
use crate::processing::ProcessState;
use crate::visualization::ActiveData;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicU64;

pub struct AppState {
    pub import_state: Mutex<ImportState>,
    pub import_generation: AtomicU64,
    pub processing_state: Mutex<ProcessState>,
    /// Serializes active-project replacement with processing launch/shutdown.
    /// A launch holds this through its run-scoped filesystem mutations and spawn
    /// registration, so a direct IPC caller cannot mutate an old root after a
    /// project transition has started.
    pub project_transition: Mutex<()>,
    pub active_project_root: Mutex<Option<PathBuf>>,
    pub active_data: Mutex<Option<ActiveData>>,
    pub relocation_plans: Mutex<BTreeMap<String, RelocationPlan>>,
    pub relocation_plan_sequence: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            import_state: Mutex::new(ImportState::default()),
            import_generation: AtomicU64::new(0),
            processing_state: Mutex::new(ProcessState::default()),
            project_transition: Mutex::new(()),
            active_project_root: Mutex::new(None),
            active_data: Mutex::new(None),
            relocation_plans: Mutex::new(BTreeMap::new()),
            relocation_plan_sequence: AtomicU64::new(0),
        }
    }
}
