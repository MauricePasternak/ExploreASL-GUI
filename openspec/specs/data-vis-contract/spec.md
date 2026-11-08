# data-vis-contract Specification

## Purpose

Define the data contracts and commands for loading, typing, and fetching population analysis statistics and external joined covariates.

## Requirements

### Requirement: Stats File Listing Command

`list_stats_files` SHALL return sorted metadata for supported Stats TSV prefixes, excluding unrelated files and treating a missing Stats directory as empty.

#### Scenario: Population Stats files are enumerated

- **WHEN** `list_stats_files` inspects the project's Stats directory
- **THEN** matching, ordering, response fields, and missing-directory handling SHALL follow these rules:

A Rust command `list_stats_files` SHALL accept `projectRoot: String` and return an array of `{ fileName: string, relativePath: string, size: number, modified: string }` for `.tsv` files whose names start with `mean_`, `median_`, or `CoV_` in `<project_root>/derivatives/ExploreASL/Population/Stats/`. Matching SHALL be case-sensitive, results SHALL be sorted by filename, and `relativePath` SHALL be the filename relative to the Stats directory. Non-TSV files and other TSV prefixes SHALL be excluded. The command SHALL return an empty array if the Stats directory does not exist (not an error).

#### Scenario: Stats directory with mixed files

- **WHEN** `list_stats_files` is called and the Stats directory contains `mean_results.tsv`, `median_results.tsv`, `CoV_results.tsv`, `QC_RMS.tsv`, `.png`, and `.nii.gz` files
- **THEN** only the three TSV files with supported prefixes SHALL be returned

#### Scenario: Stats directory does not exist

- **WHEN** `list_stats_files` is called and `Population/Stats/` does not exist
- **THEN** the command SHALL return an empty array (not an error)

### Requirement: qCBF Data Loading Command

`load_qcbf_data` SHALL parse and cache qCBF TSV data, returning typed inspection metadata, content hashes, and correctly translated participant/session/run identifiers.

#### Scenario: A qCBF Stats file is loaded

- **WHEN** `load_qcbf_data` receives a project root and relative file path
- **THEN** parsing, units, hashes, identifiers, and cache population SHALL satisfy this contract:

A Rust command `load_qcbf_data` SHALL accept `projectRoot: String` and `relativePath: String` and return a `DataInspection` object containing: `columns` (array of `{ name, originalName, source, units, inferredType, levels, isIdentifier }`), `rowCount` (excluding the units row), `qcbfRowCount` (matching `rowCount`), `qcbfHash` (SHA-256 hex string after stripping a leading UTF-8 BOM), and `externalHash` (always `null` for qCBF-only load). The command SHALL parse the TSV, build column metadata with `source: "qcbf"` and `originalName` equal to `name` (no suffixes in qCBF-only mode), and cache the parsed data in `AppState.active_data`. The command SHALL skip the second row (units row) if detected. When present, `participant_id` SHALL produce Subject and Session identifiers, and the TSV `session` column SHALL map to Run. Present identifier columns SHALL have `isIdentifier: true`. Type inference SHALL classify columns as `"continuous"`, `"ordinal"`, or `"nominal"` (never `"excluded"` — that is user-only).

#### Scenario: Load qCBF TSV with identifier parsing

- **WHEN** `load_qcbf_data` is called with a valid TSV containing `participant_id`, `session`, and numeric columns
- **THEN** the returned `columns` SHALL include `participant_id` (nominal, isIdentifier, source: "qcbf"), `subject` (nominal, isIdentifier), `session` (nominal, isIdentifier), `run` (nominal, isIdentifier), and numeric columns as `"continuous"`, and data SHALL be cached in `active_data`

#### Scenario: Units row skipped

- **WHEN** `load_qcbf_data` is called with a TSV whose second row contains units (e.g., "Liter", "mm")
- **THEN** the `rowCount` SHALL exclude the units row, and `units` fields in column metadata SHALL contain the unit strings

#### Scenario: participant_id split into Subject and Session

- **WHEN** a TSV row has `participant_id` = `"sub-001Philips_01"`
- **THEN** the inspection SHALL produce a `subject` column with value `"sub-001Philips"` and a `session` column with value `"01"`

#### Scenario: qCBF hash returned

- **WHEN** `load_qcbf_data` is called on a valid TSV
- **THEN** `qcbfHash` SHALL be the SHA-256 hex digest of the UTF-8 contents after stripping any leading BOM and `externalHash` SHALL be `null`

#### Scenario: Type inference for continuous columns

- **WHEN** a column not covered by a qCBF-specific type rule has at least one non-missing value and all its non-missing values parse as floating-point numbers
- **THEN** the `inferredType` SHALL be `"continuous"` and `levels` SHALL be empty

#### Scenario: Type inference for categorical columns

- **WHEN** a column not covered by a qCBF-specific type rule contains non-numeric string values
- **THEN** the `inferredType` SHALL be `"nominal"` and `levels` SHALL contain unique non-missing values in file encounter order; qCBF `LongitudinalTimePoint` SHALL instead be inferred as `"ordinal"`

### Requirement: Data Column Read Command

`read_data_columns` SHALL return requested string-valued columns and available identifiers exclusively from the active in-memory cache, omitting absent fields.

#### Scenario: Visualization requests cached columns

- **WHEN** `read_data_columns` receives requested column names
- **THEN** returned rows and the no-file-I/O boundary SHALL satisfy these rules:

A Rust command `read_data_columns` SHALL accept `projectRoot: String` and `columnNames: Vec<String>` and return an array of row objects from the `AppState.active_data` cache. Each row SHALL include any present `participant_id`, `subject`, `session`, and `run` fields regardless of `columnNames`, and any present requested columns as string values. Absent fields SHALL be omitted. The command SHALL NOT perform file I/O — it reads exclusively from the in-memory cache. Numeric parsing is the frontend's responsibility.

#### Scenario: Read specific columns from cache

- **WHEN** `read_data_columns` is called with `columnNames: ["Total_GM_B", "Site"]` and `active_data` is populated
- **THEN** each row SHALL contain `participant_id`, `subject`, `session`, `run`, `Total_GM_B`, and `Site` fields, all as strings, read from the cache

#### Scenario: Identifier columns always included

- **WHEN** `read_data_columns` is called with `columnNames: ["Total_GM_B"]` (no identifier columns requested)
- **THEN** each row SHALL still contain `participant_id`, `subject`, `session`, and `run` fields

#### Scenario: Missing data values

- **WHEN** a cell in the cached data is an empty string (normalized from NA tokens or originally missing)
- **THEN** the corresponding field in the row object SHALL be an empty string

#### Scenario: Cache not populated

- **WHEN** `read_data_columns` is called and `AppState.active_data` is `None`
- **THEN** the command SHALL return an error: "No data loaded. Select a file first."

### Requirement: TSV File Selection

The setup stepper's first step SHALL present a dropdown of available TSV files from `list_stats_files`. Each dropdown entry SHALL show the raw filename, followed by a parenthesized metric, tissue, and atlas preview when filename parsing succeeds; unavailable preview fields SHALL display `?`. If parsing fails, the entry SHALL show the raw filename only. Selecting a file SHALL trigger `load_qcbf_data` and populate inferred types without advancing the step. The step SHALL be labeled "Select Data".

#### Scenario: Dropdown shows parsed preview

- **WHEN** the TSV file list includes `mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv`
- **THEN** the dropdown entry SHALL show the filename followed by `(mean · GM · Total)`

#### Scenario: Unparseable filename shows raw name only

- **WHEN** the TSV file list includes `mean_results.tsv`, whose supported prefix permits discovery but whose name has no parseable qCBF metadata
- **THEN** the dropdown entry SHALL show `mean_results.tsv` with no metadata preview

#### Scenario: File selection triggers data loading

- **WHEN** the user selects a TSV file from the dropdown
- **THEN** `load_qcbf_data` SHALL be called, the result cached in `active_data`, and the column typing table SHALL populate with inferred types

#### Scenario: Empty state before file selection

- **WHEN** the "Select Data" step renders and no TSV file has been selected yet
- **THEN** the step SHALL show a placeholder message: "Select a TSV file to begin."

### Requirement: Column Type System

Column typing SHALL support continuous, ordinal, nominal, and user-only excluded types, with specified identifier and fixed-column restrictions controlling axis availability.

#### Scenario: Inferred column types are presented for editing

- **WHEN** loaded or joined columns enter the typing table
- **THEN** inference, dropdown restrictions, and axis eligibility SHALL follow these rules:

Each column SHALL have a type of `"continuous"`, `"ordinal"`, `"nominal"`, or `"excluded"`. Auto-inference (from `load_qcbf_data` or `execute_join`) SHALL assign only `"continuous"`, `"ordinal"`, or `"nominal"`. The typing table SHALL omit raw `participant_id`. Dropdowns for columns named `subject`, `session`, or `run` SHALL offer only `"nominal"` and `"ordinal"`. Dropdowns SHALL be disabled for names `GM_vol`, `WM_vol`, `CSF_vol`, `GM_ICVRatio`, `GMWM_ICVRatio`, `MeanMotion`, `SubjectNList`, or names ending in `_L`, `_R`, or `_B`; this restriction SHALL apply by displayed column name, regardless of source. Other displayed columns SHALL offer all four types. The `"excluded"` type SHALL only be assignable by user action — auto-inference SHALL NEVER assign `"excluded"`. Excluded columns SHALL NOT be available for axis assignment; chart column requests SHALL follow those assignments rather than imposing a backend exclusion filter.

#### Scenario: Auto-inferred type displayed

- **WHEN** the column typing table renders after file selection
- **THEN** each displayed column SHALL show its inferred or saved type, subject to the name-based restrictions above

#### Scenario: User overrides continuous to nominal

- **WHEN** the user changes an editable column's type from `"continuous"` to `"nominal"`
- **THEN** the type SHALL be persisted without re-inspection or level discovery; the existing inspection levels SHALL remain unchanged, including an empty levels array

#### Scenario: Restricted type controls

- **WHEN** the typing table contains `participant_id`, `subject`, `GM_vol`, and `Diagnosis`
- **THEN** `participant_id` SHALL have no row, `subject` SHALL offer nominal/ordinal only, `GM_vol` SHALL have a disabled dropdown, and `Diagnosis` SHALL offer all four types

#### Scenario: User excludes a column

- **WHEN** the user changes a column's type to `"excluded"`
- **THEN** the column SHALL be greyed out in the typing table and SHALL NOT appear in axis assignment dropdowns

#### Scenario: User re-includes an excluded column

- **WHEN** the user changes an excluded column's type back to `"continuous"`, `"ordinal"`, or `"nominal"`
- **THEN** the column SHALL be available for axis assignment again

### Requirement: Identifier Column Flagging

qCBF identifiers SHALL preserve raw participant identity and translate ExploreASL Visit/Session into GUI Session/Run, remaining usable for plotting and image lookup; external columns SHALL not become identifiers.

#### Scenario: qCBF and external columns receive identifier metadata

- **WHEN** column metadata is built for visualization
- **THEN** identifier derivation, flags, sources, and image lookup SHALL follow these rules:

The `participant_id` column SHALL be split into `subject` (nominal, isIdentifier) and `session` (nominal, isIdentifier, parsed from participant_id — GUI Session). The TSV `session` column SHALL be mapped to `run` (nominal, isIdentifier — GUI Run). The raw `participant_id` column SHALL also have `isIdentifier: true` as it is the direct key for qCBF filename construction. Identifier columns SHALL be available as categorical columns for plotting (e.g. swarmplot X-axis) and SHALL serve as the lookup key for qCBF image loading on point click. Identifier columns SHALL have `source: "qcbf"` — column from external datas SHALL always have `isIdentifier: false`.

#### Scenario: Subject column available for plotting

- **WHEN** the user assigns the `subject` column to the X-axis
- **THEN** a swarmplot SHALL render with subjects as categorical X-axis levels

#### Scenario: Identifier columns used for image lookup

- **WHEN** the user clicks a chart datapoint
- **THEN** the raw `participantId` and `run` values from the clicked point SHALL be used to construct the qCBF filename; `run` SHALL represent the TSV `session` column (GUI Run)

#### Scenario: column from external datas not flagged as identifiers

- **WHEN** the merged schema includes column from external datas (e.g., `Diagnosis`, `Age`)
- **THEN** these columns SHALL have `isIdentifier: false` and `source: "external"`

### Requirement: Level Ordering

Level ordering SHALL edit persisted nominal and ordinal non-identifier levels without changing chart encounter ordering or implying statistical relationships.

#### Scenario: Categorical levels are displayed or reordered

- **WHEN** the user enters Level Ordering or changes a column type
- **THEN** available levels, persistence, and chart independence SHALL follow these rules:

The Level Ordering step SHALL list non-identifier columns whose saved type is ordinal or nominal. Without a saved ordering, it SHALL display inspection levels in file encounter order for both types. Up/down controls SHALL persist edits in `levelOrderings`. Type changes SHALL NOT discover new levels. Saved ordering SHALL affect the ordering editor only: current swarmplot groups SHALL use encounter order in the filtered chart rows and SHALL NOT read `levelOrderings`. Reordering SHALL NOT imply statistical relationships or trend lines.

#### Scenario: Ordinal defaults to file order

- **WHEN** an ordinal column has levels `["TimePoint_3", "TimePoint_1", "TimePoint_2"]`
- **THEN** without a saved ordering, the editor SHALL display `["TimePoint_3", "TimePoint_1", "TimePoint_2"]`

#### Scenario: Nominal defaults to file order

- **WHEN** a nominal column first encounters values in order `["Site_2", "Site_1", "Site_3"]`
- **THEN** the default ordering SHALL be `["Site_2", "Site_1", "Site_3"]`

#### Scenario: User reorders nominal levels

- **WHEN** the user reorders a nominal column's levels from `["Site_2", "Site_1", "Site_3"]` to `["Site_1", "Site_2", "Site_3"]`
- **THEN** the editor SHALL display and persist the new order, while swarmplot groups SHALL continue to follow encounter order in filtered chart rows

#### Scenario: Identifiers do not create a Level Ordering step

- **WHEN** only identifier columns have ordinal or nominal types
- **THEN** the setup stepper SHALL skip Level Ordering, while identifiers SHALL remain available for categorical plotting

#### Scenario: Level ordering has no statistical effect

- **WHEN** the user reorders levels on a categorical X-axis
- **THEN** no trend line, ANOVA, or statistical inference SHALL be rendered as a consequence of the saved ordering

### Requirement: Column Typing Table Layout

The column typing table SHALL show all inspected columns except raw participant ID, with identifiers first and separate controls for type, metadata, and level ordering.

#### Scenario: Inspection columns are rendered in the typing step

- **WHEN** the Column Types table is displayed
- **THEN** row order, badges, information, and level-editing placement SHALL follow these rules:

The column typing step SHALL render a table without pagination, with one row per inspection column except raw `participant_id`. Columns named `subject`, `session`, and `run` SHALL appear first in that order. Each row SHALL show its name, restricted type dropdown, identifier badge when applicable, and source badge when a join is configured. The Info cell SHALL show units when present and the existing level count for non-continuous columns with levels. Level editing SHALL be provided separately in the conditional Level Ordering step, not inline in the table.

#### Scenario: Table omits raw participant identifier

- **WHEN** the selected data has 14 columns including raw `participant_id`
- **THEN** the typing table SHALL render 13 rows, all accessible through page scrolling

#### Scenario: Separate level editing

- **WHEN** a displayed non-identifier nominal column has existing inspection levels
- **THEN** the typing table SHALL show its level count and the Level Ordering step SHALL provide up/down controls for those levels

#### Scenario: Identifier badge displayed

- **WHEN** a displayed column has `isIdentifier: true`
- **THEN** the row SHALL display an "ID" badge next to the column name

#### Scenario: Source badge displayed when join active

- **WHEN** the merged schema includes columns from both qCBF and external sources
- **THEN** each row SHALL display a source badge ("qCBF" or "external") next to the column name

### Requirement: Contract Persistence

Visualization setup SHALL persist its singular qCBF source, optional join configuration, typing, identifiers, level ordering, axes, filters, stage, and drawer state under `uiState.dataVis`.

#### Scenario: Visualization setup is saved to the project

- **WHEN** the data contract is persisted
- **THEN** its fields and nullable source shapes SHALL satisfy this schema:

The data contract SHALL persist to `uiState.dataVis` in the `.easl` project file. The persisted shape SHALL include: `qcbfSource` (`{ relativePath, fileHash }` or `null`, singular — replaces former `contractSources` array), `joinConfig` (`{ externalSource, keys, dropRightOn, naTokens, delimiter }` or `null` — where `externalSource` carries `{ absolutePath, fileHash, sheetName }`), `columnTypes` (record of column name to type), `identifiers` (object with `subject`, `session`, `run` column names), `levelOrderings` (record of column name to ordered levels array), `axisAssignment` (object with `x`, `y`, `colorBy`), `domainFilters` (object with `xMin`, `xMax`, `yMin`, `yMax`), `stage` (one of `"selectData"`, `"columnTypes"`, `"levelOrdering"`, `"visualize"`), and `filtersExpanded` (boolean controlling the Visualization Settings drawer).

#### Scenario: Contract saved after file selection

- **WHEN** the user selects a TSV file and type inference completes
- **THEN** `qcbfSource` SHALL contain `{ relativePath, fileHash }` and `columnTypes` SHALL contain all inferred types

#### Scenario: Contract saved after level reorder

- **WHEN** the user reorders levels on a nominal column
- **THEN** `levelOrderings` SHALL be updated with the new order and persisted

#### Scenario: Axis assignment persisted

- **WHEN** the user assigns columns to X, Y, and colorBy axes
- **THEN** `axisAssignment` SHALL persist `{ x, y, colorBy }` to `uiState.dataVis`

#### Scenario: Join config persisted

- **WHEN** the user configures a join and proceeds to Column Types
- **THEN** `joinConfig` SHALL persist with `externalSource` (containing `absolutePath`, `fileHash`, `sheetName`), `keys` (array of `{ left, right }` objects), `dropRightOn`, `naTokens`, and `delimiter`

### Requirement: Contract Hash-Based Invalidation

Source validation SHALL preserve setup for matching content, invalidate changed qCBF contracts, and require confirmed adoption of changed external content while retaining saved configuration for unavailable external sources.

#### Scenario: Saved visualization sources are validated or replaced

- **WHEN** the page activates or the user relinks an external source
- **THEN** hashes, warnings, reset scope, cancellation, and autosave SHALL follow these rules:

The qCBF source SHALL retain its SHA-256 hash and project-relative path. On page activation without a join, matching content SHALL preserve setup; changed content SHALL reset column types, level orderings, axes, and stage with "Data file has changed. Please reconfigure." Missing qCBF content SHALL invalidate its contract with "File '{filename}' no longer exists."

Mount-time joined-data validation SHALL inspect both sources. Missing/unreadable external data SHALL preserve the complete saved join, allow available qCBF-only work, and disable Select Data Next with persistent Relink guidance. A same-hash external replacement SHALL change only its absolute path. Different replacement content SHALL require confirmation before adopting the source and resetting dependent join/column/level/axis/filter/chart setup. Accepted replacement edits SHALL use project-wide autosave without a manual-save-only mode; cancellation SHALL preserve configuration. At mount, if both sources are readable but qCBF changed, the full contract SHALL invalidate. External-only content changes SHALL preserve configuration until reset is confirmed.

#### Scenario: Hash match preserves contract

- **WHEN** qCBF content matches its stored hash
- **THEN** the contract and saved stage SHALL remain

#### Scenario: Hash mismatch invalidates contract

- **WHEN** qCBF content differs
- **THEN** setup SHALL reset to the first step with the changed-data banner

#### Scenario: Source file deleted

- **WHEN** project-relative qCBF no longer exists
- **THEN** its contract SHALL invalidate with the missing-file message

#### Scenario: Join-active validation with qCBF hash mismatch

- **WHEN** readable joined sources include changed qCBF content
- **THEN** the full contract SHALL reset

#### Scenario: External source is missing

- **WHEN** joined external data is missing or unreadable
- **THEN** saved join state SHALL remain, Select Data Next SHALL be disabled, and Relink guidance SHALL appear

#### Scenario: Join-active validation with external hash mismatch only

- **WHEN** qCBF matches but external content differs
- **THEN** configuration SHALL remain unchanged until reset confirmation

#### Scenario: Relinked external file matches

- **WHEN** replacement external content has the same hash
- **THEN** only its source path SHALL change and shared autosave SHALL persist that accepted edit

#### Scenario: Relinked external file differs

- **WHEN** replacement content has a different hash
- **THEN** no configuration SHALL change before confirmation

#### Scenario: User confirms changed external file

- **WHEN** replacement/reset is confirmed
- **THEN** the new source and dependent resets SHALL enter one accepted autosaved change

#### Scenario: User declines changed external file

- **WHEN** replacement/reset is declined
- **THEN** the complete saved contract SHALL remain unchanged

#### Scenario: Join-active validation with both hashes matching

- **WHEN** both hashes match
- **THEN** joined data SHALL load and saved setup/stage SHALL remain

#### Scenario: Join-active validation when external file deleted

- **WHEN** joined external content disappears
- **THEN** the saved join SHALL remain available for relinking while Select Data Next is disabled

### Requirement: Missing Data Handling in Type Inference

Metadata inference and chart checks SHALL use fixed missing-value rules independently of configurable external join normalization, retaining qCBF-specific type behavior.

#### Scenario: Missing values enter inspection, joining, or plotting

- **WHEN** column types or chart values are evaluated
- **THEN** fixed tokens, all-missing columns, and configured join tokens SHALL follow these rules:

Generic metadata inference for qCBF and external data SHALL treat empty strings, `NaN`, `NA`, and `n/a` (case-insensitive) as missing. With at least one non-missing value, it SHALL classify a column as `"continuous"` if all such values parse as floating-point numbers, otherwise as `"nominal"`; all-missing columns SHALL be nominal. qCBF-specific type rules SHALL still apply. Configured `naTokens` SHALL normalize external row values to empty strings during join parsing, but SHALL NOT alter external preview or joined metadata inference, which uses the raw external inspection. Frontend chart missing-value checks SHALL use the fixed empty/`NaN`/`NA`/`n/a` rules on returned rows, so normalized empty cells SHALL be excluded from axes or grouped as Unknown for color-by. No additional sentinel detection SHALL be performed.

#### Scenario: Column with some missing values inferred as continuous

- **WHEN** a column has values `[0.64, 0.63, "", 0.68, NaN]`
- **THEN** the inferred type SHALL be `"continuous"` (non-missing values all parse as float)

#### Scenario: No sentinel value detection

- **WHEN** a column has values `[-9999, 258.76, 234.11]`
- **THEN** the inferred type SHALL be `"continuous"` (all values parse as float, including -9999)

#### Scenario: Custom external NA token normalizes rows but not metadata

- **WHEN** `naTokens` includes `"<NA>"` and an external column has values `[45, 50, "<NA>", 60]`
- **THEN** preview and joined metadata SHALL infer `"nominal"`, while the joined row containing `"<NA>"` SHALL store an empty string
