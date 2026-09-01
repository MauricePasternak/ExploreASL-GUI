## MODIFIED Requirements

### Requirement: Process Configuration

The `ProcessConfig` object SHALL replace `matlabPath: string` and `exploreAslPath: string` with `selectedProfileId: string`. The store SHALL resolve the full profile object from `globalStore.settings.executionProfiles` using `selectedProfileId` at execution time. The remaining `ProcessConfig` fields SHALL be unchanged: `subjects` (array of selected SubjectSession strings), `modules` (array of `structural`, `asl`, `population`), and `workers` (integer). `subjectRegexp` remains a runtime-generated value, not a stored config field.

The `ProcessConfigSchema` SHALL be updated to:

```
z.object({
  subjects: z.array(z.string()),
  modules: z.array(z.enum(PROCESSING_MODULES)),
  selectedProfileId: z.string(),
  workers: z.number().int().min(1),
})
```

`setConfig` mutual exclusivity between Population and Structural/ASL SHALL remain unchanged.

Before calling `run_pipeline`, `startProcessing` SHALL:

1. Resolve the profile via `globalStore.getProfileById(selectedProfileId)`. If not found, show an inline error ("Selected profile was deleted or is invalid") and block execution. Do NOT transition to `failed` pipeline state — this is a config error, not a pipeline failure.
2. Check `globalStore.profileValidationState[selectedProfileId]`. If not valid, show an inline error with the validation errors and block execution. Do NOT transition to `failed`.
3. If the population module is selected, call `capture_environment_versions` with the resolved profile's `exploreAslPath` and `matlabPath` (signature unchanged, just resolved from profile instead of config), and store the result alongside `profileId` via `setLastRunProfileId("population", profileId, { exploreASLVersion, matlabVersion, guiVersion })`.
4. Only if all checks pass, invoke `run_pipeline` with the typed `ExecutionProfile` object.

#### Scenario: Config with selected profile

- **WHEN** the user selects a profile with ID "abc-123" and 2 subjects, then clicks Start
- **THEN** `ProcessConfig` SHALL contain `{ selectedProfileId: "abc-123", subjects: [...], modules: [...], workers: N }`

#### Scenario: Profile resolved and validated at execution time

- **WHEN** `startProcessing` is called with `config.selectedProfileId = "abc-123"` and the profile is valid
- **THEN** the store SHALL resolve the profile, confirm it is valid, and pass it as a typed `ExecutionProfile` object to `run_pipeline`

#### Scenario: Population module stores profileId alongside version strings

- **WHEN** `startProcessing` is called with population module selected and profile "abc-123"
- **THEN** `setLastRunProfileId("population", "abc-123", { exploreASLVersion: "1.11.0", matlabVersion: "R2024b", guiVersion: "0.1.0" })` SHALL be called, storing `profileId` AND version strings in `population.lastRun`

#### Scenario: Profile not found at execution time

- **WHEN** `startProcessing` is called but `config.selectedProfileId` references a deleted profile
- **THEN** the store SHALL show an inline error ("Selected profile was deleted or is invalid") and SHALL NOT invoke `run_pipeline`. The store SHALL NOT transition to `failed` pipeline state — no pipeline process exists yet.

#### Scenario: Profile invalid at execution time

- **WHEN** `startProcessing` is called but `profileValidationState[selectedProfileId].valid` is `false`
- **THEN** the store SHALL show an inline error with the validation errors and SHALL NOT invoke `run_pipeline`. The store SHALL NOT transition to `failed` pipeline state.

#### Scenario: Population module still forces single worker

- **WHEN** the user selects the Population module
- **THEN** `workers` SHALL still be forced to 1 regardless of the selected profile

---

### Requirement: Last Run Config Persistence

The store SHALL persist the last run configuration (`ProcessConfig`) to the `.easl` project file under `uiState.processingConfig`. The persisted `ProcessConfig` SHALL use `selectedProfileId` instead of `matlabPath` and `exploreAslPath`. On page load, the config form SHALL be pre-filled with the last run's values, including the `selectedProfileId`. If the referenced profile no longer exists in global settings, the profile selector SHALL show a "Profile not found" indicator.

#### Scenario: Config restoration on page load

- **WHEN** the user navigates to the processing page after a previous run
- **THEN** the subject selection, module checkboxes, profile selector, and worker count SHALL be pre-filled from the persisted config

#### Scenario: Persisted profile no longer exists

- **WHEN** the persisted `selectedProfileId` does not match any profile in `executionProfiles`
- **THEN** the profile selector SHALL show "(Profile not found)" and the Start button SHALL be disabled until a valid profile is selected
