## Why

After the Population module completes, users have no way inside the GUI to (a) record per-subject QC verdicts and (b) export a journal-ready methods document. Today this workflow lives outside the app — researchers read ExploreASL CSVs in Excel, decide pass/fail ad-hoc, and re-type pipeline parameters into a manuscript. With studies routinely numbering 1000+ SubjectSessions, an in-app verdict + manifest export step closes the loop between processing and reporting and prevents transcription errors. Captured now because it depends only on existing Population outputs and the .easl state model, both stable.

## What Changes

- **BREAKING**: `PROJECT_PHASES` array grows from 4 entries (`import`, `parameters`, `processing`, `visualization`) to 5 — new `manifest` phase appended after `visualization`. Existing `.easl` files without the phase in their `currentPhase` enum still parse because `currentPhase` keeps its existing value at load time; any future `setPhase("manifest")` call on a pre-existing project will only succeed once the Population gate is met. No migration script needed.
- Add new top-level route `/project/:id/manifest` and a new entry in PHASE_NAV (`Layout.tsx:39-42`) with icon + label "Manifest".
- Add new `canAccessPhase` branch (`project.ts:228`) gating the `manifest` phase on `project.uiState?.population?.completed === true`, mirroring the existing `visualization` gate.
- Add new `uiState.manifest` slot on `ProjectFileSchema` holding:
  - `verdicts: Record<subjectSession, { status: "pass" | "fail", setAt: number }>` — persistent QC verdicts keyed by SubjectSession.
  - `lastRunVersions: { exploreASL?: string; matlab?: string; gui?: string }` — captured at `startProcessing` time.
  - `lastPopulationRunMtime: number | null` — mtime of `999_ready.status` for the Population module at last capture, used as the staleness reference.
- Add Manifest Verdict staleness detection: a verdict is stale iff `verdict.setAt !== current 999_ready.status mtime`. Re-running Population already clears `population.completed` (existing `processingStore.ts:119`), which locks the user out of the Manifest phase until the new run finishes — intended, documented in the phase Help content.
- Add capture of `ExploreASL_version` and `MATLAB_version` at `startProcessing` time (probe via Rust backend), persisted into `uiState.manifest.lastRunVersions`. GUI version sourced from `package.json` / Tauri conf.
- Add a two-step Manifest Stepper component on the new route:
  - **Step 1 — QC Selection**: table mirroring `SubjectSelection.tsx` shape (Subject, Session, Metadata group, Structural/ASL ModuleStatus as read-only badges, Verdict control). Verdict column is a SegmentedControl with Neutral/Pass/Fail; No Info is a derived, non-touchable exclusion status shown when Population QC outputs (coverage / SpatialCoV / motion CSVs) are missing for the SubjectSession. Filter chips: All / Neutral / Pass / Fail / No Info with counts. "Mark all complete→Pass" bulk action. Next button disabled when any visible row is Neutral. No Info rows excluded from the gate.
  - **Step 2 — Manifest Preview + Export**: read-only rendered preview of the 4 manifest sections, live updates when verdicts flip back in Step 1. Export buttons for Markdown and HTML. Both formats byte-identical across Windows 11 / macOS / Linux (Markdown via TS template literal + `writeTextFile`; HTML via same payload templated into an inline-CSS single-file wrapper). PDF slot reserved in spec for future expansion — no button in v0.
- Add `HELP_DATA` entry (`PageHelpButton.tsx`) for the `manifest` phase, including a clear warning that re-running Population locks the user out of this phase until the new run finishes.
- New modules in `CONTEXT.md` gain a `## Manifest Module` section — already landed during the grill session.

## Capabilities

### New Capabilities

- `manifest-phase`: New ProjectPhase entry `manifest` with route, nav entry, `canAccessPhase` gate on `population.completed`, and Help drawer content (incl. re-run lockout warning).
- `manifest-verdicts`: Persistent per-SubjectSession QC verdicts (pass / fail / neutral / no-info) in `uiState.manifest.verdicts` of `.easl`, with staleness detection keyed off `999_ready.status` mtime.
- `manifest-qc-selection`: First stepper step — QC verdict table mirroring `SubjectSelection` shape, derived No Info status, Neutral gate, filter chips, bulk actions.
- `manifest-preview-export`: Second stepper step — live preview of the 4 manifest sections (Study Parameters, Software Manifest, QC Summary, Pipeline Summary) and Markdown + HTML export.
- `manifest-version-capture`: Capture ExploreASL + MATLAB + GUI versions at `startProcessing` time into `uiState.manifest.lastRunVersions`.

### Modified Capabilities

- `project-store`: Adds `uiState.manifest` slot to `ProjectFileSchema`; `setPopulationCompleted(false)` (already called on re-run) now also forces Manifest phase lockout via the existing gate.
- `app-layout`: PHASE_NAV gains a 5th entry; `Layout` renders the new nav button.
- `processing-store`: `startProcessing` is extended to invoke the version-capture Rust command and persist `uiState.manifest.lastRunVersions` + `lastPopulationRunMtime` when the run includes the Population module.

## Impact

- **Code**: New `src/pages/ManifestPage.tsx`; new `src/components/manifest/*` (Stepper wrapper, QcSelectionTable, ManifestPreview, exporters); new `src/stores/manifestStore.ts`; new `src/schemas/manifestSchemas.ts`; edit `src/schemas/project.ts` (PROJECT_PHASES, ProjectFileSchema uiState.manifest, canAccessPhase); edit `src/components/Layout.tsx` (PHASE_NAV); edit `src/components/PageHelpButton.tsx` (HELP_DATA); edit `src/stores/projectStore.ts` and `processingStore.ts` for version capture + mtime capture; new Rust command(s) for version probing and mtime reading.
- **APIs**: New Tauri commands for (a) reading `999_ready.status` mtime, (b) probing ExploreASL version, (c) probing MATLAB version. Existing Tauri fs plugin reused for export writes.
- **Dependencies**: No new runtime deps for v0 (Markdown + HTML pure TS). PDF backend (`pdfmake` or equivalent) deferred to v1 per ADR-0002.
- **Tests**: New Vitest suites for manifestStore, manifestSchemas, exporter markdown/html output (golden-file byte equality across platforms), verdict staleness logic, QcSelectionTable rendering and Neutral gate, version-capture invocation.
- **Docs**: `CONTEXT.md` already updated with `## Manifest Module` glossary. `docs/adr/0001-manifest-verdicts-persist-to-easl.md` and `docs/adr/0002-manifest-export-formats.md` already landed during the grill session.
- **Existing behavior**: No change to Import / Parameters / Processing / Visualization flows beyond the new phase entry appearing in the nav (disabled until `population.completed`).
