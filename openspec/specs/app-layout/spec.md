# app-layout Specification

## Purpose

Define application-shell layout behavior, including navigation and processing status visibility.

## Requirements

### Requirement: Processing Status Bar in Layout

The Layout component SHALL mount the processing status bar in the active project's footer. The bar SHALL render no content when `processingPhase` is `idle` and SHALL render its group for every other phase, including terminal phases. When statuses are present, it SHALL display per-module completed/total counts in Structural, ASL, Population order, followed by any other modules. Each count SHALL use distinct subject-sessions within that module; a subject-session SHALL count complete when at least one of its statuses is `complete`, including across multiple ASL runs. With no statuses, the non-idle group SHALL contain no progress text. The bar SHALL NOT display a lifecycle label or apply a running-specific accent. Lifecycle authority SHALL remain with the processing store's native run projection, not be inferred from these counts.

#### Scenario: No processing status when idle

- **WHEN** `processingPhase` is `idle`
- **THEN** the processing status indicator SHALL NOT be rendered

#### Scenario: Processing status visible during run

- **WHEN** `processingPhase` is `running` and Structural statuses contain one completed and one pending subject-session
- **THEN** the footer SHALL display `Structural 1/2` without a lifecycle label or running-specific accent

#### Scenario: Non-idle processing has no statuses

- **WHEN** `processingPhase` is not `idle` and no subject statuses exist
- **THEN** the status-bar group SHALL render without progress text

### Requirement: DataPar Page Warning Banner

The data parameters route (`/project/:id/parameters`) SHALL display a warning banner when `processingPhase` is `preparing`, `running`, `finalizing`, or `cancelling`. The banner SHALL read: "Processing is running. Changes will take effect on next run." The dataPar editor SHALL NOT be locked — accepted edits use shared project autosave, while `dataPar.json` is only written at launch time.

#### Scenario: Warning banner appears during processing

- **WHEN** the user navigates to the parameters page while processing is running
- **THEN** a warning banner SHALL appear at the top of the page with the text "Processing is running. Changes will take effect on next run."

### Requirement: Visualization Navbar Entry

The navbar SHALL include a "Visualization" entry in `PHASE_NAV` with `IconChartScatter` as its icon. The entry SHALL appear after the "Processing" entry. The entry SHALL be enabled when `canAccessPhase(project, "visualization")` returns true and active-work navigation guards permit access. When disabled, the entry SHALL be greyed out and non-clickable. When the navbar is collapsed, the entry SHALL display the `IconChartScatter` icon with an accessible aria-label of "Visualization". When expanded, the entry SHALL display both the icon and the "Visualization" label.

Active import SHALL disable all phase entries except Import; active processing SHALL disable Visualization and Manifest. Active phases SHALL include `preparing`, `running`, `finalizing`, and `cancelling`; `importRunning` SHALL also count as active import. These guards SHALL remain separate from native `allowedPhases` eligibility.

#### Scenario: Navbar entry enabled by native phase eligibility

- **WHEN** `canAccessPhase(project, "visualization")` returns `true` and no active-work navigation guard blocks it
- **THEN** the "Visualization" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled by native phase eligibility

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

The navbar SHALL include a "Manifest" entry in `PHASE_NAV` appended after the "Visualization" entry. The entry SHALL use a Tabler icon appropriate to the document/QC-report concept (e.g. `IconClipboardCheck` or `IconFileReport`). The entry SHALL be enabled when `canAccessPhase(project, "manifest")` returns `true` and active-work navigation guards permit access. When disabled, the entry SHALL be greyed out and non-clickable. When the navbar is collapsed, the entry SHALL display the icon with an accessible `aria-label` of "Manifest". When expanded, the entry SHALL display both the icon and the "Manifest" label.

#### Scenario: Navbar entry enabled by native phase eligibility

- **WHEN** `canAccessPhase(project, "manifest")` returns `true` and no active-work navigation guard blocks it
- **THEN** the "Manifest" navbar entry SHALL be enabled and clickable

#### Scenario: Navbar entry disabled by native phase eligibility

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

#### Scenario: Active processing blocks result phases independently of saved cursor

- **WHEN** processing is `preparing`, `running`, `finalizing`, or `cancelling`, even if native phase eligibility permits Visualization or Manifest
- **THEN** both entries SHALL be disabled and result-phase route requests SHALL redirect to the current phase, or to Processing when the current phase is Visualization or Manifest

### Requirement: Safe project and application close

Return to Home, project replacement, and ordinary application close SHALL submit pending edits and wait for the latest accepted configuration to persist, then wait for project-owned import/processing shutdown and native result persistence. Save, validation, or shutdown failure SHALL cancel navigation/exit, keep current state visible, and show actionable retry guidance. The application SHALL not offer an ordinary "leave without saving" path. Active cancellable execution SHALL retain explicit abort confirmation, and non-cancellable finalization SHALL retain its wait policy. Operating-system force termination SHALL remain outside these guarantees.

#### Scenario: Return to Home stops project work

- **WHEN** the user confirms returning Home while project work is active
- **THEN** edits SHALL flush and resources SHALL settle before navigation and reset

#### Scenario: Normal close cannot stop work

- **WHEN** project work cannot be confirmed stopped
- **THEN** the application SHALL remain open and show the shutdown error

#### Scenario: Close occurs before autosave delay expires

- **WHEN** ordinary close follows an accepted edit immediately
- **THEN** close SHALL wait for that edit to persist without a save/discard dialog

#### Scenario: Close cannot persist changes

- **WHEN** writing the latest configuration fails
- **THEN** close SHALL be cancelled and unsaved changes SHALL remain visible for retry

### Requirement: Native emergency close

One main-window Close SHALL request ordinary renderer shutdown and arm a five-second native fallback in development and packaged desktop builds. If the window remains open without a handled response, native code SHALL offer exit confirmation automatically. No second click or JavaScript execution SHALL be required for fallback. Confirmed exit SHALL warn about unsaved changes and active-work cancellation and SHALL retain native supervised shutdown.

#### Scenario: Ordinary Close retains save guarantees

- **WHEN** the user requests Close
- **THEN** ordinary save and abort-confirmation behavior SHALL remain unchanged, without an immediate-process-exit or unguarded window-destruction path

#### Scenario: Renderer cannot handle Close

- **WHEN** the user requests Close once and the window remains open without a handled response for five seconds
- **THEN** native code SHALL automatically show the emergency exit confirmation without JavaScript, developer tools, or another click; it SHALL NOT claim to diagnose renderer responsiveness

#### Scenario: Renderer presents ordinary confirmation or a close error

- **WHEN** the renderer presents its active-work confirmation or reports a normal close/save error
- **THEN** it SHALL mark that specific native close request handled so the timeout does not add a redundant native dialog

#### Scenario: Stale response or timer belongs to an earlier Close

- **WHEN** a response or timeout for an earlier close request arrives during a newer request
- **THEN** it SHALL NOT cancel the newer deadline or show its confirmation early

#### Scenario: User confirms emergency exit

- **WHEN** the user confirms the native exit warning
- **THEN** native exit handling SHALL stop owned import/processing resources before allowing application exit, even if the renderer cannot execute

#### Scenario: User keeps waiting

- **WHEN** the user cancels the native exit confirmation
- **THEN** no native exit or worker shutdown SHALL be initiated, normal close work MAY continue, and a later Close SHALL arm a fresh fallback

#### Scenario: Repeated Close while native confirmation is pending

- **WHEN** further Close requests arrive during the grace period, native confirmation, or confirmed exit
- **THEN** native code SHALL NOT postpone the original deadline or create duplicate requests or confirmations

#### Scenario: Native cleanup fails during emergency exit

- **WHEN** native import or processing shutdown fails after emergency exit is confirmed
- **THEN** the application SHALL remain open, show a native shutdown error, and permit a later Close attempt to retry

### Requirement: Missing external source guidance

When a project opens with one or more unavailable external sources, the application shell SHALL show a summary notice without blocking project access. The Import or Visualization phase that owns each missing source SHALL show a persistent warning with the saved source location and a Relink action until that source is restored or explicitly removed. All warning and Relink controls SHALL expose stable `data-testid` attributes.

#### Scenario: Project opens with missing source

- **WHEN** a valid project opens with an unavailable DICOM source or visualization external file
- **THEN** the shell SHALL show a summary notice and navigation to unaffected phases SHALL remain available

#### Scenario: User visits affected phase

- **WHEN** the user visits a phase whose external source is unavailable
- **THEN** a persistent warning SHALL identify the source and offer Relink while only source-dependent actions remain disabled

### Requirement: Unified project save status

The shell SHALL expose saving, saved, and unsaved/error status for the active project. Save and the platform save shortcut SHALL flush pending form submissions and the configuration writer even when the accepted cache was previously clean. Failed autosave SHALL produce actionable visible feedback rather than console-only reporting. New controls SHALL retain accessible labels and stable test IDs.

#### Scenario: Save flushes a pending form edit

- **WHEN** the user invokes Save before the form edit has reached native acceptance
- **THEN** Save SHALL submit that edit and SHALL report saved only after its successful persistence
