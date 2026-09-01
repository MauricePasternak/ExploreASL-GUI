## Why

The GUI currently hardcodes a single execution method: spawning a local MATLAB process via `matlab -batch "addpath(...); ExploreASL(...)"`. The `matlabPath` and `exploreAslPath` are scattered across global settings (`matlabInstallations[]`, `exploreAslPath`) and per-run config (`ProcessConfig.matlabPath`, `ProcessConfig.exploreAslPath`) without a unifying abstraction. This makes it impossible to support alternative execution methods — compiled binaries, Docker containers, or Apptainer images — that research groups increasingly rely on. The execution method is also not a first-class concept: the Import and Processing pages each independently resolve MATLAB paths from global settings, with no shared contract.

Introducing **Execution Profiles** — named, typed, globally-stored configuration recipes — creates the abstraction layer needed to support multiple execution backends behind a single interface. Phase 1 implements the profile infrastructure with only the `matlab` variant, refactoring the existing scattered config into the new model. Future phases add `compiled`, `docker`, and `apptainer` variants without architectural changes.

## What Changes

- **New concept**: Execution Profiles — globally-defined, typed configuration objects that describe how to invoke ExploreASL. Each profile has a discriminated `type` field (`matlab` in Phase 1) and type-specific configuration.
- **BREAKING**: `matlabInstallations[]` and top-level `exploreAslPath` / `exploreAslVersion` in global `settings.json` are replaced by `executionProfiles[]`. No migration — V0 is a fresh start. The old schema fields are removed entirely.
- **BREAKING**: `ProcessConfig.matlabPath` and `ProcessConfig.exploreAslPath` are replaced by `ProcessConfig.selectedProfileId`. No Zod `.preprocess()` migration.
- **BREAKING**: `run_import_pipeline` and `run_pipeline` Rust commands change signature: instead of receiving `matlab_path` and `explore_asl_path` as separate strings, they receive a typed `ExecutionProfile` object (serde-tagged enum, deserialized natively by Tauri).
- The Import page's "MATLAB version dropdown" and Processing page's MATLAB selection both become a unified **Profile selector** dropdown.
- Rust-side profile validation: two new Tauri commands (`validate_execution_profile`, `validate_all_execution_profiles`) provide filesystem validation via a shared `ProfileValidationResult` struct. All commands (`run_import_pipeline`, `run_pipeline`, validation) accept the typed `ExecutionProfile` enum directly — no manual JSON wrapping.
- The global Settings modal gains a **Profile Management** section (CRUD for profiles) replacing the current MATLAB installations list and ExploreASL path input.
- Profile validation is **blocking** — paths are validated when the user saves a profile.

## Capabilities

### New Capabilities

- `execution-profiles`: Defines the Execution Profile schema (discriminated union with `matlab` variant for Phase 1), global storage in `settings.json`, per-project/per-phase binding via `selectedProfileId`, profile CRUD management UI in global settings, profile selector UI on Import and Processing pages, blocking validation on profile save, and migration from legacy `matlabInstallations` + `exploreAslPath` settings.

### Modified Capabilities

- `import-execution`: The `run_import_pipeline` Rust command changes from accepting `matlab_path` and `exploreasl_path` as separate string parameters to accepting a serialized `ExecutionProfile` JSON object. The MATLAB executable selection dropdown changes from listing `matlabInstallations` to listing execution profiles. The command construction logic moves from hardcoded MATLAB invocation to profile-driven dispatch.
- `processing-backend`: The `run_pipeline` Rust command changes from accepting `matlab_path` and `explore_asl_path` as separate strings to accepting a serialized `ExecutionProfile` JSON. The worker invocation pattern changes from hardcoded `matlab -batch` to profile-driven command construction. `detect_exploreasl_version` may need to account for profile type (only meaningful for `matlab` profiles in Phase 1).
- `processing-store`: `ProcessConfig` replaces `matlabPath` and `exploreAslPath` fields with `selectedProfileId: string`. The config form pre-fill and persistence logic updates accordingly.
- `import-store`: The MATLAB path selection in import config is replaced with profile selection. The `mostRecentConfig` / `ImportSnapshot` type may need to capture the selected profile ID instead of raw paths.
- `project-store`: The persisted `uiState.processingConfig` shape changes to include `selectedProfileId` instead of `matlabPath` / `exploreAslPath`. Migration logic needed for existing `.easl` files.

## Impact

- **Rust backend** (`src-tauri/src/`): `run_import_pipeline` and `run_pipeline` command signatures change. A new `ExecutionProfile` struct (Rust-side deserialization target) is needed. Command construction logic is refactored to dispatch on profile type.
- **Frontend schemas** (`src/schemas/`): New `ExecutionProfileSchema` (Zod discriminated union). `GlobalSettingsSchema` loses `matlabInstallations`, `exploreAslPath`, `exploreAslVersion` and gains `executionProfiles[]`. `ProcessConfigSchema` gains `selectedProfileId`, loses `matlabPath` / `exploreAslPath`.
- **Frontend stores**: Global settings store, import store, and processing store all update to work with profiles instead of raw paths.
- **UI components**: Settings modal profile management section (new). Import step 5 and Processing page dropdowns change from MATLAB installation picker to profile picker.
- **Migration**: Auto-migration for both `settings.json` (global) and `.easl` (per-project) files. Backward-compatible Zod `.preprocess()` transforms handle legacy data.
- **Existing specs**: Five existing specs have requirement-level changes (see Modified Capabilities above).
