## 1. Repository Planning Baseline

- [x] 1.1 Track `openspec/changes/` while retaining ignores for machine-local agent state; verify `git status --short --ignored -- openspec/changes` shows change artifacts as untracked or tracked, not ignored.
- [x] 1.2 Set the default workflow to stock `spec-driven`, remove the incompatible `spec-driven-super-grill` tree, and verify a newly inspected migration change resolves to `schemaName: "spec-driven"`.
- [x] 1.3 Audit OpenSpec history and current files for secrets or personal data, document the no-rewrite decision in `design.md`, and verify no credential material is found.

## 2. Canonical Spec Format Migration

- [x] 2.1 Capture the OpenSpec 1.11 strict validation baseline and identify every canonical spec with missing or placeholder `Purpose` content.
- [x] 2.2 Add meaningful `Purpose` sections to every affected canonical spec and normalize existing invariant language to `SHALL`/`MUST` where strict validation requires it without changing requirement meaning; verify no strict placeholder or missing-purpose finding remains.
- [x] 2.3 Add scenarios to legacy requirements that lack them, restating existing normative behavior without adding behavior; verify every canonical requirement has at least one parsed scenario.
- [x] 2.4 Run `openspec validate --specs --strict --no-interactive` and verify all canonical specs pass.

## 3. Reproducible Validation

- [x] 3.1 Pin OpenSpec 1.11.0 as a development dependency and add repository scripts for strict canonical-spec validation; verify the local package command reports version 1.11.0.
- [x] 3.2 Add a CI job that runs strict canonical-spec validation and verify workflow syntax plus the local script succeeds.
- [x] 3.3 Run `openspec schema validate spec-driven`, `openspec validate migrate-openspec-1-11 --type change --strict`, and `openspec doctor --json`; verify all three succeed.

## 4. Legacy Change Handoff

- [x] 4.1 Keep the incomplete `auto-update` change tracked, record its 5/6 status and invalid legacy delta format in the migration handoff, and verify its remaining smoke task stays unchecked.
- [x] 4.2 Run Markdown formatting and `git diff --check`; verify no application source or product requirement meaning changed during migration.
