# verdict-resolution Specification

## Purpose

Defines the conditional Verdict Resolution step that appears when multiple reviewers' verdicts disagree. The step presents disagreements side-by-side, provides quick-access viewers for images/metrics/logs, and requires all disagreements to be resolved before proceeding to Preview & Export.

## Requirements

### Requirement: Disagreement Computation

The manifest store SHALL compute disagreements by comparing all reviewers' verdicts for each subjectSession. A disagreement SHALL exist for a given subjectSession when any two reviewers' verdicts differ on `status` (i.e., one reviewer has `"pass"` and another has `"fail"`). SubjectSessions where all reviewers agree on `status` SHALL NOT be considered disagreements, regardless of differences in `reason` or `notes`.

SubjectSessions where any reviewer has no verdict (Neutral) SHALL NOT be included in disagreement computation — the multi-reviewer Next gate ensures all reviewers have completed verdicts before this step is reachable.

The computed disagreements SHALL be exposed as an array of objects: `{ subjectSession: string, verdictsByReviewer: Record<reviewerId, ManifestVerdict> }`.

#### Scenario: Pass vs Fail is a disagreement

- **WHEN** Reviewer A has `status: "pass"` and Reviewer B has `status: "fail"` for `"sub-01_01"`
- **THEN** `"sub-01_01"` SHALL appear in the disagreements array with both reviewers' full verdict objects

#### Scenario: Same status with different reasons is NOT a disagreement

- **WHEN** Reviewer A has `{ status: "fail", reason: "motion" }` and Reviewer B has `{ status: "fail", reason: "coverage" }` for `"sub-02_01"`
- **THEN** `"sub-02_01"` SHALL NOT appear in the disagreements array

#### Scenario: Three reviewers with mixed verdicts

- **WHEN** Reviewer A has `"pass"`, Reviewer B has `"pass"`, and Reviewer C has `"fail"` for `"sub-03_01"`
- **THEN** `"sub-03_01"` SHALL appear in the disagreements array because Reviewer C disagrees with Reviewers A and B

#### Scenario: Unanimous agreement excluded

- **WHEN** all reviewers have `status: "pass"` for `"sub-04_01"`
- **THEN** `"sub-04_01"` SHALL NOT appear in the disagreements array

### Requirement: Conditional Resolution Step

The Verdict Resolution step SHALL appear in the manifest stepper ONLY when `disagreements.length > 0`. When all reviewers unanimously agree on all subjectSessions, the stepper SHALL skip directly from QC Selection to Preview & Export (2-step flow). When disagreements exist, the stepper SHALL show 3 steps: QC Selection → Verdict Resolution → Preview & Export.

#### Scenario: Resolution step shown when disagreements exist

- **WHEN** disagreement computation yields 7 subjectSessions with conflicting verdicts
- **THEN** the manifest stepper SHALL render 3 steps, with "Verdict Resolution" as the second step, and the step label SHALL indicate the disagreement count (e.g., "Verdict Resolution (7)")

#### Scenario: Resolution step skipped when unanimous

- **WHEN** all reviewers agree on all subjectSessions (zero disagreements)
- **THEN** the manifest stepper SHALL render 2 steps: "QC Selection" and "Preview & Export"; no "Verdict Resolution" step SHALL be visible

#### Scenario: Resolution step appears after re-evaluation

- **WHEN** the user navigates back to QC Selection from Preview & Export, changes a verdict that introduces a disagreement, and clicks Next
- **THEN** the stepper SHALL re-evaluate disagreements, detect the new disagreement, and display the "Verdict Resolution" step

### Requirement: Resolution DataTable

The Verdict Resolution step SHALL render a `DataTable` displaying all subjectSessions with disagreements. The table SHALL contain the following columns:

1. **Subject** — the subject identifier extracted from the subjectSession string.
2. **Session** — the session identifier extracted from the subjectSession string.
3. **Reviewer N columns** — one column per reviewer, each displaying that reviewer's verdict `status` with a visual indicator (✅ Pass / ❌ Fail) and, when status is `"fail"`, the `reason` displayed beneath.
4. **Final Verdict** — a `SegmentedControl` with `Pass` / `Fail` options plus a reason `Select` (shown when Fail is selected) and an optional notes `TextInput` for resolution rationale.
5. **Actions** — quick-access action buttons (see Resolution Quick-Access Actions requirement).

The table SHALL prioritize width according to column content. Subject SHALL use width `140`, Session SHALL use width `90`, each reviewer column SHALL use width `150`, Final Verdict SHALL use width `320`, and Actions SHALL use responsive width `30%`. The Actions group SHALL wrap when its cell becomes constrained so every action retains its full label rather than being clipped. At widths below the table's practical minimum, horizontal scrolling MAY expose columns while action labels remain intact.

#### Scenario: Table renders all disagreements

- **WHEN** 7 disagreements exist across 50 subjectSessions
- **THEN** the Resolution DataTable SHALL render exactly 7 rows, one per disagreeing subjectSession

#### Scenario: Reviewer columns show individual verdicts

- **WHEN** the table renders a row for `"sub-01_01"` where Reviewer 1 has Pass and Reviewer 2 has Fail with reason "motion"
- **THEN** the Reviewer 1 column SHALL display "✅ Pass" and the Reviewer 2 column SHALL display "❌ Fail" with "motion" shown beneath

#### Scenario: Final verdict SegmentedControl defaults to unset

- **WHEN** a disagreement row has not yet been resolved
- **THEN** the Final Verdict column's SegmentedControl SHALL have no segment selected (or a distinct "Unresolved" state) and the row SHALL be visually distinguished as pending resolution

#### Scenario: Desktop layout prioritizes verdict and action content

- **WHEN** the Resolution DataTable is displayed at standard desktop width with two reviewers
- **THEN** Subject, Session, and reviewer columns SHALL remain compact, Final Verdict SHALL have sufficient space for its controls, and all three action labels SHALL appear in full on one line when space permits

#### Scenario: Constrained action column wraps without clipping

- **WHEN** the available table width constrains the Actions column
- **THEN** the action buttons SHALL wrap onto additional lines as needed, the row SHALL grow vertically, and the labels "View Images/Reports", "QC Metrics", and "View Logs" SHALL remain fully readable

### Requirement: Resolution Quick-Access Actions

Each row in the Resolution DataTable SHALL provide three quick-access action buttons:

1. **View Images/Reports** — SHALL open the existing `ReportViewerModal` for the subjectSession, allowing the resolver to review QC images (CBF maps, structural overlays, etc.).
2. **View QC Metrics** — SHALL open a popover displaying the subjectSession's QC metric values: coverage percentage, Spatial Coefficient of Variation, motion (max across runs in mm RMS), and motion exclusion percentage.
3. **View Logs** — SHALL open the existing `LogViewerModal` for the subjectSession, allowing the resolver to inspect processing logs.

#### Scenario: View Images/Reports button opens ReportViewerModal

- **WHEN** the user clicks the "View Images/Reports" button on a disagreement row for `"sub-01_01"`
- **THEN** the `ReportViewerModal` SHALL open with the QC reports for `"sub-01_01"` pre-loaded

#### Scenario: View QC Metrics popover displays values

- **WHEN** the user clicks the "View QC Metrics" button on a disagreement row for `"sub-01_01"` whose QC outputs report coverage 78.2%, SpatialCoV 0.42, motion 1.3 mm, motion exclusion 5%
- **THEN** a popover SHALL display a table with rows: Coverage: 78.2%, SpatialCoV: 0.42, Motion: 1.3 mm, Motion Exclusion: 5%

#### Scenario: View Logs button opens LogViewerModal

- **WHEN** the user clicks the "View Logs" button on a disagreement row for `"sub-01_01"`
- **THEN** the `LogViewerModal` SHALL open with the processing log for `"sub-01_01"` pre-loaded

### Requirement: Resolved Verdict Storage

Resolutions SHALL be stored in a new `resolvedVerdicts` field on `ManifestUiStateSchema` with Zod shape:

```typescript
resolvedVerdicts: z.record(z.string(), ManifestVerdictSchema).optional()
```

The record SHALL be keyed by subjectSession string. Each entry SHALL be a standard `ManifestVerdict` object (`{ status, reason?, notes?, setAt }`). No resolver identity SHALL be tracked — the resolution simply records the final verdict per subjectSession.

The `resolvedVerdicts` field SHALL be `undefined` when no resolutions have been recorded and SHALL be cleared when the manifest reverts to single-reviewer mode.

#### Scenario: Setting a resolved verdict persists correctly

- **WHEN** the user selects "Fail" with reason "motion" and notes "Low CBF quality" for `"sub-01_01"` in the Resolution DataTable
- **THEN** `uiState.manifest.resolvedVerdicts["sub-01_01"]` SHALL equal `{ status: "fail", reason: "motion", notes: "Low CBF quality", setAt: <current prior-module mtime> }`

#### Scenario: Resolved verdict overwrites previous resolution

- **WHEN** `"sub-01_01"` already has a resolved verdict of Pass and the user changes it to Fail with reason "artifact"
- **THEN** `resolvedVerdicts["sub-01_01"]` SHALL be updated to `{ status: "fail", reason: "artifact", setAt: <current mtime> }` and no trace of the previous Pass resolution SHALL remain

#### Scenario: Resolved verdicts cleared on revert to single-reviewer

- **WHEN** `removeReviewer` is called and the manifest reverts to single-reviewer mode
- **THEN** `resolvedVerdicts` SHALL be set to `undefined`

#### Scenario: Resolved verdict survives save and reload

- **WHEN** the user resolves a disagreement, saves the project, closes and reopens the GUI
- **THEN** `uiState.manifest.resolvedVerdicts` SHALL contain the same resolved verdict with the same values

### Requirement: Resolution Gate For Preview

The stepper's "Next" button on the Verdict Resolution step (proceeding to Preview & Export) SHALL be disabled whenever any disagreement subjectSession lacks a corresponding entry in `resolvedVerdicts`. The gate SHALL be re-evaluated on every resolution change.

#### Scenario: Next disabled with unresolved disagreements

- **WHEN** 7 disagreements exist and only 5 have entries in `resolvedVerdicts`
- **THEN** the "Next" button SHALL be disabled and SHALL display a tooltip "2 disagreements remaining"

#### Scenario: Next enabled when all disagreements resolved

- **WHEN** all 7 disagreements have corresponding entries in `resolvedVerdicts`
- **THEN** the "Next" button SHALL be enabled

#### Scenario: Changing a verdict in QC Selection re-evaluates gate

- **WHEN** the user navigates back to QC Selection, changes a verdict that creates a new disagreement, and returns to Verdict Resolution
- **THEN** the new disagreement SHALL appear in the DataTable, it SHALL lack a resolved verdict, and the "Next" button SHALL be disabled until resolved

### Requirement: Bulk Resolution Actions

The Verdict Resolution step SHALL provide bulk resolution buttons labeled "Resolve all as Reviewer N" for each reviewer in the registry. Clicking a bulk resolution button SHALL set `resolvedVerdicts[subjectSession]` to match the specified reviewer's verdict for every unresolved disagreement. Already-resolved disagreements SHALL NOT be overwritten by the bulk action.

#### Scenario: Bulk resolve as Reviewer 1

- **WHEN** 7 disagreements exist (all unresolved) and the user clicks "Resolve all as Reviewer 1"
- **THEN** all 7 `resolvedVerdicts` entries SHALL match Reviewer 1's verdicts (`status`, `reason`, `notes` copied from Reviewer 1's verdict; `setAt` set to current prior-module mtime)

#### Scenario: Bulk resolve skips already-resolved items

- **WHEN** 7 disagreements exist, 3 are already resolved, and the user clicks "Resolve all as Reviewer 2"
- **THEN** the 4 unresolved disagreements SHALL be set to match Reviewer 2's verdicts; the 3 previously resolved disagreements SHALL retain their existing resolutions

#### Scenario: Bulk resolve enables Next button

- **WHEN** all disagreements are unresolved and the user clicks "Resolve all as Reviewer 1"
- **THEN** the "Next" button SHALL become enabled immediately after the bulk action completes
