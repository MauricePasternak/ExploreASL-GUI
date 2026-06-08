## Requirements

### Requirement: ImportProgress state shape

The `ImportProgress` type in the import store SHALL be extended to include: `errorStep?: "DCM2NII" | "NII2BIDS"` (which step failed), `warnings?: string[]` (collected warning messages from stdout), and `duration?: number` (processing duration in seconds, parsed from `Job-iteration N stopped at ... and took S seconds`). The `status` field SHALL support values: `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`.

#### Scenario: Subject fails at NII2BIDS step
- **WHEN** an `import_failed` event is parsed for subject BADDIE with step NII2BIDS
- **THEN** `importProgress["BADDIE"].status` is set to `"failed"`, `errorStep` is `"NII2BIDS"`, and `error` contains the failure message

#### Scenario: Subject succeeds with warnings
- **WHEN** subject GOOD completes processing with stdout warnings but no failures
- **THEN** `importProgress["GOOD"].status` is `"completed"`, `warnings` array contains parsed warning messages, `duration` contains the seconds value

#### Scenario: Subject cancelled by user
- **WHEN** user clicks "Stop" while subject INPROGRESS is in `"running"` state
- **THEN** `importProgress["INPROGRESS"].status` is set to `"cancelled"`

### Requirement: Import store additions

The import store SHALL add: `importCompleted: boolean` (defaults to `false`, set to `true` when all subjects complete successfully), `importLog: string[]` (accumulated raw stdout lines from `ImportRawEvent`), and `importPhase: "idle" | "preparing" | "running" | "completed" | "failed" | "cancelled"` (defaults to `"idle"`). The `importCompleted` flag SHALL be persisted in the project file under `uiState.importCompleted`.

#### Scenario: Import starts
- **WHEN** user clicks "Run Import"
- **THEN** `importPhase` transitions from `"idle"` to `"preparing"`, `importLog` is cleared

#### Scenario: Import completes successfully
- **WHEN** all subjects succeed and post-processing finishes
- **THEN** `importPhase` is `"completed"`, `importCompleted` is `true`, both are persisted to project file

#### Scenario: Page reload after successful import
- **WHEN** user reopens a project where `importCompleted` was `true`
- **THEN** step 5 shows the completed summary without re-running import

#### Scenario: Stale running state on reload (V0)
- **WHEN** user reopens a project where `importPhase` was `"running"` (frontend reload during import)
- **THEN** a warning is shown: "Previous import may be running. Check status or retry."

### Requirement: Subject error detail matching

When an `import_failed` event is received, the system SHALL match the failure description against the known subject list from `importProgress` keys. For each known subject, if the subject name appears as a substring in the failure description, that subject is marked as failed. The full message line following the failure pattern (e.g., `Message: ...`) SHALL be captured as the error detail.

#### Scenario: Subject name with underscores in failure description
- **WHEN** stderr contains `NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1` and known subjects include "BADDIE"
- **THEN** subject "BADDIE" is matched because "BADDIE" appears in the description string, error detail captures the subsequent `Message:` line

#### Scenario: Multiple subjects in single failure line
- **WHEN** a failure line references multiple subjects
- **THEN** each matching known subject is marked as failed with the same error detail

### Requirement: ImportProgress table population

The progress table SHALL be populated immediately when `importPhase` transitions to `"preparing"`, using subject names from the staging mappings. All subjects start with `status: "pending"`. As `subject_start` events arrive, matching subjects transition to `"running"`. As `subject_complete` or `import_failed` events arrive, subjects transition to `"completed"` or `"failed"`.

#### Scenario: Table shows all subjects before MATLAB starts
- **WHEN** the user clicks "Run Import" and import phase enters `"preparing"`
- **THEN** the progress table lists all subjects with status "pending" before any MATLAB output arrives

#### Scenario: Subject starts processing
- **WHEN** a `subject_start` event arrives for subject "GOOD"
- **THEN** `importProgress["GOOD"].status` transitions from `"pending"` to `"running"`
