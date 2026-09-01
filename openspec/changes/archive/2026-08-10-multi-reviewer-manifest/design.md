## Context

The ExploreASL GUI manifest module currently supports a single anonymous reviewer assigning pass/fail verdicts to subject-sessions. Verdicts are stored as a flat `Record<subjectSession, ManifestVerdict>` in the `.easl` project file under `uiState.manifest.verdicts`. The UI is a 2-step stepper: QC Selection (DataTable with SegmentedControl per row) → Preview & Export (accordion with study parameters, software manifest, QC summary, pipeline summary).

Key architectural constraints:

- **Greenfield**: No public distributions exist — breaking schema changes carry zero migration burden.
- **Frontend-only**: All new logic (reviewer management, agreement computation, CSV export) is pure TypeScript. No Rust/backend changes needed.
- **Existing patterns**: Verdict setting goes through `projectStore.setManifestVerdict`, staleness uses `manifestStore.computeStaleVerdicts`, QC data is batch-fetched via the `get_all_subjects_qc` Rust command, export uses `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`.

## Goals / Non-Goals

**Goals:**

- Support 2–5 anonymous reviewers independently rating subject-sessions with blinded review (each reviewer cannot see others' verdicts).
- Automatically detect disagreements between reviewers and surface a resolution workflow.
- Compute and display inter-rater agreement (Cohen's/Fleiss' Kappa) for categorical pass/fail verdicts.
- Export per-reviewer verdicts, final verdicts, QC metrics, and agreement statistics as CSV.
- Preserve the existing single-reviewer workflow as the default — multi-reviewer is an opt-in extension.

**Non-Goals:**

- ICC on continuous QC metrics (coverage, SpatialCoV, motion) — future expansion.
- Named/authenticated reviewer identities — reviewers are anonymous labels.
- XLSX export — CSV only for v1.
- Run-level (per-ASL-run) reviewer verdicts — verdicts remain at the subject-session level.
- Adjudicator/lead-reviewer roles — any user at the terminal can resolve disagreements.
- Real-time multi-user collaboration (e.g. two people reviewing simultaneously on different machines) — this is a single-machine, turn-taking workflow.

## Decisions

### Decision 1: Mode-Dependent Verdict Storage

**Choice**: Retain `Record<subjectSession, Verdict>` while `reviewers` is undefined or has at most one entry. Use `Record<reviewerId, Record<subjectSession, Verdict>>` only when `reviewers` has 2+ entries. Adding the second reviewer wraps existing flat verdicts under the generated first reviewer's ID; removing back to one reviewer unwraps the remaining reviewer's slice.

**Alternatives considered**:

1. **Array of reviewer objects with embedded verdicts** — `reviewers: Array<{ id, label, verdicts: Record<string, Verdict> }>`. Rejected because Zustand's immutable updates are simpler with a normalized flat map than nested arrays. Also, accessing a specific reviewer's verdicts requires a find-by-id rather than a direct key lookup.

2. **Verdict schema gains a `reviewerId` field** — keep verdicts flat but add `reviewerId` to each verdict entry, creating `Record<string, Verdict & { reviewerId: string }>`. Rejected because this only supports one verdict per subject-session (the original constraint), and multi-reviewer needs N verdicts per subject-session. A compound key like `${reviewerId}:${subjectSession}` is fragile.

**Rationale**: The two-level map is natural for "N reviewers × M subjects" and enables O(1) lookup in both dimensions, while the flat single-reviewer representation preserves the existing default workflow and storage shape.

### Decision 2: Separate `resolvedVerdicts` Map

**Choice**: Store resolution verdicts in a dedicated `resolvedVerdicts: Record<subjectSession, ManifestVerdict>` map, separate from per-reviewer verdicts.

**Alternatives considered**:

1. **Merge resolutions into a synthetic "resolution" reviewer** — add a special reviewer with `id: "__resolution__"` and store resolved verdicts in its verdict slice. Rejected because it conflates the reviewer model (independent raters) with the adjudication model, and requires special-casing this reviewer ID throughout the UI.

2. **Compute final verdicts on-the-fly from reviewer verdicts only** — no explicit resolution storage; unanimous verdicts pass through, disagreements block export. Rejected because users need a persistent record of their resolution decision and the ability to navigate away and return.

**Rationale**: A separate map keeps the audit trail clean: per-reviewer verdicts record what each reviewer independently decided; `resolvedVerdicts` records what the final determination was when reviewers disagreed. The Preview/Export step computes `finalVerdicts` by preferring `resolvedVerdicts[ss]` over unanimous reviewer verdicts.

### Decision 3: Cohen's/Fleiss' Kappa for Agreement

**Choice**: Cohen's Kappa (κ) for 2 reviewers, Fleiss' Kappa for >2 reviewers, labeled "Inter-Rater Agreement".

**Alternatives considered**:

1. **ICC (Intraclass Correlation Coefficient)** — the user's original suggestion. Rejected because ICC is designed for continuous/ordinal data, not binary categorical (pass/fail). Using ICC on binary data is technically possible (as a special case of Pearson correlation) but produces misleading results and is not standard in QC literature.

2. **Simple percent agreement** — easy to compute but does not account for chance agreement. A 90% agreement rate might look good but be expected by chance if 95% of subjects pass. Kappa adjusts for this.

**Rationale**: Kappa is the standard measure for inter-rater reliability of categorical data in biomedical research. Computing it in pure TS is straightforward (≈40 lines). We also report simple agreement rate alongside Kappa as an intuitive complement.

### Decision 4: Tabbed UI for Blinded Review

**Choice**: Mantine `<Tabs>` component with one tab per reviewer. Each tab renders a `<QcSelectionTable>` scoped to that reviewer's verdict slice.

**Alternatives considered**:

1. **Single table with a reviewer selector dropdown** — one DataTable, a `<Select>` at the top to switch active reviewer. Simpler but less obvious that you're switching context, and higher risk of accidentally viewing another reviewer's data.

2. **Separate routes per reviewer** (`/manifest/reviewer/:id`) — gives full isolation but fragments the navigation and makes the stepper harder to manage.

**Rationale**: Tabs provide clear visual separation, are a familiar pattern, scale to 2–5 reviewers without scrolling, and Mantine's `<Tabs>` is already used elsewhere in the app. Each tab panel independently renders QcSelectionTable with a `reviewerId` prop, achieving blinding naturally.

### Decision 5: Conditional Resolution Step

**Choice**: The Verdict Resolution step is conditionally inserted only when `disagreements.length > 0`. Single-reviewer mode and unanimous multi-reviewer mode render exactly two steps; multi-reviewer mode with disagreements renders three.

**Alternatives considered**:

1. **Always show 3 steps in multi-reviewer mode** — the resolution step renders "No disagreements found" when empty. Rejected because it adds a needless click in the happy path (all reviewers agree).

2. **Modal overlay instead of a step** — show disagreements in a modal dialog rather than a stepper step. Rejected because the resolution table can be large (many disagreements) and modals don't scale well for tables with side-by-side comparison + quick-view actions.

**Rationale**: A conditional step keeps the happy path lean (2 steps) while giving disagreements the full-page treatment they deserve. The stepper dynamically adjusts its step count.

### Decision 6: CSV Export via Raw String Concatenation

**Choice**: Generate CSV as raw UTF-8 strings with proper escaping (RFC 4180), no library.

**Alternatives considered**:

1. **SheetJS (xlsx)** — full XLSX support but 500KB+ bundle, overkill for a single flat table.
2. **csv-stringify** — lightweight but an external dependency for something achievable in ~30 lines.

**Rationale**: CSV escaping (quote fields containing commas/newlines/quotes, double-up internal quotes) is trivial to implement correctly. Zero bundle impact. XLSX can be added later as a separate capability if users request it.

## Risks / Trade-offs

| Risk                                                     | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schema breakage for early testers**                    | Medium     | Low    | Greenfield — no public distributions. Add a schema version field to detect incompatible `.easl` files and show a clear error message rather than silently corrupting.                                                                                                                          |
| **Tab proliferation with 5 reviewers**                   | Low        | Medium | Cap at 5 reviewers. At 5 tabs, Mantine's `<Tabs>` gracefully overflows with scroll. Consider a compact mode (abbreviated labels) at ≥4 reviewers.                                                                                                                                              |
| **Kappa undefined for degenerate cases**                 | Medium     | Low    | For fewer than 2 complete ratings or when all ratings use one category (e.g., all pass), return `kappa: null` and null CI rather than NaN. Identical ratings spanning both categories yield κ = 1 and CI [1,1]; opposing all-pass/all-fail reviewers yield κ = 0. Display null results as N/A. |
| **QcSelectionTable performance with multiple instances** | Low        | Medium | Each tab panel renders its own DataTable. With 50–100 rows, this is fine. For very large studies (1000+ subjects), consider lazy-rendering only the active tab's table (Mantine Tabs `keepMounted={false}`).                                                                                   |
| **Resolution step UX confusion**                         | Medium     | Medium | Show a disagreement count badge when the conditional resolution step exists. When no disagreements exist, omit that step and render the 2-step flow.                                                                                                                                           |
| **CSV injection attacks**                                | Low        | Low    | Prefix cells starting with `=`, `+`, `-`, `@` with a leading apostrophe or tab character per OWASP CSV injection prevention guidelines.                                                                                                                                                        |
