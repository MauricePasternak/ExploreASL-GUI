# bids-project-mutation-preflight Specification

## Purpose

Define read-only planning, explicit consent, and recoverable transactional application for files ExploreASL GUI adds to an existing BIDS source tree.

## Requirements

### Requirement: BIDS mutation preflight is read-only

Selecting and scanning a candidate BIDS root, building or displaying its mutation plan, changing the selected import mode, and cancelling or dismissing the flow SHALL NOT create, modify, rename, or remove any entry beneath that root. Preflight SHALL report read, validation, and permission errors without attempting setup or cleanup writes.

#### Scenario: Scan and review preserve source tree

- **WHEN** the GUI scans a candidate BIDS root and displays its mutation plan
- **THEN** a recursive snapshot of every source-tree entry, type, size, and content hash SHALL remain identical to the snapshot taken before selection

#### Scenario: Cancel preserves source tree

- **WHEN** a user cancels or dismisses any pre-confirmation BIDS setup screen
- **THEN** the source tree SHALL remain identical and no project SHALL be activated or added to Recent Projects

#### Scenario: Preflight failure preserves source tree

- **WHEN** inspection encounters an unreadable file, unsupported entry, invalid root, or mutation conflict
- **THEN** preflight SHALL return an actionable error and SHALL leave the source tree unchanged

### Requirement: Plan discloses exact durable mutations

The preflight result SHALL identify the canonical selected root, selected data source, an opaque plan identity, warnings, conflicts, and every durable project-relative operation as `create`, `update`, or `no-op`. For a BIDS-direct project, the operation list SHALL cover `project.easl`, `rawdata/`, `rawdata/.easl-gui-managed`, and `.bidsignore`; it SHALL state that `rawdata/README.md` is preserved. For DICOM import selected on a detected BIDS root, the list SHALL cover the applicable project and ignore-file operations and SHALL omit BIDS-direct-only compatibility artifacts. Any internal candidate, backup, or journal entries used during commit SHALL be identified separately as temporary transaction artifacts that are removed after commit or recovery.

The plan SHALL expose the exact resulting UTF-8 bytes for each GUI-owned text file that would be created or updated. It SHALL summarize `project.easl` by schema version, project name, generated project ID, data source, and content hash without requiring the UI to display the complete project payload.

#### Scenario: Fresh BIDS-direct root

- **WHEN** preflight runs for BIDS-direct creation on a root without project artifacts
- **THEN** the plan SHALL show creation of `project.easl`, `rawdata/`, `rawdata/.easl-gui-managed`, and `.bidsignore`, plus the exact marker and `.bidsignore` bytes

#### Scenario: Existing compatibility directory

- **WHEN** `rawdata/` already exists and contains user entries
- **THEN** the plan SHALL mark the directory as `no-op`, enumerate the marker and ignore-file changes separately, warn when `sub-*` directories will be ignored by BIDS-direct processing, and state that existing entries are preserved

#### Scenario: Existing project conflicts

- **WHEN** `project.easl` or an unrecognized `rawdata/.easl-gui-managed` entry already exists
- **THEN** the plan SHALL report a blocking conflict and confirmation SHALL remain unavailable

### Requirement: GUI-owned marker preserves user documentation

BIDS-direct setup SHALL use `rawdata/.easl-gui-managed` as its compatibility ownership marker. A newly created marker SHALL contain exactly `{"kind":"bids-direct-rawdata","version":1}\n`. Setup and later verification SHALL NOT create, modify, rename, or remove `rawdata/README.md` or any other non-owned entry. A marker with different bytes or a non-regular-file marker entry SHALL be a conflict rather than an overwrite target.

#### Scenario: User README is preserved

- **WHEN** `rawdata/README.md` exists before confirmed setup
- **THEN** its bytes, metadata-independent content hash, and path SHALL remain unchanged after commit

#### Scenario: Valid marker already exists

- **WHEN** the expected regular marker already contains the exact version-1 bytes
- **THEN** preflight SHALL classify the marker operation as `no-op`

#### Scenario: Foreign marker is rejected

- **WHEN** the marker path contains different bytes, is a directory, or is a symbolic link
- **THEN** preflight SHALL report a blocking ownership conflict without changing it

### Requirement: BIDS ignore output is deterministic

The required ignore entries SHALL be `project.easl`, `.easl_staging`, and `rawdata/`, in that canonical append order. Entry matching SHALL compare trimmed logical lines. If `.bidsignore` is absent, the planned bytes SHALL be exactly `project.easl\n.easl_staging\nrawdata/\n`. If all entries exist, the file SHALL be a byte-preserving `no-op` even when spacing, ordering, duplicates, final-newline state, or CRLF differs.

When entries are missing, existing bytes SHALL be preserved exactly. The append newline SHALL use the first existing line-ending style (`\r\n` or `\n`), defaulting to `\n` when none exists. If nonempty existing content lacks a complete final line ending, one append newline SHALL first terminate it; each missing entry SHALL then be appended once in canonical order and terminated by that newline. A trailing `\r` SHALL be completed with `\n` rather than receiving an extra separator.

#### Scenario: Missing file has canonical bytes

- **WHEN** `.bidsignore` does not exist
- **THEN** preflight SHALL plan creation with exact bytes `project.easl\n.easl_staging\nrawdata/\n`

#### Scenario: LF file lacks final newline

- **WHEN** `.bidsignore` contains exact bytes `derivatives/` and lacks all required entries
- **THEN** planned bytes SHALL be `derivatives/\nproject.easl\n.easl_staging\nrawdata/\n`

#### Scenario: CRLF style is preserved

- **WHEN** `.bidsignore` contains exact bytes `derivatives/\r\nproject.easl\r\n`
- **THEN** planned bytes SHALL be `derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n`

#### Scenario: Existing required lines cause byte-preserving no-op

- **WHEN** every required entry exists as a trimmed logical line
- **THEN** the planned and committed bytes SHALL equal the original bytes exactly

### Requirement: Confirmation commits only the reviewed plan

Mutation SHALL require an explicit confirmation carrying the current opaque plan identity. Immediately before mutation, the system SHALL revalidate the canonical root and every planned path against the preflight observations. A missing, expired, mismatched, or stale plan SHALL be rejected before any write and SHALL require a new preflight and review. Repeated confirmation of a committed plan SHALL return its committed outcome without applying the mutations twice.

#### Scenario: Source changes after review

- **WHEN** any planned input or destination changes after preflight and before confirmation
- **THEN** commit SHALL reject the stale plan before mutation and request a refreshed plan

#### Scenario: Confirmation identity does not match

- **WHEN** confirmation names a different root, data source, project payload, or plan identity
- **THEN** commit SHALL reject it without filesystem or application-state mutation

#### Scenario: Duplicate confirmation

- **WHEN** the same confirmed plan is submitted twice after its first commit succeeds
- **THEN** the second submission SHALL return the original committed result and SHALL create no duplicate lines or transaction artifacts

### Requirement: Confirmed mutations are recoverable as one transaction

Commit SHALL treat `project.easl`, `rawdata/`, `rawdata/.easl-gui-managed`, and `.bidsignore` changes applicable to the reviewed plan as one transaction. Before replacing an existing file or exposing a created entry, it SHALL durably record enough ownership and before-state information to restore all pre-transaction entries. New file content SHALL be validated and made durable before installation; existing files SHALL be replaced atomically from same-directory candidates. Success SHALL be reported only after all planned entries and the parent directory are durable where supported.

Any ordinary commit failure SHALL roll back every applied operation, restore existing file bytes, remove only transaction-owned entries created by that attempt, and avoid project activation. If interruption prevents immediate rollback, startup recovery SHALL use a global pending-transaction registry plus the root-local journal to deterministically finish the complete commit or restore the complete before-state before that root can be planned, created, or opened. Recovery SHALL never infer ownership from filenames alone.

#### Scenario: Failure during each mutation stage

- **WHEN** failure is injected while creating candidates, flushing content, recording the journal, creating `rawdata/`, installing the marker, replacing `.bidsignore`, installing `project.easl`, or flushing the root
- **THEN** the operation SHALL fail visibly and recovery SHALL leave either the complete before-state or the complete confirmed after-state, never a mixed durable state

#### Scenario: Rollback preserves prior bytes

- **WHEN** `.bidsignore` and `rawdata/` existed before a failed transaction
- **THEN** `.bidsignore` SHALL regain its exact original bytes, all pre-existing `rawdata/` entries SHALL remain unchanged, and transaction-owned additions SHALL be absent

#### Scenario: Interrupted transaction is recovered

- **WHEN** the application restarts with a registered incomplete BIDS project transaction
- **THEN** native recovery SHALL validate journal ownership, reconcile the selected root deterministically, remove owned temporary artifacts, and return a structured recovery outcome before project use

#### Scenario: Recovery ownership is ambiguous

- **WHEN** journal identity, registered root, or an owned candidate/backup cannot be validated
- **THEN** automatic mutation SHALL stop with an actionable blocking error and SHALL preserve all ambiguous entries for manual recovery

### Requirement: Commit outcome gates application state

Project activation, import-store hydration, navigation, Recent Projects updates, and success logging SHALL occur only after the native transaction returns a complete committed outcome for the current plan. Failure, rollback, stale-plan rejection, or unresolved recovery SHALL leave no new active project or recent-project record.

#### Scenario: Commit succeeds

- **WHEN** all confirmed mutations commit and durability requirements complete
- **THEN** the GUI SHALL activate the returned project, add its canonical `project.easl` path to Recent Projects, and navigate to the appropriate import flow

#### Scenario: Commit fails

- **WHEN** native commit returns failure, rollback, or unresolved recovery
- **THEN** the GUI SHALL show an actionable error and SHALL not activate, hydrate, navigate into, or register the candidate project
