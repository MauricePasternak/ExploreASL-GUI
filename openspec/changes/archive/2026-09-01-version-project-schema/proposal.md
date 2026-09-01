## Why

The current `.easl` parser assumes one application-version-shaped format, silently replaces invalid mapping data with defaults, and rewrites a project merely because it was opened. Before project files are distributed more widely, the GUI needs an explicit schema-version boundary that can preserve valid legacy work, distinguish unsupported future files from corruption, and fail without changing source bytes.

## What Changes

- Introduce an integer `schemaVersion: 1` envelope independent from application SemVer and parse that envelope before any version-specific payload.
- Add a pure, ordered migration from current `version: "0.1.0"` files to schema v1, followed by full v1 validation before the result can be used or serialized.
- Preserve valid mapping state, `dataPar`, processing and visualization configuration, reviewer registry, verdicts, and import snapshots instead of silently replacing malformed valuable fields with defaults.
- Derive the runtime project root from the opened `project.easl` parent directory; retain legacy `projectMeta.rootPath` only as migration input and omit it from persisted v1 data.
- Return distinct actionable errors for malformed supported data and unknown future schema versions, leaving source bytes unchanged on any failure.
- Stop rewriting `project.easl` merely to update `lastOpened` during open. This change produces validated in-memory migration results and canonical serialized bytes; atomic replacement, backup, and recovery remain in PS-02.
- **BREAKING**: Newly serialized project files replace legacy `version: "0.1.0"` with `schemaVersion: 1` and no longer persist authoritative `projectMeta.rootPath`. Existing `0.1.0` files remain supported through migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-store`: Define version-first project parsing, schema v1, deterministic legacy migration, root derivation, preservation guarantees, and failure behavior without open-time source mutation.
- `import-rerun`: Replace legacy snapshot dropping with validated migration of object-form or compressed `mostRecentConfig` into canonical compressed persistence.
- `manifest-phase`: Preserve existing project phase values through schema migration rather than relying on direct legacy parsing.

## Impact

- Affected frontend schema and persistence code: `src/schemas/project.ts`, `src/schemas/importSchemas.ts`, `src/lib/snapshotCompression.ts`, and `src/stores/projectStore.ts`.
- Affected tests: project schema and project store parsing, migration, serialization, error classification, data preservation, and repeated-open determinism.
- Affected persisted contract: `.easl` project files. Current `0.1.0` files are migration inputs; future unsupported versions are rejected read-only.
- No new runtime dependency is expected. No atomic filesystem-write behavior is added in this change.
