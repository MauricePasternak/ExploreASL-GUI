# manifest-preview-export — Multi-Reviewer Manifest Delta

## MODIFIED Requirements

**Notation:** Scenario identifiers such as `r1` and `r2` are readable aliases for distinct valid reviewer UUID values. When an alias appears as a reviewer ID or a verdict-map key, it denotes its corresponding UUID value.

### Requirement: Manifest Preview Accordion Layout

The manifest preview SHALL render all sections inside a Mantine `Accordion` with `multiple` and `variant="separated"`. In single-reviewer mode, the accordion SHALL contain four panels: Study Parameters, Software Manifest, QC Summary, and Pipeline Summary (unchanged from pre-multi-reviewer behavior). In multi-reviewer mode, the accordion SHALL contain five panels: Study Parameters, Software Manifest, QC Summary, **Inter-Rater Agreement**, and Pipeline Summary. The Inter-Rater Agreement panel SHALL be positioned between QC Summary and Pipeline Summary. All panels SHALL default to open (`defaultValue` contains all keys) so the full content is visible on first render.

#### Scenario: Single-reviewer mode shows four panels

- **WHEN** the `reviewers` array contains one entry (or is `undefined`) and the Manifest Preview page is loaded
- **THEN** the accordion SHALL contain exactly four panels (Study Parameters, Software Manifest, QC Summary, Pipeline Summary) and the Inter-Rater Agreement panel SHALL NOT be rendered

#### Scenario: Accordion layout defaults to all open

- **WHEN** the Manifest Preview page is loaded
- **THEN** every rendered accordion panel SHALL be visible and expanded by default

#### Scenario: Multi-reviewer mode shows five panels

- **WHEN** the `reviewers` array contains two or more entries and the Manifest Preview page is loaded
- **THEN** the accordion SHALL contain five panels in order: Study Parameters, Software Manifest, QC Summary, Inter-Rater Agreement, Pipeline Summary — all expanded by default

### Requirement: Final Verdict Computation

For each SubjectSession, the **final verdict** used in preview aggregation and export SHALL be computed as follows:

1. If `resolvedVerdicts[subjectSession]` exists → use the resolved verdict.
2. Else if all reviewers' verdicts for the SubjectSession are unanimous (identical `status`) → use the unanimous verdict.
3. Else → the SubjectSession is an unresolved disagreement (this state SHALL NOT occur in Preview & Export because the Verdict Resolution step gates progression).

In single-reviewer mode, the final verdict SHALL be the sole reviewer's verdict (identical to pre-multi-reviewer behavior). The QC Summary aggregation (Pass/Total counts, mean metrics) SHALL use final verdicts exclusively.

#### Scenario: Resolved verdict takes precedence

- **WHEN** reviewer `"r1"` set `"sub-01_01"` to `"pass"` and reviewer `"r2"` set `"sub-01_01"` to `"fail"`, and `resolvedVerdicts["sub-01_01"]` exists with `status: "pass"`
- **THEN** the final verdict for `"sub-01_01"` SHALL be `"pass"` (the resolved verdict)

#### Scenario: Unanimous verdict used when no resolution exists

- **WHEN** both reviewers set `"sub-02_01"` to `"fail"` with `reason: "motion"` and no `resolvedVerdicts["sub-02_01"]` entry exists
- **THEN** the final verdict for `"sub-02_01"` SHALL be `"fail"`

#### Scenario: Single-reviewer mode uses sole verdict

- **WHEN** the project has one reviewer and that reviewer set `"sub-01_01"` to `"pass"`
- **THEN** the final verdict for `"sub-01_01"` SHALL be `"pass"` (identical to pre-multi-reviewer behavior)

### Requirement: Manifest Section 3 Qc Summary

The preview SHALL render a "QC Summary" section. For each `MetadataGroup`, the section SHALL render a subheading and a table with rows:

- Metadata group name (group `label`)
- Pass / Total (count of SubjectSessions with final verdict `status: "pass"` / count with `status: "pass"` or `status: "fail"`, displayed as `"N / Total"`)
- Mean ASL Coverage Percentage & SD
- Mean Spatial Coefficient of Variation in Gray Matter & SD
- Mean Motion in mm RMS & SD
- Mean Motion Exclusion Percentage & SD

Rows with final verdict `status: "fail"` SHALL be excluded from QC metric aggregations but SHALL count toward the "Total" denominator. No Info rows SHALL be excluded from both numerator and denominator.

In multi-reviewer mode, each per-group QC Summary table SHALL include an additional **Initial Agreement Rate** column displaying the percentage of SubjectSessions within that group where all reviewers' verdicts were unanimous before any resolution, formatted as `"N%"`. This column SHALL be omitted in single-reviewer mode.

#### Scenario: Pass / Total uses final verdicts

- **WHEN** a metadata group has 10 SubjectSessions: 7 with final verdict Pass, 2 with final verdict Fail, 1 No Info
- **THEN** Section 3's "Pass / Total" cell for that group SHALL render `"7 / 9"`

#### Scenario: Pass / Total with mixed verdicts

- **WHEN** a metadata group has 10 SubjectSessions: 7 final Pass, 2 final Fail, and 1 No Info
- **THEN** Section 3's "Pass / Total" cell SHALL render `"7 / 9"`

#### Scenario: Fail rows excluded from coverage mean and SD

- **WHEN** a metadata group has 2 final Pass SubjectSessions (coverage 95%, 90%) and 1 final Fail SubjectSession (coverage 50%)
- **THEN** its coverage summary SHALL use only 95% and 90%

#### Scenario: SD renders N/A for single-subject group

- **WHEN** a metadata group has one final Pass SubjectSession with coverage 88%
- **THEN** its coverage summary SHALL render `"88.0 (N/A)"`

#### Scenario: Motion aggregation uses worst run per subject

- **WHEN** a final-Pass SubjectSession has ASL-run motion RMS values `[0.4, 0.7, 0.5]` mm
- **THEN** its contribution to the group motion summary SHALL be `0.7`

#### Scenario: Initial agreement rate column in multi-reviewer mode

- **WHEN** a metadata group has 20 SubjectSessions, two reviewers agreed on 16 and disagreed on 4
- **THEN** the Initial Agreement Rate column for that group SHALL render `"80%"` and the column SHALL be visible

#### Scenario: Initial agreement rate column hidden in single-reviewer mode

- **WHEN** the project has one reviewer
- **THEN** the QC Summary tables SHALL NOT include an Initial Agreement Rate column

### Requirement: Inter-Rater Agreement Section

In multi-reviewer mode, the preview SHALL render an "Inter-Rater Agreement" accordion panel positioned between QC Summary and Pipeline Summary. This section SHALL display a summary table with the following rows:

- **Number of Reviewers** — the count of entries in the `reviewers` array.
- **Overall Initial Agreement Rate** — the percentage of SubjectSessions (excluding No Info) where all reviewers assigned the same verdict before resolution, formatted as `"N% (agreed/total)"`.
- **Kappa Value** — Cohen's Kappa (when exactly 2 reviewers) or Fleiss' Kappa (when >2 reviewers) computed on the pass/fail categorical verdicts, with 95% confidence interval, formatted as `"κ = 0.82 [0.71, 0.90]"`.
- **Subjects Requiring Resolution** — the count of SubjectSessions that had disagreeing reviewer verdicts and required resolution.

This section SHALL be omitted entirely in single-reviewer mode.

Below the overall statistics table, the section SHALL display: `Initial agreement is unadjusted. Kappa adjusts for agreement expected from each reviewer's pass/fail frequencies; interpret kappa and its confidence interval cautiously with small subject counts.`

#### Scenario: Agreement section displayed in multi-reviewer mode

- **WHEN** the project has 2 reviewers, 50 eligible SubjectSessions, 43 with unanimous verdicts, and 7 requiring resolution
- **THEN** the Inter-Rater Agreement section SHALL display: Number of Reviewers = `2`, Overall Initial Agreement Rate = `"86% (43/50)"`, a Kappa value with 95% CI, and Subjects Requiring Resolution = `7`

#### Scenario: Agreement section omitted in single-reviewer mode

- **WHEN** the project has one reviewer (or `reviewers` is `undefined`)
- **THEN** the Inter-Rater Agreement accordion panel SHALL NOT be rendered

#### Scenario: Cohen's Kappa used for exactly two reviewers

- **WHEN** the `reviewers` array contains exactly 2 entries
- **THEN** the Kappa value SHALL be computed using Cohen's Kappa formula for two raters on categorical pass/fail data

#### Scenario: Fleiss' Kappa used for more than two reviewers

- **WHEN** the `reviewers` array contains 3 or more entries
- **THEN** the Kappa value SHALL be computed using Fleiss' Kappa formula for multiple raters on categorical data

### Requirement: Markdown And HTML Export

The preview SHALL expose two export buttons: "Export Markdown" and "Export HTML". Clicking either SHALL open a Tauri save dialog (via `@tauri-apps/plugin-dialog`) and write the formatted manifest file at the chosen path. Both formats SHALL be byte-identical across Windows 11, macOS, and Linux for the same input state.

- Markdown: produced by a TS template literal; written via `@tauri-apps/plugin-fs` `writeTextFile`.
- HTML: produced by templating the same Markdown payload into an inline-CSS single-file wrapper.

Both buttons SHALL be disabled when no verdicts exist (i.e., when no reviewer has any stored verdict entry). In multi-reviewer mode, the exported Markdown and HTML formats SHALL include an "Inter-Rater Agreement" section between the QC Summary and Pipeline Summary sections, containing the same data rendered in the preview (number of reviewers, overall initial agreement rate, Kappa with CI, subjects requiring resolution) and the same small-sample Kappa guidance. In single-reviewer mode, the Inter-Rater Agreement section SHALL be omitted from the exported output.

#### Scenario: Markdown export writes file

- **WHEN** the user clicks "Export Markdown", chooses a path, and confirms the save dialog
- **THEN** a UTF-8 text file SHALL exist at the chosen path whose content matches the manifest preview rendered as Markdown

#### Scenario: HTML export is self-contained

- **WHEN** the user exports HTML
- **THEN** the resulting file SHALL contain all CSS inline, no external stylesheet link, and render directly from disk

#### Scenario: Identical output across platforms

- **WHEN** the same manifest state is exported on Windows 11, macOS, and Linux
- **THEN** the Markdown and HTML byte content SHALL be identical for each respective format

#### Scenario: Multi-reviewer Markdown includes agreement section

- **WHEN** the project has 2 reviewers and the user exports Markdown
- **THEN** the exported Markdown file SHALL contain a section headed "Inter-Rater Agreement" with Kappa value, initial agreement rate, subjects requiring resolution, and the small-sample Kappa guidance

#### Scenario: Single-reviewer export omits agreement section

- **WHEN** the project has one reviewer and the user exports Markdown
- **THEN** the exported Markdown file SHALL NOT contain an "Inter-Rater Agreement" section

#### Scenario: Export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** both export buttons SHALL render in a disabled state

### Requirement: CSV Export

The preview SHALL expose an "Export CSV" button alongside the existing "Export Markdown" and "Export HTML" buttons. Clicking it SHALL open a Tauri save dialog and write a UTF-8 CSV file at the chosen path. `manifest-csv-export` is authoritative for all CSV content, mode-specific column structure, exact QC column names, agreement section inclusion, and escaping.

In multi-reviewer mode, columns SHALL be `SubjectSession`; numbered, registry-ordered `Reviewer_N_Verdict`, `Reviewer_N_Reason`, and `Reviewer_N_Notes` triplets; `Final_Verdict`; `Resolution_Notes`; `Coverage_Pct`; `SpatialCoV`; `Motion_mm`; and `Motion_Exclusion_Pct`. In single-reviewer mode, columns SHALL be only `SubjectSession`, `Verdict`, `Reason`, `Notes`, `Coverage_Pct`, `SpatialCoV`, `Motion_mm`, and `Motion_Exclusion_Pct`; it SHALL contain no `MetadataGroup`, `FinalVerdict`, `Final_Verdict`, `FinalReason`, or `Resolution_Notes` columns. The agreement statistics section SHALL appear only in multi-reviewer CSV output.

The CSV export button SHALL be disabled when no verdicts exist.

#### Scenario: Multi-reviewer CSV uses numbered reviewer columns

- **WHEN** the project has 2 reviewers labeled "Reviewer 1" and "Reviewer 2", and the user clicks "Export CSV" and confirms the save dialog
- **THEN** the CSV file SHALL contain `Reviewer_1_Verdict`, `Reviewer_1_Reason`, `Reviewer_1_Notes`, `Reviewer_2_Verdict`, `Reviewer_2_Reason`, `Reviewer_2_Notes`, `Final_Verdict`, `Resolution_Notes`, `Coverage_Pct`, `SpatialCoV`, `Motion_mm`, and `Motion_Exclusion_Pct`

#### Scenario: CSV export disabled with no verdicts

- **WHEN** no reviewer has any stored verdict entry
- **THEN** the "Export CSV" button SHALL render in a disabled state

#### Scenario: Single-reviewer CSV uses simplified columns

- **WHEN** the user exports CSV for a single-reviewer project
- **THEN** its header SHALL be `SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct` and SHALL contain no agreement statistics section

### Requirement: Live Preview Updates On Verdict Changes

The preview SHALL update live when the user navigates back to QC Selection, toggles one or more verdicts (for any reviewer), and returns to Preview & Export. Final verdicts SHALL be recomputed from the current reviewer verdicts and resolved verdicts on each render. No manual refresh SHALL be needed.

#### Scenario: Counts update after toggling Fail to Pass

- **WHEN** the user navigates back to QC Selection, flips a SubjectSession from Fail to Pass for one reviewer, returns to Preview & Export
- **THEN** the Pass / Total cell for that SubjectSession's group SHALL reflect the updated final verdict count

#### Scenario: Agreement stats update after verdict change

- **WHEN** the user navigates back to QC Selection, changes a reviewer's verdict causing a new disagreement, then returns to Preview & Export
- **THEN** the Inter-Rater Agreement section SHALL reflect the updated initial agreement rate and Kappa value
