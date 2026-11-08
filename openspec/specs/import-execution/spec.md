## Purpose

Define execution of the ExploreASL import pipeline from staged source data.

## Requirements

### Requirement: Mutation-free staging plan preflight

Native import SHALL compile and validate the complete confined staging plan before mutation, using only active-project root authority and revalidating the same portable component and collision contract at launch.

#### Scenario: Import staging is previewed or admitted for execution

- **WHEN** preflight or Run Import receives staging entries
- **THEN** provenance, ownership, path safety, collisions, errors, and transition authority SHALL satisfy these rules:

Before deleting, creating, linking, copying, or writing anything under `.easl_staging`, the native import boundary SHALL validate every staging entry and expand the complete source-to-destination plan. Every entry SHALL carry original logical Subject/Session/Run provenance and a separate Run alias; provenance SHALL NOT be inferred from source paths. The authoritative checks SHALL include the portable Subject, Session, Run, Run-alias, and Modality component contract; readable file or directory sources; canonical source resolution; exclusion of sources inside the staging tree; canonical staging-root ownership; destination confinement beneath `.easl_staging/sourcedata`; one-to-one original-to-target mappings; and complete portable destination collision detection.

The canonical `AppState.active_project_root` SHALL be the sole project-root authority. Native preflight and Run Import SHALL accept staging entries but SHALL NOT accept a staging-root or project-root candidate; they SHALL derive their only staging root as canonical `<active-root>/.easl_staging` and reject no active root, an existing staging-root symlink, an existing `sourcedata` symlink, or any existing destination-directory-component symlink. An existing leaf-file symlink SHALL be permitted only when it resolves to that file record's exact canonical source; broken links and links to other targets SHALL be rejected. This exception SHALL NOT bypass destination-parent checks or reuse prior staged files: admitted execution SHALL remove the prior staging tree before recreating the compiled plan. Existing destination parents SHALL canonicalize beneath canonical `<active-root>/.easl_staging/sourcedata`, not merely beneath staging. After compilation, cleanup, execution, configuration writes, lock copying, command arguments, process spawn, and import-state ownership SHALL use `CompiledStagingPlan.staging_root`. The plan SHALL reject distinct destination directory spellings that collapse under Unicode NFC normalization and case-insensitive comparison, while permitting multiple source files to intentionally populate one logical directory only when both final Subject/Session/Run/Modality spellings and the original logical Subject/Session/Run tuple are exactly identical. It SHALL reject distinct source files whose final destination filenames collide under the same comparison. Validation SHALL finish for the entire plan before filesystem mutation and SHALL return all detected issues as structured errors with stable codes, affected entry indexes and fields, corrective messages, and conflicting entry indexes where applicable. A read-only preflight operation used by Preview Import and the Run Import operation SHALL apply the same authoritative validator; Run Import SHALL always revalidate rather than trusting an earlier preview result.

The serialized frontend project transition SHALL set the candidate native active root before candidate frontend stores hydrate and clear it during close before frontend stores reset. Native-root set or clear failure SHALL leave project work admission closed; a page mount/unmount lifecycle SHALL NOT independently register or clear the native root.

#### Scenario: Traversal component reaches native boundary

- **WHEN** any IPC staging entry contains `.`, `..`, an absolute component, a separator, or another forbidden component value
- **THEN** native preflight SHALL reject the entry with a field-level issue and SHALL leave the existing staging tree byte-for-byte unchanged

#### Scenario: Destination escapes staging source root

- **WHEN** a computed destination or canonical parent would resolve outside `.easl_staging/sourcedata`
- **THEN** native preflight SHALL reject the plan before deleting or creating any staging path

#### Scenario: Existing destination component is a symlink

- **WHEN** `.easl_staging`, `sourcedata`, or any existing Subject/Session/Run/Modality destination component is a symlink, or a leaf-file symlink does not resolve to its exact planned canonical source
- **THEN** native preflight SHALL return a stable destination-symlink issue and SHALL leave existing staging bytes unchanged

#### Scenario: Retry encounters matching staged file links

- **WHEN** an earlier run left leaf-file symlinks resolving to the exact canonical sources in the current plan, with no symlinked destination directories
- **THEN** read-only preflight SHALL accept those links without mutation, and admitted execution SHALL remove the prior staging tree and recreate the compiled plan without modifying original source files

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

Native run ownership SHALL exclusively authorize import staging mutation, verification, relocation, and terminal classification, requiring verified fresh evidence and completed required cleanup rather than renderer or parser claims.

#### Scenario: An owned import run exits and finalizes

- **WHEN** staging or output post-processing occurs for the immutable selected scope
- **THEN** run identity, lifecycle, verification, cleanup, and outcomes SHALL follow these rules:

Every public operation that mutates import staging, verifies completion, cleans failed status, or relocates import output SHALL derive canonical project and staging roots from the active project and the matching native import run. Caller-supplied roots, result subject lists, frontend progress, persisted UI phase, and parser-only completion events SHALL NOT authorize mutation or success. Retry preservation SHALL accept only a safe subset of subjects verified as committed by the prior terminal run and disjoint from the current selected subject scope.

Native import ownership SHALL expose `Idle`, `Preparing`, `Running`, `Finalizing`, `Completed`, `Failed`, `Cancelling`, `Cancelled`, and `Interrupted` lifecycle states. Reservation SHALL enter `Preparing`; successful spawn SHALL enter `Running`; confirmed process exit SHALL leave `Running` before finalization begins. The native supervisor SHALL own output draining, process wait, completion verification, failed-lock cleanup, transactional relocation, and terminal classification. Every state mutation, event, cancellation, finalization step, and cleanup SHALL require the matching native run identity and ownership generation. Public post-processing commands that let the frontend initiate or classify finalization SHALL be removed.

Finalization SHALL process only subjects from the immutable selected scope. A failed run MAY commit subjects with verified fresh completion evidence, but the run SHALL become `Completed` only when process exit is successful, every selected subject has verified fresh completion evidence, every selected subject rawdata relocation commits, and required derived-artifact, transaction, and non-debug staging cleanup completes. Otherwise it SHALL expose a structured `Failed`, `Cancelled`, or `Interrupted` result while retaining staging and recovery evidence required for retry or diagnosis. Debug preservation SHALL waive staging deletion only, not completion verification or required derived-artifact and transaction cleanup.

#### Scenario: Frontend submits post-processing authority

- **WHEN** a caller supplies a project root, staging root, subject result list, or requested terminal outcome
- **THEN** native import APIs SHALL reject or ignore that authority and SHALL derive finalization only from the matching run record and owned filesystem evidence

#### Scenario: A subject completes before process exit

- **WHEN** progress output or a completion lock appears for one selected subject while the import process is still running
- **THEN** the run SHALL remain `Running` and project output SHALL remain unchanged

#### Scenario: Process exits and finalization begins

- **WHEN** the matching import process exit is confirmed
- **THEN** native ownership SHALL enter `Finalizing` before completion verification, cleanup, or relocation and SHALL emit an authoritative run snapshot

#### Scenario: Partial process success

- **WHEN** some selected subjects have verified fresh completion evidence and others do not
- **THEN** native finalization SHALL relocate only verified subjects, preserve failed-subject staging, and record a failed terminal result with per-subject outcomes

#### Scenario: Terminal cleanup succeeds

- **WHEN** all selected subjects verify and commit, required non-debug staging cleanup succeeds, and the terminal record is durably written
- **THEN** the run SHALL become `Completed` while retaining a replayable terminal snapshot until acknowledgement

#### Scenario: Replaced run finishes late

- **WHEN** an obsolete supervisor, event, cancellation response, or finalization callback runs after a newer terminal run has been acknowledged and replaced
- **THEN** its run identity mismatch SHALL prevent every lifecycle, result, filesystem, and frontend-visible mutation

#### Scenario: Foreign post-processing root is submitted

- **WHEN** a caller attempts finalization or mutation against a root that does not match native active-project and run ownership
- **THEN** native code SHALL reject it before mutation and foreign project or staging content SHALL remain unchanged

#### Scenario: Retry subject is not owned

- **WHEN** retry preservation names an unsafe subject or one not verified and committed by the prior owned run
- **THEN** native code SHALL reject the request before copying lock files

#### Scenario: Run retry preserve authorization fails

- **WHEN** preserved subjects are failed, unverified, unowned, overlap the selected run scope, or belong to another project/run
- **THEN** reservation SHALL fail before ownership replacement, staging mutation, or process spawn

#### Scenario: Stop signal fails

- **WHEN** native cancellation cannot signal the process owned by the matching `Running` run
- **THEN** the run SHALL retain actionable ownership, SHALL not claim cancellation, and a later exit SHALL remain eligible for normal finalization

#### Scenario: Stop timeout or force-kill fails

- **WHEN** graceful termination times out and force termination fails or cannot be confirmed
- **THEN** the run SHALL remain nonterminal with structured cancellation failure and SHALL preserve matching supervisor ownership

#### Scenario: A subject completes before sibling process exit

- **WHEN** one selected subject produces completion evidence while the process remains active for sibling subjects
- **THEN** the run SHALL remain `Running` and every public project-output mutation SHALL remain unavailable

#### Scenario: Terminal event reaches frontend

- **WHEN** native finalization durably reaches a terminal result
- **THEN** native code SHALL update ownership before emitting the terminal snapshot so frontend reconciliation observes the authoritative state

#### Scenario: Readiness event races command response

- **WHEN** `Running` readiness is emitted before the launch response reaches the frontend
- **THEN** attachment or the launch snapshot SHALL reconcile the same run and cancellation SHALL use its native run identity rather than a PID cache

#### Scenario: Replaced generation finishes late

- **WHEN** a previous generation's supervisor finishes after a newer run becomes current
- **THEN** generation and run identity guards SHALL prevent it from changing the newer run or emitting accepted events

#### Scenario: Queued prior request readiness reaches a same-project rerun

- **WHEN** queued readiness from an obsolete request reaches listeners bound to a newer same-project run
- **THEN** the listener SHALL reject its run identity and SHALL not change lifecycle or controls

#### Scenario: Delayed old PID response follows cancellation and rerun

- **WHEN** a delayed legacy launch response or obsolete run snapshot arrives after cancellation and a newer reservation
- **THEN** the frontend SHALL ignore it and Stop SHALL remain bound to the newer native run identity

#### Scenario: Previous supervisor finishes after a new reservation

- **WHEN** an obsolete supervisor completes cleanup after a newer reservation exists
- **THEN** it SHALL not change newer lifecycle, subject evidence, process ownership, staging ownership, or terminal result

### Requirement: Import execution pipeline

Import reservation SHALL durably bind an immutable attempt before staging mutation; exact Preparing-run launch SHALL revalidate, prepare, spawn, and publish authoritative state with race-safe listener attachment.

#### Scenario: An import attempt is reserved and launched

- **WHEN** the frontend reserves a run, attaches listeners, and requests launch
- **THEN** immutable admission, preparation, rejection, and failure snapshots SHALL follow this sequence:

Import execution SHALL use a native-generated run identity. Reservation SHALL atomically bind the active project, immutable selected subjects, confirmed relocation plan, execution policy, and a durable preparation record before staging mutation. Launch SHALL accept that exact `Preparing` run identity, repeat authoritative staging preflight, rebuild the standardized four-level staging tree, write validated ExploreASL configuration, establish a fresh staging-generation marker and absent selected-subject completion baseline, preserve only authorized unselected locks, spawn the selected execution profile, and return an authoritative run snapshot. Invalid, stale, foreign-project, duplicate, or non-`Preparing` run identities SHALL be rejected without mutating files or another run.

Frontend listener registration SHALL occur after reservation and before launch. Attachment after listener registration SHALL return a fresh snapshot so preparation, launch, or exit that races listener setup cannot be missed. Launch failures after exact admission SHALL be recorded against that run and returned as authoritative failed snapshots.

#### Scenario: Successful pipeline start

- **WHEN** a reserved run with valid staging input and execution profile is launched
- **THEN** native code SHALL prepare staging, spawn the process, transition the run to `Running`, and return the matching snapshot

#### Scenario: Authoritative preflight fails at launch

- **WHEN** current staging input no longer passes preflight for the reserved run
- **THEN** the run SHALL become `Failed`, no process SHALL spawn, and existing project output SHALL remain unchanged

#### Scenario: Launch uses an obsolete run

- **WHEN** launch names a missing, acknowledged, replaced, or foreign-project run identity
- **THEN** native code SHALL reject it without changing current ownership, staging, project output, or process state

#### Scenario: Process exits during listener setup

- **WHEN** the process reaches finalization between frontend listener registration and attachment
- **THEN** the post-listener attachment snapshot SHALL expose `Finalizing` or the resulting terminal state

#### Scenario: Symlink creation failure

- **WHEN** staging tree creation fails for an admitted run
- **THEN** native code SHALL durably fail that run, spawn no process, and preserve existing project output

#### Scenario: MATLAB not found

- **WHEN** the selected MATLAB execution profile points to a missing executable
- **THEN** launch SHALL return a structured failed snapshot describing the missing executable and SHALL spawn no process

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

Import output SHALL provide run-correlated raw and structured diagnostics without authorizing subject or run completion; the frontend SHALL discard events outside its attached identity.

#### Scenario: Import workers emit stdout or stderr

- **WHEN** parser events or completion text reach the frontend
- **THEN** identity filtering and provisional-only progress SHALL follow these rules:

The system SHALL stream import stdout and stderr as run-correlated raw and structured events. Subject start, subject completion, parser failure, global completion text, and conversion status SHALL update diagnostics or provisional progress only. Every event SHALL identify the matching native run and ownership generation, and the frontend SHALL discard events that do not match its attached run. No stdout text, including `xASL_module_Import completed 100%`, SHALL independently transition a subject or run to authoritative completion.

#### Scenario: Subject starts processing

- **WHEN** matching run output identifies a selected subject entering Import
- **THEN** a run-correlated progress event SHALL report that subject as running

#### Scenario: Parser reports subject completion

- **WHEN** output contains a subject completion line before native finalization
- **THEN** the event MAY update provisional progress but SHALL NOT establish completed status or authorize relocation

#### Scenario: Global completion text is missing

- **WHEN** the process exits successfully and every selected subject has valid fresh completion artifacts but the global completion text was not captured
- **THEN** native finalization SHALL determine the result from process and artifact evidence rather than fail solely because a parser event was absent

#### Scenario: Stale event reaches a replacement run

- **WHEN** a queued raw or structured event identifies an obsolete run or ownership generation
- **THEN** native and frontend state SHALL remain unchanged

#### Scenario: NII2BIDS failure detected

- **WHEN** matching output reports NII2BIDS failure for a selected subject
- **THEN** a run-correlated diagnostic event SHALL capture the subject, step, and message while native artifact verification retains terminal authority

#### Scenario: Import completes

- **WHEN** matching output contains `xASL_module_Import completed 100%`
- **THEN** a run-correlated diagnostic event SHALL be emitted without independently completing the run

### Requirement: Process lifecycle management

Native import shutdown SHALL terminate and settle its supported process scope before project transition, blocking on unconfirmed settlement and retiring prior-project frontend resources only after success.

#### Scenario: Stop or project/application transition requests import shutdown

- **WHEN** an owned import process must stop
- **THEN** graceful termination, force escalation, reporting, and transition cleanup SHALL follow these rules:

The system SHALL store the active import process scope in native app state; remembered child PIDs SHALL NOT grant termination or recovery authority. User Stop, project close, project switch, and normal app exit SHALL request platform-appropriate graceful termination, wait up to five seconds, then force remaining members of the supported process group or Job Object. Graceful signaling failure SHALL be recorded; successful delivery SHALL only be claimed for validated platform/workload combinations. The shutdown operation SHALL report whether the supported process scope settled. Project close, project switch, and normal app exit SHALL remain blocked if termination cannot be confirmed. A successful project transition SHALL unregister import listeners, cancel queued log batches, and invalidate post-processing owned by the prior project before another project is hydrated.

#### Scenario: User stops import mid-run

- **WHEN** the user clicks Stop during a running import
- **THEN** graceful termination SHALL be requested, force termination SHALL follow after five seconds if needed, and all in-progress subjects SHALL be marked cancelled after supported-scope settlement

#### Scenario: User switches project during import

- **WHEN** project B activation is requested while project A has an active import
- **THEN** the system SHALL terminate A's import and unregister its listeners before B becomes active

#### Scenario: Import cannot stop during switch

- **WHEN** project A's supported process scope cannot be confirmed stopped
- **THEN** project switching SHALL fail, project B SHALL NOT become active, and an actionable error SHALL be shown

#### Scenario: App closes during import

- **WHEN** the user closes the app while an import is running
- **THEN** the app SHALL block normal exit until supported-scope termination succeeds and SHALL remain open with an error if termination cannot be confirmed

#### Scenario: Prior post-processing resolves late

- **WHEN** project A import post-processing resolves after A's lifecycle has ended
- **THEN** it SHALL NOT move output, update progress, change phase, or save state for project B

### Requirement: Lock file cleanup for failed subjects

Only matching native finalization SHALL clean failed selected-subject staging status files after verification, preserving verified subjects and unsafe or unauthoritative evidence.

#### Scenario: Selected subjects fail completion verification after process exit

- **WHEN** native finalization evaluates failed-subject status cleanup
- **THEN** owned paths, file scope, and deletion authority SHALL follow these rules:

After process exit, native finalization SHALL clean the three staging status files (`010_DCM2NII.status`, `020_NII2BIDS.status`, `999_ready.status`) only for selected subjects that failed authoritative completion verification, under `<owned-staging-root>/derivatives/ExploreASL/lock/xASL_module_Import/<Subject>/xASL_module_Import/`. Cleanup SHALL derive its root and subject scope from the matching native run, reject unsafe entries, and preserve evidence when staging-generation authority is missing. Parser `import_failed` events SHALL NOT independently authorize deletion. No renderer-callable failed-status cleanup command SHALL be exposed. Status files for verified subjects SHALL remain unchanged by failed-subject cleanup.

#### Scenario: One subject fails, one succeeds

- **WHEN** GOOD passes native completion verification and BADDIE fails it
- **THEN** after MATLAB exits, lock files for BADDIE are deleted, lock files for GOOD are preserved

#### Scenario: All subjects succeed

- **WHEN** all selected subjects pass native completion verification
- **THEN** no lock files are deleted

### Requirement: Confirmed relocation plan integrity

Import SHALL bind a native read-only rawdata replacement plan to its immutable selected scope and reject stale or foreign custody fingerprints before output mutation.

#### Scenario: Replacement inventory is confirmed and later used for relocation

- **WHEN** native import plans or admits rawdata replacement
- **THEN** disclosed inventory, bound identity, and revalidation SHALL follow these rules:

Before import starts, the system SHALL obtain a native, read-only relocation plan for the immutable selected-subject snapshot. The plan SHALL derive all project and staging roots from native active-project ownership, SHALL identify every existing project-relative rawdata path that a successful relocation would replace, and SHALL include per-subject file counts, byte totals, sessions, and an opaque content fingerprint. Derived import locks, import logs, and BIDS2Legacy locks SHALL NOT participate in the confirmed custody fingerprint. Absolute project paths SHALL NOT be exposed in the user-facing inventory.

Native import ownership SHALL bind the confirmed plan identity and fingerprint to the same subject snapshot and import generation used for staging and execution. Before relocation mutates project output, the system MUST recompute the destination inventory and SHALL reject a missing, foreign, subject-mismatched, or stale plan without changing project output. Staging output SHALL remain available after this rejection.

#### Scenario: Destination has no replaceable artifacts

- **WHEN** native planning finds no existing subject rawdata that relocation would replace for the selected subjects
- **THEN** the plan SHALL report an empty replacement inventory and SHALL remain eligible to bind to that exact selected-subject snapshot

#### Scenario: Destination inventory changes after confirmation

- **WHEN** a confirmed destination file is added, removed, renamed, or changed before relocation begins
- **THEN** native relocation SHALL reject the stale fingerprint before changing project output and SHALL preserve staging for a new plan and confirmation

#### Scenario: Plan belongs to another scope

- **WHEN** relocation receives a plan identity created for another project, import generation, or portable selected-subject set
- **THEN** native relocation SHALL reject before creating candidates, moving destinations, deleting caches, or changing import ownership

### Requirement: Structured relocation outcome

Relocation SHALL report durable per-subject custody and actionable failures, retaining staging and ownership for unresolved work and never presenting incomplete required cleanup as successful import.

#### Scenario: Relocation commits, rolls back, or needs recovery

- **WHEN** relocation returns subject outcomes or considers staging cleanup
- **THEN** durability, partial-result presentation, and preservation SHALL follow these rules:

Relocation SHALL return a structured outcome that identifies each owned succeeded subject as `committed`, `rolledBack`, or `recoveryRequired` and includes an actionable phase and message for every failure. A subject SHALL NOT be reported as committed until its complete rawdata replacement is durable. A committed subject with pending derived reconciliation SHALL retain committed status and carry a cleanup message. The frontend SHALL surface relocation failures and partial outcomes in import status and logs; it SHALL NOT convert a relocation failure or pending required cleanup into successful import completion or silently discard the error.

Staging cleanup SHALL occur only when every subject expected to relocate is committed and existing cleanup conditions permit it. Any failed or unresolved relocation SHALL retain staging and native ownership for retry, inspection, or recovery. Existing debug-mode staging preservation SHALL remain unchanged.

#### Scenario: Every subject commits

- **WHEN** all owned succeeded subjects complete relocation and required cleanup succeeds
- **THEN** the outcome SHALL report every subject as committed and normal import completion SHALL proceed

#### Scenario: One subject commits and another fails

- **WHEN** subject A commits and subject B encounters a relocation failure that is rolled back
- **THEN** the outcome SHALL report A as committed and B as rolled back, the frontend SHALL show a failed partial outcome, and staging SHALL remain available

#### Scenario: Relocation error reaches frontend

- **WHEN** native relocation returns any subject failure or recovery-required state
- **THEN** the frontend SHALL show the affected subject, failure phase, and actionable message and SHALL NOT mark the run fully completed

### Requirement: Output relocation after import

Native relocation SHALL transactionally replace each verified succeeded subject's complete rawdata tree, preserve unrelated content, reconcile derived import artifacts independently, and retain recoverable evidence until durable custody and cleanup settle.

#### Scenario: Verified staged subjects are installed into project output

- **WHEN** import output relocation processes complete, partial, failed, or interrupted results
- **THEN** replacement, validation, transaction recovery, dataset description, and staging cleanup SHALL follow these rules:

The native output-relocation operation SHALL replace import output per owned succeeded subject without deleting unrelated project data. For each subject, the staged `rawdata/sub-<Subject>/` SHALL be the complete authoritative replacement for the project `rawdata/sub-<Subject>/`; older sessions and files absent from the staged replacement SHALL NOT be merged forward. After rawdata custody commits, the operation SHALL idempotently reconcile that subject's import-lock directory and matching import logs and remove matching BIDS2Legacy subject-session lock directories. Derived reconciliation SHALL NOT roll back or endanger committed rawdata. Existing Structural, ASL, Population, Stats, `dataPar.json`, `participants.tsv`, non-import lock files, unrelated logs, and unrelated subjects SHALL remain unchanged.

Before replacing a subject, the system SHALL require nonempty staged subject rawdata, reject symlinks and unsupported filesystem entries in owned source, candidate, destination, backup, and journal paths, copy into an exclusively created sibling candidate, and verify the complete relative-path, entry-type, size, and content inventory against the staged source. It SHALL durably record recovery state before moving an existing rawdata destination to a sibling backup. A subject SHALL commit only after its complete rawdata replacement is installed and durable. Existing subject rawdata SHALL remain recoverable until a durable subject commit records which copy owns custody.

Relocation SHALL process subjects independently. Failure before a subject commits SHALL restore that subject's complete previous rawdata state or preserve its absence when no prior state existed. A subject committed before another subject fails SHALL remain committed. Derived-artifact reconciliation failure SHALL retain staging, report an actionable cleanup error, and remain retryable without changing rawdata custody. Dataset description creation, when required and absent, SHALL be atomic and SHALL NOT overwrite an existing project dataset description.

The rawdata transaction SHALL handle ordinary application/OS crashes and filesystem errors under authoritative single-instance ownership. Deliberate substitution of transaction artifacts and unsupported concurrent project writers SHALL remain outside the contract; path confinement, corruption validation, exclusive creation, and preservation of unrelated content SHALL remain required. Rawdata crash atomicity SHALL mean recoverability to a complete old or new subject tree, not continuous destination availability between backup and installation renames.

When staged `dataset_description.json` is present and the project description is absent, relocation SHALL install it before subject transactions. A preexisting description SHALL remain unchanged. A transaction-created description SHALL remain after any subject commits; when none commits, rollback SHALL remove only transaction-owned description artifacts. Dataset rollback SHALL durably record `rollbackIntent` before removal and SHALL resume interrupted destination/candidate removal idempotently. Unowned candidate collisions SHALL reject before mutation, including when dataset creation is skipped.

When all subjects succeed, required derived-artifact and transaction cleanup completes, and staging cleanup is requested, the system SHALL delete staging only after every subject commit and the durable outcome. Debug mode SHALL preserve staging and copy import configuration as before. During partial process success, relocation failure, stale confirmation, pending required cleanup, or unresolved recovery, staging SHALL remain available. When no subjects succeeded, relocation SHALL NOT modify project output.

#### Scenario: Full success with debug mode off

- **WHEN** all subjects succeed, every subject rawdata transaction commits, required derived-artifact and transaction cleanup succeeds, and debug mode is disabled
- **THEN** complete subject rawdata SHALL replace its planned destination, derived import locks and matching logs SHALL be reconciled, matching BIDS2Legacy locks SHALL be removed, unrelated project data SHALL remain unchanged, staging SHALL be deleted, and normal phase advancement SHALL proceed

#### Scenario: Full success with debug mode on

- **WHEN** all subjects succeed, every subject rawdata transaction commits, required derived-artifact and transaction cleanup succeeds, and debug mode is enabled
- **THEN** subject output SHALL commit, unrelated project data SHALL remain unchanged, staging SHALL be preserved, and import configurations SHALL be copied to the GUI derivatives directory

#### Scenario: Rawdata commits but derived reconciliation fails

- **WHEN** a subject's rawdata commit is durable but its import locks, matching logs, or BIDS2Legacy cleanup cannot be reconciled
- **THEN** its rawdata SHALL remain committed, staging and the relocation journal SHALL remain for retry, and finalization SHALL expose `Failed` with an actionable cleanup error even when debug preservation is enabled

#### Scenario: Dataset-description rollback is interrupted

- **WHEN** no subject committed and interruption occurs after recording dataset rollback intent but before completing removal
- **THEN** recovery SHALL resume removal of transaction-owned description artifacts, accept already-completed removal, preserve existing user descriptions, and restore the complete previous subject state

#### Scenario: Existing subject has extra sessions and files

- **WHEN** a confirmed subject destination contains sessions or files absent from the verified staged subject replacement
- **THEN** the committed project subject SHALL exactly match the staged subject inventory and SHALL exclude those older sessions or files

#### Scenario: Re-import after full processing pipeline

- **WHEN** a user re-runs import for selected subjects on a project that already has completed Structural, ASL, or Population output
- **THEN** only each committed subject's rawdata and subject-matching derived import artifacts SHALL change, while all processing outputs and unrelated subjects SHALL remain unchanged

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

The native supervisor SHALL record the matching process exit status before completion classification. A nonzero exit SHALL prevent a fully successful run even if parser output claimed completion. A zero exit SHALL NOT establish success unless every selected subject also passes fresh completion verification and required relocation commits. Per-subject parser failures SHALL enrich diagnostics but SHALL NOT substitute for native artifact verification.

#### Scenario: MATLAB crashes mid-import

- **WHEN** the process exits nonzero with some subjects lacking verified completion evidence
- **THEN** those subjects and the run SHALL be failed, while any independently verified subject MAY be relocated under the partial-success contract

#### Scenario: MATLAB exits zero without complete targets

- **WHEN** the process exits successfully but any selected subject lacks valid fresh completion evidence
- **THEN** the run SHALL become `Failed` and SHALL identify each missing or invalid target

#### Scenario: MATLAB exits zero with complete targets

- **WHEN** the process exits successfully, all selected subjects verify and commit rawdata, and required cleanup succeeds under the configured debug-preservation policy
- **THEN** the run SHALL become `Completed`

#### Scenario: MATLAB exits normally with zero code

- **WHEN** the process exits with code zero
- **THEN** native finalization SHALL verify every selected target and relocation outcome before choosing `Completed` or `Failed`

### Requirement: Subprocess kill on app exit

The Rust backend SHALL retain its normal-exit cleanup handler. On an exit request it SHALL invoke the same in-process process-scope shutdown used by Stop and project transitions, preserving the five-second scientific-worker grace and blocking exit when supported-scope settlement cannot be confirmed. Abrupt native-process death is outside this handler and SHALL use interrupted-run confirmation on restart.

#### Scenario: MATLAB process running on app exit

- **WHEN** the Tauri application receives a normal exit request while MATLAB is running
- **THEN** native shutdown SHALL signal its process group or Job Object, preserve the five-second grace, force remaining supported-scope members, and allow exit only after settlement

#### Scenario: No MATLAB process running on app exit

- **WHEN** the Tauri window is closed and no import process scope is active
- **THEN** the app SHALL exit immediately without delay

#### Scenario: Native process exits abnormally

- **WHEN** the native application dies without running its exit handler
- **THEN** the system SHALL make no automatic worker-termination claim and SHALL require interruption confirmation on the next activation

### Requirement: Debug mode (Preserve staging directory)

A global setting "Preserve staging directory" SHALL be added to `globalStore.settings` under the Import module section, defaulting to `false`. When enabled, `.easl_staging/` is preserved after successful import and `sourcestructure.json` + `studyPar.json` are copied to `<project_root>/derivatives/ExploreASL_GUI/`. When disabled (default), `.easl_staging/` is deleted after successful import.

#### Scenario: Debug mode enabled on successful import

- **WHEN** native finalization succeeds, including required derived-artifact and transaction cleanup, and "Preserve staging directory" is enabled
- **THEN** `.easl_staging/` is preserved, configs are copied to `derivatives/ExploreASL_GUI/`

#### Scenario: Debug mode disabled on successful import

- **WHEN** native finalization succeeds, including required derived-artifact and transaction cleanup, and "Preserve staging directory" is disabled
- **THEN** `.easl_staging/` is deleted entirely

### Requirement: MATLAB executable selection for import

Import execution SHALL use configured execution profiles rather than MATLAB-only selection, binding the selected profile to exact native reservation and disabling Start when no profiles exist.

#### Scenario: Import execution resolves the selected profile

- **WHEN** step 5 displays execution choices or launches a reserved import
- **THEN** selector replacement, profile resolution, and launch identity SHALL follow these rules:

This requirement is **replaced** by the Profile selector defined in the `execution-profiles` capability spec. The import step 5 execution view SHALL provide an Execution Profile select dropdown (replacing the MATLAB version select dropdown). The dropdown SHALL list all configured execution profiles from `globalStore.settings.executionProfiles`, displaying each profile's label and type. The selection SHALL be stored as `selectedProfileId`. Reservation SHALL bind the selected profile ID; `launch_import_run` SHALL receive the matching typed profile with the exact reserved run identity.

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
- **THEN** `launch_import_run` SHALL receive the full typed `ExecutionProfile` object matching the reservation, not separate `matlabPath` / `exploreAslPath` strings

### Requirement: ImportProgress table population

Import progress SHALL use matching native snapshots while attached, otherwise audit committed artifacts and compute independent configuration staleness; parser events SHALL remain provisional.

#### Scenario: Import progress is initialized or updated

- **WHEN** discovery finds a native run or falls back to committed artifacts
- **THEN** status authority, Preparing initialization, and staleness SHALL follow these rules:

When discovery finds no active or replayable native run, the progress table SHALL use `read_import_status` to audit committed project artifacts, then compute staleness by diffing current config against `mostRecentConfig`. While a native run is attached, its matching snapshots SHALL determine authoritative status and terminal outcomes.

Run-correlated structured events MAY update provisional running diagnostics, but parser completion SHALL NOT establish completed status. Every selected subject SHALL start pending when its reservation enters Preparing; only verified committed native outcomes or safe committed-artifact audit SHALL establish completion.

#### Scenario: Table shows reconstructed status on re-visit

- **WHEN** the user navigates to step 5 after a successful import
- **THEN** the progress table lists all subjects with status "completed" (reconstructed from lock files), not "pending"

#### Scenario: Table shows reconstructed failed status on re-visit

- **WHEN** the user navigates to step 5 after a partially failed import
- **THEN** failed subjects show status "failed" and completed subjects show status "completed", all reconstructed from lock files

#### Scenario: Table updates during active import

- **WHEN** a `subject_start` event arrives for subject "GOOD" during an active import
- **THEN** `importProgress["GOOD"].status` transitions from "pending" to "running"

### Requirement: Native phase access

Phase access SHALL use native `allowedPhases`, preserving cursor access and source-specific import and Population readiness without duplicating eligibility in the renderer.

#### Scenario: A project requests navigation to a workflow phase

- **WHEN** native eligibility evaluates the current cursor and readiness flags
- **THEN** allowed phases SHALL follow this decision contract:

`canAccessPhase(project, targetPhase)` SHALL check the native `allowedPhases` list. Native phase eligibility SHALL use:

- `idx = PROJECT_PHASES.indexOf(targetPhase)`, `currentIdx = PROJECT_PHASES.indexOf(project.projectMeta.currentPhase)`.
- Phases at or before the current cursor, Import, and Parameters are allowed.
- Processing is also allowed when BIDS review is confirmed for BIDS projects or import is completed for DICOM projects.
- Visualization and Manifest are also allowed when Population is completed.

`dataSource` is required by the native project contract.

#### Scenario: BIDS project before confirmation blocked from processing

- **WHEN** `canAccessPhase(project, "processing")` is called where the current phase precedes Processing, `dataSource = "bids"`, and `bidsReviewConfirmed = false`
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

### Requirement: Authoritative import run snapshot

Native state SHALL own at most one current import identity and lifecycle with immutable scope, evidence, outcomes, and errors, exposing camelCase snapshots without absolute project paths.

#### Scenario: A current import run is exposed to the renderer

- **WHEN** a run snapshot or lifecycle event is published
- **THEN** fields and excluded sources of authority SHALL satisfy this contract:

Native state SHALL own at most one current import run containing a session-unique `runId`, canonical project ownership, immutable selected subjects, lifecycle, start and update times, execution profile identity, ownership generation, per-subject evidence and outcome, process-exit evidence, relocation outcome, structured errors, and terminal result. Snapshots and lifecycle events SHALL use camelCase fields and SHALL not expose absolute project paths. Frontend PID caches, listener presence, parser state, and persisted project UI fields SHALL NOT be authoritative run identity or lifecycle sources.

#### Scenario: Current run is queried

- **WHEN** the frontend queries import work for the active project
- **THEN** native code SHALL return the matching non-acknowledged run snapshot or no run without mutating lifecycle or files

#### Scenario: Snapshot reports finalization failure

- **WHEN** completion verification or relocation fails for a matching run
- **THEN** its terminal snapshot SHALL include failed subject evidence and an actionable structured error without claiming completion

#### Scenario: Foreign project queries a run

- **WHEN** attachment names a run not owned by the active project
- **THEN** native code SHALL reject attachment without revealing absolute path data or mutating either project

### Requirement: Fresh import completion verification

Selected-subject completion SHALL require fresh regular owned-generation ready evidence and nonempty staged rawdata, never stale retry artifacts or unsafe filesystem entries.

#### Scenario: Finalization verifies a selected subject's completion

- **WHEN** native import evaluates ready artifacts before relocation
- **THEN** freshness, ownership, rawdata, and rejection SHALL follow these rules:

For each selected subject, native finalization SHALL verify a regular, non-symlink `999_ready.status` under the canonically owned staging lock directory, prove that it belongs to the current rebuilt staging generation and was absent before launch, and require the nonempty staged subject rawdata needed by relocation. Completion artifacts copied for unselected retry subjects SHALL never satisfy a selected subject. Missing, stale, malformed, symlinked, escaping, or wrong-generation evidence SHALL fail that subject without deleting project output.

#### Scenario: Fresh selected-subject artifact exists

- **WHEN** a selected subject produces an owned completion artifact in the current staging generation and nonempty staged rawdata
- **THEN** native finalization SHALL classify it as eligible for relocation

#### Scenario: Stale completion artifact survives unexpectedly

- **WHEN** a selected subject's completion path predates the current baseline or belongs to another staging generation
- **THEN** native finalization SHALL reject it as stale and SHALL not use it to authorize relocation or completion

#### Scenario: Completion artifact is a symlink

- **WHEN** a selected subject's completion path or parent resolves through a symlink
- **THEN** verification SHALL fail closed without following or deleting the unsafe path

#### Scenario: Ready lock lacks staged rawdata

- **WHEN** a fresh ready lock exists but the selected subject has no nonempty staged rawdata replacement
- **THEN** that subject and the run SHALL fail before its project destination changes

### Requirement: Durable finalization and terminal replay

Import SHALL persist admitted attempt evidence before mutation, exit evidence before finalization, and terminal results before presentation, retaining exact replay and recovery checkpoints until safe native reconciliation and acknowledgement.

#### Scenario: Import finalization persists, resumes, or replays

- **WHEN** an import exits, recovers, or reconciles its terminal result
- **THEN** durability order, historical compatibility, and checkpoint reuse SHALL follow these rules:

Before staging mutation, native code SHALL durably record project-local run identity, relative ownership/plan evidence, and the admitted attempt configuration needed for its successful freshness baseline. Exit evidence SHALL persist before finalization authority and terminal outcome before presentation. Remembered PIDs SHALL not authorize recovery after native restart.

Existing interrupted-run external-stop confirmation, staging preservation, safe Finalizing resumption, relocation checkpoint reuse, and released execution-record compatibility SHALL remain. Eligible terminal results SHALL remain replayable until native reconciliation saves their exact project result and then acknowledges that exact run. Frontend listeners, caches, or caller-selected outcomes SHALL not authorize saved completion. Acknowledgement SHALL remain idempotent and SHALL not remove unresolved recovery evidence. Historical compatible records without captured attempt settings SHALL preserve the prior successful baseline rather than synthesize it from current settings.

Relocation recovery SHALL checkpoint authoritative custody into the matching run record before finalizer resumption or journal retirement, even when derived cleanup remains pending. Existing checkpoints SHALL remain unchanged and conflicting outcomes SHALL reject. Safe cleanup retries SHALL not repeat relocation, delete retained staging, claim unproven cleanup, or rewrite historical terminal outcomes.

#### Scenario: Crash before import-run relocation checkpoint

- **WHEN** committed rawdata lacks a run checkpoint and derived cleanup remains pending
- **THEN** recovery SHALL persist custody, retain recovery artifacts, and avoid repeating relocation

#### Scenario: Cleanup retry follows terminal failure

- **WHEN** cleanup later succeeds for a checkpointed failed run
- **THEN** historical checkpoint/outcome SHALL remain unchanged and staging SHALL remain available

#### Scenario: Application stops during running import

- **WHEN** a Running record has no current supervisor
- **THEN** recovery SHALL expose Interrupted state and preserve staging without inferred completion

#### Scenario: Application stops during finalization

- **WHEN** durable evidence and external-stop confirmation permit safe resumption
- **THEN** native recovery SHALL finalize idempotently before exposing the result

#### Scenario: Frontend misses terminal event

- **WHEN** completion occurs without a frontend listener
- **THEN** later native reconciliation SHALL persist the admitted snapshot and outcome without repeating relocation

#### Scenario: Project persistence fails

- **WHEN** native result persistence fails
- **THEN** the run SHALL remain unacknowledged and replayable

#### Scenario: Matching terminal result is acknowledged

- **WHEN** native reconciliation durably saves the exact terminal project result
- **THEN** exact-run acknowledgement SHALL retire eligible replay state while retaining unresolved recovery evidence

### Requirement: In-process import supervision

Import SHALL use native in-process POSIX process groups or Windows Job Objects with concurrent transient output draining, preserving import-specific finalization and honest abnormal-interruption recovery without guardian infrastructure.

#### Scenario: Renderer or native lifetime changes during import

- **WHEN** native import supervises workers and drains their output
- **THEN** platform scopes, renderer independence, and excluded guardian authority SHALL follow these rules:

Import SHALL use the same native in-process process-scope mechanism as processing while retaining import-specific verification, relocation, cancellation, supported import-run-record compatibility, and terminal replay. Linux and macOS SHALL use POSIX process groups; Windows SHALL use Job Objects. Renderer death SHALL NOT stop native import completion. Native process death SHALL follow Honest abnormal-interruption recovery and SHALL NOT trigger persisted-PID adoption.

Import stdout and stderr SHALL be drained concurrently into the existing parser and run-correlated event path. Captured output SHALL remain transient; no guardian spool, diagnostic-capacity authority, retention receipt, or durable quiescence record SHALL be created.

#### Scenario: Renderer reloads during import

- **WHEN** the renderer reloads while native import supervision remains alive
- **THEN** import SHALL continue and the renderer SHALL attach to the current run without launching another worker

#### Scenario: Import output uses both streams

- **WHEN** an import worker writes stdout and stderr while running
- **THEN** both streams SHALL continue draining without pipe deadlock and parser events SHALL remain correlated to the exact import run

### Requirement: Interrupted import requires confirmation

Ownerless active import records SHALL become Interrupted and block new execution until explicit external-stop confirmation, preserving evidence and rejecting unsupported guardian or relocation-journal formats without mutation.

#### Scenario: Import records are reopened without live in-process ownership

- **WHEN** import recovery encounters interrupted or incompatible records
- **THEN** confirmation, evidence preservation, and compatibility SHALL follow these rules:

An import record found in Preparing, Running, or Cancelling without matching in-process ownership SHALL become Interrupted and preserve staging, captured domain evidence, verified commits, and relocation state. Project viewing MAY continue, but import and processing admission SHALL remain blocked until the user confirms the external worker has stopped. Confirmation SHALL NOT signal a persisted PID and SHALL NOT infer successful import.

Unshipped import records containing guardian containment fields SHALL reject without mutation and direct the user to settle them with the checkpoint build or restore a verified clean project copy. Released pre-guardian import-run records without those fields SHALL retain existing readability. Relocation-journal compatibility SHALL be separate: current relocation journals use version 3, and unfinished version 2 relocation journals SHALL fail closed without mutation, deletion, or automatic migration.

#### Scenario: App restarts after import interruption

- **WHEN** activation finds a nonterminal import record without a current native supervisor
- **THEN** it SHALL publish Interrupted, preserve staging, and require external-stop confirmation before replacement execution

#### Scenario: User confirms interrupted import stopped

- **WHEN** the user confirms the exact interrupted import after checking operating-system process tools
- **THEN** native recovery SHALL continue import-owned cleanup/replay without signaling a remembered process identity
