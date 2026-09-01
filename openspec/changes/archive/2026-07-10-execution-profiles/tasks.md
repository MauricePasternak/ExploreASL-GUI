# Execution Profiles Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development WITHOUT git worktrees.
> to implement this plan task-by-task.

**Goal:** Replace scattered MATLAB path configuration with a unified Execution Profile abstraction, supporting a `matlab` profile type in Phase 1. V0 — no legacy migrations. Profiles are validated at four lifecycle points (save, startup, switch, preparation) and gate project creation/opening. First-run onboarding guides new users.

**Architecture:** Profiles are globally-stored typed configuration objects (discriminated union on `type`). Projects reference profiles by ID via `selectedProfileId` (persisted per-phase in `.easl`). The frontend resolves profiles, maintains in-memory validation state, and passes typed objects to Rust commands (Tauri handles serde natively). Rust deserializes into a tagged enum, validates paths, then dispatches command construction. Start button handlers pre-validate profiles before invoking pipelines — inline error on failure, no `failed` pipeline state transition. App blocks rendering until settings load + validation complete.

**Tech Stack:** TypeScript + Zod (frontend schemas), Zustand (stores), Mantine (UI), Rust + serde (backend deserialization), Tauri v2 (IPC)

---

## File Structure

### New Files

- `src/schemas/executionProfile.ts` — `ExecutionProfileSchema`, `MatlabProfileSchema`, `ExecutionProfileBaseSchema`, types
- `src/components/settings/ProfileManager.tsx` — Profile CRUD list + inline form with auto-detect/browse/text inputs
- `src/components/common/ProfileSelector.tsx` — Reusable profile dropdown with validity indicators (shared by Import and Processing pages)
- `src/components/landing/WelcomeCard.tsx` — First-run onboarding card for landing page
- `src-tauri/src/execution_profile.rs` — Shared `ExecutionProfile` enum + `ProfileValidationResult` struct + validation commands + internal `validate()` method
- `src-tauri/src/main.rs` — Register `validate_execution_profile` and `validate_all_execution_profiles` commands

### Modified Files

- `src/schemas/globalSettings.ts` — Replace `matlabInstallations`, `exploreAslPath`, `exploreAslVersion` with `executionProfiles[]`
- `src/schemas/processingSchemas.ts` — Replace `matlabPath`, `exploreAslPath` with `selectedProfileId` in `ProcessConfigSchema`
- `src/schemas/project.ts` — Add `uiState.import.selectedProfileId`
- `src/stores/globalStore.ts` — Replace MATLAB-specific actions with profile CRUD actions; add `profileValidationState` (in-memory); add `validateAllProfiles()`, `validateProfile(id)`, `hasValidProfile()` actions; update `loadSettings`/`saveSettings`; gate `loaded` on validation completion
- `src/stores/processingStore.ts` — Update `startProcessing` to resolve and validate profile; update config shape
- `src/stores/importStore.ts` — Replace `selectedMatlabPath` with `selectedProfileId` (persisted); update `ImportSnapshot`
- `src/App.tsx` — Gate rendering on `globalStore.loaded`; show loading indicator
- `src/pages/LandingPage.tsx` — Add project gating + welcome card; disable New/Open/Recent when no valid profiles
- `src/stores/projectStore.ts` — Add profile gating guard in `createProject`/`loadProject`; set import default profile on create
- `src/components/settings/SettingsModal.tsx` — Settings modal shell; embeds `ProfileManager`
- `src/components/import/ImportExecution.tsx` — Replace MATLAB dropdown with `ProfileSelector`; update `runImportPipeline` call
- `src/components/processing/PipelineConfig.tsx` — Replace MATLAB dropdown with `ProfileSelector`; auto-select on first visit
- `src/components/processing/ProcessingStatusAlert.tsx` — Update validation to check profile validity from `profileValidationState`
- `src/lib/processingEvents.ts` — Update `runProcessingPipeline` to pass typed profile object
- `src/lib/importEvents.ts` — Update `runImportPipeline` to accept typed profile object
- `src-tauri/src/import.rs` — Change `run_import_pipeline` to accept `execution_profile: ExecutionProfile`; add preparation-phase validation
- `src-tauri/src/processing.rs` — Change `run_pipeline` to accept `execution_profile: ExecutionProfile`; add preparation-phase validation

### Test Files

- `src/schemas/executionProfile.test.ts` — Schema validation tests
- `src/schemas/globalSettings.test.ts` — Update for new schema shape
- `src/schemas/processingSchemas.test.ts` — Update for new `ProcessConfigSchema`
- `src/schemas/importSchemas.test.ts` — Update for `ImportSnapshotSchema` with `selectedProfileId`
- `src/stores/globalStore.test.ts` — Profile CRUD + validation state tests
- `src/stores/processingStore.test.ts` — Update for profile-based config + validation checks
- `src/stores/importStore.test.ts` — Update for persisted `selectedProfileId`

---

## 1. ExecutionProfile Schema

- [x] 1.1 Create `src/schemas/executionProfile.ts` with `ExecutionProfileBaseSchema` (`id: uuid`, `label: min(1)`, `exploreAslVersion: optional`), `MatlabProfileSchema` (extends base with `type: literal("matlab")`, `matlabPath: min(1)`, `exploreAslPath: min(1)`), and `ExecutionProfileSchema` discriminated union. Export types.
- [x] 1.2 Update `src/schemas/importSchemas.ts` — add `selectedProfileId: z.string()` to `ImportSnapshotSchema`.
- [x] 1.3 Write tests in `src/schemas/executionProfile.test.ts`:
  - Valid MATLAB profile parses
  - Missing `matlabPath` fails
  - Missing `label` fails
  - Unknown `type` fails
  - Missing `id` fails
  - `exploreAslVersion` is optional
- [x] 1.4 Run tests, confirm all pass

## 2. GlobalSettingsSchema Update

- [x] 2.1 Update `src/schemas/globalSettings.ts`:
  - Remove `matlabInstallations`, `exploreAslPath`, `exploreAslVersion` fields
  - Add `executionProfiles: z.array(ExecutionProfileSchema).default([])` field
- [x] 2.2 Write/update tests in `src/schemas/globalSettings.test.ts`:
  - Fresh install defaults to empty `executionProfiles`
  - Settings with profiles parse correctly
  - Old fields are no longer in schema (stripped by Zod, no migration)
- [x] 2.3 Run tests, confirm all pass (10/10)

## 3. ProcessConfigSchema Update

- [x] 3.1 Update `src/schemas/processingSchemas.ts`:
  - Remove `matlabPath: z.string()` and `exploreAslPath: z.string()`
  - Add `selectedProfileId: z.string()`
- [x] 3.2 Write/update tests in `src/schemas/processingSchemas.test.ts`:
  - Valid config with `selectedProfileId` parses
  - Missing `selectedProfileId` fails
- [x] 3.3 Run tests, confirm all pass (45/45)

## 4. ProjectFileSchema Update

- [x] 4.1 Update `src/schemas/project.ts`:
  - Add `selectedProfileId: z.string().optional()` to `ImportUiStateSchema`
  - Update `population.lastRun`: ADD `profileId: z.string()` alongside existing `exploreASLVersion`, `matlabVersion`, `guiVersion`, `Mtime` fields (keep all version strings)
  - Add `structural.lastRun` and `asl.lastRun` with same shape: `{ profileId, exploreASLVersion?, matlabVersion?, guiVersion?, Mtime? }`
  - Update `DEFAULT_PROJECT_FILE` to initialize `uiState.import.selectedProfileId`
- [x] 4.2 Write/update tests in `src/schemas/project.test.ts`:
  - `uiState.import.selectedProfileId` is optional and defaults to undefined
  - `uiState.processing.config.selectedProfileId` parses correctly
  - `population.lastRun.profileId` parses alongside `exploreASLVersion` and `matlabVersion`
  - `structural.lastRun` and `asl.lastRun` parse with all fields (profileId + version strings)
- [x] 4.3 Run tests, confirm all pass (38/38)

> **Note — Downstream test failures expected after groups 2–4:**
> Schema changes (removing `matlabInstallations`, `exploreAslPath`, `matlabPath`; adding `selectedProfileId`, `profileId`, `executionProfiles`) naturally break consumers that reference removed fields or build config objects with the old shape. The following test files FAIL until their respective task groups (5–11) are implemented:
>
> - `src/App.test.tsx` (1 failure) — `App.tsx` reads `settings.exploreAslPath` for version detection on mount
> - `src/components/settings/SettingsModal.test.tsx` (8 failures) — reads `settings.matlabInstallations`, `settings.exploreAslPath`
> - `src/pages/ImportPage.test.tsx` (2 failures) — `importStepAccess.ts` reads `settings.matlabInstallations`
> - `src/components/import/ImportExecution.test.tsx` (2 failures) — `ImportExecution.tsx` reads `settings.matlabInstallations`
> - `src/stores/globalStore.test.ts` (1 failure) — test fixture includes `exploreAslPath`
> - `src/stores/projectStoreProcessingRoundtrip.test.ts` (1 failure) — saves config with old `matlabPath`/`exploreAslPath` fields
> - Type errors in `src/stores/globalStore.ts`, `src/stores/processingStore.ts`, `src/stores/projectStore.ts`, `src/lib/processingEvents.ts`, `src/lib/importEvents.ts`, `src/App.tsx`, `src/components/settings/SettingsModal.tsx`, `src/components/import/ImportExecution.tsx`, `src/lib/importStepAccess.ts` — all reference removed types/fields
>
> All of the above are expected and will be resolved in task groups 5–14 via their own RED-GREEN-REFACTOR cycles.

## 5. Global Store — Profile CRUD + Validation State

- [x] 5.1 Update `src/stores/globalStore.ts`:
  - Remove `setMatlabInstallations`, `setExploreAslPath`, `setExploreAslVersion` actions
  - Add `addProfile(profile)`, `updateProfile(id, updates)`, `deleteProfile(id)`, `getProfileById(id)` actions
  - Add `profileValidationState: Record<string, { valid: boolean, errors: string[] }>` to store state (NOT persisted, mirrors `executionProfiles[]` — one entry per profile, no gaps, no orphans)
  - Store actions manage both array and state map atomically: `addProfile` validates first then persists + sets valid entry; `deleteProfile` removes from both
  - Add `validateProfile(profile): Promise<void>` — calls `invoke("validate_execution_profile", { executionProfile: profile })`, updates `profileValidationState[id]`; if `explore_asl_version` changed, updates profile and persists
  - Add `validateAllProfiles(): Promise<void>` — calls `invoke("validate_all_execution_profiles", { executionProfiles })`, updates `profileValidationState` for each, updates versions where changed
  - Add `hasValidProfile(): boolean` — `profiles.some(p => validationState[p.id]?.valid === true)`
  - Update `loadSettings()` to call `validateAllProfiles()` before setting `loaded: true`
  - Update `saveSettings()` to persist `executionProfiles`
  - Add `deleteProfile` warning when deleting the last profile
- [x] 5.2 Write/update tests in `src/stores/globalStore.test.ts`:
  - `addProfile` appends to list
  - `updateProfile` updates matching profile
  - `deleteProfile` removes matching profile
  - `getProfileById` returns profile or undefined
  - `validateProfile` calls `invoke("validate_execution_profile")` and updates `profileValidationState`
  - `validateAllProfiles` calls `invoke("validate_all_execution_profiles")` and updates all entries
  - `hasValidProfile` returns false when all invalid, true when at least one valid
  - `loadSettings` sets `loaded: true` only after validation
- [x] 5.3 Run tests, confirm all pass

## 6. App Loading Gate

- [x] 6.1 Update `src/App.tsx`:
  - Read `globalStore.loaded` state
  - Show a full-screen loading indicator (app name + centered `<Loader />` from Mantine) while `loaded === false`
  - Only render `<Routes>` and `<SettingsModal>` after `loaded === true`
  - Ensure `loadSettings()` (which now includes `validateAllProfiles()`) is called in `useEffect` and completes before the gate opens
- [x] 6.2 Manually verify: App shows loading indicator on startup, then renders landing page

## 7. Processing Store — Profile Integration

- [x] 7.1 Update `src/stores/processingStore.ts`:
  - Update `ProcessConfig` usage to use `selectedProfileId` instead of `matlabPath` / `exploreAslPath`
  - Update `startProcessing` to:
    1. Resolve profile via `globalStore.getProfileById()` — show inline error and block if not found (do NOT transition to `failed`)
    2. Check `globalStore.profileValidationState[selectedProfileId]` — show inline error and block if invalid (do NOT transition to `failed`)
    3. If population module: resolve `profile.exploreAslPath` and `profile.matlabPath` for `capture_environment_versions` call; store result alongside profileId via `setLastRunProfileId("population", profileId, { exploreASLVersion, matlabVersion, guiVersion })`
    4. Pass typed profile object to `run_pipeline`
- [x] 7.2 Update `src/stores/projectStore.ts`:
  - Replace `setLastRunVersions(versions)` with `setLastRunProfileId(module: "population" | "structural" | "asl", profileId: string, versions: { exploreASLVersion?: string, matlabVersion?: string, guiVersion?: string })`
  - Update `syncProcessingState` to write `profileId` AND version strings to `uiState.processing.{module}.lastRun`
- [x] 7.3 Update `src/lib/processingEvents.ts`:
  - Change `runProcessingPipeline` to accept typed profile object instead of `config.matlabPath` / `config.exploreAslPath`
  - Pass `executionProfile: profile` to `invoke("run_pipeline", ...)` (Tauri handles typed serde natively)
- [x] 7.4 Write/update tests in `src/stores/processingStore.test.ts`:
  - Config with `selectedProfileId` resolves valid profile at execution time
  - Missing profile shows inline error and blocks start (no `failed` state transition)
  - Invalid profile (validation state false) shows inline error and blocks start (no `failed` state transition)
  - Population module writes `profileId` AND version strings to lastRun
  - Config persisted with `selectedProfileId`
- [x] 7.5 Run tests, confirm all pass

## 8. Import Store — Profile Integration

- [x] 8.1 Update `src/stores/importStore.ts`:
  - Replace `selectedMatlabPath` with `selectedProfileId: string | null`
  - Persist `selectedProfileId` to `.easl` via `uiState.import.selectedProfileId`
  - Update auto-select logic to use first _valid_ profile from `executionProfiles` (check `profileValidationState`)
  - Update `ImportSnapshot` to capture `selectedProfileId`
  - Update `startImport` to pre-validate: resolve profile, check existence + validity, show inline error and block on failure (do NOT transition to `failed`), pass typed profile object to Rust command on success
- [x] 8.2 Update `src/lib/importEvents.ts`:
  - Change `runImportPipeline` to accept typed profile object instead of `matlabPath` / `exploreaslPath`
  - Pass `executionProfile: profile` to `invoke("run_import_pipeline", ...)` (Tauri handles typed serde natively)
- [x] 8.3 Write/update tests in `src/stores/importStore.test.ts`:
  - Auto-selects first valid profile when `selectedProfileId` is empty (skips invalid)
  - `selectedProfileId` is persisted in `.easl`
  - `selectedProfileId` is restored from `.easl` on project load
  - Snapshot captures `selectedProfileId`
  - Missing/invalid profile shows inline error and blocks import start (no `failed` state transition)
- [x] 8.4 Run tests, confirm all pass

## 9. Rust Backend — ExecutionProfile Deserialization, Validation, and Dispatch

- [x] 9.1 Create `src-tauri/src/execution_profile.rs` with:
  - `ExecutionProfile` enum (tagged on `"type"`, `rename_all = "camelCase"`, `Matlab` variant with `id`, `label`, `matlab_path`, `explore_asl_path`, `explore_asl_version`)
  - `ProfileValidationResult` struct (`id`, `valid`, `errors: Vec<String>`, `explore_asl_version: Option<String>`, `rename_all = "camelCase"`)
  - `impl ExecutionProfile { fn id(&self) -> &str, fn validate(&self) -> InternalValidation }`
  - `validate()` dispatches on profile type; for `matlab`: checks `matlab_path` exists/executable (reuse `validate_matlab_executable`), checks `explore_asl_path` exists + contains `ExploreASL.m` (reuse `validate_exploreasl_path`), detects `explore_asl_version`
  - `Module` declaration in `src-tauri/src/lib.rs`
- [x] 9.2 Add two Tauri commands in `src-tauri/src/execution_profile.rs`:
  - `#[tauri::command] fn validate_execution_profile(execution_profile: ExecutionProfile) -> Result<ProfileValidationResult, String>`
  - `#[tauri::command] fn validate_all_execution_profiles(execution_profiles: Vec<ExecutionProfile>) -> Result<Vec<ProfileValidationResult>, String>`
  - Register both in `main.rs` builder
  - Write Rust unit tests for `validate()`: valid paths, missing MATLAB, missing ExploreASL.m
- [x] 9.3 Update `run_import_pipeline` in `src-tauri/src/import.rs`:
  - Replace `matlab_path: String` and `exploreasl_path: String` params with `execution_profile: ExecutionProfile`
  - Call `execution_profile.validate()` before any destructive ops (fail before deleting `.easl_staging/` or creating symlinks)
  - Match on profile type, extract paths, construct MATLAB command as before
- [x] 9.4 Update `run_pipeline` in `src-tauri/src/processing.rs`:
  - Replace `matlab_path: String` and `explore_asl_path: String` params with `execution_profile: ExecutionProfile`
  - Call `execution_profile.validate()` before writing `dataPar.json`, deleting status files, or clearing locks
  - Dispatch on profile type for worker invocation
  - Update version logging to use profile's `explore_asl_version`
- [x] 9.5 Verify Rust compiles: `cd src-tauri && cargo check`

## 10. Profile Manager UI Component

- [x] 10.1 Create `src/components/settings/ProfileManager.tsx`:
  - Render list of profiles with label, type badge, path summary, and validity indicator (green check / red warning icon with tooltip)
  - "Add Profile" button → inline form
  - Per-profile Edit / Delete buttons
  - Inline form with: label input, type selector (only "MATLAB" in Phase 1)
  - For `matlab` profiles:
    - `matlabPath`: text input + "Browse" file picker + "Detect MATLAB" button (calls existing `which_matlab` Rust command; shows list of detected installations to select from)
    - `exploreAslPath`: text input + "Browse" directory picker
  - ExploreASL version display below path input (teal = detected, orange = not detected)
  - Delete confirmation dialog; extra warning when deleting last profile
  - Blocking validation on Save: call `invoke("validate_execution_profile")`, show inline errors on failure, persist and close on success
  - After successful save validation, update stored `explore_asl_version` if the Rust command returned one
- [x] 10.2 Update `src/components/settings/SettingsModal.tsx`:
  - Replace MATLAB installations list section and ExploreASL path section with `<ProfileManager />`
  - Remove `setMatlabInstallations`, `setExploreAslPath`, `setExploreAslVersion` usage
  - Remove `detectMatlab`, `addManualMatlab` functions (moved to ProfileManager)
  - Update on-close logic to work with profiles
- [x] 10.3 Manually verify in browser: add, edit, delete profiles; auto-detect MATLAB; browse for paths; validation blocking; version detection; validity indicators

## 11. Profile Selector Component

- [x] 11.1 Create `src/components/common/ProfileSelector.tsx`:
  - Mantine `<Select>` dropdown listing profiles from `globalStore.settings.executionProfiles`
  - Each option shows: label, type badge, version (if available), validity indicator
  - Props: `value: string` (selectedProfileId), `onChange: (id: string) => void`, `disabled?: boolean`
  - Shows "(Profile not found)" if `value` doesn't match any profile
  - Shows "No profiles configured" with link/hint to Settings when list is empty
  - On profile switch: calls `globalStore.validateProfile(newProfile)` and shows warning if invalid
  - Invalid profile selection disables the parent page's Start/Run button
- [x] 11.2 Update `src/components/import/ImportExecution.tsx`:
  - Replace MATLAB dropdown with `<ProfileSelector value={selectedProfileId} onChange={setSelectedProfileId} />`
  - Update `startImport` call to pre-validate profile and pass typed profile object
  - Disable Start button when selected profile is invalid (read from `profileValidationState`)
- [x] 11.3 Update `src/components/processing/PipelineConfig.tsx`:
  - Replace MATLAB dropdown with `<ProfileSelector />`
  - Auto-select first valid profile on first visit when no `selectedProfileId` exists (lazy default)
  - Update config initialization to set `selectedProfileId` instead of `matlabPath` / `exploreAslPath`
- [x] 11.4 Update `src/components/processing/ProcessingStatusAlert.tsx`:
  - Replace `matlabInstallations.length === 0` check with `!hasValidProfile()`
  - Replace MATLAB path / ExploreASL path existence checks with profile validation state checks
- [x] 11.5 Manually verify: Import page profile selector, Processing page profile selector, switch validation, invalid profile warning, Start button gating

## 12. First-Run Onboarding + Project Gating on Landing Page

- [x] 12.1 Create `src/components/landing/WelcomeCard.tsx`:
  - Friendly heading: "Welcome to ExploreASL GUI"
  - Brief explanation of what execution profiles are and why they're needed
  - Numbered steps: 1. Click "Open Settings" → 2. Add a MATLAB profile → 3. Create your first project
  - Prominent "Open Settings" button (accepts `onOpenSettings` callback prop)
- [x] 12.2 Update `src/pages/LandingPage.tsx`:
  - Read `globalStore.hasValidProfile()` and `globalStore.settings.executionProfiles.length`
  - WelcomeCard only shown when `globalStore.loaded === true && executionProfiles.length === 0` (loading gate blocks render until loaded, so no flash)

  - **Zero profiles**: Show `<WelcomeCard />` instead of normal project controls
  - **Profiles exist but all invalid**: Show normal layout but disable "New Project" (`data-testid="landing-new-project-btn"`), "Open Project" (`data-testid="landing-open-project-btn"`), and recent project links. Show `Alert`: "All execution profiles are invalid. Fix a profile in Settings."
  - **At least one valid**: Normal landing page behavior
  - Ensure Settings button in header remains functional in all states
- [x] 12.3 Update `src/stores/projectStore.ts` (safety guardrail):
  - Add a check in `createProject` and `loadProject` that calls `globalStore.hasValidProfile()` before proceeding, throwing if false
- [x] 12.4 Update `createProject` in `src/stores/projectStore.ts`:
  - After creating the project with `DEFAULT_PROJECT_FILE`, set `uiState.import.selectedProfileId` to the first valid profile's ID (resolved from `globalStore.settings.executionProfiles` and `profileValidationState`)
- [x] 12.5 Manually verify:
  - Fresh install → welcome card shown → open Settings → create profile → close Settings → welcome card replaced by project buttons
  - Delete all profiles → welcome card returns
  - All profiles invalid → buttons disabled with alert
  - Create project → import defaulted to first valid profile

## 13. Startup Validation Notifications

- [x] 13.1 After `validateAllProfiles()` completes in `loadSettings()`, if any profiles are invalid:
  - Show a Mantine notification (using existing `notifications.show()` pattern) for each invalid profile: `"Profile '<label>' is invalid: <error>. Fix it in Settings."`
  - Use `color: "red"` for the notification
- [x] 13.2 If `exploreAslVersion` changed for any profile during startup re-detection, persist the updated profiles
- [x] 13.3 Manually verify: Create a profile → close app → rename MATLAB binary → reopen app → notification shown, profile marked invalid, landing page gating active

## 14. Cleanup & Remove Legacy Code

- [x] 14.1 Search codebase for remaining references to `matlabInstallations`, `matlabPath` (in non-test code), `exploreAslPath` (as a direct setting, not a profile field), `selectedMatlabPath` — fix any stragglers
- [x] 14.2 Remove any unused imports, types, or functions related to old MATLAB configuration
- [x] 14.3 Run full test suite: `pnpm test`
- [x] 14.4 Run linting: `pnpm lint`
- [x] 14.5 Run typecheck: `pnpm typecheck`
