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
5. Delete existing module log files for modules matching `b_process` on subjects matching `subject_regexp` from `<project_root>/derivatives/ExploreASL/log/`
6. Sanity-check that no lock file watcher is already running
7. Spawn N workers via `matlab -batch "addpath('...'); ExploreASL(root, 0, bProcess, 0, i, n)"`

#### Scenario: Status file deletion for selected modules

- **WHEN** `run_pipeline` is called with `b_process = [true, true, false]` and `subject_regexp = "^sub-.*$"`
- **THEN** all `.status` files under `xASL_module_Structural/*/` and `xASL_module_ASL/*/` SHALL be deleted for matching subjects; Population status files SHALL be left untouched

#### Scenario: Stale lock cleanup before launch

- **WHEN** `run_pipeline` is called and `locked/` directories exist from a previous crashed run
- **THEN** all `locked/` directories under `derivatives/ExploreASL/lock/` SHALL be removed before spawning workers

#### Scenario: Watcher already running

- **WHEN** `run_pipeline` is called while a lock file watcher is already active
- **THEN** the command SHALL return an error and SHALL NOT spawn workers

### Requirement: Module Log File Cleanup

During preparation, `run_pipeline` SHALL delete existing ExploreASL module log files from `<project_root>/derivatives/ExploreASL/log/` for each enabled module matching the subject regexp filter. Log files follow the naming pattern `{module_name}_sub-{Subject}_{Session}[_...].log`. The subject*session SHALL be extracted from the filename using the pattern `sub-[^*]+\_\d+`and tested against`subject_regexp`. The Population module SHALL have its log file deleted regardless of subject regexp match (no per-subject granularity). Non-log files (`.json`, `.csv`) in the log directory SHALL NOT be affected. If the log directory does not exist, the cleanup SHALL succeed silently.

#### Scenario: Structural log deleted for matching subject

- **WHEN** `run_pipeline` is called with `b_process = [true, false, false]` and `subject_regexp = "^sub-001_01$"`
- **THEN** `xASL_module_Structural_sub-001_01.log` SHALL be deleted; `xASL_module_Structural_sub-002_01.log` SHALL be preserved

#### Scenario: All ASL run logs deleted for matching subject

- **WHEN** `run_pipeline` is called with `b_process = [false, true, false]` and `subject_regexp = "^sub-001_01$"`
- **THEN** ALL log files starting with `xASL_module_ASL_sub-001_01_` SHALL be deleted regardless of run number; logs for `sub-002_01` SHALL be preserved

#### Scenario: Disabled module logs preserved

- **WHEN** `run_pipeline` is called with `b_process = [true, false, false]` (only Structural enabled)
- **THEN** ASL and Population log files SHALL NOT be deleted

#### Scenario: Population log always deleted when module enabled

- **WHEN** `run_pipeline` is called with `b_process = [false, false, true]`
- **THEN** `xASL_module_Population.log` SHALL be deleted regardless of `subject_regexp` value

#### Scenario: Non-log files preserved

- **WHEN** the log directory contains `bids_report_*.json` and `import_summary_*.csv` files
- **THEN** those files SHALL remain untouched by the log cleanup

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

`processing.rs::list_subjects(project_root: String, data_source: Option<String>)` SHALL delegate to `bids::scan::parse_bids_structure` on:

- `project_root.join("rawdata")` when `data_source` is `"dicom"` or omitted (existing DICOM-import contract)
- `project_root` when `data_source` is `"bids"` (BIDS-direct subjects live at project root)

The function maps `Vec<BidsSubject>` to `Vec<SubjectInfo>` preserving the existing frontend contract:

| Old `SubjectInfo` field | Mapping from `BidsSubject`/`BidsSession`                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `subject_session`       | `format!("sub-{}_{}", subject_label, session_label)`                                                 |
| `subject`               | `subject_label`                                                                                      |
| `session`               | `session_label`                                                                                      |
| `has_structural`        | `has_anat`                                                                                           |
| `has_asl`               | `has_perf`                                                                                           |
| `asl_runs`              | parsed from `asl_files` (run_label resolved, sorted ascending, default `"1"` when run entity absent) |

Cross-sectional handling: missing `ses-*` directories default to session `"1"` per D2.

Registered in `lib.rs` and exported via Tauri commands list (existing behavior preserved).

#### Scenario: DICOM project list_subjects unchanged output shape

- **WHEN** `list_subjects` runs on a DICOM-import project with `rawdata/sub-001/ses-01/perf/sub-001_asl.nii.gz`
- **THEN** returns `SubjectInfo { subject_session: "sub-001_01", subject: "001", session: "01", has_structural: ..., has_asl: true, asl_runs: ["1"] }`

#### Scenario: Cross-sectional session defaults to "1" in SubjectInfo

- **WHEN** `parse_bids_structure` scans ds000240 with `sub-01/perf/sub-01_asl.nii.gz` (no `ses-*`)
- **THEN** returns `SubjectInfo { subject_session: "sub-01_1", subject: "01", session: "1", ... }`

#### Scenario: BIDS-direct list_subjects scans project root

- **WHEN** `list_subjects` runs on a BIDS-direct project with subjects at root and empty `rawdata/`
- **THEN** returns subjects from project root, not empty list

### Requirement: AppState for Processing

`AppState` SHALL gain a `processing_state: Mutex<ProcessingState>` field containing `worker_pids: Vec<u32>` and `watcher_handle: Option<thread::JoinHandle<()>>`. On `RunEvent::ExitRequested`, the exit handler SHALL kill all worker PIDs and stop the watcher.

#### Scenario: App exit during processing

- **WHEN** the user closes the app while workers are running
- **THEN** all worker processes SHALL be terminated (SIGTERM → SIGKILL after 5s) and the file watcher SHALL be stopped

### Requirement: Module Name Mapping

The `b_process` vector SHALL map to ExploreASL lock directory names: index 0 → `xASL_module_Structural`, index 1 → `xASL_module_ASL`, index 2 → `xASL_module_Population`. This mapping SHALL be used by `run_pipeline` for status file deletion, log file cleanup, and by `read_lock_status` for directory traversal.

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

### Requirement: ExploreASL Version Detection

The system SHALL detect the ExploreASL version by scanning the ExploreASL installation directory for files named `VERSION_*`. The version string SHALL be the portion after the `VERSION_` prefix (e.g., `VERSION_1.11.0` → `"1.11.0"`, `VERSION_2.0.0_BETA` → `"2.0.0_BETA"`). If multiple `VERSION_*` files exist, the first found SHALL be used. If no such file exists, the version SHALL be `None`. If the directory does not exist, the version SHALL be `None`.

A Tauri command `detect_exploreasl_version(explore_asl_path: String) -> Option<String>` SHALL expose this detection to the frontend. The version SHALL be detected and displayed in three scenarios:

1. **On app startup**: after settings are loaded, if `exploreAslPath` is non-empty
2. **When global settings are saved**: after validating the ExploreASL path, the version SHALL be re-detected and stored
3. **During preparation phase of `run_pipeline`**: after validating the ExploreASL path and before any destructive operations, the version SHALL be logged to the Rust log

The frontend SHALL display the detected version as colored text below the ExploreASL path input in the Settings modal. A detected version SHALL appear in teal text ("ExploreASL v{version} detected"). A missing version on a valid path SHALL appear in orange text ("ExploreASL version not detected"). No version text SHALL be shown when the path is empty.

#### Scenario: Version file found

- **WHEN** `VERSION_1.11.0` exists in the ExploreASL directory
- **THEN** `detect_exploreasl_version` SHALL return `Some("1.11.0")`

#### Scenario: Beta version detected

- **WHEN** `VERSION_2.0.0_BETA` exists in the ExploreASL directory
- **THEN** `detect_exploreasl_version` SHALL return `Some("2.0.0_BETA")`

#### Scenario: No version file

- **WHEN** the ExploreASL directory exists but contains no `VERSION_*` file
- **THEN** `detect_exploreasl_version` SHALL return `None` and the settings modal SHALL display orange "ExploreASL version not detected"

#### Scenario: Directory missing

- **WHEN** the ExploreASL directory does not exist
- **THEN** `detect_exploreasl_version` SHALL return `None` without error

#### Scenario: Version logged during preparation

- **WHEN** `run_pipeline` is called with a valid ExploreASL path
- **THEN** the detected version (or `"unknown"`) SHALL be logged via `log::info!` before any destructive operations

### Requirement: startProcessing calls ensure_rawdata_dir for BIDS projects

`startProcessing` SHALL invoke `ensure_rawdata_dir(project_root)` before `run_pipeline` when `project.projectMeta.dataSource === "bids"`. For `dataSource === "dicom"`, `ensure_rawdata_dir` is NOT called. If `ensure_rawdata_dir` returns a warning payload (non-empty `rawdata/`), processing MUST wait for user confirmation before proceeding.

#### Scenario: BIDS project flow calls ensure_rawdata_dir

- **WHEN** user clicks Start Processing on a BIDS-direct project (`dataSource = "bids"`)
- **THEN** `ensure_rawdata_dir(project_root)` is invoked; on success the pipeline proceeds; on warning, user is prompted to confirm before proceeding

#### Scenario: DICOM project flow skips ensure_rawdata_dir

- **WHEN** user clicks Start Processing on a DICOM project (`dataSource = "dicom"`)
- **THEN** `ensure_rawdata_dir` is NOT invoked; existing behavior preserved

### Requirement: assembleDataPar injects subjectFolder for BIDS projects

`assembleDataPar` (or Rust `processing.rs::write_data_par_json`) SHALL include `x.opts.subjectFolder = project_root` in the resulting `dataPar.json` when `dataSource === "bids"`. For `dataSource === "dicom"`, `subjectFolder` MUST NOT be injected; `dataPar.json` matches existing behavior.

Resulting `dataPar.json` for BIDS-direct:

```json
{
  "x": {
    "opts": {
      "subjectFolder": "/path/to/project_root"
    }
  },
  "Q": { ... },
  "M0": { ... }
}
```

#### Scenario: BIDS-direct dataPar.json

- **WHEN** `assembleDataPar` runs for a BIDS-direct project with `rootPath = "/home/user/ds000240"`
- **THEN** resulting `dataPar.json` contains `"x": { "opts": { "subjectFolder": "/home/user/ds000240" } }` alongside `Q`, `M0` blocks

#### Scenario: DICOM project dataPar.json unchanged

- **WHEN** `assembleDataPar` runs for a DICOM project
- **THEN** resulting `dataPar.json` matches existing behavior; no `subjectFolder` key present

### Requirement: Processing pre-flight handling for participants.tsv

`ensureParticipantsFiles` operates on `<projectRoot>/derivatives/ExploreASL/participants.tsv`. Root-level user-authored `participants.tsv` is never modified by GUI code regardless of `dataSource`.

For BIDS-direct projects (`dataSource === "bids"`), if root-level `<projectRoot>/participants.tsv` exists and contains a `site` column, the GUI reads it to extract user-defined `site` values. Lookup matches root-level `participant_id` (e.g. `sub-01`) against the base subject label of session records (e.g. `sub-01_1`, `sub-01_2`). User `site` values are preserved in derivatives `participants.tsv` and are NOT overwritten by group labels. When `enableMetadataGroupingCorrection === true`, group labels fill in only for subjects/sessions lacking a root-level `site`. When `false`, the `site` column is still kept in derivatives to preserve root-level values.

For DICOM-import projects, existing behavior is preserved (group labels when correction enabled, stripped when disabled, no root read).

#### Scenario: BIDS-direct project with enableMetadataGroupingCorrection=true

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = true` and root-level `participants.tsv` defines `site = "CenterA"` for `participant_id = sub-01`
- **THEN** derivatives `participants.tsv` has `site = "CenterA"` for `sub-01_1` and `sub-01_2`; subjects without root `site` receive group label fallback

#### Scenario: BIDS-direct project with enableMetadataGroupingCorrection=false

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = false` and root-level `participants.tsv` defines `site = "CenterA"` for `sub-01`
- **THEN** derivatives `participants.tsv` keeps the `site` column with `"CenterA"` for matching sessions (not stripped)

#### Scenario: Root-level participants.tsv preserved through processing

- **WHEN** ds000240 (with root-level `participants.tsv` containing 16 clinical columns) is processed end-to-end as a BIDS-direct project
- **THEN** root-level `participants.tsv` retains its original 16 columns throughout; ExploreASL-generated columns live in `derivatives/ExploreASL/participants.tsv` only
