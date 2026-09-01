## ADDED Requirements

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
