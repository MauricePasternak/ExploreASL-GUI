## Requirements

### Requirement: Import execution pipeline

The system SHALL provide a single Rust command `run_import_pipeline(staging_root, staging_entries, sourcestructure_json, studypar_json, matlab_path, exploreasl_path, subject_list)` that atomically performs: (1) delete `.easl_staging/` if it exists, (2) create the standardized 4-level symlink tree at `.easl_staging/sourcedata/` from `staging_entries`, (3) write clean ExploreASL `sourcestructure.json` and `studyPar.json` configs to `.easl_staging/`, (4) spawn MATLAB as `matlab -batch "addpath('exploreasl_path'); ExploreASL('staging_root', [1,1,0], 0, 0)"`, (5) return the process PID on success or an error string on failure. The `staging_entries` parameter contains the GUI staging mappings with subject, session, run, modality, and source path. The `subject_list` parameter provides known subject names for stdout pattern matching. The command SHALL emit a `ImportPrepareComplete` event after steps 1-3 succeed and before MATLAB is spawned.

Prior to spawning MATLAB, lock files for selected subjects SHALL be deleted and lock files for unselected fresh subjects SHALL be preserved via `copyLockFilesForRetry`.

#### Scenario: Successful pipeline start

- **WHEN** `run_import_pipeline` is called with valid paths and configured MATLAB
- **THEN** the staging directory is created, configs are written, MATLAB is spawned, and the PID is returned

#### Scenario: Symlink creation failure

- **WHEN** `run_import_pipeline` is called and symlink creation fails (e.g., permission denied)
- **THEN** the command returns an error string, no MATLAB process is spawned, and the frontend stays in `idle` state

#### Scenario: MATLAB not found

- **WHEN** `run_import_pipeline` is called and the MATLAB executable cannot be found at the specified path
- **THEN** the command returns an error string describing the missing executable

### Requirement: Real-time stdout streaming

The system SHALL stream MATLAB subprocess stdout and stderr to the frontend via Tauri events. Two event types SHALL be emitted: `ImportStructuredEvent` with typed payloads (`subject_start`, `subject_complete`, `import_failed`, `import_complete`, `dcm2nii_status`) and `ImportRawEvent` with the raw line string. Every line from MATLAB stdout and stderr SHALL be emitted as `ImportRawEvent`. Structured events SHALL be parsed from stdout using the following regex patterns:

- `subject_start`: `Subject: (\w+), Module: xASL_module_Import`
- `subject_complete`: `Job-iteration \d+ stopped at .+ and took \d+ seconds`
- `import_failed`: `NII2BIDS failed for (.+)|DCM2NII failed for (.+)`
- `import_complete`: `xASL_module_Import completed 100%`
- `dcm2nii_status`: `status: (\d+)`

#### Scenario: Subject starts processing

- **WHEN** MATLAB outputs `Subject: BADDIE, Module: xASL_module_Import`
- **THEN** a `subject_start` event is emitted with `subject: "BADDIE"`

#### Scenario: NII2BIDS failure detected

- **WHEN** MATLAB outputs `NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1` followed by `Message: The length of the vector LabelingDuration...`
- **THEN** a `import_failed` event is emitted with the subject matched against the known subject list and the full message captured

#### Scenario: Import completes

- **WHEN** MATLAB outputs `xASL_module_Import completed 100%`
- **THEN** an `import_complete` event is emitted

### Requirement: Process lifecycle management

The system SHALL store the MATLAB child process PID in Rust app state. On Tauri app close, the system SHALL send SIGTERM (Unix) or CTRL_BREAK_EVENT (Windows), wait up to 5 seconds, then send SIGKILL (Unix) or TerminateProcess (Windows) if the process is still alive. The app SHALL block exit during this cleanup via `RunEvent::ExitRequested`. The system SHALL also provide a `stop_import(pid)` command that performs the same termination sequence on demand.

#### Scenario: User stops import mid-run

- **WHEN** the user clicks "Stop" during a running import
- **THEN** SIGTERM is sent to the MATLAB process, 5s grace period, SIGKILL if still alive, all in-progress subjects are marked "cancelled"

#### Scenario: App closes during import

- **WHEN** the user closes the Tauri window while MATLAB is running
- **THEN** the app blocks exit, sends SIGTERM, waits up to 5s, sends SIGKILL if needed, then allows exit. No orphan process remains.

### Requirement: Lock file cleanup for failed subjects

The system SHALL provide a Rust command `clean_import_status(staging_root, subjects: Vec<String>)` that deletes the three lock files (`010_DCM2NII.status`, `020_NII2BIDS.status`, `999_ready.status`) for each specified subject from `<staging_root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/`. This command SHALL be called automatically after the MATLAB subprocess exits, using the list of subjects that emitted `import_failed` events. It SHALL NOT delete lock files for subjects that succeeded.

#### Scenario: One subject fails, one succeeds

- **WHEN** GOOD succeeds and BADDIE fails during import
- **THEN** after MATLAB exits, lock files for BADDIE are deleted, lock files for GOOD are preserved

#### Scenario: All subjects succeed

- **WHEN** all subjects complete without `import_failed` events
- **THEN** no lock files are deleted

### Requirement: Output relocation after import

The Rust command `move_import_output(staging_root, project_root, succeeded_subjects: Option<Vec<String>>, debug_mode: bool)` handles two modes:

**Full success** (`succeeded_subjects` is `None`): Delete existing `<project_root>/rawdata/` and `<project_root>/derivatives/`, then `mv` `.easl_staging/rawdata/` and `.easl_staging/derivatives/` to project root. If debug mode is off: delete `.easl_staging/`. If debug mode is on: preserve `.easl_staging/` and copy `sourcestructure.json` and `studyPar.json` to `<project_root>/derivatives/ExploreASL_GUI/`.

**Partial success** (`succeeded_subjects` is `Some(list)`): For each succeeded subject, selectively copy: (1) `.easl_staging/rawdata/sub-<Subject>/` → `<project_root>/rawdata/sub-<Subject>/`, (2) `.easl_staging/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/` → `<project_root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/`, (3) `.easl_staging/derivatives/ExploreASL/log/*sub-<Subject>*` → `<project_root>/derivatives/ExploreASL/log/`, (4) `.easl_staging/rawdata/dataset_description.json` → `<project_root>/rawdata/dataset_description.json` (only if not exists at destination). Failed subjects' data remains in `.easl_staging/` for potential retry.

**All-fail scenario**: `move_import_output` is not called at all. `.easl_staging/` remains intact for retry. No data is moved to project root.

#### Scenario: Full success with debug mode off

- **WHEN** all subjects succeed and debug mode is disabled
- **THEN** `rawdata/` and `derivatives/` are replaced at project root, `.easl_staging/` is deleted, `project.easl` `currentPhase` is set to `"parameters"`

#### Scenario: Full success with debug mode on

- **WHEN** all subjects succeed and debug mode is enabled
- **THEN** `rawdata/` and `derivatives/` are replaced at project root, `.easl_staging/` is preserved, configs are copied to `derivatives/ExploreASL_GUI/`

#### Scenario: Partial success (GOOD succeeded, BADDIE failed)

- **WHEN** some subjects succeed and some fail
- **THEN** succeeded subjects' `rawdata/sub-<Subject>/`, lock files, and log files are copied to project root. Failed subjects' data stays in staging. `.easl_staging/` is preserved for retry.

#### Scenario: All subjects fail

- **WHEN** no subjects succeed
- **THEN** nothing is moved to project root, `.easl_staging/` remains intact for retry

### Requirement: Retry with lock file preservation

On retry, the system SHALL: (1) delete `.easl_staging/` entirely, (2) rebuild symlink tree and rewrite configs from current GUI state, (3) copy succeeded subjects' lock files from `<project_root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/` to `.easl_staging/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/`, (4) spawn MATLAB. Subjects with preserved lock files SHALL be skipped by ExploreASL.

#### Scenario: Retry after partial failure

- **WHEN** user clicks "Retry Import" after BADDIE failed and GOOD succeeded
- **THEN** staging is rebuilt from scratch, GOOD's lock files are copied back, BADDIE's lock files are NOT copied, MATLAB runs and processes only BADDIE

#### Scenario: Retry after fixing studyPar.json

- **WHEN** user edits metadata in step 4 (fixing LabelingDuration) and clicks "Retry Import"
- **THEN** staging is rebuilt with updated configs, succeeded subjects' lock files are preserved, failed subjects are re-processed with new parameters

### Requirement: MATLAB exit code handling

If the MATLAB process exits with a non-zero exit code, all subjects currently in `"running"` status SHALL be marked as failed. This catches crashes where no per-subject failure pattern was parsed from stdout.

#### Scenario: MATLAB crashes mid-import

- **WHEN** MATLAB exits with code 1 during import (e.g., out of memory)
- **THEN** any subject with `importProgress` status `"running"` is marked as `"failed"` with error "MATLAB process exited unexpectedly"

#### Scenario: MATLAB exits normally with zero code

- **WHEN** MATLAB exits with code 0 after processing all subjects
- **THEN** normal completion flow proceeds; failure detection relies on per-subject stdout parsing

### Requirement: Subprocess kill on app exit

The Rust backend SHALL register a cleanup handler that prevents orphan MATLAB processes. When the Tauri app receives an exit request, the handler SHALL terminate the running MATLAB process using the platform-appropriate signal sequence before allowing exit.

#### Scenario: MATLAB process running on app exit

- **WHEN** the Tauri window is closed while MATLAB is running
- **THEN** the MATLAB process receives SIGTERM (or CTRL_BREAK_EVENT on Windows), followed by SIGKILL after 5s if still alive, then the app exits

#### Scenario: No MATLAB process running on app exit

- **WHEN** the Tauri window is closed and no MATLAB process is running
- **THEN** the app exits immediately without delay

### Requirement: Debug mode (Preserve staging directory)

A global setting "Preserve staging directory" SHALL be added to `globalStore.settings` under the Import module section, defaulting to `false`. When enabled, `.easl_staging/` is preserved after successful import and `sourcestructure.json` + `studyPar.json` are copied to `<project_root>/derivatives/ExploreASL_GUI/`. When disabled (default), `.easl_staging/` is deleted after successful import.

#### Scenario: Debug mode enabled on successful import

- **WHEN** all subjects succeed and "Preserve staging directory" is enabled
- **THEN** `.easl_staging/` is preserved, configs are copied to `derivatives/ExploreASL_GUI/`

#### Scenario: Debug mode disabled on successful import

- **WHEN** all subjects succeed and "Preserve staging directory" is disabled
- **THEN** `.easl_staging/` is deleted entirely

### Requirement: MATLAB executable selection for import

The import step 5 execution view SHALL provide a MATLAB version select dropdown (matching the Processing module's `PipelineConfig` pattern). The dropdown SHALL list all configured MATLAB installations from `globalStore.settings.matlabInstallations`, displaying each installation's label, version (if available), and path. The selection SHALL default to the first installation. The selected `matlabPath` SHALL be used when calling `runImportPipeline`.

If no MATLAB installations are configured, the "Start Import" button SHALL be disabled and an alert message SHALL be shown.

#### Scenario: Single MATLAB installation

- **WHEN** `matlabInstallations` has one entry
- **THEN** the dropdown shows that entry as the only option and it is pre-selected

#### Scenario: Multiple MATLAB installations

- **WHEN** `matlabInstallations` has multiple entries
- **THEN** the dropdown lists all entries and the user can select which to use for import

#### Scenario: No MATLAB installation configured

- **WHEN** `matlabInstallations` is empty or `exploreAslPath` is empty
- **THEN** the "Start Import" button is disabled and an alert is shown

#### Scenario: Selected MATLAB path used for import

- **WHEN** the user selects "MATLAB R2024b" from the dropdown and clicks "Start Import"
- **THEN** `runImportPipeline` is called with `matlabPath` set to the path of that installation

### Requirement: ImportProgress table population

The progress table SHALL be populated from two sources: (1) `read_import_status` lock file scan results when entering step 5, and (2) real-time events during import execution. On entering step 5, the system SHALL call `read_import_status` to reconstruct per-subject progress, then SHALL compute staleness by diffing current config against `mostRecentConfig`.

During import execution, the table SHALL update in real-time as structured events arrive. All subjects start with `status: "pending"` when `startImport()` is called.

#### Scenario: Table shows reconstructed status on re-visit

- **WHEN** the user navigates to step 5 after a successful import
- **THEN** the progress table lists all subjects with status "completed" (reconstructed from lock files), not "pending"

#### Scenario: Table shows reconstructed failed status on re-visit

- **WHEN** the user navigates to step 5 after a partially failed import
- **THEN** failed subjects show status "failed" and completed subjects show status "completed", all reconstructed from lock files

#### Scenario: Table updates during active import

- **WHEN** a `subject_start` event arrives for subject "GOOD" during an active import
- **THEN** `importProgress["GOOD"].status` transitions from "pending" to "running"

### Requirement: canAccessPhase dispatches on dataSource

`canAccessPhase(project, targetPhase)` SHALL implement the phase gating logic:

- `idx = PROJECT_PHASES.indexOf(targetPhase)`, `currentIdx = PROJECT_PHASES.indexOf(project.projectMeta.currentPhase)`.
- If `idx <= currentIdx` → return `true`.
- If `targetPhase === "parameters"` → return `true`.
- If `targetPhase === "processing"` → dispatch on `dataSource`:
  - `dataSource === "bids"` → return `project.uiState?.import?.bidsReviewConfirmed === true`
  - `dataSource === "dicom"` → return `project.uiState?.import?.completed === true`
- If `targetPhase === "visualization" || targetPhase === "manifest"` → return `project.uiState?.population?.completed === true`.
- Else → return `false`.

`dataSource` is required (no fallback default per `ProjectMetaSchema`). Existing test fixtures that omitted `dataSource` MUST be updated to set it explicitly.

#### Scenario: BIDS project before confirmation blocked from processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = false`
- **THEN** returns `false`

#### Scenario: BIDS project after confirmation reaches processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = true`
- **THEN** returns `true`

#### Scenario: DICOM project gate unchanged

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "dicom"` and `uiState.import.completed = true`
- **THEN** returns `true`

### Requirement: ImportPage conditional rendering

`ImportPage` SHALL render based on `project.projectMeta.dataSource`:

- `"bids"` → render `BIDSReviewPanel`
- `"dicom"` → render the existing 6-step DICOM wizard

When `uiState.import.bidsReviewConfirmed = true` and user revisits Import on a BIDS project, `BIDSReviewPanel` renders a persisted summary with explicit re-scan/re-confirm capability.

#### Scenario: BIDS project lands on review panel

- **WHEN** user creates a BIDS-direct project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders `BIDSReviewPanel` (not the 6-step wizard)

#### Scenario: DICOM project lands on wizard

- **WHEN** user creates a DICOM project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders the existing 6-step DICOM wizard

#### Scenario: BIDS project revisit supports re-sync

- **WHEN** user with `bidsReviewConfirmed = true` navigates back to Import on a BIDS-direct project
- **THEN** `ImportPage` renders `BIDSReviewPanel` with persisted summary and `[Re-scan BIDS]`
