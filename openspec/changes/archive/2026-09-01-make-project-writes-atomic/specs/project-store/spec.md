## ADDED Requirements

### Requirement: Validated atomic project writes

Every operation that persists `project.easl`, including project creation, normal Save, and repair after backup recovery, SHALL first produce and validate canonical schema v1 bytes. The system SHALL write those bytes to a uniquely named sibling temporary file, require the temporary file contents to be flushed, preserve the previous validated primary as `project.easl.bak` when one exists, and replace the primary atomically. Temporary and backup paths SHALL be derived from the selected `project.easl` path and SHALL remain in the same directory.

#### Scenario: Existing project is saved atomically

- **WHEN** a dirty project with a valid primary is saved successfully
- **THEN** `project.easl` SHALL contain the new validated bytes and `project.easl.bak` SHALL contain the previous validated primary bytes

#### Scenario: New project is created

- **WHEN** a project is created where no primary project file exists
- **THEN** validated schema v1 bytes SHALL become `project.easl` atomically and no backup SHALL be required

#### Scenario: Serialization fails before writing

- **WHEN** runtime project state cannot produce valid canonical schema v1 bytes
- **THEN** no temporary, primary, or backup project file SHALL be created or modified

#### Scenario: Temporary write or file flush fails

- **WHEN** writing or flushing the sibling temporary file fails
- **THEN** the save SHALL fail before primary replacement and the previous valid primary and backup SHALL remain recoverable

#### Scenario: Replacement is interrupted

- **WHEN** interruption occurs after the temporary file is durable but before replacement completes
- **THEN** at least one of the primary or backup SHALL contain complete valid old or new project bytes and no partial primary SHALL be accepted

### Requirement: Deterministic backup recovery

Project loading SHALL prefer a valid supported primary. If the primary is missing or malformed and `project.easl.bak` is valid and supported, the system SHALL ask before opening recovered data. Confirmed recovery SHALL load the backup into memory without changing disk, mark the project dirty, and allow normal Save to repair the primary without replacing the valid backup with missing or malformed primary bytes.

A primary declaring an unsupported future schema version SHALL stop with an unsupported-version error and SHALL NOT fall back to backup. A primary read failure, including permission denial, SHALL stop with its specific error unless the system has established that the primary is missing. A malformed or unsupported backup SHALL NOT be loaded.

#### Scenario: Valid primary takes precedence

- **WHEN** both primary and backup are valid supported project files
- **THEN** the primary SHALL open and the backup SHALL not be offered

#### Scenario: Missing primary offers backup recovery

- **WHEN** `project.easl` is missing and `project.easl.bak` is valid and supported
- **THEN** the system SHALL ask whether to open the recovered copy without modifying either file

#### Scenario: Malformed primary offers backup recovery

- **WHEN** `project.easl` is malformed and `project.easl.bak` is valid and supported
- **THEN** the system SHALL ask whether to open the recovered copy and SHALL preserve the malformed primary for inspection until an explicit Save

#### Scenario: User confirms backup recovery

- **WHEN** the user confirms opening a valid backup
- **THEN** recovered state SHALL load as dirty and no project file SHALL be written until normal Save is invoked

#### Scenario: Normal Save repairs recovered project

- **WHEN** a project loaded from backup is saved normally
- **THEN** a new valid primary SHALL be committed while the valid recovery backup remains available until replacement succeeds

#### Scenario: Future primary never falls back

- **WHEN** the primary declares a future schema version and an older valid backup exists
- **THEN** opening SHALL fail as unsupported and the backup SHALL NOT be offered

#### Scenario: Permission failure never falls back

- **WHEN** reading the primary fails with permission denied and a valid backup exists
- **THEN** opening SHALL fail with a permission error and the backup SHALL NOT be offered

### Requirement: Stale temporary file handling

Sibling temporary files left by interrupted saves SHALL NOT be treated as authoritative recovery candidates. After either the primary or confirmed backup has validated, the system SHALL remove only stale temporary files created by the atomic project writer for that exact project path. It SHALL NOT remove unrelated files or require temporary cleanup to succeed before opening the validated project.

#### Scenario: Stale temporary file accompanies valid primary

- **WHEN** a valid primary and a stale writer-owned temporary file exist
- **THEN** the primary SHALL open and the stale temporary file SHALL be ignored as project data and cleaned on a best-effort basis

#### Scenario: Temporary cleanup fails

- **WHEN** a primary or confirmed backup validates but stale temporary cleanup fails
- **THEN** project opening SHALL continue and the cleanup failure SHALL be logged

### Requirement: Ordered saves and dirty-state safety

Concurrent save requests SHALL execute in revision order. An older queued revision SHALL NOT replace a newer committed revision. A successful save SHALL clear dirty state only when no newer in-memory revision exists. Any serialization or storage failure SHALL leave dirty state set and SHALL NOT destroy the last-known-good primary or backup.

#### Scenario: Project changes during save

- **WHEN** revision A is saving and the project advances to revision B before A completes
- **THEN** completion of A SHALL NOT clear dirty state and the queued save SHALL persist revision B after A

#### Scenario: Save fails

- **WHEN** any save stage returns an error
- **THEN** project dirty state SHALL remain set and a subsequent Save SHALL be able to retry the latest revision

### Requirement: Actionable storage errors and durability reporting

Project persistence SHALL distinguish invalid serialization, permission denial, insufficient disk space, temporary write failure, file flush failure, backup failure, primary replacement failure, uncertain post-replacement durability, and recovery failure. Callers SHALL receive an actionable category without exposing sensitive project contents.

Flushing the temporary file SHALL be required. Parent-directory flushing SHALL be attempted where supported. If directory flushing is unsupported but file flushing and atomic replacement succeed, the save SHALL succeed and the reduced durability limitation SHALL be logged and documented without a recurring user warning. If supported directory flushing fails after replacement, the system SHALL report uncertain durability and SHALL retain dirty state.

#### Scenario: Disk is full

- **WHEN** temporary project bytes cannot be written because storage is full
- **THEN** Save SHALL fail with an insufficient-space error, dirty state SHALL remain set, and the previous valid project files SHALL remain recoverable

#### Scenario: Directory flush is unsupported

- **WHEN** file flush and atomic replacement succeed on a platform that does not support parent-directory flushing
- **THEN** Save SHALL succeed and the limitation SHALL be logged without showing a recurring warning

#### Scenario: Supported directory flush fails

- **WHEN** parent-directory flushing is supported but fails after primary replacement
- **THEN** Save SHALL report uncertain durability and dirty state SHALL remain set
