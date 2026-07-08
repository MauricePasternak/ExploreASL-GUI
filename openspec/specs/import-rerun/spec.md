## Requirements

### Requirement: Import snapshot persistence

The system SHALL capture an `ImportSnapshot` at `startImport()` time and persist it in the project file at `uiState.import.mostRecentConfig`. The snapshot SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, and `subjectRows` (including `groupId` assignments). The snapshot SHALL be `null` before the first import run.

When persisted to `.easl`, the snapshot SHALL be serialized as a gzip-compressed, base64-encoded string (algorithm: gzip, level 9) via `fflate`. The in-memory store and staleness computation SHALL operate on the full `ImportSnapshot` object; compression is applied only at the `saveProject` serialization boundary and reversed at `loadProject` parse time. Corrupted or undecodable persisted strings SHALL fall back to `null` with a warning (staleness treated as no-baseline). Legacy `.easl` files containing a full-object `mostRecentConfig` (pre-compression format) SHALL drop the field on load with a warning; no migration is performed (v0, not yet distributed).

#### Scenario: First import creates snapshot

- **WHEN** the user clicks "Start Import" for the first time
- **THEN** the current import configuration is captured as an `ImportSnapshot` and stored in `uiState.import.mostRecentConfig`

#### Scenario: Re-run overwrites snapshot

- **WHEN** the user starts a re-run (with selected subjects)
- **THEN** the current import configuration replaces the previous snapshot in `uiState.import.mostRecentConfig`

#### Scenario: Snapshot persists across sessions

- **WHEN** the user closes and reopens the project
- **THEN** the `mostRecentConfig` snapshot is restored from the `.easl` project file

### Requirement: Two-tier staleness detection

On entering import step 5, the system SHALL compare the current import configuration against `uiState.import.mostRecentConfig` to determine per-subject staleness.

**Structural staleness**: If any of the following fields differ between current config and snapshot, ALL subjects SHALL be marked stale: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`.

**Metadata staleness**: If only `metadataGroups` or `subjectRows` differ, the system SHALL identify which metadata groups changed and mark only subjects assigned to those groups as stale. A metadata group is considered changed if its `bidsParams` object differs from the snapshot. Subject row changes (group assignment changes) SHALL also mark affected subjects stale.

**No staleness**: If the snapshot matches the current configuration exactly, no subjects SHALL be marked stale.

#### Scenario: Structural change stales all subjects

- **WHEN** the user changes a tokenizer assignment after import completion and navigates to step 5
- **THEN** all subjects are marked stale regardless of their metadata group assignment

#### Scenario: Metadata change stales only affected subjects

- **WHEN** the user changes `PostLabelingDelay` in metadata group "Group A" after import completion and navigates to step 5
- **THEN** only subjects assigned to "Group A" are marked stale; subjects in other groups remain fresh

#### Scenario: Subject moved between groups

- **WHEN** the user reassigns a subject from "Group A" to "Group B" after import completion and navigates to step 5
- **THEN** the moved subject is marked stale (its group assignment changed), even if both groups' params are unchanged

#### Scenario: No config changes

- **WHEN** the user navigates to step 5 without changing any import configuration since the last run
- **THEN** no subjects are marked stale

#### Scenario: No prior snapshot

- **WHEN** the user navigates to step 5 and `mostRecentConfig` is `null`
- **THEN** no staleness comparison is performed; all subjects show their reconstructed status without stale overlay

### Requirement: Import progress reconstruction from lock files

The system SHALL provide a Rust command `read_import_status(project_root: string)` that scans `<project_root>/derivatives/ExploreASL/lock/xASL_module_Import/` and returns per-subject status. For each subject directory found:

- If `999_ready.status` exists → status `"completed"`, step `null`
- If any other `.status` file exists but no `999_ready.status` → status `"failed"`, step `null`
- If the subject directory does not exist in lock path → the subject is not included in results

The system SHALL call `read_import_status` on entering import step 5 and populate `importProgress` from the results. Subjects not found in lock files SHALL be set to status `"pending"` (never attempted) if no prior `mostRecentConfig` exists, or status `"stale-not-found"` if a snapshot exists (indicating the subject's output was moved but config has since changed).

#### Scenario: Completed subject reconstructed from lock files

- **WHEN** the user navigates to step 5 after a successful import of subject "sub-001"
- **THEN** `read_import_status` returns `{ subject: "sub-001", status: "completed" }` and the progress table shows subject "sub-001" as completed

#### Scenario: Failed subject reconstructed from lock files

- **WHEN** subject "sub-BADDIE" failed during import with `010_DCM2NII.status` present but no `999_ready.status`
- **THEN** `read_import_status` returns `{ subject: "sub-BADDIE", status: "failed" }`

#### Scenario: Subject not in lock files with no snapshot

- **WHEN** the user opens step 5 for the first time and subject "sub-NEW" has no lock directory
- **THEN** subject "sub-NEW" shows status "pending" (never attempted)

#### Scenario: Subject not in lock files but snapshot exists

- **WHEN** a subject was completed in a prior run (lock files exist in project derivatives), config changed structurally, and now the subject name has changed due to a rename
- **THEN** the renamed subject has no matching lock directory and shows status "pending"; the old-name lock directory still exists but no longer corresponds to a current subject

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
2. If selected subjects include any with status "completed" and not stale, a confirmation dialog SHALL appear: title "Re-import completed subject?", body listing the completed subject names with text "These subjects appear to have completed successfully. Re-importing will overwrite their existing output.", actions "Cancel" (default) and "Re-import anyway".
3. If all selected subjects are stale, pending, or failed, no confirmation dialog SHALL appear and import starts immediately.
4. Before spawning MATLAB, lock files for selected subjects SHALL be deleted. Lock files for unselected fresh subjects SHALL be preserved via `copyLockFilesForRetry`.
5. The staging tree SHALL be rebuilt from current configuration.

#### Scenario: Re-import with only stale subjects

- **WHEN** the user selects only stale subjects and clicks "Start Import"
- **THEN** import starts without confirmation, lock files for selected subjects are deleted, lock files for unselected fresh subjects are preserved

#### Scenario: Re-import with freshly completed subjects

- **WHEN** the user selects a freshly completed subject (not stale) and clicks "Start Import"
- **THEN** a confirmation dialog appears with the subject name listed

#### Scenario: Confirmation cancelled

- **WHEN** the user clicks "Cancel" on the confirmation dialog
- **THEN** the import does not start and the subject selection is preserved

#### Scenario: Confirmation accepted

- **WHEN** the user clicks "Re-import anyway" on the confirmation dialog
- **THEN** import proceeds, lock files for all selected subjects (including the freshly completed ones) are deleted

#### Scenario: No subjects selected

- **WHEN** no subjects are selected in the checkbox table
- **THEN** the "Start Import" button is disabled

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

For DICOM-import projects (`dataSource === "dicom"`), the existing `import-rerun` behavior is preserved: staleness detection, reconstruction from lock files, and re-import delta execution all work as before.

For BIDS-direct projects (`dataSource === "bids"`):

- Import page revisit shows persisted summary plus explicit re-scan/re-confirm capability.
- `ImportSnapshot` and staleness (per existing `import-store` spec) are irrelevant for BIDS-direct (no DICOM source).
- Re-confirm regenerates the BIDS-derived `mappingState` from the latest `scan_bids_sidecars` result rather than using DICOM staleness/delta import machinery.
