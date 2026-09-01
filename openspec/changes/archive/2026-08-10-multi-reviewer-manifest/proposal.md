## Why

The current manifest module supports only a single anonymous reviewer assigning pass/fail verdicts to subject-sessions. In clinical and research ASL QC workflows, inter-rater reliability is a standard methodological requirement — multiple reviewers independently rate image quality and their agreement is quantified. Without multi-reviewer support, users must resort to external spreadsheets and manual reconciliation, breaking the integrated QC workflow the GUI provides.

## What Changes

- **BREAKING**: `ManifestUiStateSchema` supports mode-dependent verdict storage: implicit single-reviewer mode (`reviewers` undefined or length ≤1) stores a flat `Record<subjectSession, Verdict>`; multi-reviewer mode (2+ reviewers) stores `Record<reviewerId, Record<subjectSession, Verdict>>`. Transitions wrap or unwrap existing verdicts. No on-disk migration of historic schemas required (greenfield).
- New reviewer management: add/remove anonymous reviewers ("Reviewer 1", "Reviewer 2", …), support for 2–5 reviewers.
- Multi-reviewer mode activates implicitly when a second reviewer is added; reverts to single-reviewer mode when all but one are removed.
- QC Selection step gains tabbed UI — each reviewer works in their own tab, blinded from others' verdicts.
- New conditional **Verdict Resolution** step appears when reviewer verdicts disagree. Disagreements are shown side-by-side with quick-access viewers (images, QC metrics, logs). Resolutions are stored in a separate `resolvedVerdicts` map — no particular reviewer is designated as resolver, the resolution simply records the final verdict per subject-session.
- **Inter-Rater Agreement** computed via Cohen's Kappa (2 reviewers) or Fleiss' Kappa (>2 reviewers) on pass/fail categorical data. Displayed in Preview & Export.
- New **CSV spreadsheet export** with per-reviewer verdicts, final verdicts, QC metrics, and agreement statistics.
- Stepper extends from 2 steps to 2–3 steps depending on whether disagreements exist.

## Capabilities

### New Capabilities

- `multi-reviewer-registry`: Reviewer management — add, remove, rename anonymous reviewers; implicit mode switching between single/multi; reviewer list persisted in `.easl`.
- `multi-reviewer-verdicts`: Reviewer-indexed verdict storage and per-reviewer verdict setting; tabbed blinded QC selection; per-reviewer completion tracking.
- `verdict-resolution`: Conditional resolution step for disagreeing verdicts; side-by-side disagreement view with quick-access image/metric/log viewers; resolution verdict storage.
- `inter-rater-agreement`: Cohen's/Fleiss' Kappa computation on categorical pass/fail verdicts; confidence intervals; agreement rate; display in manifest preview.
- `manifest-csv-export`: CSV spreadsheet export of per-reviewer verdicts, final verdicts, QC metrics, and agreement statistics.

### Modified Capabilities

- `manifest-verdicts`: Verdict storage is flat in implicit single-reviewer mode and reviewer-indexed in multi-reviewer mode. `ManifestUiStateSchema` gains `reviewers`, `activeReviewerId`, and `resolvedVerdicts` fields. Multi-reviewer staleness is computed for every reviewer and exposed as reviewer-indexed slices; QC reads only the active slice.
- `manifest-qc-selection`: QC Selection table becomes reviewer-scoped via tabs. "Next" gate requires ALL reviewers to have completed their verdicts. "Bulk Mark Complete→Pass" scopes to active reviewer.
- `manifest-preview-export`: Preview gains an "Inter-Rater Agreement" section. Final verdicts computed from resolved + unanimous verdicts. CSV export button added alongside Markdown/HTML.
- `manifest-phase`: Stepper extends to 2–3 steps (QC Selection → [Verdict Resolution] → Preview & Export).

## Impact

- **Schemas**: `src/schemas/project.ts` (ManifestUiStateSchema, ManifestVerdictSchema shape), `src/schemas/manifestSchemas.ts` (new types)
- **Stores**: `src/stores/projectStore.ts` (reviewer CRUD, scoped verdict setting, resolved verdict), `src/stores/manifestStore.ts` (reviewer mode, disagreement computation, agreement stats)
- **Components**: `src/pages/ManifestPage.tsx` (conditional 2- or 3-step stepper), `src/components/manifest/QcSelectionTable.tsx` (tab-scoped), `src/components/manifest/ManifestPreview.tsx` (agreement section, CSV export)
- **New libs**: `src/lib/interRaterAgreement.ts` (Kappa), `src/lib/manifestCsvExport.ts`
- **New components**: `ReviewerTabs.tsx`, `VerdictResolution.tsx`, `AgreementSummary.tsx`
- **Specs**: 5 new spec files, 4 existing specs modified
- **No backend (Rust) changes** — all new logic is frontend-only
- **No external dependencies** — CSV export via raw string concatenation, Kappa computed in pure TS
