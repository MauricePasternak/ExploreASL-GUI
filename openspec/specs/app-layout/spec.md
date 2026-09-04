# app-layout Specification

## Purpose

Define application-shell layout behavior, including navigation and processing status visibility.

## Requirements

### Requirement: Processing Status Bar in Layout

The Layout component SHALL conditionally render a processing status indicator in the app shell. The indicator SHALL be visible when `processingPhase` is not `idle` and SHALL display the current phase and progress summary. It SHALL not render when processing has not been started for the current project.

#### Scenario: No processing status when idle

- **WHEN** `processingPhase` is `idle`
- **THEN** the processing status indicator SHALL NOT be rendered

#### Scenario: Processing status visible during run

- **WHEN** `processingPhase` is `running`
- **THEN** the indicator SHALL be visible in the Layout with a processing-themed accent color

### Requirement: DataPar Page Warning Banner

The data parameters route (`/project/:id/parameters`) SHALL display a warning banner when processing is active (`processingPhase` is `running`). The banner SHALL read: "Processing is running. Changes will take effect on next run." The dataPar editor SHALL NOT be locked — edits persist to `.easl` immediately but `dataPar.json` is only written at launch time.

#### Scenario: Warning banner appears during processing

- **WHEN** the user navigates to the parameters page while processing is running
- **THEN** a warning banner SHALL appear at the top of the page with the text "Processing is running. Changes will take effect on next run."

### Requirement: Visualization Navbar Entry

The navbar SHALL include a "Visualization" entry in `PHASE_NAV` with `IconChartScatter` as its icon. The entry SHALL appear after the "Processing" entry. The entry SHALL be enabled when `canAccessPhase(project, "visualization")` returns true. When disabled, the entry SHALL be greyed out and non-clickable. When the navbar is collapsed, the entry SHALL display the `IconChartScatter` icon with an accessible aria-label of "Visualization". When expanded, the entry SHALL display both the icon and the "Visualization" label.

#### Scenario: Navbar entry enabled after Population completion

- **WHEN** `canAccessPhase(project, "visualization")` returns `true`
- **THEN** the "Visualization" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled before Population completion

- **WHEN** `canAccessPhase(project, "visualization")` returns `false`
- **THEN** the "Visualization" navbar entry SHALL be disabled (greyed out, non-clickable)

#### Scenario: Collapsed navbar shows icon

- **WHEN** the navbar is collapsed and the "Visualization" entry is enabled
- **THEN** the `IconChartScatter` icon SHALL be visible with `aria-label="Visualization"`

#### Scenario: Expanded navbar shows icon and label

- **WHEN** the navbar is expanded and the "Visualization" entry is enabled
- **THEN** both the `IconChartScatter` icon and the text "Visualization" SHALL be visible

#### Scenario: Entry positioned after Processing

- **WHEN** the navbar phases are rendered
- **THEN** the "Visualization" entry SHALL appear immediately after the "Processing" entry

### Requirement: Manifest Navbar Entry

The navbar SHALL include a "Manifest" entry in `PHASE_NAV` appended after the "Visualization" entry. The entry SHALL use a Tabler icon appropriate to the document/QC-report concept (e.g. `IconClipboardCheck` or `IconFileReport`). The entry SHALL be enabled when `canAccessPhase(project, "manifest")` returns `true`. When disabled, the entry SHALL be greyed out and non-clickable. When the navbar is collapsed, the entry SHALL display the icon with an accessible `aria-label` of "Manifest". When expanded, the entry SHALL display both the icon and the "Manifest" label.

#### Scenario: Navbar entry enabled after Population completion

- **WHEN** `canAccessPhase(project, "manifest")` returns `true`
- **THEN** the "Manifest" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled before Population completion

- **WHEN** `canAccessPhase(project, "manifest")` returns `false`
- **THEN** the "Manifest" navbar entry SHALL be disabled (greyed out, non-clickable)

#### Scenario: Collapsed navbar shows icon

- **WHEN** the navbar is collapsed and the "Manifest" entry is enabled
- **THEN** the chosen Tabler icon SHALL be visible with `aria-label="Manifest"`

#### Scenario: Expanded navbar shows icon and label

- **WHEN** the navbar is expanded and the "Manifest" entry is enabled
- **THEN** both the chosen icon and the text "Manifest" SHALL be visible

#### Scenario: Entry positioned after Visualization

- **WHEN** the navbar phases are rendered
- **THEN** the "Manifest" entry SHALL appear immediately after the "Visualization" entry

### Requirement: Safe project and application close

Ordinary Return to Home, project replacement, and application close actions SHALL wait for project-owned import and processing shutdown. If shutdown cannot be confirmed, navigation or exit SHALL be cancelled, the current project SHALL remain visible, and the system SHALL show an actionable error with retry guidance. Operating-system force termination remains outside this guarantee.

#### Scenario: Return to Home stops project work

- **WHEN** the user returns to Home while project-owned work or watchers are active
- **THEN** navigation SHALL occur only after those resources are confirmed stopped and project-scoped state is reset

#### Scenario: Normal close cannot stop work

- **WHEN** the user requests application close and project-owned work cannot be confirmed stopped
- **THEN** the application SHALL remain open and SHALL show an actionable shutdown error

### Requirement: Missing external source guidance

When a project opens with one or more unavailable external sources, the application shell SHALL show a summary notice without blocking project access. The Import or Visualization phase that owns each missing source SHALL show a persistent warning with the saved source location and a Relink action until that source is restored or explicitly removed. All warning and Relink controls SHALL expose stable `data-testid` attributes.

#### Scenario: Project opens with missing source

- **WHEN** a valid project opens with an unavailable DICOM source or visualization external file
- **THEN** the shell SHALL show a summary notice and navigation to unaffected phases SHALL remain available

#### Scenario: User visits affected phase

- **WHEN** the user visits a phase whose external source is unavailable
- **THEN** a persistent warning SHALL identify the source and offer Relink while only source-dependent actions remain disabled
