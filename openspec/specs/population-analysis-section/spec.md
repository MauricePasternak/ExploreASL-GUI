# population-analysis-section Specification

## Purpose

Define requirements and scenarios for the dedicated Population Analysis layout section on the Processing page, detailing eligibility, atlas recap, log viewing, and configuration settings.

## Requirements

### Requirement: Population Analysis Section Layout

Processing SHALL show a dedicated Population Analysis card after configuration only in idle or terminal phases, allowing interrupted-state edits without releasing native execution-admission gates.

#### Scenario: Population configuration visibility follows lifecycle

- **WHEN** the Processing page renders idle, active, or interrupted state
- **THEN** section placement, visibility, and editing boundaries SHALL follow these rules:

A dedicated Population Analysis section SHALL be rendered on the Processing page after the Pipeline Configuration Panel. The section SHALL be a Card with a title "Population Analysis". It SHALL only be visible when the processing phase is `idle`, `completed`, `failed`, `cancelled`, or `interrupted` (same visibility as the config view). Interrupted-run configuration SHALL remain editable subject to the normal module and eligibility constraints; editing SHALL NOT release the native external-stop confirmation or acknowledgement gate for starting another run.

#### Scenario: Section appears in correct position

- **WHEN** the user views the Processing page in idle state
- **THEN** the Population Analysis section SHALL appear after PipelineConfig in the config view layout

#### Scenario: Section hidden during execution

- **WHEN** the processing phase is `preparing`, `running`, `finalizing`, or `cancelling`
- **THEN** the Population Analysis section SHALL NOT be visible

#### Scenario: Interrupted configuration remains editable

- **WHEN** processing is `interrupted` and external-stop confirmation is pending
- **THEN** the Population Analysis section SHALL remain visible and its checkbox SHALL obey module/eligibility constraints rather than an interruption-specific edit lock
- **AND** another run SHALL remain blocked until the required native confirmation and acknowledgement complete

### Requirement: Population Module Checkbox

Population selection SHALL require independent module execution and at least one eligible subject/session, applying its specified Structural and any-run ASL predicate rather than an all-run aggregate.

#### Scenario: Population eligibility or module selection changes

- **WHEN** the Population checkbox evaluates available statuses and selected modules
- **THEN** disabled state, effective predicate, and explanatory tooltips SHALL follow these rules:

The Population Analysis section SHALL contain a checkbox labeled "Enable population analysis". The checkbox SHALL be disabled when either Structural or ASL is selected in the Pipeline Configuration Panel, or when no available subject/session has a Structural row with status `complete` and at least one ASL row with status `complete` or `outdated`. Structural `outdated` SHALL NOT satisfy this predicate. The ASL check SHALL NOT require every run to be complete and SHALL NOT use the aggregate all-run status rule. When disabled, a tooltip SHALL explain the unmet constraint(s). If Structural or ASL is selected, the tooltip SHALL read: "Population must run independently. Deselect Structural and ASL modules to enable." If no subject/sessions are eligible, the tooltip SHALL read: "At least one subject/session must have both Structural and ASL complete." If both constraints are unmet, both messages SHALL be joined. This explanatory copy SHALL NOT redefine the effective eligibility predicate.

#### Scenario: Checkbox enabled when prerequisites met

- **WHEN** neither Structural nor ASL is selected in PipelineConfig AND at least one available subject/session has Structural `complete` and at least one ASL row `complete` or `outdated`
- **THEN** the Population checkbox SHALL be enabled

#### Scenario: One outdated ASL run satisfies eligibility

- **WHEN** neither Structural nor ASL is selected and an available subject/session has Structural `complete`, one ASL run `outdated`, and another ASL run `incomplete`
- **THEN** that subject/session SHALL be eligible and the Population checkbox SHALL be enabled

#### Scenario: Outdated Structural does not satisfy eligibility

- **WHEN** the only available subject/session has Structural `outdated` and ASL `complete`
- **THEN** the Population checkbox SHALL be disabled

#### Scenario: Checkbox disabled when Structural selected

- **WHEN** Structural is checked in PipelineConfig
- **THEN** the Population checkbox SHALL be disabled with tooltip explaining the constraint

#### Scenario: Checkbox disabled when ASL selected

- **WHEN** ASL is checked in PipelineConfig
- **THEN** the Population checkbox SHALL be disabled with tooltip explaining the constraint

#### Scenario: Checkbox disabled when no subjects eligible

- **WHEN** no available subject/session satisfies the Structural-complete and any-ASL-complete-or-outdated predicate
- **THEN** the Population checkbox SHALL be disabled with tooltip explaining the prerequisite

#### Scenario: Checkbox disabled when both constraints unmet

- **WHEN** Structural or ASL is selected AND no subjects are eligible
- **THEN** the Population checkbox SHALL be disabled with tooltip mentioning both constraints

### Requirement: Mutual Exclusivity Enforcement

When the user checks the Population checkbox, the store SHALL NOT allow Structural or ASL to be simultaneously selected. When the user checks Structural or ASL while Population is selected, Population SHALL be automatically deselected.

#### Scenario: Selecting Structural deselects Population

- **WHEN** Population is selected and the user checks Structural in PipelineConfig
- **THEN** Population SHALL be deselected and the Population section returns to its disabled/locked state

#### Scenario: Selecting ASL deselects Population

- **WHEN** Population is selected and the user checks ASL in PipelineConfig
- **THEN** Population SHALL be deselected and the Population section returns to its disabled/locked state

#### Scenario: Population checkbox toggle

- **WHEN** the user checks the Population checkbox (when enabled)
- **THEN** Population SHALL be added to `config.modules` and the worker count SHALL be forced to 1

### Requirement: Eligibility Summary

The Population Analysis section SHALL display "N/M subjects eligible (structural + ASL complete)". Despite the word "subjects", N SHALL count distinct eligible `subjectSession` identifiers in `availableSubjects` using the checkbox predicate, and M SHALL be `availableSubjects.length`, whose entries represent subject/session pairs. Multiple sessions of one subject SHALL NOT be collapsed into one subject. The summary SHALL use the available roster, not only the selected subject/sessions.

#### Scenario: All subject/sessions eligible

- **WHEN** all available subject/session entries satisfy the checkbox eligibility predicate
- **THEN** the summary SHALL read "M/M subjects eligible (structural + ASL complete)"

#### Scenario: No subject/sessions eligible

- **WHEN** no available subject/session satisfies the checkbox eligibility predicate
- **THEN** the summary SHALL read "0/M subjects eligible (structural + ASL complete)"

#### Scenario: Partial eligibility

- **WHEN** 50 of 100 available subject/session entries are eligible
- **THEN** the summary SHALL read "50/100 subjects eligible (structural + ASL complete)"

#### Scenario: Multiple sessions count separately

- **WHEN** one subject has two available sessions and only one satisfies the eligibility predicate
- **THEN** the summary SHALL read "1/2 subjects eligible (structural + ASL complete)"

### Requirement: Prerequisites Explanation

The Population Analysis section SHALL display a brief explanation of prerequisites below the eligibility summary. Text: "Population analysis requires at least one subject/session with both Structural and ASL modules complete. Population runs independently and cannot be combined with other modules." This text SHALL remain explanatory; the effective checkbox gate SHALL still accept an ASL `outdated` row and SHALL NOT require all ASL runs to be complete.

#### Scenario: Prerequisites text always visible

- **WHEN** the Population Analysis section is rendered
- **THEN** the prerequisites explanation text SHALL be visible regardless of checkbox state

### Requirement: Atlas Recap

The Population Analysis section SHALL display a read-only list of atlases configured in the Parameters phase. Atlas keys SHALL be read from the accepted project's `dataPar.Atlases` and displayed as badges after "Atlases:", using `ATLAS_DISPLAY_LABELS` where available and the raw key otherwise, with a note "Configured in Parameters".

#### Scenario: Atlases configured

- **WHEN** `dataPar.Atlases` contains `["Total", "DeepWM", "Hammers"]`
- **THEN** the section SHALL display badges for those three atlases using their display labels, with "Configured in Parameters" note

#### Scenario: No atlases configured

- **WHEN** `dataPar.Atlases` is empty or undefined
- **THEN** the section SHALL display "No atlases configured" with a link or note to configure in Parameters

### Requirement: Population Log Button

The Population Analysis section SHALL show dimmed "No Logs" text when no Population log file exists, rather than a disabled button. When a log file exists, it SHALL show a clickable outlined badge that opens the `LogViewerModal` with Population module logs. The badge SHALL read "View Errors" in red if any discovered Population log has `hasError = true`; otherwise it SHALL read "View Logs" in teal. This label SHALL depend on log error flags, not the Population module status.

#### Scenario: No log file exists

- **WHEN** no Population log file has been created
- **THEN** dimmed "No Logs" text SHALL appear without a disabled log button

#### Scenario: Log file exists

- **WHEN** a Population log file exists with no error flag
- **THEN** clicking the "View Logs" badge SHALL open the LogViewerModal displaying the Population log content

#### Scenario: Error log exists

- **WHEN** a discovered Population log file has `hasError = true`, even if Population status is `complete`
- **THEN** the badge SHALL display "View Errors" in red instead of "View Logs"
