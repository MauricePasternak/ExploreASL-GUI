## MODIFIED Requirements

### Requirement: Import execution pipeline

The `run_import_pipeline` Tauri command SHALL replace the `matlab_path: String` and `exploreasl_path: String` parameters with a single `execution_profile: ExecutionProfile` parameter. Tauri handles deserialization natively from the typed object. The command SHALL dispatch on the profile `type` and construct the appropriate command. For the `matlab` type, the command SHALL construct `matlab -batch "addpath('<exploreAslPath>'); ExploreASL('<staging_root>', [1,1,0], 0, 0)"` using the `matlabPath` and `exploreAslPath` from the profile.

The full updated signature SHALL be: `run_import_pipeline(staging_root, staging_entries, sourcestructure_json, studypar_json, execution_profile, subject_list, subjects_to_preserve)`.

**Preparation-phase validation**: Before performing any destructive operations (deleting `.easl_staging/`, creating symlinks, writing configs), the command SHALL call `execution_profile.validate()`. Only after validation passes SHALL the command proceed to staging directory setup.

This provides a final safety net even though the frontend validates profiles on selection and before calling the command.

#### Scenario: Successful import with MATLAB profile

- **WHEN** `run_import_pipeline` is called with `execution_profile` being a `Matlab` variant
- **THEN** MATLAB is spawned using the profile's `matlabPath`, and `addpath` uses the profile's `exploreAslPath`

#### Scenario: Invalid profile JSON

- **WHEN** `run_import_pipeline` is called with `execution_profile` containing an unknown type
- **THEN** the command SHALL return a serde deserialization error, no MATLAB process is spawned

#### Scenario: MATLAB not found at profile path

- **WHEN** `run_import_pipeline` is called with a `Matlab` variant whose `matlabPath` does not exist
- **THEN** the command SHALL return an error string describing the missing executable

---

### Requirement: MATLAB executable selection for import

This requirement is **replaced** by the Profile selector defined in the `execution-profiles` capability spec. The import step 5 execution view SHALL provide an Execution Profile select dropdown (replacing the MATLAB version select dropdown). The dropdown SHALL list all configured execution profiles from `globalStore.settings.executionProfiles`, displaying each profile's label and type. The selection SHALL be stored as `selectedProfileId`. The selected profile SHALL be serialized and passed to `runImportPipeline`.

If no execution profiles are configured, the "Start Import" button SHALL be disabled and an alert message SHALL be shown.

#### Scenario: Single profile

- **WHEN** `executionProfiles` has one entry
- **THEN** the dropdown shows that entry as the only option and it is pre-selected

#### Scenario: Multiple profiles

- **WHEN** `executionProfiles` has multiple entries
- **THEN** the dropdown lists all entries and the user can select which to use for import

#### Scenario: No profiles configured

- **WHEN** `executionProfiles` is empty
- **THEN** the "Start Import" button is disabled and an alert is shown

#### Scenario: Selected profile used for import

- **WHEN** the user selects a profile from the dropdown and clicks "Start Import"
- **THEN** `runImportPipeline` is called with the full typed `ExecutionProfile` object, not separate `matlabPath` / `exploreAslPath` strings
