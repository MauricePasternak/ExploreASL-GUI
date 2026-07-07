# bids-direct-import Specification

## Purpose
TBD - created by archiving change direct-bids-import. Update Purpose after archive.
## Requirements
### Requirement: Project data source is binary and immutable

A project SHALL declare its data source at creation via `projectMeta.dataSource: "dicom" | "bids"`. The field is required (no default) and immutable for project lifetime. No runtime guard enforces immutability — JSDoc documents the constraint and callers MUST NOT mutate post-creation.

#### Scenario: New project defaults to no hidden fallback

- **WHEN** `createProject()` is called without a `dataSource` parameter
- **THEN** the call throws a validation error (no implicit `"dicom"` default)

#### Scenario: DICOM project creates with explicit choice

- **WHEN** user selects a folder without BIDS ASL data and confirms DICOM import at the landing dialog
- **THEN** `createProject()` sets `projectMeta.dataSource = "dicom"`, `currentPhase = "import"`

#### Scenario: BIDS project creates with explicit choice

- **WHEN** user selects a BIDS-direct folder and confirms "Skip Import" at the landing detection dialog
- **THEN** `createProject()` sets `projectMeta.dataSource = "bids"`, `currentPhase = "import"`

#### Scenario: Both paths land on Import phase

- **WHEN** either DICOM or BIDS project is created
- **THEN** `currentPhase` is set to `"import"` unconditionally so ImportPage renders the appropriate flow

### Requirement: Processing gate dispatches on dataSource

`canAccessPhase(targetPhase: "processing")` SHALL dispatch on `projectMeta.dataSource`:

- `dataSource === "bids"` → return `project.uiState?.import?.bidsReviewConfirmed === true`
- `dataSource === "dicom"` → return `project.uiState?.import?.completed === true`

Other phase gates (parameters, visualization, manifest) remain unchanged.

#### Scenario: BIDS project reaches processing only after review confirmation

- **WHEN** user navigates a BIDS-direct project to processing before completing BIDS review confirmation
- **THEN** `canAccessPhase("processing")` returns `false` and the navigation is blocked

#### Scenario: BIDS project reaches processing after confirmation

- **WHEN** user confirms BIDS review (`bidsReviewConfirmed = true`)
- **THEN** `canAccessPhase("processing")` returns `true`

#### Scenario: DICOM project keeps existing gate

- **WHEN** user navigates a DICOM project to processing
- **THEN** `canAccessPhase("processing")` returns `project.uiState?.import?.completed === true` (unchanged behavior)

### Requirement: BIDS review confirmation advances currentPhase

When the user confirms BIDS review in `BIDSReviewPanel`, the store MUST set `project.uiState.import.bidsReviewConfirmed = true` and advance `project.projectMeta.currentPhase` to `"parameters"`, then navigate to `/project/:id/parameters`.

#### Scenario: BIDS review confirm advances phase

- **WHEN** user clicks `[Confirm]` in `BIDSReviewPanel` with valid (non-empty, non-duplicate) group labels
- **THEN** `uiState.import.bidsReviewConfirmed` is `true`, `currentPhase` is `"parameters"`, navigation goes to Parameters page

#### Scenario: BIDS review confirm blocked on invalid labels

- **WHEN** user clicks `[Confirm]` while any group label is empty or duplicates another group's label (case-insensitive)
- **THEN** confirmation is blocked with inline errors per offending group; `bidsReviewConfirmed` stays `false`; `currentPhase` stays `"import"`

### Requirement: mappingState populated from BIDS review on confirm

When Bilder review is confirmed, the store MUST write to `mappingState`:

- `metadataGroups`: derived from `BidsReviewState.detectedGroups` projected down to `MetadataGroup` (pick `id`, `label`, `bidsParams` of each)
- `subjectRows`: flattened from `detectedGroups[].subjects[]` into `SubjectRow` entries with `id` = `"sub-{subjectLabel}_{sessionLabel}"`, `subject` = `"sub-{subjectLabel}"`, `session` = `{sessionLabel}`, `groupId` = group's `id`
- `ingestionComplete = true`
- `sourceDataPath = rootPath`

Other `mappingState` fields (`rawPaths`, `pathPatterns`, `bMatchDirectories`, `tokenizerConfigs`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`) are NOT populated by `confirmBidsReview()` — they are left at zod schema defaults (`.catch([])` / `.catch({})` / `.catch(false)`). These fields are DICOM-wizard-specific and do not naturally map to BIDS structure; consumers reading them are wizard-only utilities (`importStepAccess`, `importStaleness`, `importPreviewUtils`) never invoked on the BIDS-direct path.

#### Scenario: mappingState fully populated after confirm

- **WHEN** user confirms BIDS review for a 25-subject dataset with 2 detected groups (10 subjects in G1, 15 subjects in G2, 1 skipped)
- **THEN** `mappingState.metadataGroups.length = 2`, `subjectRows.length = 24` (skipped subject excluded), `ingestionComplete = true`

### Requirement: Skipped subjects persisted to ImportUiState

`ImportUiStateSchema` SHALL add required `skippedSubjects: string[]` field (default `[]`). On BIDS review confirm, `skippedSubjects` is populated with subject/session entries that were skipped during sidecar scanning (missing `*_asl.json` or missing/unparseable `*_aslcontext.tsv`). Format follows the session convention: `"sub-{subjectLabel}_{sessionLabel}"` where cross-sectional defaults to `"1"` (not `"01"`) and explicit `ses-XX` preserves the label after stripping the `ses-` prefix.

#### Scenario: Skipped subjects visible on revisit

- **WHEN** user closes app after confirming BIDS review with one skipped subject, reopens the project, navigates to Import
- **THEN** the persisted summary renders the skipped-subjects warning block listing the persisted subject identifier (e.g., `sub-UNK001_1`)

