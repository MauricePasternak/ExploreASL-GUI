# multi-reviewer-verdicts Specification

## Purpose

Defines how verdicts are stored, accessed, and tracked in multi-reviewer mode. Verdicts become reviewer-indexed (`Record<reviewerId, Record<subjectSession, ManifestVerdict>>`). Each reviewer works in isolation (blinded review), and the "Next" gate requires all reviewers to complete their verdicts before proceeding.

## Requirements

**Notation:** Scenario identifiers such as `r1`, `r2`, `reviewer-abc`, and `reviewer-xyz` are readable aliases for distinct valid reviewer UUID values. When an alias appears as a reviewer ID, an `activeReviewerId`, or a verdict-map key, it denotes its corresponding UUID value.

### Requirement: Multi-Reviewer Verdict Storage Shape

When in multi-reviewer mode (i.e., `reviewers` array contains 2+ entries), `ManifestUiStateSchema.verdicts` SHALL have the shape `Record<reviewerId, Record<subjectSession, ManifestVerdict>>`, where each top-level key is a reviewer's UUID `id` and each nested record maps subjectSession strings to `ManifestVerdict` objects.

In single-reviewer mode (i.e., `reviewers` is `undefined` or contains at most one entry), `verdicts` SHALL retain the existing flat shape `Record<subjectSession, ManifestVerdict>` as defined in the current `manifest-verdicts` spec.

#### Scenario: Multi-reviewer verdicts stored under reviewer IDs

- **WHEN** two reviewers exist with IDs `"r1"` and `"r2"`, and each has set verdicts for `"sub-01_01"`
- **THEN** `uiState.manifest.verdicts` SHALL have shape `{ "r1": { "sub-01_01": { status: "pass", setAt: ... } }, "r2": { "sub-01_01": { status: "fail", reason: "motion", setAt: ... } } }`

#### Scenario: Single-reviewer verdicts remain flat

- **WHEN** `reviewers` is `undefined` and a verdict is set for `"sub-01_01"`
- **THEN** `uiState.manifest.verdicts` SHALL have shape `{ "sub-01_01": { status: "pass", setAt: ... } }` (no reviewer ID nesting)

#### Scenario: Transitioning to multi-reviewer wraps existing verdicts

- **WHEN** `addReviewer` is called on a project with existing flat verdicts `{ "sub-01_01": { status: "pass", setAt: 1700000000000 } }`
- **THEN** the existing verdicts SHALL be wrapped under the first reviewer's ID: `{ "r1-uuid": { "sub-01_01": { status: "pass", setAt: 1700000000000 } } }`, preserving all original verdict data

### Requirement: Scoped setManifestVerdict Action

`projectStore.setManifestVerdict` SHALL accept an optional `reviewerId` parameter. The action's behavior SHALL be:

1. In multi-reviewer mode: if `reviewerId` is provided, write the verdict under `verdicts[reviewerId][subjectSession]`; if `reviewerId` is omitted, default to `activeReviewerId`.
2. In single-reviewer mode: ignore `reviewerId` and write directly to `verdicts[subjectSession]` (existing behavior).
3. The verdict's `setAt` SHALL be set to the current prior-module completion mtime, as per the existing `manifest-verdicts` spec.

The action SHALL reject (Zod parse failure) if `status === "fail"` and no `reason` is provided, consistent with the existing `ManifestVerdictSchema` constraint.

#### Scenario: Verdict written to specified reviewer in multi-reviewer mode

- **WHEN** `setManifestVerdict("sub-01_01", "pass", {}, "reviewer-abc")` is called in multi-reviewer mode
- **THEN** the verdict SHALL be stored at `verdicts["reviewer-abc"]["sub-01_01"]` and no other reviewer's verdicts SHALL be affected

#### Scenario: Verdict defaults to activeReviewerId when reviewerId omitted

- **WHEN** `setManifestVerdict("sub-02_01", "fail", { reason: "motion" })` is called in multi-reviewer mode with `activeReviewerId` set to `"reviewer-xyz"`
- **THEN** the verdict SHALL be stored at `verdicts["reviewer-xyz"]["sub-02_01"]`

#### Scenario: Single-reviewer mode ignores reviewerId parameter

- **WHEN** `setManifestVerdict("sub-03_01", "pass", {}, "some-id")` is called in single-reviewer mode
- **THEN** the verdict SHALL be stored at `verdicts["sub-03_01"]` (flat), not nested under any reviewer ID

#### Scenario: Fail without reason rejected in multi-reviewer mode

- **WHEN** `setManifestVerdict("sub-04_01", "fail", {}, "reviewer-abc")` is called without a `reason`
- **THEN** the call SHALL be rejected with a Zod validation error and no verdict SHALL be written

### Requirement: Per-Reviewer Staleness Tracking

In multi-reviewer mode, staleness SHALL be evaluated independently for every reviewer. A reviewer's verdict for a given subjectSession SHALL be considered stale iff that specific verdict's `setAt` differs from the current maximum completion mtime of the prior modules (Structural, ASL). The store SHALL compute every reviewer slice and expose `staleVerdicts` as `Record<reviewerId, Set<subjectSession>>`, including an empty `Set` for each reviewer with no stale verdicts. In single-reviewer mode, the store SHALL retain the existing flat `Set<subjectSession>` representation (or its equivalent single-reviewer helper).

The QC Selection UI SHALL select only `staleVerdicts[activeReviewerId]` in multi-reviewer mode. It SHALL NOT read, render, or derive any indicator from another reviewer's staleness slice, preserving blinded review.

#### Scenario: One reviewer's verdict stale while another's is fresh

- **WHEN** Reviewer A set a verdict at `setAt: 1700000000000` and Reviewer B set a verdict for the same subjectSession at `setAt: 1700000060000`, and the current prior-module mtime is `1700000060000`
- **THEN** Reviewer A's verdict for that subjectSession SHALL be flagged as stale, and Reviewer B's verdict SHALL NOT be flagged as stale

#### Scenario: Multi-reviewer staleness exposes every reviewer slice

- **WHEN** reviewers A and B have verdict slices and only Reviewer A has a stale verdict
- **THEN** `staleVerdicts` SHALL contain both reviewer IDs, with the affected SubjectSession in `staleVerdicts[reviewerAId]` and an empty `staleVerdicts[reviewerBId]`

#### Scenario: Stale pill shown only for active reviewer's verdicts

- **WHEN** the active reviewer tab is "Reviewer 1" and "Reviewer 1" has stale verdicts but "Reviewer 2" does not
- **THEN** the QC Selection table SHALL display "Stale" pills on the affected rows; switching to "Reviewer 2"'s tab SHALL show no "Stale" pills

### Requirement: Blinded Review via Tab Isolation

In multi-reviewer mode, the QC Selection step SHALL render a tabbed interface where each reviewer's tab displays ONLY that reviewer's own verdicts. No reviewer SHALL be able to see, infer, or access another reviewer's verdict data through the QC Selection UI.

Each `Tabs.Panel` SHALL render its own `QcSelectionTable` instance, subscribed exclusively to the active reviewer's verdict slice from `verdicts[activeReviewerId]` and, for stale indicators, `staleVerdicts[activeReviewerId]`. Switching tabs SHALL update `activeReviewerId` and cause the table to re-render with the newly selected reviewer's verdicts and staleness slice.

#### Scenario: Reviewer sees only their own verdicts

- **WHEN** the "Reviewer 1" tab is active and "Reviewer 1" has marked `"sub-01_01"` as Pass but "Reviewer 2" has marked `"sub-01_01"` as Fail
- **THEN** the table SHALL display `"sub-01_01"` with SegmentedControl value "Pass"; "Reviewer 2"'s Fail verdict SHALL NOT be visible anywhere in the UI

#### Scenario: Switching tabs shows different verdicts

- **WHEN** the user switches from "Reviewer 1" tab (which has 30/50 verdicts completed) to "Reviewer 2" tab (which has 10/50 verdicts completed)
- **THEN** the table SHALL re-render showing "Reviewer 2"'s 10 completed verdicts and 40 Neutral rows

#### Scenario: Bulk action scoped to active reviewer

- **WHEN** the "Mark all complete→Pass" bulk action is invoked while "Reviewer 2"'s tab is active
- **THEN** Pass verdicts SHALL be written to `verdicts["reviewer-2-id"]` only; `verdicts["reviewer-1-id"]` SHALL remain unchanged

### Requirement: Per-Reviewer Completion Badges

In multi-reviewer mode, each reviewer tab SHALL display a completion badge showing the count of non-Neutral verdicts versus the total eligible subjectSessions (excluding No Info rows). The badge format SHALL be `"N / Total"` where N is the count of subjectSessions with a verdict (`Pass` or `Fail`) and Total is the count of subjectSessions that are NOT `No Info`.

#### Scenario: Badge shows correct counts

- **WHEN** "Reviewer 1" has set 42 verdicts out of 50 eligible subjectSessions (2 are No Info)
- **THEN** "Reviewer 1"'s tab badge SHALL display `"42 / 50"`

#### Scenario: Badge updates on verdict change

- **WHEN** "Reviewer 1" sets a Neutral subjectSession to Pass
- **THEN** the badge SHALL increment from `"42 / 50"` to `"43 / 50"` without requiring a page reload

#### Scenario: No Info rows excluded from badge total

- **WHEN** a project has 52 subjectSessions, 2 of which are No Info, and "Reviewer 1" has set all 50 eligible verdicts
- **THEN** "Reviewer 1"'s tab badge SHALL display `"50 / 50"`, not `"50 / 52"`

### Requirement: Multi-Reviewer Next Gate

In multi-reviewer mode, the stepper's "Next" button (proceeding from QC Selection) SHALL be disabled unless ALL reviewers have completed all their verdicts (no Neutral remaining for any reviewer, excluding No Info rows). The gate SHALL evaluate across all reviewers, not just the active reviewer.

#### Scenario: Next disabled when one reviewer is incomplete

- **WHEN** "Reviewer 1" has completed all 50 verdicts but "Reviewer 2" has 3 remaining Neutral verdicts
- **THEN** the "Next" button SHALL be disabled and SHALL display a tooltip listing which reviewers have incomplete verdicts (e.g., "Reviewer 2: 3 verdicts remaining")

#### Scenario: Next enabled when all reviewers are complete

- **WHEN** all reviewers in the `reviewers` array have zero Neutral verdicts (excluding No Info rows)
- **THEN** the "Next" button SHALL be enabled

#### Scenario: Adding a new reviewer re-disables Next

- **WHEN** all existing reviewers have completed verdicts and the "Next" button is enabled, then `addReviewer` is called
- **THEN** the "Next" button SHALL become disabled because the new reviewer has zero verdicts (all Neutral)
