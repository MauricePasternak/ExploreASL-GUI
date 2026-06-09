# metadata-grouping-ui Specification

## Purpose
TBD - created by archiving change mutually-exclusive-metadata. Update Purpose after archive.
## Requirements
### Requirement: Dynamic Display of Group Assignments
The `MetadataGrouping` component SHALL dynamically compute the number of subjects and sessions assigned to each group by filtering the current `subjectRows` state array and SHALL display a read-friendly summary string in the "Scope / Target" column.

#### Scenario: Displaying calculated assignments
- **WHEN** a metadata group has 2 unique subjects mapping to 3 total sessions assigned to it in `subjectRows`
- **THEN** the UI list SHALL display "Assigned to 2 subjects (3 sessions)" instead of a regex string.

### Requirement: Override Group Creation Without Regex Fields
When creating an override `MetadataGroup`, the component SHALL create the group object with only `{ id, label, bidsParams }`. The component MUST NOT set `subjectRegExp` or `sessionRegExp` fields, as these have been removed from the schema. Group membership is determined solely by `subjectRows` `groupId` assignments.

#### Scenario: Creating an override group from selected rows
- **WHEN** the user selects rows and creates an override group
- **THEN** the new `MetadataGroup` object SHALL contain `{ id, label, bidsParams }` only, and the selected rows SHALL have their `groupId` updated to point to the new group.

### Requirement: Removal of Static Regex Display
The component SHALL NOT display static `subjectRegExp` and `sessionRegExp` values.

#### Scenario: Ignoring static group regex fields
- **WHEN** the `MetadataGrouping` component renders a metadata group
- **THEN** it SHALL ignore any static `subjectRegExp` and `sessionRegExp` fields, mapping the display to calculated values from `subjectRows` instead.

### Requirement: Removal of Regex Building on Override Creation
The component SHALL NOT build or set regex strings when creating override groups.

#### Scenario: Creating override without building regex
- **WHEN** an override group is created
- **THEN** `buildExactMatchRegex` SHALL NOT be invoked and the resulting group object SHALL NOT have group-level regexes.

