## MODIFIED Requirements

### Requirement: run_pipeline Command

The `run_pipeline` Tauri command SHALL replace the `matlab_path: String` and `explore_asl_path: String` parameters with a single `execution_profile: ExecutionProfile` parameter. Tauri handles deserialization natively from the typed object. The command SHALL dispatch on the profile `type` and construct the appropriate command. For the `matlab` type, the command SHALL construct worker invocations using the profile's `matlabPath` and `exploreAslPath`.

The full updated signature SHALL be: `run_pipeline(project_root, execution_profile, data_par_json, b_process, workers, subject_regexp)`.

**Preparation-phase validation**: Before performing any destructive operations (writing `dataPar.json`, clearing stale locks, deleting `.status` files, deleting log files), the command SHALL call `execution_profile.validate()`. Only after validation passes SHALL the command proceed to the existing preparation steps and worker spawning.

This provides a final safety net even though the frontend validates profiles on selection and before calling the command.

#### Scenario: Processing with MATLAB profile

- **WHEN** `run_pipeline` is called with `execution_profile` being a `Matlab` variant with valid paths
- **THEN** path validation passes, preparation proceeds, and workers are spawned

#### Scenario: Invalid profile type

- **WHEN** `run_pipeline` is called with an `execution_profile` of an unknown type
- **THEN** deserialization fails with a serde error and the command SHALL NOT spawn workers or perform any destructive preparation steps

#### Scenario: Profile paths invalid at execution time

- **WHEN** `run_pipeline` is called with a `Matlab` variant whose `matlabPath` no longer exists on disk
- **THEN** the command SHALL return an error describing the missing executable, no `dataPar.json` is written, no lock files are deleted

---

### Requirement: Worker Invocation Pattern

Each worker SHALL be invoked using the execution profile to determine the command. For `matlab` profiles, the invocation pattern SHALL remain: `<profile.matlabPath> -batch "addpath('<profile.exploreAslPath>'); ExploreASL('<project_root>', 0, [<b_process>], 0, <iWorker>, <nWorkers>)"`. The profile's paths SHALL be used instead of separate `matlab_path` and `explore_asl_path` command arguments.

#### Scenario: Three workers with MATLAB profile

- **WHEN** `workers = 3`, `b_process = [true, true, false]`, and the execution profile is a `MatlabProfile`
- **THEN** 3 MATLAB processes SHALL be spawned using `profile.matlabPath` with `iWorker` values 1, 2, 3

---

### Requirement: ExploreASL Version Detection

The `detect_exploreasl_version` Tauri command SHALL remain unchanged. Its usage SHALL shift from being called with the global `exploreAslPath` to being called with the `exploreAslPath` from the selected execution profile. The version SHALL be detected:

1. **On app startup**: during `validate_all_execution_profiles`, each profile's `exploreAslVersion` SHALL be re-detected and persisted if changed. Save-time validation does NOT detect versions — it is path-existence only.
2. **During preparation phase of `run_pipeline`**: the version SHALL be extracted from the deserialized profile's `exploreAslVersion` field (or re-detected from `exploreAslPath`) and logged.
3. **At pipeline runtime**: `capture_environment_versions` (unchanged signature) captures actual on-disk versions. This result is stored in `lastRun` alongside the `profileId` for an accurate historical record.

The Settings modal SHALL display the detected version on each profile's ExploreASL path input, rather than as a single global indicator.

#### Scenario: Version detected from profile on startup validation

- **WHEN** startup validation runs and a `MatlabProfile` has `exploreAslPath` pointing to a directory containing `VERSION_1.11.0`
- **THEN** `profile.exploreAslVersion` SHALL be set to `"1.11.0"` and persisted if changed from the stored value

#### Scenario: Version logged during preparation from profile

- **WHEN** `run_pipeline` is called with a `MatlabProfile` that has `exploreAslVersion: "1.11.0"`
- **THEN** the version `"1.11.0"` SHALL be logged via `log::info!` before any destructive operations
