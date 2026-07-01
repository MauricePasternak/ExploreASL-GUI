# manifest-verdicts Specification

## Purpose

TBD - created by archiving change project-manifest. Update Purpose after archive.

## Requirements

### Requirement: Manifest Verdict Slot On Project File Schema

`ProjectFileSchema` in `src/schemas/project.ts` SHALL accept a new optional `uiState.manifest` slot with shape:

- `verdicts: Record<string, { status: "pass" | "fail"; reason?: "motion" | "coverage" | "dropout" | "artifact" | "registration" | "other"; notes?: string; setAt: number }>` — optional, defaults to `{}`. The `reason` field SHALL be **required** when `status === "fail"`; the schema SHALL reject otherwise.
- `lastRunVersions: { exploreASL?: string; matlab?: string; gui?: string }` — optional, defaults to `{}`
- `lastPopulationRunMtime: number | null` — optional, defaults to `null`

Every field SHALL be `.optional()` so pre-existing `.easl` files parse via Zod without manual migration.

#### Scenario: Legacy project file without manifest slot parses

- **WHEN** a `.easl` file from before this change (no `uiState.manifest` key) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and `project.uiState.manifest` SHALL be `undefined` (no default injection) on the parsed value

#### Scenario: Partial manifest slot parses

- **WHEN** a `.easl` file with `uiState.manifest = { verdicts: { "sub-A_01": { status: "pass", setAt: 1700000000000 } } }` (no `lastRunVersions`, no `lastPopulationRunMtime`) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed and `project.uiState.manifest.lastRunVersions` SHALL be `undefined`, `project.uiState.manifest.lastPopulationRunMtime` SHALL be `undefined`

#### Scenario: Fail verdict without reason is rejected at parse time

- **WHEN** a `.easl` file contains `verdicts: { "sub-X_01": { status: "fail", setAt: 1700000000000 } }` (no `reason`)
- **THEN** `ProjectFileSchema.parse` SHALL throw a Zod error citing the missing `reason` field on the offending entry, and `loadProject` SHALL surface the error to the user

### Requirement: Verdict Unit Is SubjectSession

The `verdicts` record SHALL be keyed by SubjectSession string (e.g. `"sub-A_01"`). Each SubjectSession SHALL admit at most one verdict entry. A SubjectSession with multiple ASL runs SHALL still produce a single verdict entry — run-level data MUST be aggregated before the verdict is recorded. Each verdict entry SHALL additionally carry a `reason` field drawn from a controlled vocabulary and an optional freeform `notes` field. The `reason` field SHALL be **required** when `status === "fail"` and **optional** when `status === "pass"`. The controlled vocabulary SHALL include at minimum: `motion`, `coverage`, `dropout`, `artifact`, `registration`, `other`. The `notes` field SHALL be a free-text string (any UTF-8, length-capped at 500 characters), optional in both cases.

#### Scenario: Setting two verdicts on same key overwrites

- **WHEN** the store receives `setManifestVerdict("sub-A_01", "pass")` followed by `setManifestVerdict("sub-A_01", "fail", { reason: "motion" })`
- **THEN** the persisted `uiState.manifest.verdicts["sub-A_01"]` SHALL equal `{ status: "fail", reason: "motion", notes: undefined, setAt: <current 999_ready mtime> }` and no `"pass"` entry SHALL remain

#### Scenario: Fail verdict without reason is rejected

- **WHEN** the store receives `setManifestVerdict("sub-X_02", "fail")` without a `reason`
- **THEN** the call SHALL be rejected (Zod parse failure at the schema layer), no verdict SHALL be written, and the user SHALL see a visible validation error in the QC Selection UI

#### Scenario: Pass verdict with reason is preserved

- **WHEN** the store receives `setManifestVerdict("sub-Y_01", "pass", { reason: "other", notes: "manual review" })`
- **THEN** the persisted entry SHALL equal `{ status: "pass", reason: "other", notes: "manual review", setAt: <mtime> }` and the reason/notes fields SHALL survive save + reload

### Requirement: Verdict Staleness Reference

A verdict's `setAt` field SHALL equal the integer mtime (milliseconds since epoch) of `derivatives/ExploreASL/.../xASL_module_Population/xASL_module_Population/999_ready.status` at the time of capture. A verdict SHALL be considered stale iff its `setAt` differs from the current mtime of that file. The store SHALL expose a computed `staleVerdicts: Set<subjectSession>` value derived from this comparison.

#### Scenario: Verdict flagged stale after Population re-run

- **WHEN** a verdict exists with `setAt: 1700000000000`, the user runs Population again, and the new `999_ready.status` mtime becomes `1700000060000`
- **THEN** `staleVerdicts` SHALL include the corresponding SubjectSession

#### Scenario: Verdict remains fresh across import-only session

- **WHEN** a verdict exists with `setAt` equal to the current `999_ready.status` mtime and the GUI is restarted without any Population re-run having occurred
- **THEN** `staleVerdicts` SHALL NOT include the corresponding SubjectSession

### Requirement: Verdict Persistence To .easl

`projectStore.setManifestVerdict` SHALL synchronously update `projectStore.project.uiState.manifest.verdicts` AND mark the project as dirty for subsequent save. The verdict SHALL be recoverable across GUI restarts via `loadProject`.

#### Scenario: Verdict survives save and reload

- **WHEN** the user sets a verdict, saves the project, closes the GUI, reopens the project
- **THEN** the loaded `uiState.manifest.verdicts` SHALL contain the same verdict with the same `setAt` value

### Requirement: Population Re-run Locks Manifest Phase

Because the existing `processingStore.startProcessing` already calls `setPopulationCompleted(false)` when re-running the Population module, no new logic SHALL be added for the lockout — the gate's existing dependency on `population.completed` SHALL cascade to the manifest phase via the shared `canAccessPhase` gate. No verdict SHALL be deleted by a re-run; verdicts persist and become stale per the Staleness Reference requirement.

#### Scenario: Re-running Population hides Manifest nav

- **WHEN** a user with stored verdicts re-runs the Population module and the run enters `preparing`
- **THEN** `population.completed` SHALL become `false`, `canAccessPhase(project, "manifest")` SHALL return `false`, and the Manifest nav button SHALL be disabled

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight
- **THEN** `uiState.manifest.verdicts` in the persisted `.easl` SHALL remain unchanged (no automatic deletion)
