## Context

See `proposal.md` for motivation. OpenSpec 1.11 resolves this repository correctly and reports healthy relationships, but strict content validation fails on legacy document structures. The repository also ignores all change artifacts, and its custom workflow references skills unavailable to current agents.

The migration must preserve product requirements. OpenSpec 1.11 explicitly requires direct edits to canonical specs for missing or placeholder `Purpose` sections, so this tooling change uses `skip_specs: true` rather than creating artificial behavioral deltas.

## Goals / Non-Goals

**Goals:**

- Make planning artifacts reviewable and reproducible through Git.
- Use a workflow executable by currently available agents.
- Reach a strict-validation baseline without changing normative behavior.
- Preserve honest status for incomplete legacy work.

**Non-Goals:**

- Change application behavior, schemas, or public claims.
- Rewrite Git history without evidence of exposed secrets.
- Complete platform updater smoke tests during a documentation migration.
- Add OpenSpec validation to CI before the baseline itself is clean.

## Decisions

### Track change artifacts

Remove the blanket `openspec/changes/` ignore rule. Proposals, designs, tasks, deltas, and archived cycles are part of the engineering record and must be visible to cloned agents and reviewers.

Alternative considered: keep active changes local and commit only canonical specs. Rejected because dependent agents cannot inspect unarchived decisions, reviews lose task evidence, and the custom workflow expects archived cycles in PR diffs.

Alternative considered: track only archived changes. Rejected because active proposal and design review is part of the OpenSpec approach.

### Use stock `spec-driven` temporarily

Set `openspec/config.yaml` to stock `spec-driven` and remove the incompatible project-local schema from the current tree. Stock workflow has the same proposal/specs/design/tasks artifact sequence without requiring unavailable `superpowers:*` skills.

Alternative considered: retain the custom schema and ignore its skill prechecks. Rejected because generated instructions would remain false and agents would behave inconsistently.

Alternative considered: immediately create another custom reviewed schema. Rejected for this migration because stock workflow is sufficient; a custom executor policy should be introduced as a separate reviewed tooling change after baseline validation.

### Repair structure without semantic rewriting

Canonical fixes are limited to required titles, meaningful `Purpose` text, and missing scenarios that restate already normative requirement text. Existing requirement wording remains unchanged unless syntax must be adjusted for the parser.

Alternative considered: rewrite all long requirements and warnings. Rejected because broad editorial restructuring risks semantic drift and is unnecessary to clear errors. Strict warnings for placeholder purposes must be fixed; informational length notices need not be eliminated.

### Preserve Git history

Do not rewrite repository history. Audit found no credentials, private keys, participant data, or personal machine paths in the project schema. Example paths such as `/home/user/...` are test documentation, not leaked local data.

Alternative considered: purge the custom schema from all refs. Rejected because history rewriting creates operational risk without a confidentiality benefit.

### Reconcile auto-update separately

Keep the existing `auto-update` change visible after removing the ignore rule. Do not mark its platform smoke task complete or archive it during this baseline migration. Its canonical spec and legacy change require a dedicated reconciliation decision.

## Risks / Trade-offs

- Canonical formatting edits could accidentally alter behavior -> Compare requirement bodies before and after; limit edits to structure and missing scenario restatements; run strict validation.
- Tracking changes exposes unfinished design discussion -> Treat design history as normal repository documentation; secrets remain prohibited in planning artifacts.
- Stock workflow loses custom agent automation -> Use repository `AGENTS.md` and explicit implementer/reviewer prompts until a compatible workflow is designed.
- Existing invalid `auto-update` change prevents all-change strict validation -> Validate canonical specs separately for this migration, document the remaining change failure, then reconcile it immediately afterward.
- Removing the custom schema changes `/opsx:new` behavior -> Set config explicitly and verify generated change status reports `spec-driven`.

## Migration Plan

1. Track `openspec/changes/` and this migration change.
2. Switch default schema to stock `spec-driven`; remove obsolete local schema files from current tree.
3. Capture strict-validation baseline.
4. Repair canonical spec structure without changing requirements.
5. Validate all canonical specs strictly and run relationship doctor.
6. Validate this `skip_specs` migration change.
7. Leave legacy `auto-update` visible and explicitly identified as next reconciliation work.

Rollback: restore config and local schema files from Git, and restore the ignore rule. Canonical structure additions are harmless under older OpenSpec versions and need no rollback.

## Handoff

The legacy `auto-update` change remains active at 5/6 tasks. Its unchecked task is the baseline-to-next-version platform smoke test, which requires signing credentials and real release artifacts. OpenSpec 1.11 also rejects its legacy full-spec file because it has no `ADDED`, `MODIFIED`, `REMOVED`, or `RENAMED` delta section. A dedicated follow-up must reconcile that change with the already-present canonical `auto-update` spec without claiming the smoke test ran.
