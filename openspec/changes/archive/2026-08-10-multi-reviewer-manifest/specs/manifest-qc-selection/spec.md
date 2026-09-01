# manifest-qc-selection — Multi-Reviewer Manifest Delta

## MODIFIED Requirements

**Notation:** Scenario identifiers such as `r1` and `r2` are readable aliases for distinct valid reviewer UUID values. When an alias appears as a reviewer ID, an `activeReviewerId`, or a verdict-map key, it denotes its corresponding UUID value.

### Requirement: QcSelection Table Shape

The QC Selection step SHALL render a `DataTable` whose rows mirror the SubjectSelection rows used in the Processing phase (Subject, Session columns + Structural/ASL `ModuleDisplayStatus` as read-only badges). The table SHALL additionally render a "Metadata Group" column showing the row's assigned `MetadataGroup.label` and a "Verdict" column with a `SegmentedControl` offering `Neutral`, `Pass`, `Fail`. The table SHALL NOT include log/report columns or row selection checkboxes — those are Processing-phase concerns.

When `reviewers` contains more than one entry (multi-reviewer mode), the QC Selection step SHALL wrap the `DataTable` inside a Mantine `Tabs` component. Each tab SHALL correspond to one reviewer from the `reviewers` array, using the reviewer's `label` as the tab label. The `Tabs` component SHALL set `value` to `activeReviewerId` and update it via `setActiveReviewerId` on tab change. Each tab panel SHALL render its own `DataTable` instance scoped to the active reviewer's verdict slice — the SegmentedControl for each row SHALL read from and write to `verdicts[activeReviewerId][subjectSession]` only.

When `reviewers` is undefined or contains at most one entry (single-reviewer mode), the `Tabs` wrapper SHALL NOT be rendered. The table SHALL use the flat verdict map and otherwise behave identically to the pre-multi-reviewer specification.

#### Scenario: Row shows metadata group label

- **WHEN** a SubjectSession belongs to a `MetadataGroup` with `label: "Philips PCASL"`
- **THEN** the corresponding row's "Metadata Group" column SHALL render `"Philips PCASL"`

#### Scenario: Row with no metadata group assignment

- **WHEN** a SubjectSession has no `groupId` matching a defined `MetadataGroup`
- **THEN** the Metadata Group column SHALL render a dim `"Ungrouped"` marker and the row SHALL remain in the manifest

#### Scenario: Single-reviewer mode renders without tabs

- **WHEN** the `reviewers` array contains exactly one entry (or is `undefined`)
- **THEN** the QC Selection step SHALL render the `DataTable` directly without any `Tabs` wrapper, and behavior SHALL be identical to the pre-multi-reviewer specification

#### Scenario: Multi-reviewer mode renders tabbed UI

- **WHEN** the `reviewers` array contains `[{ id: "r1", label: "Reviewer 1" }, { id: "r2", label: "Reviewer 2" }]`
- **THEN** the QC Selection step SHALL render a `Tabs` component with two tabs labeled "Reviewer 1" and "Reviewer 2", and the active tab SHALL correspond to `activeReviewerId`

### Requirement: Blinded Review Across Tabs

In multi-reviewer mode, a reviewer tab SHALL display only the active reviewer's verdict values. The SegmentedControl in each row SHALL reflect `verdicts[activeReviewerId][subjectSession]` and SHALL NOT display or indicate any other reviewer's verdict for the same SubjectSession. Switching tabs SHALL change which reviewer's verdicts are displayed but SHALL NOT mutate any verdict data. This enforces blinded independent review — a reviewer cannot see another reviewer's verdict values.

#### Scenario: Switching tabs shows different reviewer verdicts

- **WHEN** reviewer `"r1"` has set `"sub-01_01"` to `"pass"` and reviewer `"r2"` has set `"sub-01_01"` to `"fail"`, and the user switches from the `"r1"` tab to the `"r2"` tab
- **THEN** the SegmentedControl for `"sub-01_01"` SHALL change from displaying `"Pass"` to displaying `"Fail"`

#### Scenario: Tab switch does not mutate verdicts

- **WHEN** the user switches from the `"r1"` tab to the `"r2"` tab and back to `"r1"`
- **THEN** all verdict values for both reviewers SHALL remain unchanged; no verdict SHALL be overwritten or cleared by the tab switch

#### Scenario: Reviewer cannot infer other reviewer's verdict

- **WHEN** reviewer `"r1"` has set `"sub-01_01"` to `"fail"` and the active tab is `"r2"` who has not set a verdict for `"sub-01_01"`
- **THEN** the row for `"sub-01_01"` on the `"r2"` tab SHALL display `"Neutral"`, with no visual indicator of `"r1"`'s verdict

### Requirement: Per-Reviewer Completion Badge

In multi-reviewer mode, each reviewer tab SHALL display a completion badge showing the ratio of resolved (non-Neutral) verdicts to total eligible rows for that reviewer (e.g. `"42/50"`). The badge SHALL be rendered inline with the tab label. No Info rows SHALL be excluded from both the numerator and denominator. The badge SHALL update live as verdicts are set.

#### Scenario: Badge reflects partial completion

- **WHEN** reviewer `"r1"` has set verdicts on 30 of 50 eligible SubjectSessions (20 remain Neutral) and 5 rows are No Info
- **THEN** the tab for `"r1"` SHALL display a badge reading `"30/50"` (55 total minus 5 No Info = 50 eligible)

#### Scenario: Badge reflects full completion

- **WHEN** reviewer `"r1"` has set verdicts on all 50 eligible SubjectSessions
- **THEN** the tab for `"r1"` SHALL display a badge reading `"50/50"`

### Requirement: Derived No-Info Status

The displayed verdict for a row SHALL be computed as follows, in order:

1. If the Population QC outputs for the SubjectSession (`Coverage.tsv`, `SpatialCoV.tsv`, motion TSV) cannot be located on disk → display "No Info"; the SegmentedControl SHALL be disabled for this row.
2. Otherwise, if a stored verdict exists for the SubjectSession → display its `status` (`Pass` or `Fail`): read `verdicts[activeReviewerId][subjectSession]` in multi-reviewer mode and `verdicts[subjectSession]` in single-reviewer mode.
3. Otherwise → display "Neutral".

No Info SHALL NOT be a user-settable state.

#### Scenario: Missing QC outputs disable verdict control

- **WHEN** a SubjectSession's Population output directory is absent or empty of QC CSVs
- **THEN** the row SHALL render a "No Info" badge in place of the SegmentedControl and the SegmentedControl SHALL NOT be rendered or be interactive

#### Scenario: Stored verdict displayed

- **WHEN** `activeReviewerId` is `"r1"` and `verdicts["r1"]["sub-X_01"].status === "fail"`
- **THEN** the row's SegmentedControl SHALL render with value `"Fail"`

### Requirement: Filter Chips With Counts

The QC Selection step SHALL display a `SegmentedControl` filter with five options, each annotated with a count badge: `All`, `Neutral`, `Pass`, `Fail`, `No Info`. Selecting a filter SHALL restrict the visible rows to those matching that status. The default selected filter SHALL be `All`. In multi-reviewer mode, filter chip counts SHALL be scoped to the active reviewer — each count SHALL reflect the number of rows matching that status based on `verdicts[activeReviewerId]` only.

#### Scenario: All filter selected on first render

- **WHEN** the QC Selection step mounts
- **THEN** the default filter SHALL be `All` and the table SHALL show all rows

#### Scenario: Counts scoped to active reviewer

- **WHEN** reviewer `"r1"` has 30 Pass, 15 Fail, and 5 Neutral verdicts, and reviewer `"r2"` has 20 Pass, 10 Fail, and 20 Neutral verdicts, and `activeReviewerId` is `"r1"`
- **THEN** the filter chip counts SHALL display `Pass: 30`, `Fail: 15`, `Neutral: 5` (reflecting `"r1"`'s verdicts, not `"r2"`'s)

#### Scenario: Counts update live

- **WHEN** the user toggles a row from Neutral to Pass on the active reviewer's tab
- **THEN** the count badge for `Neutral` SHALL decrement by 1 and the count badge for `Pass` SHALL increment by 1

### Requirement: Neutral Gate For Step Progression

The stepper's "Next" button (proceeding from QC Selection) SHALL be disabled whenever ANY reviewer has at least one row whose displayed verdict is `Neutral` AND that row's status is not `No Info`. In multi-reviewer mode, the gate SHALL evaluate across ALL reviewers — not just the active reviewer. The gate SHALL be re-evaluated on every verdict change. No Info rows SHALL NOT block progression.

#### Scenario: Next disabled while any reviewer has Neutral rows

- **WHEN** reviewer `"r1"` has resolved all verdicts but reviewer `"r2"` still has 3 Neutral rows
- **THEN** the stepper's Next button SHALL be disabled and SHALL display a tooltip indicating that all reviewers must resolve their Neutral verdicts

#### Scenario: Next disabled while any Neutral row exists

- **WHEN** at least one eligible row is Neutral for any required reviewer
- **THEN** the stepper's Next button SHALL be disabled

#### Scenario: Next enabled after all reviewers resolve all verdicts

- **WHEN** the last Neutral row across all reviewers is set to Pass or Fail
- **THEN** the stepper's Next button SHALL become enabled

#### Scenario: Next enabled after all visible rows resolved

- **WHEN** the last eligible Neutral row is set to Pass or Fail for every required reviewer
- **THEN** the stepper's Next button SHALL become enabled

#### Scenario: Single-reviewer gate unchanged

- **WHEN** there is one reviewer (or `reviewers` is `undefined`) and all rows are non-Neutral
- **THEN** the stepper's Next button SHALL be enabled, consistent with pre-multi-reviewer behavior

### Requirement: Bulk Mark Complete As Pass

The QC Selection step SHALL provide a bulk action labeled "Mark all complete→Pass" that, when invoked, SHALL set a Pass verdict on every row whose Structural and ASL `ModuleDisplayStatus` are both `complete` and whose displayed verdict is not already `No Info`. In multi-reviewer mode, the bulk action SHALL scope to the active reviewer only — it SHALL write verdicts only to `verdicts[activeReviewerId]` and SHALL NOT affect other reviewers' verdict slices. Rows already set to a different verdict SHALL be overwritten.

#### Scenario: Bulk action scoped to active reviewer

- **WHEN** `activeReviewerId` is `"r1"`, the bulk action is invoked, and 50 rows are `complete`
- **THEN** 50 verdicts SHALL be set to `pass` in `verdicts["r1"]` only; `verdicts["r2"]` SHALL remain unchanged

#### Scenario: Bulk action skips No Info rows

- **WHEN** the bulk action is invoked and 50 rows are `complete`, 2 rows are `No Info`, and 10 rows are incomplete
- **THEN** 50 verdicts SHALL be set to `pass` for the active reviewer, the 2 No Info rows SHALL remain without a stored verdict, and the 10 incomplete rows SHALL remain Neutral unless manually triaged

#### Scenario: Bulk action is idempotent

- **WHEN** the bulk action is invoked twice in a row for the same active reviewer
- **THEN** the resulting `verdicts[activeReviewerId]` SHALL be identical between the two invocations

### Requirement: Stale Verdict Indicator

Rows whose stored verdict's `setAt` mtime does not match the current completion mtime of the prior modules (Structural, ASL) SHALL render a "Stale" pill next to the SegmentedControl. In multi-reviewer mode, the table SHALL read only `staleVerdicts[activeReviewerId]`; a row SHALL display the "Stale" pill only when the active reviewer's verdict for that SubjectSession is stale. The table SHALL NOT read or derive indicators from another reviewer's staleness slice. Toggling the SegmentedControl on a stale row SHALL update the active reviewer's verdict AND set its `setAt` to the current prior modules' completion mtime, clearing staleness for that row and reviewer.

#### Scenario: Stale pill shown for mismatched mtime

- **WHEN** the current prior modules' completion mtime is `1700000060000` and the active reviewer's verdict has `setAt: 1700000000000`
- **THEN** the row SHALL render a pill labeled "Stale" adjacent to the Verdict SegmentedControl

#### Scenario: Toggling stale verdict clears staleness

- **WHEN** the user toggles a stale row from Pass to Fail on the active reviewer's tab
- **THEN** the active reviewer's stored verdict SHALL become `{ status: "fail", setAt: <current prior modules' completion mtime> }` and the Stale pill SHALL disappear for the active reviewer's tab
