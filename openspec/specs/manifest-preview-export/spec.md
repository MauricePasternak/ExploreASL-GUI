# manifest-preview-export Specification

## Purpose

TBD - created by archiving change project-manifest. Update Purpose after archive.

## Requirements

### Requirement: Manifest Preview Accordion Layout

The manifest preview SHALL render all four sections — Study Parameters, Software Manifest, QC Summary, and Pipeline Summary — inside a Mantine `Accordion` with `multiple` and `variant="separated"`. All panels SHALL default to open (`defaultValue` contains all four keys) so the full content is visible on first render. Users MAY collapse individual panels for easier scrolling.

#### Scenario: Accordion layout defaults to all open

- **WHEN** the Manifest Preview page is loaded
- **THEN** all four accordion panels (Study Parameters, Software Manifest, QC Summary, Pipeline Summary) SHALL be visible and expanded by default

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
- Pass / Total (count of SubjectSessions with `status: "pass"` / count of SubjectSessions with `status: "pass"` or `status: "fail"` in the group, displayed as `"N / Total"`)
- Mean ASL Coverage Percentage & SD (mean and standard deviation across group members' `Coverage.tsv`, excluding No Info and Fail rows; cell formatted as `"mean (SD)"`)
- Mean Spatial Coefficient of Variation in Gray Matter & SD (mean and standard deviation across group members' `SpatialCoV.tsv`, excluding No Info and Fail rows; cell formatted as `"mean (SD)"`)
- Mean Motion in mm RMS & SD (max across each SubjectSession's ASL runs, then mean and standard deviation across group members, excluding No Info and Fail rows; cell formatted as `"mean (SD)"`)
- Mean Motion Exclusion Percentage & SD (as emitted by ExploreASL; mean and standard deviation across group, excluding No Info and Fail rows; cell formatted as `"mean (SD)"`)

Rows with `status: "fail"` SHALL be excluded from all QC Summary aggregations but SHALL still count toward the "Total" denominator. No Info rows SHALL be excluded from both numerator and denominator. The "Pass / Total" cell SHALL therefore render as `"<passCount> / <passCount + failCount>"` (No Info excluded from denominator).

When a group has fewer than 2 SubjectSessions in the aggregation (e.g. only one Pass row after exclusion), the SD component SHALL be rendered as the literal `"N/A"` (population SD undefined for n < 2), with the mean component rendered normally.

#### Scenario: Pass / Total with mixed verdicts

- **WHEN** a metadata group has 10 SubjectSessions: 7 Pass, 2 Fail, 1 No Info
- **THEN** Section 3's "Pass / Total" cell for that group SHALL render `"7 / 9"` (No Info row excluded from both numerator and denominator)

#### Scenario: Fail rows excluded from coverage mean and SD

- **WHEN** a metadata group has 3 SubjectSessions: 2 Pass (coverage 95%, 90%) and 1 Fail (coverage 50%)
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"92.5 (3.54)"` (mean and sample standard deviation of 95 and 90, Fail excluded)

#### Scenario: SD renders N/A for single-subject group

- **WHEN** a metadata group has 1 SubjectSession with `status: "pass"` and coverage 88%
- **THEN** the "Mean ASL Coverage Percentage & SD" cell SHALL render `"88.0 (N/A)"`

#### Scenario: Motion aggregation uses worst run per subject

- **WHEN** a SubjectSession has 3 ASL runs with motion RMS values `[0.4, 0.7, 0.5]` mm, and the SubjectSession's verdict is Pass
- **THEN** the SubjectSession's contribution to the group's Mean Motion aggregation SHALL be `0.7` (max across runs)

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

The preview SHALL update live when the user navigates back to Step 1, toggles one or more verdicts, and returns to Step 2. No manifestEXPORT SHALL be needed to see updated counts.

#### Scenario: Counts update after toggling Fail to Pass

- **WHEN** the user navigates back to Step 1, flips a SubjectSession from Fail to Pass, returns to Step 2
- **THEN** the Pass / Total cell for that SubjectSession's group SHALL reflect the new count by the time the preview is rendered

### Requirement: Markdown And HTML Export

The preview SHALL expose two export buttons: "Export Markdown" and "Export HTML". Clicking either SHALL open a Tauri save dialog (via `@tauri-apps/plugin-dialog`) and write the formatted manifest file at the chosen path. Both formats SHALL be byte-identical across Windows 11, macOS, and Linux for the same input state.

- Markdown: produced by a TS template literal; written via `@tauri-apps/plugin-fs` `writeTextFile`.
- HTML: produced by templating the same Markdown payload into an inline-CSS single-file wrapper. The wrapper SHALL include all CSS inline; SHALL NOT reference external stylesheets; SHALL NOT invoke the WebView rendering pipeline (no `webview.printToPdf`).

Both buttons SHALL be disabled when no verdicts exist (i.e., when `Object.keys(uiState.manifest.verdicts).length === 0`).

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

- **WHEN** `uiState.manifest.verdicts` is `{}`
- **THEN** both export buttons SHALL render in a disabled state
