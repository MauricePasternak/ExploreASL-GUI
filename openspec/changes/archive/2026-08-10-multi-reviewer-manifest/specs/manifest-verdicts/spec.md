# manifest-verdicts — Multi-Reviewer Manifest Delta

## MODIFIED Requirements

**Notation:** Scenario identifiers such as `r1` and `r2` are readable aliases for distinct valid reviewer UUID values. When an alias appears as a reviewer ID, an `activeReviewerId`, or a verdict-map key, it denotes its corresponding UUID value.

### Requirement: Manifest Verdict Slot On Project File Schema

`ProjectFileSchema` in `src/schemas/project.ts` SHALL accept an optional `uiState.manifest` slot whose `ManifestUiStateSchema` shape includes:

- `reviewers: z.array(z.object({ id: z.string().uuid(), label: z.string().min(1).max(100), createdAt: z.string().datetime() })).optional()` — an ordered registry of reviewers. When `undefined` or containing at most one entry, the project operates in single-reviewer mode.
- `activeReviewerId: z.string().uuid().optional()` — the currently selected reviewer tab in multi-reviewer mode. It is `undefined` in single-reviewer mode.
- `verdicts: z.union([z.record(z.string(), ManifestVerdictSchema), z.record(z.string(), z.record(z.string(), ManifestVerdictSchema))]).optional()` — a flat `subjectSession` → verdict map in single-reviewer mode, or a `reviewerId` → `subjectSession` → verdict map in multi-reviewer mode. A schema refinement SHALL reject non-empty nested verdict maps in single-reviewer mode and non-empty flat verdict maps in multi-reviewer mode. An empty record is valid in either mode because the two representations are structurally indistinguishable.
- `resolvedVerdicts: z.record(z.string(), ManifestVerdictSchema).optional()` — resolution verdicts keyed by `subjectSession`, used when multiple reviewers disagree. These are set during the Verdict Resolution step and take precedence over individual reviewer verdicts during Preview & Export.
- `lastRunVersions: { exploreASL?: string; matlab?: string; gui?: string }` — optional, defaults to `{}`.
- `lastPopulationRunMtime: number | null` — optional, defaults to `null`.

The individual `ManifestVerdictSchema` shape (`status`, `reason`, `notes`, `setAt`) SHALL NOT change. Every field on `ManifestUiStateSchema` SHALL be `.optional()` so pre-existing `.easl` files parse via Zod without error. The flat shape remains the required single-reviewer representation; adding a second reviewer wraps it and removing back to one reviewer unwraps it.

#### Scenario: Legacy project file without manifest slot parses

- **WHEN** a `.easl` file with no `uiState.manifest` key is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and `project.uiState.manifest` SHALL be `undefined` on the parsed value

#### Scenario: Partial manifest slot parses

- **WHEN** a `.easl` file has `uiState.manifest = { verdicts: { "sub-A_01": { status: "pass", setAt: 1700000000000 } } }`
- **THEN** `ProjectFileSchema.parse` SHALL succeed and omitted manifest fields SHALL remain undefined

#### Scenario: Single-reviewer flat verdicts round-trip through schema

- **WHEN** a `.easl` file has `reviewers: undefined` and `verdicts: { "sub-01_01": { status: "pass", setAt: 1700000000000 } }`
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and the parsed `verdicts` SHALL remain a flat subjectSession-keyed record

#### Scenario: Multi-reviewer verdicts round-trip through schema

- **WHEN** a `.easl` file contains `uiState.manifest.reviewers` with two valid UUID entries (`id: "11111111-1111-4111-8111-111111111111"`, `id: "22222222-2222-4222-8222-222222222222"`) and `verdicts: { "11111111-1111-4111-8111-111111111111": { "sub-01_01": { status: "pass", setAt: 1700000000000 } }, "22222222-2222-4222-8222-222222222222": {} }`
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and the parsed `verdicts` object SHALL preserve both reviewer keys and all nested verdict entries

#### Scenario: Single-reviewer mode rejects nested verdicts

- **WHEN** a `.easl` file has no reviewers (or one reviewer) and has a non-empty reviewer-indexed `verdicts` map
- **THEN** `ProjectFileSchema.parse` SHALL reject the manifest state

#### Scenario: Multi-reviewer mode rejects flat verdicts

- **WHEN** a `.easl` file has two valid reviewers and has a non-empty flat `subjectSession` → verdict map
- **THEN** `ProjectFileSchema.parse` SHALL reject the manifest state

#### Scenario: Resolved verdicts parse alongside reviewer verdicts

- **WHEN** a `.easl` file contains both `verdicts` (reviewer-indexed) and `resolvedVerdicts: { "sub-03_01": { status: "fail", reason: "motion", setAt: 1700000000000 } }`
- **THEN** `ProjectFileSchema.parse` SHALL succeed and both `verdicts` and `resolvedVerdicts` SHALL be present on the parsed value

#### Scenario: Fail verdict without reason is rejected at parse time

- **WHEN** a `.easl` file contains a verdict entry `{ status: "fail", setAt: 1700000000000 }` (no `reason`) under any reviewer key
- **THEN** `ProjectFileSchema.parse` SHALL throw a Zod error citing the missing `reason` field, and `loadProject` SHALL surface the error to the user

### Requirement: Verdict Unit Is SubjectSession

The `verdicts` record's inner map SHALL be keyed by SubjectSession string (e.g. `"sub-A_01"`). Each SubjectSession SHALL admit at most one verdict entry per reviewer. A SubjectSession with multiple ASL runs SHALL still produce a single verdict entry per reviewer — run-level data MUST be aggregated before the verdict is recorded. Each verdict entry SHALL carry a `reason` field drawn from a controlled vocabulary and an optional freeform `notes` field. The `reason` field SHALL be **required** when `status === "fail"` and **optional** when `status === "pass"`. The controlled vocabulary SHALL include at minimum: `motion`, `coverage`, `dropout`, `artifact`, `registration`, `other`. The `notes` field SHALL be a free-text string (any UTF-8, length-capped at 500 characters), optional in both cases.

#### Scenario: Setting two verdicts on same key overwrites

- **WHEN** the store receives `setManifestVerdict("sub-A_01", "pass", {}, "r1")` followed by `setManifestVerdict("sub-A_01", "fail", { reason: "motion" }, "r1")`
- **THEN** the persisted `uiState.manifest.verdicts["r1"]["sub-A_01"]` SHALL equal `{ status: "fail", reason: "motion", notes: undefined, setAt: <current mtime> }` and no `"pass"` entry SHALL remain for reviewer `"r1"`

#### Scenario: Pass verdict with reason is preserved

- **WHEN** the store writes `setManifestVerdict("sub-Y_01", "pass", { reason: "other", notes: "manual review" })` in single-reviewer mode
- **THEN** the flat entry SHALL preserve its `reason` and `notes` through save and reload

#### Scenario: Different reviewers hold independent verdicts for same SubjectSession

- **WHEN** reviewer `"r1"` sets `setManifestVerdict("sub-A_01", "pass", {}, "r1")` and reviewer `"r2"` sets `setManifestVerdict("sub-A_01", "fail", { reason: "coverage" }, "r2")`
- **THEN** `verdicts["r1"]["sub-A_01"].status` SHALL be `"pass"` and `verdicts["r2"]["sub-A_01"].status` SHALL be `"fail"`, and neither verdict SHALL overwrite the other

#### Scenario: Fail verdict without reason is rejected

- **WHEN** the store receives `setManifestVerdict("sub-X_02", "fail", {}, "r1")` without a `reason`
- **THEN** the call SHALL be rejected (Zod parse failure at the schema layer), no verdict SHALL be written, and the user SHALL see a visible validation error in the QC Selection UI

### Requirement: setManifestVerdict Gains reviewerId Parameter

`projectStore.setManifestVerdict` SHALL accept an optional `reviewerId` parameter. In multi-reviewer mode, it specifies the reviewer's verdict slice; when omitted, the store SHALL use `activeReviewerId` and write to `verdicts[reviewerId][subjectSession]`. In single-reviewer mode, the action SHALL ignore `reviewerId` and write directly to `verdicts[subjectSession]`.

#### Scenario: Explicit reviewerId writes to correct slice

- **WHEN** `setManifestVerdict("sub-01_01", "pass", {}, "r2")` is called while `activeReviewerId` is `"r1"`
- **THEN** the verdict SHALL be written to `verdicts["r2"]["sub-01_01"]` and `verdicts["r1"]` SHALL remain unchanged

#### Scenario: Omitted reviewerId defaults to activeReviewerId

- **WHEN** `activeReviewerId` is `"r1"` and `setManifestVerdict("sub-01_01", "pass")` is called without a `reviewerId`
- **THEN** the verdict SHALL be written to `verdicts["r1"]["sub-01_01"]`

#### Scenario: Single-reviewer mode writes a flat verdict

- **WHEN** `reviewers` is `undefined` (or contains exactly one entry) and `setManifestVerdict("sub-01_01", "pass", {}, "r1")` is called
- **THEN** the verdict SHALL be written to `verdicts["sub-01_01"]`, not nested beneath a reviewer ID

### Requirement: Verdict Staleness Reference

A verdict's `setAt` field SHALL equal the integer maximum completion mtime (milliseconds since epoch) of its prior modules (Structural, ASL) at the time of capture. A verdict SHALL be considered stale iff its `setAt` differs from the current maximum completion mtime of these modules. In multi-reviewer mode, the manifest store SHALL derive every reviewer slice independently and expose `staleVerdicts` as `Record<reviewerId, Set<subjectSession>>`, including empty sets. The QC Selection UI SHALL read only the active reviewer's `staleVerdicts[activeReviewerId]` slice. In single-reviewer mode, the existing flat `Set<subjectSession>` staleness result (or equivalent single-reviewer helper) SHALL evaluate the flat verdict map.

#### Scenario: Verdict flagged stale after prior module re-run

- **WHEN** reviewer `"r1"` has a verdict with `setAt: 1700000000000` and the user re-runs Structural, producing a new prior completion mtime of `1700000060000`
- **THEN** `staleVerdicts["r1"]` SHALL include the corresponding SubjectSession

#### Scenario: One reviewer stale, another fresh

- **WHEN** reviewer `"r1"` has a verdict with `setAt: 1700000000000` and reviewer `"r2"` has a verdict with `setAt: 1700000060000`, and the current prior-module mtime is `1700000060000`
- **THEN** `staleVerdicts["r1"]` SHALL include the SubjectSession and `staleVerdicts["r2"]` SHALL NOT include it

#### Scenario: Verdict remains fresh after Population-only re-run

- **WHEN** a verdict exists with `setAt: 1700000000000`, the user re-runs the Population module (updating Population's mtime to `1700000060000`), but prior module mtime remains `1700000000000`
- **THEN** `staleVerdicts` for no reviewer SHALL include the corresponding SubjectSession

### Requirement: Verdict Persistence To .easl

`projectStore.setManifestVerdict` SHALL synchronously update the mode-appropriate `projectStore.project.uiState.manifest.verdicts` entry AND mark the project as dirty for subsequent save. All reviewer verdict data — including the `reviewers` array, `activeReviewerId`, the flat or reviewer-indexed verdict map, and `resolvedVerdicts` — SHALL be persisted to the `.easl` file and SHALL be recoverable across GUI restarts via `loadProject`.

#### Scenario: Verdict survives save and reload

- **WHEN** two reviewers each set verdicts, the user saves the project, closes the GUI, and reopens the project
- **THEN** the loaded `uiState.manifest.verdicts` SHALL contain both reviewers' verdict slices with the same values and `setAt` timestamps

#### Scenario: Resolved verdicts survive save and reload

- **WHEN** a resolved verdict is stored in `resolvedVerdicts["sub-03_01"]`, the user saves and reopens the project
- **THEN** the loaded `uiState.manifest.resolvedVerdicts["sub-03_01"]` SHALL contain the same verdict entry

#### Scenario: Reviewers array survives save and reload

- **WHEN** the `reviewers` array contains `[{ id: "r1", label: "Reviewer 1", createdAt: "..." }, { id: "r2", label: "Reviewer 2", createdAt: "..." }]`, the user saves and reopens the project
- **THEN** the loaded `uiState.manifest.reviewers` SHALL contain both entries with matching `id`, `label`, and `createdAt` values

### Requirement: Population Re-run Locks Manifest Phase

Because the existing `processingStore.startProcessing` already calls `setPopulationCompleted(false)` when re-running the Population module, no new logic SHALL be added for the lockout — the gate's existing dependency on `processing.population.completed` SHALL cascade to the manifest phase via the shared `canAccessPhase` gate. No verdict for any reviewer SHALL be deleted by a re-run; all reviewer verdicts persist and become stale per the Staleness Reference requirement.

#### Scenario: Re-running Population hides Manifest nav

- **WHEN** a user with stored multi-reviewer verdicts re-runs the Population module and the run enters `preparing`
- **THEN** `processing.population.completed` SHALL become `false`, `canAccessPhase(project, "manifest")` SHALL return `false`, and the Manifest nav button SHALL be disabled

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population re-run is in flight and the project has verdicts from two reviewers
- **THEN** `uiState.manifest.verdicts` in the persisted `.easl` SHALL contain both reviewers' verdict slices unchanged (no automatic deletion)
