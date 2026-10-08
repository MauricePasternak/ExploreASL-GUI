# bids-project-mutation-preflight Specification

## Purpose

Define read-only planning, explicit consent, and recoverable transactional application for files ExploreASL GUI adds to an existing BIDS source tree.

## Requirements

### Requirement: BIDS mutation preflight is read-only

Scanning a candidate root, building/displaying a new mutation plan, changing import mode, and cancelling that plan SHALL not create, modify, rename, or remove source-tree entries. A previously confirmed unfinished setup transaction SHALL be diagnosed separately on root selection and recovered under its validated journal before new preflight begins. That recovery SHALL be disclosed and SHALL not authorize new setup mutations. A clean selected root SHALL remain byte-preserving throughout selection and preflight. Inspection errors SHALL report actionable failure without setup/cleanup writes.

#### Scenario: Scan and review preserve source tree

- **WHEN** a clean candidate root is selected, scanned, and reviewed
- **THEN** its entry types, sizes, and content hashes SHALL remain unchanged

#### Scenario: Cancel preserves source tree

- **WHEN** new plan review is cancelled
- **THEN** no plan mutation, activation, or recent-project registration SHALL occur

#### Scenario: Preflight failure preserves source tree

- **WHEN** preflight encounters unreadable input, unsupported entries, or conflicts
- **THEN** it SHALL fail without changing source entries

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

Commit SHALL treat applicable project, compatibility marker/directory, and ignore-file changes as one reviewed transaction. Before exposing entries or replacing files, a durable root-local journal SHALL record transaction identity, owned paths, expected content, and before-state sufficient for safe rollback. New content SHALL validate and flush before installation; replacement SHALL use same-directory atomic candidates. Success SHALL require all planned entries and supported directory flushing to complete.

Ordinary failure SHALL restore prior bytes and remove only transaction-owned additions without activation. Interrupted transactions SHALL reconcile from validated root-local journals when the root is next selected, before a new setup plan, creation, or activation. Recovery SHALL finish a provable complete after-state or restore the complete before-state; ambiguous ownership SHALL block mutation. Application startup SHALL NOT scan unrelated project roots or require a global application-data pending registry. Filenames alone SHALL identify possible journals, never authorize ownership or cleanup. Selection-triggered recovery SHALL be a disclosed operation before read-only preflight; an unresolved transaction SHALL prevent preflight from claiming a clean root.

#### Scenario: Failure during each mutation stage

- **WHEN** candidate creation, flushing, journal writing, directory/marker creation, ignore replacement, project installation, or root flushing fails
- **THEN** the operation SHALL fail visibly and recovery SHALL retain a complete before-state or complete reviewed after-state

#### Scenario: Rollback preserves prior bytes

- **WHEN** a failed transaction follows existing ignore-file and rawdata entries
- **THEN** original bytes and user entries SHALL remain and transaction-owned additions SHALL disappear

#### Scenario: Interrupted transaction is recovered

- **WHEN** a selected root contains a valid unfinished setup journal
- **THEN** recovery SHALL validate ownership and reconcile it before planning or activation, without user-directory writes

#### Scenario: Recovery ownership is ambiguous

- **WHEN** journal identity, root binding, candidate, or backup evidence cannot establish ownership
- **THEN** recovery SHALL preserve ambiguous entries and report an actionable blocking error

#### Scenario: Clean root preflight remains read-only

- **WHEN** selection finds no unfinished setup transaction
- **THEN** scanning, plan review, mode changes, and cancellation SHALL retain the existing no-mutation preflight guarantee

### Requirement: Commit outcome gates application state

Project activation, import-store hydration, navigation, Recent Projects updates, and success logging SHALL occur only after the native transaction returns a complete committed outcome for the current plan. Failure, rollback, stale-plan rejection, or unresolved recovery SHALL leave no new active project or recent-project record.

#### Scenario: Commit succeeds

- **WHEN** all confirmed mutations commit and durability requirements complete
- **THEN** the GUI SHALL activate the returned project, add its canonical `project.easl` path to Recent Projects, and navigate to the appropriate import flow

#### Scenario: Commit fails

- **WHEN** native commit returns failure, rollback, or unresolved recovery
- **THEN** the GUI SHALL show an actionable error and SHALL not activate, hydrate, navigate into, or register the candidate project
