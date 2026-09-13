# native-execution-safety Specification

## Purpose

Protect local ExploreASL execution and project mutation with one native application authority, confined filesystem operations, and standard operating-system process scopes.

## Requirements

### Requirement: Confined durable authority

The system SHALL restrict recovery records and owned artifacts to validated project-relative paths, reject unsafe path components and unsupported entry types, and preserve unknown content. Durable record replacement SHALL flush candidate contents before atomic replacement and synchronize affected directories where supported. A post-replacement synchronization failure SHALL report uncertain durability without claiming the prior record remains authoritative. Domain-specific validation and recovery policy SHALL remain independent.

#### Scenario: Unsafe record path

- **WHEN** a journal references a parent traversal, symlink, reparse point, or foreign replacement
- **THEN** recovery SHALL reject before affecting that path and SHALL preserve recovery evidence

#### Scenario: Uncertain replacement durability

- **WHEN** record replacement becomes visible but supported directory synchronization fails
- **THEN** the operation SHALL report uncertain durability and SHALL NOT publish acknowledged durable success or blindly restore an earlier record

### Requirement: Single desktop application authority

The desktop application SHALL enforce one running ExploreASL GUI process per user session on Linux, macOS, and Windows. The single-instance mechanism SHALL initialize before other application plugins. A second launch SHALL notify and focus or restore the existing main window, then exit before project recovery, hydration, or mutation. Native state SHALL expose one active confined project capability and SHALL serialize project replacement with import, processing, setup, and save operations.

Concurrent project access from another login session, host, shared mount, differently identified build, or environment where single-instance coordination is unavailable SHALL be unsupported. The system SHALL NOT claim cross-user, cross-host, or distributed project locking.

#### Scenario: User starts the application twice

- **WHEN** a second matching application process starts in the same user session
- **THEN** the first process SHALL receive activation, its main window SHALL be focused or restored, and the second process SHALL exit without opening or mutating a project

#### Scenario: Project switch races old work

- **WHEN** project replacement starts while project-scoped native or renderer work remains active
- **THEN** in-process transition ownership SHALL drain or reject that work before another project becomes active

### Requirement: Standard local process scopes

Import, processing, and launch-related probes SHALL be supervised by the native application independently of renderer lifetime. Linux and macOS commands SHALL start as POSIX process-group leaders. Windows commands SHALL be assigned to Job Objects before execution. Live process identities and handles SHALL remain in native memory and SHALL NOT cross public IPC or become restart-time termination authority.

On user Stop, project close, project switch, or normal app exit, native supervision SHALL request platform-appropriate graceful termination for every active supported process scope, allow up to five seconds for scientific workers to settle, then force remaining members. It SHALL reap direct children and confirm the original process group or Job Object is empty before reporting normal settlement. Graceful signaling failure SHALL be reported and SHALL NOT skip bounded force termination. Processing stdout/stderr SHALL be discarded; import stdout/stderr SHALL be drained concurrently into its parser; probe capture SHALL remain ephemeral and bounded.

The supported Unix scope SHALL contain descendants that remain in the launched process group. Explicit `setsid`, new-process-group escape, daemonization, externally delegated work, remote execution, unsupported namespace/privilege changes, and hostile unbounded forking SHALL be outside the contract. These out-of-scope possibilities SHALL NOT disable Linux or macOS scientific execution or authorize stronger process-tree machinery.

#### Scenario: Stop ordinary Unix scientific tree

- **WHEN** MATLAB launches synchronous shell, FSL, BASIL, or Apptainer descendants that remain in its process group and the user requests Stop
- **THEN** native supervision SHALL signal the group, preserve the five-second graceful interval, force remaining group members, and report settlement only after the group is absent

#### Scenario: Renderer reloads during execution

- **WHEN** the renderer reloads while the native application and a process scope remain alive
- **THEN** native execution SHALL continue and the reloaded renderer SHALL attach to current snapshots without launching replacement workers

#### Scenario: Process deliberately leaves Unix scope

- **WHEN** a worker deliberately creates another session or process group
- **THEN** that process SHALL be treated as outside the guaranteed scope and SHALL NOT cause macOS or Linux execution to be disabled or silently strengthen containment requirements

#### Scenario: Windows worker starts descendants

- **WHEN** a Windows MATLAB or compiled worker starts ordinary child processes after assignment
- **THEN** the Job Object SHALL retain the supported process scope and force termination SHALL target that object

### Requirement: Honest abnormal-interruption recovery

The system SHALL NOT claim that abrupt native-process death terminates Unix workers. A durable nonterminal run found without matching in-process ownership SHALL become Interrupted while scientific outputs and recovery artifacts remain preserved. Project viewing MAY continue, but import and processing admission SHALL remain blocked until the user explicitly confirms through operating-system tools that external MATLAB/Apptainer work has stopped.

Confirmation SHALL identify the exact current project and run, SHALL NOT signal or adopt a persisted PID/PGID, and SHALL NOT represent kernel quiescence proof. After confirmation, pre-execution processing recovery MAY restore only proven GUI-owned artifacts; post-execution recovery SHALL preserve current ExploreASL/scientific state and remove only proven GUI-owned residue. The resulting terminal record SHALL remain replayable until project metadata is saved and exactly acknowledged.

#### Scenario: Native app crashes during processing

- **WHEN** project activation finds a nonterminal processing record without current in-process ownership
- **THEN** it SHALL report Interrupted, preserve current files, allow viewing, and block replacement execution with an external-stop confirmation action

#### Scenario: User confirms external work stopped

- **WHEN** the user confirms the exact interrupted run after checking operating-system process tools
- **THEN** native recovery SHALL apply the run's pre/post-execution artifact policy and expose terminal acknowledgement without signaling remembered process identities

#### Scenario: Renderer alone disappeared

- **WHEN** native in-process ownership still exists after renderer loss
- **THEN** the run SHALL NOT be relabeled Interrupted and SHALL remain attachable

### Requirement: Experimental guardian records fail clearly

The system SHALL reject unshipped records containing guardian attempts, quiescence bindings, or unsupported guardian-era processing versions. Rejection SHALL preserve all bytes and SHALL explain that the checkpoint build must settle and acknowledge the run, or that a verified clean project copy must be restored. No automatic migration, deletion, PID signaling, or compatibility execution path SHALL be added.

Released pre-guardian import records without guardian fields SHALL remain readable under their existing domain validation.

#### Scenario: Guardian-bound development record opens

- **WHEN** activation finds an unshipped current record containing guardian containment fields
- **THEN** writable recovery/execution SHALL reject with compatible-checkpoint guidance and SHALL NOT alter that record or scientific output

### Requirement: Portable settled execution identity

Persistent processing identity SHALL use the stable project identity independently of the current absolute root. Active canonical paths and opened-directory identity SHALL still validate live admission and confine effects. Settled execution history SHALL remain usable after a project move without reading the former root. A copied unresolved run SHALL never authorize automatic mutation; it SHALL require the same explicit interrupted-run confirmation as any other absent in-process owner.

#### Scenario: Settled project moves

- **WHEN** a settled project containing acknowledged processing request history opens at a new location
- **THEN** replay and new admission SHALL resolve under its new root without rejecting solely because the former absolute root differs

#### Scenario: Unresolved project is copied

- **WHEN** a copied project contains a nonterminal run with no current in-process owner
- **THEN** it SHALL preserve current files and require explicit interruption confirmation before recovery or replacement execution
