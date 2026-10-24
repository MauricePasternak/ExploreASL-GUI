## Purpose

Define import configuration snapshots and safe selective import re-runs.

## Requirements

### Requirement: Two-tier staleness detection

On entering import step 5, the system SHALL compare the current import configuration against `uiState.import.mostRecentConfig` to determine per-subject staleness. Source locations SHALL be compared by normalized logical identity rather than resolved absolute runtime path.

**Structural staleness**: If any of the following fields differ between current config and snapshot, ALL subjects SHALL be marked stale: logical `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`.

**Metadata staleness**: If structural configuration is unchanged, the system SHALL collect changed group IDs: newly added or removed metadata groups, groups whose serialized `bidsParams` differ from the snapshot, and the current target `groupId` of each current subject row whose `id` is new or whose group assignment differs from the snapshot. Each current subject SHALL be marked stale only when its first row in the current `subjectRows` array belongs to that changed-group set. Later rows for the same subject SHALL NOT independently determine its staleness; the comparison SHALL NOT be treated as exhaustive subject-session change detection.

**No staleness**: If the normalized snapshot matches the current configuration exactly, no subjects SHALL be marked stale. A compatible relink SHALL update current and snapshot source locations together and SHALL NOT make subjects stale solely because the path changed. A confirmed incompatible relink SHALL make affected subjects stale through its source-dependent configuration reset.

#### Scenario: Structural change stales all subjects

- **WHEN** the user changes a tokenizer assignment after import completion and navigates to step 5
- **THEN** all subjects SHALL be marked stale regardless of their metadata group assignment

#### Scenario: Metadata change uses each subject's first current row

- **WHEN** the user changes `PostLabelingDelay` in metadata group "Group A" after import completion and navigates to step 5
- **THEN** only subjects whose first current row belongs to "Group A" SHALL be marked stale and subjects whose first current row belongs to an unchanged group SHALL remain fresh

#### Scenario: Subject moved between groups

- **WHEN** the user reassigns a subject's first current row from "Group A" to "Group B" after import completion and navigates to step 5, with both groups' parameters unchanged
- **THEN** the moved subject and unchanged subjects whose first current row belongs to "Group B" SHALL be marked stale

#### Scenario: Changed group appears only in a later row

- **WHEN** a subject's first current row belongs to unchanged "Group A", a later row belongs to "Group B", and only "Group B" parameters change
- **THEN** that subject SHALL remain fresh under the first-row metadata comparison

#### Scenario: Project root changes only

- **WHEN** the project root changes but the internal source and import configuration have the same logical identity
- **THEN** no subject SHALL become stale solely because of relocation

#### Scenario: Compatible external source relink

- **WHEN** a missing external source is relinked to a structurally matching replacement
- **THEN** no subject SHALL become stale solely because the absolute source path changed

#### Scenario: No config changes

- **WHEN** the user navigates to step 5 without changing any logical import configuration since the last run
- **THEN** no subjects SHALL be marked stale

#### Scenario: No prior snapshot

- **WHEN** the user navigates to step 5 and `mostRecentConfig` is `null`
- **THEN** no staleness comparison SHALL be performed and subjects SHALL show reconstructed status without stale overlay

### Requirement: Import progress reconstruction from lock files

When no active or replayable native run supplies progress, the system SHALL reconstruct per-subject status through an active-project-owned native audit of committed import artifacts. The audit SHALL reject unsafe roots and symlinks and SHALL report a subject completed only when its canonical project import lock contains a regular `999_ready.status` committed by native relocation and its project rawdata subject directory is present and nonempty. Partial status files without a valid ready artifact SHALL report failed. Subjects with no verified artifact SHALL remain pending. Configuration staleness SHALL be computed separately from `mostRecentConfig` and SHALL not convert an unverified subject into completed.

#### Scenario: Completed subject reconstructs from committed artifacts

- **WHEN** a subject has a safe committed ready lock and nonempty project rawdata
- **THEN** native audit SHALL report it completed and the progress table SHALL show completed before staleness overlay is applied

#### Scenario: Ready lock lacks project rawdata

- **WHEN** a project ready lock exists but its subject rawdata is missing or empty
- **THEN** native audit SHALL report an invalid or failed status and SHALL not classify the subject completed

#### Scenario: Failed subject reconstructs from partial locks

- **WHEN** a subject has import status files but no valid committed ready artifact
- **THEN** native audit SHALL report it failed

#### Scenario: Subject has no committed evidence

- **WHEN** a current subject has no audited import artifacts
- **THEN** it SHALL show pending regardless of whether a prior configuration snapshot exists

#### Scenario: Artifact path is unsafe

- **WHEN** the lock or rawdata path resolves through a symlink or outside the active project
- **THEN** audit SHALL fail closed with an actionable error and SHALL not follow the path

#### Scenario: Completed subject reconstructed from lock files

- **WHEN** committed audit finds a regular ready lock and nonempty rawdata for subject `sub-001`
- **THEN** it SHALL return `{ subject: "sub-001", status: "completed" }`

#### Scenario: Failed subject reconstructed from lock files

- **WHEN** committed audit finds partial import status for `sub-BADDIE` without valid ready evidence
- **THEN** it SHALL return `{ subject: "sub-BADDIE", status: "failed" }`

#### Scenario: Subject not in lock files with no snapshot

- **WHEN** a current subject has no committed audit evidence and no prior configuration snapshot
- **THEN** it SHALL show pending as never attempted

#### Scenario: Subject not in lock files but snapshot exists

- **WHEN** a renamed current subject has no matching committed artifact while a prior snapshot exists
- **THEN** the current subject SHALL show pending and an old-name artifact SHALL not be attributed to it

### Requirement: Import progress table with subject selection

The import step 5 execution view SHALL replace the current `ImportProgressTable` and `ImportSummary` with a combined view:

1. **Filter bar** with segmented control: All (N) | Pending (N) | Completed (N) | Failed (N) | Stale (N). Each option shows count of matching subjects. Stale rows SHALL belong to Stale regardless of status; otherwise completed rows SHALL belong to Completed, failed/cancelled/interrupted rows to Failed, and pending/running rows to Pending. All SHALL include every row.

2. **Subject selection table** with columns: Subject | Status | Step | Import Logs/Errors. Rows have checkboxes for subject selection. All subjects are pre-selected on first import. On re-visit after completion, stale subjects are pre-selected and fresh completed subjects are deselected.

3. **Status column** SHALL display icons: green check (completed), orange spinning loader (running), gray dash (pending), red exclamation mark (failed), gray ban (cancelled), yellow warning triangle (interrupted). Stale subjects show an amber warning triangle overlay on the status icon.

4. **Step column** SHALL show `currentStep`, falling back to `errorStep` when present, for running/failed subjects; it SHALL show "—" when neither is available or for other statuses. A failure diagnostic SHALL NOT imply that its step was stored.

5. **Import Logs/Errors column** SHALL show a clickable "View Errors" badge (red outline) when logs exist and the subject's progress status is `failed`, or "View Logs" (teal outline) when logs exist for any other status. The badge label SHALL NOT depend on `LogFileInfo.hasError`. With no logs, it SHALL show "No Logs" (dimmed text) regardless of status. Clicking opens `LogViewerModal` (reusing Processing module's modal) with import module logs for that subject.

#### Scenario: First visit before import

- **WHEN** the user reaches step 5 for a project that has never been imported
- **THEN** all subjects are shown with "pending" status, no stale indicators, and all checkboxes are selected

#### Scenario: Re-visit after successful import, no config changes

- **WHEN** the user navigates to step 5 after a successful import with no configuration changes
- **THEN** all subjects show "completed" status with no stale overlay, no checkboxes are pre-selected

#### Scenario: Re-visit with stale subjects

- **WHEN** the user changed a metadata group parameter and navigates to step 5
- **THEN** verified completed subjects whose first current row belongs to the changed group show "completed" status with amber stale overlay, and those subjects are pre-selected in checkboxes

#### Scenario: Re-visit with structural changes

- **WHEN** the user changed a tokenizer assignment and navigates to step 5
- **THEN** all subjects show stale overlay, all subjects are pre-selected

#### Scenario: Clicking View Logs opens modal

- **WHEN** the user clicks "View Logs" on a subject row
- **THEN** the LogViewerModal opens showing import log files from `derivatives/ExploreASL/log/` for that subject, with the module parameter set to "import"

#### Scenario: Clicking View Errors opens modal

- **WHEN** the user clicks "View Errors" on a failed subject row with logs, even if no log has `hasError = true`
- **THEN** the LogViewerModal SHALL open for module "import" with those log entries flagged as errors; line highlighting SHALL follow log content

#### Scenario: Non-failed subject has an error-marked log

- **WHEN** a non-failed subject has import logs with `hasError = true`
- **THEN** its row SHALL show "View Logs", not "View Errors"

#### Scenario: Failed subject has no logs

- **WHEN** a failed subject has no import log files
- **THEN** its row SHALL show "No Logs", not "View Errors"

### Requirement: Selective re-run with confirmation

The system SHALL provide "Start Import" and "Stop" controls on step 5. When the user clicks "Start Import":

1. If no subjects are selected, the button SHALL be disabled.
2. The system SHALL resolve one immutable selected-subject snapshot and request a native read-only replacement inventory for that exact snapshot before staging mutation or process spawn.
3. If any selected-subject inventory has `fileCount > 0`, or selected subjects include any fresh completed subject, a confirmation dialog SHALL appear with title "Replace existing imported data?", an expandable subject-grouped inventory of affected project-relative rawdata paths, sessions, file counts, and byte totals, explanatory text that the complete selected subject will replace older sessions and files, and actions "Cancel" (default) and "Replace and import". The inventory and fingerprint SHALL include existing rawdata directories, but directories SHALL NOT count as files or alone trigger confirmation. Derived import locks, import logs, and BIDS2Legacy locks SHALL NOT trigger replacement confirmation or affect the confirmed rawdata fingerprint.
4. If every selected-subject inventory has `fileCount = 0` and no selected subject is fresh completed, import SHALL start without a replacement confirmation, even when the inventory contains directories.
5. Cancelling replacement confirmation SHALL preserve selection and SHALL NOT start import, bind a relocation plan, mutate imported output or staging, or spawn ExploreASL. Pending configuration edits MAY already have been flushed and saved before the prompt; cancellation SHALL NOT undo that save.
6. Confirmation SHALL bind the native relocation-plan identity and fingerprint to the same selected-subject snapshot used for staging, progress tracking, parser ownership, retry preservation, and execution.
7. Before spawning MATLAB, lock files for selected subjects SHALL be deleted. Lock files for unselected fresh subjects SHALL be preserved via retry lock preservation.
8. The staging tree SHALL be rebuilt from current configuration with source entries only for selected subjects. Unselected subjects SHALL NOT be staged or processed, regardless of status or preservable locks.

#### Scenario: Initial import has no existing destination

- **WHEN** selected pending subjects have no subject rawdata that relocation would replace
- **THEN** import SHALL start without replacement confirmation using the immutable selected-subject snapshot and empty relocation inventory

#### Scenario: Existing pending or stale subject has rawdata files

- **WHEN** a selected pending, stale, or failed subject has at least one existing subject rawdata file that relocation would replace
- **THEN** the replacement confirmation SHALL appear regardless of displayed completion status

#### Scenario: Only rawdata directories exist for selected subjects

- **WHEN** every selected-subject inventory contains only directories or no entries, and no selected subject is fresh completed
- **THEN** import SHALL start without replacement confirmation, retaining any inventoried directories in the native plan and fingerprint

#### Scenario: Re-import with only stale subjects

- **WHEN** the user selects only stale subjects and native inventory finds no existing subject rawdata files that relocation would replace
- **THEN** import SHALL start without replacement confirmation, stage only those stale subjects, delete their import locks, and preserve authorized locks for unselected fresh subjects

#### Scenario: Only derived artifacts exist for selected pending subject

- **WHEN** a selected pending subject has old import locks or logs but no subject rawdata
- **THEN** the native replacement inventory SHALL remain empty and those derived artifacts alone SHALL NOT require replacement confirmation

#### Scenario: Freshly completed subject is selected

- **WHEN** a freshly completed subject that is not stale is selected
- **THEN** the replacement confirmation SHALL appear and SHALL include that subject and its native destination inventory

#### Scenario: Re-import with freshly completed subjects

- **WHEN** the user selects one or more freshly completed subjects and clicks "Start Import"
- **THEN** the replacement confirmation SHALL list those subjects and their native destination inventories before import can start

#### Scenario: Existing subject contains older sessions

- **WHEN** replacement confirmation is required and native inventory finds selected-subject sessions or files that the whole-subject replacement can remove
- **THEN** the dialog SHALL identify those project-relative paths and SHALL explain that confirmation replaces the complete subject rather than merging old content

#### Scenario: Confirmation cancelled

- **WHEN** the user clicks "Cancel" on the replacement confirmation
- **THEN** the dialog SHALL close, subject selection SHALL remain unchanged, and no import, relocation-plan binding, imported-output replacement, staging mutation, or ExploreASL spawn SHALL occur; configuration edits already saved before the prompt SHALL remain saved

#### Scenario: Confirmation accepted

- **WHEN** the user clicks "Replace and import"
- **THEN** import SHALL proceed only for the confirmed immutable subject snapshot and SHALL carry its native relocation-plan identity for later destination revalidation

#### Scenario: No subjects selected

- **WHEN** no subjects are selected in the checkbox table
- **THEN** the "Start Import" button SHALL be disabled and no inventory or import request SHALL be submitted

#### Scenario: Unselected pending subject has no lock file

- **WHEN** a run selects one subject while another pending subject is unselected and has no import lock file
- **THEN** the unselected pending subject SHALL be absent from the replacement inventory, staging source tree, and ExploreASL execution scope

#### Scenario: Inventory planning fails

- **WHEN** native inventory cannot safely inspect a selected destination or derive an owned relocation plan
- **THEN** import SHALL remain blocked, project and staging files SHALL remain unchanged, and the user SHALL receive an actionable error

### Requirement: Import namespace restructure

The project file schema SHALL restructure import-related UI state under `uiState.import` namespace:

- `uiState.importActiveStep` → `uiState.import.activeStep`
- `uiState.importCompleted` → `uiState.import.completed`
- `uiState.importPhase` → `uiState.import.currentPhase`
- NEW: `uiState.import.mostRecentConfig` (gzip+base64 string, or null)

The old flat keys SHALL be removed from the schema entirely. No backward compatibility migration is needed (v0.1, not yet distributed).

#### Scenario: New project

- **WHEN** a new project is created
- **THEN** the project file uses `uiState.import.activeStep`, `uiState.import.completed`, `uiState.import.currentPhase` from the start

#### Scenario: Existing project with old flat keys

- **WHEN** a `.easl` file with old flat keys (`importActiveStep`, `importCompleted`, `importPhase`) is loaded
- **THEN** those keys are ignored and defaults are used for the nested format (no migration — v0.1)

### Requirement: Staleness indicator tooltips

Each stale status icon overlay SHALL display a tooltip on hover with text: "Configuration has changed since last import. Re-import recommended." Completed-but-not-stale icons SHALL display tooltip: "Import completed successfully."

#### Scenario: Hovering stale completed subject

- **WHEN** the user hovers over the amber triangle overlay on a completed-but-stale subject
- **THEN** a tooltip reads "Configuration has changed since last import. Re-import recommended."

#### Scenario: Hovering fresh completed subject

- **WHEN** the user hovers over the green check icon on a completed-not-stale subject
- **THEN** a tooltip reads "Import completed successfully."

### Requirement: Revisit and re-sync confirmed BIDS-direct projects

When user navigates to Import page on a BIDS-direct project where `uiState.import.bidsReviewConfirmed === true`, `BIDSReviewPanel` SHALL render a persisted summary and support an explicit re-scan/re-confirm flow.

Initial revisit state:

- Banner: "BIDS metadata groups confirmed. Import is complete."
- Group cards sourced from persisted `mappingState.metadataGroups` and `mappingState.subjectRows`, collapsed by default.
- Skipped subjects warning block sourced from persisted `uiState.import.skippedSubjects`.
- Persisted banner about pre-existing `participants.tsv` (if applicable per `bids-review-panel` spec).
- `[Re-scan BIDS]` action.

After user clicks `[Re-scan BIDS]`, `BIDSReviewPanel` SHALL call `scan_bids_sidecars` against `mappingState.sourceDataPath` if present, otherwise project root. The panel SHALL render the normal editable review state using the new scan result: editable group labels, skipped-subject warning, validation, and `[Confirm]`.

On re-confirm, the project store SHALL overwrite the BIDS-derived mapping fields exactly like first confirmation:

- `mappingState.metadataGroups`
- `mappingState.subjectRows`
- `mappingState.ingestionComplete = true`
- `mappingState.sourceDataPath`
- `uiState.import.skippedSubjects`
- `uiState.import.bidsReviewConfirmed = true`

The re-scan flow SHALL NOT clear the previously confirmed mapping state until re-confirm succeeds. If the re-scan fails or produces 0 groups, the project remains confirmed and the persisted summary can still be shown.

#### Scenario: Revisit after confirmation shows persisted skipped subjects

- **WHEN** user closes app after confirming BIDS review with one skipped subject, reopens the project, navigates to Import
- **THEN** the persisted summary renders the skipped-subjects warning block listing the persisted subject identifier (e.g., `sub-UNK001_1`)

#### Scenario: Revisit shows persisted participants.tsv banner

- **WHEN** user with `bidsReviewConfirmed = true` revisits Import on a BIDS-direct project where `participants.tsv` exists at root
- **THEN** the persisted summary shows the persisted banner about pre-existing `participants.tsv` (preserved as-is, BIDS review labels not auto-applied)

#### Scenario: Re-scan starts editable review

- **WHEN** user clicks `[Re-scan BIDS]` after confirmation and the scan succeeds
- **THEN** group labels are editable, skipped subjects reflect the latest scan result, and `[Confirm]` is available

#### Scenario: Revisit collapses group cards by default

- **WHEN** user revisits Import on a BIDS-direct project after confirmation with 10+ groups
- **THEN** all persisted group cards start collapsed; user can expand for params/subject details

#### Scenario: Re-confirm overwrites BIDS-derived mapping state

- **WHEN** user re-scans after adding a new valid BIDS subject externally and clicks `[Confirm]`
- **THEN** `metadataGroups`, `subjectRows`, `sourceDataPath`, `skippedSubjects`, and `bidsReviewConfirmed` reflect the latest scan result

#### Scenario: Failed re-scan preserves prior confirmation

- **WHEN** user clicks `[Re-scan BIDS]` and `scan_bids_sidecars` returns an error
- **THEN** the error is displayed, previous `mappingState` and `uiState.import.skippedSubjects` remain unchanged, and the user can return to the persisted summary

### Requirement: Import re-run support

For DICOM-import projects (`dataSource === "dicom"`), the existing `import-rerun` behavior SHALL be preserved: staleness detection, reconstruction from lock files, and re-import delta execution all work as before.

For BIDS-direct projects (`dataSource === "bids"`):

- Import page revisit shows persisted summary plus explicit re-scan/re-confirm capability.
- `ImportSnapshot` and staleness (per existing `import-store` spec) are irrelevant for BIDS-direct (no DICOM source).
- Re-confirm regenerates the BIDS-derived `mappingState` from the latest `scan_bids_sidecars` result rather than using DICOM staleness/delta import machinery.

#### Scenario: DICOM re-run behavior remains available

- **WHEN** a DICOM-import project is revisited for import
- **THEN** its staleness detection, lock-file reconstruction, and delta re-import behavior remain available

### Requirement: Authoritative retry source selection

Selective retry defaults and retry-lock preservation SHALL use reconciled native terminal outcomes or verified committed project artifacts. Provisional parser completion, persisted frontend completion flags, interrupted staging locks, and stale run snapshots SHALL not qualify a subject as fresh completed or preservable. Configuration staleness SHALL remain an independent overlay on verified completion.

#### Scenario: Parser completed subject lacks verified result

- **WHEN** a prior run emitted subject-completion output but native finalization did not commit that subject
- **THEN** the subject SHALL remain selected for retry and its locks SHALL not be preserved as successful evidence

#### Scenario: Partial failed run committed one subject

- **WHEN** a failed terminal run reports subject A committed and subject B failed verification
- **THEN** A MAY be deselected and preserved while B SHALL be selected for retry

#### Scenario: Completed subject becomes stale

- **WHEN** a verified committed subject has a structural configuration change or satisfies the first-row metadata staleness rule
- **THEN** it SHALL remain completed with a stale overlay and SHALL be preselected under existing selective re-run behavior

#### Scenario: Interrupted run leaves staging locks

- **WHEN** application recovery reports `Interrupted` with uncommitted staging artifacts
- **THEN** those artifacts SHALL not qualify any selected subject as fresh completed for retry planning

### Requirement: Readable successful import configuration

Each admitted import attempt SHALL capture its immutable configuration before staging mutation. Only an authoritative Completed result SHALL replace the persisted successful baseline at `uiState.import.mostRecentConfig`; rejected, failed, cancelled, or interrupted attempts SHALL preserve the prior baseline. The snapshot SHALL include source location, path patterns, tokenizer assignments, directory matching, modality/session/run aliases, subject renames, metadata groups, subject/group rows, and selected profile reference when configured. It SHALL be `null` before the first successful import. Internal sources SHALL remain project-relative and external sources absolute, matching current configuration's logical identity.

The baseline SHALL persist as an ordinary JSON object or `null`. Strings, gzip/base64 data, invalid snapshot values, and escaping paths SHALL be rejected without substitution or migration. Native result reconciliation SHALL persist the admitted attempt's snapshot before acknowledging that run, regardless of renderer presence. Existing execution-record compatibility SHALL not reconstruct missing historical attempt settings from currently edited configuration.

#### Scenario: First import creates snapshot

- **WHEN** the first admitted import completes and native project persistence succeeds
- **THEN** its captured configuration SHALL become the successful baseline before acknowledgement

#### Scenario: Re-run overwrites snapshot

- **WHEN** an admitted selective re-run completes
- **THEN** its captured configuration SHALL replace the successful baseline through native reconciliation

#### Scenario: Failed attempt preserves successful baseline

- **WHEN** a re-run fails, cancels, or becomes interrupted
- **THEN** the prior successful baseline SHALL remain unchanged

#### Scenario: Snapshot persists across sessions

- **WHEN** current configuration containing an ordinary JSON snapshot reopens
- **THEN** the same validated snapshot SHALL supply staleness comparison

#### Scenario: Snapshot survives project relocation

- **WHEN** a project and internal source move together
- **THEN** source identity SHALL remain equivalent and relocation alone SHALL not make subjects stale

#### Scenario: Encoded snapshot is rejected

- **WHEN** current configuration supplies a string instead of a snapshot object or `null`
- **THEN** opening SHALL report invalid configuration and leave the source unchanged

#### Scenario: Renderer reloads before import completes

- **WHEN** accepted import work completes after renderer reload
- **THEN** native reconciliation SHALL use the admitted attempt snapshot rather than current edited settings
