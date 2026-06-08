## Requirements

### Requirement: Stepper step count and gating

The import stepper SHALL have 6 steps (indices 0-5). Step 4 "Preview Import" is review-only with Zod validation gating. Step 5 "Run Import Module" handles execution. Entry to step 5 is gated by Zod validation passing on the generated `sourcestructure.json` and `studyPar.json`. Step 5 access also requires MATLAB installation and ExploreASL path configured in global settings.

#### Scenario: Step 4 validation passes
- **WHEN** user is on step 4 and all Zod validations pass and MATLAB + ExploreASL are configured
- **THEN** the "Next: Run Import" button is enabled, allowing navigation to step 5

#### Scenario: Step 4 validation fails
- **WHEN** user is on step 4 and Zod validation fails or MATLAB/ExploreASL are not configured
- **THEN** the "Next: Run Import" button is disabled

### Requirement: Step 4 becomes review-only

Step 4 "Preview Import" SHALL display the staging mapping table, config JSON previews, and Zod validation status. It SHALL NOT contain execution controls. The `ImportRunner` component is removed entirely and replaced by navigation controls only ("Back: Metadata" and "Next: Run Import").

#### Scenario: Step 4 shows review content
- **WHEN** user navigates to step 4
- **THEN** the step shows StagingMappingTable, ConfigPreview, and validation status, with no "Run Import" button

### Requirement: Step locking during execution

When step 5 is in `running` state, step 4 SHALL be locked (user cannot navigate back). When step 5 transitions to `failed` or `cancelled`, step 4 SHALL unlock so the user can edit metadata before retrying. When step 5 is `completed`, steps 0-4 remain accessible but re-running import requires explicit confirmation.

#### Scenario: Import running, user tries to go back
- **WHEN** step 5 is in `running` state and user clicks "Back: Preview"
- **THEN** navigation is blocked, the button is disabled or shows a warning

#### Scenario: Import failed, user edits metadata
- **WHEN** step 5 transitions to `failed` state
- **THEN** step 4 is unlocked and the user can navigate back to edit metadata

#### Scenario: Import completed, user goes back to step 0
- **WHEN** step 5 is `completed` and user navigates to step 0
- **THEN** navigation is allowed, but step 5 shows a summary with "Next: Parameters" button

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
