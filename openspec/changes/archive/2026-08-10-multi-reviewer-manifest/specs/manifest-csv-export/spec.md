# manifest-csv-export Specification

## Purpose

Defines the CSV spreadsheet export capability for the manifest module. The CSV export produces a structured file containing per-reviewer verdicts, final verdicts, QC metrics, and agreement statistics. It uses raw string concatenation (no library dependency) and the existing Tauri save dialog pattern.

## ADDED Requirements

### Requirement: CSV Export Button In Preview

The manifest Preview step SHALL render a "Export CSV" button alongside the existing "Export Markdown" and "Export HTML" buttons. The button SHALL follow the same visual style and placement pattern as the existing export buttons.

#### Scenario: CSV button visible alongside existing buttons

- **WHEN** the Preview & Export step is rendered
- **THEN** three export buttons SHALL be visible: "Export Markdown", "Export HTML", and "Export CSV", in that order

#### Scenario: CSV button disabled when no verdicts exist

- **WHEN** `uiState.manifest.verdicts` is `undefined` or an empty object
- **THEN** the "Export CSV" button SHALL be rendered in a disabled state, consistent with the existing Markdown and HTML button behavior

#### Scenario: CSV button enabled when verdicts exist

- **WHEN** at least one verdict exists in `uiState.manifest.verdicts`
- **THEN** the "Export CSV" button SHALL be enabled and clickable

### Requirement: CSV Export Save Dialog

Clicking the "Export CSV" button SHALL open a Tauri save dialog (via `@tauri-apps/plugin-dialog`) with a default filename of `manifest_export.csv` and a file filter for CSV files (`*.csv`). Upon user confirmation, the CSV content SHALL be written to the chosen path via `@tauri-apps/plugin-fs` `writeTextFile`. If the user cancels the dialog, no file SHALL be written.

#### Scenario: Save dialog opens with correct defaults

- **WHEN** the user clicks "Export CSV"
- **THEN** a Tauri save dialog SHALL open with default filename `"manifest_export.csv"` and file filter `{ name: "CSV", extensions: ["csv"] }`

#### Scenario: File written on confirmation

- **WHEN** the user selects a path and confirms the save dialog
- **THEN** a UTF-8 text file SHALL exist at the chosen path containing the CSV content

#### Scenario: No file written on cancel

- **WHEN** the user clicks "Export CSV" and then cancels the save dialog
- **THEN** no file SHALL be written to disk

### Requirement: Multi-Reviewer CSV Column Structure

In multi-reviewer mode, the CSV SHALL contain a header row followed by one data row per subjectSession. The columns SHALL be, in order:

1. `SubjectSession` — the subjectSession key string (e.g., `"sub-01_01"`).
2. For each reviewer (ordered by `reviewers` array index):
   - `Reviewer_N_Verdict` — the reviewer's `status` (`"pass"` or `"fail"`), or `""` if no verdict.
   - `Reviewer_N_Reason` — the reviewer's `reason` string, or `""` if none.
   - `Reviewer_N_Notes` — the reviewer's `notes` string, or `""` if none.
3. `Final_Verdict` — the final verdict `status`. For subjectSessions with unanimous agreement, this SHALL be the unanimous status. For subjectSessions with disagreements, this SHALL be the resolved verdict's `status` from `resolvedVerdicts`. If unresolved, SHALL be `""`.
4. `Resolution_Notes` — the `notes` from the resolved verdict, or `""` if no resolution or no notes.
5. `Coverage_Pct` — the subjectSession's coverage percentage from `Coverage.tsv`, or `""` if unavailable.
6. `SpatialCoV` — the subjectSession's Spatial Coefficient of Variation from `SpatialCoV.tsv`, or `""` if unavailable.
7. `Motion_mm` — the maximum motion RMS across the subjectSession's ASL runs, or `""` if unavailable.
8. `Motion_Exclusion_Pct` — the motion exclusion percentage, or `""` if unavailable.

#### Scenario: Multi-reviewer CSV with 2 reviewers

- **WHEN** 2 reviewers exist and 3 subjectSessions have verdicts
- **THEN** the CSV SHALL have columns: `SubjectSession, Reviewer_1_Verdict, Reviewer_1_Reason, Reviewer_1_Notes, Reviewer_2_Verdict, Reviewer_2_Reason, Reviewer_2_Notes, Final_Verdict, Resolution_Notes, Coverage_Pct, SpatialCoV, Motion_mm, Motion_Exclusion_Pct` and 3 data rows

#### Scenario: Final verdict from unanimous agreement

- **WHEN** all reviewers agree on `"pass"` for `"sub-01_01"` and no resolved verdict exists
- **THEN** the `Final_Verdict` column for `"sub-01_01"` SHALL contain `"pass"`

#### Scenario: Final verdict from resolved disagreement

- **WHEN** reviewers disagree on `"sub-02_01"` and `resolvedVerdicts["sub-02_01"]` has `status: "fail"`
- **THEN** the `Final_Verdict` column for `"sub-02_01"` SHALL contain `"fail"` and `Resolution_Notes` SHALL contain the resolved verdict's `notes` (or `""` if none)

#### Scenario: Missing QC metrics rendered as empty

- **WHEN** a subjectSession has no QC output files on disk
- **THEN** the `Coverage_Pct`, `SpatialCoV`, `Motion_mm`, and `Motion_Exclusion_Pct` columns SHALL contain `""`

### Requirement: Single-Reviewer CSV Column Structure

In single-reviewer mode, the CSV SHALL contain simplified columns without per-reviewer breakdown. The columns SHALL be, in order:

1. `SubjectSession`
2. `Verdict` — the verdict `status` (`"pass"` or `"fail"`), or `""`.
3. `Reason` — the verdict `reason`, or `""`.
4. `Notes` — the verdict `notes`, or `""`.
5. `Coverage_Pct`
6. `SpatialCoV`
7. `Motion_mm`
8. `Motion_Exclusion_Pct`

No `Final_Verdict`, `Resolution_Notes`, or per-reviewer columns SHALL be present.

#### Scenario: Single-reviewer CSV has simplified columns

- **WHEN** the manifest is in single-reviewer mode and the CSV is exported
- **THEN** the CSV header SHALL be `SubjectSession,Verdict,Reason,Notes,Coverage_Pct,SpatialCoV,Motion_mm,Motion_Exclusion_Pct`

#### Scenario: Single-reviewer CSV data rows correct

- **WHEN** a single-reviewer project has `"sub-01_01"` with `{ status: "pass", reason: undefined, notes: "looks good" }`
- **THEN** the CSV data row SHALL be `sub-01_01,pass,,looks good,<coverage>,<spatialcov>,<motion>,<motionExcl>`

### Requirement: Agreement Statistics In CSV

In multi-reviewer mode, the CSV file SHALL include an agreement statistics section appended after a blank separator row following the verdict data rows. The section SHALL contain:

1. A row: `Agreement Statistics` (spanning the first column, other columns empty).
2. A row: `Metric,Value` header.
3. Data rows for: `Number_of_Reviewers`, `Overall_Initial_Agreement_Rate`, `Kappa`, `Kappa_CI_Lower`, `Kappa_CI_Upper`, `N_Subjects`, `N_Disagreements`.
4. A blank row followed by `Per_Group_Agreement` header.
5. Per-group rows: `Group,N,Initial_Agreement_Rate,Kappa,Kappa_CI_Lower,Kappa_CI_Upper`.

In single-reviewer mode, the agreement statistics section SHALL NOT be included.

#### Scenario: Agreement statistics appended in multi-reviewer CSV

- **WHEN** the CSV is exported in multi-reviewer mode with 2 reviewers, 50 subjects, and Kappa of 0.82
- **THEN** the CSV SHALL contain, after the last verdict data row, a blank row followed by the agreement statistics section with `Kappa,0.82` and per-group breakdown rows

#### Scenario: Agreement statistics omitted in single-reviewer mode

- **WHEN** the CSV is exported in single-reviewer mode
- **THEN** the CSV SHALL NOT contain an "Agreement Statistics" section or any Kappa-related rows

### Requirement: CSV Value Escaping

All string values written to the CSV SHALL be properly escaped for RFC 4180 compliance:

1. Values containing commas, double quotes, or newlines SHALL be enclosed in double quotes.
2. Double quote characters within values SHALL be escaped by doubling them (`"" `).
3. Values not containing special characters SHALL be written without enclosing quotes.

#### Scenario: Notes containing commas are quoted

- **WHEN** a verdict has `notes: "motion detected, partial coverage"`
- **THEN** the notes value in the CSV SHALL be rendered as `"motion detected, partial coverage"` (enclosed in double quotes)

#### Scenario: Notes containing double quotes are escaped

- **WHEN** a verdict has `notes: 'reviewer said "borderline"'`
- **THEN** the notes value SHALL be rendered as `"reviewer said ""borderline"""` (double quotes escaped and value enclosed)

#### Scenario: Plain values not quoted

- **WHEN** a verdict has `notes: "looks good"`
- **THEN** the notes value SHALL be rendered as `looks good` (no enclosing quotes)

### Requirement: Raw String Concatenation Implementation

The CSV export SHALL be implemented using raw TypeScript string concatenation without any CSV library dependency. The implementation SHALL reside in `src/lib/manifestCsvExport.ts`. Line endings SHALL use `\n` (Unix-style) for cross-platform consistency.

#### Scenario: No CSV library dependency

- **WHEN** `src/lib/manifestCsvExport.ts` is inspected
- **THEN** the file SHALL contain no `import` statements referencing CSV libraries (no `csv-stringify`, `papaparse`, `fast-csv`, etc.)

#### Scenario: Consistent line endings across platforms

- **WHEN** the CSV is exported on Windows, macOS, or Linux
- **THEN** the file SHALL use `\n` line endings throughout (no `\r\n`)
