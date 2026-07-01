# manifest-qc-selection Specification

## Purpose

TBD - created by archiving change project-manifest. Update Purpose after archive.

## Requirements

### Requirement: QcSelection Table Shape

The QC Selection step SHALL render a `DataTable` whose rows mirror the SubjectSelection rows used in the Processing phase (Subject, Session columns + Structural/ASL `ModuleDisplayStatus` as read-only badges). The table SHALL additionally render a "Metadata Group" column showing the row's assigned `MetadataGroup.label` and a "Verdict" column with a `SegmentedControl` offering `Neutral`, `Pass`, `Fail`. The table SHALL NOT include log/report columns or row selection checkboxes — those are Processing-phase concerns.

#### Scenario: Row shows metadata group label

- **WHEN** a SubjectSession belongs to a `MetadataGroup` with `label: "Philips PCASL"`
- **THEN** the corresponding row's "Metadata Group" column SHALL render `"Philips PCASL"`

#### Scenario: Row with no metadata group assignment

- **WHEN** a SubjectSession's import `SubjectRow` has no `groupId` matching any defined `MetadataGroup`
- **THEN** the "Metadata Group" column SHALL render a dim "Ungrouped" marker; the row SHALL NOT be excluded from the manifest, but SHALL be reported in Section 1 of the manifest under an "Ungrouped" bucket

### Requirement: Derived No-Info Status

The displayed verdict for a row SHALL be computed as follows, in order:

1. If the Population QC outputs for the SubjectSession (`Coverage.tsv`, `SpatialCoV.tsv`, motion TSV) cannot be located on disk → display "No Info"; the SegmentedControl SHALL be disabled for this row.
2. Otherwise, if a stored verdict exists for the SubjectSession → display the verdict's `status` (`Pass` or `Fail`).
3. Otherwise → display "Neutral".

No Info SHALL NOT be a user-settable state.

#### Scenario: Missing QC outputs disable verdict control

- **WHEN** a SubjectSession's Population output directory is absent or empty of QC CSVs
- **THEN** the row SHALL render a "No Info" badge in place of the SegmentedControl and the SegmentedControl SHALL NOT be rendered or be interactive

#### Scenario: Stored verdict displayed

- **WHEN** a SubjectSession has `uiState.manifest.verdicts["sub-X_01"].status === "fail"`
- **THEN** the row's SegmentedControl SHALL render with value `"Fail"`

### Requirement: Filter Chips With Counts

The QC Selection step SHALL display a `SegmentedControl` filter with five options, each annotated with a count badge: `All`, `Neutral`, `Pass`, `Fail`, `No Info`. Selecting a filter SHALL restrict the visible rows to those matching that status. The default selected filter SHALL be `All`.

#### Scenario: All filter selected on first render

- **WHEN** the QC Selection step mounts
- **THEN** the default filter SHALL be `All` and the table SHALL show all rows whose displayed verdict is any of the options

#### Scenario: Counts update live

- **WHEN** the user toggles a row from Neutral to Pass and the displayed verdict becomes Pass
- **THEN** the count badge for `Neutral` SHALL decrement by 1, the count badge for `Pass` SHALL increment by 1, and if the active filter is `Neutral` the row SHALL no longer be visible

### Requirement: Neutral Gate For Step Progression

The stepper's "Next" button (proceeding to Manifest Preview + Export) SHALL be disabled whenever any currently visible row's displayed verdict is `Neutral` AND that row's status is not `No Info`. The gate SHALL be re-evaluated on every verdict change. No Info rows SHALL NOT block progression and SHALL NOT appear in the manifest aggregation.

#### Scenario: Next disabled while any Neutral row exists

- **WHEN** at least one row in the current filter view has a Neutral displayed verdict
- **THEN** the stepper's Next button SHALL be disabled and SHALL display a tooltip "Resolve all Neutral verdicts or exclude via No Info before proceeding"

#### Scenario: Next enabled after all visible rows resolved

- **WHEN** the last Neutral row is set to Pass or Fail
- **THEN** the stepper's Next button SHALL become enabled

### Requirement: Bulk Mark Complete As Pass

The QC Selection step SHALL provide a bulk action labeled "Mark all complete→Pass" that, when invoked, SHALL set a Pass verdict on every row whose Structural and ASL `ModuleDisplayStatus` are both `complete` and whose displayed verdict is not already `No Info`. Rows already set to a different verdict SHALL be overwritten.

#### Scenario: Bulk action skips No Info rows

- **WHEN** the bulk action is invoked and 50 rows are `complete`, 2 rows are `No Info`, and 10 rows are incomplete
- **THEN** 50 verdicts SHALL be set to `pass`, the 2 No Info rows SHALL remain without a stored verdict, and the 10 incomplete rows SHALL remain Neutral unless manually triaged

#### Scenario: Bulk action is idempotent

- **WHEN** the bulk action is invoked twice in a row
- **THEN** the resulting `uiState.manifest.verdicts` SHALL be identical between the two invocations

### Requirement: Stale Verdict Indicator

Rows whose stored verdict's `setAt` mtime does not match the current `999_ready.status` mtime SHALL render a "Stale" pill next to the SegmentedControl. Toggling the SegmentedControl on a stale row SHALL update the verdict AND set its `setAt` to the current `999_ready.status` mtime, clearing staleness for that row.

#### Scenario: Stale pill shown for mismatched mtime

- **WHEN** the current `999_ready.status` mtime is `1700000060000` and a row's stored verdict has `setAt: 1700000000000`
- **THEN** the row SHALL render a pill labeled "Stale" adjacent to the Verdict SegmentedControl

#### Scenario: Toggling stale verdict clears staleness

- **WHEN** the user toggles a stale row from Pass to Fail
- **THEN** the stored verdict SHALL become `{ status: "fail", setAt: <current 999_ready status mtime> }` and the Stale pill SHALL disappear
