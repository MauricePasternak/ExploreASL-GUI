## MODIFIED Requirements

### Requirement: Project Phases Tuple Extension

The `PROJECT_PHASES` constant SHALL include `"manifest"` appended after `"visualization"`. Its ordering SHALL be exactly `["import", "parameters", "processing", "visualization", "manifest"]`. Migration of a supported legacy `.easl` file SHALL preserve any current phase from the original four values without a phase-specific transformation, and schema v1 SHALL accept all five values.

#### Scenario: Existing project file loads without migration

- **WHEN** a legacy `.easl` file with `currentPhase: "visualization"` is migrated during project loading
- **THEN** the schema v1 project SHALL retain `projectMeta.currentPhase: "visualization"` without any phase-specific migration

#### Scenario: Project file explicitly set to manifest phase

- **WHEN** `projectStore.setPhase("manifest")` is called on a schema v1 project whose `uiState.processing.population.completed === true`
- **THEN** the resulting `.easl` payload SHALL have `projectMeta.currentPhase === "manifest"` and SHALL round-trip through schema v1 parsing
