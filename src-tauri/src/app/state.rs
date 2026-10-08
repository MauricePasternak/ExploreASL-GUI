//! Native state shared by project lifecycle and feature commands.
use crate::import::{ImportState, relocation::RelocationPlan};
use crate::processing::ProcessState;
use crate::project::setup::SetupPlans;
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
    pub runtime_shutdown_in_progress: std::sync::atomic::AtomicBool,
    pub(crate) active_project:
        Mutex<Option<std::sync::Arc<crate::project::ownership::ActiveProject>>>,
    pub active_project_root: Mutex<Option<PathBuf>>,
    pub active_data: Mutex<Option<ActiveData>>,
    pub relocation_plans: Mutex<BTreeMap<String, RelocationPlan>>,
    pub relocation_plan_sequence: AtomicU64,
    pub setup_plans: SetupPlans,
    pub(crate) project_config: Mutex<crate::project::config::ProjectConfigState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            import_state: Mutex::new(ImportState::default()),
            import_generation: AtomicU64::new(0),
            processing_state: Mutex::new(ProcessState::default()),
            project_transition: Mutex::new(()),
            runtime_shutdown_in_progress: std::sync::atomic::AtomicBool::new(false),
            active_project: Mutex::new(None),
            active_project_root: Mutex::new(None),
            active_data: Mutex::new(None),
            relocation_plans: Mutex::new(BTreeMap::new()),
            relocation_plan_sequence: AtomicU64::new(0),
            setup_plans: SetupPlans::default(),
            project_config: Mutex::new(crate::project::config::ProjectConfigState::default()),
        }
    }
}
