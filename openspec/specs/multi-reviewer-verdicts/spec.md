# multi-reviewer-verdicts Specification

## Purpose

Defines reviewer-indexed verdict storage and tab-scoped QC selection. The "Next" gate requires all reviewers to complete their verdicts before proceeding.

## Requirements

**Notation:** Scenario identifiers such as `r1`, `r2`, `reviewer-abc`, and `reviewer-xyz` are readable aliases for distinct valid reviewer UUID values. When an alias appears as a reviewer ID, an `activeReviewerId`, or a verdict-map key, it denotes its corresponding UUID value.

### Requirement: Per-Reviewer Staleness Tracking

Every reviewer SHALL have an indexed staleness result, including empty results and sole-reviewer projects. Staleness SHALL compare nonzero captured prior-module mtime with the current maximum Structural/ASL completion mtime when available. QC selection SHALL display only the active reviewer's stale indicators.

#### Scenario: One reviewer's verdict stale while another's is fresh

- **WHEN** only one nonzero captured timestamp differs from an available current prior-module mtime
- **THEN** only that reviewer's result SHALL include the SubjectSession

#### Scenario: Multi-reviewer staleness exposes every reviewer slice

- **WHEN** a registered reviewer has no stale verdicts
- **THEN** its indexed staleness result SHALL remain empty rather than absent or flat

#### Scenario: Stale pill shown only for active reviewer's verdicts

- **WHEN** the user switches between a stale and fresh reviewer
- **THEN** stale indicators SHALL follow only the selected slice

### Requirement: Reviewer Tab Isolation

Multi-reviewer QC tabs SHALL display the active reviewer's indexed verdict and staleness slices while retaining visible completion badges and allowing tab switching, without claiming access control or strict blinding.

#### Scenario: A user switches between reviewer tabs

- **WHEN** multi-reviewer QC Selection renders or changes its active reviewer
- **THEN** table subscription, badge visibility, and isolation limits SHALL follow these rules:

In multi-reviewer mode, the QC Selection step SHALL render a tabbed interface where each reviewer's table displays only that reviewer's verdicts. Other reviewers' completion counts remain visible in tab badges, and their verdicts are accessible by switching tabs; this is not an access-control or strict blinding mechanism.

Each `Tabs.Panel` SHALL render its own `QcSelectionTable` instance, subscribed exclusively to the active reviewer's verdict slice from `verdicts[activeReviewerId]` and, for stale indicators, `staleVerdicts[activeReviewerId]`. Switching tabs SHALL update `activeReviewerId` and cause the table to re-render with the newly selected reviewer's verdicts and staleness slice.

#### Scenario: Reviewer sees only their own verdicts

- **WHEN** the "Reviewer 1" tab is active and "Reviewer 1" has marked `"sub-01_01"` as Pass but "Reviewer 2" has marked `"sub-01_01"` as Fail
- **THEN** the active table SHALL display `"sub-01_01"` with SegmentedControl value "Pass"; switching to "Reviewer 2" SHALL display that reviewer's Fail verdict

#### Scenario: Switching tabs shows different verdicts

- **WHEN** the user switches from "Reviewer 1" tab (which has 30/50 verdicts completed) to "Reviewer 2" tab (which has 10/50 verdicts completed)
- **THEN** the table SHALL re-render showing "Reviewer 2"'s 10 completed verdicts and 40 Neutral rows

#### Scenario: Bulk action scoped to active reviewer

- **WHEN** the "Mark all complete→Pass" bulk action is invoked while "Reviewer 2"'s tab is active
- **THEN** Pass verdicts SHALL be written to `verdicts["reviewer-2-id"]` only; `verdicts["reviewer-1-id"]` SHALL remain unchanged

### Requirement: Per-Reviewer Completion Badges

In multi-reviewer mode, each reviewer tab SHALL display a completion badge showing the count of non-Neutral verdicts versus the total eligible subjectSessions (excluding No Info rows). The badge format SHALL be `"N/Total"` without spaces, where N is the count of subjectSessions with a verdict (`Pass` or `Fail`) and Total is the count of subjectSessions that are NOT `No Info`.

#### Scenario: Badge shows correct counts

- **WHEN** "Reviewer 1" has set 42 verdicts out of 50 eligible subjectSessions (2 are No Info)
- **THEN** "Reviewer 1"'s tab badge SHALL display `"42/50"`

#### Scenario: Badge updates on verdict change

- **WHEN** "Reviewer 1" sets a Neutral subjectSession to Pass
- **THEN** the badge SHALL increment from `"42/50"` to `"43/50"` without requiring a page reload

#### Scenario: No Info rows excluded from badge total

- **WHEN** a project has 52 subjectSessions, 2 of which are No Info, and "Reviewer 1" has set all 50 eligible verdicts
- **THEN** "Reviewer 1"'s tab badge SHALL display `"50/50"`, not `"50/52"`

### Requirement: Multi-Reviewer Next Gate

In multi-reviewer mode, the stepper's "Next" button (proceeding from QC Selection) SHALL be disabled unless ALL reviewers have completed all their verdicts (no Neutral remaining for any reviewer, excluding No Info rows). The gate SHALL evaluate across all reviewers, not just the active reviewer. Its disabled tooltip SHALL provide generic Neutral/No Info guidance; individual reviewer completion SHALL remain visible in tab badges rather than a reviewer-specific tooltip.

#### Scenario: Next disabled when one reviewer is incomplete

- **WHEN** "Reviewer 1" has completed all 50 verdicts but "Reviewer 2" has 3 remaining Neutral verdicts
- **THEN** the "Next" button SHALL be disabled with tooltip "Resolve all Neutral verdicts or exclude via No Info before proceeding", and Reviewer 2's tab badge SHALL display `"47/50"`

#### Scenario: Next enabled when all reviewers are complete

- **WHEN** all reviewers in the `reviewers` array have zero Neutral verdicts (excluding No Info rows)
- **THEN** the "Next" button SHALL be enabled

#### Scenario: Adding a new reviewer re-disables Next

- **WHEN** all existing reviewers have completed verdicts and the "Next" button is enabled, then `addReviewer` is called
- **THEN** the "Next" button SHALL become disabled because the new reviewer has zero verdicts (all Neutral)

### Requirement: Uniform reviewer verdict representation

Verdicts SHALL use a reviewer-ID-indexed map of SubjectSession verdict maps for one to five reviewers. Reviewer IDs SHALL belong to the current registry. Empty maps SHALL be valid. Reviewer-count changes SHALL never wrap or unwrap verdicts; UI mode alone SHALL depend on whether count exceeds one.

#### Scenario: Multi-reviewer verdicts stored under reviewer IDs

- **WHEN** two reviewers rate the same SubjectSession
- **THEN** both values SHALL remain in their respective indexed slices

#### Scenario: Single-reviewer verdicts remain indexed

- **WHEN** a sole reviewer rates a SubjectSession
- **THEN** the value SHALL use that reviewer's indexed slice

#### Scenario: Transitioning to multi-reviewer preserves existing representation

- **WHEN** another reviewer is added
- **THEN** existing verdicts SHALL retain their shape and original identity

### Requirement: Registered reviewer verdict edits

Each accepted verdict edit SHALL target an explicit registered reviewer or the registered active reviewer when omitted. The same rule SHALL apply at every reviewer count. Timestamp capture SHALL retain the prior-module mtime contract. Invalid reviewer IDs and Fail without reason SHALL be rejected visibly without changing accepted state.

#### Scenario: Verdict written to specified reviewer

- **WHEN** an edit names a registered reviewer
- **THEN** only that reviewer's slice SHALL change

#### Scenario: Verdict defaults to active reviewer

- **WHEN** an edit omits reviewer ID
- **THEN** it SHALL target the active slice

#### Scenario: Single-reviewer edit uses registered identity

- **WHEN** one reviewer exists
- **THEN** verdict edits SHALL use that registered ID rather than a flat-map exception

#### Scenario: Fail without reason rejected

- **WHEN** Fail lacks a controlled reason
- **THEN** the edit SHALL fail without adding a verdict
