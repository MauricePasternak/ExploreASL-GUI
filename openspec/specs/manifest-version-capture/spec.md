# manifest-version-capture Specification

## Purpose

Define capture of processing environment versions for manifests.

## Requirements

### Requirement: Startprocessing Hook Captures Versions

When `processingStore.startProcessing` is invoked and the supplied modules array includes `"population"`, the store SHALL call a Rust command `capture_environment_versions` (or equivalent) that returns `{ explore_asl: string; matlab: string }`. Version capture SHALL be initiated during the `preparing` phase in parallel with other prep work (participants generation, file watcher setup) and SHALL be joined (awaited) before worker processes are spawned. The returned values SHALL be written to `uiState.processing.population.lastRun.exploreASLVersion` and `uiState.processing.population.lastRun.matlabVersion` on the project store via `setLastRunProfileId`. The GUI version SHALL be sourced synchronously from the frontend (e.g. `package.json` version or `import.meta.env.VITE_APP_VERSION`) and written to `uiState.processing.population.lastRun.guiVersion`.

Version capture SHALL NOT abort the run if a probe fails. On probe failure, the corresponding field SHALL be set to the literal string `"unknown"`.

#### Scenario: Versions captured on Population run start

- **WHEN** `startProcessing` is called with `modules: ["population"]` and both probes succeed
- **THEN** during the `preparing` phase, version capture SHALL be initiated in parallel with other prep work and SHALL complete before worker processes are spawned. `project.uiState.processing.population.lastRun` SHALL be populated with non-`"unknown"` values for `exploreASLVersion`, `matlabVersion`, and `guiVersion`

#### Scenario: Probe failure does not block run

- **WHEN** the ExploreASL version probe returns an error but the MATLAB probe succeeds
- **THEN** `lastRun.exploreASLVersion === "unknown"`, `lastRun.matlabVersion` SHALL be the probed value, and the run SHALL proceed to spawning workers normally

### Requirement: Mtime Capture For Population Run

When `startProcessing` is invoked with `modules: ["population"]`, after Population completion (processing phase transitions to `completed`), the store SHALL read the mtime of `derivatives/ExploreASL/.../xASL_module_Population/xASL_module_Population/999_ready.status` and persist it to `uiState.processing.population.lastRun.Mtime` as integer milliseconds since epoch (via `setLastPopulationRunMtime`). The path resolution SHALL use the existing population lock path conventions consistent with `processingSchemas.ts`.

#### Scenario: Mtime persisted after Population completes

- **WHEN** a Population run completes successfully and `999_ready.status` exists with mtime `1700000060000` (ms)
- **THEN** `project.uiState.processing.population.lastRun.Mtime` SHALL equal `1700000060000` after the project is saved

#### Scenario: Missing 999_ready at capture time

- **WHEN** a Population run reports `completed` but the `999_ready.status` file cannot be located (filesystem race or human deletion)
- **THEN** `lastRun.Mtime` SHALL be set to `null` and a warning SHALL be logged via the existing debug bridge; the run SHALL still transition to `completed`

### Requirement: Capture Replaces Prior Values

Each invocation of `startProcessing` with Population in modules SHALL overwrite the prior `lastRun` values and (on completion) the `Mtime` value. Stale capture values from prior runs SHALL NOT be preserved.

#### Scenario: Re-run overwrites prior versions

- **WHEN** a Population run has previously captured `lastRun.exploreASLVersion === "1.0.0"` and a subsequent run uses ExploreASL `1.1.0`
- **THEN** after the second `startProcessing` call, `lastRun.exploreASLVersion === "1.1.0"` and no field referencing `"1.0.0"` SHALL remain
