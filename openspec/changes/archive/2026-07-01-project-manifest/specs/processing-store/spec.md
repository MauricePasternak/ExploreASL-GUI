## MODIFIED Requirements

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
