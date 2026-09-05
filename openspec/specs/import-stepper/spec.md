## Purpose

Define the import workflow steps, validation gates, and navigation.

## Requirements

### Requirement: Stepper step count and gating

The import stepper SHALL have 6 steps (indices 0-5). Step 4 "Preview Import" is review-only with validation gating. Step 5 "Run Import Module" handles execution. Entry to step 5 SHALL require Zod validation of the generated `sourcestructure.json` and `studyPar.json`, successful frontend validation of every staging identifier and destination, and successful read-only native preflight of the complete staging plan. Step 5 access also requires a valid configured execution profile.

#### Scenario: Step 4 validation passes

- **WHEN** the user is on step 4, configuration and staging identifier validation pass, native staging preflight succeeds, and a valid execution profile is configured
- **THEN** the "Next: Run Import" button SHALL be enabled, allowing navigation to step 5

#### Scenario: Step 4 validation fails

- **WHEN** the user is on step 4 and generated configuration validation fails or no valid execution profile is configured
- **THEN** the "Next: Run Import" button SHALL be disabled

#### Scenario: Step 4 staging validation fails

- **WHEN** the user is on step 4 and any staging identifier, source, destination, or collision check fails
- **THEN** the "Next: Run Import" button SHALL be disabled and the staging validation failures SHALL remain available for correction

#### Scenario: Source changes after preview

- **WHEN** preview preflight passed but an authoritative staging check fails when Run Import is requested
- **THEN** import execution SHALL return to a non-running state, show the current structured failures, and perform no staging filesystem mutation

### Requirement: Step 4 becomes review-only

Step 4 "Preview Import" SHALL display the staging mapping table, config JSON previews, and Zod validation status. It SHALL NOT contain execution controls. The `ImportRunner` component is removed entirely and replaced by navigation controls only ("Back: Metadata" and "Next: Run Import").

#### Scenario: Step 4 shows review content

- **WHEN** user navigates to step 4
- **THEN** the step shows StagingMappingTable, ConfigPreview, and validation status, with no "Run Import" button

### Requirement: Step locking during execution

When step 5 is in `preparing` or `running` state, step 4 SHALL be locked (user cannot navigate back), navigation to Parameters SHALL be locked, and execution profile, subject selection, Start, and retry controls SHALL be disabled. When step 5 transitions to `failed` or `cancelled`, step 4 and those controls SHALL unlock so the user can edit metadata before retrying. When step 5 is `completed`, steps 0-4 remain accessible but re-running import requires explicit confirmation.

#### Scenario: Import running, user tries to go back

- **WHEN** step 5 is in `running` state and user clicks "Back: Preview"
- **THEN** navigation is blocked, the button is disabled or shows a warning

#### Scenario: Import failed, user edits metadata

- **WHEN** step 5 transitions to `failed` state
- **THEN** step 4 is unlocked and the user can navigate back to edit metadata

#### Scenario: Import completed, user goes back to step 0

- **WHEN** step 5 is `completed` and user navigates to step 0
- **THEN** navigation is allowed, but step 5 shows a summary with "Next: Parameters" button

#### Scenario: Import preparation locks Step 5 controls

- **WHEN** step 5 is in `preparing` state while native staging and listener setup are deferred
- **THEN** Back, Next, execution-profile, subject-selection, Start, and retry controls SHALL remain disabled until preparation fails, is cancelled, or transitions to `running`

### Requirement: Field-level staging validation feedback

The Import mapping and preview UI SHALL show an aggregate blocking summary and field-level feedback for staging validation issues. Each issue SHALL identify a stable error code, the affected staging entry when applicable, the affected Subject, Session, Run, Modality, source, or destination field, a corrective message, and any conflicting entry. Suggested values SHALL require explicit user acceptance. The summary, inline errors, and suggestion controls SHALL expose stable `data-testid` attributes.

Native preflight state SHALL remain session-only. Each request SHALL use a monotonic requestId, captured ProjectLease, and current plan fingerprint. Step 5 SHALL unlock only for the newest request whose fingerprint and lease remain current while work admission is open. Run Import SHALL capture the same lifecycle context before asynchronous setup, register its complete asynchronous operation as project work, and gate post-await PID, log, preflight-issue, and failure mutations on current lease, admission, and plan fingerprint. Restored projects SHALL return to Preview until a fresh native preflight succeeds.

Run Import SHALL also create a distinct frontend `runRequestId` before listener setup and invocation. Listener correlation and the cached PID SHALL be scoped to that nonce: setup SHALL reject old queued events before binding native generation, and late responses from stopped or replaced runs SHALL not change phase, logs, validation, or PID state. Stop SHALL retain the locked running state until native stop succeeds.

#### Scenario: Subject rename target is unsafe

- **WHEN** a user enters an unsafe or BIDS-incompatible subject rename target
- **THEN** the subject row SHALL display an inline correction message and the aggregate summary SHALL report that staging is blocked

#### Scenario: Alias collision spans rows

- **WHEN** two session or run aliases are collision-equivalent under portable comparison
- **THEN** both affected rows SHALL identify the conflict and the summary SHALL explain that the destinations would collide

#### Scenario: Native preflight reports a source collision

- **WHEN** native preflight finds two source files that resolve to one portable destination
- **THEN** the preview SHALL identify both conflicting entries and SHALL keep execution disabled

#### Scenario: User accepts a suggested correction

- **WHEN** the user explicitly accepts a safe suggested identifier
- **THEN** the editor SHALL apply that value and revalidate the complete staging plan

### Requirement: Step 5 ImportExecution component

Step 5 "Run Import Module" SHALL be implemented by a new `ImportExecution` component with the following sub-components: `ImportExecutionHeader` (state badge), `ImportExecutionControls` (Run/Stop/Retry buttons gated by state), `ImportProgressTable` (per-subject rows with status, step, duration, error), `ImportLogPanel` (scrollable monospace stdout log always visible below the table), and `ImportSummary` (succeeded/failed counts, "Next: Parameters" button on success).

#### Scenario: Step 5 idle state

- **WHEN** user first navigates to step 5
- **THEN** the component shows "Run Import" button (enabled if MATLAB + ExploreASL configured), empty progress table, and empty log panel

#### Scenario: Step 5 preparing state

- **WHEN** user clicks "Run Import" and Rust is creating staging tree and writing configs
- **THEN** the state badge shows "Preparing...", "Run Import" and "Stop" buttons are disabled, log panel shows "Creating staging tree..."

#### Scenario: Step 5 running state

- **WHEN** MATLAB subprocess is active
- **THEN** "Stop" button is enabled, progress table updates per subject in real-time, log panel scrolls with live stdout

#### Scenario: Step 5 failed state

- **WHEN** import completes with one or more subject failures
- **THEN** progress table shows failed subjects with error details, "Retry Import" button is enabled, "Back: Metadata" button is enabled

#### Scenario: Step 5 completed state

- **WHEN** all subjects succeed
- **THEN** progress table shows all subjects as succeeded, "Next: Parameters" button is enabled, summary shows success count
