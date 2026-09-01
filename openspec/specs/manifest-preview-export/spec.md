# manifest-preview-export Specification

## Purpose

Define manifest preview presentation and export behavior.

## Requirements

### Requirement: Manifest Preview Accordion Layout

The manifest preview SHALL render all sections inside a Mantine `Accordion` with `multiple` and `variant="separated"`. Single-reviewer mode SHALL contain four panels: Study Parameters, Software Manifest, QC Summary, and Pipeline Summary. Multi-reviewer mode SHALL contain five panels: Study Parameters, Software Manifest, QC Summary, Inter-Rater Agreement, and Pipeline Summary. Inter-Rater Agreement SHALL appear between QC Summary and Pipeline Summary. All rendered panels SHALL default open so full content is visible on first render; users MAY collapse individual panels.

#### Scenario: Accordion layout defaults to all open

- **WHEN** the Manifest Preview page is loaded
- **THEN** every rendered accordion panel SHALL be visible and expanded by default

#### Scenario: Single-reviewer mode shows four panels

- **WHEN** `reviewers` contains at most one entry or is undefined
- **THEN** exactly four panels SHALL render, with no Inter-Rater Agreement panel

#### Scenario: Multi-reviewer mode shows five panels

- **WHEN** `reviewers` contains at least two entries
- **THEN** five panels SHALL render in order: Study Parameters, Software Manifest, QC Summary, Inter-Rater Agreement, Pipeline Summary

### Requirement: Final Verdict Computation

For each SubjectSession, the final verdict used in preview aggregation and export SHALL be computed in this order:

1. Use `resolvedVerdicts[subjectSession]` when present.
2. Otherwise, when all reviewers have identical `status`, use the unanimous verdict.
3. Otherwise, treat the SubjectSession as an unresolved disagreement. Preview & Export SHALL be unreachable until such disagreements are resolved.

In single-reviewer mode, the final verdict SHALL be the sole flat-map verdict. QC Summary Pass/Total counts and all metric aggregation SHALL use final verdicts exclusively.

#### Scenario: Resolved verdict takes precedence

- **WHEN** reviewers disagree on `sub-01_01` and its resolved verdict is Pass
- **THEN** the final verdict SHALL be Pass

#### Scenario: Unanimous verdict used without resolution

- **WHEN** all reviewers set `sub-02_01` to Fail and no resolved verdict exists
- **THEN** the final verdict SHALL be Fail

#### Scenario: Single-reviewer mode uses sole verdict

- **WHEN** a single-reviewer project has a Pass verdict for `sub-01_01`
- **THEN** the final verdict SHALL be Pass, preserving pre-multi-reviewer behavior

### Requirement: Manifest Section 1 Study Parameters

The manifest preview SHALL render a "Study Parameters" section. For each `MetadataGroup` defined in the project's import snapshot, the section SHALL render one table with the group's `label` as a subheading and rows containing:

- N Subjects (count of SubjectSessions assigned to the group)
- N Total Runs (Σ `aslRuns.length` across group members)
- Arterial Spin Labeling Type (from `bidsParams.ArterialSpinLabelingType`)
- Post Labeling Delay (`bidsParams.Initial_PLD` or equivalent)
- Labeling Duration (CASL/PCASL only; omitted for PASL)
- Bolus Cut Off Flag (PASL only)
- Bolus Cut Off Delay Time (PASL only; omitted if `BolusCutOffFlag` is false)
- M0 Type (`bidsParams.M0Type`)
- Background Suppression (`bidsParams.BackgroundSuppression`)
- MR Acquisition Type (`bidsParams.MRAcquisitionType`)
- Magnetic Field Strength (`bidsParams.MagneticFieldStrength`)
- Repetition Time (`bidsParams.RepetitionTime`)
- Echo Time (`bidsParams.EchoTime`)
- Flip Angle (`bidsParams.FlipAngle`)

Conditional rows (Labeling Duration for PASL, Bolus Cut Off Delay Time when `BolusCutOffFlag` is false) SHALL be omitted from the rendered output rather than shown as blanks.

#### Scenario: PCASL group shows Labeling Duration

- **WHEN** a metadata group has `ArterialSpinLabelingType: "PCASL"` and `LabelingDuration: 1800`
- **THEN** the rendered Section 1 table for that group SHALL include a "Labeling Duration" row with value `"1800 ms"` (or equivalent unit-normalized string)

#### Scenario: PASL group omits Labeling Duration

- **WHEN** a metadata group has `ArterialSpinLabelingType: "PASL"`
- **THEN** the rendered Section 1 table for that group SHALL NOT include a "Labeling Duration" row

#### Scenario: Ungrouped subjects bucket

- **WHEN** SubjectSessions exist with no assigned `MetadataGroup`
- **THEN** Section 1 SHALL render an additional "Ungrouped" subheading with the same row schema, computed across all ungrouped SubjectSessions

### Requirement: Manifest Section 2 Software Manifest

The preview SHALL render a "Software Manifest" section containing two sub-sections with `Title order={5}` sub-headings:

#### Sub-section: Versions

A 3-row table with columns `Software` / `Version`, listing:

- ExploreASL Version (from `uiState.manifest.lastRunVersions.exploreASL`, or `"unknown"` if absent)
- ExploreASL GUI Version (from `uiState.manifest.lastRunVersions.gui`, or `"unknown"` if absent)
- MATLAB Version (from `uiState.manifest.lastRunVersions.matlab`, or `"unknown"` if absent)

#### Sub-section: ExploreASL Data Parameter Configuration

When `dataPar` is non-empty, the preview SHALL render a `<Code block>` (Mantine) containing the full `dataPar` object serialised as pretty-printed JSON (`JSON.stringify(..., null, 2)`), after the following sanitisation:

- `x.dataset.subjectRegexp` SHALL always be replaced with the canonical shorthand `"^sub-.*"` (the actual stored regex is a long BIDS-derived pattern and is not meaningful for reproducibility reporting).
- `x.dataset.ForceInclusionList` SHALL be omitted entirely (not relevant for reproducibility).

The sanitised copy is used only for display; the underlying stored `dataPar` is unchanged.

The source SHALL be the `dataPar.json` file written under `<project_root>/derivatives/ExploreASL/dataPar.json` at the most recent `startProcessing`.

A spec-level reservation SHALL note that human-readable label translation of `dataPar.json` keys is a future expansion point — no v0 implementation required.

#### Scenario: dataPar code block shows sanitised values

- **WHEN** the most recent `dataPar.json` contains `x.dataset.subjectRegexp: "^sub-(?!excluded).*"` and `x.dataset.ForceInclusionList: ["sub-01"]`
- **THEN** Section 2's data parameter code block SHALL display `"subjectRegexp": "^sub-.*"` and SHALL NOT contain a `ForceInclusionList` key

#### Scenario: Unknown version placeholder

- **WHEN** `uiState.manifest.lastRunVersions.exploreASL` is `undefined` at preview time
- **THEN** Section 2 SHALL render the ExploreASL Version row with value `"unknown"`

### Requirement: Manifest Section 3 Qc Summary

The preview SHALL render a "QC Summary" section. For each `MetadataGroup`, the section SHALL render a subheading and a table with rows:

- Metadata group name (group `label`)
- Pass / Total (count with final verdict Pass / count with final verdict Pass or Fail, displayed as `"N / Total"`)
- Mean ASL Coverage Percentage & SD (mean and sample standard deviation across final-Pass group members' `Coverage.tsv`, formatted as `"mean (SD)"`)
- Mean Spatial Coefficient of Variation in Gray Matter & SD (mean and sample standard deviation across final-Pass group members' `SpatialCoV.tsv`, formatted as `"mean (SD)"`)
- Mean Motion in mm RMS & SD (maximum across each final-Pass SubjectSession's ASL runs, then mean and sample standard deviation across group members, formatted as `"mean (SD)"`)
- Mean Motion Exclusion Percentage & SD (as emitted by ExploreASL; mean and sample standard deviation across final-Pass group members, formatted as `"mean (SD)"`)

Rows with final verdict Fail SHALL be excluded from all QC metric aggregations but SHALL count toward the Total denominator. No Info rows SHALL be excluded from numerator and denominator. Pass / Total SHALL therefore render `"<passCount> / <passCount + failCount>"`.

When a group has fewer than 2 SubjectSessions in the aggregation (e.g. only one Pass row after exclusion), the SD component SHALL be rendered as the literal `"N/A"` (sample SD undefined for n < 2), with the mean component rendered normally.

In multi-reviewer mode, each per-group QC Summary table SHALL include an Initial Agreement Rate column showing the percentage of eligible SubjectSessions where all reviewers' statuses were unanimous before resolution, formatted as `"N%"`. This column SHALL be omitted in single-reviewer mode.

#### Scenario: Pass / Total with mixed verdicts

- **WHEN** a metadata group has 10 SubjectSessions: 7 final Pass, 2 final Fail, 1 No Info
- **THEN** Section 3's "Pass / Total" cell for that group SHALL render `"7 / 9"` (No Info row excluded from both numerator and denominator)

#### Scenario: Fail rows excluded from coverage mean and SD

- **WHEN** a metadata group has 3 SubjectSessions: 2 final Pass (coverage 95%, 90%) and 1 final Fail (coverage 50%)
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"92.5 (3.54)"` (mean and sample standard deviation of 95 and 90, Fail excluded)

#### Scenario: SD renders N/A for single-subject group

- **WHEN** a metadata group has 1 SubjectSession with final verdict Pass and coverage 88%
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"88.0 (N/A)"`

#### Scenario: Motion aggregation uses worst run per subject

- **WHEN** a SubjectSession has 3 ASL runs with motion RMS values `[0.4, 0.7, 0.5]` mm, and its final verdict is Pass
- **THEN** the SubjectSession's contribution to the group's Mean Motion aggregation SHALL be `0.7` (max across runs)

#### Scenario: Initial agreement rate shown in multi-reviewer mode

- **WHEN** a group has 20 eligible SubjectSessions and all reviewers initially agreed on 16
- **THEN** the group's Initial Agreement Rate column SHALL display `"80%"`

#### Scenario: Initial agreement rate hidden in single-reviewer mode

- **WHEN** the project has at most one reviewer
- **THEN** QC Summary tables SHALL omit the Initial Agreement Rate column

### Requirement: Inter-Rater Agreement Section

In multi-reviewer mode, preview SHALL render an "Inter-Rater Agreement" accordion panel between QC Summary and Pipeline Summary. Its overall table SHALL show Number of Reviewers, Overall Initial Agreement Rate formatted as `"N% (agreed/total)"`, Cohen's Kappa for exactly two reviewers or Fleiss' Kappa for more reviewers with unclamped 95% confidence interval formatted as `"κ = 0.82 [0.71, 0.90]"`, Number of Subjects, and Subjects Requiring Resolution. A per-group table SHALL show group label, n, Initial Agreement Rate, and Kappa with CI or `"N/A"` when undefined.

Below the tables, the section SHALL display: `Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.` The entire section SHALL be omitted in single-reviewer mode.

#### Scenario: Agreement section displayed in multi-reviewer mode

- **WHEN** two reviewers rate 50 eligible SubjectSessions, agree initially on 43, and disagree on 7
- **THEN** the section SHALL show 2 reviewers, `"86% (43/50)"`, Kappa with 95% CI, 50 subjects, 7 requiring resolution, and small-sample guidance

#### Scenario: Agreement section omitted in single-reviewer mode

- **WHEN** the project has at most one reviewer
- **THEN** no Inter-Rater Agreement panel SHALL render

#### Scenario: Kappa method depends on reviewer count

- **WHEN** exactly two reviewers exist
- **THEN** Cohen's Kappa SHALL be used; with three or more reviewers, Fleiss' Kappa SHALL be used

### Requirement: Manifest Section 4 Pipeline Summary Paragraph

The preview SHALL render a "Pipeline Summary" section containing a single paragraph. The paragraph text SHALL be a static template (stored as a TS template literal in code) drawn from `notes/Manifest_Pipeline_Summary.md` with the following substitutions applied at render time:

- ExploreASL version → `uiState.manifest.lastRunVersions.exploreASL ?? "unknown"`
- MATLAB version → `uiState.manifest.lastRunVersions.matlab ?? "unknown"`
- GUI version → `uiState.manifest.lastRunVersions.gui ?? "unknown"`
- Subject count → total SubjectSessions included in the manifest (excluding No Info)
- Study-level counts as needed by the paragraph

Clauses SHALL NOT be toggled based on `dataPar.json` flags in v0 — the paragraph structure is static. A spec-level reservation SHALL note that clause-toggling based on `dataPar.json` is a future expansion point.

#### Scenario: Unknown versions substituted in paragraph

- **WHEN** `lastRunVersions` is `undefined` and the user previews the manifest
- **THEN** Section 4 SHALL contain the substring `"unknown"` in the positions where ExploreASL, MATLAB, and GUI versions would otherwise appear

#### Scenario: Paragraph is static for v0

- **WHEN** `dataPar.json` has `bPVCNativeSpace: true` in one project and `bPVCNativeSpace: false` in another project (otherwise identical)
- **THEN** the rendered Section 4 paragraphs for the two projects SHALL be textual identical (modulo version / count substitutions)

### Requirement: Methods And References Subsections

The preview and exported manifest formats SHALL contain "Methods" and "References" subsections under Section 4: Pipeline Summary. The "Methods" subsection SHALL contain a list of paragraphs generated dynamically based on the current `dataPar.json` configuration parameters (such as `motionCorrection`, `bLesionFilling`, `bPVCNativeSpace`, `bSegmentSPM12`, etc.), falling back to default parameter values when missing. The "References" subsection SHALL contain a sorted, unique list of corresponding bibliographic references derived from the generated methods paragraphs.

#### Scenario: Dynamic methods and references populated

- **WHEN** `dataPar.json` specifies white matter hyperintensity segmentations (`bLesionFilling: true`) and native space partial volume correction (`bPVCNativeSpace: 1`)
- **THEN** the Methods subsection SHALL contain description paragraphs for these pipeline choices, and the References subsection SHALL contain the corresponding citations (e.g. Asllani 2008, Battaglini 2012, Oliver 2015, Schmidt 2012, de Sitter 2017a).

### Requirement: Live Preview Updates On Verdict Changes

The preview SHALL update live when the user navigates back to QC Selection, changes verdicts for any reviewer, and returns to Preview & Export. Final verdicts SHALL be recomputed from current reviewer and resolved verdicts on each render. No manual refresh or export SHALL be needed.

#### Scenario: Counts update after toggling Fail to Pass

- **WHEN** the user navigates back to QC Selection, flips a reviewer verdict from Fail to Pass, and returns to Preview & Export
- **THEN** the Pass / Total cell SHALL reflect the recomputed final verdict count

#### Scenario: Agreement stats update after verdict change

- **WHEN** changing a reviewer verdict changes initial agreement or introduces a disagreement
- **THEN** the Inter-Rater Agreement section SHALL reflect updated agreement and Kappa values on return

### Requirement: Markdown And HTML Export

The preview SHALL expose "Export Markdown" and "Export HTML" buttons. Clicking either SHALL open a Tauri save dialog and write the formatted manifest file at the chosen path. Both formats SHALL be byte-identical across Windows 11, macOS, and Linux for the same input state.

- Markdown: produced by a TS template literal; written via `@tauri-apps/plugin-fs` `writeTextFile`.
- HTML: produced by templating the same Markdown payload into an inline-CSS single-file wrapper. The wrapper SHALL include all CSS inline; SHALL NOT reference external stylesheets; SHALL NOT invoke the WebView rendering pipeline (no `webview.printToPdf`).

Both buttons SHALL be disabled when no reviewer has any stored verdict entry. In multi-reviewer mode, Markdown and HTML SHALL include Inter-Rater Agreement between QC Summary and Pipeline Summary with the preview's reviewer count, overall and per-group Initial Agreement Rate, Kappa and unclamped CI, subjects requiring resolution, and Kappa guidance. Single-reviewer exports SHALL omit this section.

In the exported formats, the "ExploreASL Data Parameter Configuration" sub-section SHALL be rendered as a fenced JSON code block (` ```json ``` ` in Markdown; `<pre><code>…</code></pre>` in HTML), using the same sanitisation rules (subjectRegexp canonical shorthand, ForceInclusionList omitted) as the preview. The HTML wrapper SHALL include `pre` / `pre code` CSS rules for legible monospace rendering.

A spec-level reservation SHALL note that a "Export PDF" button is a future expansion point, not part of v0.

#### Scenario: Markdown export writes file

- **WHEN** the user clicks "Export Markdown", chooses a path, and confirms the save dialog
- **THEN** a UTF-8 text file SHALL exist at the chosen path whose content matches the manifest preview rendered as Markdown

#### Scenario: HTML export is self-contained

- **WHEN** the user clicks "Export HTML", chooses a path, and confirms
- **THEN** the resulting HTML file SHALL contain all CSS inline, SHALL contain no `<link>` tags referencing external stylesheets, and SHALL render correctly when opened directly from disk without a server

#### Scenario: Identical output across platforms

- **WHEN** the same `uiState.manifest` state is exported on Windows 11, macOS, and Linux
- **THEN** the byte content of the Markdown file SHALL be identical across the three OSes, and the byte content of the HTML file SHALL be identical across the three OSes

#### Scenario: Export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** both export buttons SHALL render in a disabled state

#### Scenario: Multi-reviewer exports include agreement section

- **WHEN** a multi-reviewer project exports Markdown or HTML
- **THEN** output SHALL include Inter-Rater Agreement data and Kappa guidance between QC Summary and Pipeline Summary

#### Scenario: Single-reviewer exports omit agreement section

- **WHEN** a single-reviewer project exports Markdown or HTML
- **THEN** output SHALL omit Inter-Rater Agreement

### Requirement: CSV Export

The preview SHALL expose an "Export CSV" button after "Export Markdown" and "Export HTML". Clicking it SHALL open a Tauri save dialog and write UTF-8 CSV. The `manifest-csv-export` capability is authoritative for exact content, mode-specific columns, QC metric names, agreement statistics, escaping, and `\n` line endings.

Multi-reviewer columns SHALL be `SubjectSession`; registry-ordered `Reviewer_N_Verdict`, `Reviewer_N_Reason`, and `Reviewer_N_Notes` triplets; `Final_Verdict`; `Resolution_Notes`; `Coverage_Pct`; `SpatialCoV`; `Motion_mm`; and `Motion_Exclusion_Pct`. Single-reviewer columns SHALL be `SubjectSession`, `Verdict`, `Reason`, `Notes`, `Coverage_Pct`, `SpatialCoV`, `Motion_mm`, and `Motion_Exclusion_Pct`. Single-reviewer CSV SHALL contain no final/resolution/per-reviewer columns or agreement section. The button SHALL be disabled when no verdict exists.

#### Scenario: Multi-reviewer CSV uses numbered reviewer columns

- **WHEN** a two-reviewer project exports CSV
- **THEN** output SHALL contain two registry-ordered reviewer triplets, final and resolution fields, and exact QC metric columns

#### Scenario: CSV export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** Export CSV SHALL be disabled

#### Scenario: Single-reviewer CSV uses simplified columns

- **WHEN** a single-reviewer project exports CSV
- **THEN** its header SHALL be `SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct` and no agreement section SHALL appear

### Requirement: ManifestPreview uses summarizeAslContext for ASLContext display

`ManifestPreview.tsx` §1 study parameters table SHALL render `summarizeAslContext(group.bidsParams.ASLContext)` instead of the raw ASLContext string when displaying the `ASLContext` field. Raw ASLContext persists in `mappingState.bidsParams.ASLContext` (per `metadata-grouping-ui` spec) — the summary form is display-only.

Existing behavior for other `bidsParams` fields (conditional skipping of `LabelingDuration` for PASL, `BolusCutOffDelayTime` when `BolusCutOffFlag` is false) is preserved.

`ManifestPreview.tsx` continues to iterate `Object.entries(group.bidsParams)` (raw sidecar field rendering). Vendor/Sequence/LabelingType fields are review-panel display-only — NOT persisted in `mappingState.metadataGroups[].bidsParams` (per `project-store` confirmBidsReview spec).

#### Scenario: Manifest §1 shows ASLContext summary

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is the ds000240 raw 109-token string
- **THEN** the row displays `"m0scan x10, label-control pair x50"` (summarized form), not the raw comma-separated string

#### Scenario: Manifest §1 hides absent ASLContext

- **WHEN** `ManifestPreview` renders §1 for a group whose `bidsParams.ASLContext` is undefined (no aslcontext.tsv-based context, e.g., a DICOM-import project where `studyPar.json` omitted ASLContext)
- **THEN** the `ASLContext` row is omitted (existing behavior — `val == null` check at `ManifestPreview.tsx:89`)

#### Scenario: Manifest §1 renders raw sidecar fields unmodified

- **WHEN** `ManifestPreview` renders §1 for a BIDS-direct group
- **THEN** fields like `Manufacturer: "Siemens"`, `PulseSequenceType: "spiral"`, `MRAcquisitionType: "3D"`, `ArterialSpinLabelingType: "PCASL"`, `M0Type: "Included"` render directly from `bidsParams` (post-schema transform values). `Vendor`, `Sequence`, `LabelingType` derived fields are NOT rendered (not in `bidsParams`).
