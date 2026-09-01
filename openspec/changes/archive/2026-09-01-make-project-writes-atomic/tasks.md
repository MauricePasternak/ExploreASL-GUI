## 1. Native Atomic Writer

- [x] 1.1 RED: Add Rust disk-level tests for first creation and replacement, asserting canonical new primary bytes and one previous-primary backup; verify the focused tests fail before implementation.
- [x] 1.2 RED: Add deterministic Rust failure-injection tests for temporary creation/write, temporary flush, backup rotation, primary replacement, and parent-directory flush, asserting every interruption leaves valid old or new bytes; verify the focused tests fail before implementation.
- [x] 1.3 GREEN: Implement the sibling temporary-file, required file-sync, backup, atomic primary replacement, and best-effort stale-temp cleanup helpers with structured storage errors; verify all focused Rust atomic-writer tests pass.
- [x] 1.4 GREEN: Implement platform-specific parent-directory synchronization outcomes and recovery-preservation mode, including unsupported-directory-sync success and supported-sync uncertain-durability failure; verify focused platform and failure-injection tests pass.
- [x] 1.5 Register the production Tauri atomic-write command without exposing failure injection, and verify `cargo test` plus Rust lint accepts the command contract.

## 2. Project Store Persistence

- [x] 2.1 RED: Replace direct-write expectations with frontend tests asserting project creation and normal Save invoke the atomic command with validated canonical schema v1 bytes; verify focused project-store tests fail before routing changes.
- [x] 2.2 GREEN: Add the typed frontend atomic-write adapter and route creation and normal Save through it, removing direct `project.easl` writes; verify focused creation/save tests pass.
- [x] 2.3 RED: Add save-queue tests for mutation during save, failed save retry, different-project replacement, ordered revisions, and `durability_uncertain`, asserting dirty state clears only after the latest fully acknowledged commit; verify new cases fail before queue changes.
- [x] 2.4 GREEN: Strengthen save coordination and structured error propagation so failures retain dirty state and newer revisions cannot be replaced or acknowledged by older saves; verify all focused queue tests pass.

## 3. Backup Recovery

- [x] 3.1 RED: Add project-store tests covering primary precedence, missing/malformed primary recovery availability, future-version and permission failures without fallback, malformed backup rejection, and non-writing confirmed recovery; verify focused recovery tests fail before implementation.
- [x] 3.2 GREEN: Implement typed primary classification, validated backup loading, runtime root derivation, dirty recovered state, and backup-preserving normal Save; verify focused recovery and existing version-first parsing tests pass.
- [x] 3.3 RED: Add landing-page component tests for recovery confirmation, decline behavior, actionable storage errors, and required `data-testid` hooks; verify focused landing-page tests fail before UI changes.
- [x] 3.4 GREEN: Add the recovery confirmation flow and storage-error presentation without silently writing or loading backup data; verify focused landing-page tests pass.
- [x] 3.5 Add tests proving writer-owned stale temporary files are never recovery sources, cleanup occurs only after primary or confirmed backup validation, and cleanup failure only logs; verify focused Rust and frontend recovery tests pass.

## 4. Disk Regression And Quality Gates

- [x] 4.1 Add a real-filesystem regression that creates, opens, mutates, saves, and reopens serialized project bytes, including compressed snapshot open-twice coverage; verify the focused disk round-trip test passes.
- [x] 4.2 Run focused frontend project-store and landing-page suites plus Rust atomic-writer tests, fixing regressions until all pass.
- [x] 4.3 Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, Rust tests/lint, and formatting checks; verify every repository quality gate passes.
- [x] 4.4 Validate `make-project-writes-atomic` and all canonical OpenSpec specs strictly, then record PS-02 roadmap completion only after implementation and verification are complete.
