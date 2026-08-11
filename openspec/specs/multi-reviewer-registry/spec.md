# multi-reviewer-registry Specification

## Purpose

Defines the reviewer registry data model and management actions for multi-reviewer QC workflows. Reviewers are anonymous entries ("Reviewer 1", "Reviewer 2", …) stored in `ManifestUiStateSchema`. Adding a second reviewer implicitly activates multi-reviewer mode; removing all but one reverts to single-reviewer mode.

## Requirements

### Requirement: Reviewer Registry Schema

`ManifestUiStateSchema` in `src/schemas/project.ts` SHALL include an optional `reviewers` field with Zod shape:

```typescript
reviewers: z.array(z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
})).max(5).optional()
```

When `reviewers` is `undefined` or contains at most one entry, the manifest operates in single-reviewer mode. When `reviewers` contains 2–5 entries, the manifest operates in multi-reviewer mode. More than five entries SHALL be rejected at schema validation. The field SHALL default to `undefined` for new projects and for pre-existing `.easl` files that lack it.

#### Scenario: New project has no reviewer registry

- **WHEN** a new project is created and `ManifestUiStateSchema` is initialized
- **THEN** the `reviewers` field SHALL be `undefined`, and the manifest SHALL operate in single-reviewer mode

#### Scenario: Pre-existing project without reviewers parses successfully

- **WHEN** a `.easl` file created before the multi-reviewer feature (no `reviewers` key in `uiState.manifest`) is loaded
- **THEN** `ProjectFileSchema.parse` SHALL succeed, `project.uiState.manifest.reviewers` SHALL be `undefined`, and the manifest SHALL operate in single-reviewer mode

#### Scenario: Reviewer registry with valid entries parses

- **WHEN** a `.easl` file contains `uiState.manifest.reviewers` with two entries each having a valid UUID `id`, non-empty `label`, and ISO 8601 `createdAt`
- **THEN** `ProjectFileSchema.parse` SHALL succeed and the parsed `reviewers` array SHALL contain exactly those two entries

#### Scenario: Reviewer with empty label is rejected

- **WHEN** a `.easl` file contains a reviewer entry with `label: ""`
- **THEN** `ProjectFileSchema.parse` SHALL throw a Zod validation error citing the `label` field's `min(1)` constraint

#### Scenario: More than five reviewers are rejected

- **WHEN** a `.easl` file contains six otherwise-valid reviewer entries
- **THEN** `ProjectFileSchema.parse` SHALL throw a Zod validation error citing the reviewers array's `max(5)` constraint

### Requirement: Add Reviewer Action

`projectStore` SHALL expose an `addReviewer` action. When invoked, the action SHALL:

1. Generate a new UUID v4 for the reviewer's `id`.
2. Set the reviewer's `label` to `"Reviewer N"` where N equals the current `reviewers` array length plus 1 (or `1` if the array is `undefined`).
3. Set `createdAt` to the current ISO 8601 datetime string.
4. Append the new reviewer entry to the `reviewers` array (creating the array if `undefined`).
5. Mark the project as dirty for subsequent save.

If the `reviewers` array is `undefined` when `addReviewer` is first called, the action SHALL create the array with an initial "Reviewer 1" entry representing the existing single reviewer, THEN append the new "Reviewer 2" entry. If the array has exactly one entry, the action SHALL append the second reviewer to that existing registry. On either transition from single to multi-reviewer mode, the action SHALL wrap the existing flat verdict map under the first reviewer's ID, preserving every verdict entry. This ensures the transition preserves the original reviewer's identity and verdicts.

#### Scenario: First addReviewer call on a single-reviewer project

- **WHEN** `addReviewer` is called on a project where `reviewers` is `undefined`
- **THEN** the `reviewers` array SHALL contain exactly two entries: the first with `label: "Reviewer 1"` and the second with `label: "Reviewer 2"`, both with valid UUID `id` values and ISO 8601 `createdAt` strings, and the project SHALL be marked dirty

#### Scenario: Subsequent addReviewer call appends correctly

- **WHEN** `addReviewer` is called on a project where `reviewers` already has entries `["Reviewer 1", "Reviewer 2"]`
- **THEN** a third entry with `label: "Reviewer 3"` SHALL be appended, the array length SHALL be 3, and the existing entries SHALL be unchanged

#### Scenario: Adding to an explicit one-reviewer registry wraps verdicts

- **WHEN** `reviewers` contains one reviewer with ID `"11111111-1111-4111-8111-111111111111"`, flat verdicts contain `{ "sub-01_01": { status: "pass", setAt: 1700000000000 } }`, and `addReviewer` is called
- **THEN** the registry SHALL contain two reviewers and verdicts SHALL become `{ "11111111-1111-4111-8111-111111111111": { "sub-01_01": { status: "pass", setAt: 1700000000000 } } }`

#### Scenario: addReviewer respects 5-reviewer cap

- **WHEN** `addReviewer` is called on a project where `reviewers` already contains 5 entries
- **THEN** the action SHALL be a no-op: no entry SHALL be appended, the `reviewers` array length SHALL remain 5, and no error SHALL be thrown

### Requirement: Remove Reviewer Action

`projectStore` SHALL expose a `removeReviewer(id: string)` action. When invoked, the action SHALL:

1. Locate the reviewer entry with the matching `id` in the `reviewers` array.
2. Remove the reviewer entry from the `reviewers` array.
3. Delete the reviewer's verdict slice from the `verdicts` record (`delete verdicts[id]`).
4. If the removal leaves exactly one reviewer remaining, revert to single-reviewer mode: set `reviewers` to `undefined` and restructure `verdicts` from `Record<reviewerId, Record<subjectSession, Verdict>>` back to the single remaining reviewer's `Record<subjectSession, Verdict>`.
5. If the removed reviewer was the `activeReviewerId`, set `activeReviewerId` to the first remaining reviewer's `id`.
6. Mark the project as dirty.

`removeReviewer` SHALL be a pure store action: it SHALL neither request nor await UI confirmation and SHALL remove immediately when called. `ReviewerTabs` SHALL own confirmation: before calling the action, it SHALL inspect the target `verdicts[id]` slice; if that slice is nonempty, it SHALL request confirmation with a permanent-data-loss warning, call `removeReviewer(id)` only after confirmation, and leave state unchanged after cancellation. For an absent or empty slice, `ReviewerTabs` SHALL call `removeReviewer(id)` directly.

#### Scenario: Remove reviewer with no verdicts removes immediately

- **WHEN** `removeReviewer("11111111-1111-4111-8111-111111111111")` is called and `verdicts["11111111-1111-4111-8111-111111111111"]` is `undefined` or `{}`
- **THEN** the reviewer entry and verdict slice SHALL be removed immediately, and the project SHALL be marked dirty

#### Scenario: Store removal with existing verdicts removes immediately

- **WHEN** `removeReviewer("11111111-1111-4111-8111-111111111111")` is called and `verdicts["11111111-1111-4111-8111-111111111111"]` contains one or more verdict entries
- **THEN** the reviewer and their verdict slice SHALL be removed immediately without a confirmation request

#### Scenario: ReviewerTabs confirms removal of a nonempty verdict slice

- **WHEN** a user requests removal in `ReviewerTabs` and `verdicts["11111111-1111-4111-8111-111111111111"]` contains one or more verdict entries
- **THEN** `ReviewerTabs` SHALL display a confirmation warning about permanent verdict loss; it SHALL call `removeReviewer` only after confirmation, and cancellation SHALL leave project state unchanged

#### Scenario: Removing second-to-last reviewer reverts to single-reviewer mode

- **WHEN** `removeReviewer` is called and the `reviewers` array has exactly 2 entries, reducing it to 1
- **THEN** the `reviewers` field SHALL be set to `undefined`, `verdicts` SHALL be restructured to `Record<subjectSession, Verdict>` containing only the remaining reviewer's verdicts, and `activeReviewerId` SHALL be set to `undefined`

#### Scenario: Removing active reviewer reassigns activeReviewerId

- **WHEN** `removeReviewer` is called with an `id` equal to the current `activeReviewerId` and more than one reviewer remains after removal
- **THEN** `activeReviewerId` SHALL be set to the `id` of the first entry in the remaining `reviewers` array

### Requirement: Reviewer Cap

The reviewer registry SHALL enforce a maximum of 5 reviewers. The `addReviewer` action SHALL be a no-op when 5 reviewers already exist. The UI's "Add Reviewer" button SHALL be disabled when the cap is reached.

#### Scenario: Add reviewer button disabled at cap

- **WHEN** the `reviewers` array contains 5 entries
- **THEN** the "Add Reviewer" button in the QC Selection UI SHALL be rendered in a disabled state with a tooltip indicating the maximum has been reached

#### Scenario: Removing a reviewer re-enables the add button

- **WHEN** the `reviewers` array has 5 entries and `removeReviewer` is called (reducing to 4)
- **THEN** the "Add Reviewer" button SHALL become enabled

### Requirement: Active Reviewer ID Tracking

`ManifestUiStateSchema` SHALL include an optional `activeReviewerId` field with Zod shape `z.string().uuid().optional()`. This field SHALL track which reviewer's tab is currently selected in the QC Selection UI. The field SHALL be `undefined` in single-reviewer mode.

#### Scenario: activeReviewerId set when entering multi-reviewer mode

- **WHEN** a second reviewer is added via `addReviewer` (transitioning from single to multi-reviewer mode)
- **THEN** `activeReviewerId` SHALL be set to the `id` of the first reviewer in the `reviewers` array

#### Scenario: activeReviewerId cleared when reverting to single-reviewer mode

- **WHEN** a reviewer is removed via `removeReviewer` and only one reviewer remains
- **THEN** `activeReviewerId` SHALL be set to `undefined`

#### Scenario: Switching active reviewer updates activeReviewerId

- **WHEN** the user clicks a different reviewer tab in the QC Selection UI
- **THEN** `activeReviewerId` SHALL be updated to the selected reviewer's `id` and the project SHALL be marked dirty

### Requirement: Rename Reviewer Action

`projectStore` SHALL expose `renameReviewer(id: string, label: string)`. The action SHALL locate the registry entry by `id`, replace its label only when `label` is nonempty and at most 100 characters, and mark the project dirty after a successful rename. An unknown `id` SHALL be a no-op and SHALL NOT mark the project dirty. Invalid labels SHALL be rejected without changing the registry or dirty state. Renaming SHALL preserve the reviewer's `id`, `createdAt`, verdict slice, and active selection.

#### Scenario: Valid label renames reviewer and marks project dirty

- **WHEN** `renameReviewer` is called with an existing reviewer ID and label `"Second QC reader"`
- **THEN** that entry's `label` SHALL become `"Second QC reader"`, its `id` and `createdAt` SHALL be unchanged, and the project SHALL be marked dirty

#### Scenario: Empty or oversized label is rejected

- **WHEN** `renameReviewer` is called with an existing reviewer ID and a label that is empty or longer than 100 characters
- **THEN** the registry and project dirty state SHALL remain unchanged

#### Scenario: Unknown reviewer ID is a no-op

- **WHEN** `renameReviewer` is called with an ID absent from the registry
- **THEN** no reviewer SHALL be changed and the project SHALL NOT be marked dirty

### Requirement: Implicit Mode Switching

The manifest SHALL NOT expose an explicit "multi-reviewer mode" toggle. Mode switching SHALL be implicit:

- Adding a second reviewer (via `addReviewer`) activates multi-reviewer mode.
- Removing all but one reviewer (via `removeReviewer`) reverts to single-reviewer mode.

The UI SHALL adapt dynamically: reviewer tabs, per-reviewer completion badges, and the conditional Verdict Resolution step SHALL appear only in multi-reviewer mode.

#### Scenario: Adding second reviewer shows tabs

- **WHEN** `addReviewer` is called on a single-reviewer project (transitioning to multi-reviewer mode)
- **THEN** the QC Selection UI SHALL render reviewer tabs, and the stepper SHALL support up to 3 steps (QC Selection → Verdict Resolution → Preview & Export)

#### Scenario: Reverting to single-reviewer hides tabs

- **WHEN** `removeReviewer` is called and only one reviewer remains (reverting to single-reviewer mode)
- **THEN** the QC Selection UI SHALL NOT render reviewer tabs, and the stepper SHALL revert to 2 steps (QC Selection → Preview & Export)

### Requirement: Anonymous Reviewer Labels

Reviewers SHALL use anonymous labels by default: `"Reviewer 1"`, `"Reviewer 2"`, etc. The label numbering SHALL be based on the array index at creation time (length + 1). Labels are stored as-is and may be changed through `renameReviewer`; defaults support blinded review workflows where reviewer identity is not disclosed.

#### Scenario: Default labels assigned sequentially

- **WHEN** three reviewers are added sequentially from an empty state
- **THEN** the reviewer labels SHALL be `"Reviewer 1"`, `"Reviewer 2"`, `"Reviewer 3"` respectively

#### Scenario: Label numbering does not reuse after removal

- **WHEN** "Reviewer 2" is removed from a 3-reviewer setup and a new reviewer is added
- **THEN** the new reviewer's label SHALL be `"Reviewer 3"` (based on current array length + 1, which is 3), not `"Reviewer 4"`
