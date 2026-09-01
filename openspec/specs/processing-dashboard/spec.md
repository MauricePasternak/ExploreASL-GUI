# processing-dashboard Specification

## Purpose

Define the processing route, dashboard, and access behavior.

## Requirements

### Requirement: Processing Route and Gating

The processing route SHALL be `/project/:id/processing`. It SHALL be inaccessible when `project.uiState.importCompleted !== true`, enforced by the existing `canAccessPhase` function. If the user navigates to this route without completing import, they SHALL be redirected to the import route.

#### Scenario: Access before import completion

- **WHEN** the user navigates to `/project/:id/processing` before import is complete
- **THEN** the app SHALL redirect to `/project/:id/import`

### Requirement: Subject Selection DataTable

The processing page SHALL display a Mantine DataTable with checkboxes for subject/session selection. Columns SHALL include: checkbox, subject, session, Structural status icon, Structural Logs/Errors, ASL status icon, ASL Logs/Errors. Above the table, filter chips SHALL allow filtering by status: All, Pending, Incomplete, Complete. "Select all" and "Deselect all" buttons SHALL be provided.

The two new columns SHALL render as follows:

- **Has log, no error**: teal `Badge` with text "View Logs", clickable to open LogViewerModal
- **Has log, has error**: red `Badge` with text "View Errors", clickable to open LogViewerModal
- **No log file, module not skipped**: grey text "No Logs"
- **Module skipped**: empty cell (no content)

#### Scenario: Status icons reflect lock file state

- **WHEN** a SubjectSession has `999_ready.status` for Structural module
- **THEN** the Structural status column SHALL show a green checkmark icon

#### Scenario: ASL module unavailable for subject

- **WHEN** a SubjectSession's `rawdata/sub-X/ses-Y/` lacks a `perf/` subdirectory
- **THEN** the ASL status column SHALL show a "skipped" icon and the ASL Logs/Errors column SHALL show an empty cell

#### Scenario: Filter by incomplete

- **WHEN** the user clicks the "Incomplete" filter chip
- **THEN** the table SHALL show only SubjectSessions where at least one module has status "incomplete"

#### Scenario: Subject with errored ASL log

- **WHEN** `list_module_logs` returns `has_error: true` for an ASL log file belonging to subject "sub-001" session "01"
- **THEN** the ASL Logs/Errors column for that row SHALL display a red Badge labeled "View Errors"

#### Scenario: Subject with completed Structural log

- **WHEN** `list_module_logs` returns a Structural log file with `has_error: false` for subject "sub-001" session "01"
- **THEN** the Structural Logs/Errors column for that row SHALL display a teal Badge labeled "View Logs"

#### Scenario: Subject with no log file yet

- **WHEN** `list_module_logs` returns no entries for subject "sub-001" session "01" for the Structural module
- **THEN** the Structural Logs/Errors column for that row SHALL display grey text "No Logs"

#### Scenario: Skipped module shows nothing

- **WHEN** a subject session has `hasStructural: false`
- **THEN** the Structural Logs/Errors column for that row SHALL show an empty cell

#### Scenario: Population column removed

- **WHEN** the Subject Selection DataTable renders
- **THEN** no Population status column SHALL appear in the table

### Requirement: Pipeline Configuration Panel

The pipeline configuration panel SHALL include: Profile selector dropdown (populated from global settings `executionProfiles`), module checkboxes (Structural, ASL — at least one required unless Population is selected), and worker count number input with default `Math.min(ceil(availableMemory / 4GB), cpuCores, 4)` and hard cap at `cpuCores`.

#### Scenario: Population module not shown

- **WHEN** the Pipeline Configuration Panel renders
- **THEN** no Population checkbox SHALL appear

#### Scenario: No valid profiles configured

- **WHEN** global settings has no valid execution profiles
- **THEN** the profile selector dropdown SHALL show an error state and the Start button SHALL be disabled

#### Scenario: Worker count not forced by Population

- **WHEN** Population is selected in the Population Analysis section
- **THEN** the worker count input in PipelineConfig SHALL NOT be affected (Population's worker=1 constraint is handled elsewhere)

### Requirement: Pre-flight Validation

Before transitioning from `idle` to `preparing`, the store SHALL validate the following. Rules are categorized as hard blocks (prevent Start), soft warnings (allow Start with caution), or informational (auto-applied).

**Hard blocks (cannot proceed):**

1. At least one SubjectSession selected (relaxed when the only selected module is Population — group-level module)
2. At least one module selected
3. Selected profile is valid (resolved from `executionProfiles`, checked in `profileValidationState`)
4. Worker count > 0 and ≤ available cores
5. If Population selected, worker count must be 1

**Soft warnings (can proceed):**

- `derivatives/ExploreASL/dataPar.json` target directory doesn't exist yet (ExploreASL uses defaults if missing)

**Informational (auto-applied, not blocking):**

- Modules marked "skipped" per SubjectSession based on BIDS data availability (`perf/` for ASL, `anat/` for Structural)

#### Scenario: Missing valid profile

- **WHEN** no valid execution profiles exist or the selected profile is invalid
- **THEN** a hard block error SHALL be displayed directing the user to configure a valid profile in Settings

#### Scenario: Zero subjects selected

- **WHEN** no subjects are checked in the DataTable AND modules contain Structural or ASL
- **THEN** the Start button SHALL be disabled with message "Select at least one subject"

#### Scenario: Population-only run with no subjects selected

- **WHEN** modules is exactly `["population"]` AND no subjects are checked
- **THEN** the Start button SHALL remain enabled (Population is group-level and does not require per-subject selection)

#### Scenario: Soft warning about dataPar.json

- **WHEN** `derivatives/ExploreASL/dataPar.json` doesn't exist
- **THEN** a soft warning SHALL be shown: "dataPar.json not found. ExploreASL will use defaults." The Start button SHALL remain enabled

### Requirement: Execution Dashboard

The execution dashboard SHALL display module-grouped collapsible sections (Structural, ASL, Population). Each section SHALL show module-level progress summary. Inside Structural/ASL sections, one row per SubjectSession with step timeline. Inside Population section, one single row. Population rows SHALL not be grouped by subject since Population is study-level. The execution dashboard SHALL only be visible during active pipeline runs (preparing and running phases) and hidden upon completion, failure, or cancellation.

#### Scenario: Structural module section expanded

- **WHEN** the user expands the Structural section during processing
- **THEN** one row per SubjectSession SHALL be shown with columns: subject, session, step progress bar, current step name, elapsed time

#### Scenario: ASL module with multiple runs

- **WHEN** a SubjectSession has `ASL_1` and `ASL_2` runs under `xASL_module_ASL/`
- **THEN** the ASL row for that SubjectSession SHALL show sub-rows for each run

### Requirement: Start and Kill Controls

The UI SHALL have a Start button that transitions to a Kill button while processing is active. After completion, failure, or cancellation, Start SHALL become available again. No separate Pause or Restart button.

#### Scenario: Start button transitions

- **WHEN** the user clicks Start after validation passes
- **THEN** the button SHALL change to "Kill" and the processing phase SHALL transition to `preparing` then `running`

#### Scenario: Kill button

- **WHEN** the user clicks Kill during active processing
- **THEN** `kill_pipeline` SHALL be invoked, all workers SHALL be terminated, and the phase SHALL transition to `cancelled`

### Requirement: Rawdata Sanity Check

On page load, if `rawdata/` is empty or subjects exist in lock files but not in rawdata, the dashboard SHALL display warnings for orphaned entries.

#### Scenario: Orphaned lock entries

- **WHEN** `read_lock_status` returns SubjectSessions not found in `rawdata/`
- **THEN** the dashboard SHALL show a warning: "Subject data missing for sub-X_01. Re-run import or clean up."

### Requirement: Re-run Flow

Clicking Start with subjects/modules selected (including completed ones) SHALL automatically delete `.status` files for the selected modules on the selected subjects before spawning workers. Subject output directories SHALL NOT be deleted — ExploreASL overwrites as needed.

#### Scenario: Re-running completed subject

- **WHEN** the user selects a subject with `999_ready.status` for Structural and clicks Start with Structural checked
- **THEN** the Structural `.status` files for that subject SHALL be deleted, workers SHALL be spawned, and the subject SHALL be reprocessed from the beginning of the Structural module

### Requirement: Subject Row Extensibility

Each SubjectSession row in the execution dashboard SHALL be architected to accommodate future per-row actions without row schema changes. Specifically, the row structure SHALL support: a "View Errors" button (reads ExploreASL log file on demand), a "View QC" button (opens QC images in a modal), and inline error text (similar to the import module's error display). These features are out of scope for the initial implementation but the row component API SHALL not preclude their addition.

#### Scenario: Row action slot for future features

- **WHEN** a SubjectSession row is rendered
- **THEN** the row component SHALL expose an actions slot or callback area that can later accommodate error viewing, QC viewing, and inline error text

### Requirement: ASL Run Display

For ASL module rows, run sub-rows SHALL only be displayed when a SubjectSession has more than one ASL run (multiple `xASL_module_ASL_ASL_<n>` directories in the lock structure). When there is exactly one run, the ASL row SHALL display progress inline without sub-rows.

#### Scenario: Single ASL run

- **WHEN** a SubjectSession has only `xASL_module_ASL_ASL_1` in its lock directory
- **THEN** the ASL row SHALL show progress directly without expandable sub-rows

#### Scenario: Multiple ASL runs

- **WHEN** a SubjectSession has `xASL_module_ASL_ASL_1` and `xASL_module_ASL_ASL_2`
- **THEN** the ASL row SHALL be expandable to show sub-rows for each run

### Requirement: Population Lock Structure

Population module lock files SHALL be read from `lock/xASL_module_Population/xASL_module_Population/` (study-level, no subject subdirectory). This differs from Structural and ASL which use `lock/xASL_module_<Module>/sub-X_Y/xASL_module_<Module>/`. The `read_lock_status` command and lock file watcher SHALL handle all three structures correctly.

#### Scenario: Population status file created

- **WHEN** `010_CreatePopulationTemplates.status` is created under `xASL_module_Population/xASL_module_Population/`
- **THEN** the event SHALL have `subject_session: undefined` and `module: "population"` and `run: undefined`
