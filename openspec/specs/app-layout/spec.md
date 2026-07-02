# app-layout Specification

## Purpose

TBD - created by archiving change processing-module. Update Purpose after archive.

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
