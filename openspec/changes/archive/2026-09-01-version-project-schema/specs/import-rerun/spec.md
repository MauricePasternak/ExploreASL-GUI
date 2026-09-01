## MODIFIED Requirements

### Requirement: Import snapshot persistence

The system SHALL capture an `ImportSnapshot` at `startImport()` time and persist it in the project file at `uiState.import.mostRecentConfig`. The snapshot SHALL contain: `sourceDataPath`, `pathPatterns`, `tokenizerConfigs`, `bMatchDirectories`, `modalityAliases`, `sessionAliases`, `runAliases`, `subjectRenames`, `metadataGroups`, and `subjectRows` (including `groupId` assignments). The snapshot SHALL be `null` before the first import run.

When persisted to `.easl`, the snapshot SHALL be serialized as a gzip-compressed, base64-encoded string (algorithm: gzip, level 9). The in-memory store and staleness computation SHALL operate on a fully validated `ImportSnapshot` object. Schema v1 parsing SHALL decompress and validate a persisted string before exposing the snapshot. Migration of a legacy `.easl` file SHALL preserve either a valid compressed snapshot or a valid full-object snapshot, and canonical schema v1 serialization SHALL emit the compressed form. An invalid object, base64 value, gzip payload, JSON payload, or snapshot shape SHALL produce an actionable project validation or migration error instead of silently replacing the snapshot with `null`.

#### Scenario: First import creates snapshot

- **WHEN** the user clicks "Start Import" for the first time
- **THEN** the current import configuration SHALL be captured as an `ImportSnapshot` and stored at `uiState.import.mostRecentConfig`

#### Scenario: Re-run overwrites snapshot

- **WHEN** the user starts a re-run with selected subjects
- **THEN** the current import configuration SHALL replace the previous snapshot at `uiState.import.mostRecentConfig`

#### Scenario: Snapshot persists across sessions

- **WHEN** a schema v1 project containing a valid compressed snapshot is closed and reopened
- **THEN** the validated full snapshot SHALL be restored to runtime state

#### Scenario: Legacy object snapshot is migrated

- **WHEN** a valid legacy project contains a full-object `mostRecentConfig`
- **THEN** migration SHALL preserve the snapshot in runtime state and canonical schema v1 serialization SHALL encode it as a gzip-compressed base64 string

#### Scenario: Invalid compressed snapshot fails safely

- **WHEN** a supported project contains an invalid compressed `mostRecentConfig`
- **THEN** opening or migration SHALL fail with an actionable error and SHALL leave the project source unchanged
