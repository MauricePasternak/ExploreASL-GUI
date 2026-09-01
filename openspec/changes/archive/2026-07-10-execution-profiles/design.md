## Context

The ExploreASL GUI currently hardcodes MATLAB as the only execution method. The MATLAB binary path and ExploreASL source directory path are stored in two places:

1. **Global settings** (`settings.json` via `@tauri-apps/plugin-store`): `matlabInstallations[]` (array of `{ label, path, version? }`) and a single `exploreAslPath` string.
2. **Per-run config** (`.easl` project file `uiState`): `ProcessConfig` snapshots `matlabPath` and `exploreAslPath` at execution time, derived from global settings.

The Rust backend receives raw `matlab_path` and `explore_asl_path` strings in its Tauri commands (`run_import_pipeline`, `run_pipeline`) and constructs `matlab -batch "addpath(...); ExploreASL(...)"` commands directly.

This design is tightly coupled to MATLAB. Supporting compiled binaries, Docker containers, or Apptainer requires a different invocation pattern, different executable paths, and additional configuration (MCR path, Docker image, volume mounts, GPU flags). The current architecture has no extension point for these alternatives.

## Goals / Non-Goals

**Goals:**

- Introduce an Execution Profile abstraction that encapsulates how to invoke ExploreASL, independent of the specific runtime.
- Implement the `matlab` profile type, migrating existing MATLAB-specific config into the new model.
- Provide CRUD management for profiles in the global Settings modal.
- Replace MATLAB dropdowns on Import and Processing pages with a unified profile selector.
- Update Rust backend commands to accept serialized profile objects instead of raw paths.
- Auto-migrate existing `settings.json` and `.easl` files to the new schema.
- Define the schema's discriminated union so that future profile types (`compiled`, `docker`, `apptainer`) can be added by extending the union — no architectural changes needed.

**Non-Goals:**

- Implementing `compiled`, `docker`, or `apptainer` profile types (future phases).
- Container-specific concerns: volume mounts, GPU passthrough, network configuration.
- Auto-detection of MATLAB installations or ExploreASL directories.
- Profile sharing/export between users or machines.
- Profile-level environment variable injection.

## Decisions

### D1: Profile storage location — Global `settings.json`

Profiles are stored in the global `settings.json` (via `@tauri-apps/plugin-store`) as an `executionProfiles[]` array.

**Rationale:** Profiles describe infrastructure available on a machine, not project-specific choices. A researcher with one MATLAB install and one Docker setup should configure those once and use them across all projects.

**Alternatives considered:**

1. **Per-project profiles** (in `.easl` file): Rejected because the same MATLAB installation is used across many projects. Would force redundant config.
2. **Hybrid (global pool + per-project overrides)**: Adds complexity for Phase 1 with no clear user benefit. Projects just reference a profile ID.

### D2: Project binding — `selectedProfileId` reference

Projects store only a `selectedProfileId: string` reference in their `uiState`. The full profile is resolved from the global pool at execution time.

Each phase that requires an execution profile stores its own `selectedProfileId`:

- `uiState.import.selectedProfileId`
- `uiState.processing.config.selectedProfileId`

**Rationale:** Import and Processing may legitimately use different profiles (e.g., different MATLAB versions). Storing per-phase allows this flexibility.

**Alternatives considered:**

1. **Single project-level profileId**: Simpler, but prevents Import/Processing from using different profiles. Too restrictive.
2. **Embed full profile in `.easl`**: Creates stale copies. If a user updates a profile path, existing projects would still use the old value.

### D3: Frontend → Rust contract — Pass typed profile object

The frontend resolves the profile from the global store and passes the `ExecutionProfile` object directly to Rust commands. Tauri handles serde deserialization natively from the Zod-typed object. The Rust side receives the typed `ExecutionProfile` enum and dispatches on the profile type to construct the correct command.

**Rationale:** Keeps Rust stateless with respect to profile storage. The Rust backend doesn't need access to `settings.json` — it just receives a self-contained profile and constructs the command. Tauri's native serde support eliminates manual JSON string wrapping/unwrapping.

**Alternatives considered:**

1. **Pass profile ID, Rust reads settings.json**: Requires Rust to access the plugin-store, coupling Rust to the frontend's storage mechanism. Also duplicates schema definitions.
2. **Decompose profile into individual args per type**: Back to the current problem — Rust commands need different signatures for different execution types.
3. **Pass serialized JSON string**: Unnecessary manual serialization/deserialization on both sides when Tauri natively supports typed serde objects.

### D4: Profile schema — Zod discriminated union on `type` field

```typescript
const ExecutionProfileSchema = z.discriminatedUnion("type", [
  MatlabProfileSchema,
  // Future: CompiledProfileSchema, DockerProfileSchema, ApptainerProfileSchema
]);
```

Each variant has `id: uuid`, `label: string`, `type: literal`, and type-specific fields. The `type` field drives both frontend form rendering (which fields to show) and Rust command construction (which invocation pattern to use).

**Rationale:** Zod discriminated unions provide type-safe exhaustive matching on the frontend. The Rust side uses a matching `serde` tagged enum. Adding a new profile type means: (1) add a Zod variant, (2) add a Rust enum variant, (3) add a settings form section.

**Alternatives considered:**

1. **Flat schema with optional fields**: All profile types in one flat object with optional fields gated by `type`. Weaker type safety — easy to have invalid combinations.
2. **Separate schemas without union**: No single `ExecutionProfile` type. Commands would need to accept `MatlabProfile | CompiledProfile | ...` at call sites. Harder to extend.

### D5: Validation strategy — Multi-phase, defense in depth

Profile validation runs at four points, providing layered safety:

1. **On save (blocking, <500ms)**: Validates path existence only — checks `matlabPath` is an executable file and `exploreAslPath` contains `ExploreASL.m`. Detects `exploreAslVersion` from VERSION file (fast disk read). No MATLAB process spawn (no `capture_environment_versions`). This keeps save responsive while catching typos and misconfiguration early.
2. **On startup (blocking)**: All profiles are validated after `loadSettings()` completes, before the UI renders. The app shows a loading indicator until validation completes. Invalid profiles are marked in an in-memory `profileValidationState: Record<string, { valid: boolean, errors: string[] }>` (not persisted). A notification lists invalid profiles. `exploreAslVersion` is also re-detected and updated on each profile.
3. **On profile switch (non-blocking)**: When the user selects a different profile in the Import or Processing dropdown, the profile is validated. Invalid selection disables the Start button with a warning.
4. **On preparation (blocking, Rust-side)**: Before any destructive operations in `run_import_pipeline` or `run_pipeline`, the Rust command re-validates profile paths. This is the final safety net.

**Rationale:** Path validity is transient — MATLAB can be uninstalled between app sessions. Blocking startup validation ensures the app never renders with stale profile state. Preparation-phase validation catches races between profile switch and execution. Storing validity in-memory (not persisted) ensures it's always computed from current filesystem state.

**`profileValidationState` reconciliation model:** The state map mirrors `executionProfiles[]` — one entry per profile, no gaps, no orphans. Store actions (`addProfile`, `updateProfile`, `deleteProfile`, `validateAllProfiles`) manage both the array and the state map atomically. On add: validate first, then persist profile + set valid entry. On delete: remove from both array and map. No external code ever sees a profile in the array missing from the validation map. `hasValidProfile()` derives from `profiles.some(p => validationState[p.id]?.valid === true)` — trivial and always consistent.

**Alternatives considered:**

1. **Validate on save only**: Insufficient — paths can become invalid between saves.
2. **Validate on every render**: Too expensive, especially for future Docker/Apptainer profiles that might need network checks.
3. **Non-blocking startup validation**: Would cause UI flicker as `profileValidationState` populates after initial render. For Phase 1 (filesystem checks only), blocking is fast enough.

### D6: Migration strategy — No migration (greenfield)

This is a greenfield project with zero real users. The old `matlabInstallations`, `exploreAslPath`, and `exploreAslVersion` fields are removed from the schema with no migration transforms. No backward compatibility concerns.

### D7: ExploreASL version detection — Per-profile, detected on save + re-detected on startup

The existing `detect_exploreasl_version` Rust command (fast VERSION file read, no MATLAB spawn) is called when a `matlab` profile is saved, and the detected version is stored on the profile as `exploreAslVersion?: string`. This replaces the current global `exploreAslVersion` field. The version is also re-detected during startup validation and updated if it has changed, catching cases where the user updates ExploreASL without editing the profile.

For future profile types: `compiled` profiles detect from the binary path's adjacent `VERSION_*` files. Container profiles may not support version detection (returns `null`).

### D8: Settings UI layout — Inline profile management

The Settings modal replaces the "MATLAB Installations" list and "ExploreASL Path" input with a "Profiles" section:

- A list of existing profiles with name, type badge, path summary, and validity indicator (green check / red warning).
- "Add Profile" button opens an inline form (not a nested modal).
- Each profile row has Edit and Delete actions.
- The form renders type-specific fields based on the selected type (only "MATLAB" in Phase 1).
- For `matlab` profiles: `matlabPath` has three input methods — text input, "Browse" file picker, and "Detect MATLAB" auto-detect button (reusing the existing `which_matlab` Rust command). `exploreAslPath` has text input + "Browse" directory picker.
- Validation feedback is shown inline on Save.

### D9: Rust `ExecutionProfile` enum structure

```rust
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ExecutionProfile {
    #[serde(rename = "matlab")]
    Matlab {
        id: String,
        label: String,
        matlab_path: String,
        explore_asl_path: String,
        explore_asl_version: Option<String>,
    },
    // Future: Compiled { ... }, Docker { ... }, Apptainer { ... }
}
```

Uses `serde`'s internally-tagged enum with `rename_all = "camelCase"` to match the frontend's camelCase JSON field names. This is the standard Tauri convention for TypeScript ↔ Rust serialization.

**Validation trait:** The enum implements a `validate()` method that dispatches on profile type and returns type-specific results.

**Validation commands:**

```rust
#[tauri::command]
fn validate_execution_profile(execution_profile: ExecutionProfile)
  -> Result<ProfileValidationResult, String>;

#[tauri::command]
fn validate_all_execution_profiles(execution_profiles: Vec<ExecutionProfile>)
  -> Result<Vec<ProfileValidationResult>, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileValidationResult {
    id: String,
    valid: bool,
    errors: Vec<String>,
    explore_asl_version: Option<String>,
}
```

**Tauri serde:** All commands accept typed `ExecutionProfile` directly — Tauri handles serde deserialization natively. No manual JSON parsing. Same pattern used for `run_import_pipeline` and `run_pipeline`.

### D10: Project gating — Block create/open without valid profiles

Creating or opening a project requires at least one valid execution profile. The landing page disables "New Project", "Open Project", and recent project links when no valid profiles exist, with a prominent message directing users to Settings.

**Rationale:** A project without an execution profile cannot run any pipeline. Gating at creation/opening prevents users from investing time in project configuration only to discover they can't execute. The Settings modal remains accessible without a project, so users can always configure profiles first.

**Alternatives considered:**

1. **Allow project creation, gate at execution**: Current behavior for MATLAB checks. But users report frustration when they configure an entire project only to discover MATLAB isn't set up.
2. **Auto-create a profile from detected MATLAB**: Too magical for Phase 1. Auto-detection is a future enhancement.

### D11: Default profile for new projects — Eager for import, lazy for processing

When a new project is created, the Import phase's `selectedProfileId` is set eagerly in the `createProject` action to the first valid profile (resolved from `globalStore.settings.executionProfiles` and `profileValidationState`). The Processing phase's `selectedProfileId` is set lazily when the processing page is first visited, matching the existing pattern where `uiState.processing` is not in the initial project file and is created on demand.

**Rationale:** `uiState.import` already exists in the default project structure, so we can set `selectedProfileId` immediately. `uiState.processing` is created lazily and we should preserve that pattern. The auto-select on first visit achieves the same result.

### D12: Import profile selection — Persisted in `.easl`

The import phase's `selectedProfileId` is persisted in the `.easl` project file under `uiState.import.selectedProfileId`. Previously, the MATLAB selection for import was ephemeral (in-memory only). Persisting it ensures the selection is recorded and restored when the project is reopened.

**Rationale:** Recording which profile was used for import helps reproducibility and matches the processing phase's persistence pattern.

### D13: Profile deletion — No blocking, but warnings

Profile deletion is never blocked based on project references. If deleting the last remaining profile, a warning is shown explaining that ExploreASL execution and project creation/opening will be blocked. The user can still proceed.

**Rationale:** Users should have full control over their profile list. The project gating and validation system will surface clear errors downstream rather than preventing profile management.

### D14: First-run onboarding — Welcome card on landing page

When the app starts with zero execution profiles, the landing page shows a welcome card instead of the normal project controls. The card provides a friendly explanation of what execution profiles are, numbered setup steps, and a prominent "Open Settings" button. After a valid profile is created, the card is replaced by the normal UI.

**Rationale:** First-time users unfamiliar with ExploreASL configuration need guidance. A welcome card is friendlier than a blocking modal or error message. It reuses the Settings modal rather than duplicating the profile creation form.

**Alternatives considered:**

1. **Auto-open Settings modal on first launch**: More direct but feels abrupt. Users lose context of what they're supposed to do.
2. **Inline setup wizard on landing page**: Most guided, but duplicates the profile creation form from Settings.

### D15: App loading gate — Block rendering until validation complete

The app gates rendering on `globalStore.loaded`, which is only set to `true` after `loadSettings()` and `validateAllProfiles()` complete. A loading indicator is shown during this time.

**Rationale:** Currently, the app renders with `DEFAULT_SETTINGS` immediately and loads asynchronously. This would cause the landing page to flicker between "no profiles" and "profiles loaded" states. Blocking ensures the app never renders with stale or default state.

### D16: MATLAB path input — Auto-detect + Browse + Text

The profile creation form provides three ways to specify the MATLAB path: a "Detect MATLAB" button (reuses the existing `which_matlab` Rust command), a "Browse" file picker, and manual text input. This matches the most common user workflows (auto-detect for standard installations, browse for custom locations, text for advanced users).

**Rationale:** The current Settings modal only has auto-detect and text input (no browse). Adding a file browse dialog provides a middle ground for users who know where MATLAB is but don't want to type the full path.

### D17: Module lastRun — store profileId alongside version strings

The `ProjectFileSchema` augments `population.lastRun` with `profileId: z.string()` while keeping the existing `exploreASLVersion`, `matlabVersion`, `guiVersion`, and `Mtime` fields. The `profileId` identifies which profile was used; the captured version strings provide an accurate historical record in case the profile's stored version was stale (e.g., ExploreASL updated between startup and pipeline start). Neither alone is sufficient — profile lookup may give stale versions, version strings alone don't say which MATLAB was used.

`structural.lastRun` and `asl.lastRun` are added with the same shape: `{ profileId, exploreASLVersion, matlabVersion, guiVersion, Mtime }`. This is scope-accepted despite no module implementations yet.

**Rationale:** Dual recording ensures both reproducibility (what profile was used) and audit accuracy (what versions were actually on disk at runtime).

### D18: `capture_environment_versions` unchanged

The `capture_environment_versions` Rust command signature stays as-is (`explore_asl_path: String`, `matlab_path: String`). It writes `Environment.json` as an audit artifact. The call site resolves paths from the resolved profile object instead of the old `ProcessConfig` fields. The result (exploreASLVersion, matlabVersion) is stored in `lastRun` alongside the `profileId` per D17.

### D19: Start button pre-validation

Before invoking a pipeline, the "Start" button handler SHALL resolve the selected profile, check it still exists in `executionProfiles`, and check `profileValidationState[id].valid`. If the profile was deleted or is invalid, the handler SHALL show an inline error on the Start button ("Selected profile was deleted or is invalid") and block execution. It SHALL NOT transition the store to a `failed` pipeline state — this is a config error, not a recoverable pipeline failure. No pipeline process exists yet.

**Rationale:** Profiles can be deleted in Settings while the Import/Processing page is open. Detecting this at click time prevents confusing Rust-side errors. Showing an inline error guides the user to fix their selection rather than leaving an opaque `failed` state.

### D20: Loading gate UX — full-screen branded spinner

While `loaded === false`, `App.tsx` renders a full-screen loading indicator (app name + spinner). No routing, no pages, no components render. The gate ensures `profileValidationState` is populated before any profile-gated UI decisions are made — preventing WelcomeCard flash on cold starts for users with valid profiles.

No timeout is implemented for Phase 1 (local filesystem paths only; path checks are <10ms each). A timeout fallback will be added if network/stall-prone paths are supported later.

### D21: WelcomeCard trigger gating

The WelcomeCard renders only when `loaded === true AND executionProfiles.length === 0`. Since D20 blocks all render until `loaded === true`, the WelcomeCard never flashes on cold starts for users with profiles. When all profiles are deleted mid-session, the card appears immediately.

### D22: UUID generation

Profile IDs use `crypto.randomUUID()` — available in Tauri's Chromium webview, zero dependencies, already used by `projectStore.ts` for project IDs. The Zod schema validates `.uuid()` regardless of generation method. No `uuid` npm package added.

### D23: Import `selectedProfileId` as top-level store field

Replaces `selectedMatlabPath: string` with `selectedProfileId: string | null` as a top-level import store state field (mirroring the existing pattern). Persisted in `.easl` under `uiState.import.selectedProfileId`. `ImportSnapshot` captures `selectedProfileId` for auditing. On project load, restored from `uiState.import.selectedProfileId` — not from the snapshot, which is a one-shot record of the last run.

### D24: Version re-detection — save does fast file read, startup re-detects

`exploreAslVersion` is detected from the `VERSION_*` file at save time (fast disk read, <10ms) and also re-detected at startup validation. Save does NOT spawn MATLAB (`capture_environment_versions`). The matlabVersion (release string like "R2024b") is only known at pipeline runtime via `capture_environment_versions` and stored in `lastRun` alongside `profileId` per D17. This keeps save fast while ensuring version info is current when the UI renders.

## Risks / Trade-offs

| Risk                                               | Impact                                                                     | Mitigation                                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Profile deleted while referenced by project**    | Project references a non-existent `selectedProfileId`                      | Profile selector shows "(Profile not found)" with a warning. User must select a different profile before executing. No crash.                                                                                            |
| **Rust command signature change is cross-cutting** | Both `run_import_pipeline` and `run_pipeline` change                       | These are internal Tauri commands, not public APIs. The frontend and Rust change together — no backward compat needed.                                                                                                   |
| **Schema versioning between frontend and Rust**    | If the TypeScript and Rust profile schemas drift, deserialization fails    | Single source of truth: the TypeScript schema defines the shape. Rust's `serde` struct mirrors it. Integration tested by running an import/processing flow.                                                              |
| **Startup validation latency**                     | Validating all profiles on startup blocks rendering                        | For MATLAB profiles, validation is cheap filesystem checks (path exists, file exists). For Phase 1 with typically 1-2 profiles, latency is negligible (<20ms). Future container profiles may need async/lazy validation. |
| **Project gating blocks new users**                | First-time users can't create a project without first configuring Settings | The welcome card provides friendly guidance. The gating prevents a worse experience: configuring a full project then being unable to run it.                                                                             |
| **Settings changes during active pipeline**        | User could delete/modify a profile while a pipeline is running             | Running pipelines have the serialized profile on the Rust side and are unaffected. UI may show stale state but next navigation will refresh. Acceptable for V0.                                                          |
