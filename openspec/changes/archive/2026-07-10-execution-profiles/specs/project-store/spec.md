## MODIFIED Requirements

### Requirement: Processing Config Persistence

The `ProjectFileSchema` SHALL update the persisted `uiState.processing.config` shape to use `selectedProfileId: z.string().optional()` instead of `matlabPath: z.string()` and `exploreAslPath: z.string()`.

The `ProjectFileSchema` SHALL also add `uiState.import.selectedProfileId: z.string().optional()` for persisting the import phase's profile selection.

### Requirement: Module Last Run — profileId reference

The `ProjectFileSchema` SHALL add `profileId: z.string()` alongside the existing `exploreASLVersion: z.string().optional()` and `matlabVersion: z.string().optional()` in `population.lastRun`. The `guiVersion: z.string().optional()` and `Mtime: z.number().int().nullable().optional()` fields SHALL remain unchanged. Both `profileId` (which profile was used) and version strings (actual versions on disk at runtime) are preserved — neither alone is sufficient for reproduction.

The schema SHALL also include `structural` and `asl` lastRun shapes for V0 with the same pattern (profileId + all version fields), despite no module implementations yet.

```typescript
// population.lastRun shape (existing, modified):
lastRun: z.object({
  profileId: z.string(),
  exploreASLVersion: z.string().optional(),
  matlabVersion: z.string().optional(),
  guiVersion: z.string().optional(),
  Mtime: z.number().int().nullable().optional(),
}).optional();

// structural.lastRun shape (new for V0):
lastRun: z.object({
  profileId: z.string(),
  exploreASLVersion: z.string().optional(),
  matlabVersion: z.string().optional(),
  guiVersion: z.string().optional(),
  Mtime: z.number().int().nullable().optional(),
}).optional();

// asl.lastRun shape (new for V0):
lastRun: z.object({
  profileId: z.string(),
  exploreASLVersion: z.string().optional(),
  matlabVersion: z.string().optional(),
  guiVersion: z.string().optional(),
  Mtime: z.number().int().nullable().optional(),
}).optional();
```

The `profileId` SHALL reference an `ExecutionProfile.id` from the global store. At display time, the profile is resolved to show `profile.label`, and the stored version strings provide an accurate historical record of what was on disk when the pipeline ran. If the profile was deleted, a "(Profile deleted)" indicator is shown with the raw `profileId` for reference.

The `setLastRunVersions` store action SHALL be replaced by `setLastRunProfileId(module: "population" | "structural" | "asl", profileId: string, versions: { exploreASLVersion?: string, matlabVersion?: string, guiVersion?: string })`. The `setLastPopulationRunMtime` action SHALL remain unchanged (population-specific, uses Mtime for completion detection).

#### Scenario: New project format with selectedProfileId

- **WHEN** a `.easl` file contains `uiState.processing.config.selectedProfileId: "abc-123"`
- **THEN** the project loads with the processing config's profile selector set to profile "abc-123"

#### Scenario: Import selectedProfileId persisted

- **WHEN** a `.easl` file contains `uiState.import.selectedProfileId: "abc-123"`
- **THEN** the import store's profile selector is initialized to "abc-123"

#### Scenario: Population lastRun with profileId

- **WHEN** a `.easl` file contains `uiState.processing.population.lastRun.profileId: "abc-123"`
- **THEN** the last run record resolves profile "abc-123" from global store for display (label, version, paths)

#### Scenario: Population lastRun with deleted profile

- **WHEN** `lastRun.profileId` references a profile that no longer exists
- **THEN** the UI shows "(Profile deleted)" alongside the raw profile ID

#### Scenario: Structural lastRun with profileId

- **WHEN** a `.easl` file contains `uiState.processing.structural.lastRun.profileId: "abc-123"`
- **THEN** the structural lastRun is parsed and the profile reference is resolved for display

#### Scenario: New project with no processing config

- **WHEN** a new `.easl` file has no `uiState.processing.config` (default state)
- **THEN** the project loads normally; processing config is created lazily on first visit to the processing page

---

### Requirement: Project gating on valid profiles

The project store's `createProject` and `loadProject` actions SHALL check that at least one valid execution profile exists before proceeding. Validity SHALL be determined from the global store's `profileValidationState`.

If no valid profiles exist:

- `createProject` SHALL throw an error / show a notification directing the user to Settings.
- `loadProject` SHALL throw an error / show a notification directing the user to Settings.
- The landing page SHALL disable the "New Project" and "Open Project" buttons and recent project links.
- A prominent message SHALL be shown (see first-run onboarding or project gating requirements in execution-profiles spec).

#### Scenario: Create project with valid profile available

- **WHEN** `createProject` is called and at least one valid profile exists
- **THEN** the project is created normally

#### Scenario: Create project with no valid profiles

- **WHEN** `createProject` is called and no valid profiles exist
- **THEN** project creation is blocked and an error message is shown

#### Scenario: Open project with no valid profiles

- **WHEN** `loadProject` is called and no valid profiles exist
- **THEN** project loading is blocked and an error message is shown

#### Scenario: Landing page buttons disabled

- **WHEN** the landing page renders and no valid profiles exist
- **THEN** "New Project", "Open Project" buttons and recent project links SHALL be disabled with a tooltip explaining why

#### Scenario: Landing page buttons enabled

- **WHEN** the landing page renders and at least one valid profile exists
- **THEN** all project action buttons SHALL be enabled

---

### Requirement: Default profile for new projects

When a new project is created, the Import phase SHALL initialize `selectedProfileId` to the first valid profile in `executionProfiles` (using `profileValidationState` to determine validity) in the `createProject` action. The Processing phase's `selectedProfileId` SHALL be set lazily when the processing page is first visited, matching the existing pattern where `uiState.processing` is created on demand.

#### Scenario: New project defaults import to first valid profile

- **WHEN** a new project is created and `executionProfiles[0]` is valid
- **THEN** `uiState.import.selectedProfileId` SHALL be set to `executionProfiles[0].id`

#### Scenario: First profile invalid, second valid

- **WHEN** a new project is created and `executionProfiles[0]` is invalid but `executionProfiles[1]` is valid
- **THEN** `uiState.import.selectedProfileId` SHALL be set to `executionProfiles[1].id`
