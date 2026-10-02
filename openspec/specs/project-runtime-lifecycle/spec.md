# project-runtime-lifecycle Specification

## Purpose

Define safe project transitions so each opened project owns a complete, isolated runtime session and no work or state can cross project boundaries.

## Requirements

### Requirement: Import relocation recovery before activation

Project activation SHALL inspect the candidate root for an unfinished native import-relocation recovery record after candidate validation but before normal project hydration, output access, or subprocess launch. Recovery SHALL derive every candidate, destination, and backup path from the canonical candidate project root and validated project-relative record data; it SHALL NOT trust absolute or escaping recorded paths.

For each subject durably recorded as committed, recovery SHALL preserve the installed rawdata replacement and remove only transaction-owned stale rawdata candidates or backups. For each subject not durably committed, recovery SHALL restore the complete previous rawdata destination when one existed or restore destination absence when it did not. After rawdata custody is settled, recovery SHALL retry pending import-lock, import-log, and BIDS2Legacy-lock reconciliation idempotently. Derived cleanup failure SHALL retain staging and the relocation journal and report a warning without rolling back committed rawdata or blocking activation when custody and its durable checkpoint are authoritative. Recovery SHALL finish all safe custody decisions before the project becomes active and SHALL expose a summary of preserved, restored, and cleaned subjects.

Before native import finalization resumes or the relocation journal is retired, recovery SHALL checkpoint the authoritative relocation outcome into the matching import-run record even when derived cleanup remains pending. An existing durable checkpoint SHALL remain unchanged; disagreement between records SHALL reject before mutation. Resumed finalization SHALL reuse that checkpoint instead of relocating committed rawdata again. Relocation recovery SHALL NOT remove staging or rewrite a historical terminal import result after a successful cleanup retry. Dataset-description rollback SHALL record durable removal intent and resume interrupted removal without deleting a preexisting description.

If the recovery record is malformed, references an unsafe path that could affect project output, conflicts with authoritative rawdata state, or cannot establish one complete old or new subject state, project activation MUST fail without guessing, deleting unrelated content, or hydrating the candidate project. Under authoritative single-instance ownership, a journaled project-relative candidate path is transaction-owned after exclusive creation; recovery MAY delete an interrupted partial candidate while restoring the recorded prior rawdata state. Cleanup failures for an otherwise unambiguous complete state SHALL be reported without changing which rawdata copy is authoritative.

#### Scenario: Crash before subject commit

- **WHEN** project activation finds an interrupted subject transaction without a durable commit record
- **THEN** recovery SHALL restore the previous complete subject rawdata tree or previous absence before the project becomes active

#### Scenario: Crash after subject commit

- **WHEN** project activation finds a durable subject commit with an installed rawdata replacement and retained transaction backup
- **THEN** recovery SHALL preserve the installed rawdata replacement and SHALL remove only the transaction-owned rawdata backup and candidate

#### Scenario: Earlier subject committed before later interruption

- **WHEN** the recovery record shows subject A committed and subject B interrupted before commit
- **THEN** recovery SHALL preserve A's replacement, restore B's previous state, and report both outcomes before activation completes

#### Scenario: Recovery record contains unsafe path data

- **WHEN** a recovery record contains an absolute path, traversal, symlink escape, foreign project identity, or unowned evidence that prevents proving a complete authoritative project destination
- **THEN** project activation SHALL fail without deleting, renaming, or copying the referenced filesystem content

#### Scenario: Candidate copy is interrupted

- **WHEN** recovery finds an incomplete candidate at a journaled project-relative candidate path before the candidate-ready checkpoint
- **THEN** recovery SHALL remove that transaction candidate, preserve or restore the prior rawdata destination, and retain staging for retry

#### Scenario: Recovery cannot establish complete state

- **WHEN** required destination and backup evidence is missing or conflicting such that recovery cannot prove a complete old or new subject state
- **THEN** project activation SHALL remain blocked and SHALL present an actionable recovery error instead of selecting a state heuristically

#### Scenario: No relocation recovery record exists

- **WHEN** a valid candidate project has no import-relocation recovery record
- **THEN** project activation SHALL continue with existing transition and hydration behavior

#### Scenario: Derived cleanup still fails after rawdata commit

- **WHEN** committed rawdata is proven complete but retrying derived import artifacts fails
- **THEN** recovery SHALL checkpoint custody before finalizer resumption, retain staging and the relocation journal, allow activation with a cleanup warning, and SHALL NOT relocate the committed rawdata again

#### Scenario: Cleanup succeeds after a failed terminal run

- **WHEN** derived reconciliation completes for a run whose terminal result and relocation checkpoint are already durable
- **THEN** recovery SHALL remove safely cleaned relocation residue without changing the historical checkpoint or terminal result and SHALL retain staging

#### Scenario: Unsupported relocation journal remains unfinished

- **WHEN** activation encounters an unfinished version 2 relocation journal rather than the current version 3 format
- **THEN** activation SHALL fail closed without mutating its recorded artifacts, deleting the journal, or automatically migrating it; import-run-record compatibility SHALL remain a separate contract

### Requirement: Transactional project transition

The system SHALL validate a candidate project and classify its recoverable source references before changing the active project. After candidate validation and import-relocation recovery, it SHALL reconcile any durable native import run record before frontend hydration or normal output access. If candidate validation or authoritative recovery fails, the current project and runtime state SHALL remain active.

Before replacing or closing an active project, the system SHALL prevent new project work, request cancellation of cancellable import/processing execution, wait for non-cancellable native finalization and registered persistence/acknowledgement work, stop listeners and watchers, and verify every owned resource outcome. A failed stop, unresolved finalization, unsafe recovery state, or unpersisted authoritative terminal result SHALL block transition rather than discard ownership or activate another project.

#### Scenario: Candidate project is invalid

- **WHEN** project A is active and the user tries to open malformed, unsupported, or unreadable project B
- **THEN** project A and its runtime state SHALL remain active and project B SHALL not hydrate

#### Scenario: Prior import is finalizing

- **WHEN** project A has native import finalization in progress and the user requests project B
- **THEN** the transition SHALL wait for finalization plus terminal reconciliation or fail without activating B

#### Scenario: Prior work cannot stop

- **WHEN** project A owns work that cannot be confirmed stopped, finalized, reconciled, or safely recoverable
- **THEN** project B SHALL not become active and the system SHALL show an actionable transition error

#### Scenario: Valid candidate replaces active project

- **WHEN** project B validates, its durable recovery completes, and all project-A work and terminal persistence settle successfully
- **THEN** the system SHALL reset all project-scoped state before fully hydrating and reconciling project B

### Requirement: Complete project-scoped reset and hydration

Each project lifecycle SHALL own the project, import, data-parameter, processing, manifest, and visualization runtime slices. Project replacement and close SHALL reset every persisted and transient field in those slices, including mappings, logs, phases, workers, progress, warnings, selections, loaded data, filters, and viewer state. Hydration SHALL replace each complete persisted slice over that slice's defaults; absent optional fields SHALL resolve to defaults rather than retaining values from the prior project. Global settings and execution profiles SHALL remain unchanged.

#### Scenario: Populated project is followed by sparse project

- **WHEN** populated project A is replaced by valid project B whose optional persisted slices are absent
- **THEN** project B SHALL receive defaults and SHALL inherit none of A's mappings, logs, phase, workers, progress, selection, manifest, data-parameter, or visualization state

#### Scenario: Project closes normally

- **WHEN** the user closes the active project after project-owned work stops
- **THEN** all project-scoped stores SHALL return to their initial state while global settings and execution profiles SHALL remain intact

#### Scenario: Project B has its own persisted state

- **WHEN** project B contains persisted import, processing, data-parameter, manifest, or visualization values
- **THEN** each runtime slice SHALL equal B's validated values merged with current defaults and SHALL contain no values from project A

### Requirement: Stale asynchronous work isolation

Every project lifecycle SHALL have an identity distinct from the persisted project ID and filesystem path. Delayed command results, event callbacks, post-processing, listener batches, and autosave timers SHALL verify that lifecycle identity before reading, writing, or mutating project-scoped state. Results owned by a closed or replaced lifecycle SHALL be discarded.

#### Scenario: Old scan finishes after project switch

- **WHEN** a filesystem scan started for project A resolves after project B becomes active
- **THEN** its result SHALL NOT mutate project B or trigger a save for either project

#### Scenario: Old import event arrives after project switch

- **WHEN** an import event or batched log callback from project A runs after A's lifecycle ends
- **THEN** it SHALL NOT update project B's progress, logs, phase, files, or persisted state

#### Scenario: Old autosave timer fires

- **WHEN** a debounced project-A autosave timer fires after project B becomes active
- **THEN** it SHALL NOT save project A data to B or write to A's previous location

### Requirement: Identity-aware recent projects

Recent-project state SHALL associate known project paths with project IDs while accepting existing path-only settings. Opening a known project from a new path SHALL replace its missing old path when identity proves it is the same moved project. If both old and new paths exist with the same project ID, the system SHALL ask whether the project was moved or copied. Choosing copied SHALL assign the opened copy a new project ID in memory, mark it dirty, and defer persistence to normal Save. Existing path-only entries that cannot be matched SHALL remain removable manually.

#### Scenario: Known project moved to new path

- **WHEN** a project opens from a new path, its known old path is missing, and both records identify the same project ID
- **THEN** Recent Projects SHALL replace the old path with the new path without rewriting `project.easl`

#### Scenario: Same identity exists at two paths

- **WHEN** both old and newly opened paths exist and contain the same project ID
- **THEN** the system SHALL ask whether the new location represents a move or a copy before completing the open

#### Scenario: User identifies a copied project

- **WHEN** the user chooses copied for a duplicate project identity
- **THEN** the opened copy SHALL receive a new runtime project ID, SHALL be dirty, and SHALL retain its source bytes until normal Save

#### Scenario: Legacy recent entry cannot be matched

- **WHEN** a path-only recent entry is missing and its project identity cannot be established
- **THEN** the system SHALL leave it as a stale manually removable entry and SHALL NOT guess which project replaced it

### Requirement: Durable import run recovery before hydration

Project activation SHALL inspect native import run metadata after import-relocation recovery and before frontend hydration, status reconstruction, output access, or new subprocess admission. Recovery SHALL validate version, project identity, relative paths, staging generation, relocation-plan binding, lifecycle transitions, and terminal evidence. It SHALL never trust a persisted PID, absolute path, caller-selected outcome, or unverified completion artifact.

A valid unfinished finalization SHALL complete idempotently before hydration. A former preparing/running run without current native supervisor ownership SHALL become interrupted and preserve staging. A terminal run SHALL remain replayable to the frontend. Malformed, foreign, escaping, symlinked, contradictory, or ambiguous evidence that prevents safe classification SHALL block activation without mutating project output; safely isolated cleanup residue MAY produce an actionable warning under existing recovery rules.

#### Scenario: Activation finds running record after restart

- **WHEN** a valid durable run says `Running` but no current native supervisor owns the process
- **THEN** activation SHALL classify it `Interrupted`, preserve staging, and expose that result during hydration

#### Scenario: Activation finds resumable finalization

- **WHEN** durable exit, completion, and relocation evidence identify a valid unfinished `Finalizing` run
- **THEN** activation SHALL resume idempotent finalization before project data becomes available

#### Scenario: Activation finds replayable terminal result

- **WHEN** a valid terminal run has not been acknowledged
- **THEN** hydration SHALL receive that authoritative result and project state SHALL reconcile before acknowledgement

#### Scenario: Recovery metadata is unsafe

- **WHEN** import run metadata contains an escaping path, foreign identity, invalid transition, or contradictory completion evidence
- **THEN** activation SHALL fail without following unsafe paths, deleting staging, changing project output, or hydrating frontend stores

#### Scenario: No durable import run exists

- **WHEN** a valid project has no native import run metadata
- **THEN** activation SHALL continue to normal hydration and committed-artifact status reconstruction

### Requirement: Single-instance project activation

The application SHALL establish single-instance ownership before other plugins initialize. Native project activation SHALL create one confined active-project capability before recovery and hydration, then reconcile processing and import records before publishing the project as active. Existing project-transition shutdown and stale-generation isolation SHALL remain enforced. A second matching application launch SHALL focus or restore the existing main window and exit before activation or mutation.

The product SHALL support one application process and one active project per user session. Concurrent access from another login, host, shared mount, differently identified build, or unsupported package sandbox SHALL remain outside the contract; no cross-process project file lease SHALL be claimed.

#### Scenario: Second application launch

- **WHEN** the user starts a matching application while one is already running in the same user session
- **THEN** the existing main window SHALL receive focus and the second process SHALL exit before project work

#### Scenario: Project switch waits for old runtime

- **WHEN** project B activation starts while project A owns import, processing, watcher, save, or asynchronous presentation work
- **THEN** project B SHALL NOT hydrate until project A's supported in-process resources settle or shutdown rejects

### Requirement: Interrupted execution before activation

Activation SHALL distinguish current in-process ownership from a durable nonterminal record left by a prior native process. Current ownership SHALL remain attachable across renderer reload. Prior-process work SHALL become Interrupted, preserve scientific and recovery artifacts, allow project viewing, and block import/processing admission until exact user confirmation that external MATLAB/Apptainer work has stopped. Activation SHALL NOT signal remembered process identities.

Settled moved projects SHALL bind stable project identity to the newly opened root without consulting the old path. Copied unresolved records SHALL follow the same confirmation-required interruption policy and SHALL NOT authorize automatic mutation from matching UUIDs alone. Unsupported durable versions or guardian-bound development records SHALL preserve their bytes and reject writable recovery with checkpoint-build or verified-copy guidance.

#### Scenario: Processing interruption discovered

- **WHEN** a candidate project has a nonterminal processing record but no current in-process supervisor
- **THEN** activation SHALL expose Interrupted confirmation state, preserve files, allow viewing, and block replacement execution

#### Scenario: Renderer reload retains active native run

- **WHEN** the renderer reloads while the native supervisor still owns the run
- **THEN** activation/attachment SHALL keep the active lifecycle and SHALL NOT require external-stop confirmation

#### Scenario: Project switched after terminal publication

- **WHEN** project transition begins with unacknowledged terminal state
- **THEN** transition SHALL coordinate metadata save/acknowledgement and resource settlement before clearing the old active-project capability

#### Scenario: Moved project contains acknowledged history

- **WHEN** a settled project opens from a new root with acknowledged processing request bindings
- **THEN** activation SHALL use the new root and stable project identity without treating old paths as authority

#### Scenario: Copied project contains unresolved run

- **WHEN** a copied project retains a nonterminal run with no current in-process owner
- **THEN** activation SHALL preserve it and require external-stop confirmation before recovery or execution

#### Scenario: Version-aware build cannot read active authority

- **WHEN** a candidate contains a durable format unsupported by the opening build
- **THEN** writable recovery/execution SHALL fail with compatible-build guidance without deleting the record
