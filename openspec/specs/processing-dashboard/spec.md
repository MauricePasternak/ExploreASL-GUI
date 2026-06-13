# processing-dashboard Specification

## Purpose
TBD - created by archiving change processing-module. Update Purpose after archive.
## Requirements
### Requirement: Processing Route and Gating
The processing route SHALL be `/project/:id/processing`. It SHALL be inaccessible when `project.uiState.importCompleted !== true`, enforced by the existing `canAccessPhase` function. If the user navigates to this route without completing import, they SHALL be redirected to the import route.

#### Scenario: Access before import completion
- **WHEN** the user navigates to `/project/:id/processing` before import is complete
- **THEN** the app SHALL redirect to `/project/:id/import`

### Requirement: Subject Selection DataTable
The processing page SHALL display a Mantine DataTable with checkboxes for subject/session selection. Columns SHALL include: checkbox, subject, session, Structural status icon, ASL status icon, Population status icon. Above the table, filter chips SHALL allow filtering by status: All, Pending, Incomplete, Complete. "Select all" and "Deselect all" buttons SHALL be provided.

#### Scenario: Status icons reflect lock file state
- **WHEN** a SubjectSession has `999_ready.status` for Structural module
- **THEN** the Structural column SHALL show a green checkmark icon

#### Scenario: ASL module unavailable for subject
- **WHEN** a SubjectSession's `rawdata/sub-X/ses-Y/` lacks a `perf/` subdirectory
- **THEN** the ASL column SHALL show a "skipped" icon and the cell SHALL be marked as unavailable

#### Scenario: Filter by incomplete
- **WHEN** the user clicks the "Incomplete" filter chip
- **THEN** the table SHALL show only SubjectSessions where at least one module has status "incomplete"

### Requirement: Pipeline Configuration Panel
The pipeline configuration panel SHALL include: MATLAB version dropdown (populated from global settings `matlabInstallations`), module checkboxes (Structural, ASL, Population — at least one required), and worker count number input with default `Math.min(ceil(availableMemory / 4GB), cpuCores, 4)` and hard cap at `cpuCores`. When Population is selected, worker count SHALL be forced to 1 with a visible warning.

#### Scenario: Population module selected
- **WHEN** the user checks the Population checkbox
- **THEN** the worker count SHALL be set to 1, the input SHALL be disabled, and a warning SHALL read "Population module cannot be parallelized. Worker count set to 1."

#### Scenario: No MATLAB path configured
- **WHEN** global settings has no MATLAB installations
- **THEN** the MATLAB version dropdown SHALL show an error state and the Start button SHALL be disabled

### Requirement: Pre-flight Validation
Before transitioning from `idle` to `preparing`, the store SHALL validate the following. Rules are categorized as hard blocks (prevent Start), soft warnings (allow Start with caution), or informational (auto-applied).

**Hard blocks (cannot proceed):**
1. At least one SubjectSession selected
2. At least one module selected
3. MATLAB path configured and executable exists
4. ExploreASL path exists and contains `ExploreASL.m`
5. Worker count > 0 and ≤ available cores
6. If Population selected, worker count must be 1

**Soft warnings (can proceed):**
- `derivatives/ExploreASL/dataPar.json` target directory doesn't exist yet (ExploreASL uses defaults if missing)

**Informational (auto-applied, not blocking):**
- Modules marked "skipped" per SubjectSession based on BIDS data availability (`perf/` for ASL, `anat/` for Structural)

#### Scenario: Missing ExploreASL path
- **WHEN** the global ExploreASL path does not exist or lacks `ExploreASL.m`
- **THEN** a hard block error SHALL be displayed: "ExploreASL not found at [path]. Check Settings."

#### Scenario: Zero subjects selected
- **WHEN** no subjects are checked in the DataTable
- **THEN** the Start button SHALL be disabled with message "Select at least one subject"

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

