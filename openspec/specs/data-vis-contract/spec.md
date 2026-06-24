# data-vis-contract Specification

## ADDED Requirements

### Requirement: Stats File Listing Command

A Rust command `list_stats_files` SHALL accept `project_root: String` and return an array of `{ fileName: string, relativePath: string, size: number, modified: string }` for all `.tsv` files in `<project_root>/derivatives/ExploreASL/Population/Stats/`. Non-TSV files (`.png`, `.jpg`, `.nii.gz`) SHALL be excluded. The command SHALL return an empty array if the Stats directory does not exist (not an error).

#### Scenario: Stats directory with mixed files

- **WHEN** `list_stats_files` is called and the Stats directory contains `.tsv`, `.png`, and `.nii.gz` files
- **THEN** only `.tsv` files SHALL be returned in the result array

#### Scenario: Stats directory does not exist

- **WHEN** `list_stats_files` is called and `Population/Stats/` does not exist
- **THEN** the command SHALL return an empty array (not an error)

### Requirement: TSV Inspection Command

A Rust command `inspect_tsv` SHALL accept `project_root: String` and `relativePath: String` and return a `TsvInspection` object containing: `columns` (array of `{ name, units, inferredType, levels, isIdentifier }`), `rowCount` (excluding the units row), and `fileHash` (SHA-256 hex string). The command SHALL skip the second row (units row). The command SHALL split `participant_id` into Subject and Session identifiers and map the `session` column to Run. Four columns SHALL have `isIdentifier: true`: `participant_id` (raw key for filename construction), `subject` (parsed from participant_id), `session` (parsed from participant_id), and `run` (mapped from TSV `session` column). Type inference SHALL classify columns as `"continuous"`, `"ordinal"`, or `"nominal"` (never `"excluded"` — that is user-only).

#### Scenario: Inspect ROI stats TSV

- **WHEN** `inspect_tsv` is called with a valid TSV containing `participant_id`, `session`, and numeric columns
- **THEN** the returned `columns` array SHALL include `participant_id` (nominal, isIdentifier), `subject` (nominal, isIdentifier), `session` (nominal, isIdentifier), `run` (nominal, isIdentifier), and the numeric columns as `"continuous"`

#### Scenario: Units row skipped

- **WHEN** `inspect_tsv` is called with a TSV whose second row contains units (e.g., "Liter", "mm")
- **THEN** the `rowCount` SHALL exclude the units row, and `units` fields in column metadata SHALL contain the unit strings

#### Scenario: participant_id split into Subject and Session

- **WHEN** a TSV row has `participant_id` = `"sub-C9ORF007Philips_01"`
- **THEN** the inspection SHALL produce a `subject` column with value `"sub-C9ORF007Philips"` and a `session` column with value `"01"`

#### Scenario: File hash returned

- **WHEN** `inspect_tsv` is called on a valid TSV
- **THEN** `fileHash` SHALL be the SHA-256 hex digest of the file contents

#### Scenario: Type inference for continuous columns

- **WHEN** a column's non-missing values all parse as floating-point numbers
- **THEN** the `inferredType` SHALL be `"continuous"` and `levels` SHALL be empty

#### Scenario: Type inference for categorical columns

- **WHEN** a column contains non-numeric string values
- **THEN** the `inferredType` SHALL be `"nominal"` (or `"ordinal"` if alphanumeric ordering is natural) and `levels` SHALL contain the unique values

### Requirement: TSV Column Data Command

A Rust command `read_tsv_columns` SHALL accept `project_root: String`, `relativePath: String`, and `columnNames: Vec<String>` and return an array of row objects. Each row SHALL always include `participant_id`, `subject`, `session`, and `run` fields regardless of `columnNames`. Requested columns SHALL be included as string values. The command SHALL skip the units row. All values SHALL be returned as strings — numeric parsing is the frontend's responsibility.

#### Scenario: Read specific columns

- **WHEN** `read_tsv_columns` is called with `columnNames: ["Total_GM_B", "Site"]`
- **THEN** each row SHALL contain `participant_id`, `subject`, `session`, `run`, `Total_GM_B`, and `Site` fields, all as strings

#### Scenario: Identifier columns always included

- **WHEN** `read_tsv_columns` is called with `columnNames: ["Total_GM_B"]` (no identifier columns requested)
- **THEN** each row SHALL still contain `participant_id`, `subject`, `session`, and `run` fields

#### Scenario: Missing data values

- **WHEN** a TSV cell is empty, `NaN`, `NA`, or `n/a` (case-insensitive)
- **THEN** the corresponding field in the row object SHALL be an empty string

### Requirement: TSV File Selection

The setup stepper's first step SHALL present a dropdown of available TSV files from `list_stats_files`. Each dropdown entry SHALL show the raw filename as the primary line and a parsed metadata preview as a secondary line (metric, tissue, atlas, PVC). Filename parsing is best-effort — if parsing fails, the entry SHALL show the raw filename only. Selecting a file SHALL trigger `inspect_tsv` and advance type inference.

#### Scenario: Dropdown shows parsed preview

- **WHEN** the TSV file list includes `mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv`
- **THEN** the dropdown entry SHALL show the filename as primary text and parsed metadata (metric: mean, tissue: GM, atlas: Total, PVC: 0) as secondary text

#### Scenario: Unparseable filename shows raw name only

- **WHEN** the TSV file list includes `QC_RMS.tsv` which does not match the ROI stats naming convention
- **THEN** the dropdown entry SHALL show `QC_RMS.tsv` as primary text with no parsed secondary text

#### Scenario: File selection triggers inspection

- **WHEN** the user selects a TSV file from the dropdown
- **THEN** `inspect_tsv` SHALL be called and the column typing table SHALL populate with inferred types

#### Scenario: Empty state before file selection

- **WHEN** the "Select File" step renders and no TSV file has been selected yet
- **THEN** the step SHALL show a placeholder message: "Select a TSV file to begin."

### Requirement: Column Type System

Each column SHALL have a type of `"continuous"`, `"ordinal"`, `"nominal"`, or `"excluded"`. Auto-inference (from `inspect_tsv`) SHALL assign only `"continuous"`, `"ordinal"`, or `"nominal"`. The user SHALL be able to override any column's type via a dropdown in the column typing table. The `"excluded"` type SHALL only be assignable by user action — auto-inference SHALL NEVER assign `"excluded"`. Excluded columns SHALL NOT be available for axis assignment or fetched by `read_tsv_columns`.

#### Scenario: Auto-inferred type displayed

- **WHEN** the column typing table renders after file selection
- **THEN** each column SHALL display its auto-inferred type in a dropdown, editable by the user

#### Scenario: User overrides continuous to nominal

- **WHEN** the user changes a column's type from `"continuous"` to `"nominal"`
- **THEN** the column's levels SHALL be discovered and displayed, and the type SHALL be persisted in the contract

#### Scenario: User excludes a column

- **WHEN** the user changes a column's type to `"excluded"`
- **THEN** the column SHALL be greyed out in the typing table and SHALL NOT appear in axis assignment dropdowns

#### Scenario: User re-includes an excluded column

- **WHEN** the user changes an excluded column's type back to `"continuous"`, `"ordinal"`, or `"nominal"`
- **THEN** the column SHALL be available for axis assignment again

### Requirement: Identifier Column Flagging

The `participant_id` column SHALL be split into `subject` (nominal, isIdentifier) and `session` (nominal, isIdentifier, parsed from participant_id — GUI Session). The TSV `session` column SHALL be mapped to `run` (nominal, isIdentifier — GUI Run). The raw `participant_id` column SHALL also have `isIdentifier: true` as it is the direct key for qCBF filename construction. Identifier columns SHALL be available as categorical columns for plotting (e.g. swarmplot X-axis) and SHALL serve as the lookup key for qCBF image loading on point click.

#### Scenario: Subject column available for plotting

- **WHEN** the user assigns the `subject` column to the X-axis
- **THEN** a swarmplot SHALL render with subjects as categorical X-axis levels

#### Scenario: Identifier columns used for image lookup

- **WHEN** the user clicks a chart datapoint
- **THEN** the `subject`, `session`, and `run` values from the clicked point SHALL be used to construct the qCBF filename

### Requirement: Level Ordering

For ordinal columns, levels SHALL default to alphanumeric sort order. For nominal columns, levels SHALL default to "as encountered in file" order. The user SHALL be able to reorder levels for both ordinal and nominal columns via a drag-and-drop or up/down button interface in the level ordering step. Level ordering SHALL control the X-axis tick order in swarmplots only — it SHALL NOT imply statistical relationships or trend lines.

#### Scenario: Ordinal defaults to alphanumeric

- **WHEN** an ordinal column has levels `["TimePoint_3", "TimePoint_1", "TimePoint_2"]`
- **THEN** the default ordering SHALL be `["TimePoint_1", "TimePoint_2", "TimePoint_3"]`

#### Scenario: Nominal defaults to file order

- **WHEN** a nominal column first encounters values in order `["Site_2", "Site_1", "Site_3"]`
- **THEN** the default ordering SHALL be `["Site_2", "Site_1", "Site_3"]`

#### Scenario: User reorders nominal levels

- **WHEN** the user reorders a nominal column's levels from `["Site_2", "Site_1", "Site_3"]` to `["Site_1", "Site_2", "Site_3"]`
- **THEN** the swarmplot X-axis ticks SHALL appear in the user-specified order

#### Scenario: Level ordering has no statistical effect

- **WHEN** the user reorders levels on a categorical X-axis
- **THEN** no trend line, ANOVA, or statistical inference SHALL be rendered — ordering is visual only

### Requirement: Column Typing Table Layout

The column typing step SHALL render a scrolling table with one row per column. Each row SHALL display: column name, type dropdown (continuous/ordinal/nominal/excluded), identifier badge (if applicable), and an "edit levels" button for ordinal/nominal columns. Clicking "edit levels" SHALL expand an inline panel showing the discovered levels with reorder controls. The table SHALL show all columns without pagination.

#### Scenario: Table shows all columns

- **WHEN** the selected TSV has 14 columns
- **THEN** the typing table SHALL render 14 rows, all visible via scrolling

#### Scenario: Inline level editing

- **WHEN** the user clicks "edit levels" on a nominal column
- **THEN** an inline panel SHALL expand below the row showing the column's levels with up/down reorder buttons

#### Scenario: Identifier badge displayed

- **WHEN** a column has `isIdentifier: true`
- **THEN** the row SHALL display an "ID" badge next to the column name

### Requirement: Contract Persistence

The data contract SHALL persist to `uiState.dataVis` in the `.easl` project file. The persisted shape SHALL include: `contractSources` (array of `{ relativePath, fileHash }`), `columnTypes` (record of column name to type), `identifiers` (object with `subject`, `session`, `run` column names), `levelOrderings` (record of column name to ordered levels array), `axisAssignment` (object with `x`, `y`, `colorBy`), `domainFilters` (object with `xMin`, `xMax`, `yMin`, `yMax`), `stage` (one of `"selectFile"`, `"columnTypes"`, `"levelOrdering"`, `"visualize"`), and `filtersExpanded` (boolean).

#### Scenario: Contract saved after file selection

- **WHEN** the user selects a TSV file and type inference completes
- **THEN** `contractSources` SHALL contain `{ relativePath, fileHash }` and `columnTypes` SHALL contain all inferred types

#### Scenario: Contract saved after level reorder

- **WHEN** the user reorders levels on a nominal column
- **THEN** `levelOrderings` SHALL be updated with the new order and persisted

#### Scenario: Axis assignment persisted

- **WHEN** the user assigns columns to X, Y, and colorBy axes
- **THEN** `axisAssignment` SHALL persist `{ x, y, colorBy }` to `uiState.dataVis`

### Requirement: Contract Hash-Based Invalidation

The `contractSources` array SHALL store per-file SHA-256 hashes. On Visualization page mount, `inspect_tsv` SHALL be called for each source path. If the returned hash does not match the persisted hash, the contract SHALL be invalidated: `columnTypes`, `levelOrderings`, `axisAssignment`, and `stage` SHALL be reset, and the stepper SHALL return to step 1 with a banner: "Data file has changed. Please reconfigure." If the source file no longer exists, the error SHALL read: "File '{filename}' no longer exists."

#### Scenario: Hash match preserves contract

- **WHEN** the page mounts and the returned hash matches the persisted hash
- **THEN** the contract SHALL be preserved and the stepper SHALL resume at the persisted stage

#### Scenario: Hash mismatch invalidates contract

- **WHEN** the page mounts and the returned hash does not match the persisted hash
- **THEN** the contract SHALL be invalidated and the stepper SHALL reset to step 1 with the banner "Data file has changed. Please reconfigure."

#### Scenario: Source file deleted

- **WHEN** the page mounts and the source TSV file no longer exists
- **THEN** the contract SHALL be invalidated with the message "File '{filename}' no longer exists."

#### Scenario: Contract invalidation is per-file

- **WHEN** `contractSources` has two entries (future merge scenario) and only the second file's hash mismatches
- **THEN** only the second file's contribution to the contract SHALL be invalidated; the first file's types and levels SHALL be preserved

### Requirement: Missing Data Handling in Type Inference

Type inference SHALL treat empty strings, `NaN`, `NA`, and `n/a` (case-insensitive) as missing values. A column SHALL be classified as `"continuous"` if all non-missing values parse as floating-point numbers. Missing values SHALL NOT force a column to be categorical. The absence of ExploreASL-specific sentinel values (e.g., `-9999`) SHALL be assumed — if sentinels exist, the user can manually retype the column.

#### Scenario: Column with some missing values inferred as continuous

- **WHEN** a column has values `[0.64, 0.63, "", 0.68, NaN]`
- **THEN** the inferred type SHALL be `"continuous"` (non-missing values all parse as float)

#### Scenario: No sentinel value detection

- **WHEN** a column has values `[-9999, 258.76, 234.11]`
- **THEN** the inferred type SHALL be `"continuous"` (all values parse as float, including -9999)
