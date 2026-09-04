## Purpose

Define import progress state, parsing, and persistence behavior.

## Requirements

### Requirement: ImportProgress state shape

The `ImportProgress` type in the import store SHALL be extended to include: `errorStep?: "DCM2NII" | "NII2BIDS"` (which step failed), `warnings?: string[]` (collected warning messages from stdout), `duration?: number` (processing duration in seconds), and `stale?: boolean` (whether the config has changed since this subject was imported). The `status` field SHALL support values: `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`.

#### Scenario: Subject fails at NII2BIDS step

- **WHEN** an `import_failed` event is parsed for subject BADDIE with step NII2BIDS
- **THEN** `importProgress["BADDIE"].status` is set to `"failed"`, `errorStep` is `"NII2BIDS"`, and `error` contains the failure message

#### Scenario: Subject succeeds with warnings

- **WHEN** subject GOOD completes processing with stdout warnings but no failures
- **THEN** `importProgress["GOOD"].status` is `"completed"`, `warnings` array contains parsed warning messages, `duration` contains the seconds value

#### Scenario: Subject cancelled by user

- **WHEN** user clicks "Stop" while subject INPROGRESS is in `"running"` state
- **THEN** `importProgress["INPROGRESS"].status` is set to `"cancelled"`

#### Scenario: Stale subject on re-visit

- **WHEN** the user navigates to step 5 after changing a metadata group parameter and `read_import_status` returns a completed subject whose group has changed
- **THEN** `importProgress["sub-001"].stale` is set to `true`

#### Scenario: Fresh subject on re-visit

- **WHEN** the user navigates to step 5 after a successful import with no config changes
- **THEN** `importProgress["sub-001"].stale` is `false` (or absent, which is falsy)

### Requirement: Import store additions

The import store SHALL add: `importCompleted: boolean` (defaults to `false`, set to `true` when all subjects complete successfully), `importLog: string[]` (accumulated raw stdout lines from `ImportRawEvent`), `importPhase: "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled"` (defaults to `"idle"`), and `mostRecentConfig: ImportSnapshot | null` (defaults to `null`, set at `startImport()` time from current import configuration).

The import store additionally SHALL support a BIDS review slice (`BidsReviewState` as specified above: `scanComplete`, `scanError`, `detectedGroups`, `skippedSubjects`, with actions `startBidsScan`, `setDetectedGroups`, `retryBidsScan`, `rescanConfirmedBidsProject`, `backToLanding`, `resetBidsReview`). The BIDS review slice is session-only; its `confirmed` equivalent is read from `project.uiState.import.bidsReviewConfirmed`.

The `ImportSnapshot` type SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, `subjectRows`.

The `importCompleted` flag and `mostRecentConfig` SHALL be persisted in the project file under `uiState.import.completed` and `uiState.import.mostRecentConfig` respectively.

The `startImport()` action SHALL capture the current import configuration as an `ImportSnapshot` and store it in `mostRecentConfig` before transitioning to `"preparing"` phase.

The store SHALL provide a `reconstructProgressFromLockFiles(progress: Record<string, ImportProgress>)` action that replaces `importProgress` with lock file scan results and preserves real-time events if an import is currently running.

The store SHALL provide a `computeStaleness(currentConfig: ImportState, snapshot: ImportSnapshot | null): Record<string, boolean>` function that returns per-subject staleness. This function SHALL be called on entering step 5 and the results stored in each subject's `stale` field in `importProgress`.

#### Scenario: Starting import captures configuration

- **WHEN** `startImport()` begins an import
- **THEN** it stores the current configuration in `mostRecentConfig` before entering the `"preparing"` phase

### Requirement: Subject error detail matching

When an `import_failed` event is received, the system SHALL match the failure description against the known subject list from `importProgress` keys. For each known subject, if the subject name appears as a substring in the failure description, that subject is marked as failed. The full message line following the failure pattern (e.g., `Message: ...`) SHALL be captured as the error detail.

#### Scenario: Subject name with underscores in failure description

- **WHEN** stderr contains `NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1` and known subjects include "BADDIE"
- **THEN** subject "BADDIE" is matched because "BADDIE" appears in the description string, error detail captures the subsequent `Message:` line

#### Scenario: Multiple subjects in single failure line

- **WHEN** a failure line references multiple subjects
- **THEN** each matching known subject is marked as failed with the same error detail

### Requirement: ImportProgress table population

The progress table SHALL be populated immediately when `importPhase` transitions to `"preparing"`, using subject names from the staging mappings. All subjects start with `status: "pending"`. As `subject_start` events arrive, matching subjects transition to `"running"`. As `subject_complete` or `import_failed` events arrive, subjects transition to `"completed"` or `"failed"`.

#### Scenario: Table shows all subjects before MATLAB starts

- **WHEN** the user clicks "Run Import" and import phase enters `"preparing"`
- **THEN** the progress table lists all subjects with status "pending" before any MATLAB output arrives

#### Scenario: Subject starts processing

- **WHEN** a `subject_start` event arrives for subject "GOOD"
- **THEN** `importProgress["GOOD"].status` transitions from `"pending"` to `"running"`

### Requirement: DataPar state in project file schema

The `ProjectFileSchema` in `src/schemas/project.ts` SHALL replace the current `dataPar` field from `z.object({}).passthrough()` with a structured Zod object `DataParSchema`. All fields within `DataParSchema` SHALL use `.optional()`. The `assembleDataPar` function SHALL convert stored `DataParSchema` state to the nested `x.*` JSON structure for ExploreASL consumption. The `uiState` object SHALL include `showAdvancedParameters: z.boolean().default(false)`.

#### Scenario: Existing project file with empty dataPar loads successfully

- **WHEN** a `.easl` file with `dataPar: {}` is loaded
- **THEN** all dataPar fields initialize to `undefined` and the editor shows ghost placeholder defaults

#### Scenario: Existing project file with passthrough dataPar loads successfully

- **WHEN** a `.easl` file with `dataPar: { "x": { "Q": { "Lambda": 0.9 } } }` is loaded
- **THEN** the `Lambda` value of 0.9 is parsed and displayed in the Quantification section

#### Scenario: Toggle state persists across sessions

- **WHEN** user enables "Show advanced parameter sections" and closes the app
- **THEN** on next load, `uiState.showAdvancedParameters` is `true` and Structural and Environment sections are visible

### Requirement: BIDS review slice for scan lifecycle

`importStore` SHALL add a `BidsReviewState` slice with:

- `scanComplete: boolean`
- `scanError: string | null`
- `detectedGroups: DerivedMetadataGroup[]`
- `skippedSubjects: string[]` (session-only copy; persisted version lives in `uiState.import.skippedSubjects`)

Actions:

- `startBidsScan(rootPath: string)`: invokes `scan_bids_sidecars`, populates `detectedGroups` and `skippedSubjects` on success
- `setDetectedGroups(groups)`: syncs the result of a scan
- `retryBidsScan()`: clears `scanError` and re-invokes `scan_bids_sidecars`
- `rescanConfirmedBidsProject(rootPath: string)`: starts a fresh scan for an already-confirmed BIDS project without clearing persisted project mapping state
- `backToLanding()`: navigates to `/` (abandons project; project remains in store)
- `resetBidsReview()`: clears BIDS review state (called on project switch)

Session-only state. Not persisted to `.easl`. The `confirmed` flag is NOT in this slice — `project.uiState.import.bidsReviewConfirmed` (persisted) is the single source of truth for confirmed state.

#### Scenario: Scan successful

- **WHEN** `startBidsScan` returns successfully with 1 group and 0 skipped subjects
- **THEN** `scanComplete = true`, `scanError = null`, `detectedGroups.length = 1`, `skippedSubjects.length = 0`

#### Scenario: Scan error

- **WHEN** `startBidsScan` returns `Err("permission denied")`
- **THEN** `scanComplete = false`, `scanError = "permission denied"`, `detectedGroups = []`

#### Scenario: Retry clears error

- **WHEN** user clicks `[Retry]` after scan error
- **THEN** `retryBidsScan()` clears `scanError` to `null` and re-invokes `scan_bids_sidecars`

#### Scenario: Confirmed state read from project store

- **WHEN** `BIDSReviewPanel` needs to render the persisted revisit summary
- **THEN** the panel reads `confirmed` from `projectStore.project.uiState.import.bidsReviewConfirmed`, not from `BidsReviewState`

#### Scenario: Confirmed project re-scan does not mutate persisted project state

- **WHEN** `rescanConfirmedBidsProject` fails with a scan error
- **THEN** `scanError` is set in session state and persisted `mappingState` / `uiState.import.skippedSubjects` remain unchanged

### Requirement: Portable DICOM source state

For DICOM projects, the persisted source location SHALL distinguish a project-internal relative path from an external absolute path. Persisted raw DICOM entries SHALL be location-independent relative paths under the logical source root and SHALL resolve to absolute paths only at runtime. Older absolute source and raw-path strings SHALL remain accepted. BIDS projects SHALL resolve their source to the current project root and SHALL NOT depend on a persisted former root.

#### Scenario: User selects DICOM folder inside project

- **WHEN** the selected DICOM source is contained by the active project root
- **THEN** canonical project state SHALL preserve it as a project-relative source and its raw entries SHALL remain portable when the project moves

#### Scenario: User selects external DICOM folder

- **WHEN** the selected DICOM source is outside the active project root
- **THEN** canonical project state SHALL preserve the source as an explicit absolute path while raw entries remain relative to that source

### Requirement: Missing DICOM source and relinking

A missing or unreadable DICOM source SHALL NOT prevent the project from opening. The Import phase SHALL retain the saved source reference and mapping configuration, display a persistent Relink warning, and disable only actions that require source access. Relinking SHALL scan the replacement and compare its discovered path structure with the saved structure before changing project state. A compatible replacement SHALL preserve mapping setup. An incompatible replacement SHALL require confirmation and SHALL reset only source-dependent import setup. A successful relink SHALL mark the project dirty and SHALL persist only through normal Save.

#### Scenario: External DICOM source is missing

- **WHEN** a project opens and its external DICOM source cannot be read
- **THEN** the project SHALL open, the Import phase SHALL show a persistent Relink warning, and source-dependent scan or import actions SHALL remain disabled

#### Scenario: Replacement structure matches

- **WHEN** the user selects a readable replacement whose discovered structure matches the saved source structure
- **THEN** the new source SHALL replace the missing reference, existing compatible token and metadata setup SHALL remain, and the project SHALL become dirty

#### Scenario: Replacement structure differs

- **WHEN** the selected replacement has a different discovered structure
- **THEN** the system SHALL explain which setup will reset and SHALL make no change until the user confirms

#### Scenario: User confirms changed DICOM source

- **WHEN** the user confirms an incompatible replacement
- **THEN** the system SHALL adopt the source, reset source-dependent raw paths, patterns, token assignments, and incompatible mappings, and mark the project dirty

#### Scenario: User cancels DICOM relink

- **WHEN** the user cancels selection or declines an incompatible replacement
- **THEN** the saved source reference and all import setup SHALL remain unchanged

### Requirement: Complete import hydration

Opening a project SHALL replace the complete import runtime slice with validated project values over import defaults. Missing optional mapping or UI fields SHALL apply defaults. Session-only BIDS review state, logs, errors, progress, running flags, and selections SHALL reset before the new project's values are exposed.

#### Scenario: Sparse project follows populated import state

- **WHEN** project A has populated mappings, logs, progress, and BIDS review state and project B omits optional import fields
- **THEN** project B SHALL expose import defaults and SHALL contain none of A's state

#### Scenario: Persisted import state belongs to project B

- **WHEN** project B contains valid persisted mappings and import UI state
- **THEN** the import store SHALL replace its persisted slice with B's values and reset all non-persisted fields
