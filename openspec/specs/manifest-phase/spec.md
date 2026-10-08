# manifest-phase Specification

## Purpose

Define the manifest workflow steps for QC review and export.

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

### Requirement: Current project phase ordering

Current project phases SHALL be import, parameters, processing, visualization, and manifest in that order. The current schema SHALL accept all five values. Unsupported earlier project schemas SHALL be rejected without phase migration. Existing access gates SHALL remain unchanged.

#### Scenario: Current project retains saved phase

- **WHEN** current configuration with saved Visualization phase reopens
- **THEN** the saved phase SHALL remain Visualization without rewriting the file

#### Scenario: Project explicitly enters Manifest

- **WHEN** accepted Population completion permits Manifest and the user selects it
- **THEN** the current project SHALL persist Manifest phase through the shared writer
