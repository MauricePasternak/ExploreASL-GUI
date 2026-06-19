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
