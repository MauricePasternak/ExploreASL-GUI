# manifest-verdicts Specification

## Purpose

Define manifest verdict persistence and state management.

## Requirements

### Requirement: Population Re-run Locks Manifest Phase

An accepted native Population execution-commit snapshot SHALL clear Population completion under the existing `processing-store` contract. Native `allowedPhases`, consumed by `canAccessPhase`, SHALL retain the project's current phase (including a restored saved phase) and earlier phases while requiring Population completion for later Manifest access. Independently, active processing (`preparing`, `running`, `finalizing`, or `cancelling`) SHALL disable Manifest navigation and redirect direct Manifest routes under the `manifest-phase` contract; no separate manifest lockout state SHALL be added. A rejected start or pre-commit preparation failure SHALL preserve prior prerequisite access once processing is inactive. No reviewer verdict SHALL be deleted; all verdict slices persist and become stale only according to prior-module mtimes.

#### Scenario: Re-running Population disables Manifest nav

- **WHEN** a user with stored multi-reviewer verdicts re-runs Population and an accepted native snapshot reports execution commit
- **THEN** `processing.population.completed` SHALL become `false` and active processing SHALL disable the Manifest nav button even if the saved current phase keeps Manifest in native `allowedPhases`

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight with verdicts from multiple reviewers
- **THEN** all persisted reviewer verdict slices SHALL remain unchanged

### Requirement: Current manifest configuration

Current configuration SHALL contain `uiState.manifest` with an ordered registry of one to five reviewers, a registered `activeReviewerId`, reviewer-indexed `verdicts`, and SubjectSession-indexed `resolvedVerdicts`. Verdict and resolution maps SHALL default to empty maps; empty reviewer slices SHALL be valid. Every reviewer SHALL have a unique UUID, a nonempty label of at most 100 Unicode characters, and a UTC creation timestamp. Verdict keys SHALL belong to registered reviewers. Flat verdict maps, missing implicit-reviewer identities, and legacy manifest `lastRunVersions`/`lastPopulationRunMtime` fields SHALL not be accepted. Current Population provenance SHALL remain under `uiState.processing.population.lastRun`. Individual verdict status, reason, notes, and staleness timestamp semantics SHALL remain unchanged.

#### Scenario: New current project has review state

- **WHEN** a project is created
- **THEN** it SHALL contain one explicit active reviewer and empty verdict/resolution maps

#### Scenario: Single-reviewer indexed verdicts round-trip

- **WHEN** current configuration has one reviewer and verdicts under that ID
- **THEN** save/reopen SHALL preserve the same registry and indexed representation

#### Scenario: Multi-reviewer verdicts round-trip

- **WHEN** current configuration has multiple reviewers and independent verdict slices
- **THEN** save/reopen SHALL preserve every registered slice

#### Scenario: Invalid reviewer keys or flat maps are rejected

- **WHEN** current configuration contains unregistered reviewer keys or flat SubjectSession verdicts
- **THEN** validation SHALL reject it without conversion or substituted defaults

#### Scenario: Resolved verdicts parse alongside reviewer verdicts

- **WHEN** reviewer verdicts and SubjectSession resolutions are valid
- **THEN** both maps SHALL survive save/reopen

#### Scenario: Fail verdict without reason is rejected at parse time

- **WHEN** an indexed Fail verdict lacks a reason
- **THEN** validation SHALL identify the offending entry and opening SHALL fail safely

### Requirement: Reviewer-scoped SubjectSession verdicts

Each reviewer slice SHALL contain at most one verdict per SubjectSession. Multiple ASL runs SHALL still produce one aggregated review unit. Fail SHALL require a reason from motion, coverage, dropout, artifact, registration, or other; Pass SHALL allow an optional reason. Notes SHALL allow at most 500 Unicode characters. Invalid verdict edits SHALL leave accepted configuration unchanged and display validation feedback.

#### Scenario: Setting two verdicts on same key overwrites

- **WHEN** the same reviewer replaces a Pass verdict with a valid Fail verdict
- **THEN** that reviewer's SubjectSession entry SHALL contain only the later verdict

#### Scenario: Fail verdict without reason is rejected

- **WHEN** a Fail edit omits reason
- **THEN** the edit SHALL be rejected visibly without modifying verdicts

#### Scenario: Pass verdict with reason is preserved

- **WHEN** a sole reviewer saves Pass with reason and notes
- **THEN** its indexed entry SHALL retain both values through save/reopen

#### Scenario: Different reviewers hold independent verdicts

- **WHEN** different reviewers rate the same SubjectSession
- **THEN** each slice SHALL retain its own verdict independently

### Requirement: Registered reviewer targeting

Verdict edits SHALL allow an explicit registered reviewer ID or default to the registered active ID. This selection rule SHALL apply for every reviewer count. Invalid reviewer IDs SHALL not create verdict slices. SubjectSession indexing and prior-module timestamp capture SHALL retain their existing meanings.

#### Scenario: Explicit reviewerId writes to correct slice

- **WHEN** an explicit registered reviewer differs from the active reviewer
- **THEN** only the explicit reviewer's verdict slice SHALL change

#### Scenario: Omitted reviewerId defaults to activeReviewerId

- **WHEN** a verdict edit omits reviewer identity
- **THEN** it SHALL target the active registered reviewer

#### Scenario: Single-reviewer mode writes an indexed verdict

- **WHEN** a sole reviewer edits a verdict
- **THEN** the verdict SHALL remain under that reviewer's ID

### Requirement: Indexed reviewer staleness reference

A captured verdict's `setAt` SHALL equal the integer maximum Structural/ASL completion mtime, or zero when unavailable. A nonzero `setAt` SHALL be stale when an available current maximum differs; zero or unavailable current mtimes SHALL not be marked stale. Staleness SHALL use a reviewer-indexed result for every reviewer count, including empty reviewer results. QC controls SHALL read only the active slice. Population-only reruns SHALL not make verdicts stale solely because Population's mtime changes.

#### Scenario: Verdict flagged stale after prior module re-run

- **WHEN** a prior-module completion mtime changes after review
- **THEN** the affected SubjectSession SHALL appear in its reviewer's stale result

#### Scenario: One reviewer stale, another fresh

- **WHEN** two reviewers captured different prior-module mtimes
- **THEN** only the reviewer with the outdated value SHALL see staleness

#### Scenario: Verdict remains fresh after Population-only re-run

- **WHEN** Population completes again without changed prior-module mtimes
- **THEN** no reviewer verdict SHALL become stale solely for that rerun

### Requirement: Autosaved review configuration

Valid review edits SHALL update accepted configuration and schedule shared autosave. Reviewer registry, active ID, indexed verdicts, and resolutions SHALL persist independently of page mount or explicit navigation. Pending edits SHALL flush on Save/close. Failed saving SHALL preserve unsaved review state and expose retry guidance.

#### Scenario: Verdict survives save and reload

- **WHEN** one or multiple reviewers edit verdicts and persistence completes
- **THEN** reopening SHALL preserve all indexed values and timestamps

#### Scenario: Resolved verdicts survive save and reload

- **WHEN** resolution persistence completes
- **THEN** reopening SHALL retain the same SubjectSession resolution

#### Scenario: Reviewer registry survives save and reload

- **WHEN** registry persistence completes
- **THEN** IDs, labels, creation timestamps, and active selection SHALL remain unchanged
