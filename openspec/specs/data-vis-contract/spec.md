# data-vis-contract Specification

## Purpose

Define the data contracts and commands for loading, typing, and fetching population analysis statistics and external joined covariates.

## Requirements

### Requirement: Stats File Listing Command

A Rust command `list_stats_files` SHALL accept `projectRoot: String` and return an array of `{ fileName: string, relativePath: string, size: number, modified: string }` for all `.tsv` files in `<project_root>/derivatives/ExploreASL/Population/Stats/`. Non-TSV files (`.png`, `.jpg`, `.nii.gz`) SHALL be excluded. The command SHALL return an empty array if the Stats directory does not exist (not an error).

#### Scenario: Stats directory with mixed files

- **WHEN** `list_stats_files` is called and the Stats directory contains `.tsv`, `.png`, and `.nii.gz` files
- **THEN** only `.tsv` files SHALL be returned in the result array

#### Scenario: Stats directory does not exist

- **WHEN** `list_stats_files` is called and `Population/Stats/` does not exist
- **THEN** the command SHALL return an empty array (not an error)

### Requirement: qCBF Data Loading Command

A Rust command `load_qcbf_data` SHALL accept `projectRoot: String` and `relativePath: String` and return a `DataInspection` object containing: `columns` (array of `{ name, originalName, source, units, inferredType, levels, isIdentifier }`), `rowCount` (excluding the units row), `qcbfRowCount` (matching `rowCount`), `qcbfHash` (SHA-256 hex string), and `externalHash` (always `null` for qCBF-only load). The command SHALL parse the TSV, build column metadata with `source: "qcbf"` and `originalName` equal to `name` (no suffixes in qCBF-only mode), and cache the parsed data in `AppState.active_data`. The command SHALL skip the second row (units row) if detected. The command SHALL split `participant_id` into Subject and Session identifiers and map the `session` column to Run. Four columns SHALL have `isIdentifier: true`: `participant_id`, `subject`, `session`, and `run`. Type inference SHALL classify columns as `"continuous"`, `"ordinal"`, or `"nominal"` (never `"excluded"` — that is user-only). This command replaces the former `inspect_tsv` command.

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
- **THEN** `qcbfHash` SHALL be the SHA-256 hex digest of the file contents and `externalHash` SHALL be `null`

#### Scenario: Type inference for continuous columns

- **WHEN** a column's non-missing values all parse as floating-point numbers
- **THEN** the `inferredType` SHALL be `"continuous"` and `levels` SHALL be empty

#### Scenario: Type inference for categorical columns

- **WHEN** a column contains non-numeric string values
- **THEN** the `inferredType` SHALL be `"nominal"` (or `"ordinal"` if alphanumeric ordering is natural) and `levels` SHALL contain the unique values

### Requirement: Data Column Read Command

A Rust command `read_data_columns` SHALL accept `projectRoot: String` and `columnNames: Vec<String>` and return an array of row objects from the `AppState.active_data` cache. Each row SHALL always include `participant_id`, `subject`, `session`, and `run` fields regardless of `columnNames`. Requested columns SHALL be included as string values. The command SHALL NOT perform file I/O — it reads exclusively from the in-memory cache. All values SHALL be returned as strings — numeric parsing is the frontend's responsibility. This command replaces the former `read_tsv_columns` command and is used for both qCBF-only and joined data.

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

The setup stepper's first step SHALL present a dropdown of available TSV files from `list_stats_files`. Each dropdown entry SHALL show the raw filename as the primary line and a parsed metadata preview as the secondary line (metric, tissue, atlas, PVC). Filename parsing is best-effort — if parsing fails, the entry SHALL show the raw filename only. Selecting a file SHALL trigger `load_qcbf_data` and advance type inference. The step SHALL be labeled "Select Data" (renamed from "Select File").

#### Scenario: Dropdown shows parsed preview

- **WHEN** the TSV file list includes `mean_qCBF_GM_PV0.7_StandardSpace_Total_n=8_18-Jun-2026_PVC0.tsv`
- **THEN** the dropdown entry SHALL show the filename as primary text and parsed metadata (metric: mean, tissue: GM, atlas: Total, PVC: 0) as secondary text

#### Scenario: Unparseable filename shows raw name only

- **WHEN** the TSV file list includes `QC_RMS.tsv` which does not match the ROI stats naming convention
- **THEN** the dropdown entry SHALL show `QC_RMS.tsv` as primary text with no parsed secondary text

#### Scenario: File selection triggers data loading

- **WHEN** the user selects a TSV file from the dropdown
- **THEN** `load_qcbf_data` SHALL be called, the result cached in `active_data`, and the column typing table SHALL populate with inferred types

#### Scenario: Empty state before file selection

- **WHEN** the "Select Data" step renders and no TSV file has been selected yet
- **THEN** the step SHALL show a placeholder message: "Select a TSV file to begin."

### Requirement: Column Type System

Each column SHALL have a type of `"continuous"`, `"ordinal"`, `"nominal"`, or `"excluded"`. Auto-inference (from `load_qcbf_data` or `execute_join`) SHALL assign only `"continuous"`, `"ordinal"`, or `"nominal"`. The user SHALL be able to override any column's type via a dropdown in the column typing table. The `"excluded"` type SHALL only be assignable by user action — auto-inference SHALL NEVER assign `"excluded"`. Excluded columns SHALL NOT be available for axis assignment or fetched by `read_data_columns`.

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

The `participant_id` column SHALL be split into `subject` (nominal, isIdentifier) and `session` (nominal, isIdentifier, parsed from participant_id — GUI Session). The TSV `session` column SHALL be mapped to `run` (nominal, isIdentifier — GUI Run). The raw `participant_id` column SHALL also have `isIdentifier: true` as it is the direct key for qCBF filename construction. Identifier columns SHALL be available as categorical columns for plotting (e.g. swarmplot X-axis) and SHALL serve as the lookup key for qCBF image loading on point click. Identifier columns SHALL have `source: "qcbf"` — column from external datas SHALL always have `isIdentifier: false`.

#### Scenario: Subject column available for plotting

- **WHEN** the user assigns the `subject` column to the X-axis
- **THEN** a swarmplot SHALL render with subjects as categorical X-axis levels

#### Scenario: Identifier columns used for image lookup

- **WHEN** the user clicks a chart datapoint
- **THEN** the `subject`, `session`, and `run` values from the clicked point SHALL be used to construct the qCBF filename

#### Scenario: column from external datas not flagged as identifiers

- **WHEN** the merged schema includes column from external datas (e.g., `Diagnosis`, `Age`)
- **THEN** these columns SHALL have `isIdentifier: false` and `source: "external"`

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

The column typing step SHALL render a scrolling table with one row per column. Each row SHALL display: column name, source badge (qCBF or external, if join active), type dropdown (continuous/ordinal/nominal/excluded), identifier badge (if applicable), and an "edit levels" button for ordinal/nominal columns. Clicking "edit levels" SHALL expand an inline panel showing the discovered levels with reorder controls. The table SHALL show all columns without pagination.

#### Scenario: Table shows all columns

- **WHEN** the selected data has 14 columns
- **THEN** the typing table SHALL render 14 rows, all visible via scrolling

#### Scenario: Inline level editing

- **WHEN** the user clicks "edit levels" on a nominal column
- **THEN** an inline panel SHALL expand below the row showing the column's levels with up/down reorder buttons

#### Scenario: Identifier badge displayed

- **WHEN** a column has `isIdentifier: true`
- **THEN** the row SHALL display an "ID" badge next to the column name

#### Scenario: Source badge displayed when join active

- **WHEN** the merged schema includes columns from both qCBF and external sources
- **THEN** each row SHALL display a source badge ("qCBF" or "external") next to the column name

### Requirement: Contract Persistence

The data contract SHALL persist to `uiState.dataVis` in the `.easl` project file. The persisted shape SHALL include: `qcbfSource` (`{ relativePath, fileHash }` or `null`, singular — replaces former `contractSources` array), `joinConfig` (`{ externalSource, keys, dropRightOn, naTokens, delimiter }` or `null` — where `externalSource` carries `{ absolutePath, fileHash, sheetName }`), `columnTypes` (record of column name to type), `identifiers` (object with `subject`, `session`, `run` column names), `levelOrderings` (record of column name to ordered levels array), `axisAssignment` (object with `x`, `y`, c`olorBy`), `domainFilters` (object with `xMin`, `xMax`, `yMin`, `yMax`), `stage` (one of `"selectData"`, `"columnTypes"`, `"levelOrdering"`, `"visualize"`), and `filtersExpanded` (boolean).

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

The `qcbfSource` object SHALL store a SHA-256 hash. On Visualization page activation, if `joinConfig` is `null`, the system SHALL load the project-relative qCBF source from the current project root. If the returned `qcbfHash` does not match the persisted `qcbfSource.fileHash`, the contract SHALL be invalidated: `columnTypes`, `levelOrderings`, `axisAssignment`, and `stage` SHALL reset, and the stepper SHALL return to step 1 with a banner: "Data file has changed. Please reconfigure." If the project-relative qCBF source no longer exists, the contract SHALL be invalidated with: "File '{filename}' no longer exists."

If `joinConfig` is active, the system SHALL validate both the project-relative qCBF source and external absolute source. A missing or unreadable external source SHALL NOT delete or modify `joinConfig`; the project SHALL retain the saved path and configuration, show a persistent Relink banner, and disable joined-data actions while qCBF-only data remains available. Relinking to an external file with the same SHA-256 hash SHALL update only the absolute path and SHALL preserve join, column, level, axis, filter, and chart setup. Relinking to different content SHALL warn the user and SHALL make no change until confirmation. After confirmation, the new source SHALL be adopted, `joinConfig` keys and dependent column, level, axis, filter, and chart setup SHALL reset, and the project SHALL become dirty. Relink changes SHALL persist only through normal Save.

If both sources are readable and the qCBF hash differs, the full contract SHALL be invalidated. If only the external hash differs during normal validation, the existing configuration SHALL remain unchanged until the user confirms resetting it for the changed source.

#### Scenario: Hash match preserves contract

- **WHEN** the page activates and the returned `qcbfHash` matches the persisted hash
- **THEN** the contract SHALL be preserved and the stepper SHALL resume at the persisted stage

#### Scenario: Hash mismatch invalidates contract

- **WHEN** the page activates and the returned `qcbfHash` does not match the persisted hash
- **THEN** the contract SHALL be invalidated and the stepper SHALL reset to step 1 with the banner "Data file has changed. Please reconfigure."

#### Scenario: Source file deleted

- **WHEN** the page activates and the qCBF source no longer exists under the current project root
- **THEN** the qCBF contract SHALL be invalidated with the message "File '{filename}' no longer exists."

#### Scenario: Join-active validation with qCBF hash mismatch

- **WHEN** joined data is validated and the qCBF hash does not match `qcbfSource.fileHash`
- **THEN** the full contract SHALL be invalidated and the stepper SHALL reset to step 1

#### Scenario: External source is missing

- **WHEN** `joinConfig` is active and its external absolute path is missing or unreadable
- **THEN** `joinConfig` SHALL remain unchanged, qCBF-only data SHALL remain available, joined-data actions SHALL be disabled, and a persistent Relink banner SHALL identify the missing source

#### Scenario: Join-active validation with external hash mismatch only

- **WHEN** joined data is validated, the qCBF hash matches, and only the external hash differs from `joinConfig.externalSource.fileHash`
- **THEN** the complete saved contract SHALL remain unchanged until the user confirms resetting dependent setup for the changed source

#### Scenario: Relinked external file matches

- **WHEN** the user selects a readable replacement whose SHA-256 hash matches the persisted external hash
- **THEN** only the external absolute path SHALL change, all compatible visualization setup SHALL remain, and the project SHALL become dirty

#### Scenario: Relinked external file differs

- **WHEN** the selected replacement's SHA-256 hash differs from the persisted external hash
- **THEN** the system SHALL warn that dependent setup will reset and SHALL make no change until the user confirms

#### Scenario: User confirms changed external file

- **WHEN** the user confirms using a changed replacement
- **THEN** the new external source SHALL be adopted, dependent join and visualization setup SHALL reset, and the project SHALL become dirty

#### Scenario: User declines changed external file

- **WHEN** the user declines the changed replacement
- **THEN** the saved source and complete visualization contract SHALL remain unchanged

#### Scenario: Join-active validation with both hashes matching

- **WHEN** joined data is validated and both source hashes match their persisted values
- **THEN** the contract SHALL be preserved, active joined data SHALL be populated, and the stepper SHALL resume at the persisted stage

#### Scenario: Join-active validation when external file deleted

- **WHEN** the page activates with `joinConfig` active and the external file no longer exists
- **THEN** `joinConfig` SHALL remain unchanged, joined-data actions SHALL be disabled, and a persistent Relink banner SHALL identify the missing source

### Requirement: Missing Data Handling in Type Inference

Type inference SHALL treat empty strings, `NaN`, `NA`, and `n/a` (case-insensitive) as missing values for qCBF data. For external data, the user-configured `naTokens` SHALL be used as missing-value indicators. A column SHALL be classified as `"continuous"` if all non-missing values parse as floating-point numbers. Missing values SHALL NOT force a column to be categorical. The absence of ExploreASL-specific sentinel values (e.g., `-9999`) SHALL be assumed — if sentinels exist, the user can manually retype the column or add them to `naTokens`.

#### Scenario: Column with some missing values inferred as continuous

- **WHEN** a column has values `[0.64, 0.63, "", 0.68, NaN]`
- **THEN** the inferred type SHALL be `"continuous"` (non-missing values all parse as float)

#### Scenario: No sentinel value detection

- **WHEN** a column has values `[-9999, 258.76, 234.11]`
- **THEN** the inferred type SHALL be `"continuous"` (all values parse as float, including -9999)

#### Scenario: External NA tokens used for column from external datas

- **WHEN** `naTokens` includes `"<NA>"` and an column from external data has values `[45, 50, "<NA>", 60]`
- **THEN** the inferred type SHALL be `"continuous"` and `"<NA>"` SHALL be treated as missing
