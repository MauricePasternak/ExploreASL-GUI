# project-store Specification

## Purpose
TBD - created by archiving change processing-module. Update Purpose after archive.
## Requirements
### Requirement: Processing Config Persistence
The project store SHALL persist `processingConfig` and `processingPhase` in the `.easl` project file under `uiState`. The `ProjectFileSchema` SHALL be extended with optional `processingConfig` and `processingPhase` fields. When saving, the project store SHALL sync the processing store's config and phase into the project file.

#### Scenario: Config saved on processing start
- **WHEN** the user clicks Start on the processing page
- **THEN** the current `ProcessConfig` and `processingPhase` SHALL be written to `uiState.processingConfig` and `uiState.importPhase` in the `.easl` file

#### Scenario: Config restored on project load
- **WHEN** a project with a prior processing run is opened
- **THEN** the processing store SHALL be hydrated from `uiState.processingConfig` and the subject selection form SHALL be pre-filled

