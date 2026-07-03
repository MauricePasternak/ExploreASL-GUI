# visualization-phase Specification

## Purpose

Orchestrate the user interface and store sync for the population analysis visualization phase of the project.

## Requirements

### Requirement: Visualization Project Phase

The project phase system SHALL include `visualization` as the fourth phase after `processing`. The route `/project/:id/visualization` SHALL render the Visualization page. The `PROJECT_PHASES` array SHALL be `["import", "parameters", "processing", "visualization"]`. The project's `currentPhase` SHALL update to `"visualization"` when the user navigates to the route, following the same pattern as other phases.

#### Scenario: Route renders visualization page

- **WHEN** the user navigates to `/project/:id/visualization` and `canAccessPhase` returns true
- **THEN** the Visualization page SHALL render with the setup stepper

#### Scenario: Current phase updates on navigation

- **WHEN** the user navigates to `/project/:id/visualization` and the project's `currentPhase` is not `"visualization"`
- **THEN** `setPhase("visualization")` SHALL be called and the project SHALL be saved

#### Scenario: Invalid phase redirects to current phase

- **WHEN** the user navigates to `/project/:id/visualization` but `canAccessPhase` returns false
- **THEN** the user SHALL be redirected to `/project/:id/{currentPhase}`

### Requirement: Visualization Phase Gate

Access to the visualization phase SHALL be gated by `uiState.processing.population?.completed === true`. The `canAccessPhase` function SHALL return true for `"visualization"` only when this flag is set. The flag is a static persisted value — it SHALL NOT re-verify the filesystem on every route change.

#### Scenario: Access granted after Population completion

- **WHEN** `uiState.processing.population.completed` is `true` and the user navigates to visualization
- **THEN** `canAccessPhase` SHALL return true and the page SHALL render

#### Scenario: Access denied without Population completion

- **WHEN** `uiState.processing.population.completed` is `undefined` or `false`
- **THEN** `canAccessPhase` SHALL return false for `"visualization"` and the user SHALL be redirected to the current phase

#### Scenario: Access denied when Population flag missing

- **WHEN** `uiState.processing.population` is entirely absent from the project file
- **THEN** `canAccessPhase` SHALL return false for `"visualization"`

### Requirement: Population Completion Flag

The `processingStore` SHALL set `uiState.processing.population.completed = true` via a `setPopulationCompleted(true)` action on the project store when `processingPhase` transitions to `"completed"` AND the processing config's `modules` includes `"population"`. The flag SHALL be persisted to the `.easl` project file. The `processingStore` SHALL clear the flag (`setPopulationCompleted(false)`) when `startProcessing` is called with Population module selected (re-run scenario).

#### Scenario: Flag set on Population completion

- **WHEN** all workers exit, `read_lock_status` confirms all subjects complete, and `config.modules` includes `"population"`
- **THEN** `uiState.processing.population.completed` SHALL be set to `true` and persisted to the `.easl` file

#### Scenario: Flag not set when Population not selected

- **WHEN** all workers exit successfully but `config.modules` does not include `"population"`
- **THEN** `uiState.processing.population.completed` SHALL NOT be set

#### Scenario: Flag cleared on Population re-run

- **WHEN** the user starts processing with `config.modules` including `"population"` and `uiState.processing.population.completed` is currently `true`
- **THEN** `uiState.processing.population.completed` SHALL be cleared to `false` before workers are spawned

#### Scenario: Flag not cleared on non-Population re-run

- **WHEN** the user starts processing with `config.modules` not including `"population"`
- **THEN** `uiState.processing.population.completed` SHALL NOT be cleared

### Requirement: Stats Directory Runtime Scan

The Visualization page SHALL perform a filesystem scan of the Stats directory on mount and on Tauri window focus event. The scan SHALL check for the existence of `<root>/derivatives/ExploreASL/Population/Stats/` and enumerate `.tsv` files within it. Three degradation states SHALL be handled: directory missing, directory present but empty, and partial TSV deletion.

#### Scenario: Stats directory missing

- **WHEN** the Visualization page mounts and `Population/Stats/` does not exist
- **THEN** the page SHALL show an empty state: "Population Stats not found. Population may have been modified externally." with a button to return to the Processing page

#### Scenario: Stats directory empty

- **WHEN** the Visualization page mounts and `Population/Stats/` exists but contains no `.tsv` files
- **THEN** the page SHALL show an empty state: "No statistics files found in Population/Stats."

#### Scenario: Stats directory with TSVs

- **WHEN** the Visualization page mounts and `Population/Stats/` contains one or more `.tsv` files
- **THEN** the page SHALL proceed to the setup stepper with the file list available for selection

#### Scenario: Window focus triggers rescan

- **WHEN** the Tauri window regains focus while the Visualization page is mounted
- **THEN** the Stats directory scan SHALL re-run to detect external file changes

### Requirement: Visualization Navbar Entry

The navbar SHALL include a "Visualization" entry with `IconChartScatter` icon. The entry SHALL be enabled when `canAccessPhase(project, "visualization")` returns true. The entry SHALL be disabled (greyed out, non-clickable) when the phase gate returns false.

#### Scenario: Navbar entry enabled after Population completion

- **WHEN** `uiState.processing.population.completed` is `true`
- **THEN** the "Visualization" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled before Population completion

- **WHEN** `uiState.processing.population.completed` is `undefined` or `false`
- **THEN** the "Visualization" navbar entry SHALL be disabled and non-clickable

#### Scenario: Collapsed navbar shows icon only

- **WHEN** the navbar is collapsed and the Visualization entry is enabled
- **THEN** the `IconChartScatter` icon SHALL be visible with an accessible label "Visualization"

### Requirement: Visualization Store and Sync Hook

A `visualizationStore` SHALL be created as a Zustand store, mirroring the `processingStore` pattern. A `useVisualizationSync` hook SHALL hydrate the store from `uiState.dataVis` on mount and subscribe to store changes with debounced saves of persisted fields to the project store. Ephemeral fields (chart data, selected point, viewer state) SHALL NOT be persisted. The persisted shape SHALL use `qcbfSource` (singular, replaces former `contractSources` array) and `joinConfig` (join configuration or `null`).

#### Scenario: Store hydrates on page mount

- **WHEN** the Visualization page mounts and `uiState.dataVis` exists in the project file
- **THEN** the `visualizationStore` SHALL be hydrated with persisted values (qcbfSource, joinConfig, column types, level orderings, axis assignment, domain filters, stage, filters expanded)

#### Scenario: Persisted fields sync to project store

- **WHEN** any persisted field in `visualizationStore` changes
- **THEN** the change SHALL be synced to `uiState.dataVis` in the project store with a debounced save (2 second delay)

#### Scenario: Ephemeral fields not persisted

- **WHEN** ephemeral fields (chart data, selected point, viewer state, WebGL availability) change
- **THEN** these changes SHALL NOT trigger a project store save

### Requirement: Setup Stepper Orchestration

The Visualization page SHALL render a Mantine Stepper with fine-grained conditional steps: "Select Data" (renamed from "Select File"), "Column Types", "Level Ordering" (conditional), and "Visualize". The "Level Ordering" step SHALL be skipped when no ordinal or nominal columns exist. The stepper state SHALL persist in `uiState.dataVis.stage` using the value `"selectData"` (renamed from `"selectFile"`). On re-entry with a valid contract, the stepper SHALL resume at the persisted stage. The mount-time validation SHALL branch on `joinConfig` presence: if `joinConfig` is `null`, `load_qcbf_data` SHALL be called; if `joinConfig` is active, `execute_join` SHALL be called. Both commands populate `AppState.active_data`.

#### Scenario: Full stepper with categorical columns

- **WHEN** the selected data contains ordinal or nominal columns
- **THEN** the stepper SHALL show 4 steps: Select Data, Column Types, Level Ordering, Visualize

#### Scenario: Stepper skips Level Ordering when no categorical columns

- **WHEN** all columns in the selected data are continuous
- **THEN** the stepper SHALL show 3 steps: Select Data, Column Types, Visualize (Level Ordering skipped)

#### Scenario: Resume at persisted stage on re-entry

- **WHEN** the user returns to the Visualization page with a valid contract (hash matches) and `uiState.dataVis.stage` is `"visualize"`
- **THEN** the stepper SHALL render at the "Visualize" step

#### Scenario: Resume at setup when contract invalidated

- **WHEN** the user returns to the Visualization page but the contract hash does not match
- **THEN** the stepper SHALL reset to step 1 ("Select Data") with a banner: "Data file has changed. Please reconfigure."

#### Scenario: Next button disabled when no file selected

- **WHEN** the stepper is at "Select Data" and no TSV file has been selected
- **THEN** the "Next" button SHALL be disabled

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
