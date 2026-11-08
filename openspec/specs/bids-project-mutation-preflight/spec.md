# bids-project-mutation-preflight Specification

## Purpose

Define read-only planning, explicit consent, and recoverable transactional application for files ExploreASL GUI adds to an existing BIDS source tree.

## Requirements

### Requirement: BIDS mutation preflight is read-only

Setup preflight SHALL remain read-only and require reviewed plans for detected BIDS roots, while separately disclosing prior-transaction recovery and preserving the ordinary non-BIDS DICOM creation exception.

#### Scenario: A selected root enters setup inspection and preflight

- **WHEN** a root is selected, inspected, or reviewed for project setup
- **THEN** plan admission, read-only inspection, and prior-recovery handling SHALL follow these rules:

The landing setup dialog SHALL require a mutation plan for either data source when detection reports `is_bids = true`, `total_subject_count > 0`, `has_dataset_description = true`, or non-null `dataset_desc_error`. Ordinary DICOM creation with none of these indicators SHALL use the normal single-project-file creation path after explicit dialog confirmation, without mutation preflight or a plan identity. Activation, Recent Projects registration, and navigation SHALL still wait for successful project creation. The plan and transaction requirements below apply whenever reviewed setup is used; BIDS-direct creation SHALL NOT use the direct-create exception.

Scanning a candidate root, building/displaying a new mutation plan, changing import mode, and cancelling that plan SHALL not create, modify, rename, or remove source-tree entries. A previously confirmed unfinished setup transaction SHALL be diagnosed separately on root selection and recovered under its validated journal before new preflight begins. That recovery SHALL be disclosed and SHALL not authorize new setup mutations. A clean selected root SHALL remain byte-preserving throughout selection and preflight. Inspection errors SHALL report actionable failure without setup/cleanup writes.

#### Scenario: Ordinary non-BIDS DICOM creation needs no setup plan

- **WHEN** none of the detection indicators requiring reviewed setup are present and the user confirms DICOM import
- **THEN** the GUI SHALL create the project without preflight or a setup-plan identity, and SHALL activate, register, and navigate only after successful creation

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

Setup plans SHALL disclose ordered durable operations, exact GUI-owned text bytes, project identity, and temporary artifacts, with accessible technical details and always-visible warnings and conflicts.

#### Scenario: A setup or repair plan is presented for confirmation

- **WHEN** a mutation plan is displayed or its technical disclosure is collapsed
- **THEN** plan contents, operation order, and visible safeguards SHALL satisfy this contract:

The preflight result SHALL identify the canonical selected root, selected data source, an opaque plan identity, warnings, conflicts, and every durable project-relative operation as `create`, `update`, or `no-op`. Operations SHALL be listed in execution order: `rawdata/`, `.bidsignore`, then `project.easl`, omitting paths not applicable to the selected mode. Existing entries marked `no-op` SHALL retain their position in that sequence. Both project creation and setup repair dialogs SHALL preserve this order. For a BIDS-direct project, the operation list SHALL cover these three paths; it SHALL state that `rawdata/README.md` is preserved. For DICOM import selected on a detected BIDS root, the list SHALL cover the applicable ignore-file and project operations and SHALL omit BIDS-direct-only compatibility artifacts. Any internal candidate, backup, or journal entries used during commit SHALL be identified separately as temporary transaction artifacts that are removed after commit or recovery.

The plan SHALL expose the exact resulting UTF-8 bytes for each GUI-owned text file that would be created or updated. It SHALL summarize `project.easl` by schema version, project name, generated project ID, data source, and content hash without requiring the UI to display the complete project payload.

The landing dialog SHALL present a plain-language setup overview by default. Exact operations, UTF-8 previews, canonical root, project summary, README preservation, and temporary-artifact information SHALL remain available in an initially collapsed, keyboard-accessible technical disclosure. Warnings, conflicts, and inspection failures SHALL remain visible outside that disclosure. Collapsing details SHALL NOT remove plan contents or weaken current-plan confirmation checks.

#### Scenario: Fresh BIDS-direct root

- **WHEN** preflight runs for BIDS-direct creation on a root without project artifacts
- **THEN** the plan SHALL show creation of `rawdata/`, `.bidsignore`, and `project.easl` in that execution order, plus the exact `.bidsignore` bytes

#### Scenario: Existing compatibility directory

- **WHEN** `rawdata/` already exists and contains user entries
- **THEN** the plan SHALL mark the directory as `no-op`, enumerate the ignore-file changes separately, warn when `sub-*` directories will be ignored by BIDS-direct processing, and state that existing entries are preserved

#### Scenario: Existing project conflicts

- **WHEN** `project.easl` already exists
- **THEN** the plan SHALL report a blocking conflict and confirmation SHALL remain unavailable

### Requirement: Compatibility setup preserves existing entries

BIDS-direct setup and later verification SHALL NOT create, modify, rename, or remove `rawdata/README.md` or any other pre-existing entry within `rawdata/`.

#### Scenario: User README is preserved

- **WHEN** `rawdata/README.md` exists before confirmed setup
- **THEN** its bytes, metadata-independent content hash, and path SHALL remain unchanged after commit

### Requirement: BIDS ignore output is deterministic

Ignore-file planning SHALL preserve existing bytes and append only missing required entries in canonical order, respecting existing line endings and retaining byte-identical no-ops.

#### Scenario: Setup plans required ignore entries

- **WHEN** `.bidsignore` is absent, complete, or missing required entries
- **THEN** planned bytes and no-op classification SHALL follow these rules:

For BIDS-direct and repair, the required ignore entries SHALL be `project.easl`, `.easl_staging`, and `rawdata/`, in that canonical append order. Reviewed DICOM setup requires only the first two. Entry matching SHALL compare trimmed logical lines. If `.bidsignore` is absent for BIDS-direct or repair, the planned bytes SHALL be exactly `project.easl\n.easl_staging\nrawdata/\n`. If all required entries exist, the file SHALL be a byte-preserving `no-op` even when spacing, ordering, duplicates, final-newline state, or CRLF differs.

When entries are missing, existing bytes SHALL be preserved exactly. The append newline SHALL be `\r\n` if any CRLF occurs in existing content, otherwise `\n`. If nonempty existing content lacks a complete final line ending, one append newline SHALL first terminate it; each missing entry SHALL then be appended once in canonical order and terminated by that newline. A trailing `\r` SHALL be completed with `\n` rather than receiving an extra separator.

#### Scenario: Missing file has canonical bytes

- **WHEN** `.bidsignore` does not exist for BIDS-direct setup or repair
- **THEN** preflight SHALL plan creation with exact bytes `project.easl\n.easl_staging\nrawdata/\n`

#### Scenario: Missing file for reviewed DICOM setup

- **WHEN** `.bidsignore` does not exist for reviewed DICOM setup
- **THEN** preflight SHALL plan creation with exact bytes `project.easl\n.easl_staging\n`

#### Scenario: LF file lacks final newline

- **WHEN** BIDS-direct setup or repair finds `.bidsignore` containing exact bytes `derivatives/` and lacking all required entries
- **THEN** planned bytes SHALL be `derivatives/\nproject.easl\n.easl_staging\nrawdata/\n`

#### Scenario: CRLF style is preserved

- **WHEN** BIDS-direct setup or repair finds `.bidsignore` containing exact bytes `derivatives/\r\nproject.easl\r\n`
- **THEN** planned bytes SHALL be `derivatives/\r\nproject.easl\r\n.easl_staging\r\nrawdata/\r\n`

#### Scenario: Existing required lines cause byte-preserving no-op

- **WHEN** every required entry exists as a trimmed logical line
- **THEN** the planned and committed bytes SHALL equal the original bytes exactly

### Requirement: Confirmation commits only the reviewed plan

Applying a setup plan SHALL require an explicit confirmation carrying the current opaque plan identity. Immediately before mutation, the system SHALL revalidate the canonical root and every planned path against the preflight observations. A missing, expired, mismatched, or stale plan SHALL be rejected before any write and SHALL require a new preflight and review. Repeated confirmation of a committed plan SHALL return its committed outcome without applying the mutations twice.

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

Confirmed setup SHALL commit as one durable, recoverable root-local transaction, restoring prior state on ordinary failure and blocking ambiguous interrupted recovery without scanning unrelated roots.

#### Scenario: Reviewed setup commits or requires recovery

- **WHEN** setup changes are committed, fail, or are found interrupted on root selection
- **THEN** journaling, installation, rollback, and recovery SHALL satisfy these guarantees:

Commit SHALL treat applicable project, compatibility directory, and ignore-file changes as one reviewed transaction. Before exposing entries or replacing files, a durable root-local journal SHALL record transaction identity, owned paths, expected content, and before-state sufficient for safe rollback. New content SHALL validate and flush before installation; replacement SHALL use same-directory atomic candidates. Success SHALL require all planned entries and supported directory flushing to complete.

Ordinary failure SHALL restore prior bytes and remove only transaction-owned additions without activation. Interrupted transactions SHALL reconcile from validated root-local journals when the root is next selected, before a new setup plan, creation, or activation. Recovery SHALL finish a provable complete after-state or restore the complete before-state; ambiguous ownership SHALL block mutation. Application startup SHALL NOT scan unrelated project roots or require a global application-data pending registry. Filenames alone SHALL identify possible journals, never authorize ownership or cleanup. Selection-triggered recovery SHALL be a disclosed operation before read-only preflight; an unresolved transaction SHALL prevent preflight from claiming a clean root.

#### Scenario: Failure during each mutation stage

- **WHEN** candidate creation, flushing, journal writing, directory creation, ignore replacement, project installation, or root flushing fails
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

For reviewed setup, project activation, import-store hydration, navigation, Recent Projects updates, and success logging SHALL occur only after the native transaction returns a complete committed outcome for the current plan. Failure, rollback, stale-plan rejection, or unresolved recovery SHALL leave no new active project or recent-project record.

#### Scenario: Commit succeeds

- **WHEN** all confirmed mutations commit and durability requirements complete
- **THEN** the GUI SHALL activate the returned project, add its canonical `project.easl` path to Recent Projects, and navigate to the appropriate import flow

#### Scenario: Commit fails

- **WHEN** native commit returns failure, rollback, or unresolved recovery
- **THEN** the GUI SHALL show an actionable error and SHALL not activate, hydrate, navigate into, or register the candidate project
