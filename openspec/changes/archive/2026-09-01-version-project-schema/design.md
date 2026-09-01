## Context

See `proposal.md` for motivation. The current project schema combines persisted and runtime fields, identifies files through `version: "0.1.0"`, applies fallback values to malformed mapping fields, and lets `loadProject` rewrite `lastOpened` immediately. Snapshot preprocessing also converts malformed or legacy snapshot values to `null`. PS-01 must establish a deterministic parsing and migration boundary without taking on PS-02's atomic filesystem work.

## Goals / Non-Goals

**Goals:**

- Separate raw-envelope detection, legacy validation, migration, schema v1 validation, runtime hydration, and persisted serialization.
- Make every transformation pure and directly unit-testable.
- Preserve valid legacy scientific and review state while rejecting malformed valuable data.
- Ensure project location is runtime context, not persisted authority.
- Produce deterministic canonical bytes suitable for PS-02 to write atomically.

**Non-Goals:**

- Atomic rename, file synchronization, backup retention, recovery precedence, or save-queue changes; PS-02 owns these.
- Project relocation and cross-store cleanup beyond deriving the opened root; PS-03 owns complete relocation isolation.
- Migration from any legacy format other than current `version: "0.1.0"`.
- User-interface redesign beyond preserving distinct error categories for callers.

## Decisions

### Parse a minimal envelope before dispatch

Parse JSON into `unknown`, validate that it is an object, then inspect only `schemaVersion` and legacy `version`. Dispatch to a strict version-specific input schema after classification. Future integer schema versions produce a typed unsupported-version result before payload validation; supported payload failures produce typed malformed-project results.

Alternatives considered:

- A single union schema was rejected because union failure conflates an unsupported future version with malformed supported data.
- Trial-parsing every historical schema was rejected because dispatch order becomes implicit and harder to extend safely.

### Separate persisted DTOs from hydrated runtime state

Define a schema v1 persisted DTO that omits `projectMeta.rootPath` and other runtime-only values. Hydration receives the opened manifest path as context and derives its parent directory as runtime root. Canonical serialization projects runtime state back through an explicit DTO and validates it before JSON encoding.

Alternatives considered:

- Spreading Zustand project state was rejected because future runtime fields could leak into persisted data.
- Retaining `rootPath` as a fallback was rejected because stale absolute paths can redirect reads or writes after relocation.

### Keep PS-01 transformations read-only

`loadProject` reads source bytes, parses or migrates them, validates schema v1, and hydrates runtime state without writing. It preserves persisted timestamps during this transformation so repeated opens are deterministic. Canonical migrated bytes are returned by a pure serializer for a later explicit save, but opening itself does not replace the file. PS-02 will make that separate write path atomic.

Alternatives considered:

- Rewriting immediately after successful migration was rejected because safe replacement depends on PS-02's temporary file, synchronization, rename, and backup contract.
- Continuing the current open-time `lastOpened` rewrite was rejected because opening should not risk source loss and time-dependent mutation breaks deterministic migration.

### Validate legacy values before migration

Replace fallback-on-invalid behavior for valuable mapping and snapshot fields with explicit version-specific validation. Defaults remain allowed only where the field is genuinely absent and the legacy contract defines a default. Migration copies validated values field-by-field into v1, then validates the complete result.

Alternatives considered:

- Preserving `.catch(...)` defaults was rejected because malformed persisted work can disappear without notice.
- Passing unknown legacy objects through untouched was rejected because invalid data would cross the migration boundary and undermine the v1 contract.

### Normalize snapshots at persistence boundaries

Snapshot parsing accepts the two supported legacy representations: a validated full object or a compressed string that decompresses to a validated object. Runtime state always contains the object. Canonical v1 serialization always validates and emits deterministic gzip level 9 base64. Any decode or validation error fails the containing project operation.

Alternatives considered:

- Dropping object-form snapshots was rejected because they contain useful rerun provenance.
- Keeping both representations in schema v1 was rejected because multiple canonical forms break byte determinism and complicate future migrations.

## Risks / Trade-offs

- [Strict validation rejects files that previously opened after silent data loss] -> Return field-specific actionable errors and leave original bytes unchanged so users can repair or recover data.
- [An explicit save after migration still uses the existing non-atomic write path until PS-02] -> Keep opening strictly read-only, retain migration validation before serialization, and implement PS-02 immediately afterward to make explicit writes atomic.
- [Existing tests and fixtures depend on `version` and persisted `rootPath`] -> Add focused v0/v1 factories and migrate fixtures deliberately rather than weakening production schemas.
- [Compressed snapshot output could become nondeterministic] -> Pin compression settings, construct explicit DTOs in stable key order, and assert byte equality across repeated migration/serialization tests.
- [Typed errors may be collapsed by current landing-page messaging] -> Preserve error identity through `loadProject`; UI-specific presentation can map categories without changing parser behavior.

## Migration Plan

1. Introduce raw envelope classification, typed errors, and independent legacy/v1 schemas behind focused failing tests.
2. Add pure legacy-to-v1 migration and canonical serialization, proving preservation and determinism without filesystem writes.
3. Route project creation and loading through schema v1 boundaries while keeping opening read-only.
4. Keep legacy support until a separately specified deprecation removes it.
5. If regressions appear before PS-02, roll back consumers to the previous parser; source files remain recoverable because PS-01 performs no migration writes.
