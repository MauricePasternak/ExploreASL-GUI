# external-data-join Specification

## Purpose

Support joining external data file (CSV, TSV, or XLSX) to Population Stats qCBF data.

## Requirements

### Requirement: External Data File Selection

The "Select Data" step SHALL provide a "Browse..." button that opens a native file dialog (Tauri `@tauri-apps/plugin-dialog`) for external covariate file selection. Supported formats SHALL be `.csv`, `.tsv`, and `.xlsx`. When launching the file dialog: if an external file is already selected, the dialog's default path SHALL be set to its containing directory; otherwise, if it's the first time browsing, it SHALL default to the active project's root path. The selected file's absolute path SHALL be stored in `joinConfig.externalSource.absolutePath`. External file selection is optional — the user MAY proceed to Column Types with only a qCBF file selected. When no external file is selected, `joinConfig` SHALL be `null`.

#### Scenario: User selects external CSV file

- **WHEN** no external file is configured and the user clicks "Browse..." and selects `/home/user/covariates.csv`
- **THEN** `joinConfig.externalSource.absolutePath` SHALL be set to `/home/user/covariates.csv` and `inspect_external_data` SHALL be called to populate the column from external data list

#### Scenario: User selects external xlsx file

- **WHEN** no external file is configured and the user clicks "Browse..." and selects `/home/user/data.xlsx`
- **THEN** `joinConfig.externalSource.absolutePath` SHALL be set to `/home/user/data.xlsx`, `inspect_external_data` SHALL be called, and the first sheet SHALL be used for inspection

#### Scenario: No external file selected

- **WHEN** the user selects only a qCBF file and does not pick an external file
- **THEN** `joinConfig` SHALL be `null` and the stepper SHALL proceed to Column Types with qCBF-only columns

#### Scenario: Unsupported file format

- **WHEN** the user selects a file with an extension other than `.csv`, `.tsv`, or `.xlsx`
- **THEN** the file dialog SHALL filter to supported extensions and the selection SHALL be rejected

### Requirement: External Data Inspection Command

A Rust command `inspect_external_data` SHALL accept `absolutePath: String`, optional `sheetName`, and `delimiter: Option<String>` (where `None` or `Some("auto")` triggers auto-detection) and return an `ExternalDataInspection` object containing: `columns` (array of `{ name, inferredType, levels, isIdentifier }`), `rowCount`, `fileHash` (SHA-256 hex string), and `sheetName` (the inspected sheet name for xlsx, `null` for CSV/TSV). The command SHALL NOT cache data in `AppState` — it is a preview for join configuration. Generic type inference SHALL classify columns as `"continuous"` or `"nominal"` using fixed missing-value rules from `data-vis-contract`, without accepting configured `naTokens`. All external columns SHALL have `isIdentifier: false`. For xlsx files, inspection SHALL read the supplied sheet or the first sheet when omitted; the file-selection UI SHALL omit `sheetName` and inspect the first sheet. For CSV files, an explicit comma, tab, or semicolon delimiter SHALL be used; otherwise, detection SHALL count those characters in the first physical line, without skipping blank lines. Semicolon or tab SHALL be selected only when its count strictly exceeds both others; all other cases SHALL select comma. If a join configuration is already active, the external data file SHALL be automatically inspected on component mount/render using `inspect_external_data`, with deduplication based on path, hash, and delimiter to prevent redundant API calls.

#### Scenario: Inspect CSV file

- **WHEN** `inspect_external_data` is called with a path to a CSV file containing columns `SubjectID`, `Diagnosis`, `Age`
- **THEN** the returned `columns` SHALL include all three columns with `isIdentifier: false` and `inferredType` based on content (e.g., `Age` as `"continuous"`, `Diagnosis` as `"nominal"`)

#### Scenario: Inspect xlsx file with multiple sheets

- **WHEN** `inspect_external_data` is called without `sheetName` for an xlsx file with sheets `["Metadata", "Data", "Notes"]`
- **THEN** the command SHALL read only the first sheet (`"Metadata"`) and `sheetName` SHALL be `"Metadata"`

#### Scenario: CSV with semicolon delimiter

- **WHEN** `inspect_external_data` uses automatic delimiter detection for a CSV file whose first line contains 5 semicolons, 0 commas, and 0 tabs
- **THEN** the command SHALL parse using semicolon as the delimiter

#### Scenario: Delimiter detection uses first physical line

- **WHEN** automatic CSV delimiter detection receives an empty first physical line or tied maximum delimiter counts
- **THEN** its selected delimiter SHALL be comma; detection SHALL NOT inspect a later non-empty line

#### Scenario: External file not found

- **WHEN** `inspect_external_data` is called with a path that does not exist
- **THEN** the command SHALL return an error: "File not found: {path}"

### Requirement: Join Key Pair Configuration

The join configuration UI SHALL present key-pair rows, each containing a left dropdown (listing available qCBF identifier columns: `participant_id`, `subject`, `session`, `run`) and a right dropdown (listing all external columns). The user SHALL add key pairs via an "Add key pair" button and remove individual pairs via a remove button per row. Key pairs SHALL be stored cohesively as `keys: Array<{ left: string, right: string }>`. Select Data SHALL execute a join only when the list is non-empty and every pair has both columns selected. Empty or incomplete pairs SHALL NOT themselves disable Next; advancing in those cases SHALL retain the current inspection without executing a join. `left` SHALL be restricted to available identifier columns only, while `right` SHALL allow any external column.

#### Scenario: Single key pair join

- **WHEN** the user configures one key pair with `keys` set to `[{ left: "participant_id", right: "SubjectSession" }]`
- **THEN** the join SHALL match rows where `participant_id` equals `SubjectSession`

#### Scenario: Multi key pair join

- **WHEN** the user configures two key pairs: `keys` set to `[{ left: "subject", right: "Subject" }, { left: "session", right: "Visit" }]`
- **THEN** the join SHALL match rows where `subject` equals `Subject` AND `session` equals `Visit`

#### Scenario: Incomplete key pair skips join execution

- **WHEN** inspection exists, the configured external source is available, and at least one key pair is incomplete
- **THEN** Next SHALL remain enabled and clicking it SHALL advance to Column Types with the current inspection, without calling `execute_join`

#### Scenario: No key pairs configured

- **WHEN** inspection exists, the configured external source is available, and no key pairs are configured
- **THEN** Next SHALL remain enabled and clicking it SHALL advance with the current inspection, without calling `execute_join`

#### Scenario: Non-identifier column excluded from left dropdown

- **WHEN** the left dropdown is rendered
- **THEN** only available columns among `participant_id`, `subject`, `session`, and `run` SHALL be listed — non-identifier columns like `Total_GM_B` SHALL NOT appear

### Requirement: Join Execution Command

A Rust command `execute_join` SHALL accept `projectRoot: String`, `qcbfRelativePath: String`, `externalAbsolutePath: String`, `keys: Vec<JoinKeyPair>` (where `JoinKeyPair` contains `{ left: String, right: String }`), `dropRightOn: bool`, `naTokens: Vec<String>`, `sheetName: Option<String>`, and `delimiter: Option<String>`. The command SHALL parse both files, perform a left join (qCBF rows preserved, external covariates appended), and cache the merged result in `AppState.active_data`. The join SHALL use hash-based matching on the key pairs. Key value comparison SHALL be case-insensitive, whitespace-trimmed, and normalized by stripping any leading `sub-` prefix from both qCBF and external identifier values before matching. Unmatched qCBF rows SHALL retain all column from qCBF datas with column from external datas set to empty strings (normalized from NA tokens). Column name collisions on non-key columns SHALL be resolved with `_x` suffix for column from qCBF datas and `_y` suffix for column from external datas. When `dropRightOn` is true, all external join-key columns (`keys[i].right`) SHALL be dropped from the merged result. The command SHALL return a `DataInspection` object with merged `columns` (each carrying `source`, `originalName`, `units`, `inferredType`, `levels`, `isIdentifier`), `rowCount` (the final merged row count), `qcbfRowCount` (the original qCBF row count), `qcbfHash`, and `externalHash`.

#### Scenario: Successful left join with match

- **WHEN** `execute_join` is called with matching keys and both files exist
- **THEN** the merged result SHALL contain all qCBF rows with column from external datas appended where keys match, cached in `active_data`, and returned as `DataInspection`

#### Scenario: Join matches keys with different casing and prefix

- **WHEN** the qCBF row has key `"sub-001"` and the external row has key `"001"` or `"Sub-001"` or `"  sub-001  "`
- **THEN** the rows SHALL be matched successfully

#### Scenario: Unmatched qCBF rows

- **WHEN** a qCBF row's `left` key values have no corresponding `right` key values in the external file
- **THEN** the merged row SHALL retain all column from qCBF datas and column from external datas SHALL be empty strings

#### Scenario: Column name collision suffixed

- **WHEN** both qCBF and external data contain a non-key column named `MeanMotion`
- **THEN** the merged result SHALL contain `MeanMotion_x` (from qCBF) and `MeanMotion_y` (from external)

#### Scenario: dropRightOn drops external key columns

- **WHEN** `dropRightOn` is true and the external join key is `"SubjectID"`
- **THEN** the `SubjectID` column SHALL NOT appear in the merged result (it is redundant with the qCBF join column)

#### Scenario: dropRightOn false preserves external key columns

- **WHEN** `dropRightOn` is false and the external join key is `"SubjectID"`
- **THEN** the `SubjectID` column SHALL appear in the merged result, suffixed with `_y` if it collides with a column from qCBF data name, otherwise as-is

#### Scenario: right join column shares name with non-key column from qCBF data

- **WHEN** the external join key is `"SubjectID"`, `dropRightOn` is true, and qCBF also has a non-key column named `SubjectID`
- **THEN** the external `SubjectID` (join key) SHALL be dropped, the left qCBF `SubjectID` (non-key) SHALL survive untouched without suffix — it is not a join key, it just happens to share a name

#### Scenario: NA tokens applied to external data

- **WHEN** `naTokens` includes `"NaN"` and the external file contains a cell with value `"NaN"`
- **THEN** that cell SHALL be normalized to an empty string in the merged result

#### Scenario: External file not found during join

- **WHEN** `execute_join` is called and the external file does not exist
- **THEN** the command SHALL return an error: "External file not found: {path}"

### Requirement: Join Config Persistence

The join configuration SHALL persist to `uiState.dataVis.joinConfig` in the `.easl` project file. The persisted shape SHALL include: `externalSource` (`{ absolutePath, fileHash, sheetName }` — `sheetName` is the first sheet name for xlsx, `null` for CSV/TSV), `keys` (array of `{ left: string, right: string }` objects), `dropRightOn` (boolean, default `true`), `naTokens` (array of strings, default `["", "NaN", "NA", "n/a", "<NA>"]`), and `delimiter` (string, default `"auto"`). `joinConfig` SHALL be `null` as a unit when no external file is selected — `externalSource` SHALL NOT be `null` independently within a non-null `joinConfig`. The `sheetName` lives exclusively within `externalSource` — there is no top-level `joinConfig.sheetName` field.

#### Scenario: Join config saved after configuration

- **WHEN** the user configures a join and clicks "Next" to proceed to Column Types
- **THEN** `joinConfig` SHALL be persisted to `uiState.dataVis.joinConfig` with all configured fields

#### Scenario: Join config cleared when external file removed

- **WHEN** the user removes the external file selection
- **THEN** `joinConfig` SHALL be set to `null` and persisted

#### Scenario: naTokens default on first join

- **WHEN** the user configures a join for the first time without modifying NA tokens
- **THEN** `naTokens` SHALL default to `["", "NaN", "NA", "n/a", "<NA>"]`

### Requirement: Graphical Join Diagram

The "Select Data" step SHALL render a side-by-side join diagram when qCBF/external inspections exist and at least one complete key pair is configured. The left box SHALL display the qCBF filename, columns filtered to qCBF source using their original names before suffixing, and the original qCBF row count. The right box SHALL display the external filename, columns, and row count. A central left arrow and "LEFT JOIN" label SHALL appear between the boxes. Configured key names SHALL be statically emphasized in blue on the left and grape on the right; non-key names SHALL be dimmed. The diagram SHALL NOT align individual pairs, draw per-pair connector lines, or add hover-linked highlighting. It SHALL use Mantine components, CSS, and the arrow icon without an external diagramming library.

#### Scenario: Diagram renders with join configured

- **WHEN** the user has selected an external file and configured one key pair
- **THEN** the diagram SHALL show two boxes side-by-side, a central LEFT JOIN arrow, and statically emphasized key-column names

#### Scenario: Diagram shows row counts

- **WHEN** the qCBF file has 2000 rows and the external file has 1800 rows
- **THEN** the left box SHALL display "2,000 rows" and the right box SHALL display "1,800 rows"

#### Scenario: Key-column emphasis is static

- **WHEN** `participant_id` is paired with `SubjectSession`
- **THEN** both names SHALL be emphasized without requiring hover or drawing a line between them

#### Scenario: No diagram without external file

- **WHEN** no external file is selected
- **THEN** the join diagram SHALL NOT render

### Requirement: Join Sanity Checks

When the diagram is available, sanity checks SHALL run automatically on the complete configured key pairs and display badges or alerts below it. A Rust command `check_join_sanity` SHALL accept the same arguments as `execute_join` (except `dropRightOn`). The checks SHALL be: (1) Key overlap — count of distinct qCBF key combinations found in the external keys; zero overlap SHALL show a red alert: "No matching values between join columns. Check that keys correspond." (2) Unmatched left rows — count of qCBF rows without an external match, displayed as an informational warning badge. (3) Left key uniqueness — duplicate qCBF keys SHALL show "Left keys are not unique — rows will be duplicated. Consider adding session/run to the join key." (4) Right key uniqueness — duplicate external keys SHALL show "Right keys are not unique — cartesian expansion will occur." Checks SHALL rerun after configuration changes without a button press. Results SHALL be advisory only and SHALL NOT control Next readiness.

#### Scenario: Zero key overlap warns without blocking progression

- **WHEN** the key overlap check finds zero matching value combinations between `left` and `right` keys
- **THEN** a red alert SHALL show "No matching values between join columns. Check that keys correspond." without disabling Next; with inspection and external availability ready, a complete-key join SHALL still execute

#### Scenario: Unmatched left rows shown as warning

- **WHEN** 200 of 2000 qCBF rows have no matching external data
- **THEN** a warning badge SHALL display: "200 unmatched qCBF rows (NaN covariates)"

#### Scenario: Non-unique left keys warning

- **WHEN** the left keys consist of only `["subject"]` and multiple rows share the same subject (different sessions)
- **THEN** a warning alert SHALL display: "Left keys are not unique — rows will be duplicated. Consider adding session/run to the join key."

#### Scenario: Non-unique right keys warning

- **WHEN** the right key consists of only `["SubjectID"]` and the external file has duplicate SubjectID values
- **THEN** a warning alert SHALL display: "Right keys are not unique — cartesian expansion will occur."

#### Scenario: All checks pass

- **WHEN** key overlap is non-zero, left keys are unique, and right keys are unique
- **THEN** a success badge SHALL display "All checks passed", while Next readiness SHALL continue to depend on inspection and external availability

### Requirement: NA Token Configuration

The "Select Data" step SHALL display a "Missing values" section (visible only when an external file is selected) with a `TagsInput` pre-filled with default tokens: `["", "NaN", "NA", "n/a", "<NA>"]`. The user SHALL add custom tokens (e.g., `-9999`, `null`) and remove default tokens. Configured tokens SHALL be passed to `execute_join` and `check_join_sanity` to normalize matching external row values to empty strings; qCBF handling SHALL remain unchanged. Preview and joined column metadata SHALL still use raw external inspection and fixed missing-value rules, not configured tokens. Frontend chart missing checks SHALL likewise use fixed rules on returned rows. If all tokens are cleared, the UI SHALL display "No NA tokens specified — all values treated as present." This warning SHALL NOT alter fixed inference or chart missing-value checks.

#### Scenario: Default NA tokens shown

- **WHEN** the user selects an external file and the "Missing values" section renders
- **THEN** the TagsInput SHALL contain `["", "NaN", "NA", "n/a", "<NA>"]`

#### Scenario: Custom NA token added

- **WHEN** the user adds `-9999` to the NA tokens
- **THEN** `-9999` SHALL be included in `naTokens` passed to `execute_join`

#### Scenario: Custom string token does not change metadata inference

- **WHEN** an external column contains `[45, 50, "<NA>", 60]` and `naTokens` includes `"<NA>"`
- **THEN** joined rows SHALL normalize `"<NA>"` to an empty string, but preview and joined metadata SHALL retain nominal inference from the raw column

#### Scenario: All NA tokens cleared

- **WHEN** the user removes all NA tokens from the TagsInput
- **THEN** a warning SHALL display: "No NA tokens specified — all values treated as present."

### Requirement: Drop Right-On Toggle

A checkbox labeled "Drop join-key columns from external data (recommended)" SHALL be displayed in the join configuration section, defaulting to checked. When checked, all `rightOn` columns SHALL be dropped from the merged result. When unchecked, `rightOn` columns SHALL survive in the merged result with `_y` suffix if they collide with column from qCBF data names, or as-is if no collision. `leftOn` columns from qCBF SHALL always survive regardless of this toggle.

#### Scenario: Toggle checked by default

- **WHEN** the join configuration section renders for the first time
- **THEN** the "Drop join-key columns from external data (recommended)" checkbox SHALL be checked

#### Scenario: Unchecking preserves right-on columns

- **WHEN** the user unchecks the drop toggle and `rightOn` is `["SubjectID"]`
- **THEN** the `SubjectID` column SHALL appear in the merged result

### Requirement: File Change Invalidation on qCBF Change

When the user changes the qCBF file selection, `joinConfig` SHALL be set to `null`, all contract fields (`columnTypes`, `levelOrderings`, `axisAssignment`, `stage`) SHALL be reset, and `load_qcbf_data` SHALL re-run for the new file. This is a full contract invalidation — no join configuration or column overrides are preserved.

#### Scenario: Changing qCBF file clears join config

- **WHEN** the user goes back to "Select Data" and selects a different qCBF file
- **THEN** `joinConfig` SHALL be set to `null` and all contract fields SHALL be reset

### Requirement: File Change Invalidation on External File Change

External replacement SHALL be content-hash based, not path based. When the selected replacement matches the saved hash, its source path SHALL be updated without clearing join keys or dependent setup, following `data-vis-contract`. Different content SHALL require confirmation before adoption. On confirmation, `joinConfig.externalSource` SHALL adopt `{ absolutePath, fileHash, sheetName }`, `keys` SHALL reset to `[]`, and dependent column types, identifiers, level orderings, axes, filters, stage, and transient chart/viewer setup SHALL reset. `naTokens`, `delimiter`, and `dropRightOn` SHALL be preserved. Cancellation SHALL leave saved configuration unchanged. Accepted replacement edits SHALL use shared autosave.

#### Scenario: Confirming changed external content resets keys and preserves preferences

- **WHEN** the user confirms adoption of a different-hash external file while `keys` is `[{ left: "subject", right: "Subject" }, { left: "session", right: "Visit" }]` and `naTokens` includes `-9999`
- **THEN** `keys` SHALL become `[]`, `naTokens` SHALL remain including `-9999`

#### Scenario: Different path with matching content preserves setup

- **WHEN** the user chooses a replacement at a different absolute path with the saved content hash
- **THEN** the source path SHALL update without a reset confirmation or clearing join keys, column types, level orderings, axes, filters, or saved stage

#### Scenario: Changing external file updates sheetName

- **WHEN** the user confirms a different-hash external file (e.g., from a CSV to an xlsx with first sheet named "Data")
- **THEN** `joinConfig.externalSource.sheetName` SHALL be updated to `"Data"` — the old file's `sheetName` SHALL NOT persist

### Requirement: Removing External File Mid-Session

When the user clicks Remove on Select Data, `joinConfig` SHALL be set to `null` and persisted, external-source availability SHALL become unconfigured, and the local external preview/inspection marker SHALL clear. Removal SHALL NOT call `load_qcbf_data`, replace the current store inspection or backend cache, or reset column types, level orderings, axes, or filters. The stepper SHALL remain on Select Data. A subsequent no-join Next SHALL advance using that current inspection without reloading qCBF-only data.

#### Scenario: Removing external file preserves current loaded data

- **WHEN** the user returns from Column Types to Select Data and removes the external file after a join
- **THEN** `joinConfig` SHALL be `null`, but current merged inspection, dependent settings, and backend cached rows SHALL remain until a later load replaces them; Next SHALL advance without a reload

### Requirement: External File mtime Re-Validation

On Tauri window focus, if `joinConfig` is active, the system SHALL stat the external file's mtime. If the mtime has changed since the last validation, `execute_join` SHALL re-run and the returned `externalHash` SHALL be compared with `joinConfig.externalSource.fileHash`. If the hash mismatches or the external file is missing or unreadable, the saved `joinConfig` and dependent contract settings SHALL remain unchanged. The system SHALL show a persistent Relink warning, disable joined-data actions, and keep readable qCBF-only data available through `load_qcbf_data`. Relinking matching content SHALL preserve setup; adopting changed content SHALL require confirmation before resetting dependent setup, as defined in `data-vis-contract`.

#### Scenario: External file unchanged on focus

- **WHEN** the window regains focus and the external file's mtime is unchanged
- **THEN** no re-validation SHALL occur

#### Scenario: External file changed on focus

- **WHEN** the window regains focus, the external file's mtime has changed, and the hash mismatches
- **THEN** `joinConfig` and saved setup SHALL remain unchanged, qCBF-only data SHALL remain available, and a Relink warning SHALL require confirmation before resetting setup for changed content

#### Scenario: External file deleted on focus

- **WHEN** the window regains focus and the external file no longer exists
- **THEN** `joinConfig` SHALL remain unchanged, joined-data actions SHALL be disabled, and a persistent Relink warning SHALL identify the missing saved source

### Requirement: Join Execution on Step Advance

On Select Data, Next SHALL be disabled only when no inspection is loaded or a configured external source is not available. Key completeness and sanity results SHALL NOT disable it. With a current project and qCBF source, clicking Next SHALL call `execute_join` only if `joinConfig` has a non-empty key list and every pair is complete. On success, the returned `DataInspection` SHALL replace store inspection, `AppState.active_data` SHALL contain the merged result, column types SHALL reset to inference, level orderings/axes SHALL clear, and stage SHALL advance to Column Types. Join failure SHALL show an error without advancing. With no join config, empty keys, or any incomplete pair, Next SHALL advance using the current inspection without calling `execute_join` or `load_qcbf_data`; that inspection MAY still contain a previous join after external removal.

#### Scenario: Next with join configured triggers execute_join

- **WHEN** the user has selected a qCBF file, configured an available external file with a non-empty list of complete key pairs, and clicks "Next"
- **THEN** `execute_join` SHALL be called, `inspection` SHALL be replaced with the merged `DataInspection`, `active_data` SHALL be replaced with the merged result, and the stepper SHALL advance to "Column Types"

#### Scenario: Next without join advances directly

- **WHEN** the user has selected a qCBF file with no external file (`joinConfig` is `null`) and clicks "Next"
- **THEN** the stepper SHALL advance to "Column Types" using the current `inspection` — neither `execute_join` nor `load_qcbf_data` SHALL be called

#### Scenario: Next with incomplete keys advances without joining

- **WHEN** inspection exists and the external source is available, but some key pairs have unselected fields
- **THEN** Next SHALL be enabled and SHALL advance without joining or resetting the current inspection/settings

#### Scenario: External source unavailable blocks Next

- **WHEN** `joinConfig` exists and external-source availability is not `available`
- **THEN** Next SHALL be disabled regardless of key completeness or sanity results

### Requirement: Join Config Change Re-Execution

Whenever the user advances from Select Data with an available external source and a non-empty list of complete key pairs, `execute_join` SHALL run with the current configuration, whether or not settings changed during back navigation. On success, merged inspection/cache SHALL be replaced wholesale, column types SHALL reset to inference, and level orderings/axes SHALL clear. Configuration edits alone SHALL NOT reload the cache. Empty/incomplete key lists and external removal SHALL instead use the no-join advance behavior above.

#### Scenario: Back-navigation with join key change re-runs execute_join

- **WHEN** the user goes back to "Select Data", changes key pairs from `keys: [{ left: "participant_id", right: "SubjectID" }]` to `keys: [{ left: "subject", right: "Subject" }, { left: "session", right: "Visit" }]`, then clicks "Next"
- **THEN** `execute_join` SHALL re-run with the new key pairs, `inspection` SHALL be replaced, and `columnTypes`, `levelOrderings`, `axisAssignment` SHALL be reset to auto-inferred defaults

#### Scenario: Back-navigation with dropRightOn change re-runs execute_join

- **WHEN** the user goes back to "Select Data", unchecks `dropRightOn`, then clicks "Next"
- **THEN** `execute_join` SHALL re-run with `dropRightOn: false`, `inspection` SHALL reflect the updated column set (right join columns now present), and `columnTypes` SHALL be reset to auto-inferred defaults

#### Scenario: Back-navigation with naTokens change re-runs execute_join

- **WHEN** the user goes back to "Select Data", adds `-9999` to `naTokens`, then clicks "Next"
- **THEN** `execute_join` SHALL re-run with the updated `naTokens`, and cells matching `-9999` SHALL be normalized to empty strings in the merged result

### Requirement: File Stats Command

A Rust command `stat_file` SHALL accept `path: String` and return a `FileStats` object containing `mtime` (last modified time as a Unix epoch seconds string) and `size` (file size in bytes). The command SHALL use `std::fs::metadata` for cross-platform mtime resolution (NTFS last-write-time on Windows, inode mtime on macOS/Linux). If the file does not exist, the command SHALL return an error. This command is used for mtime-based re-validation on window focus to avoid unnecessary full file reads and hash computations when files are unchanged.

#### Scenario: Stat existing file

- **WHEN** `stat_file` is called with a path to an existing file
- **THEN** the returned `FileStats` SHALL contain the file's mtime as a Unix epoch seconds string and its size in bytes

#### Scenario: Stat non-existent file

- **WHEN** `stat_file` is called with a path that does not exist
- **THEN** the command SHALL return an error

### Requirement: Active Data Cache Invariants

The `AppState.active_data: Mutex<Option<ActiveData>>` slot SHALL serve as the single unified data cache for both qCBF-only and join-active flows. The following invariants SHALL hold:

1. **Always populated when needed**: `active_data` SHALL be populated (non-`None`) whenever the "Column Types" or "Visualize" step is active — `read_data_columns` SHALL never encounter an empty cache during these steps.
2. **Wholesale replacement on load**: Successful `load_qcbf_data` and `execute_join` operations SHALL replace `active_data` entirely, not partially update it. Join configuration edits, external preview inspection, matching-hash relinking, and external removal SHALL NOT themselves replace the backend cache.
3. **One slot per project**: Exactly one `ActiveData` entry SHALL exist per project. The cache SHALL be cleared (`None`) when the active project changes via `set_active_project` or `clear_active_project`.
4. **No disk I/O on read**: `read_data_columns` SHALL read exclusively from the in-memory cache — it SHALL NOT touch disk.
5. **Frontend hash validation**: Hash comparison SHALL occur in the frontend after `load_qcbf_data` or `execute_join` returns — Rust SHALL return hashes, the frontend SHALL compare them against persisted values.
6. **inspect_external_data does not cache**: `inspect_external_data` is a preview for join configuration — it SHALL NOT modify `active_data`. Only `load_qcbf_data` and `execute_join` SHALL populate the cache.
7. **Original qCBF row storage**: `ActiveData` cache SHALL store a copy of the original unjoined qCBF rows (`qcbf_rows`) separately from the merged rows, ensuring that subsequent sanity check runs (`check_join_sanity`) use the pristine qCBF data and are not contaminated by previously merged results.

#### Scenario: active_data populated after load_qcbf_data

- **WHEN** `load_qcbf_data` is called and succeeds
- **THEN** `AppState.active_data` SHALL be `Some(ActiveData)` with the parsed qCBF rows, columns, and `external_hash: None`

#### Scenario: active_data replaced after execute_join

- **WHEN** `execute_join` is called and succeeds
- **THEN** `AppState.active_data` SHALL be `Some(ActiveData)` with the merged rows, merged columns, `qcbf_hash`, and `external_hash: Some(hash)` — the previous cache content SHALL be entirely replaced

#### Scenario: active_data cleared on project switch

- **WHEN** `set_active_project` or `clear_active_project` is called
- **THEN** `AppState.active_data` SHALL be set to `None` — the next `load_qcbf_data` or `execute_join` call SHALL repopulate it

#### Scenario: active_data replaced on qCBF file change

- **WHEN** the user selects a different qCBF file and `load_qcbf_data` is called
- **THEN** the previous `active_data` content SHALL be entirely replaced — no columns or rows from the previous file SHALL persist

#### Scenario: read_data_columns fails when cache empty

- **WHEN** `read_data_columns` is called and `AppState.active_data` is `None`
- **THEN** the command SHALL return an error: "No data loaded. Select a file first."

#### Scenario: inspect_external_data does not modify cache

- **WHEN** `inspect_external_data` is called
- **THEN** `AppState.active_data` SHALL remain unchanged — no caching SHALL occur
