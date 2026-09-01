## ADDED Requirements

### Requirement: Version-first project parsing

The system SHALL parse a minimal project envelope before parsing any version-specific payload. A schema v1 file SHALL declare integer `schemaVersion: 1`. A legacy file declaring `version: "0.1.0"` and no `schemaVersion` SHALL be treated as a supported migration input. A file declaring a future `schemaVersion` greater than 1 SHALL be rejected as unsupported rather than corrupt.

#### Scenario: Schema v1 project is recognized

- **WHEN** a project file declares `schemaVersion: 1`
- **THEN** the system SHALL validate its payload using the schema v1 contract

#### Scenario: Current legacy project is recognized

- **WHEN** a project file declares `version: "0.1.0"` and omits `schemaVersion`
- **THEN** the system SHALL validate it as a legacy migration input before migrating it to schema v1

#### Scenario: Future project version is rejected distinctly

- **WHEN** a project file declares integer `schemaVersion: 2`
- **THEN** opening SHALL fail with an actionable unsupported-version error and SHALL NOT report the file as corrupt

#### Scenario: Malformed supported project is rejected

- **WHEN** a project identifies a supported version but its payload fails that version's validation
- **THEN** opening SHALL fail with an actionable malformed-project error identifying the invalid data

### Requirement: Schema v1 persisted and runtime boundaries

The persisted schema v1 project SHALL use `schemaVersion: 1` independently from application SemVer and SHALL NOT persist `projectMeta.rootPath` as an authoritative location. Runtime state SHALL derive the project root from the parent directory of the opened `project.easl` path. Serialization SHALL use an explicit persisted data transfer object rather than spreading runtime store state.

#### Scenario: New schema v1 project is serialized

- **WHEN** a schema v1 project is canonically serialized
- **THEN** output SHALL contain integer `schemaVersion: 1`, SHALL omit legacy `version`, and SHALL omit `projectMeta.rootPath`

#### Scenario: Project is opened after relocation

- **WHEN** a valid schema v1 `project.easl` is opened from a different parent directory
- **THEN** its runtime project root SHALL equal the opened file's parent directory without consulting a persisted root path

#### Scenario: Runtime-only state is not persisted

- **WHEN** runtime project state containing non-persisted fields is serialized
- **THEN** only fields declared by the schema v1 persisted data transfer object SHALL appear in output

### Requirement: Deterministic legacy migration

The system SHALL provide a pure ordered migration from validated `version: "0.1.0"` data to schema v1. Migration SHALL preserve valid mapping state, `dataPar`, import and processing configuration, visualization configuration, reviewer registry, verdicts, and module completion and last-run metadata. Valuable fields with invalid values SHALL cause migration failure instead of being silently replaced with defaults. The complete migrated result SHALL pass schema v1 validation before it can be returned or serialized.

#### Scenario: Valuable legacy state is preserved

- **WHEN** a valid `0.1.0` project containing mappings, parameters, processing state, visualization state, reviewers, and verdicts is migrated
- **THEN** the corresponding schema v1 fields SHALL retain equivalent values

#### Scenario: Invalid mapping data fails migration

- **WHEN** a legacy mapping field is present with an invalid value
- **THEN** migration SHALL fail with an actionable validation error instead of replacing that field with an empty or default value

#### Scenario: Migration is deterministic

- **WHEN** identical legacy bytes are independently parsed and migrated twice
- **THEN** both operations SHALL produce equivalent in-memory schema v1 state and byte-identical canonical serialized output

#### Scenario: Migrated output fails v1 validation

- **WHEN** migration produces a value that does not satisfy the complete schema v1 contract
- **THEN** migration SHALL fail before the result is exposed or written

### Requirement: Project opening is read-only

Opening or migrating a project SHALL NOT modify its source bytes. In particular, opening SHALL NOT rewrite `project.easl` merely to update `lastOpened`. Any malformed input, unsupported version, or migration failure SHALL leave the source unchanged. A later explicit save is a separate operation; atomic replacement, backup, and recovery behavior are defined separately.

#### Scenario: Valid project is opened without rewrite

- **WHEN** a supported project opens successfully
- **THEN** the bytes of its source `project.easl` SHALL remain unchanged

#### Scenario: Failed migration leaves source unchanged

- **WHEN** legacy migration fails validation
- **THEN** opening SHALL fail and the source `project.easl` bytes SHALL remain unchanged
