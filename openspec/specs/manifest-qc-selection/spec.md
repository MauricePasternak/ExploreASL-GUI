# manifest-qc-selection Specification

## Purpose

Define QC verdict selection for manifest subjects and reviewers.

## Requirements

### Requirement: QcSelection Table Shape

QC Selection SHALL retain Subject/Session columns, read-only Structural/ASL badges, metadata group labels, and Neutral/Pass/Fail controls without Processing log/report or row-selection controls. With multiple reviewers it SHALL render labeled tabs scoped to the active reviewer. With one reviewer it SHALL render the same table without tabs, reading the sole registered reviewer's indexed slice. Missing group assignment SHALL show dim "Ungrouped" and remain included in the manifest's Ungrouped bucket.

#### Scenario: Row shows metadata group label

- **WHEN** a SubjectSession belongs to a named metadata group
- **THEN** its row SHALL show that label

#### Scenario: Row with no metadata group assignment

- **WHEN** its assignment matches no group
- **THEN** the row SHALL show Ungrouped and remain eligible for manifest grouping

#### Scenario: Single-reviewer mode renders without tabs

- **WHEN** exactly one reviewer exists
- **THEN** its table SHALL appear without tabs using its indexed verdicts

#### Scenario: Multi-reviewer mode renders tabbed UI

- **WHEN** multiple reviewers exist
- **THEN** labeled tabs SHALL expose only the active registered slice

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

Missing Population QC data SHALL produce read-only No Info, not a user verdict. Otherwise, a stored verdict SHALL display its status from the active reviewer slice for every reviewer count; absence SHALL display Neutral. No Info rows SHALL not produce stored verdicts.

#### Scenario: Missing QC outputs disable verdict control

- **WHEN** QC output files cannot be located
- **THEN** the row SHALL display No Info without an interactive verdict control

#### Scenario: Stored verdict displayed for active reviewer

- **WHEN** the active registered reviewer's indexed entry is Fail
- **THEN** that row SHALL display Fail

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

Next SHALL require all registered reviewers to rate every eligible SubjectSession, independently of current filters. One reviewer SHALL use the same indexed completion rule. No Info SHALL not block progression or enter aggregation. Every accepted verdict change SHALL refresh the gate.

#### Scenario: Next disabled while any reviewer has Neutral rows

- **WHEN** any registered reviewer lacks an eligible verdict
- **THEN** Next SHALL remain disabled with incomplete-review guidance

#### Scenario: Next enabled after all reviewers resolve eligible rows

- **WHEN** every eligible row has a verdict for every reviewer
- **THEN** Next SHALL become enabled

#### Scenario: Single-reviewer gate unchanged

- **WHEN** the sole reviewer has no eligible Neutral rows
- **THEN** Next SHALL be enabled

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
