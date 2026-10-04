## Purpose

Define import configuration snapshots and safe selective import re-runs.

## Requirements

### Requirement: Import snapshot persistence

The system SHALL capture an `ImportSnapshot` for the reserved import attempt and retain it as pending runtime state. Only reconciliation of that run's authoritative Completed result SHALL replace the successful freshness baseline persisted at `uiState.import.mostRecentConfig`; rejected starts and failed, cancelled, or interrupted attempts SHALL preserve the prior baseline. The snapshot SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, and `subjectRows` (including `groupId` assignments). The baseline SHALL be `null` before the first successful import run. Its source location SHALL use the same project-relative-internal or absolute-external representation as current import state so moving a project does not change the logical source.

When persisted to `.easl`, the snapshot SHALL be serialized as a gzip-compressed, base64-encoded string (algorithm: gzip, level 9). The in-memory store and staleness computation SHALL operate on a fully validated `ImportSnapshot` object. Schema v1 parsing SHALL decompress and validate a persisted string before exposing the snapshot. Migration of a legacy `.easl` file SHALL preserve either a valid compressed snapshot or a valid full-object snapshot, and canonical schema v1 serialization SHALL emit the compressed form. An invalid object, base64 value, gzip payload, JSON payload, snapshot shape, or escaping project-relative path SHALL produce an actionable project validation or migration error instead of silently replacing the snapshot with `null`.

#### Scenario: First import creates snapshot

- **WHEN** the first reserved import attempt reaches authoritative Completed and terminal reconciliation succeeds
- **THEN** its captured location-independent configuration SHALL become `uiState.import.mostRecentConfig` and persist before acknowledgement

#### Scenario: Re-run overwrites snapshot

- **WHEN** a reserved re-run with selected subjects reaches authoritative Completed
- **THEN** its captured configuration SHALL replace the previous baseline at `uiState.import.mostRecentConfig` through terminal reconciliation

#### Scenario: Failed attempt preserves successful baseline

- **WHEN** a re-run fails, is cancelled, or becomes interrupted
- **THEN** `uiState.import.mostRecentConfig` SHALL retain the prior successful configuration so failed work cannot make changed subjects appear fresh

#### Scenario: Snapshot persists across sessions

- **WHEN** a schema v1 project containing a valid compressed snapshot is closed and reopened
- **THEN** the validated full snapshot SHALL be restored to runtime state

#### Scenario: Snapshot survives project relocation

- **WHEN** a project and its internal DICOM source move together and the project reopens from the new location
- **THEN** current configuration and snapshot SHALL resolve to the same logical source without making subjects stale solely because the root changed

#### Scenario: Legacy object snapshot is migrated

- **WHEN** a valid legacy project contains a full-object `mostRecentConfig`
- **THEN** migration SHALL preserve the snapshot in runtime state and canonical schema v1 serialization SHALL encode it as a gzip-compressed base64 string

#### Scenario: Invalid compressed snapshot fails safely

- **WHEN** a supported project contains an invalid compressed `mostRecentConfig`
- **THEN** opening or migration SHALL fail with an actionable error and SHALL leave the project source unchanged

### Requirement: Two-tier staleness detection

On entering import step 5, the system SHALL compare the current import configuration against `uiState.import.mostRecentConfig` to determine per-subject staleness. Source locations SHALL be compared by normalized logical identity rather than resolved absolute runtime path.

**Structural staleness**: If any of the following fields differ between current config and snapshot, ALL subjects SHALL be marked stale: logical `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`.

**Metadata staleness**: If only `metadataGroups` or `subjectRows` differ, the system SHALL identify which metadata groups changed and mark only subjects assigned to those groups as stale. A metadata group is considered changed if its `bidsParams` object differs from the snapshot. Subject row changes (group assignment changes) SHALL also mark affected subjects stale.

**No staleness**: If the normalized snapshot matches the current configuration exactly, no subjects SHALL be marked stale. A compatible relink SHALL update current and snapshot source locations together and SHALL NOT make subjects stale solely because the path changed. A confirmed incompatible relink SHALL make affected subjects stale through its source-dependent configuration reset.

#### Scenario: Structural change stales all subjects

- **WHEN** the user changes a tokenizer assignment after import completion and navigates to step 5
- **THEN** all subjects SHALL be marked stale regardless of their metadata group assignment

#### Scenario: Metadata change stales only affected subjects

- **WHEN** the user changes `PostLabelingDelay` in metadata group "Group A" after import completion and navigates to step 5
- **THEN** only subjects assigned to "Group A" SHALL be marked stale and subjects in other groups SHALL remain fresh

#### Scenario: Subject moved between groups

- **WHEN** the user reassigns a subject from "Group A" to "Group B" after import completion and navigates to step 5
- **THEN** the moved subject SHALL be marked stale even if both groups' parameters are unchanged

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

1. **Filter bar** with segmented control: All (N) | Pending (N) | Completed (N) | Failed (N) | Stale (N). Each option shows count of matching subjects.

2. **Subject selection table** with columns: Subject | Status | Step | Import Logs/Errors. Rows have checkboxes for subject selection. All subjects are pre-selected on first import. On re-visit after completion, stale subjects are pre-selected and fresh completed subjects are deselected.

3. **Status column** displays icons: green check (completed), orange spinning loader (running), gray dash (pending), red exclamation mark (failed), gray ban (cancelled). Stale subjects show an amber warning triangle overlay on the status icon.

4. **Step column** shows "DCM2NII" or "NII2BIDS" for running/failed subjects. Shows "—" for pending/completed/cancelled subjects.

5. **Import Logs/Errors column** shows clickable badge: "View Errors" (red outline) if error logs exist, "View Logs" (teal outline) if only non-error logs exist, "No Logs" (dimmed text) if no logs. Clicking opens `LogViewerModal` (reusing Processing module's modal) with import module logs for that subject.

#### Scenario: First visit before import

- **WHEN** the user reaches step 5 for a project that has never been imported
- **THEN** all subjects are shown with "pending" status, no stale indicators, and all checkboxes are selected

#### Scenario: Re-visit after successful import, no config changes

- **WHEN** the user navigates to step 5 after a successful import with no configuration changes
- **THEN** all subjects show "completed" status with no stale overlay, no checkboxes are pre-selected

#### Scenario: Re-visit with stale subjects

- **WHEN** the user changed a metadata group parameter and navigates to step 5
- **THEN** subjects in the changed group show "completed" status with amber stale overlay, those subjects are pre-selected in checkboxes

#### Scenario: Re-visit with structural changes

- **WHEN** the user changed a tokenizer assignment and navigates to step 5
- **THEN** all subjects show stale overlay, all subjects are pre-selected

#### Scenario: Clicking View Logs opens modal

- **WHEN** the user clicks "View Logs" on a subject row
- **THEN** the LogViewerModal opens showing import log files from `derivatives/ExploreASL/log/` for that subject, with the module parameter set to "import"

#### Scenario: Clicking View Errors opens modal

- **WHEN** the user clicks "View Errors" on a subject row
- **THEN** the LogViewerModal opens showing import log files with error highlighting, module "import"

### Requirement: Selective re-run with confirmation

The system SHALL provide "Start Import" and "Stop" controls on step 5. When the user clicks "Start Import":

1. If no subjects are selected, the button SHALL be disabled.
2. The system SHALL resolve one immutable selected-subject snapshot and request a native read-only replacement inventory for that exact snapshot before staging mutation or process spawn.
3. If the inventory contains any existing selected-subject rawdata that relocation would replace, or selected subjects include any fresh completed subject, a confirmation dialog SHALL appear with title "Replace existing imported data?", an expandable subject-grouped inventory of affected project-relative rawdata paths, sessions, file counts, and byte totals, explanatory text that the complete selected subject will replace older sessions and files, and actions "Cancel" (default) and "Replace and import". Derived import locks, import logs, and BIDS2Legacy locks SHALL NOT trigger replacement confirmation or affect the confirmed rawdata fingerprint.
4. If the inventory is empty and all selected subjects are stale, pending, or failed, import SHALL start without a replacement confirmation.
5. Cancellation SHALL preserve selection and SHALL NOT bind a relocation plan, mutate staging, or spawn ExploreASL.
6. Confirmation SHALL bind the native relocation-plan identity and fingerprint to the same selected-subject snapshot used for staging, progress tracking, parser ownership, retry preservation, and execution.
7. Before spawning MATLAB, lock files for selected subjects SHALL be deleted. Lock files for unselected fresh subjects SHALL be preserved via retry lock preservation.
8. The staging tree SHALL be rebuilt from current configuration with source entries only for selected subjects. Unselected subjects SHALL NOT be staged or processed, regardless of status or preservable locks.

#### Scenario: Initial import has no existing destination

- **WHEN** selected pending subjects have no subject rawdata that relocation would replace
- **THEN** import SHALL start without replacement confirmation using the immutable selected-subject snapshot and empty relocation inventory

#### Scenario: Existing pending or stale subject has output

- **WHEN** a selected pending, stale, or failed subject has existing subject rawdata that relocation would replace
- **THEN** the replacement confirmation SHALL appear regardless of displayed completion status

#### Scenario: Re-import with only stale subjects

- **WHEN** the user selects only stale subjects and native inventory finds no existing subject rawdata that relocation would replace
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

- **WHEN** native inventory finds selected-subject sessions or files that the whole-subject replacement can remove
- **THEN** the dialog SHALL identify those project-relative paths and SHALL explain that confirmation replaces the complete subject rather than merging old content

#### Scenario: Confirmation cancelled

- **WHEN** the user clicks "Cancel" on the replacement confirmation
- **THEN** import SHALL NOT start, subject selection SHALL remain unchanged, and project and staging files SHALL remain unchanged

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

- **WHEN** a verified committed subject's relevant configuration changes
- **THEN** it SHALL remain completed with a stale overlay and SHALL be preselected under existing selective re-run behavior

#### Scenario: Interrupted run leaves staging locks

- **WHEN** application recovery reports `Interrupted` with uncommitted staging artifacts
- **THEN** those artifacts SHALL not qualify any selected subject as fresh completed for retry planning
