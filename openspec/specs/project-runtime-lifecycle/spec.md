# project-runtime-lifecycle Specification

## Purpose

Define safe project transitions so each opened project owns a complete, isolated runtime session and no work or state can cross project boundaries.

## Requirements

### Requirement: Transactional project transition

The system SHALL validate a candidate project and classify its recoverable source references before changing the active project. If candidate validation fails, the current project and its runtime state SHALL remain active. After validation, the system SHALL stop project-owned work and listeners before resetting or hydrating state. If confirmed shutdown fails, the transition SHALL fail and the candidate SHALL NOT become active.

#### Scenario: Candidate project is invalid

- **WHEN** project A is active and the user tries to open malformed, unsupported, or unreadable project B
- **THEN** project A and its runtime state SHALL remain active and project B SHALL NOT be hydrated

#### Scenario: Prior work cannot stop

- **WHEN** project A is active, project B is valid, and an import worker, processing worker, or lock watcher cannot be confirmed stopped
- **THEN** project B SHALL NOT become active and the system SHALL show an actionable shutdown error

#### Scenario: Valid candidate replaces active project

- **WHEN** project B validates and all project-A work and listeners stop successfully
- **THEN** the system SHALL reset all project-scoped state before fully hydrating project B

### Requirement: Complete project-scoped reset and hydration

Each project lifecycle SHALL own the project, import, data-parameter, processing, manifest, and visualization runtime slices. Project replacement and close SHALL reset every persisted and transient field in those slices, including mappings, logs, phases, workers, progress, warnings, selections, loaded data, filters, and viewer state. Hydration SHALL replace each complete persisted slice over that slice's defaults; absent optional fields SHALL resolve to defaults rather than retaining values from the prior project. Global settings and execution profiles SHALL remain unchanged.

#### Scenario: Populated project is followed by sparse project

- **WHEN** populated project A is replaced by valid project B whose optional persisted slices are absent
- **THEN** project B SHALL receive defaults and SHALL inherit none of A's mappings, logs, phase, workers, progress, selection, manifest, data-parameter, or visualization state

#### Scenario: Project closes normally

- **WHEN** the user closes the active project after project-owned work stops
- **THEN** all project-scoped stores SHALL return to their initial state while global settings and execution profiles SHALL remain intact

#### Scenario: Project B has its own persisted state

- **WHEN** project B contains persisted import, processing, data-parameter, manifest, or visualization values
- **THEN** each runtime slice SHALL equal B's validated values merged with current defaults and SHALL contain no values from project A

### Requirement: Stale asynchronous work isolation

Every project lifecycle SHALL have an identity distinct from the persisted project ID and filesystem path. Delayed command results, event callbacks, post-processing, listener batches, and autosave timers SHALL verify that lifecycle identity before reading, writing, or mutating project-scoped state. Results owned by a closed or replaced lifecycle SHALL be discarded.

#### Scenario: Old scan finishes after project switch

- **WHEN** a filesystem scan started for project A resolves after project B becomes active
- **THEN** its result SHALL NOT mutate project B or trigger a save for either project

#### Scenario: Old import event arrives after project switch

- **WHEN** an import event or batched log callback from project A runs after A's lifecycle ends
- **THEN** it SHALL NOT update project B's progress, logs, phase, files, or persisted state

#### Scenario: Old autosave timer fires

- **WHEN** a debounced project-A autosave timer fires after project B becomes active
- **THEN** it SHALL NOT save project A data to B or write to A's previous location

### Requirement: Identity-aware recent projects

Recent-project state SHALL associate known project paths with project IDs while accepting existing path-only settings. Opening a known project from a new path SHALL replace its missing old path when identity proves it is the same moved project. If both old and new paths exist with the same project ID, the system SHALL ask whether the project was moved or copied. Choosing copied SHALL assign the opened copy a new project ID in memory, mark it dirty, and defer persistence to normal Save. Existing path-only entries that cannot be matched SHALL remain removable manually.

#### Scenario: Known project moved to new path

- **WHEN** a project opens from a new path, its known old path is missing, and both records identify the same project ID
- **THEN** Recent Projects SHALL replace the old path with the new path without rewriting `project.easl`

#### Scenario: Same identity exists at two paths

- **WHEN** both old and newly opened paths exist and contain the same project ID
- **THEN** the system SHALL ask whether the new location represents a move or a copy before completing the open

#### Scenario: User identifies a copied project

- **WHEN** the user chooses copied for a duplicate project identity
- **THEN** the opened copy SHALL receive a new runtime project ID, SHALL be dirty, and SHALL retain its source bytes until normal Save

#### Scenario: Legacy recent entry cannot be matched

- **WHEN** a path-only recent entry is missing and its project identity cannot be established
- **THEN** the system SHALL leave it as a stale manually removable entry and SHALL NOT guess which project replaced it
