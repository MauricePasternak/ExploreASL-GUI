//! Native project admission inside the single application process.

use crate::{app_state::AppState, fs_safety::ProjectDirectory, import::ImportLifecycle};
use std::{
    fmt, io,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) struct ActiveProject {
    root: PathBuf,
    directory: ProjectDirectory,
}

impl fmt::Debug for ActiveProject {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ActiveProject")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl ActiveProject {
    pub(crate) fn open(root: impl AsRef<Path>) -> io::Result<Self> {
        let root = root.as_ref().canonicalize()?;
        let directory = ProjectDirectory::open(&root)?;
        Ok(Self { root, directory })
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn verify_root_identity(&self) -> io::Result<()> {
        if !self.directory.matches_root(&self.root)? {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Project directory identity changed while active",
            ));
        }
        Ok(())
    }
}

pub(crate) fn active(state: &AppState) -> Result<Arc<ActiveProject>, String> {
    let root = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned")?
        .clone()
        .ok_or("No active project root")?;
    let project = state
        .active_project
        .lock()
        .map_err(|_| "Active project capability lock was poisoned")?
        .clone()
        .ok_or("Active project has no native capability")?;
    if root != project.root()
        || root.canonicalize().map_err(|error| error.to_string())? != project.root()
    {
        return Err("Active project root does not match native capability".into());
    }
    project
        .verify_root_identity()
        .map_err(|error| error.to_string())?;
    Ok(project)
}

/// Candidate creation/load can precede activation. Active-root operations reuse
/// the retained capability; other roots receive a temporary confined capability.
pub(crate) fn for_root(state: &AppState, root: &Path) -> Result<Arc<ActiveProject>, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let active_root = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned")?
        .clone();
    if active_root.as_deref() == Some(&root) {
        return active(state);
    }
    Ok(Arc::new(
        ActiveProject::open(root).map_err(|error| error.to_string())?,
    ))
}

pub(crate) fn ensure_import_released(state: &AppState) -> Result<(), String> {
    ensure_not_shutting_down(state)?;
    let run = state
        .import_state
        .lock()
        .map_err(|_| "Import state lock was poisoned")?;
    if (!run.run_id.is_empty() && !run.acknowledged)
        || !matches!(run.lifecycle, ImportLifecycle::Idle) && !run.lifecycle.is_terminal()
        || run.cancellation.is_some()
        || run.launch_in_progress
        || run.supervisor_handle.is_some()
    {
        return Err(
            "Import runtime still owns execution artifacts; settle and acknowledge it first".into(),
        );
    }
    Ok(())
}

pub(crate) fn ensure_processing_released(state: &AppState) -> Result<(), String> {
    ensure_not_shutting_down(state)?;
    let processing = state
        .processing_state
        .lock()
        .map_err(|_| "Processing state lock was poisoned")?;
    if processing.cancellation.is_some()
        || processing.launch_in_progress
        || processing
            .supervisor_handle
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
        || processing.current_run.as_ref().is_some_and(|run| {
            !run.lifecycle.is_terminal() || run.unacknowledged() || run.watcher_owned
        })
        || processing.watcher_run_id.is_some()
        || processing.watcher_stop.is_some()
        || processing.watcher_handle.is_some()
    {
        return Err("Processing runtime still owns execution artifacts; settle it first".into());
    }
    Ok(())
}

pub(crate) fn for_setup(state: &AppState, root: &Path) -> Result<Arc<ActiveProject>, String> {
    ensure_not_shutting_down(state)?;
    let project = for_root(state, root)?;
    let active_root = state
        .active_project_root
        .lock()
        .map_err(|_| "Active project state lock was poisoned")?
        .clone();
    if active_root.as_deref() == Some(project.root()) {
        ensure_import_released(state)?;
        ensure_processing_released(state)?;
    }
    Ok(project)
}

pub(crate) fn ensure_not_shutting_down(state: &AppState) -> Result<(), String> {
    if state
        .runtime_shutdown_in_progress
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("Project runtime shutdown still owns admission".into());
    }
    Ok(())
}
