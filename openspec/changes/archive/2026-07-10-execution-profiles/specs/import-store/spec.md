## MODIFIED Requirements

### Requirement: Import store MATLAB path selection

The import store SHALL replace `selectedMatlabPath: string` with `selectedProfileId: string | null`. The `selectedProfileId` SHALL reference a profile from `globalStore.settings.executionProfiles` and SHALL be persisted in the `.easl` project file under `uiState.import.selectedProfileId`. At import execution time (Start Import click), the store SHALL pre-validate: resolve the profile via `globalStore.getProfileById(selectedProfileId)`, check it still exists in the array and `profileValidationState[id].valid` is `true`. If the profile was deleted or is invalid, an inline error blocks execution without transitioning to `failed` pipeline state. If validation passes, serialize the profile to a typed `ExecutionProfile` object and pass it to `runImportPipeline` as the `execution_profile` parameter.

If `selectedProfileId` is empty or unset, the store SHALL auto-select the first valid profile from `executionProfiles` (using `profileValidationState` to determine validity). If no valid profiles exist, `selectedProfileId` remains empty and execution is blocked.

#### Scenario: Auto-select first valid profile

- **WHEN** the import execution view loads and `selectedProfileId` is empty, and `executionProfiles` has valid entries
- **THEN** `selectedProfileId` SHALL be set to the first valid profile's `id`

#### Scenario: Auto-select skips invalid profiles

- **WHEN** the import execution view loads, `selectedProfileId` is empty, and the first profile is invalid but the second is valid
- **THEN** `selectedProfileId` SHALL be set to the second (first valid) profile's `id`

#### Scenario: No valid profiles available

- **WHEN** all profiles are invalid or no profiles exist
- **THEN** `selectedProfileId` remains empty and the Start Import button is disabled

#### Scenario: Profile resolved and pre-validated for import

- **WHEN** the user clicks "Start Import" and `selectedProfileId` references a valid, existing profile
- **THEN** the full profile is resolved from the global store, pre-validated (exists in array + `profileValidationState[id].valid`), and passed as a typed `ExecutionProfile` object to the Rust command. No pipeline state transition occurs until the Rust command returns.

#### Scenario: Start Import clicked with deleted profile

- **WHEN** the user clicks "Start Import" but `selectedProfileId` references a profile deleted since the last selection
- **THEN** an inline error is shown ("Selected profile was deleted or is invalid"), execution is blocked, and the import store does NOT transition to `failed` pipeline state

#### Scenario: Selected profile deleted between visits

- **WHEN** `selectedProfileId` references a profile that was deleted since the last visit to step 5
- **THEN** the profile selector SHALL show "(Profile not found)" and the Start Import button SHALL be disabled

#### Scenario: selectedProfileId persisted to project file

- **WHEN** the user selects a profile for import and the project is saved
- **THEN** `uiState.import.selectedProfileId` SHALL be written to the `.easl` file

#### Scenario: selectedProfileId restored from project file

- **WHEN** a project is loaded that has `uiState.import.selectedProfileId: "abc-123"`
- **THEN** the import store's `selectedProfileId` SHALL be hydrated to `"abc-123"`

---

### Requirement: Import store additions — mostRecentConfig snapshot

The `ImportSnapshot` type SHALL capture `selectedProfileId: string` instead of raw `matlabPath` / `exploreAslPath` values. The `ImportSnapshotSchema` in `src/schemas/importSchemas.ts` SHALL be updated to include `selectedProfileId: z.string()`. When `startImport()` is called, the `mostRecentConfig` snapshot SHALL include the `selectedProfileId` that was used for the run.

#### Scenario: Import snapshot captures profile ID

- **WHEN** the user starts an import with profile "abc-123" selected
- **THEN** `mostRecentConfig.selectedProfileId` SHALL be `"abc-123"`
