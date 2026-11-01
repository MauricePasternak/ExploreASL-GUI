# bids-direct-import Specification

## Purpose

Define project creation and import behavior for BIDS-direct data sources.

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

- **WHEN** user selects a BIDS-direct folder, chooses "Use existing BIDS images", and selects "Create project" at the landing detection dialog
- **THEN** `createProject()` sets `projectMeta.dataSource = "bids"`, `currentPhase = "import"`

#### Scenario: Both paths land on Import phase

- **WHEN** either DICOM or BIDS project is created
- **THEN** `currentPhase` is set to `"import"` unconditionally so ImportPage renders the appropriate flow

### Requirement: Processing eligibility uses native allowedPhases

`canAccessPhase(project, "processing")` SHALL check membership in the native snapshot's `allowedPhases`, not independently derive eligibility from import flags. Native `allowedPhases` SHALL include Processing when the saved `projectMeta.currentPhase` cursor is Processing, Visualization, or Manifest, even when the applicable import readiness flag is absent or false.

When the current cursor is Import or Parameters, later Processing access SHALL require data-source readiness:

- BIDS-direct: `project.uiState?.import?.bidsReviewConfirmed === true`
- DICOM: `project.uiState?.import?.completed === true`

Cursor-based eligibility SHALL NOT fabricate completion or authorize execution. Active-work navigation guards SHALL remain separate from phase eligibility. Other phase gates (parameters, visualization, manifest) remain unchanged.

#### Scenario: Early-cursor BIDS project requires review confirmation

- **WHEN** a BIDS-direct project's saved current phase is Import or Parameters and BIDS review is unconfirmed
- **THEN** native `allowedPhases` SHALL omit Processing, `canAccessPhase(project, "processing")` SHALL return `false`, and Processing navigation SHALL be denied

#### Scenario: BIDS project reaches processing after confirmation

- **WHEN** BIDS review confirmation succeeds (`bidsReviewConfirmed = true`) and the current phase advances to Parameters
- **THEN** native `allowedPhases` SHALL include Processing and `canAccessPhase(project, "processing")` SHALL return `true`, independently of active-work navigation guards

#### Scenario: Early-cursor DICOM project requires import completion

- **WHEN** a DICOM project's saved current phase is Import or Parameters
- **THEN** native `allowedPhases` SHALL include Processing if and only if `project.uiState?.import?.completed === true`, and `canAccessPhase(project, "processing")` SHALL reflect that membership

#### Scenario: Saved later cursor retains Processing eligibility

- **WHEN** a BIDS-direct or DICOM project's saved current phase is Processing, Visualization, or Manifest, with the applicable import readiness flag absent or false
- **THEN** native `allowedPhases` SHALL still include Processing and `canAccessPhase(project, "processing")` SHALL return `true` without changing readiness flags; active-work navigation guards SHALL remain separate

### Requirement: BIDS review confirmation advances currentPhase

When native BIDS review confirmation succeeds, the store MUST set `project.uiState.import.bidsReviewConfirmed = true` and advance `project.projectMeta.currentPhase` to `"parameters"`, then navigate to `/project/:id/parameters`. Nonempty, unique labels alone do not guarantee acceptance: subject/session group assignments MUST also be conflict-free.

#### Scenario: BIDS review confirm advances phase

- **WHEN** user clicks `[Confirm]` in `BIDSReviewPanel` with valid (non-empty, non-duplicate) group labels, conflict-free subject/session assignments, and successful native persistence
- **THEN** `uiState.import.bidsReviewConfirmed` is `true`, `currentPhase` is `"parameters"`, navigation goes to Parameters page

#### Scenario: BIDS review confirm blocked on invalid labels

- **WHEN** user clicks `[Confirm]` while any group label is empty or duplicates another group's label (case-insensitive)
- **THEN** confirmation is blocked with inline errors per offending group; `bidsReviewConfirmed` stays `false`; `currentPhase` stays `"import"`

### Requirement: mappingState populated from BIDS review on confirm

When BIDS review confirmation succeeds, the store MUST write to `mappingState`:

- `metadataGroups`: derived from `BidsReviewState.detectedGroups` projected down to `MetadataGroup` (pick `id`, `label`, `bidsParams` of each)
- `subjectRows`: one `SubjectRow` per subject/session, flattened from `detectedGroups[].subjects[]` after stripping any `sub-` prefix from the subject label, with `id` = `"sub-{strippedSubject}_{sessionLabel}"`, `subject` = `{strippedSubject}`, `session` = `{sessionLabel}`, and `groupId` = group's `id`. Duplicate memberships with the same row ID and group ID SHALL collapse to one row. The row identity has no run component; assigning that row to different group IDs SHALL reject confirmation rather than create two rows.
- `ingestionComplete = true`
- `sourceDataPath = "."` (project-root-relative BIDS source)

Other `mappingState` fields (`rawPaths`, `pathPatterns`, `bMatchDirectories`, `tokenizerConfigs`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`) are NOT populated by `confirmBidsReview()` — they are left at zod schema defaults (`.catch([])` / `.catch({})` / `.catch(false)`). These fields are DICOM-wizard-specific and do not naturally map to BIDS structure; consumers reading them are wizard-only utilities (`importStepAccess`, `importStaleness`, `importPreviewUtils`) never invoked on the BIDS-direct path.

#### Scenario: mappingState fully populated after confirm

- **WHEN** user successfully confirms BIDS review for a 25-subject, single-session dataset with 2 disjoint detected groups (10 subjects in G1, 14 subjects in G2) and 1 subject excluded by the scan's pre-group checks
- **THEN** `mappingState.metadataGroups.length = 2`, `subjectRows.length = 24` (skipped subject excluded), `ingestionComplete = true`

#### Scenario: Different run fingerprints conflict at confirmation

- **WHEN** scanning returns the same subject/session in two different fingerprint groups and the user confirms both with distinct nonempty labels
- **THEN** native confirmation SHALL reject the conflicting group assignments without changing the accepted project mapping, confirmation flag, or phase; navigation to Parameters SHALL not occur

### Requirement: Skipped subjects persisted to ImportUiState

`ImportUiStateSchema` SHALL add required `skippedSubjects: string[]` field (default `[]`). On successful BIDS review confirmation, `skippedSubjects` SHALL retain the identifiers reported by sidecar scanning, without per-entry reasons; scan skip conditions and limitations are defined in `bids-sidecar-scanning`. Format follows the session convention: `"sub-{subjectLabel}_{sessionLabel}"` where cross-sectional defaults to `"1"` (not `"01"`) and explicit `ses-XX` preserves the label after stripping the `ses-` prefix.

#### Scenario: Skipped subjects visible on revisit

- **WHEN** user closes app after confirming BIDS review with one skipped subject, reopens the project, navigates to Import
- **THEN** the persisted summary renders the skipped-subjects warning block listing the persisted subject identifier (e.g., `sub-UNK001_1`)

### Requirement: BIDS-direct creation uses confirmed mutation transaction

BIDS-direct creation SHALL occur only by committing the current reviewed mutation plan. Validated schema-version-2 project bytes and compatibility artifacts SHALL commit together. The project SHALL retain BIDS data source, initial Import phase, unconfirmed BIDS review, and project-root-relative source state. Independent best-effort ignore-file or compatibility writes after project creation SHALL NOT occur.

#### Scenario: Confirmed BIDS-direct creation

- **WHEN** the current BIDS-direct plan is confirmed
- **THEN** current-schema project metadata and displayed compatibility artifacts SHALL commit before activation

#### Scenario: Compatibility mutation fails

- **WHEN** compatibility installation fails
- **THEN** no successfully created candidate project SHALL remain active and the GUI SHALL stay outside its import flow

#### Scenario: Post-commit BIDS review scan

- **WHEN** the committed project enters BIDS review
- **THEN** sidecar scanning SHALL not perform setup mutations
