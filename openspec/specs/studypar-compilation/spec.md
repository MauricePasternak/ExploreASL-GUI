# studypar-compilation Specification

## Purpose

Define compilation of metadata group assignments into ExploreASL studyPar configuration.

## Requirements

### Requirement: Generate Specially Grouped Regex Combinations From Subject Assignments

The system SHALL aggregate the `subjectRows` assignments for every `MetadataGroup` into discrete `StudyPars` blocks designed exclusively via target subject strings. Within each group, the compiler SHALL sort each subject's deduplicated session list and group subjects with identical session sets using a lossless signature. It SHALL preserve complete session labels when generating the joined `VisitRegExp` and join the subject names in `SubjectRegExp`. Session labels containing commas SHALL remain literal labels and SHALL NOT collide with multi-session signatures.

#### Scenario: Aggregating subjects with matching session profiles

- **WHEN** multiple subjects within the same metadata group possess the exact same session numbers (e.g. SubjA runs Session 01, SubjB runs Session 01)
- **THEN** exactly one `StudyPars` block SHALL be output with their labels joined: `SubjectRegExp: "^(SubjA|SubjB)$"` and `VisitRegExp: "^(01)$"`.

#### Scenario: Splitting subjects possessing differing session profiles within the SAME group

- **WHEN** a metadata group contains subjects that feature different combinations of sessions (e.g. SubjA contains 01 & 02; SubjC contains only 01)
- **THEN** the metadata group SHALL split its output across multiple `StudyPars` blocks. One block SHALL dictate `SubjectRegExp: "^(SubjA)$"` for `VisitRegExp: "^(01|02)$"`, and a separate block SHALL dictate `SubjectRegExp: "^(SubjC)$"` for `VisitRegExp: "^(01)$"`.

#### Scenario: Dropping groups with zero assigned subjects

- **WHEN** a `MetadataGroup` exists but zero `subjectRows` reference its `groupId`
- **THEN** the compiler SHALL NOT output any `StudyPars` blocks corresponding to that group.

#### Scenario: Session label contains a comma

- **WHEN** a subject has the session label `01,02`
- **THEN** its session signature SHALL produce `VisitRegExp: "^(01,02)$"` and SHALL NOT group with subjects assigned both `01` and `02`

#### Scenario: Single-group project with a shared session profile emits explicit regex

- **WHEN** only one `MetadataGroup` exists (e.g., Global Defaults) with at least one assigned subject and all subjects sharing the same session set
- **THEN** the compiler SHALL emit exactly one `StudyPars` block with explicit `SubjectRegExp` and `VisitRegExp` covering all assigned subjects and their sessions — NOT an empty-regex catch-all.

### Requirement: Match final staging identifiers

The compiler SHALL apply the supplied session aliases to captured `subjectRows` sessions before deduplication, session-set compression, and regex escaping. `VisitRegExp` SHALL target complete staged BIDS session labels (ExploreASL Visits). Row subjects already contain final subject labels and SHALL NOT have subject renames reapplied. Compilation SHALL preserve persisted row identities and group assignments and explicit metadata values including `false` and `0`. Preview, validation, and execution SHALL compile with the same session aliases.

#### Scenario: Session aliases retain group-specific metadata

- **WHEN** rows for captured sessions `baseline` and `followup1` are assigned to different metadata groups and aliases map them to `01` and `02`
- **THEN** their generated blocks SHALL match only the corresponding final sessions with `VisitRegExp` values `^(01)$` and `^(02)$`, preserving each group's metadata and leaving the persisted rows unchanged

#### Scenario: Subject target is another captured subject name

- **WHEN** subject renames map `raw` to `SUB1` and `SUB1` to `SUB2`, and metadata rows already contain `SUB1` and `SUB2`
- **THEN** the generated subject regexes SHALL preserve those final labels without applying the renames a second time

### Requirement: `assembleStudyPar` Accepts `subjectRows` As Input

The `assembleStudyPar` function SHALL accept both `metadataGroups: MetadataGroup[]` and `subjectRows: SubjectRow[]` as parameters. The function MUST derive all group membership from `subjectRows` and MUST NOT read `subjectRegExp` or `sessionRegExp` from `MetadataGroup` objects.

#### Scenario: Function signature change

- **WHEN** `assembleStudyPar` is called
- **THEN** it SHALL require `subjectRows` as a second argument and SHALL use `subjectRows` to determine which subjects and sessions belong to each `groupId`.

### Requirement: Explicit Assignment Targets and Invalid Empty Placeholder

The compilation engine SHALL output explicit target regexes for assignment-derived blocks, indicating group membership derived exclusively from `subjectRows`. If no rows belong to any supplied metadata group, `assembleStudyPar` SHALL instead return `{ "StudyPars": [{}] }` as an empty placeholder. `StudyParJsonSchema` SHALL reject this placeholder for missing required metadata; it SHALL NOT constitute a valid catch-all or valid studyPar configuration, and studyPar validation SHALL block entry to execution.

#### Scenario: Outputting a global default group without empty regex fallback

- **WHEN** `assembleStudyPar` processes the global defaults group payload with assigned subject rows
- **THEN** it SHALL extract all the explicitly checked assignment strings from `subjectRows` belonging to it and output constrained parameters with explicit `SubjectRegExp` and `VisitRegExp` values.

#### Scenario: No assigned groups produce an invalid placeholder

- **WHEN** `assembleStudyPar` receives no groups and no rows, or none of the supplied groups has assigned rows
- **THEN** it SHALL return `{ "StudyPars": [{}] }`, and `StudyParJsonSchema` SHALL reject that output rather than accept it as a valid studyPar configuration

### Requirement: Group Representation Without Group-Level Regexes

The `MetadataGroupSchema` SHALL represent a metadata group without group-level `subjectRegExp` and `sessionRegExp` fields.

#### Scenario: MetadataGroup validation

- **WHEN** a metadata group object is validated against `MetadataGroupSchema`
- **THEN** validation SHALL succeed if the object does not contain `subjectRegExp` and `sessionRegExp` fields.
