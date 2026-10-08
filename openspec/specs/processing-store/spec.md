# processing-store Specification

## Purpose

Define processing lifecycle state, progress, and persistence behavior.

## Requirements

### Requirement: Processing Phase State Machine

The processing store SHALL project native `preparing`, `running`, `finalizing`, `completed`, `cancelling`, `cancelled`, `failed` and `interrupted` lifecycle states, plus local `idle` when no native run is attached. Runtime run identity and worker membership SHALL NOT persist as restart authority. Terminal phase and last run configuration SHALL save through exact terminal persistence. Idle progress SHALL reconstruct from safe status reads; active outcomes SHALL derive only from accepted native snapshots. Population commit, completion, version and ready-mtime metadata SHALL follow Exact processing terminal persistence; the frontend SHALL NOT probe files or classify worker completion.

#### Scenario: Initial state on page load

- **WHEN** activation discovers no active or unacknowledged native run
- **THEN** the store SHALL show persisted terminal phase or idle and reconstruct historical subject progress

#### Scenario: Phase transition on start

- **WHEN** validation and native reservation succeed
- **THEN** the store SHALL bind the returned run and project preparing, running and finalizing from increasing native snapshots

#### Scenario: Phase transition on all workers complete successfully

- **WHEN** native target and worker audit publishes Completed for the attached run
- **THEN** the store SHALL render completed and save accepted Population completion and native mtime when selected

#### Scenario: Phase transition on worker failure

- **WHEN** native worker/target evidence publishes Failed for the attached run
- **THEN** the store SHALL render failed without frontend lock-status finalization

#### Scenario: Phase transition on user kill

- **WHEN** native exact-run cancellation publishes Cancelled
- **THEN** the store SHALL render cancelled

#### Scenario: Population flag cleared on re-run

- **WHEN** an accepted native Population execution-commit snapshot arrives
- **THEN** the store SHALL invalidate prior Population completion from that evidence before accepting any later completion

#### Scenario: Population flag not cleared on rejected start

- **WHEN** reservation rejects or native preparation fails before execution commit
- **THEN** the store SHALL preserve prior Population completion and provenance

#### Scenario: Population flag not cleared on non-Population re-run

- **WHEN** an accepted run does not select Population
- **THEN** the store SHALL preserve Population completion

#### Scenario: Versions captured on Population run start

- **WHEN** native Population preparation captures successful version probes
- **THEN** accepted run provenance SHALL retain ExploreASL, MATLAB and GUI versions for exact persistence

#### Scenario: Version probe failure does not block run

- **WHEN** a native version probe fails with settled process ownership and permits the unknown fallback
- **THEN** native provenance SHALL use unknown for that probe while retaining other captured versions and continuing launch

#### Scenario: Version capture runs in parallel with participants generation

- **WHEN** a native Population preparation probe is slow
- **THEN** independent native participant preparation SHALL proceed while the store projects preparing without owning either effect

#### Scenario: Mtime persisted after Population completes

- **WHEN** accepted native Population Completed evidence contains ready mtime 1700000060000
- **THEN** the persisted Population last-run mtime SHALL equal 1700000060000 without a frontend filesystem probe

#### Scenario: Missing 999_ready at capture time

- **WHEN** a completed native audit captured valid ready evidence but optional later provenance mtime is unavailable
- **THEN** native provenance SHALL supply null plus a diagnostic without frontend reclassification; missing ready evidence at the completion audit SHALL instead fail under Expected-target native processing completion

#### Scenario: Re-run overwrites prior version capture

- **WHEN** accepted native committed Population evidence contains new version provenance
- **THEN** exact persistence SHALL replace prior Population version fields with that run evidence

#### Scenario: Verdicts remain on disk during re-run

- **WHEN** a Population rerun is in flight
- **THEN** persisted manifest verdicts SHALL remain unchanged and use existing verdict staleness rules

### Requirement: Process Configuration

The store SHALL hold a `ProcessConfig` object containing: `subjects` (array of selected SubjectSession strings), `modules` (array of `structural`, `asl`, `population` — at least one required), `selectedProfileId` (string), `workers` (integer, 1–available cores), and `subjectRegexp` (string generated from subject selection). If Population is selected, `workers` SHALL be forced to 1. The frontend SHALL translate `modules` string array to `bProcess` boolean vector (`[true, false, false]` → Structural only, `[true, true, false]` → Structural+ASL, etc.) when building the immutable reservation request.

The `ProcessConfigSchema` SHALL be:

```
z.object({
  subjects: z.array(z.string()),
  modules: z.array(z.enum(PROCESSING_MODULES)),
  selectedProfileId: z.string(),
  workers: z.number().int().min(1),
})
```

`setConfig` SHALL enforce mutual exclusivity between Population and Structural/ASL. If `modules` contains `"population"`, it SHALL NOT contain `"structural"` or `"asl"`. If `modules` contains `"structural"` or `"asl"`, it SHALL NOT contain `"population"`. When a conflicting module is added, the opposite module(s) SHALL be removed automatically.

Before reservation, `startProcessing` SHALL:

1. Resolve the profile via `globalStore.getProfileById(selectedProfileId)`. If not found, show an inline error ("Selected profile was deleted or is invalid") and block execution. Do NOT transition to `failed` pipeline state — this is a config error, not a pipeline failure.
2. Check `globalStore.profileValidationState[selectedProfileId]`. If not valid, show an inline error with the validation errors and block execution. Do NOT transition to `failed`.
3. Build pure request inputs with the resolved profile and selected work; native preparation SHALL own environment capture and its failure policy.
4. Only if local checks pass, reserve the immutable native request and launch its exact returned run identity; native SHALL revalidate admitted inputs.

#### Scenario: Population module forces single worker

- **WHEN** the user selects the Population module
- **THEN** the worker count SHALL be forced to 1 and the UI SHALL display a warning that Population cannot be parallelized

#### Scenario: Population auto-deselects Structural and ASL

- **WHEN** `setConfig` is called with `modules: ["population", "structural"]` (where population was added)
- **THEN** the store SHALL normalize to `modules: ["population"]` (removing structural and asl)

#### Scenario: Structural auto-deselects Population

- **WHEN** `setConfig` is called with `modules: ["population", "structural"]` (where structural was added)
- **THEN** the store SHALL normalize to `modules: ["structural"]` (removing population)

#### Scenario: ASL auto-deselects Population

- **WHEN** `setConfig` is called with `modules: ["asl", "population"]` (where asl was added)
- **THEN** the store SHALL normalize to `modules: ["asl"]` (removing population)

#### Scenario: Config with selected profile

- **WHEN** the user selects a profile with ID "abc-123" and 2 subjects, then clicks Start
- **THEN** `ProcessConfig` SHALL contain `{ selectedProfileId: "abc-123", subjects: [...], modules: [...], workers: N }`

#### Scenario: Profile resolved and validated at execution time

- **WHEN** `startProcessing` is called with `config.selectedProfileId = "abc-123"` and the profile is valid
- **THEN** the store SHALL resolve the profile, confirm it is valid, and include it as a typed `ExecutionProfile` in the immutable request

#### Scenario: Population module stores profileId alongside version strings

- **WHEN** accepted native Population evidence includes profile "abc-123" and captured version strings
- **THEN** exact terminal persistence SHALL save that profile ID and those native version strings in `population.lastRun`

#### Scenario: Profile not found at execution time

- **WHEN** `startProcessing` is called but `config.selectedProfileId` references a deleted profile
- **THEN** the store SHALL show an inline error ("Selected profile was deleted or is invalid") and SHALL NOT reserve or launch native work. The store SHALL NOT transition to `failed` pipeline state — no pipeline process exists yet.

#### Scenario: Profile invalid at execution time

- **WHEN** `startProcessing` is called but `profileValidationState[selectedProfileId].valid` is `false`
- **THEN** the store SHALL show an inline error with the validation errors and SHALL NOT reserve or launch native work. The store SHALL NOT transition to `failed` pipeline state.

#### Scenario: SubjectRegexp generation for all subjects

- **WHEN** all subjects are selected
- **THEN** `subjectRegexp` SHALL be `^sub-.*$`

#### Scenario: SubjectRegexp generation for subset

- **WHEN** a subset of subjects is selected
- **THEN** `subjectRegexp` SHALL be an alternation regex e.g. `^(sub-X_Y|sub-Z_W)$`

### Requirement: Subject List Discovery

The store SHALL provide `availableSubjects` populated by calling `list_subjects` with the project's data source. Discovery SHALL scan `rawdata/sub-X/` for DICOM projects and root-level `sub-X/` for BIDS-direct projects, using the BIDS session conventions defined in `processing-backend`. Each entry SHALL include the SubjectSession string (`sub-X_Y`), the subject label, session label, and module availability flags (`hasStructural`, `hasASL`).

#### Scenario: No rawdata directory

- **WHEN** a DICOM project's `rawdata/` does not exist or is empty
- **THEN** `availableSubjects` SHALL be empty and the UI SHALL show an error state

#### Scenario: BIDS-direct subjects do not depend on rawdata content

- **WHEN** a BIDS-direct project has usable root-level subjects and an empty compatibility `rawdata/` directory
- **THEN** `availableSubjects` SHALL contain the root-level subjects rather than an empty list

#### Scenario: Session detection from BIDS

- **WHEN** `rawdata/sub-001Philips/ses-01/` exists with an `anat/` subdirectory
- **THEN** the subject list SHALL include `{ subjectSession: "sub-001Philips_01", hasStructural: true, hasASl: false }`

### Requirement: Per-Subject Progress Tracking

The store SHALL maintain `subjectStatuses` as an array of `SubjectModuleStatus` objects. Each entry SHALL track: `subjectSession`, `module` (structural/asl/population), optional `run` (for ASL), `status` (pending/incomplete/complete), `completedSteps` (array of step code strings), and `locked` (boolean). The `locked` field is a separate attribute from `status` — when `locked` is true and `status` is not `complete`, the subject is being processed. Active progress SHALL be projected from native target snapshots. Native watcher observations SHALL inform progress only; they SHALL NOT establish successful run completion. Idle historical status reads SHALL remain presentation-only.

#### Scenario: LockCreated event received

- **WHEN** a current native snapshot reports a locked target for module `structural`, subject `sub-X_01`
- **THEN** the matching `SubjectModuleStatus` SHALL have `locked` set to `true`

#### Scenario: StatusFileCreated for step completion

- **WHEN** an accepted native target snapshot includes step code `060_Segment_T1w` for module `structural`, subject `sub-X_01`
- **THEN** the matching `SubjectModuleStatus` SHALL have `060_Segment_T1w` added to `completedSteps`

#### Scenario: 999_ready marks module complete

- **WHEN** an accepted native target snapshot includes step code `999_ready` for any module/subject
- **THEN** the matching displayed `SubjectModuleStatus` SHALL have `status` set to `complete` without independently setting the run outcome

### Requirement: Last Run Config Persistence

Accepted processing selections SHALL persist under `uiState.processing.config`, using `selectedProfileId`, and accepted native terminal phases SHALL persist under `uiState.processing.currentPhase`. The form SHALL read one accepted project configuration, not an independently editable persisted mirror. Selection edits SHALL preserve structural, ASL, and Population completion/provenance. A missing saved profile SHALL show "Profile not found" and disable Start until a valid profile is selected. Existing application startup/open/create profile gating SHALL remain unchanged.

#### Scenario: Config restoration on page load

- **WHEN** Processing is visited after an earlier saved selection
- **THEN** subjects, modules, profile, and worker count SHALL show the accepted saved values

#### Scenario: Persisted profile no longer exists

- **WHEN** selected profile ID is absent from global profiles
- **THEN** the selector SHALL show "Profile not found" and Start SHALL remain disabled

#### Scenario: Sync preserving structural/population sibling fields

- **WHEN** selections change with existing module completion and provenance
- **THEN** those native-owned values SHALL remain unchanged

### Requirement: Native processing snapshot projection

The processing store SHALL build pure request inputs and project native processing snapshots. It SHALL accept only the current project/run identity, current activation generation and increasing revisions, reconcile after missed events, and expose native logical worker/target progress. It SHALL NOT own watcher startup/shutdown, participant/configuration filesystem writes, completion inference, raw process ownership, or renderer-local rollback disposition. Run launch and completion SHALL remain correct when listeners mount late or the renderer reloads. Start SHALL remain registered through existing project-transition work admission; rejected admission SHALL have no preparation or Population metadata effects. Attachment SHALL reconcile a snapshot after listener registration to close missed-event races. Tagged historical replay envelopes SHALL be handled as idempotent responses, never attached or projected into current state. Idle dashboard status reads MAY supply historical progress but SHALL NOT determine an active run outcome. A `confirmStopped` action SHALL be projected only from an exact Interrupted native snapshot and SHALL never be synthesized locally.

#### Scenario: Stale snapshot arrives

- **WHEN** a snapshot belongs to an old project/run or carries an older revision
- **THEN** the store SHALL ignore it without modifying current processing or project metadata

#### Scenario: Renderer reloads during processing

- **WHEN** project activation discovers an active native run
- **THEN** the store SHALL attach and project its snapshot without launching duplicate workers or finalizing it locally

#### Scenario: Native restart discovers interrupted execution

- **WHEN** the exact native snapshot exposes `confirmStopped`
- **THEN** the store SHALL block Start, display external-process guidance, and invoke only exact-run/revision confirmation when the user accepts

### Requirement: Exact processing terminal persistence

Eligible native terminal evidence SHALL update and persist project configuration before acknowledgement of the exact run and terminal revision. The frontend SHALL request or display reconciliation, not derive and save result metadata. Interrupted evidence requiring external-stop confirmation SHALL not acknowledge or claim completion. Persistence or acknowledgement failure SHALL retain replay and expose actionable errors; repeated replay SHALL remain idempotent. Population completion/provenance SHALL derive solely from accepted native execution commit and terminal evidence. Pre-commit preparation failure SHALL preserve prior completion; accepted Population execution commit SHALL invalidate it; accepted Completed evidence SHALL set it with native versions and ready-file mtime. Post-commit spawn failure SHALL not restore historical claims. Non-Population runs SHALL preserve Population completion and all reviewer verdicts.

#### Scenario: Terminal save fails

- **WHEN** native configuration persistence rejects terminal metadata
- **THEN** the run SHALL remain replayable and unacknowledged with a visible error

#### Scenario: Population preparation fails before mutation

- **WHEN** Population preflight fails before execution commit
- **THEN** previous Population completion SHALL remain unchanged

#### Scenario: Historical replay arrives during a newer run

- **WHEN** an older acknowledged request replays during newer work
- **THEN** current attachment, controls, and newer metadata SHALL remain unchanged

#### Scenario: Interrupted snapshot awaits confirmation

- **WHEN** an Interrupted result requires exact stopped-worker confirmation
- **THEN** terminal persistence/acknowledgement SHALL wait for existing native confirmation policy
