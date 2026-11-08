# visualization-phase Specification

## Purpose

Orchestrate the user interface and store sync for the population analysis visualization phase of the project.

## Requirements

### Requirement: Visualization Project Phase

The project phase system SHALL include `visualization` as the fourth phase after `processing`, followed by `manifest`. The route `/project/:id/visualization` SHALL render the Visualization page when access guards permit it. The `PROJECT_PHASES` array SHALL be `["import", "parameters", "processing", "visualization", "manifest"]`. The project's `currentPhase` SHALL update to `"visualization"` on accepted navigation to the route, following the same pattern as other phases.

#### Scenario: Route renders visualization page

- **WHEN** the user navigates to `/project/:id/visualization`, `canAccessPhase` returns true, and processing is not active
- **THEN** the Visualization page SHALL render with the setup stepper

#### Scenario: Current phase updates on navigation

- **WHEN** the user is allowed to navigate to `/project/:id/visualization` and the project's `currentPhase` is not `"visualization"`
- **THEN** `setPhase("visualization")` SHALL be called and the project SHALL be saved

#### Scenario: Invalid phase redirects to current phase

- **WHEN** the user navigates to `/project/:id/visualization` but `canAccessPhase` returns false
- **THEN** the route guard SHALL redirect to the saved current phase, except that a saved visualization/manifest phase SHALL fall back to processing

### Requirement: Visualization Phase Gate

Visualization access SHALL use accepted native saved-cursor and Population eligibility without repeated filesystem probes, while separate active-processing route guards continue to block navigation.

#### Scenario: A saved or current project requests Visualization

- **WHEN** route eligibility and active-work guards evaluate access
- **THEN** cursor access, Population readiness, and processing lockout SHALL follow these rules:

The native project snapshot SHALL supply `allowedPhases`, and frontend `canAccessPhase` SHALL check membership in that list. Native access SHALL allow the saved/current phase and all earlier phases; visualization SHALL also be allowed as a later phase when `uiState.processing.population?.completed === true`. Thus a saved current phase of visualization or manifest SHALL permit visualization even without Population completion. This gate SHALL use accepted project configuration, not rescan Population output on each route change. Separately, the route guard SHALL block visualization while processing is preparing, running, finalizing, or cancelling, even if `allowedPhases` includes it.

#### Scenario: Access granted after Population completion

- **WHEN** `uiState.processing.population.completed` is `true`, processing is not active, and the user navigates to visualization
- **THEN** `canAccessPhase` SHALL return true and the page SHALL render

#### Scenario: Later-phase access denied without Population completion

- **WHEN** the saved current phase precedes visualization and `uiState.processing.population.completed` is `undefined` or `false`
- **THEN** `canAccessPhase` SHALL return false for `"visualization"` and the user SHALL be redirected to the current phase

#### Scenario: Access denied when Population flag missing

- **WHEN** the saved current phase precedes visualization and `uiState.processing.population` is entirely absent from the project file
- **THEN** `canAccessPhase` SHALL return false for `"visualization"`

#### Scenario: Saved later phase permits returning to visualization

- **WHEN** the saved current phase is visualization or manifest, Population completion is absent or false, and processing is not active
- **THEN** native `allowedPhases` SHALL include visualization and `canAccessPhase` SHALL return true

#### Scenario: Active processing blocks visualization route

- **WHEN** `allowedPhases` includes visualization but processing is preparing, running, finalizing, or cancelling
- **THEN** the route guard SHALL redirect away from visualization, using processing when the saved current phase is visualization or manifest

### Requirement: Population Completion Flag

Population completion SHALL derive only from accepted native execution-commit and terminal evidence, preserving prior completion before commit and persisting successful completion before exact acknowledgement.

#### Scenario: Population reservation or execution settles

- **WHEN** native commit or terminal evidence updates project prerequisites
- **THEN** invalidation, successful completion, and excluded renderer authority SHALL follow these rules:

Population completion SHALL derive only from accepted native run evidence under Exact processing terminal persistence in `processing-store`. An accepted Population execution-commit snapshot SHALL clear `uiState.processing.population.completed`; an accepted Completed terminal result for that committed Population run SHALL set it to `true` and persist it before exact acknowledgement. Rejected reservation or preparation failure before execution commit SHALL preserve prior completion. Renderer worker counts and historical lock reads SHALL NOT establish current-run completion.

#### Scenario: Flag set on Population completion

- **WHEN** native worker and expected-target audit publishes Completed for the attached committed Population run
- **THEN** `uiState.processing.population.completed` SHALL be set to `true` and persisted to the `.easl` file

#### Scenario: Flag not set when Population not selected

- **WHEN** all workers exit successfully but `config.modules` does not include `"population"`
- **THEN** `uiState.processing.population.completed` SHALL NOT be set

#### Scenario: Flag cleared on Population re-run

- **WHEN** an accepted native snapshot reports execution commit for a Population rerun and `uiState.processing.population.completed` is currently `true`
- **THEN** `uiState.processing.population.completed` SHALL be cleared to `false` from that commit evidence

#### Scenario: Population preparation fails before execution commit

- **WHEN** a Population start is rejected or preparation fails before native execution commit
- **THEN** prior Population completion and provenance SHALL remain unchanged

#### Scenario: Flag not cleared on non-Population re-run

- **WHEN** the user starts processing with `config.modules` not including `"population"`
- **THEN** `uiState.processing.population.completed` SHALL NOT be cleared

### Requirement: Stats Directory Runtime Scan

Visualization SHALL discover eligible Population Stats files on mount and focus, distinguish command failures from empty results, and show the specified alert-only presentation without a Processing navigation action.

#### Scenario: Population Stats discovery returns files, emptiness, or failure

- **WHEN** Visualization mounts or the window receives focus
- **THEN** eligible filenames and empty/error presentation SHALL follow these rules:

The Visualization page SHALL call `list_stats_files` on mount and window focus to discover eligible `.tsv` files in `<root>/derivatives/ExploreASL/Population/Stats/`, restricted to `mean_`, `median_`, and `CoV_` prefixes as defined in `data-vis-contract`. Missing directories and directories with no eligible files SHALL both produce an empty list and the same yellow alert. A command failure SHALL instead show "Population Stats not found. Population may have been modified externally." The alert-only view SHALL NOT include a Processing navigation button.

#### Scenario: Stats directory missing

- **WHEN** the Visualization page mounts and `Population/Stats/` does not exist
- **THEN** the page SHALL show the yellow alert "No statistics files found in Population/Stats." without a Processing navigation button

#### Scenario: Stats directory empty

- **WHEN** the Visualization page mounts and `Population/Stats/` exists but contains no eligible `.tsv` files, including a directory containing only `QC_RMS.tsv`
- **THEN** the page SHALL show the same yellow alert: "No statistics files found in Population/Stats."

#### Scenario: Stats directory with TSVs

- **WHEN** the Visualization page mounts and `Population/Stats/` contains one or more eligible `.tsv` files
- **THEN** the page SHALL proceed to the setup stepper with the file list available for selection

#### Scenario: Window focus triggers rescan

- **WHEN** the Tauri window regains focus while the Visualization page is mounted
- **THEN** the Stats directory scan SHALL re-run to detect external file changes

### Requirement: Visualization Navbar Entry

The navbar SHALL include a "Visualization" entry with `IconChartScatter` icon. The entry SHALL be enabled when `canAccessPhase(project, "visualization")` returns true and neither import nor processing navigation guards are active. It SHALL be disabled when phase access is denied, import is active, or processing is preparing, running, finalizing, or cancelling.

#### Scenario: Navbar entry enabled after Population completion

- **WHEN** `uiState.processing.population.completed` is `true` and import/processing navigation guards are inactive
- **THEN** the "Visualization" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled before Population completion

- **WHEN** the saved current phase precedes visualization and `uiState.processing.population.completed` is `undefined` or `false`
- **THEN** the "Visualization" navbar entry SHALL be disabled and non-clickable

#### Scenario: Collapsed navbar shows icon only

- **WHEN** the navbar is collapsed and the Visualization entry is enabled
- **THEN** the `IconChartScatter` icon SHALL be visible with an accessible label "Visualization"

### Requirement: Setup Stepper Orchestration

Visualization setup SHALL conditionally include non-identifier level ordering, persist and resume its stage, and validate saved source/join setup through cache-populating native loaders with the existing external fallback policy.

#### Scenario: Visualization initializes or resumes saved setup

- **WHEN** inspection types and saved source/join configuration determine the workflow
- **THEN** steps, persisted stage, loader selection, and active cache SHALL follow these rules:

The Visualization page SHALL render a Mantine Stepper with fine-grained conditional steps: "Select Data", "Column Types", "Level Ordering" (conditional), and "Visualize". The Level Ordering step SHALL appear only when at least one non-identifier inspection column has a saved type of ordinal or nominal; categorical identifiers alone SHALL NOT create the step. Stepper state SHALL persist in `uiState.dataVis.stage` using `"selectData"` for the first step. On re-entry with a valid contract, the stepper SHALL resume at the persisted stage. Mount-time validation with a saved qCBF source SHALL branch on `joinConfig` presence: if null, it SHALL call `load_qcbf_data`; if active, it SHALL attempt `execute_join`, with unavailable/changed external-source fallback and saved-state preservation as defined in `data-vis-contract`. Both successful data-loading commands SHALL populate `AppState.active_data`.

#### Scenario: Full stepper with categorical columns

- **WHEN** the selected data contains at least one non-identifier column whose saved type is ordinal or nominal
- **THEN** the stepper SHALL show 4 steps: Select Data, Column Types, Level Ordering, Visualize

#### Scenario: Stepper skips Level Ordering when no categorical columns

- **WHEN** all non-identifier columns are continuous or excluded, even if identifier columns remain categorical
- **THEN** the stepper SHALL show 3 steps: Select Data, Column Types, Visualize (Level Ordering skipped)

#### Scenario: Resume at persisted stage on re-entry

- **WHEN** the user returns to the Visualization page with a valid contract (hash matches) and `uiState.dataVis.stage` is `"visualize"`
- **THEN** the stepper SHALL render at the "Visualize" step

#### Scenario: Resume at setup when contract invalidated

- **WHEN** the user returns to the Visualization page but the qCBF content hash does not match
- **THEN** the stepper SHALL reset to step 1 ("Select Data") with a banner: "Data file has changed. Please reconfigure."

#### Scenario: Select Data readiness uses inspection and external availability

- **WHEN** the stepper is at Select Data
- **THEN** Next SHALL be disabled if inspection is absent or a configured external source is not available; empty/incomplete key pairs and zero overlap SHALL NOT independently disable it

#### Scenario: Next button disabled when all columns excluded

- **WHEN** the stepper is at "Column Types" and all columns are typed as `"excluded"`
- **THEN** the "Next" button SHALL be disabled with message: "All columns excluded. Include at least one to proceed."

#### Scenario: Back navigation preserves contract

- **WHEN** the user clicks "Back" from the Visualize step to the Column Types or Level Ordering step
- **THEN** the contract (column types, level orderings, axis assignment) SHALL be preserved and editable

#### Scenario: Changing TSV file via back navigation invalidates contract

- **WHEN** the user goes back to "Select Data" and selects a different TSV file
- **THEN** the existing contract (column types, level orderings, axis assignment, stage, joinConfig) SHALL be invalidated and type inference SHALL re-run for the new file

#### Scenario: Changing types or levels via back navigation updates contract without invalidation

- **WHEN** the user goes back to "Column Types" or "Level Ordering" and modifies a column type or reorders levels
- **THEN** the contract SHALL be updated in place without invalidating other contract fields

#### Scenario: Mount-time validation with join active

- **WHEN** the page mounts with `joinConfig` active and both file hashes match
- **THEN** `execute_join` SHALL be called, `active_data` SHALL be populated with merged data, and the stepper SHALL resume at the persisted stage

#### Scenario: Mount-time validation without join

- **WHEN** the page mounts with `joinConfig` as `null` and the qCBF hash matches
- **THEN** `load_qcbf_data` SHALL be called, `active_data` SHALL be populated with qCBF-only data, and the stepper SHALL resume at the persisted stage

### Requirement: Visualization configuration and transient state

Visualization SHALL read accepted settings from the shared project configuration and submit valid setting changes through project-wide autosave. Settings SHALL include source contract, column types, level orderings, axes, domain filters, stage, expanded filters, and supported chart/viewer preferences. Chart data, selected point, live viewer objects, and WebGL availability SHALL remain transient. Page mount/unmount SHALL not create or destroy a configuration save owner.

#### Scenario: Visualization page mounts

- **WHEN** Visualization opens with saved current settings
- **THEN** its controls SHALL show those settings without copying them into an independently editable persisted store

#### Scenario: Persisted setting changes

- **WHEN** a valid axis or chart preference changes
- **THEN** shared autosave SHALL persist it after two seconds without another accepted edit

#### Scenario: Ephemeral state changes

- **WHEN** point selection, loaded data, or live viewer state changes
- **THEN** no configuration write SHALL be scheduled solely for that transient change
