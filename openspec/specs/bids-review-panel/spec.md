# bids-review-panel Specification

## Purpose

TBD - created by archiving change direct-bids-import. Update Purpose after archive.

## Requirements

### Requirement: ImportPage renders BIDSReviewPanel conditionally

`ImportPage` SHALL render `BIDSReviewPanel` when `projectMeta.dataSource === "bids"` and the existing 6-step DICOM wizard when `dataSource === "dicom"`. No new route is created; the existing `currentPhase: "import"` covers both paths.

#### Scenario: BIDS project lands on review panel

- **WHEN** user creates a BIDS-direct project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders `BIDSReviewPanel` (not the 6-step wizard)

#### Scenario: DICOM project lands on wizard

- **WHEN** user creates a DICOM project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders the existing 6-step DICOM wizard

### Requirement: BIDSReviewPanel renders group cards with editable labels

`BIDSReviewPanel` SHALL render one card per detected `DerivedMetadataGroup`. Each card shows:

- Label as an inline editable input (auto-suggested value pre-filled; user may edit)
- Subject count + session count for the group
- Subject list (collapsible; sorted alphabetically), showing `subjectLabel` and `sessionLabels`
- Parameters table (expandable; shows `bidsParams` entries; `summarizeAslContext()` applied to `ASLContext` value when present)
- Vendor / sequence / labeling_type displayed as clean metadata badges:
  - **Vendor:** Mapped to `"Siemens"`, `"Philips"`, or `"GE"`.
  - **Sequence:** Mapped to `"Gradient & Spin Echo"`, `"Echo Planar Imaging"`, or `"Stack of Spirals"`.
  - **Labeling Type:** Mapped to `"Continuous ASL"`, `"Pulsed ASL"`, or `"Pseudo-continuous ASL"`.

#### Scenario: ds000240 single-group review

- **WHEN** `BIDSReviewPanel` renders with 1 detected group containing 25 subjects
- **THEN** one group card shows "25 subjects", label input pre-filled with `"Siemens_3T_PCASL_3D_Included"`, subject list collapsed by default

#### Scenario: Label edit handled without re-collision

- **WHEN** user edits Group A's label from `"Siemens_3T_PCASL_3D_Included"` to `"Foo"` while Group B's label is `"Siemens_3T_PCASL_3D_Included_(2)"`
- **THEN** Group B's label remains unchanged (no auto-recollision); edits affect only the edited group

#### Scenario: Large dataset collapses cards by default

- **WHEN** `BIDSReviewPanel` renders with 10+ groups
- **THEN** all group cards start collapsed; parameters table hidden by default

### Requirement: Pre-existing participants.tsv banner persisted

`BIDSReviewPanel` SHALL render a persisted banner at the top of the panel body (above group cards, visible at first render) when `participants.tsv` exists at project root. The frontend checks for this file's existence asynchronously on mount using the Tauri fs plugin `exists` command on `<projectRoot>/participants.tsv`.

> "Your existing `participants.tsv` (at project root) is not modified by ExploreASL GUI. During processing, ExploreASL generates its own working copy at `derivatives/ExploreASL/participants.tsv` and appends processing-derived columns (`site`, `gm_vol`, `motion`, etc.) there. Your root-level file stays as you authored it."

#### Scenario: Existing participants.tsv

- **WHEN** user creates a BIDS-direct project on ds000240 root which has `participants.tsv` with 16 columns (Age, Gender, MMSE, etc.)
- **THEN** `BIDSReviewPanel` shows the persisted banner above group cards; root-level file is never touched by GUI or ExploreASL during processing

### Requirement: Skipped subjects warning block

`BIDSReviewPanel` SHALL render a warning block listing skipped subjects (from `skippedSubjects`). Each entry shows the subject/session identifier in `sub-XX_<session>` form, plus the skip reason:

- Missing `*_asl.json` sidecar
- Missing or unparseable `*_aslcontext.tsv`

Each entry note: "This subject will be excluded from processing. To include it, add the missing file externally and click Retry."

#### Scenario: Missing sidecar

- **WHEN** a subject has `perf/sub-05_asl.nii.gz` but no `sub-05_asl.json`
- **THEN** skipped-subjects warning block displays `sub-05_1` with reason "No `*_asl.json` sidecar found"

### Requirement: Edge states

`BIDSReviewPanel` SHALL render these edge states:

| State          | UI                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan running   | Skeleton loader                                                                                                                                                                                                             |
| Scan error     | Error alert with `[Retry]` and `[Back to Landing]` buttons; after 2 failed retries, additional hint: "Persistent scan failure — check directory permissions or delete project and recreate." (hint only, no counting logic) |
| 0 groups found | Error alert with same buttons; message "No ASL metadata groups detected"                                                                                                                                                    |
| 1 group only   | Parameter table expanded by default                                                                                                                                                                                         |
| 2-9 groups     | Cards start collapsed by default; parameters table hidden by default (user can expand)                                                                                                                                      |
| 10+ groups     | All cards collapsed by default                                                                                                                                                                                              |

`importStore` BIDS review slice provides `retryBidsScan()` (re-calls `scan_bids_sidecars`, clears `scanError`) and `backToLanding()` (navigate to `/`, abandons project).

#### Scenario: Scan error recovery retry

- **WHEN** `scan_bids_sidecars` returns `Err` and user clicks `[Retry]`
- **THEN** `importStore.retryBidsScan()` clears `scanError` and re-invokes `scan_bids_sidecars`

#### Scenario: Back to landing aborts

- **WHEN** user clicks `[Back to Landing]` on scan error
- **THEN** `importStore.backToLanding()` navigates to `/`; project remains in store but user is out of import flow

### Requirement: Confirmation flow

On `[Confirm]` click, `BIDSReviewPanel` SHALL validate:

- No group label is empty
- No two group labels are duplicates (case-insensitive comparison)

If validation fails: inline errors per offending group; confirmation blocked; `bidsReviewConfirmed` stays `false`.

If validation passes: sync to project store (write `metadataGroups`, `subjectRows`, `ingestionComplete = true`, `skippedSubjects` to `mappingState` and `ImportUiState`); set `uiState.import.bidsReviewConfirmed = true`; set `projectMeta.currentPhase = "parameters"`; save `project.easl`; navigate to `/project/:id/parameters`.

#### Scenario: Confirm with valid unique labels

- **WHEN** user clicks `[Confirm]` with 2 groups labeled `"Philips_PCASL_2D_Absent"` and `"Siemens_3T_PCASL_3D_Included"`
- **THEN** `mappingState.metadataGroups` has 2 entries, `uiState.import.bidsReviewConfirmed = true`, `currentPhase = "parameters"`, navigation goes to Parameters

#### Scenario: Confirm blocked on duplicate

- **WHEN** user clicks `[Confirm]` while Group A and Group B both have label `"Foo"`
- **THEN** both inputs show red border with error message "Label 'Foo' already in use"; confirmation does not proceed

#### Scenario: Confirm blocked on empty

- **WHEN** user clicks `[Confirm]` while any group label is empty string
- **THEN** that input shows error message "Label is required"; confirmation does not proceed

### Requirement: Revisit summary with re-scan/re-confirm

When `uiState.import.bidsReviewConfirmed === true` and user navigates back to Import, `BIDSReviewPanel` SHALL render a persisted summary with an explicit re-scan action:

- Banner: "BIDS metadata groups confirmed. Import is complete."
- Group cards sourced from persisted `mappingState.metadataGroups` and `mappingState.subjectRows`, collapsed by default.
- Skipped subjects warning sourced from persisted `uiState.import.skippedSubjects`.
- `[Re-scan BIDS]` action.

When `[Re-scan BIDS]` succeeds, `BIDSReviewPanel` SHALL render the same editable group-card review state used before first confirmation, including editable labels, skipped-subject warnings, validation, and `[Confirm]`.

Project deletion/editing uses the standard project list flow, not BIDSReviewPanel controls.

#### Scenario: Revisit after confirmation

- **WHEN** user with `bidsReviewConfirmed = true` navigates back to Import page
- **THEN** `BIDSReviewPanel` renders persisted summary with banner, collapsed group cards, skipped subjects warning, and `[Re-scan BIDS]`

#### Scenario: Re-scan enables edit

- **WHEN** user clicks `[Re-scan BIDS]` and the scan succeeds
- **THEN** group labels become editable and `[Confirm]` re-confirms the latest scan result
