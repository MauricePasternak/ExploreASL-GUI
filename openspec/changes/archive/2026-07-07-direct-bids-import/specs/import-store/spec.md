## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Import store additions

The import store SHALL add: `importCompleted: boolean` (defaults to `false`, set to `true` when all subjects complete successfully), `importLog: string[]` (accumulated raw stdout lines from `ImportRawEvent`), `importPhase: "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled"` (defaults to `"idle"`), and `mostRecentConfig: ImportSnapshot | null` (defaults to `null`, set at `startImport()` time from current import configuration).

The import store additionally SHALL support a BIDS review slice (`BidsReviewState` as specified above: `scanComplete`, `scanError`, `detectedGroups`, `skippedSubjects`, with actions `startBidsScan`, `setDetectedGroups`, `retryBidsScan`, `rescanConfirmedBidsProject`, `backToLanding`, `resetBidsReview`). The BIDS review slice is session-only; its `confirmed` equivalent is read from `project.uiState.import.bidsReviewConfirmed`.

The `ImportSnapshot` type SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, `subjectRows`.

The `importCompleted` flag and `mostRecentConfig` SHALL be persisted in the project file under `uiState.import.completed` and `uiState.import.mostRecentConfig` respectively.

The `startImport()` action SHALL capture the current import configuration as an `ImportSnapshot` and store it in `mostRecentConfig` before transitioning to `"preparing"` phase.

The store SHALL provide a `reconstructProgressFromLockFiles(progress: Record<string, ImportProgress>)` action that replaces `importProgress` with lock file scan results and preserves real-time events if an import is currently running.

The store SHALL provide a `computeStaleness(currentConfig: ImportState, snapshot: ImportSnapshot | null): Record<string, boolean>` function that returns per-subject staleness. This function SHALL be called on entering step 5 and the results stored in each subject's `stale` field in `importProgress`.
