# processing-backend Specification

## Purpose
TBD - created by archiving change processing-module. Update Purpose after archive.
## Requirements
### Requirement: run_pipeline Command
The `run_pipeline` Tauri command SHALL accept: `project_root: String`, `matlab_path: String`, `explore_asl_path: String`, `data_par_json: String`, `b_process: Vec<bool>`, `workers: u32`, `subject_regexp: String`. It SHALL return `Vec<u32>` (worker PIDs).

Before spawning workers, the command SHALL:
1. Write `data_par_json` to `<project_root>/derivatives/ExploreASL/dataPar.json`
2. Create `<project_root>/derivatives/ExploreASL/lock/` if it doesn't exist
3. Clear all stale `locked/` directories under the lock path
4. Delete `.status` files for modules matching `b_process` on subjects matching `subject_regexp`
5. Sanity-check that no lock file watcher is already running
6. Spawn N workers via `matlab -batch "addpath('...'); ExploreASL(root, 0, bProcess, 0, i, n)"`

#### Scenario: Status file deletion for selected modules
- **WHEN** `run_pipeline` is called with `b_process = [true, true, false]` and `subject_regexp = "^sub-.*$"`
- **THEN** all `.status` files under `xASL_module_Structural/*/` and `xASL_module_ASL/*/` SHALL be deleted for matching subjects; Population status files SHALL be left untouched

#### Scenario: Stale lock cleanup before launch
- **WHEN** `run_pipeline` is called and `locked/` directories exist from a previous crashed run
- **THEN** all `locked/` directories under `derivatives/ExploreASL/lock/` SHALL be removed before spawning workers

#### Scenario: Watcher already running
- **WHEN** `run_pipeline` is called while a lock file watcher is already active
- **THEN** the command SHALL return an error and SHALL NOT spawn workers

### Requirement: kill_pipeline Command
The `kill_pipeline` Tauri command SHALL accept no arguments. It SHALL read all worker PIDs from `AppState.processing_state` and send SIGTERM to each. If a process does not exit within 5 seconds, it SHALL send SIGKILL. It SHALL wait for all processes to exit before returning.

#### Scenario: Graceful kill with timeout
- **WHEN** `kill_pipeline` is called with 3 running workers
- **THEN** SIGTERM SHALL be sent to all 3 PIDs; after 5 seconds any remaining SHALL receive SIGKILL

### Requirement: watch_lock_dir Command
The `watch_lock_dir` Tauri command SHALL accept `project_root: String`. It SHALL start a `notify` crate watcher on `<project_root>/derivatives/ExploreASL/lock/` and emit two event types to the frontend:
- `StatusFileCreated { module: String, subject_session: String, step_code: String }` — when a `.status` file is created
- `LockCreated { module: String, subject_session: String }` — when a `locked/` directory is created

#### Scenario: Status file created for step completion
- **WHEN** ExploreASL creates `060_Segment_T1w.status` under `xASL_module_Structural/sub-X_01/xASL_module_Structural/`
- **THEN** a `StatusFileCreated` event SHALL be emitted with `{ module: "structural", subject_session: "sub-X_01", step_code: "060_Segment_T1w" }`

#### Scenario: ASL module with run number
- **WHEN** a `.status` file is created under `xASL_module_ASL/sub-X_01/xASL_module_ASL_ASL_1/`
- **THEN** the event SHALL include `run: "1"` in the parsed subject session info

### Requirement: read_lock_status Command
The `read_lock_status` Tauri command SHALL accept `project_root: String` and return `Vec<SubjectModuleStatus>`. It SHALL scan all lock directories under `<project_root>/derivatives/ExploreASL/lock/` and determine per-subject per-module status. If the lock directory does not exist, it SHALL return an empty array.

#### Scenario: Empty lock directory
- **WHEN** `derivatives/ExploreASL/lock/` does not exist
- **THEN** `read_lock_status` SHALL return an empty array

#### Scenario: Complete subject
- **WHEN** `999_ready.status` exists under `xASL_module_Structural/sub-X_01/xASL_module_Structural/`
- **THEN** the matching `SubjectModuleStatus` SHALL have `status: "complete"`

#### Scenario: Incomplete subject
- **WHEN** some `.status` files exist but no `999_ready.status` under a module/subject
- **THEN** `status` SHALL be `"incomplete"` and `completedSteps` SHALL list all existing step codes

### Requirement: list_subjects Command
The `list_subjects` Tauri command SHALL accept `project_root: String` and return a `SubjectList` containing subjects discovered from `<project_root>/rawdata/`. It SHALL parse `sub-X/ses-Y/` directories into SubjectSession strings (`sub-X_Y`). Each entry SHALL include module availability flags based on `anat/` and `perf/` subdirectory presence.

#### Scenario: ASL availability detection
- **WHEN** `rawdata/sub-X/ses-01/perf/` exists
- **THEN** the subject entry SHALL have `hasASL: true`

#### Scenario: No session directory
- **WHEN** `rawdata/` contains `sub-X/` with `ses-Y/` subdirectories
- **THEN** each `ses-Y/` SHALL produce a separate SubjectSession entry

### Requirement: AppState for Processing
`AppState` SHALL gain a `processing_state: Mutex<ProcessingState>` field containing `worker_pids: Vec<u32>` and `watcher_handle: Option<thread::JoinHandle<()>>`. On `RunEvent::ExitRequested`, the exit handler SHALL kill all worker PIDs and stop the watcher.

#### Scenario: App exit during processing
- **WHEN** the user closes the app while workers are running
- **THEN** all worker processes SHALL be terminated (SIGTERM → SIGKILL after 5s) and the file watcher SHALL be stopped

### Requirement: Module Name Mapping
The `b_process` vector SHALL map to ExploreASL lock directory names: index 0 → `xASL_module_Structural`, index 1 → `xASL_module_ASL`, index 2 → `xASL_module_Population`. This mapping SHALL be used by `run_pipeline` for status file deletion and by `read_lock_status` for directory traversal.

#### Scenario: Delete status files for structural module only
- **WHEN** `b_process = [true, false, false]` is passed to `run_pipeline`
- **THEN** only `.status` files under `xASL_module_Structural/*/xASL_module_Structural/` SHALL be deleted

### Requirement: Worker Invocation Pattern
Each worker SHALL be invoked as: `matlab -batch "addpath('<exploreasl_path>'); ExploreASL('<project_root>', 0, [<b_process>], 0, <iWorker>, <nWorkers>)"`. Workers SHALL be spawned with PIDs tracked in `AppState.processing_state`.

#### Scenario: Three workers for Structural+ASL
- **WHEN** `workers = 3` and `b_process = [true, true, false]`
- **THEN** 3 MATLAB processes SHALL be spawned with `iWorker` values 1, 2, 3 respectively

### Requirement: Module Ordering Handled by ExploreASL
The GUI SHALL NOT orchestrate module execution order. It passes the `bProcess` vector directly to ExploreASL, which handles the internal ordering (Structural before ASL per subject session, etc.). The GUI treats modules as a selection, not a sequence.

#### Scenario: User selects Structural and ASL
- **WHEN** the user checks Structural and ASL checkboxes
- **THEN** the GUI SHALL pass `b_process = [true, true, false]` to `run_pipeline` without any ordering logic

### Requirement: BIDS2Legacy Transparency
BIDS2Legacy runs as part of each ExploreASL invocation before the selected processing modules. The GUI SHALL NOT display BIDS2Legacy progress separately. Its lock files (`xASL_module_BIDS2Legacy/`) are not tracked by the processing dashboard.

#### Scenario: BIDS2Legacy runs before Structural
- **WHEN** ExploreASL runs Structural module on a subject
- **THEN** BIDS2Legacy executes first as part of the same MATLAB invocation; the dashboard SHALL only show lock file events for the selected module(s)

### Requirement: Worker Stdout Discard
Worker supervisor threads SHALL NOT stream stdout to the frontend. They SHALL only monitor process exit and report `WorkerExited` events. All stdout from MATLAB workers is discarded.

#### Scenario: MATLAB prints warnings during processing
- **WHEN** a MATLAB worker prints warnings or errors to stdout
- **THEN** the output SHALL be discarded; progress SHALL only be tracked via lock file events

