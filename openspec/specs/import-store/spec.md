## Purpose

Define import progress state, parsing, and persistence behavior.

## Requirements

### Requirement: Portable staging identifier validation

The import store SHALL validate the Subject, Session, Run, Run alias, and Modality values used to construct the four-level staging destination before import execution. Every value SHALL be non-empty, already Unicode NFC-normalized, and exactly one relative filesystem component. Values SHALL reject `.` and `..`, absolute-path syntax, path separators, Unicode General Category `Cc` controls, Windows-forbidden filename characters, trailing spaces or periods, and Windows device names under case-insensitive comparison on the basename before its first dot. Device names include `CON`, `PRN`, `AUX`, `NUL`, `CLOCK$`, `COM1`–`COM9`, `LPT1`–`LPT9`, and superscript-digit `COM`/`LPT` names.

Subject rename targets SHALL contain only ASCII letters and digits as a BIDS entity label and SHALL NOT include the literal `sub-` prefix. Modality SHALL be one of the supported ExploreASL modality names. Session and Run SHALL satisfy the common portable component contract without silently changing the user's value.

Portable uniqueness SHALL compare NFC-normalized Unicode default-case-folded keys so values that can collapse on another supported filesystem are treated as collisions. Original logical Subject/Session/Run provenance remains separate from final targets; distinct original subjects, sessions, or runs SHALL NOT share a portable Subject target, Session target, or Run alias respectively. Validation failures SHALL be runtime-only structured issues associated with the affected field and entry; they SHALL NOT overwrite or persist corrected values automatically. Existing projects with unsafe saved aliases or rename targets SHALL remain openable, but staging execution SHALL remain blocked until the user explicitly corrects them.

The runtime-only native preflight state SHALL carry a plan fingerprint, monotonic requestId, and captured ProjectLease. It SHALL accept a result only when the request is latest, the fingerprint and lease remain current, and project work admission is open; it SHALL not be serialized with mapping state.

#### Scenario: Unsafe component is retained for correction

- **WHEN** a legacy project opens with a subject target, session alias, or run alias containing traversal, a separator, or a reserved filename
- **THEN** the saved value SHALL remain visible and unchanged, a structured validation issue SHALL identify the affected field, and import staging SHALL remain blocked

#### Scenario: BIDS subject label is invalid

- **WHEN** a subject rename target contains punctuation, whitespace, Unicode characters, or the literal `sub-` prefix
- **THEN** validation SHALL reject the target, identify the subject field, and require explicit user correction before staging

#### Scenario: Portable subject collision

- **WHEN** two distinct source subjects have rename targets that differ only by case or Unicode representation
- **THEN** both targets SHALL be reported as a collision and neither SHALL be silently renamed or merged

#### Scenario: Suggested correction is not applied automatically

- **WHEN** the system can derive a safe suggested replacement for an invalid identifier
- **THEN** the suggestion SHALL be presented separately and the stored value SHALL remain unchanged until the user accepts or edits it

#### Scenario: Valid staging identifiers

- **WHEN** Subject, Session, Run, and Modality values satisfy their semantic rules and have unique portable keys
- **THEN** identifier validation SHALL produce no blocking issues

### Requirement: ImportProgress state shape

The `ImportProgress` type in the import store SHALL be extended to include: `errorStep?: "DCM2NII" | "NII2BIDS"` (which step failed), `warnings?: string[]` (collected warning messages from stdout), `duration?: number` (processing duration in seconds), and `stale?: boolean` (whether the config has changed since this subject was imported). The `status` field SHALL support values: `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`, `"interrupted"`.

#### Scenario: Subject fails at NII2BIDS step

- **WHEN** a matching native snapshot reports subject BADDIE failed verification after an NII2BIDS diagnostic failure
- **THEN** `importProgress["BADDIE"].status` SHALL become `"failed"` with the available failure detail; the diagnostic event alone SHALL NOT classify the terminal outcome

#### Scenario: Subject succeeds with warnings

- **WHEN** native finalization reports subject GOOD committed with available stdout warnings and duration diagnostics
- **THEN** `importProgress["GOOD"].status` is `"completed"`, `warnings` array contains parsed warning messages, `duration` contains the seconds value

#### Scenario: Subject cancelled by user

- **WHEN** native cancellation settles and a matching snapshot reports subject INPROGRESS cancelled
- **THEN** `importProgress["INPROGRESS"].status` SHALL become `"cancelled"`; clicking Stop alone SHALL NOT claim cancellation

#### Scenario: Stale subject on re-visit

- **WHEN** the user navigates to step 5 after changing a metadata group parameter and `read_import_status` returns a completed subject whose group has changed
- **THEN** `importProgress["sub-001"].stale` is set to `true`

#### Scenario: Fresh subject on re-visit

- **WHEN** the user navigates to step 5 after a successful import with no config changes
- **THEN** `importProgress["sub-001"].stale` is `false` (or absent, which is falsy)

### Requirement: Import store additions

The import store SHALL represent `idle`, `preparing`, `running`, `finalizing`, `completed`, `failed`, `cancelling`, `cancelled`, and `interrupted` phases plus a runtime-only attached `activeRunId`. Native run snapshots SHALL be authoritative while a run is attached. The store SHALL reconcile phase, selected-subject progress, errors, and terminal result from each accepted snapshot; it SHALL NOT independently complete a run from parser events, local PID state, or frontend post-processing promises.

The store SHALL retain import logs, staleness state, BIDS review state, current mapping configuration, and `mostRecentConfig`. Persisted `uiState.import.completed` and `uiState.import.currentPhase` SHALL contain the latest acknowledged terminal result, not active-run identity or live process state. `activeRunId`, ownership generation, provisional parser progress, and attachment state SHALL remain session-only. `mostRecentConfig` SHALL continue to represent the configuration captured for the import attempt and SHALL be committed as the successful freshness baseline only when the authoritative run result is reconciled.

#### Scenario: Starting import captures configuration

- **WHEN** a native run reservation succeeds for the current configuration
- **THEN** the store SHALL retain that attempt snapshot and enter the lifecycle reported by the reserved run without claiming completion

#### Scenario: Parser emits global completion

- **WHEN** an attached run emits global completion text while its native lifecycle remains `Running`
- **THEN** the store SHALL remain nonterminal

#### Scenario: Native completed snapshot arrives

- **WHEN** the store accepts a matching `Completed` snapshot whose selected subjects committed
- **THEN** it SHALL set completed progress, `importPhase = "completed"`, and `importCompleted = true` before synchronizing project state

#### Scenario: Native failed snapshot follows prior project completion

- **WHEN** a matching rerun terminates `Failed`
- **THEN** the store SHALL set `importPhase = "failed"` and `importCompleted = false` while preserving per-subject committed evidence reported by native state

### Requirement: Subject error detail matching

When import failure output is parsed, native diagnostics SHALL match the description against the run's immutable selected subject list. For each matching subject, the full message line following the failure pattern (e.g., `Message: ...`) SHALL be captured as error detail in a run-correlated diagnostic. The store MAY display that detail provisionally, but only authoritative native snapshots SHALL classify subject failure or completion.

#### Scenario: Subject name with underscores in failure description

- **WHEN** stderr contains `NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1` and known subjects include "BADDIE"
- **THEN** subject "BADDIE" is matched because "BADDIE" appears in the description string, error detail captures the subsequent `Message:` line

#### Scenario: Multiple subjects in single failure line

- **WHEN** a failure line references multiple subjects
- **THEN** each matching selected subject SHALL receive the same diagnostic error detail without the parser independently choosing its terminal outcome

### Requirement: ImportProgress table population

The progress table SHALL be populated from authoritative artifact reconstruction when no unacknowledged run is attached and from the matching native run snapshot while one exists. Subject-start, conversion-status, warning, and parser-failure events MAY enrich provisional running details for the attached run. Subject-completion and global-completion parser events SHALL NOT set authoritative `completed` status. A subject SHALL display completed only after native verification reports it eligible and committed, or after project artifact reconstruction verifies its committed completion evidence.

#### Scenario: Table shows all subjects during preparation

- **WHEN** a reserved run enters `Preparing`
- **THEN** the table SHALL list its immutable selected subjects as pending before process output arrives

#### Scenario: Subject completion output arrives early

- **WHEN** a subject-completion parser event arrives while the native snapshot remains `Running`
- **THEN** the row SHALL remain provisional and SHALL not become authoritatively completed

#### Scenario: Final snapshot reconciles rows

- **WHEN** native finalization reports committed, failed, cancelled, or interrupted subject outcomes
- **THEN** the table SHALL replace provisional states with those authoritative outcomes

#### Scenario: Table shows all subjects before MATLAB starts

- **WHEN** the reserved run enters `Preparing`
- **THEN** the progress table SHALL list every selected subject as pending before process output arrives

#### Scenario: Subject starts processing

- **WHEN** a matching run event reports subject `GOOD` started
- **THEN** its provisional row SHALL transition from pending to running without changing terminal authority

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

Opening a project SHALL first reset the complete import runtime slice, then hydrate validated project values, then reconcile any native replayable import run before controls become available. Missing optional mapping or UI fields SHALL apply defaults. Session-only logs, parser errors, provisional progress, run identity, and listener state SHALL not leak from a prior project. Persisted `preparing`, `running`, `finalizing`, or `cancelling` phases SHALL not be trusted without a matching native run.

#### Scenario: Persisted running phase has no native run

- **WHEN** a project hydrates with a legacy nonterminal phase but native discovery finds no matching run or recovery record
- **THEN** runtime state SHALL normalize to `interrupted` or `idle` as reported by native reconciliation and SHALL not claim active work

#### Scenario: Terminal replay overrides stale persistence

- **WHEN** project persistence says running or failed but native discovery returns a matching replayable completed run
- **THEN** the store SHALL reconcile to completed and persist that exact terminal result before acknowledgement

#### Scenario: Sparse project follows populated import state

- **WHEN** project A has attached run state, logs, and progress and project B omits optional import fields
- **THEN** project B SHALL expose defaults plus only its own native reconciliation result and SHALL contain none of A's state

#### Scenario: Persisted import state belongs to project B

- **WHEN** project B contains valid persisted import mapping and terminal UI state
- **THEN** hydration SHALL expose B's values plus only B's native reconciliation and SHALL retain no project-A runtime fields

### Requirement: Import run discovery and attachment reconciliation

The import store SHALL expose typed discovery, attachment, launch, cancellation, and acknowledgement clients. On Import Step 5 entry or route remount, it SHALL install one run-scoped listener set, discover native work for the active project, bind the returned run identity, and perform a post-listener attachment read. It SHALL accept updates only for the bound run and current ProjectLease. A terminal snapshot SHALL remain correlated through project synchronization and save; acknowledgement SHALL occur only after that exact terminal result persists successfully.

#### Scenario: WebView reloads during running import

- **WHEN** native ownership remains `Running` after frontend runtime state is reset
- **THEN** discovery and attachment SHALL restore the running phase and subject progress without starting another run

#### Scenario: Run exits during attachment

- **WHEN** exit occurs between discovery and the post-listener attachment read
- **THEN** the later snapshot SHALL reconcile `Finalizing` or terminal state and no completion shall be missed

#### Scenario: Delayed old snapshot arrives

- **WHEN** a snapshot belongs to another run or an expired ProjectLease
- **THEN** the store SHALL discard it without changing progress, phase, persistence, or controls

#### Scenario: Terminal save and acknowledgement succeed

- **WHEN** a matching terminal snapshot is synchronized and saved successfully
- **THEN** the store SHALL acknowledge that run and retain the persisted terminal UI state
