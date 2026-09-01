## Why

Schema v1 now produces validated canonical project bytes, but project creation and normal saves still overwrite `project.easl` directly. A crash, disk-full condition, permission failure, or interrupted write can therefore destroy the only usable project record, so all project persistence needs one crash-safe operation before wider use.

## What Changes

- Route project creation, explicit migration persistence, metadata persistence, and normal saves through one atomic project-write boundary instead of direct frontend filesystem writes.
- Validate canonical schema v1 bytes before any destination mutation, write a sibling temporary file, flush durable data where supported, and atomically replace the primary project file.
- Retain one last-known-good sibling backup and offer recovery when the primary file is missing or malformed. Recovery requires confirmation, opens without rewriting disk, marks the project dirty, and uses normal Save to repair the primary while preserving the valid backup.
- Never fall back to backup for a future schema version, permission/read failure, or other condition that does not prove primary corruption. Ignore stale temporary files as recovery sources and clean them only after a primary or backup validates.
- Preserve save-queue ordering so overlapping saves cannot let an older revision replace a newer revision or incorrectly clear dirty state.
- Distinguish serialization, permission, disk-space, temporary-write, flush, replacement, uncertain-durability, and recovery failures so callers can show actionable errors. Unsupported directory flushing SHALL be logged and documented rather than failing or repeatedly warning the user.
- Add disk-level round-trip and failure-injection coverage proving every interrupted operation leaves either valid old bytes or valid new bytes, while failed saves preserve dirty state and the last-known-good file.
- No persisted schema fields change. No backward compatibility break is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-store`: Require validated atomic project writes, one last-known-good backup, deterministic recovery, ordered concurrent saves, and distinct storage failure behavior for every project persistence path.

## Impact

- Affected frontend persistence and recovery UI: `src/stores/projectStore.ts`, its save queue, project creation, landing-page recovery confirmation, and associated tests.
- Affected serialization boundary: the schema v1 serializer remains authoritative and all write callers must use it.
- Affected Tauri backend: a focused filesystem command and Rust tests are expected because durable flush, atomic replacement, and controlled failure injection require native filesystem semantics.
- Affected project directory: sibling temporary and backup files may be created beside `project.easl`; recovery must never read or write outside that directory.
- No new runtime dependency is expected unless design review finds the standard library insufficient for a supported platform.
