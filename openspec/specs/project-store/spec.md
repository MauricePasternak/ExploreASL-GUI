# project-store Specification

## Purpose

Define project persistence, phase access, and shared project state.

## Requirements

### Requirement: Project gating on valid profiles

The project store's `createProject` and `loadProject` actions SHALL check that at least one valid execution profile exists before proceeding. Validity SHALL be determined from the global store's `profileValidationState`.

If no valid profiles exist:

- `createProject` SHALL throw an error / show a notification directing the user to Settings.
- `loadProject` SHALL throw an error / show a notification directing the user to Settings.
- With no configured profiles, the landing page SHALL show first-run onboarding instead of project action buttons and the Recent Projects list.
- With configured profiles but none valid, the landing page SHALL show an explanatory alert directing the user to Settings and disable "New Project", "Open Project", and recent-project Open actions. Recent-project Remove actions SHALL remain available.

#### Scenario: Create project with valid profile available

- **WHEN** `createProject` is called and at least one valid profile exists
- **THEN** the project is created normally

#### Scenario: Create project with no valid profiles

- **WHEN** `createProject` is called and no valid profiles exist
- **THEN** project creation is blocked and an error message is shown

#### Scenario: Open project with no valid profiles

- **WHEN** `loadProject` is called and no valid profiles exist
- **THEN** project loading is blocked and an error message is shown

#### Scenario: Landing page has no configured profiles

- **WHEN** the landing page renders and no execution profiles are configured
- **THEN** onboarding with an Open Settings action SHALL appear, and project action buttons and the Recent Projects list SHALL NOT render

#### Scenario: Landing page buttons disabled for invalid configured profiles

- **WHEN** the landing page renders with configured profiles but none valid
- **THEN** an alert SHALL explain that profiles need fixing in Settings, "New Project", "Open Project", and recent-project Open actions SHALL be disabled, and recent-project Remove actions SHALL remain available

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

---

### Requirement: createProject accepts dataSource

`createProject(path, name, options)` SHALL accept `options.dataSource: "dicom" | "bids"` (required — no default). The function MUST NOT silently default `dataSource` to `"dicom"` if the parameter is omitted; a missing `dataSource` SHALL throw a validation error.

`createProject` SHALL set `projectMeta.dataSource` from this parameter. `projectMeta.currentPhase` SHALL be set to `"import"` regardless of `dataSource` (both paths land on Import page; both advance to Parameters on completion).

`projectMeta.dataSource` is established at creation and is not a user-editable field in the native `ProjectEdit` contract.

#### Scenario: DICOM project creation

- **WHEN** `createProject(path, name, { dataSource: "dicom" })` is called
- **THEN** `projectMeta.dataSource = "dicom"`, `projectMeta.currentPhase = "import"`, `uiState.import.completed = false`, `uiState.import.bidsReviewConfirmed = false`

#### Scenario: BIDS project creation

- **WHEN** `createProject(path, name, { dataSource: "bids" })` is called
- **THEN** `projectMeta.dataSource = "bids"`, `projectMeta.currentPhase = "import"`, `uiState.import.bidsReviewConfirmed = false`

#### Scenario: Missing dataSource throws

- **WHEN** `createProject(path, name, {})` is called (no `dataSource`)
- **THEN** the call throws a validation error; no project is created

#### Scenario: Source kind is not a project edit

- **WHEN** a caller submits a project edit after creating a BIDS project
- **THEN** the native edit contract SHALL NOT offer a `dataSource` change

### Requirement: BIDS review confirm writes to mappingState

Confirmed BIDS review SHALL require detected groups with nonempty, case-insensitively unique labels. It SHALL derive metadata groups and one SubjectRow per subject/session pair, merging duplicate subject entries, stripping `sub-` for the subject value, and retaining IDs compatible with native subject listing. Accepted `mappingState` SHALL contain only metadata groups, subject rows, `ingestionComplete: true`, and `sourceDataPath: "."`. Skipped subjects and review confirmation SHALL persist under import UI state. Current phase SHALL advance to Parameters and configuration SHALL flush before navigation. Empty groups, invalid labels, or failed persistence SHALL not navigate or replace accepted mappings.

#### Scenario: BIDS confirm populates mappingState and persists uiState

- **WHEN** a valid 25-subject review with two groups and one skipped subject confirms
- **THEN** 24 subject rows, both groups, the skipped list, confirmation, portable BIDS source, and Parameters phase SHALL persist before navigation

### Requirement: Project Dialog Default Directory Paths

The "New Project" and "Open Project" dialogs on the landing page SHALL use the following logic to determine their initial opening directory (`defaultPath`):

1. **Priority**: Open in the most recent location:
   - For "New Project" (directory dialog): use the parent directory containing the most recent project file (`settings.recentProjects[0]`), if it exists on disk.
   - For "Open Project" (file dialog): use the path of the most recent project file (`settings.recentProjects[0]`) if it exists on disk, or fall back to its parent directory if it exists on disk.
2. **Fallback**: Open in the user's OS home directory (`$HOME`).

#### Scenario: Open pickers with no recent projects

- **WHEN** `recentProjects` is empty
- **THEN** the New Project and Open Project dialogs SHALL be initialized with the user's OS home directory as the `defaultPath`

#### Scenario: Open pickers with a valid recent project

- **WHEN** `recentProjects` contains a valid project file path (e.g. `/tmp/brain-study/project.easl`)
- **THEN** the New Project directory dialog SHALL use `/tmp/brain-study` as `defaultPath`, and the Open Project file dialog SHALL use `/tmp/brain-study/project.easl` as `defaultPath`

### Requirement: Stale temporary file handling

Sibling temporary files left by interrupted saves SHALL NOT be treated as authoritative recovery candidates. After either the primary or confirmed backup has validated, the system SHALL remove only stale temporary files created by the atomic project writer for that exact project path. It SHALL NOT remove unrelated files or require temporary cleanup to succeed before opening the validated project.

#### Scenario: Stale temporary file accompanies valid primary

- **WHEN** a valid primary and a stale writer-owned temporary file exist
- **THEN** the primary SHALL open and the stale temporary file SHALL be ignored as project data and cleaned on a best-effort basis

#### Scenario: Temporary cleanup fails

- **WHEN** a primary or confirmed backup validates but stale temporary cleanup fails
- **THEN** project opening SHALL continue and the cleanup failure SHALL be logged

### Requirement: Actionable storage errors and durability reporting

Project persistence SHALL distinguish invalid serialization, permission denial, insufficient disk space, temporary write failure, file flush failure, backup failure, primary replacement failure, uncertain post-replacement durability, and recovery failure. Callers SHALL receive an actionable category without exposing sensitive project contents.

Flushing the temporary file SHALL be required. Parent-directory flushing SHALL be attempted where supported. If directory flushing is unsupported but file flushing and atomic replacement succeed, the save SHALL succeed and the reduced durability limitation SHALL be logged and documented without a recurring user warning. If supported directory flushing fails after replacement, the system SHALL report uncertain durability and SHALL retain dirty state.

#### Scenario: Disk is full

- **WHEN** temporary project bytes cannot be written because storage is full
- **THEN** Save SHALL fail with an insufficient-space error, dirty state SHALL remain set, and the previous valid project files SHALL remain recoverable

#### Scenario: Directory flush is unsupported

- **WHEN** file flush and atomic replacement succeed on a platform that does not support parent-directory flushing
- **THEN** Save SHALL succeed and the limitation SHALL be logged without showing a recurring warning

#### Scenario: Supported directory flush fails

- **WHEN** parent-directory flushing is supported but fails after primary replacement
- **THEN** Save SHALL report uncertain durability and dirty state SHALL remain set

### Requirement: Relocation forbids former-root access

After a relocated project becomes active, project-owned reads, writes, watchers, subprocess arguments, checkpoints, and autosaves SHALL use the new runtime root. The former project root SHALL NOT be accessed except while validating an explicitly selected external source or resolving a known Recent Projects entry.

#### Scenario: Relocated project saves

- **WHEN** a relocated project is changed and saved
- **THEN** `project.easl`, its backup, temporary files, and all project outputs SHALL be addressed under the new root only

#### Scenario: Relocated project starts processing

- **WHEN** processing starts after relocation
- **THEN** worker arguments and the lock watcher SHALL use the new project root and SHALL NOT use the former root

### Requirement: Consistent configuration operations

Project creation, opening, editing, autosaving, explicit saving, backup recovery, and setup planning SHALL use the same current configuration contract and validation rules. A rejected edit SHALL leave accepted configuration and project files unchanged. An edit to one configuration section SHALL preserve unrelated sections and native-owned execution results. Display caches and temporary form input SHALL NOT independently authorize persisted state or execution completion.

#### Scenario: Same invalid value reaches different operations

- **WHEN** opening and editing receive the same invalid current-schema field value
- **THEN** both operations SHALL reject it under the same contract without saving a substituted default

#### Scenario: Independent sections change

- **WHEN** parameter and visualization edits are accepted while a native execution result updates completion metadata
- **THEN** saving SHALL retain both edits and the native result without whole-project overwrite from a stale display cache

### Requirement: Project-wide autosave

Every accepted configuration edit SHALL schedule an autosave after two seconds without another accepted edit. Autosave SHALL remain active independently of the displayed page. Save, processing/import submission, phase navigation, project replacement, and ordinary close SHALL submit pending form changes and wait for the latest accepted configuration to persist. Invalid unfinished input SHALL remain a visible draft and SHALL block a requested flush until corrected; it SHALL NOT replace accepted values with defaults. No-op edits and transient progress, logs, images, or chart selection SHALL NOT schedule configuration writes. Confirmed relinking SHALL use this same save policy.

#### Scenario: Parameter edit precedes immediate navigation

- **WHEN** the user edits a parameter and immediately navigates to another phase
- **THEN** navigation SHALL wait for that edit to validate and persist without relying on a page-owned delay

#### Scenario: Verdict edit autosaves without navigation

- **WHEN** a reviewer sets a valid verdict and remains on the page
- **THEN** the accepted verdict SHALL persist after the shared autosave delay

#### Scenario: Unfinished input reaches Save

- **WHEN** Save encounters a form draft that cannot produce a valid configuration value
- **THEN** the application SHALL show the invalid field, preserve the accepted value, and SHALL NOT claim all changes are saved

#### Scenario: Autosave fails

- **WHEN** autosave cannot persist accepted changes
- **THEN** unsaved status and an actionable error SHALL remain visible and Save SHALL retry the latest configuration

### Requirement: Current schema persisted and runtime boundaries

The only supported project schema SHALL declare integer `schemaVersion: 2`, independently of application SemVer. Saved configuration SHALL retain the current top-level `projectMeta`, `mappingState`, `dataPar`, and `uiState` sections, SHALL omit legacy `version` and runtime `rootPath`, and SHALL contain no transient run ownership, loaded scientific data, or form drafts. The runtime root SHALL derive exclusively from the parent of the opened `project.easl`. Closed project-owned objects SHALL reject unknown fields. Declared loose scientific metadata and DataPar extension fields SHALL preserve unknown JSON values. Missing optional settings SHALL remain unset rather than acquire scientific defaults; equivalent absent nullable selections SHALL serialize consistently as `null`.

#### Scenario: Current project is saved

- **WHEN** a supported configuration is saved
- **THEN** the output SHALL be readable JSON with `schemaVersion: 2`, no application-version envelope, and no authoritative absolute project root

#### Scenario: Scientific extension fields survive

- **WHEN** valid current configuration contains unknown BIDS metadata or DataPar extension values
- **THEN** save and reopen SHALL preserve those values without treating them as project-schema extensions

### Requirement: Current processing selection persistence

Processing selections SHALL persist under `uiState.processing.config`, using `selectedProfileId` rather than copied MATLAB or ExploreASL paths. Import profile selection SHALL persist under `uiState.import.selectedProfileId`. Persisted terminal phase and module completion/provenance SHALL derive from accepted native execution evidence; nonterminal progress SHALL remain runtime state. Changing selections SHALL preserve sibling `structural`, `asl`, and `population` results, including `profileId`, `exploreASLVersion`, `matlabVersion`, `guiVersion`, and `Mtime`. A new project SHALL create processing selections lazily on the first Processing visit. Visualization and review configuration SHALL follow their current capability contracts.

Phase order SHALL remain import, parameters, processing, visualization, manifest. Native `allowedPhases` SHALL include every phase at or before the accepted `projectMeta.currentPhase` cursor, plus Import and Parameters unconditionally, Processing when `uiState.import.completed` is true for a DICOM project or `uiState.import.bidsReviewConfirmed` is true for a BIDS project, and Visualization/Manifest when Population is completed. An otherwise valid saved later cursor SHALL NOT be rejected solely because those readiness flags are absent or false, nor SHALL it fabricate completion. Renderer phase eligibility SHALL use this native list; active-work navigation guards and page-local data/workflow readiness SHALL remain separate.

#### Scenario: Config saved on processing start

- **WHEN** the user starts processing
- **THEN** the latest accepted selection and profile ID SHALL persist before submission

#### Scenario: Config restored on project load

- **WHEN** a project with saved processing selections opens
- **THEN** subject selection, module selection, worker count, and profile selection SHALL show those saved values

#### Scenario: New project format with selectedProfileId

- **WHEN** current configuration contains a saved processing profile ID
- **THEN** the selector SHALL restore that profile reference rather than machine paths

#### Scenario: Import selectedProfileId persisted

- **WHEN** a saved import profile selection is reopened
- **THEN** the import selector SHALL restore that ID

#### Scenario: New project with no processing config

- **WHEN** a new project has not visited Processing
- **THEN** processing selection configuration SHALL remain absent until needed

#### Scenario: Processing edit preserves sibling processing fields

- **WHEN** processing selections change while saved Population completion and provenance exist
- **THEN** those native-owned sibling values SHALL remain unchanged

#### Scenario: Visualization phase gate

- **WHEN** Visualization access is requested and the accepted current-phase cursor precedes Visualization
- **THEN** access SHALL require saved or currently reconciled native Population completion

#### Scenario: Manifest phase gate

- **WHEN** Manifest access is requested and the accepted current-phase cursor precedes Manifest
- **THEN** access SHALL use the same Population completion condition as Visualization

#### Scenario: Saved later cursor permits earlier phases without completion flags

- **WHEN** an otherwise valid project opens with `projectMeta.currentPhase = "manifest"` and import/review and Population completion flags absent or false
- **THEN** native `allowedPhases` SHALL include all five phases without changing those completion flags, independently of active-work navigation guards

#### Scenario: Phase ordering includes manifest

- **WHEN** project phases are listed
- **THEN** their order SHALL be import, parameters, processing, visualization, manifest

### Requirement: Shared visualization settings persistence

Visualization settings SHALL persist under `uiState.dataVis` through project-wide autosave. They SHALL include the declared `qcbfSource`, `joinConfig`, column types, identifiers, level orderings, axis assignments, domain filters, stage, and supported chart/viewer settings. Loaded data and transient selection SHALL NOT persist. The obsolete `contractSources` representation SHALL NOT be accepted as current configuration.

#### Scenario: DataVis contract saved

- **WHEN** a valid visualization setting changes
- **THEN** it SHALL enter accepted project configuration and use the shared autosave policy

#### Scenario: DataVis contract restored

- **WHEN** a project with saved visualization settings opens
- **THEN** its display cache SHALL expose those settings without rehydrating a second editable persisted copy on page mount

### Requirement: Current-only project parsing

The system SHALL inspect the project envelope before validating the current payload. Only integer `schemaVersion: 2` SHALL be supported. Any other integer version and legacy application-version envelope SHALL produce an actionable unsupported-schema error without migration or file mutation. Missing or invalid version information SHALL produce a malformed-project error. Unsupported primary schemas SHALL NOT trigger fallback to an older backup.

#### Scenario: Current project is recognized

- **WHEN** a file declares `schemaVersion: 2`
- **THEN** its payload SHALL use the complete current contract

#### Scenario: Older project is rejected

- **WHEN** a file declares `schemaVersion: 1` or only `version: "0.1.0"`
- **THEN** opening SHALL fail as unsupported without conversion, guessed repair, or backup fallback

#### Scenario: Future project version is rejected distinctly

- **WHEN** a file declares an integer schema version greater than 2
- **THEN** opening SHALL report unsupported schema rather than corruption

#### Scenario: Malformed supported project is rejected

- **WHEN** a schema-version-2 payload contains invalid data
- **THEN** opening SHALL fail with an actionable field error and preserve the source bytes

### Requirement: Read-only current project opening

Reading a current configuration, deriving its root, inspecting source availability, refreshing its display cache, or confirming a valid backup SHALL NOT rewrite `project.easl` or update `lastOpened` on disk. Unsupported or malformed input SHALL remain unchanged. Separately required native transaction recovery and execution-result reconciliation SHALL retain their explicit mutation contracts; they SHALL NOT become schema-repair paths.

#### Scenario: Valid project is opened without rewrite

- **WHEN** a current project opens without pending native recovery or result reconciliation
- **THEN** its project bytes SHALL remain unchanged and autosave SHALL NOT run merely because it opened

#### Scenario: Unsupported input remains unchanged

- **WHEN** an unsupported project is selected
- **THEN** the application SHALL leave its source and backup untouched

### Requirement: Validated current project writes

Every creation, autosave, explicit Save, and repair of a recovered primary SHALL validate and serialize the current configuration before filesystem writes. The existing durable writer SHALL create a unique sibling candidate, flush its contents, preserve the previous validated primary as `project.easl.bak`, and atomically install the new primary. All candidates and backups SHALL remain in the project directory. Missing, malformed, or unsupported primary data SHALL NOT replace a valid recovery backup. Invalid values SHALL cause failure before candidates are created.

#### Scenario: Existing project is saved atomically

- **WHEN** changed current configuration saves successfully over a validated primary
- **THEN** the primary SHALL contain the new complete JSON and its backup SHALL contain the previous complete JSON

#### Scenario: New project is created

- **WHEN** a project is created without an existing primary
- **THEN** validated current bytes SHALL become the primary without requiring a backup

#### Scenario: Serialization fails before writing

- **WHEN** configuration cannot pass current validation
- **THEN** no candidate, primary, or backup SHALL change

#### Scenario: Temporary write or file flush fails

- **WHEN** a candidate write or required file flush fails
- **THEN** saving SHALL fail while previous valid primary/backup data remains recoverable

#### Scenario: Replacement is interrupted

- **WHEN** interruption occurs between durable candidate creation and completed replacement
- **THEN** a complete old or new primary/backup SHALL remain recoverable and partial primary data SHALL NOT be accepted

### Requirement: Current-schema backup recovery

Loading SHALL prefer a valid current primary. A missing or malformed primary with a valid current backup SHALL require user confirmation before opening recovered data. Confirmation SHALL load the backup without writing, retain unsaved status, and preserve that backup until a later accepted edit, explicit Save, or ordinary close successfully repairs the primary. Permission errors and unsupported primary schemas SHALL stop without fallback; malformed or unsupported backups SHALL never load.

#### Scenario: Valid primary takes precedence

- **WHEN** primary and backup are both valid current projects
- **THEN** the primary SHALL open without offering backup recovery

#### Scenario: Missing primary offers backup recovery

- **WHEN** the primary is missing and its backup is valid current configuration
- **THEN** the application SHALL ask before opening the backup without modifying either path

#### Scenario: Malformed primary offers backup recovery

- **WHEN** the primary is malformed and its backup is valid current configuration
- **THEN** the application SHALL offer recovery and preserve the malformed primary until repair is requested

#### Scenario: User confirms backup recovery

- **WHEN** recovery is confirmed
- **THEN** the backup SHALL load as unsaved configuration without starting an opening-only autosave

#### Scenario: Save repairs recovered project

- **WHEN** a later edit or flush saves recovered configuration
- **THEN** a valid primary SHALL be installed without rotating malformed primary bytes over the recovery backup

#### Scenario: Unsupported primary never falls back

- **WHEN** the primary uses an unsupported schema and a readable backup exists
- **THEN** opening SHALL fail as unsupported without offering the backup

#### Scenario: Permission failure never falls back

- **WHEN** primary reading fails with permission denied
- **THEN** opening SHALL report that error without offering a backup

### Requirement: Native revision-ordered persistence

Configuration writes SHALL execute in accepted revision order for the active lifecycle. A successful write SHALL clear unsaved status only through the revision actually persisted. A newer accepted edit SHALL remain pending until it persists. Failure SHALL retain unsaved state and the last-known-good files. A stale lifecycle request SHALL never save to a replacement project, including reopening the same project ID.

#### Scenario: Project changes during save

- **WHEN** revision A saves while revision B is accepted
- **THEN** A's completion SHALL NOT mark B saved and the next write SHALL persist B

#### Scenario: Save fails

- **WHEN** validation or storage fails
- **THEN** unsaved state SHALL remain and retry SHALL use the latest accepted revision

### Requirement: Current portable source references

Current output SHALL store project-internal sources relative to the project root and external sources as explicit absolute paths. Raw DICOM entries SHALL remain relative to their source. BIDS source SHALL be `.`; generated qCBF paths SHALL be project-relative. Runtime resolution SHALL use the currently opened root and SHALL reject relative traversal or symlink escape. Selecting or relinking a source SHALL establish this representation before acceptance; loading SHALL NOT repair older absolute internal-path conventions.

#### Scenario: BIDS project is moved

- **WHEN** current BIDS configuration opens from another directory
- **THEN** all project-owned access SHALL resolve under the new root

#### Scenario: Internal DICOM source moves with project

- **WHEN** the project and relative DICOM source move together
- **THEN** source and raw entries SHALL resolve beneath the new root

#### Scenario: External DICOM source remains external

- **WHEN** a project moves but its source is external
- **THEN** the external absolute reference SHALL remain unchanged

#### Scenario: Project-relative path attempts escape

- **WHEN** a relative reference escapes the selected root
- **THEN** validation SHALL reject it without accessing that escaped location

### Requirement: Native-owned project creation planning

For a detected BIDS root, project defaults, validation, and current JSON generation SHALL belong to the same native configuration contract used by normal saves. The reviewed setup plan SHALL retain those exact bytes. Confirmation SHALL commit project and compatibility artifacts together; no independent frontend project write or best-effort ignore-file write SHALL follow. Activation SHALL expose the committed configuration only after successful commit. Later edits SHALL use the shared validated project writer.

#### Scenario: Preflight receives validated canonical project

- **WHEN** creation requests a setup plan
- **THEN** the plan SHALL contain native-generated current-schema bytes and their content summary

#### Scenario: Commit succeeds before hydration

- **WHEN** the reviewed plan commits successfully
- **THEN** activation SHALL expose exactly its committed project configuration

#### Scenario: Commit fails before activation

- **WHEN** commit fails or rolls back
- **THEN** prior active state SHALL remain and no candidate autosave SHALL be scheduled

#### Scenario: Later save behavior is unchanged

- **WHEN** the newly activated project receives an accepted edit
- **THEN** shared autosave SHALL retain atomic replacement, backups, and ordered revisions

### Requirement: Native module result persistence

Module last-run metadata SHALL retain the actual execution profile ID, ExploreASL/MATLAB/GUI version strings, and completion mtime when available. Only accepted native evidence SHALL update it. Deleted profiles SHALL display "Profile deleted" with the saved ID rather than invent a replacement. Structural, ASL, and Population results SHALL use the same shape; frontend configuration edits SHALL not fabricate completion or provenance.

#### Scenario: Population last-run profile is deleted

- **WHEN** saved Population provenance references a deleted execution profile
- **THEN** the display SHALL preserve historical versions and show the missing profile ID

#### Scenario: Structural result is saved

- **WHEN** accepted native Structural execution supplies provenance
- **THEN** its profile and actual versions SHALL persist in Structural last-run metadata

### Requirement: Native Population completion persistence

Population completion SHALL persist under `uiState.processing.population.completed` only from accepted native commit/terminal evidence. Native execution commit SHALL clear prior completion; accepted successful completion SHALL set it. Pre-commit rejection and non-Population execution SHALL preserve prior Population results. Clearing completion SHALL not remove review verdicts.

#### Scenario: Successful Population run completes

- **WHEN** accepted native Population evidence verifies completion
- **THEN** completion and associated provenance SHALL persist through the shared writer

#### Scenario: Accepted Population execution invalidates earlier completion

- **WHEN** a new Population attempt reaches native execution commit
- **THEN** previous completion SHALL clear without deleting verdicts
