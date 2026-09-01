## ADDED Requirements

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
