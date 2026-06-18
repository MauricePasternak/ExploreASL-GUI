# population-analysis-section Specification

## Purpose
Define requirements and scenarios for the dedicated Population Analysis layout section on the Processing page, detailing eligibility, atlas recap, log viewing, and configuration settings.

## Requirements

### Requirement: Population Analysis Section Layout
A dedicated Population Analysis section SHALL be rendered on the Processing page between the Pipeline Configuration Panel and Pre-flight Validation sections. The section SHALL be a Card with a title "Population Analysis". It SHALL only be visible when the processing phase is `idle`, `completed`, `failed`, or `cancelled` (same visibility as the config view).

#### Scenario: Section appears in correct position
- **WHEN** the user views the Processing page in idle state
- **THEN** the Population Analysis section SHALL appear between PipelineConfig and PreflightCheck

#### Scenario: Section hidden during execution
- **WHEN** the processing phase is `running` or `preparing`
- **THEN** the Population Analysis section SHALL NOT be visible

### Requirement: Population Module Checkbox
The Population Analysis section SHALL contain a checkbox labeled "Enable population analysis". The checkbox SHALL be disabled when either Structural or ASL is selected in the Pipeline Configuration Panel, or when no subject/session has both Structural and ASL status `complete`. When disabled, a tooltip SHALL explain the unmet constraint(s). If Structural or ASL is selected, the tooltip SHALL read: "Population must run independently. Deselect Structural and ASL modules to enable." If no subjects are eligible, the tooltip SHALL read: "At least one subject/session must have both Structural and ASL complete." If both constraints are unmet, both messages SHALL be joined.

#### Scenario: Checkbox enabled when prerequisites met
- **WHEN** no modules are selected in PipelineConfig AND at least one subject/session has both Structural and ASL status `complete`
- **THEN** the Population checkbox SHALL be enabled

#### Scenario: Checkbox disabled when Structural selected
- **WHEN** Structural is checked in PipelineConfig
- **THEN** the Population checkbox SHALL be disabled with tooltip explaining the constraint

#### Scenario: Checkbox disabled when ASL selected
- **WHEN** ASL is checked in PipelineConfig
- **THEN** the Population checkbox SHALL be disabled with tooltip explaining the constraint

#### Scenario: Checkbox disabled when no subjects eligible
- **WHEN** no subject/session has both Structural and ASL status `complete`
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
The Population Analysis section SHALL display a text summary of subject eligibility. The summary SHALL read: "N/M subjects eligible (structural + ASL complete)" where N is the count of subjects with at least one session having both Structural and ASL status `complete`, and M is the total number of available subjects.

#### Scenario: All subjects eligible
- **WHEN** all subjects have at least one session with both Structural and ASL complete
- **THEN** the summary SHALL read "M/M subjects eligible (structural + ASL complete)"

#### Scenario: No subjects eligible
- **WHEN** no subjects have both Structural and ASL complete
- **THEN** the summary SHALL read "0/M subjects eligible (structural + ASL complete)"

#### Scenario: Partial eligibility
- **WHEN** 50 of 100 subjects are eligible
- **THEN** the summary SHALL read "50/100 subjects eligible (structural + ASL complete)"

### Requirement: Prerequisites Explanation
The Population Analysis section SHALL display a brief explanation of prerequisites below the eligibility summary. Text: "Population analysis requires at least one subject/session with both Structural and ASL modules complete. Population runs independently and cannot be combined with other modules."

#### Scenario: Prerequisites text always visible
- **WHEN** the Population Analysis section is rendered
- **THEN** the prerequisites explanation text SHALL be visible regardless of checkbox state

### Requirement: Atlas Recap
The Population Analysis section SHALL display a read-only list of atlases configured in the Parameters phase. The atlas names SHALL be read from `dataPar.Atlases` in the `dataParStore`. Display format: "Atlases: atlas1, atlas2, atlas3" with a note "Configured in Parameters".

#### Scenario: Atlases configured
- **WHEN** `dataPar.Atlases` contains `["Total", "DeepWM", "Hammers"]`
- **THEN** the section SHALL display "Atlases: Total, DeepWM, Hammers" with "Configured in Parameters" note

#### Scenario: No atlases configured
- **WHEN** `dataPar.Atlases` is empty or undefined
- **THEN** the section SHALL display "No atlases configured" with a link or note to configure in Parameters

### Requirement: Population Log Button
The Population Analysis section SHALL contain a "View Logs" button for the Population module log. The button SHALL be greyed out (disabled) when no Population log file exists. When a log file exists, the button SHALL be active and open the `LogViewerModal` with Population module logs.

#### Scenario: No log file exists
- **WHEN** no Population log file has been created
- **THEN** the "View Logs" button SHALL be disabled

#### Scenario: Log file exists
- **WHEN** a Population log file exists
- **THEN** clicking "View Logs" SHALL open the LogViewerModal displaying the Population log content

#### Scenario: Error log exists
- **WHEN** a Population log file exists with errors
- **THEN** the button SHALL display "View Errors" in red instead of "View Logs"
