## Purpose

Define execution of the ExploreASL import pipeline from staged source data.

## Requirements

### Requirement: Mutation-free staging plan preflight

Before deleting, creating, linking, copying, or writing anything under `.easl_staging`, the native import boundary SHALL validate every staging entry and expand the complete source-to-destination plan. Every entry SHALL carry original logical Subject/Session/Run provenance and a separate Run alias; provenance SHALL NOT be inferred from source paths. The authoritative checks SHALL include the portable Subject, Session, Run, Run-alias, and Modality component contract; readable file or directory sources; canonical source resolution; exclusion of sources inside the staging tree; canonical staging-root ownership; destination confinement beneath `.easl_staging/sourcedata`; one-to-one original-to-target mappings; and complete portable destination collision detection.

The canonical `AppState.active_project_root` SHALL be the sole project-root authority. Native preflight and Run Import SHALL accept staging entries but SHALL NOT accept a staging-root or project-root candidate; they SHALL derive their only staging root as canonical `<active-root>/.easl_staging` and reject no active root, an existing staging-root symlink, an existing `sourcedata` symlink, or any existing destination-component symlink. Existing destination parents SHALL canonicalize beneath canonical `<active-root>/.easl_staging/sourcedata`, not merely beneath staging. After compilation, cleanup, execution, configuration writes, lock copying, command arguments, process spawn, and import-state ownership SHALL use `CompiledStagingPlan.staging_root`. The plan SHALL reject distinct destination directory spellings that collapse under Unicode NFC normalization and case-insensitive comparison, while permitting multiple source files to intentionally populate one logical directory only when both final Subject/Session/Run/Modality spellings and the original logical Subject/Session/Run tuple are exactly identical. It SHALL reject distinct source files whose final destination filenames collide under the same comparison. Validation SHALL finish for the entire plan before filesystem mutation and SHALL return all detected issues as structured errors with stable codes, affected entry indexes and fields, corrective messages, and conflicting entry indexes where applicable. A read-only preflight operation used by Preview Import and the Run Import operation SHALL apply the same authoritative validator; Run Import SHALL always revalidate rather than trusting an earlier preview result.

The serialized frontend project transition SHALL set the candidate native active root before candidate frontend stores hydrate and clear it during close before frontend stores reset. Native-root set or clear failure SHALL leave project work admission closed; a page mount/unmount lifecycle SHALL NOT independently register or clear the native root.

#### Scenario: Traversal component reaches native boundary

- **WHEN** any IPC staging entry contains `.`, `..`, an absolute component, a separator, or another forbidden component value
- **THEN** native preflight SHALL reject the entry with a field-level issue and SHALL leave the existing staging tree byte-for-byte unchanged

#### Scenario: Destination escapes staging source root

- **WHEN** a computed destination or canonical parent would resolve outside `.easl_staging/sourcedata`
- **THEN** native preflight SHALL reject the plan before deleting or creating any staging path

#### Scenario: Existing destination component is a symlink

- **WHEN** `.easl_staging`, `sourcedata`, or any existing Subject/Session/Run/Modality/file destination component is a symlink, including one targeting staging or the active project
- **THEN** native preflight SHALL return a stable destination-symlink issue and SHALL leave existing staging bytes unchanged

#### Scenario: Source is inside staging tree

- **WHEN** a source path resolves to `.easl_staging` or one of its descendants
- **THEN** native preflight SHALL reject the source before staging cleanup can remove or recursively consume it

#### Scenario: Portable directory spelling collision

- **WHEN** two staging entries produce destination directory spellings that are not identical but differ only by case or Unicode representation
- **THEN** native preflight SHALL report both conflicting entries and SHALL create neither destination

#### Scenario: Exact directory shared by distinct files

- **WHEN** multiple source files target the same exactly spelled Subject/Session/Run/Modality directory, share the same original Subject/Session/Run tuple, and their destination filenames remain unique
- **THEN** native preflight SHALL permit the files to populate that shared logical directory

#### Scenario: Matching provenance has a final spelling variant

- **WHEN** two entries share original Subject/Session/Run provenance but final directory spellings differ only by case or Unicode representation
- **THEN** native preflight SHALL report both entries as a destination collision and SHALL not aggregate them

#### Scenario: Portable filename collision

- **WHEN** distinct source files would be placed in one staging destination with filenames that are equal under portable comparison
- **THEN** native preflight SHALL report the conflicting source entries and SHALL create or copy no files

#### Scenario: Multiple independent failures

- **WHEN** a submitted plan contains several invalid components, missing sources, and collisions
- **THEN** native preflight SHALL return all deterministically ordered issues in one response without filesystem mutation

#### Scenario: Preview result becomes stale

- **WHEN** read-only preview succeeds but a source is removed or changed before Run Import
- **THEN** Run Import SHALL repeat authoritative preflight, reject the current invalid plan, and preserve the pre-existing staging tree

#### Scenario: Valid confined staging plan

- **WHEN** every source is readable, all components are portable, every destination is confined, and no portable collisions exist
- **THEN** native preflight SHALL return a valid complete plan and SHALL permit import preparation to proceed

### Requirement: Native-owned staging post-processing

Every public IPC command that mutates import staging or relocates import output SHALL derive canonical project and staging roots from the current `AppState.active_project_root` and the current `ImportState.project_root`/`ImportState.staging_root` ownership record created by a successful import reservation. `clean_import_status` SHALL derive failed subjects from native import results; `move_import_output` SHALL derive succeeded subjects from native import results; neither command SHALL accept project-root, staging-root, or subject-list fields from IPC. `copy_lock_files` SHALL accept only a retry subset after validating safe subject components and membership in native succeeded subjects. For nonempty `run_import_pipeline.subjectsToPreserve`, a single reservation operation SHALL hold current active-project and import ownership while it requires matching retained `Terminal` ownership, safe components, owned/non-failed subjects, membership in native `succeeded_subjects`, and portable-key disjointness from the current run `subjectList`, then replaces ownership. The system SHALL copy only its authorized immutable subset after staging recreation. All three commands and the reservation operation SHALL reject no active project, absent or malformed ownership, active/import canonical-root mismatch, staging-root symlinks, unsafe subjects, retry-preserve/current-run overlap, and subjects outside the owned result set before filesystem mutation.

Native import ownership SHALL expose explicit `Idle`, `Preparing`, `Running`, and `Terminal` lifecycle states. Reservation SHALL enter `Preparing`; successful spawn SHALL atomically enter `Running` before native emits `ImportPrepareComplete`. A spawned child SHALL be supervisor-owned before that event; if readiness emission fails, native SHALL terminate and reap the matching child, remove prepared staging, and reset only matching generation ownership. Stop SHALL validate a matching Running PID and hold matching ownership through platform signal, bounded SIGTERM wait, optional force-kill, and final wait. It SHALL set `termination_requested_for` only after signal success and retain it only when the complete Stop operation succeeds; any signal, force-kill, or timeout failure SHALL clear only the matching generation/PID marker before releasing ownership, preserving a later correlated nonzero `MatlabExitError`. The process supervisor SHALL confirm process exit and atomically enter `Terminal` for the matching ownership generation before emitting a frontend terminal event that can invoke post-processing. Raw output, parser events, readiness, completion, and exit-error emissions SHALL check matching generation while ownership remains locked through emission. `clean_import_status`, `move_import_output`, and `copy_lock_files` SHALL reject `Preparing` and `Running` ownership regardless of any partial succeeded/failed result lists. `move_import_output` with non-debug staging cleanup SHALL delete staging only in `Terminal`, then reset the complete ownership record to `Idle` only after successful relocation and deletion. Debug preservation and no-cleanup relocation SHALL retain terminal ownership for retry/inspection. A later reservation SHALL be permitted to replace retained terminal ownership; each reservation SHALL have a monotonic generation, and late supervisor/stop cleanup from an older generation SHALL not mutate newer ownership. Preparation/spawn rollback and successful project shutdown SHALL reset ownership coherently.

Before listener setup and invocation, the frontend SHALL generate a non-empty `runRequestId` and submit it with `run_import_pipeline`. Native SHALL retain that opaque correlation value with its authoritative ownership generation. Every import event capable of mutating frontend run state—`ImportPrepareComplete`, raw output, structured parser status/progress/failure/completion, terminal success, and `MatlabExitError`—SHALL carry camelCase `runRequestId` and `ownershipGeneration`. Frontend listeners SHALL reject missing or mismatched correlation fields, bind a native generation only from a matching request ID, reject later generation mismatches, and clear the binding on terminal or listener teardown. A frontend PID cache SHALL be scoped to that request ID, cleared at start and terminal/cancel teardown, populated only by a current running request response, and never authorize a later run's Stop action.

#### Scenario: Foreign post-processing root is submitted

- **WHEN** a caller invokes public post-processing IPC while native active-project and import ownership roots do not canonically match
- **THEN** the command SHALL reject before mutation and foreign staging/project sentinel content SHALL remain unchanged

#### Scenario: Retry subject is not owned

- **WHEN** a retry lock-copy request contains traversal syntax or a subject not recorded as succeeded by the owned import
- **THEN** the command SHALL reject before creating or copying lock files

#### Scenario: Run retry preserve authorization fails

- **WHEN** `subjectsToPreserve` is nonempty but no matching retained terminal ownership exists, ownership belongs to another project or a nonterminal run, any requested subject is traversal, failed, unowned, or not in native succeeded results, or it equals a current `subjectList` item under portable comparison
- **THEN** Run Import SHALL reject before replacing ownership or changing staging content

#### Scenario: Stop signal fails

- **WHEN** a matching Running import PID cannot receive its platform termination signal
- **THEN** native SHALL retain matching Running ownership without termination intent, and a later nonzero exit SHALL emit its correlated `MatlabExitError`

#### Scenario: Stop timeout or force-kill fails

- **WHEN** SIGTERM times out and force-kill fails, or force-kill cannot be confirmed before its final timeout
- **THEN** native SHALL clear only the matching generation/PID termination intent before the supervisor can decide process exit, and a later nonzero exit SHALL emit its correlated `MatlabExitError`

#### Scenario: A subject completes before sibling process exit

- **WHEN** native results record a completed subject while the import lifecycle remains `Preparing` or `Running`
- **THEN** every public post-processing command SHALL reject and `move_import_output(cleanupStaging=true, debugMode=false)` SHALL leave the staging tree unchanged

#### Scenario: Terminal event reaches frontend

- **WHEN** the import process exits and native output indicates completion or failure
- **THEN** native ownership SHALL transition to `Terminal` before the terminal frontend event is emitted, allowing its post-processing invoke to pass lifecycle gating

#### Scenario: Readiness event races command response

- **WHEN** native has spawned and entered `Running`, `ImportPrepareComplete` reaches the frontend, and the Run command response carrying the PID is still pending
- **THEN** Stop SHALL invoke native active-import cancellation; the frontend SHALL remain running and locked until native cancellation succeeds

#### Scenario: Replaced generation finishes late

- **WHEN** a previous generation's supervisor exits after newer ownership has reserved the import state
- **THEN** it SHALL not emit raw, parsed, completion, or exit-error events to the newer frontend run

#### Scenario: Queued prior request readiness reaches a same-project rerun

- **WHEN** an old `ImportPrepareComplete` is queued behind a newer same-project Run Import request
- **THEN** the newer listener SHALL reject it because its `runRequestId` differs and SHALL not bind its `ownershipGeneration` or change frontend phase

#### Scenario: Delayed old PID response follows cancellation and rerun

- **WHEN** a cancelled run's command response returns after a newer Run Import request has started
- **THEN** the frontend SHALL not cache that PID, and Stop on the newer run SHALL use native active-import cancellation until a PID carrying the newer request ID is received

#### Scenario: Terminal cleanup succeeds

- **WHEN** terminal non-debug output relocation with staging cleanup succeeds
- **THEN** native ownership SHALL reset all roots, subjects, results, PID, lifecycle, and generation fields to idle defaults

#### Scenario: Previous supervisor finishes after a new reservation

- **WHEN** a retained terminal ownership is replaced and a previous supervisor later finishes cleanup
- **THEN** its generation mismatch SHALL prevent it from changing the newer import lifecycle, PID, roots, or results

### Requirement: Import execution pipeline

The system SHALL provide a single Rust command `run_import_pipeline(staging_root, staging_entries, sourcestructure_json, studypar_json, execution_profile, subject_list, subjects_to_preserve)` that atomically performs: (1) call `execution_profile.validate()` — if validation fails, return an error without performing any destructive operations; (2) delete `.easl_staging/` if it exists; (3) create the standardized 4-level symlink tree at `.easl_staging/sourcedata/` from `staging_entries`; (4) write clean ExploreASL `sourcestructure.json` and `studyPar.json` configs to `.easl_staging/`; (5) dispatch on the profile `type` and spawn the appropriate command (for `matlab` type: `matlab -batch "addpath('<exploreAslPath>'); ExploreASL('<staging_root>', [1,1,0], 0, 0)"` using the profile's `matlabPath` and `exploreAslPath`); (6) return the process PID on success or an error string on failure. The `staging_entries` parameter contains the GUI staging mappings with subject, session, run, modality, and source path. The `subject_list` parameter provides known subject names for stdout pattern matching. The command SHALL emit a `ImportPrepareComplete` event after steps 2-4 succeed and before the subprocess is spawned.

**Preparation-phase validation**: Before performing any destructive operations (deleting `.easl_staging/`, creating symlinks, writing configs), the command SHALL call `execution_profile.validate()`. Only after validation passes SHALL the command proceed to staging directory setup. This provides a final safety net even though the frontend validates profiles on selection and before calling the command.

Prior to spawning the subprocess, lock files for selected subjects SHALL be deleted and lock files for unselected fresh subjects SHALL be preserved via `copyLockFilesForRetry`.

#### Scenario: Successful pipeline start

- **WHEN** `run_import_pipeline` is called with valid paths and a valid execution profile
- **THEN** the staging directory is created, configs are written, MATLAB is spawned, and the PID is returned

#### Scenario: Symlink creation failure

- **WHEN** `run_import_pipeline` is called and symlink creation fails (e.g., permission denied)
- **THEN** the command returns an error string, no MATLAB process is spawned, and the frontend stays in `idle` state

#### Scenario: MATLAB not found

- **WHEN** `run_import_pipeline` is called with an execution profile whose `matlabPath` does not exist
- **THEN** the command returns an error string describing the missing executable

### Requirement: Import run subject scope integrity

Each import execution request SHALL declare a non-empty subject list and SHALL contain staging entries whose distinct subject set exactly equals that declared list under the existing portable subject comparison rules. The system MUST validate this agreement before replacing native import ownership or mutating the staging tree. A mismatched request SHALL be rejected and SHALL NOT spawn ExploreASL.

#### Scenario: Selected subjects and staging entries agree

- **WHEN** every declared subject has at least one staging entry and every staging entry belongs to a declared subject under portable comparison
- **THEN** native validation SHALL accept the request for normal preflight and preparation

#### Scenario: Staging includes an undeclared subject

- **WHEN** an import request contains a staging entry for a subject absent from the declared subject list
- **THEN** native validation SHALL reject the request before replacing import ownership, deleting existing staging content, writing configuration, or spawning ExploreASL

#### Scenario: Declared subject has no staging entry

- **WHEN** an import request declares a subject for execution but contains no staging entry for that subject
- **THEN** native validation SHALL reject the request before replacing import ownership, deleting existing staging content, writing configuration, or spawning ExploreASL

#### Scenario: Portable subject spellings agree

- **WHEN** a declared subject and its staging-entry subject differ only by a spelling distinction normalized by the existing portable subject comparison rules
- **THEN** native validation SHALL treat them as the same subject while retaining existing staging collision validation

### Requirement: Real-time stdout streaming

The system SHALL stream MATLAB subprocess stdout and stderr to the frontend via Tauri events. Two event types SHALL be emitted: `ImportStructuredEvent` with typed payloads (`subject_start`, `subject_complete`, `import_failed`, `import_complete`, `dcm2nii_status`) and `ImportRawEvent` with the raw line string. Every line from MATLAB stdout and stderr SHALL be emitted as `ImportRawEvent`. Structured events SHALL be parsed from stdout using the following regex patterns:

- `subject_start`: `Subject: (\w+), Module: xASL_module_Import`
- `subject_complete`: `Job-iteration \d+ stopped at .+ and took \d+ seconds`
- `import_failed`: `NII2BIDS failed for (.+)|DCM2NII failed for (.+)`
- `import_complete`: `xASL_module_Import completed 100%`
- `dcm2nii_status`: `status: (\d+)`

#### Scenario: Subject starts processing

- **WHEN** MATLAB outputs `Subject: BADDIE, Module: xASL_module_Import`
- **THEN** a `subject_start` event is emitted with `subject: "BADDIE"`

#### Scenario: NII2BIDS failure detected

- **WHEN** MATLAB outputs `NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1` followed by `Message: The length of the vector LabelingDuration...`
- **THEN** a `import_failed` event is emitted with the subject matched against the known subject list and the full message captured

#### Scenario: Import completes

- **WHEN** MATLAB outputs `xASL_module_Import completed 100%`
- **THEN** an `import_complete` event is emitted

### Requirement: Process lifecycle management

The system SHALL store the import child process identity in native app state. User Stop, project close, project switch, and normal app exit SHALL request platform-appropriate graceful termination, wait up to five seconds, and force termination if the process remains alive. The shutdown operation SHALL report whether the process actually stopped. Project close, project switch, and normal app exit SHALL remain blocked if termination cannot be confirmed. A successful project transition SHALL unregister import listeners, cancel queued log batches, and invalidate post-processing owned by the prior project before another project is hydrated.

#### Scenario: User stops import mid-run

- **WHEN** the user clicks "Stop" during a running import
- **THEN** graceful termination SHALL be requested, force termination SHALL follow after five seconds if needed, and all in-progress subjects SHALL be marked cancelled

#### Scenario: User switches project during import

- **WHEN** the user requests project B while project A has an active import
- **THEN** the system SHALL terminate A's import and unregister its listeners before B becomes active

#### Scenario: Import cannot stop during switch

- **WHEN** project A's import cannot be confirmed stopped
- **THEN** project switching SHALL fail, project B SHALL NOT become active, and an actionable error SHALL be shown

#### Scenario: App closes during import

- **WHEN** the user closes the app while an import is running
- **THEN** the app SHALL block exit until termination succeeds and SHALL remain open with an error if termination cannot be confirmed

#### Scenario: Prior post-processing resolves late

- **WHEN** project A import post-processing resolves after A's lifecycle has ended
- **THEN** it SHALL NOT move output, update progress, change phase, or save state for project B

### Requirement: Lock file cleanup for failed subjects

The system SHALL provide a Rust command `clean_import_status(staging_root, subjects: Vec<String>)` that deletes the three lock files (`010_DCM2NII.status`, `020_NII2BIDS.status`, `999_ready.status`) for each specified subject from `<staging_root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/`. This command SHALL be called automatically after the MATLAB subprocess exits, using the list of subjects that emitted `import_failed` events. It SHALL NOT delete lock files for subjects that succeeded.

#### Scenario: One subject fails, one succeeds

- **WHEN** GOOD succeeds and BADDIE fails during import
- **THEN** after MATLAB exits, lock files for BADDIE are deleted, lock files for GOOD are preserved

#### Scenario: All subjects succeed

- **WHEN** all subjects complete without `import_failed` events
- **THEN** no lock files are deleted

### Requirement: Confirmed relocation plan integrity

Before import starts, the system SHALL obtain a native, read-only relocation plan for the immutable selected-subject snapshot. The plan SHALL derive all project and staging roots from native active-project ownership, SHALL identify every existing project-relative rawdata, import-lock, import-log, and BIDS2Legacy-lock path that a successful relocation would replace or remove, and SHALL include per-subject file counts, byte totals, sessions, and an opaque content fingerprint. Absolute project paths SHALL NOT be exposed in the user-facing inventory.

Native import ownership SHALL bind the confirmed plan identity and fingerprint to the same subject snapshot and import generation used for staging and execution. Before relocation mutates project output, the system MUST recompute the destination inventory and SHALL reject a missing, foreign, subject-mismatched, or stale plan without changing project output. Staging output SHALL remain available after this rejection.

#### Scenario: Destination has no replaceable artifacts

- **WHEN** native planning finds no existing project artifacts that relocation would replace or remove for the selected subjects
- **THEN** the plan SHALL report an empty replacement inventory and SHALL remain eligible to bind to that exact selected-subject snapshot

#### Scenario: Destination inventory changes after confirmation

- **WHEN** a confirmed destination file is added, removed, renamed, or changed before relocation begins
- **THEN** native relocation SHALL reject the stale fingerprint before changing project output and SHALL preserve staging for a new plan and confirmation

#### Scenario: Plan belongs to another scope

- **WHEN** relocation receives a plan identity created for another project, import generation, or portable selected-subject set
- **THEN** native relocation SHALL reject before creating candidates, moving destinations, deleting caches, or changing import ownership

### Requirement: Structured relocation outcome

Relocation SHALL return a structured outcome that identifies each owned succeeded subject as committed, rolled back, or failed and includes an actionable phase and message for every failure. A subject SHALL NOT be reported as committed until its complete replacement is durable. The frontend SHALL surface relocation failures and partial outcomes in import status and logs; it SHALL NOT convert a relocation failure into successful import completion or silently discard the error.

Staging cleanup SHALL occur only when every subject expected to relocate is committed and existing cleanup conditions permit it. Any failed or unresolved relocation SHALL retain staging and terminal native ownership for retry, inspection, or recovery. Existing debug-mode staging preservation SHALL remain unchanged.

#### Scenario: Every subject commits

- **WHEN** all owned succeeded subjects complete relocation and required cleanup succeeds
- **THEN** the outcome SHALL report every subject as committed and normal import completion SHALL proceed

#### Scenario: One subject commits and another fails

- **WHEN** subject A commits and subject B encounters a relocation failure that is rolled back
- **THEN** the outcome SHALL report A as committed and B as rolled back or failed, the frontend SHALL show a failed partial outcome, and staging SHALL remain available

#### Scenario: Relocation error reaches frontend

- **WHEN** native relocation returns any subject failure or recovery-required state
- **THEN** the frontend SHALL show the affected subject, failure phase, and actionable message and SHALL NOT mark the run fully completed

### Requirement: Output relocation after import

The native output-relocation operation SHALL replace import output per owned succeeded subject without deleting unrelated project data. For each subject, the staged `rawdata/sub-<Subject>/` SHALL be the complete authoritative replacement for the project `rawdata/sub-<Subject>/`; older sessions and files absent from the staged replacement SHALL NOT be merged forward. The operation SHALL also update that subject's import-lock directory and matching import logs, and SHALL remove matching BIDS2Legacy subject-session lock directories only as part of the same committed subject transaction. Existing Structural, ASL, Population, Stats, `dataPar.json`, `participants.tsv`, non-import lock files, unrelated logs, and unrelated subjects SHALL remain unchanged.

Before replacing a subject, the system SHALL require nonempty staged subject rawdata, reject symlinks and unsupported filesystem entries in owned source, candidate, destination, backup, and journal paths, copy into uniquely owned sibling candidates, and verify the complete relative-path, entry-type, size, and content inventory against the staged source. It SHALL durably record recovery state before moving an existing destination to a sibling backup. A subject SHALL commit only after all of its replacement artifacts are installed and durable. Existing subject data SHALL remain recoverable until a durable run-level outcome records that subject as committed or rolled back.

Relocation SHALL process subjects independently. Failure before a subject commits SHALL restore that subject's complete previous state or preserve its absence when no prior state existed. A subject committed before another subject fails SHALL remain committed. Dataset description creation, when required and absent, SHALL be atomic and SHALL NOT overwrite an existing project dataset description.

When all subjects succeed and staging cleanup is requested, the system SHALL delete staging only after every subject commit and the durable outcome. Debug mode SHALL preserve staging and copy import configuration as before. During partial process success, relocation failure, stale confirmation, or unresolved recovery, staging SHALL remain available. When no subjects succeeded, relocation SHALL NOT modify project output.

#### Scenario: Full success with debug mode off

- **WHEN** all subjects succeed, every subject transaction commits, and debug mode is disabled
- **THEN** complete subject rawdata, import locks, and matching logs SHALL replace their planned destinations, matching BIDS2Legacy locks SHALL be removed, unrelated project data SHALL remain unchanged, staging SHALL be deleted, and normal phase advancement SHALL proceed

#### Scenario: Full success with debug mode on

- **WHEN** all subjects succeed, every subject transaction commits, and debug mode is enabled
- **THEN** subject output SHALL commit, unrelated project data SHALL remain unchanged, staging SHALL be preserved, and import configurations SHALL be copied to the GUI derivatives directory

#### Scenario: Existing subject has extra sessions and files

- **WHEN** a confirmed subject destination contains sessions or files absent from the verified staged subject replacement
- **THEN** the committed project subject SHALL exactly match the staged subject inventory and SHALL exclude those older sessions or files

#### Scenario: Re-import after full processing pipeline

- **WHEN** a user re-runs import for selected subjects on a project that already has completed Structural, ASL, or Population output
- **THEN** only each committed subject's rawdata, import locks, matching import logs, and BIDS2Legacy locks SHALL change, while all processing outputs and unrelated subjects SHALL remain unchanged

#### Scenario: Candidate copy or verification fails

- **WHEN** candidate creation, copying, synchronization, or inventory verification fails before destination replacement
- **THEN** the previous project subject SHALL remain unchanged, temporary state SHALL remain recoverable or be safely removed, and the subject SHALL NOT be reported as committed

#### Scenario: Failure follows backup creation

- **WHEN** relocation fails after moving a previous subject destination to backup but before durable subject commit
- **THEN** the system SHALL restore the complete previous subject state, retain staging, and report the failed relocation phase

#### Scenario: Required staged rawdata is missing

- **WHEN** a subject recorded as succeeded has no nonempty staged rawdata subject directory
- **THEN** relocation SHALL fail that subject before moving or deleting its existing destination

#### Scenario: Partial process success

- **WHEN** some import subjects succeeded and some failed before relocation
- **THEN** only native-owned succeeded subjects SHALL be relocation candidates, failed subjects SHALL remain in staging, and staging SHALL NOT be cleaned

#### Scenario: Partial success (GOOD succeeded, BADDIE failed)

- **WHEN** GOOD succeeds during import and BADDIE fails before relocation
- **THEN** GOOD SHALL relocate transactionally, BADDIE SHALL remain in staging without changing its project destination, and staging SHALL be preserved

#### Scenario: Later subject relocation fails

- **WHEN** subject A commits and subject B fails before commit
- **THEN** A SHALL retain its complete new state, B SHALL retain or recover its complete old state, unrelated subjects SHALL remain unchanged, and the run SHALL expose a partial relocation outcome

#### Scenario: All subjects fail before relocation

- **WHEN** native ownership records no succeeded subjects
- **THEN** project output SHALL remain unchanged and staging SHALL remain available

#### Scenario: All subjects fail

- **WHEN** no import subject succeeds
- **THEN** relocation SHALL NOT modify project output and staging SHALL remain intact for retry or inspection

#### Scenario: Destination or recovery path is unsafe

- **WHEN** any planned destination, candidate, backup, or recovery-record path escapes its canonical owned root, collides with an unowned path, or resolves through a symlink
- **THEN** relocation SHALL reject before destructive mutation and SHALL NOT remove the unsafe path

### Requirement: Retry with lock file preservation

On retry, the system SHALL: (1) delete `.easl_staging/` entirely, (2) rebuild symlink tree and rewrite configs from current GUI state, (3) copy succeeded subjects' lock files from `<project_root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/` to `.easl_staging/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/`, (4) spawn MATLAB. Subjects with preserved lock files SHALL be skipped by ExploreASL.

#### Scenario: Retry after partial failure

- **WHEN** user clicks "Retry Import" after BADDIE failed and GOOD succeeded
- **THEN** staging is rebuilt from scratch, GOOD's lock files are copied back, BADDIE's lock files are NOT copied, MATLAB runs and processes only BADDIE

#### Scenario: Retry after fixing studyPar.json

- **WHEN** user edits metadata in step 4 (fixing LabelingDuration) and clicks "Retry Import"
- **THEN** staging is rebuilt with updated configs, succeeded subjects' lock files are preserved, failed subjects are re-processed with new parameters

### Requirement: MATLAB exit code handling

If the MATLAB process exits with a non-zero exit code, all subjects currently in `"running"` status SHALL be marked as failed. This catches crashes where no per-subject failure pattern was parsed from stdout.

#### Scenario: MATLAB crashes mid-import

- **WHEN** MATLAB exits with code 1 during import (e.g., out of memory)
- **THEN** any subject with `importProgress` status `"running"` is marked as `"failed"` with error "MATLAB process exited unexpectedly"

#### Scenario: MATLAB exits normally with zero code

- **WHEN** MATLAB exits with code 0 after processing all subjects
- **THEN** normal completion flow proceeds; failure detection relies on per-subject stdout parsing

### Requirement: Subprocess kill on app exit

The Rust backend SHALL register a cleanup handler that prevents orphan MATLAB processes. When the Tauri app receives an exit request, the handler SHALL terminate the running MATLAB process using the platform-appropriate signal sequence before allowing exit.

#### Scenario: MATLAB process running on app exit

- **WHEN** the Tauri window is closed while MATLAB is running
- **THEN** the MATLAB process receives SIGTERM (or CTRL_BREAK_EVENT on Windows), followed by SIGKILL after 5s if still alive, then the app exits

#### Scenario: No MATLAB process running on app exit

- **WHEN** the Tauri window is closed and no MATLAB process is running
- **THEN** the app exits immediately without delay

### Requirement: Debug mode (Preserve staging directory)

A global setting "Preserve staging directory" SHALL be added to `globalStore.settings` under the Import module section, defaulting to `false`. When enabled, `.easl_staging/` is preserved after successful import and `sourcestructure.json` + `studyPar.json` are copied to `<project_root>/derivatives/ExploreASL_GUI/`. When disabled (default), `.easl_staging/` is deleted after successful import.

#### Scenario: Debug mode enabled on successful import

- **WHEN** all subjects succeed and "Preserve staging directory" is enabled
- **THEN** `.easl_staging/` is preserved, configs are copied to `derivatives/ExploreASL_GUI/`

#### Scenario: Debug mode disabled on successful import

- **WHEN** all subjects succeed and "Preserve staging directory" is disabled
- **THEN** `.easl_staging/` is deleted entirely

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

### Requirement: ImportProgress table population

The progress table SHALL be populated from two sources: (1) `read_import_status` lock file scan results when entering step 5, and (2) real-time events during import execution. On entering step 5, the system SHALL call `read_import_status` to reconstruct per-subject progress, then SHALL compute staleness by diffing current config against `mostRecentConfig`.

During import execution, the table SHALL update in real-time as structured events arrive. All subjects start with `status: "pending"` when `startImport()` is called.

#### Scenario: Table shows reconstructed status on re-visit

- **WHEN** the user navigates to step 5 after a successful import
- **THEN** the progress table lists all subjects with status "completed" (reconstructed from lock files), not "pending"

#### Scenario: Table shows reconstructed failed status on re-visit

- **WHEN** the user navigates to step 5 after a partially failed import
- **THEN** failed subjects show status "failed" and completed subjects show status "completed", all reconstructed from lock files

#### Scenario: Table updates during active import

- **WHEN** a `subject_start` event arrives for subject "GOOD" during an active import
- **THEN** `importProgress["GOOD"].status` transitions from "pending" to "running"

### Requirement: canAccessPhase dispatches on dataSource

`canAccessPhase(project, targetPhase)` SHALL implement the phase gating logic:

- `idx = PROJECT_PHASES.indexOf(targetPhase)`, `currentIdx = PROJECT_PHASES.indexOf(project.projectMeta.currentPhase)`.
- If `idx <= currentIdx` → return `true`.
- If `targetPhase === "parameters"` → return `true`.
- If `targetPhase === "processing"` → dispatch on `dataSource`:
  - `dataSource === "bids"` → return `project.uiState?.import?.bidsReviewConfirmed === true`
  - `dataSource === "dicom"` → return `project.uiState?.import?.completed === true`
- If `targetPhase === "visualization" || targetPhase === "manifest"` → return `project.uiState?.population?.completed === true`.
- Else → return `false`.

`dataSource` is required (no fallback default per `ProjectMetaSchema`). Existing test fixtures that omitted `dataSource` MUST be updated to set it explicitly.

#### Scenario: BIDS project before confirmation blocked from processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = false`
- **THEN** returns `false`

#### Scenario: BIDS project after confirmation reaches processing

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "bids"` and `bidsReviewConfirmed = true`
- **THEN** returns `true`

#### Scenario: DICOM project gate unchanged

- **WHEN** `canAccessPhase(project, "processing")` is called where `dataSource = "dicom"` and `uiState.import.completed = true`
- **THEN** returns `true`

### Requirement: ImportPage conditional rendering

`ImportPage` SHALL render based on `project.projectMeta.dataSource`:

- `"bids"` → render `BIDSReviewPanel`
- `"dicom"` → render the existing 6-step DICOM wizard

When `uiState.import.bidsReviewConfirmed = true` and user revisits Import on a BIDS project, `BIDSReviewPanel` renders a persisted summary with explicit re-scan/re-confirm capability.

#### Scenario: BIDS project lands on review panel

- **WHEN** user creates a BIDS-direct project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders `BIDSReviewPanel` (not the 6-step wizard)

#### Scenario: DICOM project lands on wizard

- **WHEN** user creates a DICOM project and navigates to `/project/:id/import`
- **THEN** `ImportPage` renders the existing 6-step DICOM wizard

#### Scenario: BIDS project revisit supports re-sync

- **WHEN** user with `bidsReviewConfirmed = true` navigates back to Import on a BIDS-direct project
- **THEN** `ImportPage` renders `BIDSReviewPanel` with persisted summary and `[Re-scan BIDS]`
