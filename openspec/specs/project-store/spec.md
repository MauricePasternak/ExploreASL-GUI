# project-store Specification

## Purpose

TBD - created by archiving change processing-module. Update Purpose after archive.

## Requirements

### Requirement: Processing Config Persistence

The project store SHALL persist `processingConfig` and `processingPhase` in the `.easl` project file under `uiState`. The `ProjectFileSchema` SHALL be extended with optional `processingConfig` and `processingPhase` fields. When saving, the project store SHALL sync the processing store's config and phase into the project file. The `ProjectFileSchema.uiState` SHALL also include an optional `population` object with a `completed` boolean flag, an optional `dataVis` object for visualization contract persistence, and an optional `manifest` object holding `verdicts: Record<string, { status: "pass" | "fail"; setAt: number }>`, `lastRunVersions: { exploreASL?: string; matlab?: string; gui?: string }`, and `lastPopulationRunMtime: number | null`. Every field within `uiState.manifest` SHALL be `.optional()` so legacy `.easl` files without the slot parse via Zod without manual migration. The `PROJECT_PHASES` array SHALL be `["import", "parameters", "processing", "visualization", "manifest"]`. The `canAccessPhase` function SHALL return `true` for `"visualization"` when `uiState.population?.completed === true` and shall return `true` for `"manifest"` under the same condition, identical gate to visualization.

#### Scenario: Config saved on processing start

- **WHEN** the user clicks Start on the processing page
- **THEN** the current `ProcessConfig` and `processingPhase` SHALL be written to `uiState.processingConfig` and `uiState.importPhase` in the `.easl` file

#### Scenario: Config restored on project load

- **WHEN** a project with a prior processing run is opened
- **THEN** the processing store SHALL be hydrated from `uiState.processingConfig` and the subject selection form SHALL be pre-filled

#### Scenario: Visualization phase gate

- **WHEN** `canAccessPhase` is called with `targetPhase = "visualization"`
- **THEN** it SHALL return `true` if `project.uiState?.population?.completed === true`, otherwise `false`

#### Scenario: Manifest phase gate

- **WHEN** `canAccessPhase` is called with `targetPhase = "manifest"`
- **THEN** it SHALL return `true` if `project.uiState?.population?.completed === true`, otherwise `false`

#### Scenario: PROJECT_PHASES includes manifest

- **WHEN** `PROJECT_PHASES` is referenced
- **THEN** it SHALL be the tuple `["import", "parameters", "processing", "visualization", "manifest"]`

#### Scenario: Legacy project without manifest slot parses

- **WHEN** a `.easl` file from before this change (no `uiState.manifest` key) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and `project.uiState.manifest` SHALL be `undefined` on the parsed value

### Requirement: Population Completion Persistence

The project store SHALL provide a `setPopulationCompleted(value: boolean)` action that sets `uiState.processing.population.completed` and persists the change to the `.easl` project file. The `population` object in `uiState.processing` SHALL be optional with a `completed: boolean` field and a `lastRun` metadata object.

#### Scenario: Flag set to true

- **WHEN** `setPopulationCompleted(true)` is called
- **THEN** `uiState.processing.population.completed` SHALL be set to `true` in the project store and persisted to the `.easl` file

#### Scenario: Flag cleared to false

- **WHEN** `setPopulationCompleted(false)` is called
- **THEN** `uiState.processing.population.completed` SHALL be set to `false` and persisted

### Requirement: DataVis Contract Persistence

The project store SHALL sync `uiState.dataVis` from the `visualizationStore` via the `useVisualizationSync` hook. The `dataVis` object in `uiState` SHALL be optional and include: `contractSources` (array), `columnTypes` (record), `identifiers` (object), `levelOrderings` (record), `axisAssignment` (object), `domainFilters` (object), `stage` (string), and `filtersExpanded` (boolean). The schema SHALL use `.passthrough()` to allow future field additions without schema changes.

#### Scenario: DataVis contract saved

- **WHEN** the visualization store's persisted fields change
- **THEN** `uiState.dataVis` SHALL be updated in the project store with a debounced save to the `.easl` file

#### Scenario: DataVis contract restored

- **WHEN** a project with a prior visualization contract is opened
- **THEN** the `visualizationStore` SHALL be hydrated from `uiState.dataVis`
