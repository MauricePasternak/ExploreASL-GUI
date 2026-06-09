# studypar-compilation Specification

## Purpose
TBD - created by archiving change mutually-exclusive-metadata. Update Purpose after archive.
## Requirements
### Requirement: Generate Specially Grouped Regex Combinations From Subject Assignments
The system SHALL aggregate the `subjectRows` assignments for every `MetadataGroup` into discrete `StudyPars` blocks designed exclusively via target subject strings. The compiler MUST locate all subjects who share an identical set of sessions within a singular metadata group, joining the subject names together inside a single generated `SubjectRegExp` string alongside a corresponding joined `VisitRegExp` string.

#### Scenario: Aggregating subjects with matching session profiles
- **WHEN** multiple subjects within the same metadata group possess the exact same session numbers (e.g. SubjA runs Session 01, SubjB runs Session 01)
- **THEN** exactly one `StudyPars` block SHALL be output with their labels joined: `SubjectRegExp: "^(SubjA|SubjB)$"` and `VisitRegExp: "^(01)$"`.

#### Scenario: Splitting subjects possessing differing session profiles within the SAME group
- **WHEN** a metadata group contains subjects that feature different combinations of sessions (e.g. SubjA contains 01 & 02; SubjC contains only 01)
- **THEN** the metadata group SHALL split its output across multiple `StudyPars` blocks. One block SHALL dictate `SubjectRegExp: "^(SubjA)$"` for `VisitRegExp: "^(01|02)$"`, and a separate block SHALL dictate `SubjectRegExp: "^(SubjC)$"` for `VisitRegExp: "^(01)$"`.

#### Scenario: Dropping groups with zero assigned subjects
- **WHEN** a `MetadataGroup` exists but zero `subjectRows` reference its `groupId`
- **THEN** the compiler SHALL NOT output any `StudyPars` blocks corresponding to that group.

#### Scenario: Single-group project always emits explicit regex
- **WHEN** only one `MetadataGroup` exists (e.g., Global Defaults) with all subjects assigned to it
- **THEN** the compiler SHALL emit exactly one `StudyPars` block with explicit `SubjectRegExp` and `VisitRegExp` covering all assigned subjects and their sessions — NOT an empty-regex catch-all.

### Requirement: `assembleStudyPar` Accepts `subjectRows` As Input
The `assembleStudyPar` function SHALL accept both `metadataGroups: MetadataGroup[]` and `subjectRows: SubjectRow[]` as parameters. The function MUST derive all group membership from `subjectRows` and MUST NOT read `subjectRegExp` or `sessionRegExp` from `MetadataGroup` objects.

#### Scenario: Function signature change
- **WHEN** `assembleStudyPar` is called
- **THEN** it SHALL require `subjectRows` as a second argument and SHALL use `subjectRows` to determine which subjects and sessions belong to each `groupId`.

### Requirement: Mutual Exclusion Without Catch-All Fallback
The compilation engine SHALL output explicit target regexes indicating the exact membership of its group derived exclusively from the explicitly modeled `subjectRows`. Pushing empty or absent regex dictionary blocks to act as a fallback catch-all is prohibited.

#### Scenario: Outputting a global default group without empty regex fallback
- **WHEN** `assembleStudyPar` processes the global defaults group payload
- **THEN** it SHALL extract all the explicitly checked assignment strings from `subjectRows` belonging to it and output constrained parameters with explicit `SubjectRegExp` and `VisitRegExp` values.

### Requirement: Group Representation Without Group-Level Regexes
The `MetadataGroupSchema` SHALL represent a metadata group without group-level `subjectRegExp` and `sessionRegExp` fields.

#### Scenario: MetadataGroup validation
- **WHEN** a metadata group object is validated against `MetadataGroupSchema`
- **THEN** validation SHALL succeed if the object does not contain `subjectRegExp` and `sessionRegExp` fields.

