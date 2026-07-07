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

### Requirement: createProject accepts dataSource

`createProject(path, name, options)` SHALL accept `options.dataSource: "dicom" | "bids"` (required — no default). The function MUST NOT silently default `dataSource` to `"dicom"` if the parameter is omitted; a missing `dataSource` SHALL throw a validation error.

`createProject` SHALL set `projectMeta.dataSource` from this parameter. `projectMeta.currentPhase` SHALL be set to `"import"` regardless of `dataSource` (both paths land on Import page; both advance to Parameters on completion).

`projectMeta.dataSource` is immutable after `createProject` returns. No runtime guard enforces immutability — JSDoc documents the constraint and callers MUST NOT mutate post-creation. One unit test verifies `createProject` sets the value and downstream update paths do not change it.

#### Scenario: DICOM project creation

- **WHEN** `createProject(path, name, { dataSource: "dicom" })` is called
- **THEN** `projectMeta.dataSource = "dicom"`, `projectMeta.currentPhase = "import"`, `uiState.import.completed = false`, `uiState.import.bidsReviewConfirmed = false`

#### Scenario: BIDS project creation

- **WHEN** `createProject(path, name, { dataSource: "bids" })` is called
- **THEN** `projectMeta.dataSource = "bids"`, `projectMeta.currentPhase = "import"`, `uiState.import.bidsReviewConfirmed = false`

#### Scenario: Missing dataSource throws

- **WHEN** `createProject(path, name, {})` is called (no `dataSource`)
- **THEN** the call throws a validation error; no project is created

#### Scenario: Immutability test

- **WHEN** `createProject(path, name, { dataSource: "bids" })` returns and subsequent `updateProjectMeta({ dataSource: "dicom" })` is attempted
- **THEN** the test verifies either the call returns without mutation OR the test documents that callers are trusted not to make this call (per the trust-callers + JSDoc contract)

### Requirement: BIDS review confirm writes to mappingState

When BIDS review confirms, the store action `confirmBidsReview()` SHALL:
1. Project `importStore.BidsReviewState.detectedGroups` down to `MetadataGroup[]` (pick `id`, `label`, `bidsParams` per group).
2. Flatten `detectedGroups[].subjects[]` into `SubjectRow[]` entries. For each `(subjectLabel, sessionLabel)` pair in a group:
   - Strip the `sub-` prefix from `subjectLabel` for the `subject` field (e.g. `"sub-01"` → `"01"`).
   - `session = sessionLabel` (e.g. `"1"` for cross-sectional default, `"01"` for explicit `ses-01`).
   - `id = "sub-{strippedSubject}_{sessionLabel}"` (e.g. `"sub-01_1"`), matching `list_subjects` / `SubjectInfo.subject_session`.
   - `groupId = group.id`.
   - Merge duplicate `GroupSubject` entries by subject before flattening (one `SubjectRow` per subject/session pair).
3. Write to `project.mappingState` ONLY these 4 fields:
   - `metadataGroups` = projected `MetadataGroup[]`
   - `subjectRows` = flattened `SubjectRow[]`
   - `ingestionComplete = true`
   - `sourceDataPath = rootPath`
   Other `mappingState` fields (`rawPaths`, `pathPatterns`, `bMatchDirectories`, `tokenizerConfigs`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`) are left at zod schema defaults (`.catch([])` / `.catch({})`). These are DICOM-wizard-specific; BIDS-direct consumers do not read them.
4. Copy `BidsReviewState.skippedSubjects` to `project.uiState.import.skippedSubjects` (persists).
5. Set `project.uiState.import.bidsReviewConfirmed = true` (persists).
6. Set `project.projectMeta.currentPhase = "parameters"`.
7. Save `project.easl`.
8. Navigate to `/project/:id/parameters`.

#### Scenario: BIDS confirm populates mappingState and persists uiState

- **WHEN** `confirmBidsReview()` is called for a 25-subject dataset with 2 detected groups and 1 skipped subject
- **THEN** `mappingState.metadataGroups.length = 2`, `mappingState.subjectRows.length = 24`, `mappingState.ingestionComplete = true`, `uiState.import.skippedSubjects = ["sub-UNK001_1"]`, `uiState.import.bidsReviewConfirmed = true`, `projectMeta.currentPhase = "parameters"`, project file is saved, navigation goes to Parameters page

