## Purpose

Define the import workflow steps, validation gates, and navigation.

## Requirements

### Requirement: Navigation inside the stepper

The DICOM import wizard SHALL render each step's Back/Next navigation inside the vertical stepper sidebar, beneath the step list and outside the scrolling content panel. Navigation buttons SHALL stack to fit the sidebar. The step list SHALL scroll independently while navigation remains visible. Step labels SHALL remain display-only; existing validation and execution locks SHALL remain unchanged. BIDS-direct review SHALL remain unaffected.

#### Scenario: Navigating between import steps

- **WHEN** a DICOM import step is displayed or changed using its navigation buttons
- **THEN** only that step's navigation SHALL appear inside the stepper, including Preview and Run Import
- **AND** scrolling the step content or step list SHALL NOT scroll its navigation away

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

Import controls SHALL remain locked throughout attached active native work, permitting Stop only for cancellable runs and unlocking correction or re-run flows only after authoritative reconciliation.

#### Scenario: Attached import lifecycle changes

- **WHEN** native import enters an active or terminal phase
- **THEN** navigation, editing, Stop, and retry availability SHALL follow these rules:

When the attached native import run is `preparing`, `running`, `finalizing`, or `cancelling`, Step 4, navigation to Parameters, execution profile, subject selection, Start, and retry controls SHALL remain locked. Stop SHALL be available only for a cancellable matching run. Finalization SHALL show non-cancellable verification/relocation progress and SHALL not unlock controls because the child process exited. `Failed`, `Cancelled`, and `Interrupted` outcomes SHALL unlock correction and retry controls after authoritative reconciliation. `Completed` SHALL allow earlier steps while requiring existing explicit re-run confirmation.

#### Scenario: Import running, user tries to go back

- **WHEN** the attached run is `Running` and the user tries to leave Step 5
- **THEN** navigation SHALL remain blocked

#### Scenario: Process exits into finalization

- **WHEN** the attached run changes from `Running` to `Finalizing`
- **THEN** Step 5 SHALL remain locked and SHALL show native verification/relocation activity rather than success

#### Scenario: Import fails authoritatively

- **WHEN** the attached run reaches `Failed`
- **THEN** Step 4 and retry controls SHALL unlock and structured native failure details SHALL remain visible

#### Scenario: Import is interrupted

- **WHEN** project recovery classifies a prior run as `Interrupted`
- **THEN** Step 5 SHALL show the interruption, preserve available diagnostics, and keep new execution blocked until exact external-stop confirmation and terminal reconciliation release native admission

#### Scenario: Import failed, user edits metadata

- **WHEN** the attached run reaches `Failed`
- **THEN** Step 4 SHALL unlock and the user SHALL be able to edit metadata before retrying

#### Scenario: Import completed, user goes back to step 0

- **WHEN** the attached run is `Completed` and the user navigates to step 0
- **THEN** navigation SHALL be allowed and Step 5 SHALL retain its terminal summary and Parameters action

#### Scenario: Import preparation locks Step 5 controls

- **WHEN** the reserved native run is `Preparing`
- **THEN** Back, Next, profile, subject selection, Start, and retry controls SHALL remain disabled until authoritative transition or failure

### Requirement: Field-level staging validation feedback

Import SHALL present structured staging issues and accept asynchronous validation or run updates only for the current plan, ProjectLease, and native run identity.

#### Scenario: Preview validation or reserved import returns asynchronously

- **WHEN** mapping feedback, launch responses, events, or cancellation arrive
- **THEN** issue display, listener sequencing, and stale-response rejection SHALL follow these rules:

The Import mapping and preview UI SHALL show aggregate and field-level staging validation feedback with stable error codes, affected entries and fields, corrective messages, conflicting entries, explicit suggestion acceptance, and stable `data-testid` attributes. Native preflight state SHALL remain session-only and scoped to the current ProjectLease and plan fingerprint.

Run Import SHALL first reserve a native run, then install run-scoped listeners, attach to close listener races, and launch only the exact reservation. Post-await responses and events SHALL mutate validation, logs, phase, and controls only when their native run identity and ProjectLease remain current. Restored projects SHALL return to Preview for new execution unless discovery finds matching active or replayable native work. Stop SHALL retain native lifecycle state until matching cancellation is confirmed.

#### Scenario: Native preflight reports a source collision

- **WHEN** launch-time preflight finds two source files resolving to one portable destination
- **THEN** Step 5 SHALL show both current conflicts, remain non-running, and preserve project output

#### Scenario: Reservation is replaced before launch

- **WHEN** launch or its response names a stale native run
- **THEN** Step 5 SHALL ignore the response and reconcile from current native discovery

#### Scenario: User accepts a suggested correction

- **WHEN** the user explicitly accepts a safe suggested identifier
- **THEN** the editor SHALL apply that value and revalidate the complete staging plan before another reservation

#### Scenario: Subject rename target is unsafe

- **WHEN** a subject rename target violates portable or BIDS label rules
- **THEN** its row and aggregate summary SHALL show correction guidance and execution SHALL remain blocked

#### Scenario: Alias collision spans rows

- **WHEN** two session or run aliases collide under portable comparison
- **THEN** both rows SHALL identify the conflict and execution SHALL remain blocked

### Requirement: Step 5 ImportExecution component

Import step 5 SHALL render distinct native lifecycle states, run controls, subject progress, logs, and verified terminal summaries with stable test IDs.

#### Scenario: An attached import snapshot is rendered

- **WHEN** step 5 displays active or terminal native import state
- **THEN** lifecycle presentation and result details SHALL satisfy these rules:

Step 5 SHALL display an authoritative lifecycle badge, run controls, per-subject status table, log panel, and terminal summary using the attached native run snapshot. It SHALL represent `Preparing`, `Running`, `Finalizing`, `Cancelling`, `Completed`, `Failed`, `Cancelled`, and `Interrupted` distinctly. Terminal summaries SHALL show verified/committed and failed subject counts plus structured completion-verification or relocation errors. Every component and state-specific control SHALL expose stable `data-testid` attributes.

#### Scenario: Step 5 has no native run

- **WHEN** discovery returns no active or replayable run
- **THEN** Step 5 SHALL show idle reconstruction and permit Start only when existing validation and selection gates pass

#### Scenario: Step 5 finalizing state

- **WHEN** the native run is verifying targets or relocating output
- **THEN** the badge SHALL show finalization, mutation controls SHALL remain disabled, and the UI SHALL not present import as complete

#### Scenario: Step 5 failed state

- **WHEN** native finalization returns failed subject evidence or relocation failure
- **THEN** the table and summary SHALL show authoritative per-subject details and safe retry controls

#### Scenario: Step 5 completed state

- **WHEN** native finalization and project-state reconciliation complete successfully
- **THEN** all selected subjects SHALL show committed completion and the Parameters action SHALL be enabled

#### Scenario: Step 5 idle state

- **WHEN** discovery completes with no native run and artifact reconstruction is ready
- **THEN** Step 5 SHALL show Start, the reconstructed table, and logs with existing validation gates

#### Scenario: Step 5 preparing state

- **WHEN** a reserved run is preparing durable state and staging
- **THEN** the badge SHALL show preparation and mutation/navigation controls SHALL remain disabled

#### Scenario: Step 5 running state

- **WHEN** the attached native run is `Running`
- **THEN** Stop SHALL be enabled, matching progress SHALL update in real time, and logs SHALL remain visible

### Requirement: Import Step 5 reattachment

Entering or remounting Step 5 SHALL discover and attach to current native import work before enabling Start. A matching `Preparing`, `Running`, `Finalizing`, or `Cancelling` run SHALL restore locked active presentation. A replayable terminal run SHALL restore its terminal summary and complete persistence/acknowledgement. The UI SHALL never offer a second start merely because local listener or PID state was lost.

#### Scenario: Route remount during running import

- **WHEN** Step 5 remounts while native discovery reports a matching `Running` run
- **THEN** it SHALL attach to that run, restore controls and progress, and SHALL not reserve another run

#### Scenario: Route remount after missed completion event

- **WHEN** Step 5 remounts after native finalization reached a replayable terminal result
- **THEN** it SHALL render and reconcile that result without repeating relocation

#### Scenario: Discovery is unresolved

- **WHEN** native discovery or attachment fails
- **THEN** Start SHALL remain disabled and the UI SHALL show an actionable reconciliation error rather than assume idle
