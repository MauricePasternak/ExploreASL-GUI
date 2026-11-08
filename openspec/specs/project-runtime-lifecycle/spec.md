# project-runtime-lifecycle Specification

## Purpose

Define safe project transitions so each opened project owns a complete, isolated runtime session and no work or state can cross project boundaries.

## Requirements

### Requirement: Import relocation recovery before activation

Activation SHALL settle validated import-relocation custody and checkpoint matching run evidence before hydration, preserving committed rawdata and unrelated content while rejecting ambiguous recovery and retrying safe derived cleanup independently.

#### Scenario: A candidate project contains unfinished import relocation

- **WHEN** activation inspects relocation records before frontend access
- **THEN** path authority, old/new custody, checkpoints, cleanup, and blocked recovery SHALL follow these rules:

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

Project replacement and close SHALL validate candidates and settle pending edits, native work, recovery, and result persistence before publishing a clean candidate lifecycle, blocking transition rather than discarding ownership on failure.

#### Scenario: A project is opened, replaced, or closed

- **WHEN** a candidate or close request enters the serialized transition
- **THEN** validation, work admission, persistence, shutdown, recovery, and publication SHALL follow these rules:

Candidate configuration and recoverable source references SHALL validate before replacing the active project. Native import-relocation and durable execution recovery SHALL complete under their existing ownership and confirmation rules before exposing candidate data. Failed candidate validation SHALL leave the current project active. Before replacement or close, the system SHALL prevent new project work, submit pending form edits, persist the latest accepted configuration, cancel cancellable execution, wait for non-cancellable finalization and native result persistence, and stop listeners/watchers. Failure to save, stop, recover, or persist authoritative results SHALL block the transition rather than discard ownership. A successful transition SHALL reset transient state and expose only the candidate's accepted configuration and native execution evidence.

#### Scenario: Candidate project is invalid

- **WHEN** project A is active and project B is malformed, unsupported, or unreadable
- **THEN** A and its runtime state SHALL remain active and B SHALL not become visible

#### Scenario: Prior import is finalizing

- **WHEN** replacement is requested during project A's native finalization
- **THEN** replacement SHALL await finalization and native result persistence or fail without activating B

#### Scenario: Prior work cannot stop

- **WHEN** old project resources cannot settle safely
- **THEN** transition SHALL retain ownership and present an actionable error

#### Scenario: Valid candidate replaces active project

- **WHEN** candidate validation/recovery and project A's edit flush/shutdown all succeed
- **THEN** A's transient state SHALL reset before B's configuration and reconciled runtime state become available

#### Scenario: Latest edit cannot save before replacement

- **WHEN** pending project A edits fail validation or persistence during a switch
- **THEN** B SHALL not activate and A's edits/errors SHALL remain available

### Requirement: Complete project-scoped reset and hydration

Each project lifecycle SHALL expose one accepted configuration and reset all transient project state, retaining global settings and preserving sparse values without inheriting prior-project or scientific defaults.

#### Scenario: Project configuration replaces the current lifecycle

- **WHEN** opening, replacement, or close hydrates or resets stores
- **THEN** cache authority, optional values, transient cleanup, and global-state preservation SHALL follow these rules:

Each active lifecycle SHALL expose one accepted project configuration and separate transient import, parameter-form, processing, manifest, and visualization state. Opening SHALL replace the complete configuration display cache rather than independently hydrate editable persisted copies. Missing optional values SHALL use current UI defaults without inheriting values from the previous project or inserting scientific defaults into saved state. Replacement and close SHALL reset transient mappings/previews, logs, progress, listeners, loaded data, filters, warnings, form drafts, and viewer state. Global settings and execution profiles SHALL remain unchanged.

#### Scenario: Populated project is followed by sparse project

- **WHEN** populated A is replaced by valid sparse B
- **THEN** configuration selectors and transient state SHALL expose only B's values and current defaults

#### Scenario: Project closes normally

- **WHEN** configuration flushing and resource settlement succeed
- **THEN** all project-scoped cached/transient state SHALL reset while global settings and profiles remain intact

#### Scenario: Project B has its own persisted state

- **WHEN** B supplies valid import, parameter, processing, visualization, or review settings
- **THEN** displays SHALL use B's accepted configuration without values retained from A

### Requirement: Stale asynchronous work isolation

Every activation SHALL have an identity distinct from persisted project ID and filesystem path. Deferred command responses, display-cache updates, native configuration edits, event callbacks, and autosave work SHALL verify that activation identity before mutation. Old work SHALL be discarded after close/replacement, including reopening the same ID/root. The single project-wide save scheduler SHALL not write an expired activation's configuration.

#### Scenario: Old scan finishes after project switch

- **WHEN** A's scan resolves after B becomes active
- **THEN** it SHALL not modify B or schedule a configuration save

#### Scenario: Old import event arrives after project switch

- **WHEN** A's delayed event reaches the frontend after its activation ends
- **THEN** B's progress, files, and configuration SHALL remain unchanged

#### Scenario: Old autosave timer fires

- **WHEN** a save request belongs to an expired activation
- **THEN** it SHALL be rejected before saving to either a former or replacement root

### Requirement: Identity-aware recent projects

Recent Projects SHALL distinguish moved and copied identities with explicit consent, persist deliberate copied identity changes before activation, and preserve files and entries on cancellation.

#### Scenario: A known project identity appears at another path

- **WHEN** recent-project matching finds moved, copied, or stale path-only entries
- **THEN** path updates, consent, identity writes, and manual removal SHALL follow these rules:

Recent-project state SHALL continue associating paths with known project IDs and accepting existing path-only application settings. A moved project with matching identity and missing old path SHALL replace that recent path without rewriting its configuration. If both paths exist with the same ID, opening SHALL ask whether the selected project was moved or copied. Choosing copied SHALL assign a new ID only after consent, preserve prior copied-run interruption rules, and persist that deliberate identity change through the shared configuration writer before completing activation. Cancelling SHALL leave both files and recent entries unchanged. Unmatched stale path-only entries SHALL remain manually removable.

#### Scenario: Known project moved to new path

- **WHEN** matching identity opens at a new path and its old path is missing
- **THEN** Recent Projects SHALL replace the old path without a project-file rewrite

#### Scenario: Same identity exists at two paths

- **WHEN** both paths exist with the same ID
- **THEN** opening SHALL require moved/copied confirmation

#### Scenario: User identifies a copied project

- **WHEN** copied is confirmed and current native recovery permits activation
- **THEN** the copy SHALL receive and persist a new ID while the original remains unchanged

#### Scenario: Legacy recent entry cannot be matched

- **WHEN** a path-only setting cannot be matched by identity
- **THEN** it SHALL remain removable rather than being guessed to represent another project

### Requirement: Durable import run recovery before hydration

Activation SHALL recover validated import records after relocation recovery and before frontend access, preserving interrupted work and persisting eligible native terminal metadata before exact acknowledgement without inferred authority.

#### Scenario: Activation discovers durable import-run metadata

- **WHEN** native recovery evaluates import records before hydration
- **THEN** validation, finalization, interruption, persistence, and rejected authority SHALL follow these rules:

Activation SHALL inspect native import-run metadata after import-relocation recovery and before frontend data access or subprocess admission. Existing checks for record version, identity, relative paths, staging generation, plan binding, transitions, terminal evidence, and interrupted-worker confirmation SHALL remain. Safe finalization SHALL complete idempotently; unowned formerly running work SHALL remain interrupted with preserved staging. Eligible terminal results SHALL update and persist project configuration natively before exact-run acknowledgement. Unsafe or ambiguous evidence SHALL block activation without guessed mutation. Persisted PIDs, absolute record paths, frontend outcomes, and unverified completion artifacts SHALL not authorize recovery.

#### Scenario: Activation finds running record after restart

- **WHEN** a durable Running record has no current supervisor
- **THEN** activation SHALL expose Interrupted state, preserve staging, and require the existing external-stop confirmation

#### Scenario: Activation finds resumable finalization

- **WHEN** durable evidence and required confirmation permit safe finalization
- **THEN** native recovery SHALL finish it idempotently before normal project data access

#### Scenario: Activation finds replayable terminal result

- **WHEN** an eligible terminal result has not been reconciled
- **THEN** native configuration persistence SHALL complete before acknowledgement and the frontend SHALL receive the reconciled result

#### Scenario: Recovery metadata is unsafe

- **WHEN** evidence contains unsafe paths, foreign identity, invalid transitions, or contradictions
- **THEN** activation SHALL fail without following unsafe paths or hydrating the candidate

#### Scenario: No durable import run exists

- **WHEN** no native import record exists
- **THEN** normal configuration exposure and committed-artifact status reconstruction SHALL continue

### Requirement: Single-instance project activation

Single-instance native activation SHALL acquire confined capability and reconcile recovery before publication, then establish renderer state and lease before attachments, retaining accepted state but closing work admission if attachment fails.

#### Scenario: Native activation publishes a candidate to the renderer

- **WHEN** startup or project selection establishes a new active lifecycle
- **THEN** instance ownership, recovery order, renderer attachment, and support boundaries SHALL follow these rules:

The application SHALL establish single-instance ownership before other plugins initialize. Native project activation SHALL obtain a confined candidate-root capability before recovery, complete required native recovery and eligible processing/import result reconciliation, and only then publish the active root and accepted configuration. Existing project-transition shutdown and stale-generation isolation SHALL remain enforced. A second matching application launch SHALL focus or restore the existing main window and exit before activation or mutation.

After native activation returns, the renderer SHALL reset transient stores, accept the native snapshot, and activate its project work lease before inspecting source availability and synchronizing import then processing attachments. Attachment failure SHALL close renderer work admission and reject the transition without discarding the already accepted snapshot.

The product SHALL support one application process and one active project per user session. Concurrent access from another login, host, shared mount, differently identified build, or unsupported package sandbox SHALL remain outside the contract; no cross-process project file lease SHALL be claimed.

#### Scenario: Second application launch

- **WHEN** the user starts a matching application while one is already running in the same user session
- **THEN** the existing main window SHALL receive focus and the second process SHALL exit before project work

#### Scenario: Project switch waits for old runtime

- **WHEN** project B activation starts while project A owns import, processing, watcher, save, or asynchronous presentation work
- **THEN** project B SHALL NOT hydrate until project A's supported in-process resources settle or shutdown rejects

#### Scenario: Renderer attaches after native recovery and publication

- **WHEN** native recovery and eligible result reconciliation succeed and activation returns B's accepted snapshot
- **THEN** the renderer SHALL accept that snapshot and activate B's work lease before source inspection and import/processing attachment synchronization

#### Scenario: Renderer attachment fails after snapshot acceptance

- **WHEN** source inspection or import/processing attachment synchronization fails after B's native snapshot is accepted
- **THEN** the transition SHALL reject and renderer work admission SHALL close while B's accepted snapshot remains available

### Requirement: Interrupted execution before activation

Activation SHALL distinguish live in-process attachment from interrupted prior-process work, preserve artifacts, require exact external-stop confirmation, and reject unsupported writable recovery without remembered-PID signaling.

#### Scenario: An opened project contains live, moved, or copied execution records

- **WHEN** activation evaluates run ownership and durable format compatibility
- **THEN** attachment, interruption gates, root rebinding, and copied-record handling SHALL follow these rules:

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

### Requirement: Project-local configuration authority

Configuration and recovery authority SHALL remain project-local and selection-triggered, supporting one active desktop project per user session without concurrent worker configuration edits or new distributed-execution guarantees.

#### Scenario: A selected project stores configuration or requires setup recovery

- **WHEN** project-local persistence runs with or without writable application-data storage
- **THEN** storage placement, authority, and excluded deployment guarantees SHALL follow these rules:

Required configuration, backup, candidate, and setup recovery information SHALL remain in the selected project directory. Setup recovery SHALL run when that root is selected or activated, not depend on a writable user application-data directory. The product SHALL retain one desktop application process and one active project per user session. Execution workers SHALL not concurrently edit `project.easl`; execution results SHALL use existing separate project-local records. Writable project storage on SCRATCH SHALL remain the user's responsibility. This change SHALL NOT claim SLURM scheduling, cross-host file leases, or new process-containment guarantees.

#### Scenario: Project operations lack writable application data

- **WHEN** project storage is writable but application-data storage is unavailable for project setup records
- **THEN** current configuration creation, saving, and selected-root setup recovery SHALL not require that application-data write

#### Scenario: Execution result is recorded

- **WHEN** native execution publishes progress or results
- **THEN** the run record SHALL remain separate from the single-writer project configuration
