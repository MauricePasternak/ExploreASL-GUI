# manifest-version-capture Specification

## Purpose

Define capture of processing environment versions for manifests.

## Requirements

### Requirement: Native preparation captures versions

For a reserved Population run, native processing preparation SHALL capture ExploreASL, MATLAB, and GUI versions during `preparing`, in parallel with independent participant preparation, and SHALL await capture before scientific workers spawn. The native snapshot SHALL carry this provenance. The renderer SHALL NOT launch processing-time version probes. Native terminal reconciliation SHALL write accepted values to `uiState.processing.population.lastRun.exploreASLVersion`, `matlabVersion`, and `guiVersion` after Population execution has committed.

A settled probe failure that permits fallback SHALL set the corresponding field to the literal string `"unknown"` without discarding other captured versions. A timed-out or otherwise unsettled probe SHALL fail preparation and settle its owned process scope before terminal publication; scientific workers SHALL NOT spawn with unresolved probe ownership.

#### Scenario: Versions captured on Population run start

- **WHEN** `startProcessing` is called with `modules: ["population"]` and both probes succeed
- **THEN** native capture SHALL overlap independent preparation and finish before workers spawn; the accepted terminal snapshot SHALL persist non-`"unknown"` values for `exploreASLVersion`, `matlabVersion`, and `guiVersion`

#### Scenario: Probe failure does not block run

- **WHEN** ExploreASL version capture cannot determine a version, its process ownership is settled, and the MATLAB probe succeeds
- **THEN** native provenance SHALL use `exploreAsl: "unknown"` and the probed MATLAB value, launch MAY proceed, and exact terminal persistence SHALL save those values after execution commit

#### Scenario: Version probe times out

- **WHEN** a native version probe times out during preparation
- **THEN** preparation SHALL fail, its process scope SHALL settle before terminal publication, and no scientific worker SHALL spawn

### Requirement: Mtime Capture For Population Run

Native completion SHALL audit the Population ready file at `derivatives/ExploreASL/lock/xASL_module_Population/xASL_module_Population/999_ready.status` and supply `populationReadyMtimeMs` in the accepted snapshot. Native terminal reconciliation SHALL save that value to `uiState.processing.population.lastRun.Mtime` as integer milliseconds since epoch. The renderer SHALL NOT perform a completion-time filesystem probe.

#### Scenario: Mtime persisted after Population completes

- **WHEN** a Population run completes successfully and `999_ready.status` exists with mtime `1700000060000` (ms)
- **THEN** `project.uiState.processing.population.lastRun.Mtime` SHALL equal `1700000060000` after the project is saved

#### Scenario: Missing 999_ready at capture time

- **WHEN** native completion audited valid fresh ready evidence but its later optional provenance mtime is unavailable
- **THEN** native provenance SHALL supply `null` plus a diagnostic without renderer reclassification; missing ready evidence during the completion audit SHALL instead fail the run

### Requirement: Capture Replaces Prior Values

Accepted native Population execution-commit evidence SHALL invalidate prior completion while retaining the prior `lastRun` until terminal reconciliation. Terminal reconciliation SHALL replace the Population `lastRun` version fields and mtime with the committed run's native provenance. Rejected reservation or preparation failure before execution commit SHALL preserve prior completion and provenance. Non-Population runs SHALL NOT alter the Population fields.

#### Scenario: Re-run overwrites prior versions

- **WHEN** a Population run has previously captured `lastRun.exploreASLVersion === "1.0.0"` and a subsequent run uses ExploreASL `1.1.0`
- **THEN** after the second committed run's exact terminal persistence, `lastRun.exploreASLVersion === "1.1.0"` and its version fields SHALL contain only the accepted second-run provenance
