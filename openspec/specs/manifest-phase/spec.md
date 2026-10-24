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

`canAccessPhase` SHALL determine Manifest access by membership in the native snapshot's `allowedPhases`. Native access SHALL include the project's current phase (including a restored saved phase) and all earlier phases; access to Manifest as a later phase SHALL require `project.uiState?.processing?.population?.completed === true`. A saved current Manifest phase SHALL remain allowed even when Population completion is false.

Separately, while processing is `preparing`, `running`, `finalizing`, or `cancelling`, the Manifest nav button SHALL be disabled and direct Manifest navigation SHALL redirect away, regardless of native phase access or Population completion.

#### Scenario: Manifest nav disabled before Population completion

- **WHEN** the user opens a project saved before Manifest whose `uiState.processing.population.completed` is falsy
- **THEN** `canAccessPhase(project, "manifest")` SHALL return `false`, and the `Layout` component SHALL render the Manifest nav button in a disabled state

#### Scenario: Manifest nav enabled after Population completion

- **WHEN** an accepted native snapshot reports Population completion and no import or processing operation is active
- **THEN** `canAccessPhase(project, "manifest")` SHALL return `true`, and the Manifest nav button SHALL become clickable

#### Scenario: Saved Manifest remains allowed without Population completion

- **WHEN** a project reopens with saved current phase Manifest, Population completion false, and no active processing
- **THEN** `canAccessPhase(project, "manifest")` SHALL return `true` from native `allowedPhases`

#### Scenario: Active processing blocks an otherwise allowed Manifest

- **WHEN** native `allowedPhases` includes Manifest and processing is preparing, running, finalizing, or cancelling
- **THEN** the Manifest nav button SHALL be disabled and a direct Manifest route SHALL redirect to Processing when the project's current phase is Manifest or Visualization, otherwise to the current phase

### Requirement: Manifest Nav Entry And Route

The `PHASE_NAV` array in `src/components/Layout.tsx` SHALL contain a 5th entry with `phase: "manifest"`, an appropriate Tabler icon, and `label: "Manifest"`. A React Router route at path `/project/:id/manifest` SHALL render the `ManifestPage` component, parallel to the existing phase routes.

#### Scenario: Nav button click navigates to manifest phase

- **WHEN** native phase access permits Manifest, no import or processing operation is active, and the user clicks the Manifest nav button
- **THEN** the route SHALL transition to `/project/<id>/manifest` and the `ManifestPage` component SHALL mount

#### Scenario: Direct URL entry blocked by gate

- **WHEN** a user manually navigates to `/project/<id>/manifest` and native `allowedPhases` excludes Manifest
- **THEN** `ProjectPage` SHALL redirect to the project's current phase, or to Processing if the current phase is Visualization or Manifest

### Requirement: Manifest Phase Help Content

The `HELP_DATA` map in `src/components/common/PageHelpButton.tsx` SHALL contain a static, reviewer-independent entry keyed by the `manifest` phase. The help modal SHALL include a title, a goal paragraph describing QC verdict capture and Markdown/HTML export, guidance about Neutral verdicts, the four core preview sections (Study Parameters, Software Manifest, QC Summary, Pipeline Summary), and an explicit warning stating that re-running Population locks the phase until the new run completes. Help content SHALL remain the same for single- and multi-reviewer projects rather than adding mode-specific reviewer-management or resolution guidance.

#### Scenario: Help modal opens with re-run lockout warning

- **WHEN** a user clicks the page help button on the `/project/:id/manifest` route
- **THEN** the modal SHALL open and SHALL visibly contain the phrase "re-running" (or a semantically equivalent warning) inside the manifest phase's help text

#### Scenario: Help remains reviewer-independent

- **WHEN** the help modal is opened in a project with multiple reviewers
- **THEN** it SHALL show the same QC Selection, four-core-section preview, Markdown/HTML export, and Population re-run guidance as a single-reviewer project

### Requirement: Current project phase ordering

Current project phases SHALL be import, parameters, processing, visualization, and manifest in that order. The current schema SHALL accept all five values. Unsupported earlier project schemas SHALL be rejected without phase migration. Existing access gates SHALL remain unchanged.

#### Scenario: Current project retains saved phase

- **WHEN** current configuration with saved Visualization phase reopens
- **THEN** the saved phase SHALL remain Visualization without rewriting the file

#### Scenario: Project explicitly enters Manifest

- **WHEN** accepted Population completion permits Manifest and the user selects it
- **THEN** the current project SHALL persist Manifest phase through the shared writer
