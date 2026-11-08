## Purpose

Define import progress state, parsing, and persistence behavior.

## Requirements

### Requirement: Portable staging identifier validation

Import staging identifiers SHALL satisfy the shared portable component, source-provenance, and uniqueness contract without silent correction; session-only preflight results SHALL require current request, plan, and lease authority.

#### Scenario: Saved or edited staging identifiers undergo preflight

- **WHEN** identifiers or native preflight results are evaluated before execution
- **THEN** validation, collision handling, explicit correction, and response admission SHALL follow these rules:

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

Import progress SHALL support the specified lifecycle and optional diagnostic fields without implying that parsers or snapshot reconciliation populate every supported field.

#### Scenario: Parser events and snapshots populate subject progress

- **WHEN** import progress is updated from supported event sources
- **THEN** schema values and runtime population limits SHALL satisfy this contract:

The `ImportProgress` type in the import store SHALL support optional `currentStep` and `errorStep` values of `"DCM2NII" | "NII2BIDS"`, `error?: string`, `warnings?: string[]`, `duration?: number` (seconds), and `stale?: boolean`. The `status` field SHALL support values: `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`, `"interrupted"`. Schema support SHALL NOT imply runtime population: current parser handling SHALL set `currentStep` from subject-start events and provisional `error` text from failure events, but SHALL NOT copy the failure event's step into `errorStep` or populate per-subject `warnings` or `duration`. Native snapshot reconciliation SHALL supply authoritative status and available error detail, not those optional diagnostic fields.

#### Scenario: Subject fails at NII2BIDS step

- **WHEN** a matching native snapshot reports subject BADDIE failed verification after an NII2BIDS diagnostic failure
- **THEN** `importProgress["BADDIE"].status` SHALL become `"failed"` with the available failure detail; the diagnostic event alone SHALL NOT classify the terminal outcome

#### Scenario: Subject succeeds without collected warning or duration fields

- **WHEN** stdout contains warnings, the native parser emits subject-completion duration, and a matching native snapshot later reports subject GOOD committed, with no preexisting warning or duration fields
- **THEN** `importProgress["GOOD"].status` SHALL become `"completed"`, but `warnings` and `duration` SHALL remain absent because the current progress path does not collect them

#### Scenario: Failure diagnostic does not record a failure step

- **WHEN** a running subject has `currentStep = "DCM2NII"`, no `errorStep`, and a matching `import_failed` event reports step `"NII2BIDS"`
- **THEN** the store SHALL record the diagnostic message without changing status, SHALL retain `currentStep = "DCM2NII"`, and SHALL leave `errorStep` absent; terminal status SHALL remain native-snapshot-owned

#### Scenario: Subject cancelled by user

- **WHEN** native cancellation settles and a matching snapshot reports subject INPROGRESS cancelled
- **THEN** `importProgress["INPROGRESS"].status` SHALL become `"cancelled"`; clicking Stop alone SHALL NOT claim cancellation

#### Scenario: Stale subject on re-visit

- **WHEN** the user navigates to step 5 after changing a metadata group parameter and `read_import_status` returns a completed subject whose first current subject row belongs to that changed group
- **THEN** `importProgress["sub-001"].stale` is set to `true`

#### Scenario: Fresh subject on re-visit

- **WHEN** the user navigates to step 5 after a successful import with no config changes
- **THEN** `importProgress["sub-001"].stale` is `false` (or absent, which is falsy)

### Requirement: Import store additions

The import store SHALL project attached native lifecycle and outcomes, retain configuration and review state, and persist only acknowledged terminal UI state and the successful attempt baseline.

#### Scenario: Import state is reconciled or persisted

- **WHEN** matching native snapshots update active import presentation
- **THEN** authoritative projection and session-versus-persisted boundaries SHALL follow these rules:

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

Import rows SHALL derive completion from matching native committed outcomes or safe committed-artifact reconstruction, allowing only supported parser events to enrich provisional diagnostics.

#### Scenario: Import table rows receive events or reconstructed status

- **WHEN** a run is attached or committed artifacts are audited
- **THEN** row-population sources and excluded parser authority SHALL follow these rules:

The progress table SHALL be populated from authoritative artifact reconstruction when no unacknowledged run is attached and from the matching native run snapshot while one exists. Only subject-start and parser-failure structured events SHALL enrich provisional row details for the attached run; conversion-status, subject-completion (including duration), and global-completion events SHALL NOT populate subject progress, and stdout warnings SHALL NOT be collected into per-subject warnings. Parser events SHALL NOT set authoritative `completed` status. A subject SHALL display completed only after native verification reports it eligible and committed, or after project artifact reconstruction verifies its committed completion evidence.

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

### Requirement: BIDS review slice for scan lifecycle

The session-only BIDS review slice SHALL manage scan results, errors, retries, and resets without duplicating the persisted project's confirmation authority.

#### Scenario: A BIDS scan starts, retries, or revisits confirmed state

- **WHEN** import review actions manage scan lifecycle
- **THEN** fields, action behavior, and persistence boundaries SHALL satisfy this shape:

`importStore` SHALL add a `BidsReviewState` slice with:

- `scanComplete: boolean`
- `scanError: string | null`
- `detectedGroups: DerivedMetadataGroup[]`
- `skippedSubjects: string[]` (session-only copy; persisted version lives in `uiState.import.skippedSubjects`)

Actions:

- `startBidsScan(rootPath: string)`: invokes `scan_bids_sidecars`, populates `detectedGroups` and `skippedSubjects` on success
- `setDetectedGroups(groups)`: syncs the result of a scan
- `retryBidsScan(rootPath: string)`: clears `scanError` and re-invokes `scan_bids_sidecars`
- `rescanConfirmedBidsProject(rootPath: string)`: starts a fresh scan for an already-confirmed BIDS project without clearing persisted project mapping state
- `backToLanding()`: resets BIDS review state; the calling component navigates to `/`
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

DICOM sources SHALL distinguish project-relative internal locations from absolute external locations. Raw entries SHALL be source-relative and resolve to absolute paths only at runtime. Source selection and relinking SHALL establish this representation before configuration acceptance. Older absolute internal-source/raw-path repair SHALL not be supported. BIDS sources SHALL resolve to the current project root without consulting a former root.

#### Scenario: User selects DICOM folder inside project

- **WHEN** the chosen source is inside the active project
- **THEN** its accepted source reference SHALL be project-relative and raw entries SHALL move with it

#### Scenario: User selects external DICOM folder

- **WHEN** the chosen source is outside the project
- **THEN** its source reference SHALL be absolute and raw entries SHALL remain source-relative

### Requirement: Missing DICOM source and relinking

Unavailable DICOM sources SHALL preserve saved projects and disable only dependent work, with confirmed structural comparison governing compatible relinking or source-dependent resets through shared autosave.

#### Scenario: A saved DICOM source is missing or replaced

- **WHEN** source availability or a replacement scan is evaluated
- **THEN** access, guidance, preserved mappings, confirmation, and cancellation SHALL follow these rules:

A missing/unreadable source SHALL preserve saved configuration and allow project opening after existing execution-profile gating. Source-dependent actions SHALL remain disabled with persistent Relink guidance. Replacement scanning SHALL compare path structure before acceptance. Compatible replacements SHALL preserve mappings and update current/successful-snapshot source identities together; incompatible replacements SHALL explain source-dependent resets and require confirmation. Accepted relinks SHALL use shared autosave; cancelled selections or declined resets SHALL leave configuration unchanged.

#### Scenario: External DICOM source is missing

- **WHEN** a saved external source cannot be read
- **THEN** project opening SHALL preserve source/mappings and show Relink guidance

#### Scenario: Replacement structure matches

- **WHEN** the selected readable replacement matches saved structure
- **THEN** its source reference SHALL replace the unavailable reference, preserve compatible setup, and schedule shared autosave

#### Scenario: Replacement structure differs

- **WHEN** replacement structure differs
- **THEN** no configuration SHALL change before reset confirmation

#### Scenario: User confirms changed DICOM source

- **WHEN** incompatible replacement is confirmed
- **THEN** only source-dependent raw paths, patterns, tokens, and incompatible mappings SHALL reset through one accepted autosaved edit

#### Scenario: User cancels DICOM relink

- **WHEN** selection or reset confirmation is cancelled
- **THEN** source and import configuration SHALL remain unchanged

### Requirement: Complete import hydration

Opening SHALL reset transient import state, expose accepted current configuration, and reconcile native work before controls become available. Missing optional mapping/UI fields SHALL use current defaults. Logs, parser errors, provisional progress, run identity, and listeners SHALL never leak from another lifecycle. Persisted UI phase SHALL not independently authorize running work. Eligible terminal evidence SHALL update saved configuration natively before the frontend presents it as reconciled.

#### Scenario: Persisted running phase has no native run

- **WHEN** saved phase hints conflict with absence of native run ownership
- **THEN** controls SHALL use native reconciliation and SHALL not claim active execution from configuration alone

#### Scenario: Terminal replay overrides stale persistence

- **WHEN** native evidence identifies an eligible completed result absent from saved configuration
- **THEN** native reconciliation SHALL persist completion before acknowledgement and display the accepted result

#### Scenario: Sparse project follows populated import state

- **WHEN** sparse B replaces populated A
- **THEN** B SHALL expose only its accepted settings, current defaults, and its own native work

#### Scenario: Persisted import state belongs to project B

- **WHEN** B supplies saved import configuration
- **THEN** its displays SHALL use B's accepted values without a separately editable persisted mirror

### Requirement: Import run discovery and attachment reconciliation

Import attachment SHALL reconcile typed native snapshots after listener setup, reject stale identities, and persist terminal metadata through exact native reconciliation before acknowledgement.

#### Scenario: Step entry discovers and attaches to native import

- **WHEN** discovery, events, or terminal reconciliation update presentation
- **THEN** typed clients, identity checks, persistence, and replay retention SHALL follow these rules:

Import presentation SHALL retain typed discovery, attachment, launch, cancellation, and exact-run acknowledgement clients. Step entry SHALL install run-scoped listeners and perform discovery plus a post-listener snapshot read. Updates SHALL require current run and activation identities. The frontend SHALL not derive or save terminal project metadata; a native exact-run reconciliation operation SHALL persist that metadata before acknowledgement. Persistence failure SHALL retain replay and expose an error.

#### Scenario: WebView reloads during running import

- **WHEN** native ownership remains Running after renderer reset
- **THEN** discovery SHALL restore presentation without launching another worker

#### Scenario: Run exits during attachment

- **WHEN** exit occurs between discovery and attachment read
- **THEN** the later snapshot SHALL expose finalization or terminal state

#### Scenario: Delayed old snapshot arrives

- **WHEN** an event belongs to another run or expired activation
- **THEN** it SHALL not change progress, controls, or configuration

#### Scenario: Terminal save and acknowledgement succeed

- **WHEN** native exact-run reconciliation persists terminal metadata successfully
- **THEN** that run SHALL acknowledge and the frontend SHALL expose the persisted result

### Requirement: Current parameter configuration

Project parameters SHALL use flat optional validated current-contract fields, preserve loose JSON extensions, and retain existing scientific assembly and advanced-visibility placement without legacy nested repair.

#### Scenario: Current parameter configuration is loaded, edited, or assembled

- **WHEN** project state crosses configuration or persistence boundaries
- **THEN** unset values, validation, extensions, and supported visibility representation SHALL follow these rules:

Project parameter state SHALL use the shared current configuration contract, with flat optional ExploreASL keys under `dataPar`. Unset fields SHALL remain absent; known invalid values SHALL be rejected; loose extension JSON SHALL survive unchanged. Runtime processing assembly SHALL retain its existing scientific key placement. Advanced visibility SHALL persist under `uiState.datapar.advancedVisibility`; obsolete nested-project repair and the old `showAdvancedParameters` representation SHALL not be supported.

#### Scenario: Current project contains empty dataPar

- **WHEN** current configuration contains `dataPar: {}`
- **THEN** controls SHALL show UI placeholders without persisting scientific defaults

#### Scenario: Current project contains flat parameters

- **WHEN** current configuration contains `dataPar.Lambda: 0.9`
- **THEN** the editor SHALL display 0.9 and processing assembly SHALL retain its operative destination

#### Scenario: Toggle state persists across sessions

- **WHEN** advanced visibility changes and autosave completes
- **THEN** reopening SHALL restore `uiState.datapar.advancedVisibility`
