# manifest-verdicts Specification

## Purpose

Define manifest verdict persistence and state management.

## Requirements

### Requirement: Manifest Verdict Slot On Project File Schema

`ProjectFileSchema` in `src/schemas/project.ts` SHALL accept an optional `uiState.manifest` slot whose `ManifestUiStateSchema` includes:

- `reviewers: z.array(z.object({ id: z.string().uuid(), label: z.string().min(1).max(100), createdAt: z.string().datetime() })).max(5).optional()` — ordered reviewer registry. Undefined or at most one entry means single-reviewer mode.
- `activeReviewerId: z.string().uuid().optional()` — selected reviewer tab in multi-reviewer mode; undefined in single-reviewer mode.
- `verdicts: z.union([z.record(z.string(), ManifestVerdictSchema), z.record(z.string(), z.record(z.string(), ManifestVerdictSchema))]).optional()` — flat SubjectSession map in single-reviewer mode or reviewer-indexed map in multi-reviewer mode. A refinement SHALL reject nonempty nested maps in single-reviewer mode and nonempty flat maps in multi-reviewer mode. An empty record is valid in either mode.
- `resolvedVerdicts: z.record(z.string(), ManifestVerdictSchema).optional()` — final resolutions keyed by SubjectSession.
- `lastRunVersions: { exploreASL?: string; matlab?: string; gui?: string }` — optional, defaults to `{}`.
- `lastPopulationRunMtime: number | null` — optional, defaults to `null`.

The individual `ManifestVerdictSchema` shape (`status`, `reason`, `notes`, `setAt`) SHALL remain unchanged. Every manifest field SHALL be optional so pre-existing `.easl` files parse without manual migration. The flat shape remains required in single-reviewer mode; adding a second reviewer wraps it and reverting to one reviewer unwraps it.

#### Scenario: Legacy project file without manifest slot parses

- **WHEN** a `.easl` file from before this change (no `uiState.manifest` key) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and `project.uiState.manifest` SHALL be `undefined` (no default injection) on the parsed value

#### Scenario: Partial manifest slot parses

- **WHEN** a `.easl` file has `uiState.manifest = { verdicts: { "sub-A_01": { status: "pass", setAt: 1700000000000 } } }`
- **THEN** `ProjectFileSchema.parse` SHALL succeed and omitted manifest fields SHALL remain undefined

#### Scenario: Single-reviewer flat verdicts round-trip through schema

- **WHEN** a `.easl` file has no reviewer registry and a flat verdict map
- **THEN** parsing SHALL preserve the flat SubjectSession-keyed representation

#### Scenario: Multi-reviewer verdicts round-trip through schema

- **WHEN** a `.easl` file has two valid reviewer UUID entries and a reviewer-indexed verdict map
- **THEN** parsing SHALL preserve all reviewer keys and nested verdict entries

#### Scenario: Single-reviewer mode rejects nested verdicts

- **WHEN** a `.easl` file has no reviewers (or one reviewer) and a nonempty reviewer-indexed verdict map
- **THEN** `ProjectFileSchema.parse` SHALL reject the manifest state

#### Scenario: Multi-reviewer mode rejects flat verdicts

- **WHEN** a `.easl` file has two reviewers and a nonempty flat SubjectSession verdict map
- **THEN** `ProjectFileSchema.parse` SHALL reject the manifest state

#### Scenario: Resolved verdicts parse alongside reviewer verdicts

- **WHEN** a `.easl` file contains reviewer-indexed `verdicts` and SubjectSession-keyed `resolvedVerdicts`
- **THEN** parsing SHALL preserve both maps

#### Scenario: Fail verdict without reason is rejected at parse time

- **WHEN** a `.easl` file contains `verdicts: { "sub-X_01": { status: "fail", setAt: 1700000000000 } }` (no `reason`)
- **THEN** `ProjectFileSchema.parse` SHALL throw a Zod error citing the missing `reason` field on the offending entry, and `loadProject` SHALL surface the error to the user

### Requirement: Verdict Unit Is SubjectSession

The `verdicts` record's inner map SHALL be keyed by SubjectSession string (e.g. `"sub-A_01"`). Each SubjectSession SHALL admit at most one verdict per reviewer. Multiple ASL runs still produce one reviewer verdict per SubjectSession; run data MUST be aggregated before capture. Each verdict SHALL carry a controlled-vocabulary `reason` and optional freeform `notes`. `reason` SHALL be required for Fail and optional for Pass. The vocabulary SHALL include `motion`, `coverage`, `dropout`, `artifact`, `registration`, and `other`. `notes` SHALL accept UTF-8 text up to 500 characters.

#### Scenario: Setting two verdicts on same key overwrites

- **WHEN** reviewer `r1` receives `setManifestVerdict("sub-A_01", "pass", {}, "r1")` followed by `setManifestVerdict("sub-A_01", "fail", { reason: "motion" }, "r1")`
- **THEN** `verdicts["r1"]["sub-A_01"]` SHALL contain only the later Fail verdict with current prior-module mtime

#### Scenario: Fail verdict without reason is rejected

- **WHEN** the store receives `setManifestVerdict("sub-X_02", "fail", {}, "r1")` without a `reason`
- **THEN** the call SHALL be rejected (Zod parse failure at the schema layer), no verdict SHALL be written, and the user SHALL see a visible validation error in the QC Selection UI

#### Scenario: Pass verdict with reason is preserved

- **WHEN** the store receives `setManifestVerdict("sub-Y_01", "pass", { reason: "other", notes: "manual review" })` in single-reviewer mode
- **THEN** the flat entry SHALL preserve its reason and notes through save and reload

#### Scenario: Different reviewers hold independent verdicts

- **WHEN** reviewers `r1` and `r2` set different verdicts for the same SubjectSession
- **THEN** each verdict SHALL remain in its respective reviewer slice without overwriting the other

### Requirement: setManifestVerdict Gains reviewerId Parameter

`projectStore.setManifestVerdict` SHALL accept an optional `reviewerId` parameter. In multi-reviewer mode, an explicit ID SHALL select the destination slice; when omitted, the action SHALL use `activeReviewerId`. In single-reviewer mode, the action SHALL ignore `reviewerId` and write directly to the flat SubjectSession map.

#### Scenario: Explicit reviewerId writes to correct slice

- **WHEN** `setManifestVerdict("sub-01_01", "pass", {}, "r2")` is called while `activeReviewerId` is `r1`
- **THEN** the verdict SHALL be written to `verdicts["r2"]["sub-01_01"]` and `verdicts["r1"]` SHALL remain unchanged

#### Scenario: Omitted reviewerId defaults to activeReviewerId

- **WHEN** `activeReviewerId` is `r1` and `setManifestVerdict("sub-01_01", "pass")` omits `reviewerId`
- **THEN** the verdict SHALL be written to `verdicts["r1"]["sub-01_01"]`

#### Scenario: Single-reviewer mode writes a flat verdict

- **WHEN** single-reviewer mode calls `setManifestVerdict("sub-01_01", "pass", {}, "r1")`
- **THEN** the verdict SHALL be written to `verdicts["sub-01_01"]`, not beneath a reviewer ID

### Requirement: Verdict Staleness Reference

A verdict's `setAt` SHALL equal the integer maximum completion mtime of prior modules (Structural, ASL) at capture. It SHALL be stale iff `setAt` differs from the current maximum. In multi-reviewer mode, the store SHALL derive every reviewer independently and expose `staleVerdicts` as `Record<reviewerId, Set<subjectSession>>`, including empty sets. QC Selection SHALL read only the active-reviewer slice. Single-reviewer mode SHALL retain the flat `Set<subjectSession>` result or equivalent helper.

#### Scenario: Verdict flagged stale after prior module re-run

- **WHEN** reviewer `r1` has `setAt: 1700000000000` and a prior module rerun changes the maximum to `1700000060000`
- **THEN** `staleVerdicts["r1"]` SHALL include the SubjectSession

#### Scenario: One reviewer stale, another fresh

- **WHEN** reviewer `r1` has `setAt: 1700000000000`, reviewer `r2` has `setAt: 1700000060000`, and current prior-module mtime is `1700000060000`
- **THEN** only `staleVerdicts["r1"]` SHALL include the SubjectSession

#### Scenario: Verdict remains fresh after Population-only re-run

- **WHEN** a verdict exists with `setAt: 1700000000000`, the user re-runs the Population module (updating Population's `999_ready.status` mtime to `1700000060000`), but does not re-run prior modules (prior completion mtime remains `1700000000000`)
- **THEN** no reviewer's staleness result SHALL include the SubjectSession solely because of the Population rerun

### Requirement: Verdict Persistence To .easl

`projectStore.setManifestVerdict` SHALL synchronously update the mode-appropriate `projectStore.project.uiState.manifest.verdicts` entry and mark the project dirty. The reviewer registry, active reviewer ID, flat or reviewer-indexed verdict map, and resolved verdict map SHALL persist to `.easl` and be recoverable through `loadProject`.

#### Scenario: Verdict survives save and reload

- **WHEN** multiple reviewers set verdicts, the user saves, closes, and reopens the project
- **THEN** all reviewer verdict slices SHALL retain their values and `setAt` timestamps

#### Scenario: Resolved verdicts survive save and reload

- **WHEN** a resolved verdict is saved and the project is reopened
- **THEN** `uiState.manifest.resolvedVerdicts` SHALL contain the same entry

#### Scenario: Reviewer registry survives save and reload

- **WHEN** the reviewer registry is saved and the project is reopened
- **THEN** all reviewer IDs, labels, and creation timestamps SHALL be preserved

### Requirement: Population Re-run Locks Manifest Phase

Because `processingStore.startProcessing` already calls `setPopulationCompleted(false)` when re-running Population, no new lockout logic SHALL be added. The shared `canAccessPhase` dependency SHALL cascade to Manifest. No reviewer verdict SHALL be deleted; all verdict slices persist and become stale only according to prior-module mtimes.

#### Scenario: Re-running Population hides Manifest nav

- **WHEN** a user with stored multi-reviewer verdicts re-runs Population and the run enters `preparing`
- **THEN** `processing.population.completed` SHALL become `false`, `canAccessPhase(project, "manifest")` SHALL return `false`, and the Manifest nav button SHALL be disabled

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight with verdicts from multiple reviewers
- **THEN** all persisted reviewer verdict slices SHALL remain unchanged
