use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

#[derive(Debug)]
pub struct ProcessState {
    pub worker_pids: Vec<u32>,
    pub watcher_handle: Option<thread::JoinHandle<()>>,
    pub watcher_stop: Option<mpsc::Sender<()>>,
    pub project_root: PathBuf,
}

impl Default for ProcessState {
    fn default() -> Self {
        Self {
            worker_pids: Vec::new(),
            watcher_handle: None,
            watcher_stop: None,
            project_root: PathBuf::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInfo {
    pub subject_session: String,
    pub subject: String,
    pub session: String,
    pub has_structural: bool,
    #[serde(rename = "hasASL")]
    pub has_asl: bool,
    pub asl_runs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectModuleStatus {
    pub subject_session: String,
    #[serde(rename = "module")]
    pub module_name: String,
    pub run: Option<String>,
    pub status: String,
    pub completed_steps: Vec<String>,
    pub locked: bool,
    pub bids2legacy_exists: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub filename: String,
    pub module: String,
    pub subject_session: String,
    pub run: Option<String>,
    pub has_error: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerExited {
    pub pid: u32,
    pub exit_code: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusFileCreated {
    pub module: String,
    pub subject_session: Option<String>,
    pub step_code: String,
    pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockCreated {
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockRemoved {
    pub module: String,
    pub subject_session: Option<String>,
    pub run: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReportFileInfo {
    pub module: String, // "structural" | "asl" | "m0"
    pub subject_session: String,
    pub run: Option<String>,
}
