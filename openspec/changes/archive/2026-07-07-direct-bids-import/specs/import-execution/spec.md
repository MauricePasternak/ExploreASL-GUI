## ADDED Requirements

### Requirement: canAccessPhase dispatches on dataSource

`canAccessPhase(project, targetPhase)` SHALL implement the phase gating logic:

- `idx = PROJECT_PHASES.indexOf(targetPhase)`, `currentIdx = PROJECT_PHASES.indexOf(project.projectMeta.currentPhase)`.
- If `idx <= currentIdx` → return `true`.
- If `targetPhase === "parameters"` → return `true`.
- If `targetPhase === "processing"` → dispatch on `dataSource`:
  - `dataSource === "bids"` → return `project.uiState?.import?.bidsReviewConfirmed === true`
  - `dataSource === "dicom"` → return `project.uiState?.import?.completed === true`
- If `targetPhase === "visualization" || targetPhase === "manifest"` → return `project.uiState?.population?.completed === true`.
- Else → return `false`.

`dataSource` is required (no fallback default per `ProjectMetaSchema`). Existing test fixtures that omitted `dataSource` MUST be updated to set it explicitly.

#### Scenario: BIDS project before confirmation blocked from processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = false`
- **THEN** returns `false`

#### Scenario: BIDS project after confirmation reaches processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = true`
- **THEN** returns `true`

#### Scenario: DICOM project gate unchanged

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "dicom"` and `uiState.import.completed = true`
- **THEN** returns `true`

### Requirement: ImportPage conditional rendering

`ImportPage` SHALL render based on `project.projectMeta.dataSource`:

- `"bids"` → render `BIDSReviewPanel`
- `"dicom"` → render the existing 6-step DICOM wizard

When `uiState.import.bidsReviewConfirmed = true` and user revisits Import on a BIDS project, `BIDSReviewPanel` renders a persisted summary with explicit re-scan/re-confirm capability.

#### Scenario: BIDS project lands on review panel

- **WHEN** user creates a BIDS-direct project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders `BIDSReviewPanel` (not the 6-step wizard)

#### Scenario: DICOM project lands on wizard

- **WHEN** user creates a DICOM project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders the existing 6-step DICOM wizard

#### Scenario: BIDS project revisit supports re-sync

- **WHEN** user with `bidsReviewConfirmed = true` navigates back to Import on a BIDS-direct project
- **THEN** `ImportPage` renders `BIDSReviewPanel` with persisted summary and `[Re-scan BIDS]`
