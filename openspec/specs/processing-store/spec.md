# processing-store Specification

## Purpose

Define processing lifecycle state, progress, and persistence behavior.

## Requirements

### Requirement: Processing Phase State Machine

The processing store SHALL represent the native lifecycle states `preparing`, `running`, `finalizing`, `completed`, `cancelling`, `cancelled`, `failed`, and `interrupted`, plus local `idle` when no native run is attached. Runtime `activeRunId` and worker membership SHALL NOT be persisted as restart truth. The store SHALL persist terminal `processingPhase` and `lastRunConfig` to the `.easl` project file. Per-subject progress SHALL NOT be persisted; it SHALL be reconstructed from lock files on page load or route re-entry. Native run snapshots and events SHALL be authoritative while a run is attached.

When the native run transitions to `completed` and the processing config's modules include `population`, the store SHALL call `setPopulationCompleted(true)` on the project store. When `startProcessing` is called with modules including `population`, the store SHALL call `setPopulationCompleted(false)` after native reservation succeeds and before workers spawn.

When `startProcessing` is invoked with modules including `population`, the store SHALL additionally invoke the Rust command `capture_environment_versions` (or named equivalent) to obtain `{ explore_asl: string; matlab: string }`. Version capture SHALL be initiated during `preparing` in parallel with other preparation work. The capture SHALL be joined before worker processes are spawned. Returned values SHALL be persisted to `uiState.processing.population.lastRun` through the existing project-store actions. Probe failure SHALL produce the literal string `unknown` and SHALL NOT abort the run.

After the native run transitions to `completed` with `population` selected, the store SHALL read the Population `999_ready.status` mtime and persist integer milliseconds through `setLastPopulationRunMtime`. A missing file SHALL produce `null` plus a debug warning without changing the terminal state. Each Population start SHALL overwrite prior last-run version values and, on completion, the mtime.

#### Scenario: Initial state on page load

- **WHEN** the processing page loads and `get_active_run` returns no run
- **THEN** the store SHALL reconstruct per-subject progress from lock files and use the persisted terminal phase or `idle`

#### Scenario: Phase transition on start

- **WHEN** validation passes and native reservation succeeds
- **THEN** the store SHALL bind the returned run ID and render `preparing`, then follow authoritative native snapshots through `running` and `finalizing`

#### Scenario: Phase transition on all workers complete successfully

- **WHEN** the current native run enters `Finalizing`, existing lock-status finalization confirms all subjects have `999_ready.status`, and native finalization returns `Completed`
- **THEN** the store SHALL render `completed`, and if modules include `population`, SHALL set Population completed and persist its ready-file mtime

#### Scenario: Phase transition on worker failure

- **WHEN** the current native run enters `Finalizing`, existing lock-status finalization finds missing ready status, and native finalization returns `Failed`
- **THEN** the store SHALL render `failed` and SHALL NOT set Population completed

#### Scenario: Phase transition on user kill

- **WHEN** the current run is cancelled and native `kill_pipeline(runId)` returns `Cancelled`
- **THEN** the store SHALL render `cancelled`

#### Scenario: Population flag cleared on re-run

- **WHEN** native reservation succeeds for modules including `population` and the Population completed flag is true
- **THEN** the store SHALL clear that flag before workers spawn

#### Scenario: Population flag not cleared on rejected start

- **WHEN** reservation rejects because another run is active
- **THEN** the store SHALL NOT clear the Population completed flag

#### Scenario: Population flag not cleared on non-Population re-run

- **WHEN** the user reserves processing without `population` selected
- **THEN** the store SHALL NOT clear the Population completed flag

#### Scenario: Versions captured on Population run start

- **WHEN** a Population run reservation succeeds and both version probes succeed
- **THEN** capture SHALL run during `preparing`, complete before worker spawn, and persist non-`unknown` ExploreASL, MATLAB, and GUI versions

#### Scenario: Version probe failure does not block run

- **WHEN** the ExploreASL probe fails but the MATLAB probe succeeds
- **THEN** the ExploreASL version SHALL be `unknown`, the MATLAB version SHALL be retained, and launch SHALL continue

#### Scenario: Version capture runs in parallel with participants generation

- **WHEN** a reserved Population run has a slow MATLAB probe
- **THEN** participants generation SHALL begin before the probe resolves while the store remains attached to the same `preparing` run

#### Scenario: Mtime persisted after Population completes

- **WHEN** a Population run reaches native `Completed` and its ready file mtime is `1700000060000`
- **THEN** the persisted Population last-run mtime SHALL equal `1700000060000`

#### Scenario: Missing 999_ready at capture time

- **WHEN** a Population run reaches native `Completed` but its ready file cannot be located
- **THEN** mtime SHALL be `null`, a warning SHALL be logged, and phase SHALL remain `completed`

#### Scenario: Re-run overwrites prior version capture

- **WHEN** a new reserved Population run captures version `1.1.0` after a prior run stored `1.0.0`
- **THEN** the new last-run version SHALL replace the old value

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight
- **THEN** persisted manifest verdicts SHALL remain unchanged and become stale only under existing verdict staleness rules

### Requirement: Process Configuration

The store SHALL hold a `ProcessConfig` object containing: `subjects` (array of selected SubjectSession strings), `modules` (array of `structural`, `asl`, `population` — at least one required), `selectedProfileId` (string), `workers` (integer, 1–available cores), and `subjectRegexp` (string generated from subject selection). If Population is selected, `workers` SHALL be forced to 1. The frontend SHALL translate `modules` string array to `bProcess` boolean vector (`[true, false, false]` → Structural only, `[true, true, false]` → Structural+ASL, etc.) before passing to `run_pipeline`.

The `ProcessConfigSchema` SHALL be:

```
z.object({
  subjects: z.array(z.string()),
  modules: z.array(z.enum(PROCESSING_MODULES)),
  selectedProfileId: z.string(),
  workers: z.number().int().min(1),
})
```

`setConfig` SHALL enforce mutual exclusivity between Population and Structural/ASL. If `modules` contains `"population"`, it SHALL NOT contain `"structural"` or `"asl"`. If `modules` contains `"structural"` or `"asl"`, it SHALL NOT contain `"population"`. When a conflicting module is added, the opposite module(s) SHALL be removed automatically.

Before calling `run_pipeline`, `startProcessing` SHALL:

1. Resolve the profile via `globalStore.getProfileById(selectedProfileId)`. If not found, show an inline error ("Selected profile was deleted or is invalid") and block execution. Do NOT transition to `failed` pipeline state — this is a config error, not a pipeline failure.
2. Check `globalStore.profileValidationState[selectedProfileId]`. If not valid, show an inline error with the validation errors and block execution. Do NOT transition to `failed`.
3. If the population module is selected, call `capture_environment_versions` with the resolved profile's `exploreAslPath` and `matlabPath`, and store the result alongside `profileId` via `setLastRunProfileId("population", profileId, { exploreASLVersion, matlabVersion, guiVersion })`.
4. Only if all checks pass, invoke `run_pipeline` with the typed `ExecutionProfile` object.

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

#### Scenario: Config with selected profile

- **WHEN** the user selects a profile with ID "abc-123" and 2 subjects, then clicks Start
- **THEN** `ProcessConfig` SHALL contain `{ selectedProfileId: "abc-123", subjects: [...], modules: [...], workers: N }`

#### Scenario: Profile resolved and validated at execution time

- **WHEN** `startProcessing` is called with `config.selectedProfileId = "abc-123"` and the profile is valid
- **THEN** the store SHALL resolve the profile, confirm it is valid, and pass it as a typed `ExecutionProfile` object to `run_pipeline`

#### Scenario: Population module stores profileId alongside version strings

- **WHEN** `startProcessing` is called with population module selected and profile "abc-123"
- **THEN** `setLastRunProfileId("population", "abc-123", { exploreASLVersion: "1.11.0", matlabVersion: "R2024b", guiVersion: "0.1.0" })` SHALL be called, storing `profileId` AND version strings in `population.lastRun`

#### Scenario: Profile not found at execution time

- **WHEN** `startProcessing` is called but `config.selectedProfileId` references a deleted profile
- **THEN** the store SHALL show an inline error ("Selected profile was deleted or is invalid") and SHALL NOT invoke `run_pipeline`. The store SHALL NOT transition to `failed` pipeline state — no pipeline process exists yet.

#### Scenario: Profile invalid at execution time

- **WHEN** `startProcessing` is called but `profileValidationState[selectedProfileId].valid` is `false`
- **THEN** the store SHALL show an inline error with the validation errors and SHALL NOT invoke `run_pipeline`. The store SHALL NOT transition to `failed` pipeline state.

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

- **WHEN** `rawdata/sub-001Philips/ses-01/` exists with an `anat/` subdirectory
- **THEN** the subject list SHALL include `{ subjectSession: "sub-001Philips_01", hasStructural: true, hasASl: false }`

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

The store SHALL bind displayed worker membership to `activeRunId` and reconcile it from each authoritative run snapshot. It SHALL NOT construct current membership solely from the PID list originally spawned by the launch call. `WorkerExited` SHALL affect the store only when its `runId` matches `activeRunId`; an unknown PID SHALL NOT remove another worker or finalize a run. When a matching event reports the final worker exit, the store SHALL obtain or accept the native snapshot: native `Finalizing` enters existing provisional lock-status finalization, while native `Failed` from `pendingLaunchFailure` remains authoritative and bypasses provisional completion.

#### Scenario: Single worker crash

- **WHEN** one of N workers exits nonzero for the attached run
- **THEN** the event SHALL be recorded for that run, remaining native workers SHALL continue, and the store SHALL NOT kill them

#### Scenario: Early worker exit before launch response

- **WHEN** a worker exits before `run_pipeline` returns
- **THEN** the returned authoritative snapshot SHALL not contain that PID and the store SHALL not re-add it

#### Scenario: Partial spawn failure remains controllable

- **WHEN** launch returns an error after native attachment reports `Running`, surviving workers, and `pendingLaunchFailure`
- **THEN** the store SHALL retain that exact run attachment, keep controls locked, permit Kill, and SHALL NOT issue a duplicate preparation-failure request

#### Scenario: Unknown worker event

- **WHEN** a matching-run `WorkerExited` names a PID absent from authoritative membership and exit evidence
- **THEN** the store SHALL not remove another PID or independently finalize the run

### Requirement: Last Run Config Persistence

The store SHALL persist the last run configuration (`ProcessConfig`) to the `.easl` project file under `uiState.processing.config` and `uiState.processing.currentPhase`. The persisted `ProcessConfig` SHALL use `selectedProfileId` instead of `matlabPath` and `exploreAslPath`. On page load, the config form SHALL be pre-filled with the last run's values, including the `selectedProfileId`. The sync SHALL spread the existing `uiState.processing` object to preserve sibling fields (e.g. `structural`, `asl`, `population` last-run metadata) that are managed by other parts of the processing lifecycle. If the referenced profile no longer exists in global settings, the profile selector SHALL show a "Profile not found" indicator and the Start button SHALL be disabled until a valid profile is selected.

#### Scenario: Config restoration on page load

- **WHEN** the user navigates to the processing page after a previous run
- **THEN** the subject selection, module checkboxes, profile selector, and worker count SHALL be pre-filled from the persisted config

#### Scenario: Persisted profile no longer exists

- **WHEN** the persisted `selectedProfileId` does not match any profile in `executionProfiles`
- **THEN** the profile selector SHALL show "(Profile not found)" and the Start button SHALL be disabled until a valid profile is selected

#### Scenario: Sync preserving structural/population sibling fields

- **WHEN** `syncProcessingState` is called with `{ config, processingPhase: "running" }` and `uiState.processing.population.completed` is `true` with `lastRun` metadata present
- **THEN** after the sync, `uiState.processing.population.completed` SHALL remain `true` and `uiState.processing.population.lastRun` SHALL retain its prior values (profileId, versions, Mtime)

### Requirement: Runtime Run Identity and Event Admission

The processing store SHALL hold session-only `activeRunId` and accept processing snapshots, status events, lock events, and worker events only when both the captured project lease is current and payload `runId` equals `activeRunId`. Missing or mismatched run IDs SHALL fail closed without changing phase, worker membership, subject progress, Population metadata, or listener ownership. Starting or attaching a different run SHALL replace listeners atomically and prevent queued old callbacks from mutating the replacement.

The listener set SHALL also admit run-correlated `ProcessingLifecycleSnapshot` events. Attachment SHALL use a discover/bind/listen/attach handshake so the post-listener snapshot reconciles an exit emitted during setup. Terminal Population version/mtime writes SHALL retain an exact terminal run correlation until the asynchronous side effect resolves and SHALL reject results after a replacement run or project lease change.

#### Scenario: Delayed same-project event

- **WHEN** run `R2` is attached and a queued status or worker event from run `R1` arrives for the same project
- **THEN** the store SHALL ignore the event completely

#### Scenario: Event missing run identity

- **WHEN** an event capable of changing processing state lacks `runId`
- **THEN** the store SHALL reject the payload without mutation

#### Scenario: Project replacement with reused run text

- **WHEN** project lifecycle changes while an old event callback remains queued
- **THEN** the project-lease check SHALL reject it even if its run ID equals the currently stored text

### Requirement: Native Reservation Before Frontend Preparation

After local configuration validation and before run-specific participants generation, rawdata preparation, watcher start, status/log cleanup, or Population metadata clearing, `startProcessing` SHALL reserve a native run. The full start operation SHALL be registered as a deferred project-lifecycle thunk; if an active project's work admission has closed for close/switch, registration SHALL reject without invoking the thunk, reserving a run, or entering local `preparing`. A reservation conflict SHALL leave the store attached to the existing run or return to its prior state and SHALL cause no rejected-run filesystem or project-state mutation. Any preparation failure after reservation SHALL transition the matching native run to `Failed` before local controls unlock. A rawdata-warning confirmation SHALL atomically claim the matching pending continuation so repeated confirmation submits at most one preparation/launch continuation; native `Preparing` admission remains authoritative.

#### Scenario: Concurrent frontend starts

- **WHEN** two start actions race after local validation
- **THEN** only the action holding the successful native reservation SHALL perform preparation or launch mutations

#### Scenario: Preparation fails after reservation

- **WHEN** participants generation fails for a reserved `Preparing` run
- **THEN** the store SHALL request failure of that exact run and render the returned native `Failed` state without leaving an active `Preparing` reservation

### Requirement: Run Discovery and Attachment Client

The frontend SHALL expose typed clients for `get_active_run` and `attach_run`. Attachment SHALL validate the returned run ID and active project lease, install run-scoped listeners exactly once, and reconcile phase and worker membership from the returned snapshot. PL-01 attachment covers the current in-memory native run; persistence and full application-restart recovery remain outside this requirement.

#### Scenario: Attach current in-memory run

- **WHEN** `get_active_run` returns `R1` for the active project and `attach_run(R1)` confirms it
- **THEN** the store SHALL bind `R1`, install one listener set, and render its authoritative lifecycle and worker membership

#### Scenario: Attachment response becomes stale

- **WHEN** project lifecycle or active run changes while `attach_run` is pending
- **THEN** the response SHALL be ignored without replacing current listeners or state
