# processing-store Specification

## Purpose

TBD - created by archiving change processing-module. Update Purpose after archive.

## Requirements

### Requirement: Processing Phase State Machine

The processing store SHALL manage a phase state machine with exactly six states: `idle`, `preparing`, `running`, `completed`, `failed`, `cancelled`. The store SHALL persist `processingPhase` and `lastRunConfig` to the `.easl` project file. Per-subject progress SHALL NOT be persisted — it SHALL be reconstructed from lock files on page load or route re-entry. When `processingPhase` transitions to `"completed"` and the processing config's `modules` includes `"population"`, the store SHALL call `setPopulationCompleted(true)` on the project store. When `startProcessing` is called with `modules` including `"population"`, the store SHALL call `setPopulationCompleted(false)` to clear any prior flag before spawning workers.

When `startProcessing` is invoked with `modules` including `"population"`, the store SHALL additionally invoke the Rust command `capture_environment_versions` (or named equivalent) to obtain `{ exploreASL: string; matlab: string }` and SHALL persist these values to `uiState.manifest.lastRunVersions.exploreASL` and `uiState.manifest.lastRunVersions.matlab` on the project store. The GUI version SHALL be sourced synchronously from the frontend (e.g. `package.json` version) and written to `uiState.manifest.lastRunVersions.gui`. Version capture SHALL NOT abort the run if a probe fails; on probe failure, the corresponding field SHALL be set to the literal string `"unknown"`.

After `processingPhase` transitions to `"completed"` and `modules` includes `"population"`, the store SHALL additionally read the mtime of `derivatives/ExploreASL/.../xASL_module_Population/xASL_module_Population/999_ready.status` and persist it to `uiState.manifest.lastPopulationRunMtime` as integer milliseconds since epoch. If the file cannot be located, the field SHALL be set to `null` and a warning SHALL be logged via the existing debug bridge; the run SHALL still transition to `completed`. Each invocation of `startProcessing` with Population in modules SHALL overwrite the prior `lastRunVersions` and (on completion) `lastPopulationRunMtime` values.

#### Scenario: Initial state on page load

- **WHEN** the processing page is loaded
- **THEN** the store SHALL call `read_lock_status` to reconstruct per-subject progress from lock files, and set `processingPhase` based on persisted value (or `idle` if no prior run exists)

#### Scenario: Phase transition on start

- **WHEN** the user clicks Start after validation passes
- **THEN** the store SHALL transition from `idle` to `preparing`, then to `running` after workers are spawned

#### Scenario: Phase transition on all workers complete successfully

- **WHEN** all worker processes exit and `read_lock_status` confirms all subjects have `999_ready.status`
- **THEN** the store SHALL transition to `completed`, and if `config.modules` includes `"population"`, SHALL call `setPopulationCompleted(true)` and SHALL persist `lastPopulationRunMtime` from the `999_ready.status` file's mtime

#### Scenario: Phase transition on worker failure

- **WHEN** all worker processes exit but some subjects lack `999_ready.status`
- **THEN** the store SHALL transition to `failed` and SHALL NOT call `setPopulationCompleted(true)`

#### Scenario: Phase transition on user kill

- **WHEN** the user clicks Kill and all worker processes are terminated
- **THEN** the store SHALL transition to `cancelled`

#### Scenario: Population flag cleared on re-run

- **WHEN** the user starts processing with `config.modules` including `"population"` and `uiState.population.completed` is currently `true`
- **THEN** the store SHALL call `setPopulationCompleted(false)` before transitioning to `preparing`, which in turn SHALL disable both the Visualization and Manifest phase nav entries via `canAccessPhase`

#### Scenario: Population flag not cleared on non-Population re-run

- **WHEN** the user starts processing with `config.modules` not including `"population"`
- **THEN** the store SHALL NOT call `setPopulationCompleted(false)`

#### Scenario: Versions captured on Population run start

- **WHEN** `startProcessing` is called with `modules: ["population"]` and both version probes succeed
- **THEN** before the run enters `preparing` phase, `project.uiState.manifest.lastRunVersions` SHALL be populated with non-`"unknown"` values for `exploreASL`, `matlab`, and `gui`

#### Scenario: Version probe failure does not block run

- **WHEN** the ExploreASL version probe returns an error but the MATLAB probe succeeds
- **THEN** `lastRunVersions.exploreASL === "unknown"`, `lastRunVersions.matlab` SHALL be the probed value, and the run SHALL proceed into `preparing` phase normally

#### Scenario: Mtime persisted after Population completes

- **WHEN** a Population run completes successfully and `999_ready.status` exists with mtime `1700000060000` (ms)
- **THEN** `project.uiState.manifest.lastPopulationRunMtime` SHALL equal `1700000060000` after the project is saved

#### Scenario: Missing 999_ready at capture time

- **WHEN** a Population run reports `completed` but the `999_ready.status` file cannot be located
- **THEN** `lastPopulationRunMtime` SHALL be set to `null`, a warning SHALL be logged, and the run SHALL still transition to `completed`

#### Scenario: Re-run overwrites prior version capture

- **WHEN** a Population run has previously captured `lastRunVersions.exploreASL === "1.0.0"` and a subsequent run uses ExploreASL `1.1.0`
- **THEN** after the second `startProcessing` call, `lastRunVersions.exploreASL === "1.1.0"` and no field referencing `"1.0.0"` SHALL remain

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight
- **THEN** `uiState.manifest.verdicts` in the persisted `.easl` SHALL remain unchanged (no automatic deletion); the verdicts SHALL become stale per the `manifest-verdicts` staleness rules once the new run completes

### Requirement: Process Configuration

The store SHALL hold a `ProcessConfig` object containing: `subjects` (array of selected SubjectSession strings), `modules` (array of `structural`, `asl`, `population` — at least one required), `matlabPath` (string), `exploreAslPath` (string), `workers` (integer, 1–available cores), and `subjectRegexp` (string generated from subject selection). If Population is selected, `workers` SHALL be forced to 1. The frontend SHALL translate `modules` string array to `bProcess` boolean vector (`[true, false, false]` → Structural only, `[true, true, false]` → Structural+ASL, etc.) before passing to `run_pipeline`.

`setConfig` SHALL enforce mutual exclusivity between Population and Structural/ASL. If `modules` contains `"population"`, it SHALL NOT contain `"structural"` or `"asl"`. If `modules` contains `"structural"` or `"asl"`, it SHALL NOT contain `"population"`. When a conflicting module is added, the opposite module(s) SHALL be removed automatically.

#### Scenario: Population module forces single worker

- **WHEN** the user selects the Population module
- **THEN** the worker count SHALL be forced to 1 and the UI SHALL display a warning that Population cannot be parallelized

#### Scenario: Population auto-deselects Structural and ASL

- **WHEN** `setConfig` is called with `modules: ["population", "structural"]` (where population was added)
- **THEN** the store SHALL normalize to `modules: ["population"]` (removing structural and asl)

#### Scenario: Structural auto-deselects Population

- **WHEN** `setConfig` is called with `modules: ["population", "structural"]` (where structural was added)
- **THEN** the store SHALL normalize to `modules: ["structural"]` (removing population)

#### Scenario: ASL auto-deselects Population

- **WHEN** `setConfig` is called with `modules: ["asl", "population"]` (where asl was added)
- **THEN** the store SHALL normalize to `modules: ["asl"]` (removing population)

#### Scenario: SubjectRegexp generation for all subjects

- **WHEN** all subjects are selected
- **THEN** `subjectRegexp` SHALL be `^sub-.*$`

#### Scenario: SubjectRegexp generation for subset

- **WHEN** a subset of subjects is selected
- **THEN** `subjectRegexp` SHALL be an alternation regex e.g. `^(sub-X_Y|sub-Z_W)$`

### Requirement: Subject List Discovery

The store SHALL provide `availableSubjects` populated by calling `list_subjects` which scans `rawdata/sub-X/ses-Y/` directories. Each entry SHALL include the SubjectSession string (`sub-X_Y`), the subject label, session label, and module availability flags (`hasStructural`, `hasASL`) derived from the presence of `anat/` and `perf/` subdirectories.

#### Scenario: No rawdata directory

- **WHEN** `rawdata/` does not exist or is empty
- **THEN** `availableSubjects` SHALL be empty and the UI SHALL show an error state

#### Scenario: Session detection from BIDS

- **WHEN** `rawdata/sub-C9ORF007Philips/ses-01/` exists with an `anat/` subdirectory
- **THEN** the subject list SHALL include `{ subjectSession: "sub-C9ORF007Philips_01", hasStructural: true, hasASl: false }`

### Requirement: Per-Subject Progress Tracking

The store SHALL maintain `subjectStatuses` as an array of `SubjectModuleStatus` objects. Each entry SHALL track: `subjectSession`, `module` (structural/asl/population), optional `run` (for ASL), `status` (pending/incomplete/complete), `completedSteps` (array of step code strings), and `locked` (boolean). The `locked` field is a separate attribute from `status` — when `locked` is true and `status` is not `complete`, the subject is being processed. Progress SHALL be updated via `StatusFileCreated` and `LockCreated` events from the lock file watcher.

#### Scenario: LockCreated event received

- **WHEN** a `LockCreated` event is received for module `structural`, subject `sub-X_01`
- **THEN** the matching `SubjectModuleStatus` SHALL have `locked` set to `true`

#### Scenario: StatusFileCreated for step completion

- **WHEN** a `StatusFileCreated` event is received with step code `060_Segment_T1w` for module `structural`, subject `sub-X_01`
- **THEN** the matching `SubjectModuleStatus` SHALL have `060_Segment_T1w` added to `completedSteps`

#### Scenario: 999_ready marks module complete

- **WHEN** a `StatusFileCreated` event is received with step code `999_ready` for any module/subject
- **THEN** the matching `SubjectModuleStatus` SHALL have `status` set to `complete`

### Requirement: Worker Process Tracking

The store SHALL track `workerPids` (array of numbers) returned from `run_pipeline`. When all workers have exited (detected via `WorkerExited` events), the store SHALL call `read_lock_status` to determine final per-subject status and transition the processing phase.

#### Scenario: Single worker crash

- **WHEN** one of N workers crashes (non-zero exit)
- **THEN** the remaining workers SHALL continue running; the store SHALL NOT kill them

### Requirement: Last Run Config Persistence

The store SHALL persist the last run configuration (`ProcessConfig`) to the `.easl` project file under `uiState.processingConfig`. On page load, the config form SHALL be pre-filled with the last run's values.

#### Scenario: Config restoration on page load

- **WHEN** the user navigates to the processing page after a previous run
- **THEN** the subject selection, module checkboxes, MATLAB version, and worker count SHALL be pre-filled from `lastRunConfig`
