# execution-profiles Specification

## Purpose

Unified execution profile abstraction replacing scattered MATLAB path configuration. Supports `matlab` profile type in Phase 1 with future variants (`compiled`, `docker`, `apptainer`). Profiles are globally-stored, validated at four lifecycle points, and referenced by projects via ID.

## Requirements

### Requirement: Execution Profile schema

The system SHALL define an `ExecutionProfileSchema` as a Zod discriminated union on the `type` field. All profile variants SHALL share a base shape containing: `id: z.string().uuid()`, `label: z.string().min(1)`, and `exploreAslVersion: z.string().optional()`. Phase 1 SHALL include only the `matlab` variant:

```
MatlabProfileSchema = ExecutionProfileBaseSchema.extend({
  type: z.literal("matlab"),
  matlabPath: z.string().min(1),
  exploreAslPath: z.string().min(1),
})
```

The discriminated union SHALL be defined as:

```
ExecutionProfileSchema = z.discriminatedUnion("type", [MatlabProfileSchema])
```

Future variants (`compiled`, `docker`, `apptainer`) SHALL be added by extending this union without changing the base or existing variants.

#### Scenario: Valid MATLAB profile parses successfully

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "550e8400-...", label: "MATLAB R2024b", type: "matlab", matlabPath: "/usr/local/MATLAB/R2024b/bin/matlab", exploreAslPath: "/home/user/ExploreASL" }`
- **THEN** the parse SHALL succeed and return a typed `MatlabProfile` object

#### Scenario: Missing matlabPath fails validation

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "...", label: "Test", type: "matlab", matlabPath: "", exploreAslPath: "/path" }`
- **THEN** the parse SHALL throw a Zod validation error for `matlabPath` (min length 1)

#### Scenario: Unknown type fails validation

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "...", label: "Test", type: "docker", ... }`
- **THEN** the parse SHALL throw a Zod validation error because `docker` is not a recognized discriminator value in Phase 1

#### Scenario: Missing label fails validation

- **WHEN** `ExecutionProfileSchema.parse()` is called with `{ id: "...", label: "", type: "matlab", matlabPath: "/path", exploreAslPath: "/path" }`
- **THEN** the parse SHALL throw a Zod validation error for `label` (min length 1)

---

### Requirement: Global profile storage

The `GlobalSettingsSchema` SHALL replace `matlabInstallations`, `exploreAslPath`, and `exploreAslVersion` with a single `executionProfiles: z.array(ExecutionProfileSchema).default([])` field. The global settings store SHALL provide actions: `addProfile(profile)`, `updateProfile(id, updates)`, `deleteProfile(id)`, and `getProfileById(id)`. Profile IDs SHALL be UUIDs generated on the frontend when creating a new profile.

Profile deletion SHALL NOT be blocked based on whether projects reference the profile. However, if deletion would result in zero remaining profiles, the system SHALL show a warning alert explaining that no ExploreASL execution will be possible and project creation/opening will be blocked. The deletion SHALL still proceed if the user confirms.

#### Scenario: Empty profiles list on fresh install

- **WHEN** the app is started for the first time with no `settings.json`
- **THEN** `executionProfiles` SHALL default to an empty array

#### Scenario: Add a new profile

- **WHEN** `addProfile()` is called with a valid `MatlabProfile` object
- **THEN** the profile SHALL be appended to `executionProfiles` and persisted to `settings.json`

#### Scenario: Update an existing profile

- **WHEN** `updateProfile(id, { label: "New Name" })` is called with a valid profile ID
- **THEN** the profile with that ID SHALL have its `label` updated and the change SHALL be persisted

#### Scenario: Delete a profile

- **WHEN** `deleteProfile(id)` is called
- **THEN** the profile with that ID SHALL be removed from `executionProfiles` and the change SHALL be persisted

#### Scenario: Delete last profile shows warning

- **WHEN** the user deletes the only remaining profile
- **THEN** a warning SHALL be shown: "Deleting this profile will prevent ExploreASL execution and project creation. Continue?" The deletion SHALL proceed on confirmation.

#### Scenario: Get profile by ID — found

- **WHEN** `getProfileById(id)` is called with an ID that exists in `executionProfiles`
- **THEN** the matching profile object SHALL be returned

#### Scenario: Get profile by ID — not found

- **WHEN** `getProfileById(id)` is called with an ID that does not exist
- **THEN** `undefined` SHALL be returned

---

### Requirement: App loading gate

The app SHALL block rendering of the main UI until settings have loaded and profile validation has completed. The initialization sequence SHALL be:

1. Show a loading indicator (e.g., centered spinner or skeleton).
2. Call `loadSettings()` to read `settings.json` from the plugin store.
3. Call `validateAllProfiles()` to validate all execution profiles (blocking).
4. Set `loaded: true` in the global store.
5. Render the main UI (landing page or project view).

This ensures the app never renders with stale default settings and that `profileValidationState` is populated before any UI decisions are made.

#### Scenario: App startup with valid profiles

- **WHEN** the app starts and settings load + validation complete in <500ms
- **THEN** the loading indicator is shown briefly, then the landing page renders with all profile-dependent state resolved

#### Scenario: App startup with no settings.json

- **WHEN** the app starts for the first time (no `settings.json` exists)
- **THEN** settings default to empty `executionProfiles`, validation completes immediately (nothing to validate), and the first-run onboarding is shown

---

### Requirement: First-run onboarding

When the app starts with zero execution profiles (first launch or all profiles deleted), the landing page SHALL display a **welcome card** instead of the normal "New Project" / "Open Project" controls. The welcome card SHALL:

1. Show a friendly heading: "Welcome to ExploreASL GUI" (or similar).
2. Provide a brief explanation: "To get started, you need to configure an execution profile that tells the app where to find MATLAB and ExploreASL."
3. Include numbered steps or visual guidance explaining the setup process.
4. Include a prominent "Open Settings" button that opens the Settings modal directly to the Execution Profiles section.
5. After the user creates and saves at least one valid profile and closes the Settings modal, the welcome card SHALL be replaced by the normal landing page controls (New Project, Open Project, recent projects).

The welcome card SHALL be shown whenever `executionProfiles` is empty, not only on first launch. This handles the case where a user deletes all profiles.

#### Scenario: First launch — welcome card shown

- **WHEN** the app starts with zero execution profiles
- **THEN** the landing page shows the welcome card with setup instructions and an "Open Settings" button; "New Project" and "Open Project" buttons are NOT shown

#### Scenario: Profile created — welcome card replaced

- **WHEN** the user creates a valid profile via Settings and closes the modal
- **THEN** the welcome card is replaced by the normal landing page with enabled "New Project" and "Open Project" buttons

#### Scenario: All profiles deleted — welcome card returns

- **WHEN** the user deletes all profiles via Settings and closes the modal
- **THEN** the landing page reverts to showing the welcome card

---

### Requirement: Profile validation — multi-phase

Profile validation SHALL occur at four points in the application lifecycle. The system SHALL maintain an in-memory `profileValidationState: Record<string, { valid: boolean, errors: string[] }>` in the global store. This state is NOT persisted — it is recomputed at each validation trigger. When validation runs, `exploreAslVersion` SHALL also be re-detected via the Rust validation command and updated on the profile if it has changed.

**`profileValidationState` reconciliation:** The state map SHALL mirror the `executionProfiles[]` array — one entry per profile, no gaps, no orphans. Store actions (`addProfile`, `updateProfile`, `deleteProfile`, `validateAllProfiles`) manage both the array and the state map atomically. Adding a profile: validate first, then persist the profile AND set its validation entry. Deleting a profile: remove from both array and map. No external code SHALL ever observe a profile in the array missing from the validation map. `hasValidProfile()` derives from `profiles.some(p => validationState[p.id]?.valid === true)`.

**Validation triggers:**

1. **On profile save** (blocking, <500ms): The frontend SHALL call `invoke("validate_execution_profile", { executionProfile })` before persisting. This is a fast operation — checks `matlabPath` is an executable file, `exploreAslPath` contains `ExploreASL.m`, and reads `exploreAslVersion` from VERSION file. No MATLAB process spawn. If `valid: false`, the save is blocked and errors are shown inline. If `valid: true`, the profile is persisted and `profileValidationState[id].valid` is set to `true`.
2. **On app startup** (blocking): After `loadSettings()`, the frontend SHALL call `invoke("validate_all_execution_profiles", { executionProfiles })` for all profiles. Results populate `profileValidationState`. Any profile whose returned `explore_asl_version` differs from the stored value SHALL be updated and persisted. A notification SHALL be shown listing invalid profiles.
3. **On profile switch** (non-blocking): When the user selects a different profile in a ProfileSelector dropdown, the frontend SHALL call `invoke("validate_execution_profile", { executionProfile })`. If invalid, a warning is shown and the Start button is disabled.
4. **During preparation phase** (blocking): `run_import_pipeline` and `run_pipeline` SHALL call `profile.validate()` internally before any destructive operations. If validation fails, the command SHALL return an error and no destructive operations SHALL occur.

#### Scenario: Valid profile on save

- **WHEN** the user saves a profile with valid MATLAB and ExploreASL paths
- **THEN** validation passes, profile is persisted, `profileValidationState[id].valid` is `true`, and `exploreAslVersion` is populated from the VERSION file (fast file read, no MATLAB spawn)

#### Scenario: Invalid MATLAB path blocks save

- **WHEN** the user enters `/nonexistent/matlab` as the MATLAB path and clicks Save
- **THEN** the save is blocked, an error "MATLAB executable not found at this path" is shown inline

#### Scenario: ExploreASL path missing ExploreASL.m blocks save

- **WHEN** the user enters a valid directory without `ExploreASL.m` and clicks Save
- **THEN** the save is blocked, an error "ExploreASL.m not found in this directory" is shown inline

#### Scenario: Startup validation finds invalid profile

- **WHEN** the app starts and profile "R2024b" has `matlabPath` pointing to an uninstalled MATLAB
- **THEN** `profileValidationState["<id>"].valid` is `false`, `errors` contains "MATLAB executable not found", a notification is shown: "Profile 'R2024b' is invalid: MATLAB executable not found"

#### Scenario: Startup validation all profiles valid

- **WHEN** the app starts and all profiles have valid paths
- **THEN** all `profileValidationState` entries have `valid: true`, no notification is shown

#### Scenario: Startup re-detects version change

- **WHEN** the app starts and a profile's `exploreAslVersion` is `"1.11.0"` but the directory now contains `VERSION_2.0.0`
- **THEN** `exploreAslVersion` SHALL be updated to `"2.0.0"` on the profile and persisted

#### Scenario: Profile switch validation — invalid profile selected

- **WHEN** the user selects a profile in the Import page dropdown and the profile's MATLAB path no longer exists
- **THEN** a warning alert is shown on the page: "Selected profile is invalid: MATLAB executable not found" and the Start Import button is disabled

#### Scenario: Profile switch validation — valid profile selected

- **WHEN** the user selects a profile and its paths are valid
- **THEN** no warning is shown, Start button is enabled, `profileValidationState` is updated

#### Scenario: Preparation-phase validation failure

- **WHEN** `run_import_pipeline` or `run_pipeline` is called and profile path validation fails on the Rust side
- **THEN** the command returns an error, no destructive operations (lock cleanup, status file deletion) are performed

#### Scenario: Preparation-phase validation success

- **WHEN** `run_import_pipeline` is called and profile paths are valid
- **THEN** preparation proceeds normally (symlink creation, config writing, MATLAB spawning)

---

### Requirement: Project gating on valid profiles

Creating or opening a project SHALL be blocked if no valid execution profiles exist. The system SHALL check `profileValidationState` after startup validation completes:

- If zero profiles exist, the first-run onboarding welcome card is shown (see above).
- If profiles exist but all are invalid, the app SHALL display a prominent alert message: "All execution profiles are invalid. Please fix a profile in Settings before creating or opening a project." The "New Project", "Open Project", and recent project links SHALL be disabled.
- The Settings modal SHALL remain accessible from the app's main interface regardless of whether a project is open, so the user can configure profiles first.
- Once the user configures at least one valid profile (e.g., closes the Settings modal after saving a valid profile), the gating SHALL be lifted immediately and project actions SHALL become enabled.

#### Scenario: No profiles exist — welcome card shown

- **WHEN** the app starts with zero execution profiles
- **THEN** the first-run onboarding welcome card is shown (per the onboarding requirement)

#### Scenario: All profiles invalid — project creation blocked

- **WHEN** the app starts with 2 profiles but both fail startup validation
- **THEN** "Create Project" and "Open Project" actions are disabled, an alert lists the invalid profiles and directs the user to Settings

#### Scenario: At least one valid profile — project creation allowed

- **WHEN** the app starts with 2 profiles and at least one passes validation
- **THEN** "Create Project" and "Open Project" actions are enabled

#### Scenario: Profile fixed in Settings — gating lifts

- **WHEN** no valid profiles exist, the user opens Settings, edits a profile to use valid paths, and saves
- **THEN** the gating is lifted immediately and project actions become enabled

#### Scenario: Settings accessible without project

- **WHEN** no project is open and no valid profiles exist
- **THEN** the Settings button in the app header SHALL be visible and functional

---

### Requirement: Execution blocking when all profiles invalid

Even when a project is already open, ExploreASL execution SHALL be blocked if no valid execution profiles exist. Specifically:

- The Import page's "Start Import" button SHALL be disabled with an alert when `executionProfiles` is empty or all profiles are invalid.
- The Processing page's "Run" button SHALL be disabled with an alert when `executionProfiles` is empty or all profiles are invalid.
- **Pre-validation on Start click:** Even when a profile is selected and appears valid in the selector, the Start button handler SHALL resolve the profile and check `profileValidationState` before invoking the Rust command. If the profile was deleted or became invalid, an inline error blocks execution without transitioning to `failed` pipeline state.
- The `ProcessingStatusAlert` component SHALL check `profileValidationState` and report profile-related errors in its preflight checks.

This covers the case where a user has a project open and then deletes all profiles via Settings.

#### Scenario: Project open, last profile deleted

- **WHEN** the user has a project open, opens Settings, and deletes all profiles
- **THEN** on the Import page: "Start Import" is disabled with alert "No valid execution profiles configured"
- **AND** on the Processing page: "Run" is disabled with alert "No valid execution profiles configured"

#### Scenario: Project open, profile becomes invalid

- **WHEN** the user has a project open and the selected profile's MATLAB is uninstalled (detected on profile switch or startup)
- **THEN** the Start/Run button for that phase is disabled with the specific validation error

---

### Requirement: Profile management UI in Settings modal

The Settings modal SHALL replace the "MATLAB Installations" list and "ExploreASL Path" input with an "Execution Profiles" section. This section SHALL display:

1. A list of existing profiles, each showing: profile label, type badge (e.g., "MATLAB"), a summary of key paths, and a validity indicator (green checkmark for valid, red warning icon for invalid with error tooltip).
2. An "Add Profile" button that opens an inline creation form.
3. Per-profile Edit and Delete action buttons.
4. The inline form SHALL render type-specific fields based on the selected `type`. For `matlab`:
   - `matlabPath`: a text input, a "Browse" button (file picker dialog), AND a "Detect MATLAB" button (calls the existing `which_matlab` Rust command to auto-detect MATLAB installations on the system).
   - `exploreAslPath`: a text input AND a "Browse" button (directory picker dialog).
5. A `label` field for the profile name.
6. Detected ExploreASL version SHALL be displayed as colored text below the `exploreAslPath` input: teal for detected version, orange for "not detected".

The "Detect MATLAB" button SHALL present a list of auto-detected MATLAB installations (if any found) and allow the user to select one, populating the `matlabPath` and `label` fields.

#### Scenario: Empty profiles list shows add button

- **WHEN** no profiles exist
- **THEN** the section SHALL display "No execution profiles configured" text and an "Add Profile" button

#### Scenario: Profile list with entries

- **WHEN** 2 profiles exist (e.g., "MATLAB R2024b" and "MATLAB R2023b")
- **THEN** both SHALL be listed with their labels, type badges, path summaries, and validity indicators

#### Scenario: Invalid profile shows warning icon

- **WHEN** a profile failed validation (e.g., MATLAB was uninstalled)
- **THEN** the profile row SHALL show a red warning icon with a tooltip describing the validation error

#### Scenario: Delete profile with confirmation

- **WHEN** the user clicks Delete on a profile
- **THEN** a confirmation dialog SHALL be shown before deletion

#### Scenario: Edit profile opens form

- **WHEN** the user clicks Edit on an existing profile
- **THEN** the inline form SHALL be populated with the profile's current values

#### Scenario: Auto-detect finds MATLAB installations

- **WHEN** the user clicks "Detect MATLAB" and the system has MATLAB installed
- **THEN** a list of detected installations is shown; selecting one populates `matlabPath` and `label`

#### Scenario: Auto-detect finds no MATLAB

- **WHEN** the user clicks "Detect MATLAB" and no MATLAB is found on the system
- **THEN** a message is shown: "No MATLAB installations found. Enter the path manually or use Browse."

---

### Requirement: Profile selector on Import page

The Import step 5 execution view SHALL replace the MATLAB version select dropdown with a Profile selector dropdown. The dropdown SHALL list all execution profiles from `globalStore.settings.executionProfiles`, displaying each profile's label, type badge, ExploreASL version (if available), and validity state. The selection SHALL be stored as `selectedProfileId` and persisted in the `.easl` project file under `uiState.import.selectedProfileId`. Invalid profiles SHALL be shown in the dropdown (so the user knows they exist) but SHALL be visually marked and SHALL disable the Start button when selected.

If no profiles are configured, the "Start Import" button SHALL be disabled and an alert SHALL be shown directing the user to configure a profile in Settings.

#### Scenario: Single profile available

- **WHEN** `executionProfiles` has one valid entry
- **THEN** the dropdown shows that profile as the only option and it is pre-selected

#### Scenario: Multiple profiles available

- **WHEN** `executionProfiles` has multiple entries
- **THEN** the dropdown lists all entries with labels and validity state; the user can select which to use

#### Scenario: No profiles configured

- **WHEN** `executionProfiles` is empty
- **THEN** the "Start Import" button is disabled and an alert is shown: "No execution profiles configured. Add one in Settings."

#### Scenario: Selected profile used for import

- **WHEN** the user selects a valid profile and clicks "Start Import"
- **THEN** the handler SHALL pre-validate: resolve the profile from `executionProfiles` (checking it still exists) and check `profileValidationState[id].valid`. If the profile was deleted or is invalid, an inline error SHALL be shown ("Selected profile was deleted or is invalid") and the Start button SHALL be disabled. No pipeline state transition occurs.
- **THEN** if pre-validation passes, `runImportPipeline` is called with the full typed `ExecutionProfile` object

#### Scenario: Start clicked with deleted profile

- **WHEN** the user clicks "Start Import" but the selected profile was deleted from Settings since the last selection
- **THEN** an inline error is shown: "Selected profile was deleted or is invalid" and execution is blocked. The import store SHALL NOT transition to `failed` pipeline state.

#### Scenario: Referenced profile deleted

- **WHEN** `selectedProfileId` references a profile that no longer exists in global settings
- **THEN** the dropdown SHALL show "(Profile not found)" and the "Start Import" button SHALL be disabled

#### Scenario: Invalid profile selected

- **WHEN** the user selects a profile that failed validation
- **THEN** a warning alert is shown and the "Start Import" button is disabled

---

### Requirement: Profile selector on Processing page

The Processing page SHALL replace the MATLAB selection dropdown with a Profile selector dropdown. The dropdown SHALL list all execution profiles from `globalStore.settings.executionProfiles` with validity indicators. The selection SHALL be stored as `selectedProfileId` in the processing config (replacing `matlabPath` and `exploreAslPath`). The selected profile SHALL be resolved to a full profile object and passed to `run_pipeline`. The Start button SHALL be disabled when the selected profile is invalid.

When the processing page first renders and no `selectedProfileId` has been set (e.g., new project or first visit to processing), the selector SHALL auto-select the first valid profile from `executionProfiles`.

#### Scenario: Config pre-fill from last run

- **WHEN** the user navigates to the processing page after a previous run
- **THEN** the profile selector SHALL be pre-filled with the `selectedProfileId` from the last run's config, if that profile still exists

#### Scenario: Last run profile deleted

- **WHEN** the persisted `selectedProfileId` references a deleted profile
- **THEN** the selector SHALL show "(Profile not found)" and the user MUST select a valid profile before starting

#### Scenario: Profile selected for processing

- **WHEN** the user selects a valid profile and clicks Start
- **THEN** the handler SHALL pre-validate the profile (resolved from `executionProfiles`, checked in `profileValidationState`). If deleted or invalid, an inline error blocks execution without transitioning to `failed` pipeline state.
- **THEN** if pre-validation passes, `run_pipeline` is called with the full typed `ExecutionProfile` object

#### Scenario: Invalid profile prevents start

- **WHEN** the user selects a profile that failed validation
- **THEN** a warning alert is shown and the Start button is disabled

#### Scenario: First visit auto-selects profile

- **WHEN** the user navigates to the processing page for the first time (no persisted config)
- **THEN** the profile selector SHALL auto-select the first valid profile from `executionProfiles`

---

### Requirement: Default profile for new projects

When a new project is created, the Import phase SHALL have `selectedProfileId` initialized to the first valid profile in `executionProfiles` (ordered by array index) in the `DEFAULT_PROJECT_FILE`'s `uiState.import`. The Processing phase's `selectedProfileId` SHALL be set lazily when the processing page is first visited (auto-selecting the first valid profile), matching the existing pattern where `uiState.processing` is created on demand.

#### Scenario: New project defaults import to first valid profile

- **WHEN** a new project is created and `executionProfiles` contains profiles `[A (valid), B (invalid), C (valid)]`
- **THEN** `uiState.import.selectedProfileId` SHALL be set to profile A's `id`

#### Scenario: Processing profile set on first visit

- **WHEN** a new project is created and the user navigates to the processing page for the first time
- **THEN** the processing config's `selectedProfileId` SHALL auto-select the first valid profile

---

### Requirement: Rust ExecutionProfile deserialization and validation

The Rust backend SHALL define an `ExecutionProfile` enum with `serde(tag = "type")` for internally-tagged deserialization. Phase 1 SHALL include a `Matlab` variant with fields: `id: String`, `label: String`, `matlab_path: String`, `explore_asl_path: String`, `explore_asl_version: Option<String>`. The Rust `serde` field names SHALL use `snake_case` with `#[serde(rename_all = "camelCase")]` to match the frontend's `camelCase` JSON.

All Tauri commands (`run_import_pipeline`, `run_pipeline`, `validate_execution_profile`, `validate_all_execution_profiles`) SHALL accept `ExecutionProfile` as a typed parameter — Tauri handles serde deserialization natively. No manual JSON string wrapping.

#### Scenario: Valid MATLAB profile JSON deserializes

- **WHEN** Rust receives `ExecutionProfile::Matlab { id: "...", label: "R2024b", matlab_path: "/path/matlab", explore_asl_path: "/path/ExploreASL", ... }`
- **THEN** it SHALL deserialize into `ExecutionProfile::Matlab { ... }` with all fields populated

#### Scenario: Unknown type fails deserialization

- **WHEN** Rust receives a JSON object with `"type": "docker"`
- **THEN** deserialization SHALL fail with a serde error (no `Docker` variant in Phase 1)

### Requirement: Rust profile validation commands

The Rust backend SHALL expose two validation commands that reuse the same internal `ExecutionProfile::validate()` method:

```rust
#[tauri::command]
fn validate_execution_profile(execution_profile: ExecutionProfile)
  -> Result<ProfileValidationResult, String>;

#[tauri::command]
fn validate_all_execution_profiles(execution_profiles: Vec<ExecutionProfile>)
  -> Result<Vec<ProfileValidationResult>, String>;
```

The shared result struct SHALL be:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileValidationResult {
    id: String,
    valid: bool,
    errors: Vec<String>,
    explore_asl_version: Option<String>,
}
```

The `validate()` method SHALL dispatch on profile type. For `matlab` profiles it SHALL:

1. Check that `matlab_path` exists on disk and is executable (reuse existing `validate_matlab_executable`).
2. Check that `explore_asl_path` exists on disk and contains `ExploreASL.m` (reuse existing `validate_exploreasl_path`).
3. Detect `explore_asl_version` from the ExploreASL directory and return it in the result.

For future profile types, validation SHALL be type-specific.

#### Scenario: Singular validation — valid profile

- **WHEN** `validate_execution_profile` is called with a `Matlab` profile whose paths exist and `ExploreASL.m` is present
- **THEN** the result SHALL have `valid: true`, `errors: []`, and `explore_asl_version` populated

#### Scenario: Singular validation — invalid profile

- **WHEN** `validate_execution_profile` is called with a `Matlab` profile whose `matlab_path` does not exist
- **THEN** the result SHALL have `valid: false`, `errors` containing "MATLAB executable not found", and `explore_asl_version: null`

#### Scenario: Batch validation

- **WHEN** `validate_all_execution_profiles` is called with 3 profiles, 2 valid and 1 invalid
- **THEN** the result SHALL be a `Vec` of 3 `ProfileValidationResult` entries, each keyed by the profile's `id`, with the correct `valid`/`errors`/`explore_asl_version` values
