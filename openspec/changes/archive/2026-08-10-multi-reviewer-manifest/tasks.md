# Multi-Reviewer Manifest Implementation Plan & Tasks

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Add multi-reviewer manifest review, resolution, agreement, and CSV export.

**Architecture:** Implicit single-reviewer mode (`reviewers` undefined or ≤1) stores flat `Record<subjectSession, Verdict>` data. Multi-reviewer mode (2+) stores `Record<reviewerId, Record<subjectSession, Verdict>>`; transitions wrap/unwrap data. Stepper has 2 steps unless multi-reviewer disagreements require a third. Agreement uses Cohen's/Fleiss' Kappa. CSV uses raw strings.

**Tech Stack:** React 19, TypeScript 7, Mantine 9, Zustand 5, Zod 4, Vitest

---

## 1. Schema & Type Foundation

- [x] 1.1 Write failing schema tests in `src/schemas/manifestSchemas.test.ts`
  - Assert flat verdicts parse when `reviewers` is undefined or has ≤1 entry; nested verdicts parse only in multi-reviewer mode; non-empty mode-mismatched maps are rejected.
  - Assert valid reviewer entries, `resolvedVerdicts`, empty-label rejection, invalid-UUID rejection, and rejection of more than 5 reviewers.
  - Run and observe failure: `pnpm test src/schemas/manifestSchemas.test.ts`

- [x] 1.2 Write failing project-schema compatibility tests in `src/schemas/project.test.ts`
  - Cover no reviewers, flat single-reviewer verdicts, and nested multi-reviewer verdicts.
  - Run and observe failure: `pnpm test src/schemas/project.test.ts`

- [x] 1.3 Implement `ManifestUiStateSchema` in `src/schemas/project.ts`
  - Add `ReviewerSchema` (`id` UUID, nonempty max-100 `label`, ISO datetime `createdAt`), optional `reviewers` and `activeReviewerId`, optional `resolvedVerdicts`, and mode-appropriate flat-or-nested `verdicts` validation.
  - Export updated `Reviewer` and `ManifestUiState` types.

- [x] 1.4 Implement manifest schema exports in `src/schemas/manifestSchemas.ts`
  - Re-export reviewer schema/type; add `MAX_REVIEWERS = 5` and `ReviewerMode = "single" | "multi"`.
  - Re-run 1.1–1.2 tests and confirm green.

**🔖 Commit point:** `feat(schemas): add multi-reviewer fields to ManifestUiStateSchema`

---

## 2. Inter-Rater Agreement Library

- [x] 2.1 Write failing `src/lib/interRaterAgreement.test.ts`
  - Cover intersection-only inputs; partial agreement; category-varying identical ratings → κ 1/CI [1,1]; all ratings in one category → null κ/CI and agreement 1; all-pass versus all-fail → κ 0; n < 2 → nullable κ/CI; Fleiss known, perfect, degenerate, and missing-rating cases; `formatKappa`.
  - Run and observe failure: `pnpm test src/lib/interRaterAgreement.test.ts`

- [x] 2.2 Implement `src/lib/interRaterAgreement.ts`
  - Implement `cohensKappa`, `fleissKappa`, and `formatKappa` with nullable `kappa`, `ci95Lower`, and `ci95Upper` when undefined; preserve specified formulas when defined.
  - Re-run 2.1 tests and confirm green.

**🔖 Commit point:** `feat(lib): add inter-rater agreement (Cohen's/Fleiss' Kappa) computation`

---

## 3. CSV Export Library

- [x] 3.1 Write failing `src/lib/manifestCsvExport.test.ts`
  - Cover RFC 4180 and formula-injection escaping, empty bodies, numbered multi-reviewer Verdict/Reason/Notes columns, exact QC names, simplified single-reviewer columns without final/resolution fields, and agreement section only in multi-reviewer output.
  - Run and observe failure: `pnpm test src/lib/manifestCsvExport.test.ts`

- [x] 3.2 Implement `src/lib/manifestCsvExport.ts`
  - Implement `escapeCsvField`, verdict CSV, and agreement CSV using the authoritative `manifest-csv-export` columns and mode rules.
  - Re-run 3.1 tests and confirm green.

**🔖 Commit point:** `feat(lib): add CSV export for manifest verdicts and agreement`

---

## 4. Project Store — Reviewer Management Actions

- [x] 4.1 Write failing store tests in `src/stores/projectStore.test.ts` (or `projectStore.manifest.test.ts`)
  - Cover single-to-multi add wrapping flat data for both an undefined and a one-entry reviewer registry, add at cap, immediate pure removal (including a nonempty slice), remove to one unwrapping flat data and clearing resolutions, scoped and implicit verdict writes, resolved verdict actions, and rename success/invalid/unknown-id behavior including dirty state.
  - Run and observe failure: `pnpm test src/stores/projectStore.test.ts`

- [x] 4.2 Implement reviewer actions in `src/stores/projectStore.ts`
  - Implement `addReviewer`, pure immediate `removeReviewer`, `renameReviewer(id, label)`, and `setActiveReviewerId`; preserve anonymous defaults, enforce 2–5 multi mode, wrap/unwrap verdict data, and mark dirty only for successful state changes.

- [x] 4.3 Implement mode-aware verdict actions in `src/stores/projectStore.ts`
  - Update `setManifestVerdict` and removal for flat single mode versus nested multi mode; add `setResolvedVerdict` and `removeResolvedVerdict`.
  - Re-run 4.1 tests and confirm green.

**🔖 Commit point:** `feat(store): add reviewer management and scoped verdict actions to projectStore`

---

## 5. Manifest Store — Disagreements & Agreement Computation

- [x] 5.1 Write failing `src/stores/manifestStore.test.ts`
  - Cover single/multi mode, unanimous and 2-/3-reviewer disagreements, Kappa function selection, flat single-reviewer staleness, and a full `Record<reviewerId, Set<subjectSession>>` multi-reviewer staleness result computed for every reviewer.
  - Run and observe failure: `pnpm test src/stores/manifestStore.test.ts`

- [x] 5.2 Implement manifest derived state in `src/stores/manifestStore.ts`
  - Add reviewer mode, disagreements, nullable agreement results, disagreement/agreement actions, and mode-aware stale verdict iteration that computes every reviewer slice and exposes the full multi-reviewer record.
  - Re-run 5.1 tests and confirm green.

**🔖 Commit point:** `feat(store): add disagreement computation and agreement stats to manifestStore`

---

## 6. Reviewer Tabs Component

- [x] 6.1 Write failing `src/components/manifest/ReviewerTabs.test.tsx`
  - Cover no tabs in single mode; labels and completion badges in multi mode; `ReviewerTabs` confirmation only for nonempty verdict slices (and no store call after cancellation); cap; and rename action if exposed by this component.
  - Run and observe failure: `pnpm test src/components/manifest/ReviewerTabs.test.tsx`

- [x] 6.2 Implement `src/components/manifest/ReviewerTabs.tsx`
  - Render Mantine tabs only in multi mode with `data-testid="reviewer-tabs"` and `reviewer-tab-{id}`; provide capped add controls and own removal confirmation before calling the pure store action.
  - Re-run 6.1 tests and confirm green.

**🔖 Commit point:** `feat(ui): add ReviewerTabs component for multi-reviewer management`

---

## 7. Scoped QcSelectionTable

- [x] 7.1 Write failing `QcSelectionTable.test.tsx` cases
  - Cover reviewer-slice reads/writes, active-reviewer bulk action, blinded view, and unchanged flat single-reviewer behavior.
  - Run and observe failure: `pnpm test src/components/manifest/QcSelectionTable.test.tsx`

- [x] 7.2 Implement mode-aware `src/components/manifest/QcSelectionTable.tsx`
  - Accept optional `reviewerId`; use the scoped nested slice only in multi mode and flat storage in single mode; read only the active reviewer's staleness slice and scope bulk completion.
  - Re-run 7.1 tests and confirm green.

**🔖 Commit point:** `feat(ui): scope QcSelectionTable to active reviewer`

---

## 8. ManifestPage Stepper Update

- [x] 8.1 Write failing `ManifestPage.test.tsx` cases
  - Assert 2 steps for single-reviewer and unanimous multi-reviewer modes, 3 only for multi-reviewer disagreements, and Next blocked until every reviewer completes QC.
  - Run and observe failure: `pnpm test src/pages/ManifestPage.test.tsx`

- [x] 8.2 Implement dynamic `src/pages/ManifestPage.tsx` stepper
  - Wrap QC selection in reviewer tabs; omit resolution when unanimous; require all reviewers before Next; require resolutions only when the third step exists.
  - Re-run 8.1 tests and confirm green.

**🔖 Commit point:** `feat(ui): update ManifestPage stepper for multi-reviewer flow`

---

## 9. Verdict Resolution Component

- [x] 9.1 Write failing `src/components/manifest/VerdictResolution.test.tsx`
  - Cover disagreement rows, resolution storage, bulk resolution, gate state, viewers, and empty state.
  - Run and observe failure: `pnpm test src/components/manifest/VerdictResolution.test.tsx`

- [x] 9.2 Implement `src/components/manifest/VerdictResolution.tsx`
  - Render disagreement DataTable, resolution controls, reviewer bulk actions, quick-access viewers, and `data-testid="verdict-resolution"`.
  - Re-run 9.1 tests and confirm green.

**🔖 Commit point:** `feat(ui): add VerdictResolution component for disagreement resolution`

---

## 10. Preview & Export Enhancements

- [x] 10.1 Write failing preview/export tests
  - Add `ManifestPreview.test.tsx` tests for single/multi agreement visibility, final verdict precedence, CSV button state, and export payloads; add agreement summary tests as needed.
  - Run and observe failure: `pnpm test src/components/manifest/ManifestPreview.test.tsx`

- [x] 10.2 Implement `src/components/manifest/AgreementSummary.tsx`
  - Render multi-reviewer-only agreement data, nullable Kappa/CI display, per-group results, and `data-testid="agreement-summary"`.

- [x] 10.3 Implement `src/components/manifest/ManifestPreview.tsx`
  - Compute final verdicts from resolutions then unanimity; use them for summaries; add agreement panel and CSV export while preserving unchanged single-reviewer Markdown/HTML behavior.

- [x] 10.4 Implement multi-reviewer `src/lib/manifestExport.ts` payload support
  - Add agreement sections to Markdown and HTML only for multi-reviewer mode; re-run 10.1 tests and confirm green.

**🔖 Commit point:** `feat(ui): add agreement summary and CSV export to ManifestPreview`

---

## 11. Integration Testing & Polish

- [x] 11.1 Run full test suite: `pnpm test`
- [x] 11.2 Run linter: `pnpm lint`
- [x] 11.3 Run type checker: `pnpm typecheck`
- [x] 11.4 Manual smoke test: `pnpm tauri dev`
  - Verify flat single-reviewer workflow; reviewer transitions; blinded tabs; conditional resolution; CSV mode columns; agreement edge-case display.

**🔖 Commit point:** `test: integration verification for multi-reviewer manifest`
