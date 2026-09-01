## Why

OpenSpec 1.11 exposes legacy specification-format failures, while active change artifacts are ignored by Git and the configured custom workflow requires unavailable agent skills. The repository needs one reproducible, strictly valid planning baseline before safety-critical roadmap changes begin.

Existing application capabilities remain unchanged. This change repairs planning infrastructure and canonical-document structure only.

## What Changes

- Track active and archived OpenSpec change artifacts in Git.
- Replace the incompatible project-local workflow default with OpenSpec 1.11's stock `spec-driven` workflow.
- Remove the obsolete `spec-driven-super-grill` project schema from the current tree; no history rewrite is required because it contains no secrets.
- Repair canonical specs to satisfy OpenSpec 1.11 structure without changing normative behavior.
- Reconcile the legacy `auto-update` change separately rather than silently treating its unexecuted platform smoke test as complete.
- Define strict OpenSpec validation as the clean-baseline gate for later CI integration.

No application behavior or persisted data changes. No breaking product change.

## Capabilities

### New Capabilities

None. This change sets `skip_specs: true` because it changes repository planning infrastructure, not product behavior.

### Modified Capabilities

None. Canonical spec edits preserve existing normative meaning and only add required document structure or missing scenarios that restate existing requirement text.

## Impact

- Affected files: `.gitignore`, `openspec/config.yaml`, project-local workflow schema files, canonical OpenSpec Markdown, and this migration change.
- Affected workflow: future proposals use stock `spec-driven` until a compatible reviewed schema is deliberately introduced.
- Validation target: `openspec validate --all --strict --no-interactive` and `openspec doctor --json`.
