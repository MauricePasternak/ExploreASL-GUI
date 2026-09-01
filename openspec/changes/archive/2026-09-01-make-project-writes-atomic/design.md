## Context

See `proposal.md` for motivation. PS-01 established deterministic schema v1 serialization and read-only opening, but `projectStore` still writes canonical bytes directly through the frontend filesystem plugin. JavaScript cannot reliably express cross-platform file flush, backup rotation, atomic replacement, or deterministic failure injection, so filesystem commit semantics need a focused native boundary while schema authority remains in TypeScript/Zod.

## Goals / Non-Goals

**Goals:**

- Make one native operation responsible for committing already-validated canonical project bytes.
- Preserve a validated previous primary as one sibling backup without allowing malformed recovery input to replace it.
- Keep existing revision-ordered frontend save coordination and strengthen its failure guarantees.
- Recover only from a validated backup after explicit user confirmation.
- Make every write stage and recovery branch deterministically testable.

**Non-Goals:**

- Additional backup generations, backup browsing, cloud synchronization, or general document history.
- Treating temporary files as recoverable drafts.
- Changing schema v1 fields or migration semantics.
- Full project relocation and cross-store cleanup, which remain PS-03.

## Decisions

### Keep schema validation in TypeScript and commit semantics in Rust

The existing canonical serializer remains the only schema v1 authority. Frontend callers serialize and validate before invoking a custom Rust command with the exact destination path, canonical text, and whether a validated recovery backup must be preserved. Rust performs only constrained filesystem work and returns a structured outcome/error category.

Alternatives considered:

- Frontend plugin composition was rejected because it cannot provide dependable flush and replacement semantics or precise failure injection across platforms.
- Duplicating the complete project schema in Rust was rejected because two schema authorities would drift and could disagree about valid scientific state.

### Use sibling unique temporary files and one fixed backup

The writer derives a unique hidden temporary filename from `project.easl` inside the same parent directory and opens it with create-new semantics. The backup path is fixed as `project.easl.bak`. Same-directory placement keeps replacement on one filesystem. Only writer-owned temporary names for the exact project path qualify for cleanup.

Alternatives considered:

- A system temporary directory was rejected because cross-filesystem rename is not atomic.
- A fixed temporary filename was rejected because stale files and concurrent process attempts could collide.
- Multiple dated backups were rejected because retention and recovery selection exceed the one-generation safety goal.

### Commit through durable temp, backup rotation, then primary replacement

The native writer performs these ordered stages:

1. Create the unique sibling temporary file.
2. Write all canonical bytes and require file synchronization.
3. If a known valid primary exists during normal save, rotate it to the fixed backup using platform-appropriate replacement semantics.
4. During repair-from-backup, never rotate the missing or malformed primary over the valid backup; preserve backup until new primary replacement succeeds.
5. Rename the durable temporary file to `project.easl` atomically.
6. Synchronize the parent directory where supported.
7. Remove remaining writer-owned stale temporary files best-effort after a validated primary or confirmed backup is available.

On Windows, backup replacement may require removing the older backup before moving a still-valid primary. Before that move the primary remains valid; afterward the new backup remains valid. On Unix-like systems, same-directory rename can atomically replace the backup entry. A failure after primary-to-backup rotation but before temp-to-primary replacement leaves the valid backup available.

Alternatives considered:

- Copying directly over the primary was rejected because interruption can create a truncated primary.
- Copying the primary into backup before direct overwrite was rejected because it still permits partial primary bytes and weakens metadata atomicity.

### Recover through typed detection and explicit confirmation

The frontend classifies primary outcomes separately: valid supported data, missing, malformed, unsupported future version, permission/read error. Only missing or malformed primary allows backup parsing. A valid supported backup raises a typed recovery-available state consumed by the landing page, which asks the user before retrying load in recovery mode.

Confirmed recovery hydrates backup data using the selected primary path as runtime root, sets non-persisted recovery state, and marks the project dirty. It performs no write. Normal Save passes preservation mode to the native writer, repairing primary while protecting backup. Declining recovery leaves store state unloaded and all files untouched.

Alternatives considered:

- Silent automatic backup loading was rejected because users must know primary integrity failed.
- A dedicated Repair command was rejected in favor of the user's selected normal Save workflow and existing dirty-state UI.
- Falling back after any read error was rejected because permission failures and future-version files do not prove corruption and could expose stale data.

### Preserve queue ownership in the frontend

`projectStore` continues to capture a revision snapshot and serialize saves through its promise chain. Every queued operation invokes the same native writer. Dirty state clears only if the committed project ID and revision still equal the latest in-memory state. Recovery preservation mode clears only after a fully successful commit.

Alternatives considered:

- Moving revision coordination into Rust was rejected because Rust does not own Zustand mutations or project identity.
- Coalescing all queued requests was deferred; current ordering is already tested and correctness matters more than reducing writes.

### Separate unsupported durability from actual failure

Temporary-file synchronization is mandatory. Parent-directory synchronization is attempted using supported native semantics. A known unsupported operation produces a debug log and successful save. Any other directory-sync error after replacement returns a `durability_uncertain` result; frontend retains dirty state because visibility and power-loss durability cannot be guaranteed even though new primary bytes may already be present.

Alternatives considered:

- Failing on unsupported directory sync was rejected because it would make valid saves unusable on supported platforms.
- Treating every directory-sync error as success was rejected because actual I/O failure would be hidden.

## Risks / Trade-offs

- [Crash between backup rotation and primary replacement leaves primary missing] -> Backup remains complete and deterministic recovery offers it on next open.
- [An error after replacement leaves actual disk state newer than frontend acknowledgement] -> Return `durability_uncertain`, retain dirty state, and make retry idempotently commit the latest canonical revision.
- [External software corrupts primary between validation and save] -> Recovery mode never rotates known malformed primary; normal operation assumes the primary validated when loaded and all application writes use the native boundary.
- [Windows and Unix replacement behavior differs] -> Isolate platform-specific steps behind one command contract and run disk-level Rust tests for each available CI platform.
- [Stale temporary cleanup could remove unrelated data] -> Match only exact writer-generated prefix/suffix in the selected project directory and make cleanup best-effort after validation.
- [Recovery prompt adds a new landing-page branch] -> Use a typed recovery-available result, local modal state keyed by path, and critical component tests with `data-testid` coverage.
- [Failure injection leaks into production behavior] -> Keep injection hooks internal/test-only around filesystem operations and never expose them through production command arguments.

## Migration Plan

1. Add native write-stage helpers and disk-level failure-injection tests without routing production callers.
2. Register the atomic write command and structured error contract.
3. Add frontend recovery detection/prompt tests and save-queue failure tests.
4. Route creation and normal Save through canonical serialization plus native commit.
5. Route confirmed recovery through dirty in-memory state and backup-preserving normal Save.
6. Remove direct `project.easl` writes after full round-trip, failure, and recovery verification passes.
7. Rollback may restore direct writes only before release; files created by the atomic writer remain ordinary schema v1 `project.easl` plus optional `.bak`.
