# multi-reviewer-registry Specification

## Purpose

Defines the reviewer registry data model and management actions for multi-reviewer QC workflows. Reviewers are anonymous entries ("Reviewer 1", "Reviewer 2", …) stored in `ManifestUiStateSchema`. Adding a second reviewer implicitly activates multi-reviewer mode; removing all but one reverts to single-reviewer mode.

## Requirements

### Requirement: Reviewer Cap

The reviewer registry SHALL enforce a maximum of 5 reviewers. The `addReviewer` action SHALL be a no-op when 5 reviewers already exist. The UI's "Add Reviewer" button SHALL be disabled when the cap is reached.

#### Scenario: Add reviewer button disabled at cap

- **WHEN** the `reviewers` array contains 5 entries
- **THEN** the "Add Reviewer" button in the QC Selection UI SHALL be rendered in a disabled state with a tooltip indicating the maximum has been reached

#### Scenario: Removing a reviewer re-enables the add button

- **WHEN** the `reviewers` array has 5 entries and `removeReviewer` is called (reducing to 4)
- **THEN** the "Add Reviewer" button SHALL become enabled

### Requirement: Rename Reviewer Action

`projectStore` SHALL expose `renameReviewer(id: string, label: string)`. Native acceptance SHALL locate the registry entry by `id` and replace its label only when `label` is nonempty and at most 100 Unicode characters. A successful changed label SHALL mark the project dirty and schedule shared autosave. An unknown `id` SHALL leave accepted configuration and revisions unchanged and schedule no save; submission MAY temporarily mark the client dirty while pending. A submitted invalid label SHALL be rejected without changing the accepted registry or revisions, but the client SHALL expose `saveError` and remain dirty after rejection. Renaming SHALL preserve the reviewer's `id`, `createdAt`, verdict slice, and active selection.

#### Scenario: Valid label renames reviewer and marks project dirty

- **WHEN** `renameReviewer` is called with an existing reviewer ID and label `"Second QC reader"`
- **THEN** that entry's `label` SHALL become `"Second QC reader"`, its `id` and `createdAt` SHALL be unchanged, and the project SHALL be marked dirty

#### Scenario: Empty or oversized label is rejected

- **WHEN** `renameReviewer` is called with an existing reviewer ID and a label that is empty or longer than 100 characters
- **THEN** native acceptance SHALL reject the edit and preserve the accepted registry and revisions, while the client SHALL expose `saveError` and `isDirty: true`

#### Scenario: Unknown reviewer ID is a no-op

- **WHEN** `renameReviewer` is called with an ID absent from the registry
- **THEN** no reviewer or accepted revision SHALL change and no autosave SHALL be scheduled; once submission settles, an otherwise clean project SHALL return to clean state

### Requirement: Implicit Mode Switching

The manifest SHALL NOT expose an explicit "multi-reviewer mode" toggle. Mode switching SHALL be implicit:

- Adding a second reviewer (via `addReviewer`) activates multi-reviewer mode.
- Removing all but one reviewer (via `removeReviewer`) reverts to single-reviewer mode.

The UI SHALL adapt dynamically: reviewer tabs and per-reviewer completion badges SHALL appear only in multi-reviewer mode. The Verdict Resolution step SHALL appear only when multiple reviewers have a disagreement.

#### Scenario: Adding second reviewer shows tabs

- **WHEN** `addReviewer` is called on a single-reviewer project (transitioning to multi-reviewer mode)
- **THEN** the QC Selection UI SHALL render reviewer tabs, and the stepper SHALL include Verdict Resolution only if a disagreement exists

#### Scenario: Reverting to single-reviewer hides tabs

- **WHEN** `removeReviewer` is called and only one reviewer remains (reverting to single-reviewer mode)
- **THEN** the QC Selection UI SHALL NOT render reviewer tabs, and the stepper SHALL revert to 2 steps (QC Selection → Preview & Export)

### Requirement: Anonymous Reviewer Labels

Reviewers SHALL use anonymous labels by default: `"Reviewer 1"`, `"Reviewer 2"`, etc. The label numbering SHALL be based on the array index at creation time (length + 1). Labels are stored as-is and may be changed through `renameReviewer`; defaults support blinded review workflows where reviewer identity is not disclosed.

#### Scenario: Default labels assigned sequentially

- **WHEN** three reviewers are added sequentially from an empty state
- **THEN** the reviewer labels SHALL be `"Reviewer 1"`, `"Reviewer 2"`, `"Reviewer 3"` respectively

#### Scenario: Label numbering uses current count after removal

- **WHEN** "Reviewer 2" is removed from a 3-reviewer setup and a new reviewer is added
- **THEN** the new reviewer's label SHALL be `"Reviewer 3"` (based on current array length + 1, which is 3), not `"Reviewer 4"`

### Requirement: Current reviewer registry

Current project configuration SHALL contain one to five uniquely identified reviewers and a registered active ID. A reviewer SHALL have a UUID, nonempty label of at most 100 Unicode characters, and UTC creation timestamp. Creation SHALL initialize "Reviewer 1" with an empty verdict slice. A single reviewer SHALL retain the same registry and indexed verdict representation used by multiple reviewers. Older implicit-reviewer project formats SHALL not be accepted.

#### Scenario: New project has one reviewer

- **WHEN** a current project is created
- **THEN** Reviewer 1 SHALL exist and be active without showing multi-reviewer tabs

#### Scenario: Reviewer registry with valid entries parses

- **WHEN** current configuration contains valid unique reviewers and a registered active ID
- **THEN** it SHALL validate and preserve their order

#### Scenario: Reviewer with empty label is rejected

- **WHEN** a reviewer label is empty
- **THEN** validation SHALL reject the label without changing accepted state

#### Scenario: More than five reviewers are rejected

- **WHEN** current configuration supplies six reviewers
- **THEN** it SHALL be rejected

### Requirement: Add registered reviewer

Adding a reviewer SHALL append a new UUID, UTC timestamp, and label "Reviewer N", where N is current count plus one. Existing identities, order, active selection, and verdicts SHALL remain unchanged; no wrapping SHALL occur. The new reviewer SHALL start with no verdicts and the accepted edit SHALL autosave. At five reviewers, adding SHALL remain a no-op without an error.

#### Scenario: First additional reviewer

- **WHEN** a reviewer is added to a new one-reviewer project
- **THEN** Reviewer 2 SHALL append and Reviewer 1's existing slice SHALL remain unchanged

#### Scenario: Subsequent add appends correctly

- **WHEN** a third reviewer is added
- **THEN** the new label SHALL be Reviewer 3 and existing entries SHALL remain unchanged

#### Scenario: Existing one-reviewer verdicts keep their shape

- **WHEN** another reviewer is added after verdicts exist
- **THEN** those verdicts SHALL remain under their original reviewer ID without conversion

#### Scenario: Add respects reviewer cap

- **WHEN** five reviewers already exist
- **THEN** adding SHALL make no change and schedule no save

### Requirement: Remove registered reviewer

Removal SHALL delete the selected reviewer and only that reviewer's verdict slice, preserving remaining registry and indexed verdicts. Removing the active reviewer SHALL select the first remaining reviewer. The sole remaining reviewer SHALL not be removable. Reducing the count to one SHALL clear resolution entries but SHALL not clear reviewer identity, unwrap verdicts, or clear active selection. Valid removal SHALL autosave.

UI removal of a nonempty verdict slice SHALL retain its permanent-data-loss confirmation. The configuration action SHALL not request confirmation itself; the UI SHALL call it only after required consent. Cancellation SHALL make no change.

#### Scenario: Remove reviewer with no verdicts removes immediately

- **WHEN** more than one reviewer exists and the selected slice is empty
- **THEN** the reviewer SHALL be removable without confirmation

#### Scenario: Configuration removal with existing verdicts removes immediately

- **WHEN** a consented removal action reaches accepted configuration
- **THEN** that reviewer and slice SHALL be removed without a second prompt

#### Scenario: UI confirms removal of a nonempty verdict slice

- **WHEN** removal targets a nonempty slice
- **THEN** the UI SHALL warn about permanent verdict loss and cancellation SHALL preserve state

#### Scenario: Removing second-to-last reviewer preserves sole identity

- **WHEN** removal reduces two reviewers to one
- **THEN** the remaining registry, active ID, and indexed verdicts SHALL remain while resolutions clear

#### Scenario: Removing active reviewer reassigns selection

- **WHEN** the active reviewer is removed
- **THEN** the first remaining reviewer SHALL become active

### Requirement: Registered active reviewer

The active reviewer ID SHALL always refer to the registry, including single-reviewer projects. Creation SHALL select Reviewer 1. Adding reviewers SHALL preserve active selection. Switching tabs SHALL accept only a registered ID and autosave the selection. Removal SHALL select a surviving reviewer as defined by its removal contract.

#### Scenario: Second reviewer is added

- **WHEN** a second reviewer is created
- **THEN** the original reviewer's active ID SHALL remain selected

#### Scenario: Sole reviewer remains

- **WHEN** removal leaves one reviewer
- **THEN** that reviewer's ID SHALL remain active

#### Scenario: Switching active reviewer updates selection

- **WHEN** another registered tab is selected
- **THEN** accepted active ID SHALL change and use shared autosave
