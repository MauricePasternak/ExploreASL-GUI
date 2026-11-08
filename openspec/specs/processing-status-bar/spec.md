# processing-status-bar Specification

## Purpose

Define the global status indicator for active and completed processing.

## Requirements

### Requirement: Global Processing Status Indicator

The project footer SHALL show noninteractive per-module distinct subject/session completion counts for every non-idle phase, using any-complete-row semantics without lifecycle labels or accents.

#### Scenario: Global processing progress is projected into the footer

- **WHEN** processing phase or subject-module statuses change
- **THEN** visibility, ordering, missing identifiers, counting, and interaction SHALL follow these rules:

The Layout component SHALL render `ProcessingStatusBar` in the project footer. The indicator SHALL be hidden only when `processingPhase` is `idle`. For other phases it SHALL show progress counts for modules present in `subjectStatuses`, ordered Structural, ASL, Population. Each count SHALL use distinct subject/session identifiers within that module; missing identifiers, including subjectless Population rows, SHALL share one empty identifier. An identifier SHALL count as complete when any corresponding row has status `complete`, not only when all ASL runs are complete. The display SHALL use text such as "Structural 3/5 · ASL 2/5" without a phase label or phase-specific accent. The indicator SHALL be noninteractive and SHALL NOT navigate on click.

#### Scenario: Active processing indicator

- **WHEN** processing is running with Structural status rows for five subject/sessions, three of them complete
- **THEN** the Layout status bar SHALL show "Structural 3/5" without a "Running" label

#### Scenario: Indicator is noninteractive

- **WHEN** the user clicks the processing status indicator while on a different route
- **THEN** the route SHALL remain unchanged

#### Scenario: No status rows outside idle

- **WHEN** the processing phase is not `idle` and `subjectStatuses` is empty
- **THEN** the indicator group SHALL render without progress text or a fallback phase label

#### Scenario: Partial ASL run completion

- **WHEN** one subject/session has an ASL row marked `complete` and another ASL run marked `incomplete`
- **THEN** that subject/session SHALL contribute one to both ASL counts

### Requirement: Processing Phase Subscription

The status indicator SHALL subscribe to both `processingPhase` and `subjectStatuses` from the processing store. Phase changes SHALL determine visibility, and status changes SHALL update module counts without requiring a phase transition.

#### Scenario: Status changes update counts

- **WHEN** a Structural status changes from `incomplete` to `complete` while `processingPhase` remains `running`
- **THEN** the Structural completion count SHALL update

#### Scenario: Idle hides indicator

- **WHEN** `processingPhase` transitions to `idle`
- **THEN** the status indicator SHALL no longer render, even if status rows remain
