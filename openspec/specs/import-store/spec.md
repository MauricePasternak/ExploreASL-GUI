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

The `ImportSnapshot` type SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, `subjectRows`.

The `importCompleted` flag and `mostRecentConfig` SHALL be persisted in the project file under `uiState.import.completed` and `uiState.import.mostRecentConfig` respectively.

The `startImport()` action SHALL capture the current import configuration as an `ImportSnapshot` and store it in `mostRecentConfig` before transitioning to `"preparing"` phase.

The store SHALL provide a `reconstructProgressFromLockFiles(progress: Record<string, ImportProgress>)` action that replaces `importProgress` with lock file scan results and preserves real-time events if an import is currently running.

The store SHALL provide a `computeStaleness(currentConfig: ImportState, snapshot: ImportSnapshot | null): Record<string, boolean>` function that returns per-subject staleness. This function SHALL be called on entering step 5 and the results stored in each subject's `stale` field in `importProgress`.

#### Scenario: Import starts with snapshot capture

- **WHEN** user clicks "Start Import"
- **THEN** `importPhase` transitions from `"idle"` to `"preparing"`, `importLog` is cleared, `mostRecentConfig` is set to current import configuration snapshot

#### Scenario: Import completes successfully

- **WHEN** all subjects succeed and post-processing finishes
- **THEN** `importPhase` is `"completed"`, `importCompleted` is `true`, both are persisted to project file under `uiState.import.completed`

#### Scenario: Progress reconstruction on re-visit

- **WHEN** the user navigates to step 5 and `read_import_status` returns lock file data
- **THEN** `reconstructProgressFromLockFiles` is called with the scan results, replacing the ephemeral progress with reconstructed per-subject status

#### Scenario: Staleness computation on re-visit

- **WHEN** the user navigates to step 5 after changing a metadata group parameter
- **THEN** `computeStaleness` identifies that `metadataGroups` differ, determines which groups changed, and marks subjects in those groups as stale

#### Scenario: Structural staleness on re-visit

- **WHEN** the user navigates to step 5 after changing a tokenizer assignment
- **THEN** `computeStaleness` identifies that `tokenizerConfigs` differ and marks ALL subjects as stale

#### Scenario: Page reload after successful import

- **WHEN** user reopens a project where `uiState.import.completed` was `true`
- **THEN** step 5 shows the reconstructed progress from lock files with appropriate staleness indicators

#### Scenario: Stale running state on reload (V0)

- **WHEN** user reopens a project where `uiState.import.currentPhase` was `"running"` (frontend reload during import)
- **THEN** a warning is shown: "Previous import may be running. Check status or retry."

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

## MODIFIED Requirements

### Requirement: DataPar state in project file schema

The `ProjectFileSchema` in `src/schemas/project.ts` SHALL replace the current `exploreAslConfig.dataPar` field from `z.object({}).passthrough()` with a structured Zod object `DataParSchema`. All fields within `DataParSchema` SHALL use `.optional()`. The `assembleDataPar` function SHALL convert stored `DataParSchema` state to the nested `x.*` JSON structure for ExploreASL consumption. The `uiState` object SHALL include `showAdvancedParameters: z.boolean().default(false)`.

#### Scenario: Existing project file with empty dataPar loads successfully

- **WHEN** a `.easl` file with `exploreAslConfig: { dataPar: {} }` is loaded
- **THEN** all dataPar fields initialize to `undefined` and the editor shows ghost placeholder defaults

#### Scenario: Existing project file with passthrough dataPar loads successfully

- **WHEN** a `.easl` file with `exploreAslConfig: { dataPar: { "x": { "Q": { "Lambda": 0.9 } } } }` is loaded
- **THEN** the `Lambda` value of 0.9 is parsed and displayed in the Quantification section

#### Scenario: Toggle state persists across sessions

- **WHEN** user enables "Show advanced parameter sections" and closes the app
- **THEN** on next load, `uiState.showAdvancedParameters` is `true` and Structural and Environment sections are visible
