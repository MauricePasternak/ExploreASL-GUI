# manifest-phase Specification

## Purpose

TBD - created by archiving change project-manifest. Update Purpose after archive.

## Requirements

### Requirement: Manifest Phase Stepper Structure

The Manifest phase SHALL render a stepper whose step count depends on reviewer mode and presence of disagreements:

- **Single-reviewer mode** (`reviewers.length <= 1` or `reviewers` is `undefined`): exactly 2 steps, QC Selection and Preview & Export.
- **Multi-reviewer mode with no disagreements** (`reviewers.length > 1` and `disagreements.length === 0`): exactly 2 steps, QC Selection and Preview & Export.
- **Multi-reviewer mode with disagreements** (`reviewers.length > 1` and `disagreements.length > 0`): exactly 3 steps, QC Selection, Verdict Resolution, and Preview & Export.

The Verdict Resolution step SHALL be omitted entirely when reviewers are unanimous. When disagreements exist, it SHALL be visible and all disagreements MUST be resolved before proceeding to Preview & Export.

#### Scenario: Single-reviewer mode shows 2-step stepper

- **WHEN** the `reviewers` array contains one entry (or is `undefined`) and the Manifest phase loads
- **THEN** the stepper SHALL display exactly 2 steps: "QC Selection" and "Preview & Export"

#### Scenario: Unanimous multi-reviewer mode shows 2-step stepper

- **WHEN** the `reviewers` array contains 2 entries and all completed SubjectSessions are unanimous
- **THEN** the stepper SHALL display exactly 2 steps: "QC Selection" and "Preview & Export"

#### Scenario: Verdict Resolution step omitted when no disagreements

- **WHEN** the project has 2 reviewers and all SubjectSessions have unanimous verdicts
- **THEN** no Verdict Resolution step SHALL be visible, and clicking "Next" from QC Selection SHALL advance to Preview & Export

#### Scenario: Verdict Resolution step enabled when disagreements exist

- **WHEN** the project has 2 reviewers and at least one SubjectSession has differing verdicts between reviewers
- **THEN** Step 1 (Verdict Resolution) SHALL be enabled, and clicking "Next" from Step 0 SHALL advance to Verdict Resolution

### Requirement: Project Phases Tuple Extension

The `PROJECT_PHASES` constant in `src/schemas/project.ts` SHALL include a new entry `"manifest"` appended after `"visualization"`. The array's ordering SHALL be exactly `["import", "parameters", "processing", "visualization", "manifest"]`. Existing `.easl` files with `currentPhase` set to one of the original four phases SHALL parse unchanged because no existing enum value is removed.

#### Scenario: Existing project file loads without migration

- **WHEN** a `.easl` file with `currentPhase: "visualization"` is loaded by `projectStore.loadProject`
- **THEN** the file SHALL parse via `ProjectFileSchema.parse` and the resulting `project.projectMeta.currentPhase` SHALL equal `"visualization"`

#### Scenario: Project file explicitly set to manifest phase

- **WHEN** `projectStore.setPhase("manifest")` is called on a project whose `uiState.processing.population.completed === true`
- **THEN** the resulting `.easl` payload SHALL have `projectMeta.currentPhase === "manifest"` and the file SHALL round-trip through `ProjectFileSchema.parse`

### Requirement: Manifest Phase Access Gate

`canAccessPhase` SHALL treat the `"manifest"` phase identically to `"visualization"` — access SHALL be granted iff `project.uiState?.processing?.population?.completed === true`. The `manifest` phase SHALL NOT be independently selectable without that flag.

#### Scenario: Manifest nav disabled before Population completion

- **WHEN** the user opens a project whose `uiState.processing.population.completed` is falsy
- **THEN** `canAccessPhase(project, "manifest")` SHALL return `false`, and the `Layout` component SHALL render the Manifest nav button in a disabled state

#### Scenario: Manifest nav enabled after Population completion

- **WHEN** `setPopulationCompleted(true)` is called by `processingStore` after a successful Population run
- **THEN** `canAccessPhase(project, "manifest")` SHALL return `true`, and the Manifest nav button SHALL become clickable

### Requirement: Manifest Nav Entry And Route

The `PHASE_NAV` array in `src/components/Layout.tsx` SHALL contain a 5th entry with `phase: "manifest"`, an appropriate Tabler icon, and `label: "Manifest"`. A React Router route at path `/project/:id/manifest` SHALL render the `ManifestPage` component, parallel to the existing phase routes.

#### Scenario: Nav button click navigates to manifest phase

- **WHEN** a user with `processing.population.completed === true` clicks the Manifest nav button
- **THEN** the route SHALL transition to `/project/<id>/manifest` and the `ManifestPage` component SHALL mount

#### Scenario: Direct URL entry blocked by gate

- **WHEN** a user manually navigates to `/project/<id>/manifest` on a project where `processing.population.completed` is falsy
- **THEN** `Layout` SHALL redirect to the highest reachable phase (visualization or earlier) and the `ManifestPage` SHALL NOT mount

### Requirement: Manifest Phase Help Drawer Content

The `HELP_DATA` map in `src/components/PageHelpButton.tsx` SHALL contain an entry keyed by the `manifest` phase. The help content SHALL include, at minimum, a title, a goal paragraph describing QC verdict capture and manifest export, and an explicit warning stating that re-running the Population module locks the user out of the Manifest phase until the new run completes. In multi-reviewer mode, the help content SHALL additionally mention reviewer management and the blinded verdict-resolution workflow.

#### Scenario: Help drawer opens with re-run lockout warning

- **WHEN** a user clicks the page help button on the `/project/:id/manifest` route
- **THEN** the drawer SHALL open and SHALL visibly contain the phrase "re-running" (or a semantically equivalent warning) inside the manifest phase's help text

#### Scenario: Help drawer mentions multi-reviewer workflow

- **WHEN** the help drawer is opened and the project has multiple reviewers
- **THEN** the help text SHALL contain guidance about reviewer tabs, blinded review, and verdict resolution
