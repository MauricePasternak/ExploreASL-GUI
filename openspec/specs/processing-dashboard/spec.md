# processing-dashboard Specification

## Purpose

Define the processing route, dashboard, and access behavior.

## Requirements

### Requirement: Processing Route and Gating

Processing route access SHALL follow native saved-cursor and source-specific readiness eligibility, redirect denied access to the saved phase, and remain distinct from execution authorization.

#### Scenario: A project enters the Processing route

- **WHEN** route access evaluates native allowed phases
- **THEN** path, cursor access, readiness, and redirection SHALL follow these rules:

The processing route SHALL be `/project/:id/processing`. Access SHALL use `canAccessPhase`, which checks native `allowedPhases`. Native access SHALL include Processing when the saved `projectMeta.currentPhase` is Processing or a later phase, OR when import readiness holds: `project.uiState.import.completed === true` for DICOM projects or `project.uiState.import.bidsReviewConfirmed === true` for BIDS-direct projects. Denied access SHALL redirect to the saved current phase (Import or Parameters), not unconditionally to Import. Route access SHALL NOT itself authorize execution.

#### Scenario: Access before import completion

- **WHEN** the user navigates to `/project/:id/processing` with saved current phase Import and without applicable import readiness
- **THEN** the app SHALL redirect to `/project/:id/import`

#### Scenario: Denied Processing access preserves Parameters route

- **WHEN** the saved current phase is Parameters and applicable import readiness is false
- **THEN** navigation to Processing SHALL redirect to `/project/:id/parameters`

#### Scenario: Saved later phase retains Processing access

- **WHEN** the saved current phase is Processing, Visualization or Manifest, even without the applicable import readiness flag
- **THEN** `allowedPhases` SHALL include Processing and route access SHALL remain available

### Requirement: Subject Selection DataTable

Processing SHALL provide selectable and filterable subject/session rows with module-status-driven log badges, keeping per-file modal error flags separate from table badge classification.

#### Scenario: Subject selection displays module status and log actions

- **WHEN** discovered subject/session rows render in the processing table
- **THEN** columns, filtering, selection, badges, and modal flags SHALL follow these rules:

The processing page SHALL display a Mantine DataTable with checkboxes for subject/session selection. Columns SHALL include: checkbox, subject, session, Structural status icon, Structural Logs/Errors, ASL status icon, ASL Logs/Errors. Above the table, filter chips SHALL allow filtering by status: All, Pending, Incomplete, Complete. "Select all" and "Deselect all" buttons SHALL be provided.

The Structural and ASL Logs/Errors columns SHALL use module display status, not log `hasError`, to render as follows:

- **Module skipped**: empty cell (no content)
- **Module incomplete, with or without a log file**: red `Badge` with text "View Errors", clickable to open LogViewerModal
- **Module pending, complete or outdated, with a log file**: teal `Badge` with text "View Logs", clickable to open LogViewerModal, even when a log reports `hasError: true`
- **Module pending, complete or outdated, without a log file**: grey text "No Logs"

Within the subject log modal, per-file error markers SHALL use `hasError || moduleIncomplete`; this SHALL NOT change the table badge rule.

#### Scenario: Status icons reflect lock file state

- **WHEN** a SubjectSession has `999_ready.status` for Structural module
- **THEN** the Structural status column SHALL show a green checkmark icon

#### Scenario: ASL module unavailable for subject

- **WHEN** a discovered SubjectSession has `hasASL: false`, including an empty or absent `perf/` directory
- **THEN** the ASL status column SHALL show a "skipped" icon and the ASL Logs/Errors column SHALL show an empty cell

#### Scenario: Filter by incomplete

- **WHEN** the user clicks the "Incomplete" filter chip
- **THEN** the table SHALL show only SubjectSessions where at least one module has status "incomplete"

#### Scenario: Incomplete ASL module without detected log errors

- **WHEN** ASL display status is incomplete for subject "sub-001" session "01", even if its log reports `hasError: false`
- **THEN** the ASL Logs/Errors column for that row SHALL display a red Badge labeled "View Errors"

#### Scenario: Completed Structural module with detected log errors

- **WHEN** Structural display status is complete and a log file exists for subject "sub-001" session "01", even if it reports `hasError: true`
- **THEN** the Structural Logs/Errors column for that row SHALL display a teal Badge labeled "View Logs"

#### Scenario: Non-incomplete module without a log file

- **WHEN** Structural display status is pending, complete or outdated and `list_module_logs` returns no entries for subject "sub-001" session "01" for that module
- **THEN** the Structural Logs/Errors column for that row SHALL display grey text "No Logs"

#### Scenario: Incomplete module without a log file

- **WHEN** Structural or ASL display status is incomplete and no corresponding log file exists
- **THEN** its Logs/Errors column SHALL still display a clickable red "View Errors" badge

#### Scenario: Skipped module shows nothing

- **WHEN** a subject session has `hasStructural: false`
- **THEN** the Structural Logs/Errors column for that row SHALL show an empty cell

#### Scenario: Population column removed

- **WHEN** the Subject Selection DataTable renders
- **THEN** no Population status column SHALL appear in the table

### Requirement: Pipeline Configuration Panel

Pipeline configuration SHALL expose profiles, compatible modules, and workers with the specified memory-based default and renderer-only core-count limits.

#### Scenario: Processing configuration initializes worker selection

- **WHEN** available memory and CPU information populate the configuration panel
- **THEN** controls, worker default, fallback, and input bounds SHALL follow these rules:

The pipeline configuration panel SHALL include: Profile selector dropdown (populated from global settings `executionProfiles`), module checkboxes (Structural, ASL — at least one required unless Population is selected), and worker count number input. For positive reported available memory, the default SHALL be `Math.min(Math.floor(availableMemoryMb / (1024 * 4)), cpuCores, 4)` without a minimum-one clamp. Unavailable or nonpositive memory SHALL use the fallback default of 4. The input SHALL have minimum 1 and maximum `cpuCores || 4`; renderer preflight SHALL reject counts exceeding known available cores.

#### Scenario: Available memory below 4 GB

- **WHEN** positive available memory is below 4096 MB
- **THEN** the calculated default SHALL be zero, not rounded up to one; initialization of a missing configuration SHALL remain deferred while that default is zero

#### Scenario: Population module not shown

- **WHEN** the Pipeline Configuration Panel renders
- **THEN** no Population checkbox SHALL appear

#### Scenario: No valid profiles configured

- **WHEN** global settings has no valid execution profiles
- **THEN** the profile selector dropdown SHALL show an error state and the Start button SHALL be disabled

#### Scenario: Worker input has no Population-specific lock

- **WHEN** Population is selected in the Population Analysis section
- **THEN** PipelineConfig SHALL NOT add a Population-specific disabled state or maximum to the worker input; accepted project configuration edits SHALL normalize workers to 1, and renderer preflight SHALL hard-block any Population configuration whose worker count is not 1

### Requirement: Pre-flight Validation

Renderer preflight SHALL distinguish blocking readiness conditions, advisory warnings, and informational status without redefining native admission or filling unaccepted scalar choices.

#### Scenario: Renderer evaluates readiness before Start

- **WHEN** selected work, profile, workers, and parameter choices are checked
- **THEN** hard blocks, warnings, worker capping, and module display SHALL follow these rules:

Before Start, renderer preflight SHALL determine readiness using the following hard blocks, soft warnings and informational display rules. The store SHALL separately validate request/profile inputs before reservation; these renderer readiness rules SHALL NOT be described as native admission guarantees.

**Hard blocks (cannot proceed):**

1. At least one SubjectSession selected (relaxed when the only selected module is Population — group-level module)
2. At least one module selected
3. Selected profile is valid (resolved from `executionProfiles`, checked in `profileValidationState`)
4. Worker count > 0 and ≤ available cores when the core count is known
5. If Population selected, worker count must be 1
6. If ASL is selected, no selected discovered SubjectSession has `hasASL: false`; one such entry SHALL block the entire run, including selected Structural work
7. Every scoped scalar switch has an accepted value; missing choices SHALL show actionable guidance to review and confirm proposed explicit choices in Parameters, without changing route access or filling defaults

**Soft warnings (can proceed):**

- Configured worker count exceeds the number of explicitly selected SubjectSessions; the immutable renderer request SHALL cap workers to that selection count when it is nonzero
- Non-Population lock entries have no matching discovered SubjectSession, as defined by Rawdata Sanity Check

Missing `derivatives/ExploreASL/dataPar.json` SHALL NOT by itself produce a renderer warning or imply ExploreASL default-parameter behavior; native preparation SHALL install the reserved configuration.

**Informational display:**

- The table SHALL mark modules "skipped" from discovered `hasASL`/`hasStructural` flags, not directory existence alone. Native expected targets SHALL omit unavailable per-subject modules, but the skipped ASL display SHALL NOT bypass the renderer's whole-run missing-ASL hard block.

#### Scenario: Missing valid profile

- **WHEN** no valid execution profiles exist or the selected profile is invalid
- **THEN** a hard block error SHALL be displayed directing the user to configure a valid profile in Settings

#### Scenario: Zero subjects selected

- **WHEN** no subjects are checked in the DataTable AND modules contain Structural or ASL
- **THEN** the Start button SHALL be disabled with message "Select at least one subject"

#### Scenario: Population-only run with no subjects selected

- **WHEN** modules is exactly `["population"]` AND no subjects are checked
- **THEN** empty subject selection SHALL NOT block Start, provided all other readiness and native ownership gates permit it (Population is group-level)

#### Scenario: Selected ASL-unavailable session blocks the whole run

- **WHEN** ASL is selected and any explicitly selected discovered SubjectSession has `hasASL: false`, including when Structural is also selected
- **THEN** renderer preflight SHALL disable Start and identify the sessions lacking ASL data, despite their skipped table display

#### Scenario: Missing dataPar.json alone does not warn

- **WHEN** `derivatives/ExploreASL/dataPar.json` doesn't exist
- **THEN** renderer preflight SHALL NOT show a missing-dataPar warning or block Start solely for that absence

### Requirement: Execution Dashboard

The attached active run SHALL display module-grouped progress and eligible subject/run timelines without standalone elapsed/current-step fields, retaining terminal results through existing status UI after the dashboard hides.

#### Scenario: Native processing lifecycle updates the active dashboard

- **WHEN** the attached run is preparing, executing, settling, or terminal
- **THEN** sections, row scope, timeline presentation, and visibility SHALL follow these rules:

The execution dashboard SHALL display module-grouped collapsible sections for Structural, ASL, and Population. Each section SHALL show module-level progress. Structural and ASL sections SHALL show one row per selected eligible SubjectSession; Population SHALL show one study-level row. Rows SHALL display the subject/session identifier and applicable Running/Done status badges. Single-run rows SHALL show timeline icons with step-name tooltips; multi-run ASL rows SHALL show a completion summary and expandable run timelines. Rows SHALL not show standalone current-step or elapsed-time text fields. The dashboard SHALL render only information admitted for the attached native `runId`.

The active dashboard SHALL remain visible during `preparing`, `running`, `finalizing`, and `cancelling`. It SHALL be hidden after `completed`, `failed`, `cancelled`, or `interrupted`, while the terminal result remains available through existing status/error UI. Controls and labels SHALL reflect the attached native lifecycle rather than a frontend-inferred worker count.

#### Scenario: Structural module section expanded

- **WHEN** the user expands Structural during an attached active run
- **THEN** one row per selected eligible SubjectSession SHALL show its subject/session identifier, step timeline and applicable Running/Done badge for that run only, without separate current-step or elapsed-time fields

#### Scenario: ASL module with multiple runs

- **WHEN** the attached run has ASL progress for `ASL_1` and `ASL_2` under one SubjectSession
- **THEN** its ASL row SHALL show sub-rows for each ExploreASL ASL run

#### Scenario: Finalizing remains visible

- **WHEN** native workers have exited and the attached run is `Finalizing`
- **THEN** the active dashboard SHALL remain visible while final status is reconciled

#### Scenario: Stale progress hidden

- **WHEN** a progress event belongs to an obsolete run ID
- **THEN** no row, summary, phase, or terminal message SHALL change

### Requirement: Start and Kill Controls

Start SHALL require free native admission and exact reservation binding; Stop and recovery actions SHALL target only the attached run, while lifecycle—not recovery action alone—controls configuration visibility.

#### Scenario: Processing controls evaluate active or terminal ownership

- **WHEN** the user edits selections, starts work, stops, or performs recovery
- **THEN** admission gates, immutable requests, stale responses, and available controls SHALL follow these rules:

Start SHALL be available only when native admission is free, including completed terminal save/acknowledgement, interruption confirmation, and cleanup. A terminal snapshot alone SHALL NOT unlock replacement execution. Start SHALL build a pure request and bind the current reservation response; historical replay SHALL NOT become the attached run. Preparing, Running, Finalizing, Cancelling, `confirmStopped`, and `retryCleanup` SHALL block duplicate Start. Configuration visibility SHALL follow lifecycle: Preparing, Running, Finalizing and Cancelling SHALL hide the configuration form; Idle and terminal phases, including Interrupted, SHALL expose editable selections subject to ordinary field restrictions. Recovery action alone SHALL NOT impose an additional configuration lock. Edits SHALL NOT replace the immutable reserved request or authorize execution. Stop, confirmation, and cleanup retry SHALL invoke only the attached run's exact native action. Stale responses SHALL NOT alter another run. No separate Pause or Restart control SHALL be added.

#### Scenario: Interrupted configuration remains editable

- **WHEN** an Interrupted run exposes `confirmStopped`
- **THEN** subject, profile, module and worker configuration SHALL remain viewable and editable under ordinary field restrictions, while Start and terminal acknowledgement remain blocked pending exact native confirmation
- **AND** edits SHALL NOT change the interrupted run's immutable request or recovery policy

#### Scenario: Cleanup retry retains lifecycle-based form visibility

- **WHEN** an active native lifecycle exposes `retryCleanup`
- **THEN** Start SHALL remain blocked and configuration SHALL remain hidden by the active phase, not by a separate action-specific disabled state

#### Scenario: Terminal snapshot awaits acknowledgement

- **WHEN** native terminal execution is settled but presentation metadata save or acknowledgement remains incomplete
- **THEN** Start SHALL remain blocked and the UI SHALL display the persistence/recovery action

#### Scenario: Kill button

- **WHEN** the user requests Stop for an attached run whose native action permits it
- **THEN** the UI SHALL request exact-run cancellation and project native snapshots without choosing a terminal outcome

#### Scenario: Confirmation button

- **WHEN** the user accepts the external-stop warning for an exact interrupted run
- **THEN** the UI SHALL send that run ID and revision once and project only the returned increasing native snapshot

#### Scenario: Start button transitions

- **WHEN** the user clicks Start after validation and native replacement admission permits it
- **THEN** the UI SHALL obtain and bind the current reservation before displaying its Preparing state

#### Scenario: Concurrent start rejected

- **WHEN** reservation reports existing native ownership or an unacknowledged terminal run
- **THEN** duplicate preparation SHALL NOT begin and the UI SHALL attach or report the existing authority without clearing it

#### Scenario: Obsolete action response

- **WHEN** a Stop, confirmation, or cleanup response for an old run arrives after another run is attached
- **THEN** the response SHALL NOT unlock, cancel, confirm, or otherwise mutate the new run

#### Scenario: Obsolete kill response

- **WHEN** a Stop response for an old run arrives after another run is attached
- **THEN** the response SHALL NOT unlock, cancel, or otherwise mutate the new run

### Requirement: Rawdata Sanity Check

After subject and historical lock discovery, renderer preflight SHALL include a warning for distinct non-Population lock SubjectSessions absent from `availableSubjects`. The status alert SHALL display warnings when a selection exists and no hard-block errors take priority. Comparison SHALL use the data-source-specific inventory (DICOM `rawdata/`, BIDS-direct project root). Empty or absent `rawdata/` alone SHALL NOT produce a dedicated warning without orphaned entries.

#### Scenario: Orphaned lock entries

- **WHEN** `read_lock_status` returns non-Population SubjectSessions absent from discovered subjects
- **THEN** preflight warnings SHALL report the distinct orphan count and up to five SubjectSession identifiers, with a remaining-count suffix when needed

#### Scenario: Empty rawdata without orphaned locks

- **WHEN** `rawdata/` is empty and no non-Population lock entries lack a matching discovered SubjectSession
- **THEN** no dedicated empty-rawdata or orphan warning SHALL appear; ordinary selection validation SHALL still apply

### Requirement: Re-run Flow

Processing re-runs SHALL use journaled selected-status/log quarantine and project-wide stale-lock handling before spawn, never deleting scientific outputs during launch preparation or recovery.

#### Scenario: Selected work is reprocessed

- **WHEN** native preparation handles previously processed subjects or modules
- **THEN** quarantine scope and scientific-output preservation SHALL follow these rules:

Starting selected work (including confirmed reprocessing of completed subjects) SHALL invoke native journaled quarantine of selected module/subject `.status` files and logs before spawning workers. Stale `locked` directories SHALL use the backend's project-wide scope, not the status/log selection filter. Pre/post-commit recovery SHALL follow Durable processing execution boundary. Subject scientific-output directories SHALL NOT be deleted by launch preparation or recovery — ExploreASL overwrites as needed.

#### Scenario: Re-running completed subject

- **WHEN** the user selects a subject with `999_ready.status` for Structural and confirms reprocessing with Structural checked
- **THEN** native preparation SHALL quarantine that subject's Structural `.status` files before worker launch, allowing reprocessing from the beginning of the Structural module without deleting scientific outputs

### Requirement: QC metric labels are resolved in the renderer

The report viewer SHALL derive human-readable QC labels from the metric key using the frontend QC-label dictionary. Unknown keys SHALL use the frontend's title-case fallback formatter. It SHALL consume native key/value measures without requiring a backend display-label field.

#### Scenario: Known QC metric is displayed

- **WHEN** the report viewer receives a metric key found in the QC-label dictionary
- **THEN** it SHALL display that dictionary label with the native value

#### Scenario: Unknown QC metric is displayed

- **WHEN** the report viewer receives `unknown_metric_key` without a label field
- **THEN** it SHALL display `Unknown Metric Key` with the native value

### Requirement: ASL Run Display

For ASL module rows, run sub-rows SHALL only be displayed when a SubjectSession has more than one ASL run, combining discovered run IDs with status entries. When there is exactly one run, the ASL row SHALL display progress inline without sub-rows.

#### Scenario: Single ASL run

- **WHEN** a SubjectSession has only `xASL_module_ASL_ASL_1` in its lock directory
- **THEN** the ASL row SHALL show progress directly without expandable sub-rows

#### Scenario: Multiple ASL runs

- **WHEN** a SubjectSession has `xASL_module_ASL_ASL_1` and `xASL_module_ASL_ASL_2`
- **THEN** the ASL row SHALL be expandable to show sub-rows for each run

### Requirement: Population Lock Structure

Population module lock files SHALL be read from `lock/xASL_module_Population/xASL_module_Population/` (study-level, no subject subdirectory). This differs from Structural and ASL which use `lock/xASL_module_<Module>/sub-X_Y/xASL_module_<Module>/`. The `read_lock_status` command and lock file watcher SHALL handle all three structures correctly.

#### Scenario: Population status file created

- **WHEN** `010_CreatePopulationTemplates.status` is created under `xASL_module_Population/xASL_module_Population/`
- **THEN** the event SHALL have `subject_session: undefined` and `module: "population"` and `run: undefined`

### Requirement: Attached Run Presentation

Processing routes SHALL consume coordinated project-level native attachment without becoming recovery or launch owners, distinguishing live native supervision from historical presentation and restarted Interrupted state.

#### Scenario: The renderer enters or reloads the Processing route

- **WHEN** project activation or route re-entry reconciles native run state
- **THEN** attachment, listener ownership, historical progress, and restart handling SHALL follow these rules:

Project activation SHALL reconcile durable native execution and terminal replay before processing route presentation. Route entry SHALL consume that coordinated attachment without launching workers or becoming a second recovery owner. Persisted active-looking UI phases and historical lock files SHALL NOT prove current execution. If no current native run exists, historical progress MAY be displayed separately from live activity. Attachment/listener ownership SHALL avoid duplication across route re-entry. Renderer reload while native supervision remains alive SHALL attach to the existing run; native restart with a nonterminal record SHALL attach Interrupted confirmation state instead.

#### Scenario: Route re-entry during current run

- **WHEN** the processing route remounts after activation attached a native run
- **THEN** it SHALL project that attachment without duplicate workers, finalization, or recovery coordination

#### Scenario: Persisted running phase without native run

- **WHEN** saved UI state says running but activation finds no current native run or durable interrupted record
- **THEN** the dashboard SHALL NOT present historical lock state as active worker execution

### Requirement: Native recovery action presentation

Processing SHALL expose only the exact native snapshot's permitted resource action and actionable logical progress, keeping replacement Start blocked until ownership settles and hiding private process and transaction internals.

#### Scenario: A native snapshot offers stop, cleanup, confirmation, or acknowledgement

- **WHEN** processing recovery controls render or are invoked
- **THEN** one-shot actions, admission gates, error guidance, and excluded controls SHALL follow these rules:

Processing controls SHALL use the exact snapshot's available action. `stop` SHALL request cancellation once, `retryCleanup` SHALL retry native cleanup once, `confirmStopped` SHALL display explicit abnormal-crash guidance and require user confirmation once, `acknowledge` SHALL be coordinated through terminal persistence, and `none` SHALL disable resource actions. Start SHALL remain blocked while native ownership, interruption confirmation, cleanup, or unacknowledged terminal persistence prevents replacement.

Controls SHALL display logical worker progress and actionable errors without exposing PIDs, process-group IDs, Job handles, journal destinations, or transaction internals. A committed startup failure SHALL explain that prepared configuration remains and prior completion status was not restored. No platform execution lockout, storage qualification, guardian proof, force-unlock, or diagnostic-capacity control SHALL be presented.

#### Scenario: Cleanup retry remains unresolved

- **WHEN** retry returns the same run with `retryCleanup` still available
- **THEN** the control SHALL re-enable cleanup retry after the request settles without renderer-local rollback ownership

#### Scenario: Terminal metadata remains unsaved

- **WHEN** native execution settled but terminal metadata persistence fails
- **THEN** the dashboard SHALL display the persistence error and SHALL NOT launch a replacement run that discards terminal authority

#### Scenario: Committed startup fails before first worker

- **WHEN** native reports startup failure after execution commit
- **THEN** the dashboard SHALL display the retained prepared-state consequence and SHALL NOT offer historical-status rollback

#### Scenario: Interrupted run needs external confirmation

- **WHEN** native reports `availableAction: confirmStopped`
- **THEN** the dashboard SHALL explain that abrupt app death may have left MATLAB/Apptainer running, direct the user to operating-system process tools, and require confirmation before cleanup or replacement execution

#### Scenario: Confirmation is pending

- **WHEN** the user has not confirmed the exact interrupted run
- **THEN** Start and automatic terminal acknowledgement SHALL remain disabled while project viewing remains available
