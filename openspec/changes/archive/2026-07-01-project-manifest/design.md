## Context

The GUI is a Tauri 2 + React 19 + Zustand 5 app wrapping the ExploreASL MATLAB pipeline. Project state lives in `<project_root>/project.easl`, a Zod-validated JSON file persisted by the `projectStore`. Today there are four `PROJECT_PHASES` (`import`, `parameters`, `processing`, `visualization`); the Visualization phase is gated on `uiState.population.completed`. The Population module emits per-subject QC CSVs (coverage, SpatialCoV, motion) under `derivatives/ExploreASL/.../xASL_module_Population/` and a `999_ready.status` file at module completion. No GUI surface today captures user QC verdicts or composes a methods document.

The grill session (see `CONTEXT.md` `## Manifest Module` and `docs/adr/0001-manifest-verdicts-persist-to-easl.md`, `docs/adr/0002-manifest-export-formats.md`) resolved 14 design questions. This document records the architectural consequences.

## Goals / Non-Goals

**Goals:**

- Add a 5th project phase, `manifest`, reachable only after `population.completed === true`.
- Persist per-SubjectSession QC verdicts (pass / fail / neutral / no-info) in `.easl` so QC work survives restart.
- Provide a two-step stepper in the manifest phase: QC Selection, then Manifest Preview + Export.
- Render a 4-section manifest (Study Parameters, Software Manifest, QC Summary, Pipeline Summary) and export it as Markdown + HTML byte-identically across Windows 11 / macOS / Linux.
- Detect verdict staleness across Population re-runs and lock out the manifest phase while a re-run is in flight.
- Capture ExploreASL / MATLAB / GUI versions at `startProcessing` time, persisted under `uiState.manifest.lastRunVersions`.

**Non-Goals:**

- PDF export — reserved in spec for future expansion, implemented with `pdfmake` (pure JS) in a later release (ADR-0002).
- Dynamic Pipeline Summary paragraph templating — v0 ships a static paragraph with version/count substitution only; clause toggling based on `dataPar.json` flags is a future feature (Q10 decision).
- Human-readable label translation for `dataPar.json` keys in Section 2 — v0 renders keys verbatim (Q14 decision).
- Group-level verdict rollups for Section 3 — verdict unit is SubjectSession; groups aggregate upward by membership.
- Any modification of `SubjectSelection.tsx` (Processing phase) — the manifest table is a new component that _mirrors_ its shape but does not share state.

## Decisions

### D1. New `manifest` phase in `PROJECT_PHASES`, same gate as Visualization

Add `manifest` after `visualization` in the `PROJECT_PHASES` tuple (`project.ts:6`) and extend `canAccessPhase` with `if (targetPhase === "manifest") return project.uiState?.population?.completed === true` — identical gate to Visualization.

**Alternatives considered:**

- _Add `manifest` between `processing` and `visualization`._ Rejected — manifest logically follows population completion, and inserting between existing phases risks user confusion about ordering.
- _Sub-section under Processing, like `population-analysis-section`._ Rejected during grill — user QC verdicts are a distinct workflow with their own stepper; a sub-section would entangle lifecycle with the Processing store and inherit its `processingPhase` gating, not `population.completed`.

### D2. Verdict persistence shape: `uiState.manifest.verdicts: Record<subjectSession, {status, setAt}>`

Full rationale in ADR-0001. Summary: each verdict carries its `setAt` timestamp = mtime of `999_ready.status` at the moment of capture; staleness compares stored mtime to current mtime.

**Alternatives considered:**

- _Ephemeral scratch storage._ Rejected — loses user work on navigation; antithetical to the reproducibility goal.
- _`derivatives/ExploreASL/manifest_verdicts.json` next to outputs._ Rejected — couples QC state to the output dir, which Population re-run can delete; `.easl` is the canonical project-state file and is never touched by ExploreASL.
- _UUID-based run id._ Rejected — mtime of `999_ready.status` already moves on every Population completion because ExploreASL deletes `.status` files before re-creating them, so mtime is a sufficient run boundary without extra plumbing.

### D3. Stepper component: Mantine `Stepper` consistent with existing GUI pattern

Use Mantine's `Stepper` for the 2 steps. Matches the import and visualization steppers elsewhere in the app, so users get a consistent mental model; no new component primitive introduced.

**Alternatives considered:**

- _Single page with live preview + button gate._ Rejected by the user (Q5) for performance reasons: with 1000+ SubjectSessions, re-rendering the preview on every verdict toggle is wasteful, and the stepper boundary gives the user explicit control over "I'm done triaging, compute the manifest."

### D4. Version capture at `startProcessing` time via two new Rust commands

Add Rust commands `exploreasl_version(path: String) -> Result<String, String>` and `matlab_version(path: String) -> Result<String, String>`, invoked from `processingStore.startProcessing` when `modules` includes `population`. Store results into `uiState.manifest.lastRunVersions` along with the GUI version pulled from `package.json` (frontend-side) and `lastPopulationRunMtime` captured by reading `999_ready.status` mtime via the fs plugin.

**Alternatives considered:**

- _Probe versions lazily when entering the manifest phase._ Rejected — Population may have finished hours ago; a re-probe captures the _current_ ExploreASL install, not the one used for the run. Capturing at start time ties the recorded version to the actual run.
- _Parse versions from log files._ Rejected — log formats are ExploreASL-internal and brittle; a dedicated version probe (ExploreASL has a `VERSION` file convention; MATLAB supports `-batch "version"` CLI probe) is more stable.

### D5. QC aggregation rule: per-SubjectSession Mean Motion = `max` across runs

A SubjectSession with N ASL runs has N motion rows in `Motion*.tsv`. The manifest Section 3 reports one row per SubjectSession. We aggregate by **max** (worst run), not mean. Coverage and SpatialCoV are emitted per-SubjectSession by ExploreASL, so no aggregation is needed for those.

**Alternatives considered:**

- _Mean across runs._ Rejected — hides outlier runs; reviewers will flag a methods section that averages away a single bad run.
- _Mean weighted by per-run voxel count._ Rejected — depends on a column ExploreASL does not reliably emit; adds a parser burden without improving QC signal.

### D6. Export format: Markdown + HTML for v0, both via pure-TS template literals

Markdown is rendered with TS template literals and written via `@tauri-apps/plugin-fs` `writeTextFile`. HTML is the same Markdown payload templated into an inline-CSS single-file wrapper (no external stylesheets, no WebView rendering participation), so output is byte-identical across Win/macOS/Linux. See ADR-0002 for the rejection of `webview.printToPdf` (cross-OS render inconsistency) and bundled `pandoc` (install footprint).

**Alternatives considered:**

- _Adopt a Markdown-to-HTML library (`marked`, `markdown-it`)._ Rejected for v0 — the manifest's Markdown is highly structured (tables, simple headings) and renders cleanly via a hand-written template; introduces no new dep and keeps the output deterministic. v1 may revisit if formatting requirements grow.

### D7. New `manifestStore` (Zustand) — no extension of `processingStore`

A new `src/stores/manifestStore.ts` holds ephemeral UI state for the stepper (current step, filter, page, table rows' displayed verdict controls) and reads/writes verdicts and versions through `projectStore`. Keeps `processingStore` focused on the active run.

**Alternatives considered:**

- _Extend `processingStore` with manifest fields._ Rejected — concerns are unrelated (one is about an ongoing run, the other about post-run QC + reporting); coupling them invites re-render storms when processing state changes.

### D8. No Info is a derived status, not user-touchable

A row's displayed status is computed: if Population QC outputs (coverage CSV, SpatialCoV CSV, motion CSV) for the SubjectSession are missing → "No Info"; else if a verdict is stored → that verdict's `status`; else → "Neutral". The user may toggle Neutral↔Pass↔Fail. No Info rows are excluded from the Neutral gate and from manifest aggregation.

**Alternatives considered:**

- _Make No Info a user-settable tri-state._ Rejected (Q6) — adds a user error mode (marking "no info" when outputs exist) without value; if outputs exist the user should triage, not hide.

## Risks / Trade-offs

- **R1: `touch 999_ready.status` outside the GUI silently invalidates all verdicts.** → Mitigation: document in ADR-0001 Consequences; ExploreASL's Re-run flow deletes `.status` files before re-creating them so this is unlikely. The manifest phase shows all stale verdicts with a "stale" pill and prompts re-confirmation rather than silently dropping them.
- **R2: Lockout during Population re-run blocks access to prior verdicts for hours on large studies.** → Mitigation: intended per Q12/C2. Persistent verdicts remain on disk; lockout is only at the nav/gate level (`population.completed` flag). After the new run completes, the user enters the manifest phase again; prior verdicts now appear stale and can be confirmed or re-triaged. The Help content for the manifest phase states this explicitly.
- **R3: Version capture fails (MATLAB not on PATH, ExploreASL VERSION file missing).** → Mitigation: `startProcessing` already requires a working MATLAB path and ExploreASL path or it errors out before spawning workers; version probe runs at the same point and if it fails the corresponding field is set to `"unknown"` rather than aborting the run. The manifest preview simply omits that version line if absent.
- **R4: Self-contained HTML grows large for big studies (thousands of SubjectSession rows in QC table).** → Mitigation: Section 3 QC Summary groups by metadata group, surfacing only group-level aggregates in the exported document, not per-subject rows. Even a 1000-subject study produces a few KB of HTML; no pagination needed.
- **R5: Mismatch between verdict's `setAt` mtime and `999_ready.status` move when the user runs the importer but not processing between sessions.** → Mitigation: mtime only changes when the Population module writes the file; running the importer does not touch Population outputs, so the comparison is stable across import-only sessions. If a user manually edits `999_ready.status` (extremely rare), staleness detection firing is actually the correct behavior.
- **R6: Schema migration for older `.easl` files lacking `uiState.manifest`.** → Mitigation: every field in the new slot is `.optional()` with a `default({})` for `verdicts` and a `default(null)` for `lastRunVersions` / `lastPopulationRunMtime`, so existing files parse via Zod without manual migration.
- **R7: Stale-seeming verdicts when only the GUI version changed.** → Mitigation: GUI version is not part of the staleness key (only the `999_ready.status` mtime is); version fields update on the next `startProcessing` call independently of staleness.
