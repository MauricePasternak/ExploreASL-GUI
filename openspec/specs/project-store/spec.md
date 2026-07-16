# project-store Specification

## Purpose

TBD - created by archiving change processing-module. Update Purpose after archive.

## Requirements

### Requirement: Processing Config Persistence

The project store SHALL persist `processingConfig` and `processingPhase` in the `.easl` project file under `uiState.processing.config` and `uiState.processing.currentPhase`. The `ProjectFileSchema` SHALL extend the persisted `uiState.processing.config` shape to use `selectedProfileId: z.string().optional()` instead of `matlabPath: z.string()` and `exploreAslPath: z.string()`. The `ProjectFileSchema` SHALL also add `uiState.import.selectedProfileId: z.string().optional()` for persisting the import phase's profile selection. When syncing via `syncProcessingState`, the store SHALL spread the existing `uiState.processing` object to preserve sibling fields (`structural`, `asl`, `population` last-run metadata) that are managed by other parts of the processing lifecycle (e.g. `setLastRunProfileId`, `setPopulationCompleted`). The `ProjectFileSchema.uiState` SHALL also include an optional `population` object with a `completed` boolean flag and a `lastRun` object containing `profileId`, `exploreASLVersion`, `matlabVersion`, `guiVersion`, and `Mtime`. It SHALL also include optional `structural` and `asl` objects with the same `lastRun` shape (profileId + version fields), despite no module implementations yet. It SHALL also include an optional `dataVis` object for visualization contract persistence, and an optional `manifest` object holding `verdicts: Record<string, { status: "pass" | "fail"; setAt: number }>`. Every field within `uiState.manifest` SHALL be `.optional()` so legacy `.easl` files without the slot parse via Zod without manual migration. The `PROJECT_PHASES` array SHALL be `["import", "parameters", "processing", "visualization", "manifest"]`. The `canAccessPhase` function SHALL return `true` for `"visualization"` when `uiState.processing?.population?.completed === true` and shall return `true` for `"manifest"` under the same condition, identical gate to visualization.

#### Scenario: Config saved on processing start

- **WHEN** the user clicks Start on the processing page
- **THEN** the current `ProcessConfig` (with `selectedProfileId`) and `processingPhase` SHALL be written to `uiState.processing.config` and `uiState.processing.currentPhase` in the `.easl` file

#### Scenario: Config restored on project load

- **WHEN** a project with a prior processing run is opened
- **THEN** the processing store SHALL be hydrated from `uiState.processing.config` and the subject selection form SHALL be pre-filled

#### Scenario: New project format with selectedProfileId

- **WHEN** a `.easl` file contains `uiState.processing.config.selectedProfileId: "abc-123"`
- **THEN** the project loads with the processing config's profile selector set to profile "abc-123"

#### Scenario: Import selectedProfileId persisted

- **WHEN** a `.easl` file contains `uiState.import.selectedProfileId: "abc-123"`
- **THEN** the import store's profile selector is initialized to "abc-123"

#### Scenario: New project with no processing config

- **WHEN** a new `.easl` file has no `uiState.processing.config` (default state)
- **THEN** the project loads normally; processing config is created lazily on first visit to the processing page

#### Scenario: syncProcessingState preserves sibling processing fields

- **WHEN** `syncProcessingState({ config, processingPhase: "running" })` is called and `uiState.processing.population` already holds `{ completed: true, lastRun: { profileId: "p1", exploreASLVersion: "1.0.0" } }`
- **THEN** after the sync, `uiState.processing.population.completed` SHALL remain `true` and `uiState.processing.population.lastRun` SHALL retain its prior profileId and version values

#### Scenario: Visualization phase gate

- **WHEN** `canAccessPhase` is called with `targetPhase = "visualization"`
- **THEN** it SHALL return `true` if `project.uiState?.processing?.population?.completed === true`, otherwise `false`

#### Scenario: Manifest phase gate

- **WHEN** `canAccessPhase` is called with `targetPhase = "manifest"`
- **THEN** it SHALL return `true` if `project.uiState?.processing?.population?.completed === true`, otherwise `false`

#### Scenario: PROJECT_PHASES includes manifest

- **WHEN** `PROJECT_PHASES` is referenced
- **THEN** it SHALL be the tuple `["import", "parameters", "processing", "visualization", "manifest"]`

#### Scenario: Legacy project without manifest slot parses

- **WHEN** a `.easl` file from before this change (no `uiState.manifest` key) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, and `project.uiState.manifest` SHALL be `undefined` on the parsed value

### Requirement: Module Last Run — profileId reference

The `ProjectFileSchema` SHALL add `profileId: z.string()` alongside the existing `exploreASLVersion: z.string().optional()` and `matlabVersion: z.string().optional()` in `population.lastRun`. The `guiVersion: z.string().optional()` and `Mtime: z.number().int().nullable().optional()` fields SHALL remain unchanged. Both `profileId` (which profile was used) and version strings (actual versions on disk at runtime) are preserved — neither alone is sufficient for reproduction.

The schema SHALL also include `structural` and `asl` lastRun shapes with the same pattern (profileId + all version fields), despite no module implementations yet:

```typescript
lastRun: z.object({
  profileId: z.string(),
  exploreASLVersion: z.string().optional(),
  matlabVersion: z.string().optional(),
  guiVersion: z.string().optional(),
  Mtime: z.number().int().nullable().optional(),
}).optional();
```

The `profileId` SHALL reference an `ExecutionProfile.id` from the global store. At display time, the profile is resolved to show `profile.label`, and the stored version strings provide an accurate historical record of what was on disk when the pipeline ran. If the profile was deleted, a "(Profile deleted)" indicator is shown with the raw `profileId` for reference.

The `setLastRunVersions` store action SHALL be replaced by `setLastRunProfileId(module: "population" | "structural" | "asl", profileId: string, versions: { exploreASLVersion?: string, matlabVersion?: string, guiVersion?: string })`. The `setLastPopulationRunMtime` action SHALL remain unchanged (population-specific, uses Mtime for completion detection).

#### Scenario: Population lastRun with profileId

- **WHEN** a `.easl` file contains `uiState.processing.population.lastRun.profileId: "abc-123"`
- **THEN** the last run record resolves profile "abc-123" from global store for display (label, version, paths)

#### Scenario: Population lastRun with deleted profile

- **WHEN** `lastRun.profileId` references a profile that no longer exists
- **THEN** the UI shows "(Profile deleted)" alongside the raw profile ID

#### Scenario: Structural lastRun with profileId

- **WHEN** a `.easl` file contains `uiState.processing.structural.lastRun.profileId: "abc-123"`
- **THEN** the structural lastRun is parsed and the profile reference is resolved for display

---

### Requirement: Project gating on valid profiles

The project store's `createProject` and `loadProject` actions SHALL check that at least one valid execution profile exists before proceeding. Validity SHALL be determined from the global store's `profileValidationState`.

If no valid profiles exist:

- `createProject` SHALL throw an error / show a notification directing the user to Settings.
- `loadProject` SHALL throw an error / show a notification directing the user to Settings.
- The landing page SHALL disable the "New Project" and "Open Project" buttons and recent project links.
- A prominent message SHALL be shown (see first-run onboarding or project gating requirements in execution-profiles spec).

#### Scenario: Create project with valid profile available

- **WHEN** `createProject` is called and at least one valid profile exists
- **THEN** the project is created normally

#### Scenario: Create project with no valid profiles

- **WHEN** `createProject` is called and no valid profiles exist
- **THEN** project creation is blocked and an error message is shown

#### Scenario: Open project with no valid profiles

- **WHEN** `loadProject` is called and no valid profiles exist
- **THEN** project loading is blocked and an error message is shown

#### Scenario: Landing page buttons disabled

- **WHEN** the landing page renders and no valid profiles exist
- **THEN** "New Project", "Open Project" buttons and recent project links SHALL be disabled with a tooltip explaining why

#### Scenario: Landing page buttons enabled

- **WHEN** the landing page renders and at least one valid profile exists
- **THEN** all project action buttons SHALL be enabled

---

### Requirement: Default profile for new projects

When a new project is created, the Import phase SHALL initialize `selectedProfileId` to the first valid profile in `executionProfiles` (using `profileValidationState` to determine validity) in the `createProject` action. The Processing phase's `selectedProfileId` SHALL be set lazily when the processing page is first visited, matching the existing pattern where `uiState.processing` is created on demand.

#### Scenario: New project defaults import to first valid profile

- **WHEN** a new project is created and `executionProfiles[0]` is valid
- **THEN** `uiState.import.selectedProfileId` SHALL be set to `executionProfiles[0].id`

#### Scenario: First profile invalid, second valid

- **WHEN** a new project is created and `executionProfiles[0]` is invalid but `executionProfiles[1]` is valid
- **THEN** `uiState.import.selectedProfileId` SHALL be set to `executionProfiles[1].id`

---

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

---

### Requirement: Project Dialog Default Directory Paths

The "New Project" and "Open Project" dialogs on the landing page SHALL use the following logic to determine their initial opening directory (`defaultPath`):

1. **Priority**: Open in the most recent location:
   - For "New Project" (directory dialog): use the parent directory containing the most recent project file (`settings.recentProjects[0]`), if it exists on disk.
   - For "Open Project" (file dialog): use the path of the most recent project file (`settings.recentProjects[0]`) if it exists on disk, or fall back to its parent directory if it exists on disk.
2. **Fallback**: Open in the user's OS home directory (`$HOME`).

#### Scenario: Open pickers with no recent projects

- **WHEN** `recentProjects` is empty
- **THEN** the New Project and Open Project dialogs SHALL be initialized with the user's OS home directory as the `defaultPath`

#### Scenario: Open pickers with a valid recent project

- **WHEN** `recentProjects` contains a valid project file path (e.g. `/tmp/brain-study/project.easl`)
- **THEN** the New Project directory dialog SHALL use `/tmp/brain-study` as `defaultPath`, and the Open Project file dialog SHALL use `/tmp/brain-study/project.easl` as `defaultPath`
