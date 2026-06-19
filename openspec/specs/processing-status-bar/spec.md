# processing-status-bar Specification

## Purpose

TBD - created by archiving change processing-module. Update Purpose after archive.

## Requirements

### Requirement: Global Processing Status Indicator

The Layout component SHALL render a status indicator when `processingPhase` is not `idle`. The indicator SHALL show the current phase label ("Preparing", "Running", "Completed", "Failed", "Cancelled") and a brief progress summary (e.g., "3/5 subjects complete"). Clicking the indicator SHALL navigate to `/project/:id/processing`.

#### Scenario: Active processing indicator

- **WHEN** processing is running with 3 of 5 subjects complete
- **THEN** the Layout status bar SHALL show "Running — 3/5 subjects"

#### Scenario: Navigation from indicator

- **WHEN** the user clicks the processing status indicator while on a different route
- **THEN** the app SHALL navigate to `/project/:id/processing`

### Requirement: Processing Phase Subscription

The Layout component SHALL subscribe to `processingPhase` from the processing store. The subscription SHALL not cause unnecessary re-renders — only `processingPhase` changes SHALL trigger indicator updates, not per-subject progress updates.

#### Scenario: Phase change triggers indicator update

- **WHEN** `processingPhase` transitions from `running` to `completed`
- **THEN** the status indicator SHALL update from "Running" to "Completed"
