# manifest-qc-selection Specification

## Purpose

TBD - created by archiving change project-manifest. Update Purpose after archive.

## Requirements

### Requirement: QcSelection Table Shape

The QC Selection step SHALL render a `DataTable` whose rows mirror the SubjectSelection rows used in the Processing phase (Subject, Session columns + Structural/ASL `ModuleDisplayStatus` as read-only badges). The table SHALL additionally render a "Metadata Group" column showing the row's assigned `MetadataGroup.label` and a "Verdict" column with a `SegmentedControl` offering `Neutral`, `Pass`, `Fail`. The table SHALL NOT include log/report columns or row selection checkboxes — those are Processing-phase concerns.

When `reviewers` contains more than one entry, the QC Selection step SHALL wrap the `DataTable` inside Mantine `Tabs`. Each tab SHALL correspond to one registry entry, use the reviewer's `label`, bind `value` to `activeReviewerId`, and update selection through `setActiveReviewerId`. Each tab panel SHALL render its own table instance scoped to `verdicts[activeReviewerId]`.

When `reviewers` is undefined or contains at most one entry, the `Tabs` wrapper SHALL NOT be rendered. The table SHALL use the flat verdict map and otherwise retain single-reviewer behavior.

#### Scenario: Row shows metadata group label

- **WHEN** a SubjectSession belongs to a `MetadataGroup` with `label: "Philips PCASL"`
- **THEN** the corresponding row's "Metadata Group" column SHALL render `"Philips PCASL"`

#### Scenario: Row with no metadata group assignment

- **WHEN** a SubjectSession's import `SubjectRow` has no `groupId` matching any defined `MetadataGroup`
- **THEN** the "Metadata Group" column SHALL render a dim "Ungrouped" marker; the row SHALL NOT be excluded from the manifest, but SHALL be reported in Section 1 of the manifest under an "Ungrouped" bucket

#### Scenario: Single-reviewer mode renders without tabs

- **WHEN** the `reviewers` array contains exactly one entry (or is `undefined`)
- **THEN** the QC Selection step SHALL render the `DataTable` directly without a `Tabs` wrapper and retain pre-multi-reviewer behavior

#### Scenario: Multi-reviewer mode renders tabbed UI

- **WHEN** the `reviewers` array contains reviewers labeled "Reviewer 1" and "Reviewer 2"
- **THEN** the QC Selection step SHALL render two corresponding tabs, and the active tab SHALL correspond to `activeReviewerId`

### Requirement: Blinded Review Across Tabs

In multi-reviewer mode, a reviewer tab SHALL display only the active reviewer's verdict and staleness values. Each row's SegmentedControl SHALL reflect `verdicts[activeReviewerId][subjectSession]` and SHALL NOT display or indicate another reviewer's verdict for that SubjectSession. Switching tabs SHALL change the displayed reviewer slice without mutating any verdict data.

#### Scenario: Switching tabs shows different reviewer verdicts

- **WHEN** reviewer `r1` set `sub-01_01` to Pass and reviewer `r2` set it to Fail, and the user switches from `r1` to `r2`
- **THEN** the SegmentedControl for `sub-01_01` SHALL change from Pass to Fail

#### Scenario: Tab switch does not mutate verdicts

- **WHEN** the user switches from reviewer `r1` to `r2` and back to `r1`
- **THEN** all verdict values for both reviewers SHALL remain unchanged

#### Scenario: Reviewer cannot infer another verdict

- **WHEN** reviewer `r1` set `sub-01_01` to Fail and active reviewer `r2` has not set a verdict for it
- **THEN** the `r2` tab SHALL display Neutral with no indicator of `r1`'s verdict

### Requirement: Per-Reviewer Completion Badge

In multi-reviewer mode, each reviewer tab SHALL display an inline completion badge showing non-Neutral verdicts versus total eligible rows for that reviewer in `"N / Total"` format. No Info rows SHALL be excluded from numerator and denominator. The badge SHALL update live as verdicts are set.

#### Scenario: Badge reflects partial completion

- **WHEN** reviewer `r1` has verdicts for 30 of 50 eligible SubjectSessions and 5 additional rows are No Info
- **THEN** the `r1` tab SHALL display `"30 / 50"`

#### Scenario: Badge reflects full completion

- **WHEN** reviewer `r1` has verdicts for all 50 eligible SubjectSessions
- **THEN** the `r1` tab SHALL display `"50 / 50"`

### Requirement: Derived No-Info Status

The displayed verdict for a row SHALL be computed as follows, in order:

1. If the Population QC outputs for the SubjectSession (`Coverage.tsv`, `SpatialCoV.tsv`, motion TSV) cannot be located on disk → display "No Info"; the SegmentedControl SHALL be disabled for this row.
2. Otherwise, if a stored verdict exists for the SubjectSession → display its `status` (`Pass` or `Fail`), reading `verdicts[activeReviewerId][subjectSession]` in multi-reviewer mode and `verdicts[subjectSession]` in single-reviewer mode.
3. Otherwise → display "Neutral".

No Info SHALL NOT be a user-settable state.

#### Scenario: Missing QC outputs disable verdict control

- **WHEN** a SubjectSession's Population output directory is absent or empty of QC CSVs
- **THEN** the row SHALL render a "No Info" badge in place of the SegmentedControl and the SegmentedControl SHALL NOT be rendered or be interactive

#### Scenario: Stored verdict displayed for active reviewer

- **WHEN** `activeReviewerId` is `r1` and `verdicts["r1"]["sub-X_01"].status === "fail"`
- **THEN** the row's SegmentedControl SHALL render with value `"Fail"`

### Requirement: Filter Chips With Counts

The QC Selection step SHALL display a `SegmentedControl` filter with five options, each annotated with a count badge: `All`, `Neutral`, `Pass`, `Fail`, `No Info`. Selecting a filter SHALL restrict visible rows to those matching that status. The default SHALL be `All`. In multi-reviewer mode, statuses and counts SHALL be scoped to `verdicts[activeReviewerId]` only.

#### Scenario: All filter selected on first render

- **WHEN** the QC Selection step mounts
- **THEN** the default filter SHALL be `All` and the table SHALL show all rows whose displayed verdict is any of the options

#### Scenario: Counts scoped to active reviewer

- **WHEN** reviewer `r1` has 30 Pass, 15 Fail, and 5 Neutral verdicts while reviewer `r2` has different counts, and `activeReviewerId` is `r1`
- **THEN** the filter counts SHALL display Pass 30, Fail 15, and Neutral 5 from `r1` only

#### Scenario: Counts update live

- **WHEN** the user toggles a row from Neutral to Pass and the displayed verdict becomes Pass
- **THEN** the count badge for `Neutral` SHALL decrement by 1, the count badge for `Pass` SHALL increment by 1, and if the active filter is `Neutral` the row SHALL no longer be visible

### Requirement: Neutral Gate For Step Progression

The stepper's "Next" button proceeding from QC Selection SHALL be disabled whenever any required reviewer has at least one eligible Neutral row. In multi-reviewer mode, the gate SHALL evaluate all reviewers, not only the active reviewer or current filter. In single-reviewer mode, it SHALL evaluate the flat verdict map. The gate SHALL be re-evaluated on every verdict change. No Info rows SHALL NOT block progression or appear in manifest aggregation.

#### Scenario: Next disabled while any reviewer has Neutral rows

- **WHEN** reviewer `r1` has resolved all verdicts but reviewer `r2` still has 3 eligible Neutral rows
- **THEN** the Next button SHALL be disabled and SHALL display a tooltip indicating that all reviewers must resolve Neutral verdicts

#### Scenario: Next enabled after all reviewers resolve eligible rows

- **WHEN** the last eligible Neutral row for every required reviewer is set to Pass or Fail
- **THEN** the stepper's Next button SHALL become enabled

#### Scenario: Single-reviewer gate unchanged

- **WHEN** one reviewer exists (or `reviewers` is `undefined`) and all eligible rows are non-Neutral
- **THEN** the Next button SHALL be enabled, consistent with pre-multi-reviewer behavior

### Requirement: Bulk Mark Complete As Pass

The QC Selection step SHALL provide a bulk action labeled "Mark all complete→Pass" that sets Pass on every row whose Structural and ASL `ModuleDisplayStatus` are both `complete` and whose displayed verdict is not No Info. Rows already set to another verdict SHALL be overwritten. In multi-reviewer mode, the action SHALL write only to `verdicts[activeReviewerId]`; other reviewer slices SHALL remain unchanged.

#### Scenario: Bulk action scoped to active reviewer

- **WHEN** `activeReviewerId` is `r1`, 50 rows are complete, and the bulk action is invoked
- **THEN** 50 verdicts SHALL be set to Pass in `verdicts["r1"]` only, while other reviewer slices remain unchanged

#### Scenario: Bulk action skips No Info rows

- **WHEN** the bulk action is invoked and 50 rows are `complete`, 2 rows are `No Info`, and 10 rows are incomplete
- **THEN** 50 verdicts SHALL be set to `pass`, the 2 No Info rows SHALL remain without a stored verdict, and the 10 incomplete rows SHALL remain Neutral unless manually triaged

#### Scenario: Bulk action is idempotent

- **WHEN** the bulk action is invoked twice for the same active reviewer
- **THEN** the resulting active-reviewer verdict slice SHALL be identical between invocations

### Requirement: Stale Verdict Indicator

Rows whose stored verdict's `setAt` mtime does not match the current completion mtime of prior modules (Structural, ASL) SHALL render a "Stale" pill next to the SegmentedControl. In multi-reviewer mode, the table SHALL read only `staleVerdicts[activeReviewerId]`; another reviewer's staleness SHALL not be exposed. Toggling a stale row SHALL update only the active reviewer's verdict and set its `setAt` to the current prior-module completion mtime, clearing that reviewer-row staleness.

#### Scenario: Stale pill shown for mismatched mtime

- **WHEN** the current prior modules' completion mtime is `1700000060000` and the active reviewer's verdict has `setAt: 1700000000000`
- **THEN** the row SHALL render a pill labeled "Stale" adjacent to the Verdict SegmentedControl

#### Scenario: Toggling stale verdict clears staleness

- **WHEN** the user toggles a stale row from Pass to Fail on the active reviewer's tab
- **THEN** the active reviewer's stored verdict SHALL become `{ status: "fail", setAt: <current prior modules' completion mtime> }` and the Stale pill SHALL disappear on that tab
