## ADDED Requirements

### Requirement: Startprocessing Hook Captures Versions

When `processingStore.startProcessing` is invoked and the supplied modules array includes `"population"`, the store SHALL call a Rust command `capture_environment_versions` (or equivalent) that returns `{ exploreASL: string; matlab: string }`. The returned values SHALL be written to `uiState.manifest.lastRunVersions.exploreASL` and `uiState.manifest.lastRunVersions.matlab` on the project store. The GUI version SHALL be sourced synchronously from the frontend (e.g. `package.json` version or `import.meta.env.VITE_APP_VERSION`) and written to `uiState.manifest.lastRunVersions.gui`.

Version capture SHALL NOT abort the run if a probe fails. On probe failure, the corresponding field SHALL be set to the literal string `"unknown"`.

#### Scenario: Versions captured on Population run start

- **WHEN** `startProcessing` is called with `modules: ["population"]` and both probes succeed
- **THEN** before the run enters `preparing` phase, `project.uiState.manifest.lastRunVersions` SHALL be populated with non-`"unknown"` values for `exploreASL`, `matlab`, and `gui`

#### Scenario: Probe failure does not block run

- **WHEN** the ExploreASL version probe returns an error but the MATLAB probe succeeds
- **THEN** `lastRunVersions.exploreASL === "unknown"`, `lastRunVersions.matlab` SHALL be the probed value, and the run SHALL proceed into `preparing` phase normally

### Requirement: Mtime Capture For Population Run

When `startProcessing` is invoked with `modules: ["population"]`, after Population completion (processing phase transitions to `completed`), the store SHALL read the mtime of `derivatives/ExploreASL/.../xASL_module_Population/xASL_module_Population/999_ready.status` and persist it to `uiState.manifest.lastPopulationRunMtime` as integer milliseconds since epoch. The path resolution SHALL use the existing population lock path conventions consistent with `processingSchemas.ts`.

#### Scenario: Mtime persisted after Population completes

- **WHEN** a Population run completes successfully and `999_ready.status` exists with mtime `1700000060000` (ms)
- **THEN** `project.uiState.manifest.lastPopulationRunMtime` SHALL equal `1700000060000` after the project is saved

#### Scenario: Missing 999_ready at capture time

- **WHEN** a Population run reports `completed` but the `999_ready.status` file cannot be located (filesystem race or human deletion)
- **THEN** `lastPopulationRunMtime` SHALL be set to `null` and a warning SHALL be logged via the existing debug bridge; the run SHALL still transition to `completed`

### Requirement: Capture Replaces Prior Values

Each invocation of `startProcessing` with Population in modules SHALL overwrite the prior `lastRunVersions` and (on completion) `lastPopulationRunMtime` values. Stale capture values from prior runs SHALL NOT be preserved.

#### Scenario: Re-run overwrites prior versions

- **WHEN** a Population run has previously captured `lastRunVersions.exploreASL === "1.0.0"` and a subsequent run uses ExploreASL `1.1.0`
- **THEN** after the second `startProcessing` call, `lastRunVersions.exploreASL === "1.1.0"` and no field referencing `"1.0.0"` SHALL remain
