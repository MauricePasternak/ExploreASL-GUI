# exploreasl-rawdata-compat Specification

## Purpose

Preserve raw BIDS and DICOM source data compatibility while ExploreASL processing runs.

## Requirements

### Requirement: Root-level participants.tsv never modified

GUI participant preparation SHALL never modify root participant metadata, reading it only for BIDS-direct site lookup and installing working metadata exclusively in derivatives.

#### Scenario: Participant metadata is prepared for either source type

- **WHEN** GUI preparation or ExploreASL Population uses participant metadata
- **THEN** root-file preservation and derivative ownership SHALL follow these rules:

For both DICOM-import and BIDS-direct projects, root-level `<projectRoot>/participants.tsv` (if present) SHALL never be written or modified by GUI code. Native participant preparation MAY read it for BIDS-direct site-column lookup as defined below; DICOM preparation SHALL NOT read it. Participant installation operates exclusively on derivative files under `<projectRoot>/derivatives/ExploreASL/`. ExploreASL Population module appends processing-derived columns (`gm_vol`, `motion`, etc.) to the derivatives file, not root.

#### Scenario: User-authored participants.tsv preserved

- **WHEN** a BIDS-direct project is created on a root with `participants.tsv` (16 clinical columns: Age, Gender, MMSE, etc.) and processing runs end-to-end
- **THEN** root-level `participants.tsv` retains its original 16 columns throughout; GUI and ExploreASL operations target `derivatives/ExploreASL/participants.tsv` only

### Requirement: subjectFolder override injected into dataPar.json

Native assembly SHALL derive BIDS-direct `subjectFolder` in the executor's namespace and omit it for DICOM, without mutating reserved configuration or project identity.

#### Scenario: MATLAB or Apptainer processing configuration is assembled

- **WHEN** native preparation builds `dataPar.json` for a project
- **THEN** source-specific overrides, namespace translation, and compatibility SHALL follow these rules:

When native processing preparation assembles configuration for a project with `dataSource === "bids"`, the resulting `dataPar.json` MUST include the absolute path to the current project root directory in the executor's filesystem namespace in `x.opts.subjectFolder`, replacing any supplied value. MATLAB uses the current absolute host project root; Apptainer uses `/data`, the existing container binding of that same root. Assembly SHALL derive this field without mutating the reserved configuration or changing the host project identity. For example, with MATLAB:

```json
{
  "x": {
    "opts": {
      "subjectFolder": "/path/to/project_root"
    }
  },
  "Q": { ... },
  "M0": { ... }
}
```

For `dataSource === "dicom"` projects, `subjectFolder` SHALL be omitted for both MATLAB and Apptainer, including when supplied in the incoming configuration; `dataPar.json` otherwise matches existing behavior.

ExploreASL reads `x.opts.subjectFolder` in `xASL_init_SubjectList.m` and overrides `bids.layout()`'s scan path. The empty `rawdata/` directory satisfies `xASL_init_DataLoading.m`'s `xASL_exist(<root>/rawdata, 'dir')` check (verified mechanism).

#### Scenario: BIDS-direct project processing

- **WHEN** `startProcessing` runs on a BIDS-direct project (`dataSource = "bids"`)
- **THEN** native preparation SHALL verify the existing compatibility directory without modifying it, write `dataPar.json` with `x.opts.subjectFolder` pointing to the current root in the executor's filesystem namespace, and launch ExploreASL to scan root-level `sub-*/`
- **AND** MATLAB SHALL use the current absolute host root, while Apptainer SHALL use `/data`, regardless of any stale supplied `subjectFolder`
- **AND** the reserved configuration and host project identity SHALL remain unchanged

#### Scenario: DICOM project processing unchanged

- **WHEN** `startProcessing` runs on a DICOM project (`dataSource = "dicom"`) with either a MATLAB or Apptainer profile
- **THEN** BIDS compatibility verification SHALL NOT run and `dataPar.json` SHALL be written without `subjectFolder`, even if a stale value was supplied (existing behavior preserved)

### Requirement: list_subjects refactored to parse_bids_structure

Subject listing SHALL reuse the common BIDS parser at the source-appropriate root, preserving the existing `SubjectInfo` contract and cross-sectional session convention.

#### Scenario: Subjects are listed for BIDS-direct or DICOM import

- **WHEN** `list_subjects` receives a project root and optional source kind
- **THEN** root selection, mapping, and session defaults SHALL follow these rules:

The `list_subjects(project_root: String, data_source: Option<String>)` command SHALL delegate to `bids::scan::parse_bids_structure` using the project root for `"bids"` and `project_root.join("rawdata")` for `"dicom"` or omitted data source. The existing `SubjectInfo` frontend contract is preserved: `BidsSubject`/`BidsSession` mappings produce equivalent `SubjectInfo` entries with `subject_session`, `subject`, `session`, `has_structural`, `has_asl`, and `asl_runs` fields.

Cross-sectional handling: `parse_bids_structure` defaults missing `ses-*` to session `"1"` (per cross-sectional convention). DICOM-import projects (which always have `ses-*` directories after import via NII2BIDS) remain unaffected.

#### Scenario: DICOM project list_subjects unchanged

- **WHEN** `list_subjects` runs on a DICOM-import project with `rawdata/sub-001/ses-01/perf/sub-001_asl.nii.gz`
- **THEN** `SubjectInfo` entries match the previous behavior (subject="001", session="01", asl_runs=["1"])

#### Scenario: parse_bids_structure handles rawdata scan

- **WHEN** `parse_bids_structure` scans a path with `sub-001/ses-01/perf/`, `sub-002/ses-01/perf/`
- **THEN** two `BidsSubject` entries returned, with `subject_label = "sub-001"`/`"sub-002"`, each with one `BidsSession` with `session_label = "01"` and `has_explicit_session = true`

### Requirement: participants.tsv site-column precedence for BIDS-direct projects

BIDS-direct participant preparation SHALL preserve root-authored site values in derivatives, using group labels only as permitted fallback and retaining source-specific DICOM behavior.

#### Scenario: Root-authored site values coexist with metadata grouping

- **WHEN** participant metadata is prepared with grouping correction enabled or disabled
- **THEN** lookup precedence, derivative installation, and root preservation SHALL follow these rules:

In BIDS-direct projects (`dataSource === "bids"`), if the root-level `<projectRoot>/participants.tsv` exists and contains a `site` column, its values SHALL take precedence:

- The user's `site` values take precedence. The GUI reads `<projectRoot>/participants.tsv` to extract the `site` values.
- When performing the lookup, the GUI matches the root-level `participant_id` column (e.g., `"sub-01"`) against the base subject label of the session record (e.g. `"sub-01"` matches both `"sub-01_1"` and `"sub-01_2"`), assuming root-level `participants.tsv` always lists subjects at the subject level.
- These user-defined `site` values are preserved and written to `<projectRoot>/derivatives/ExploreASL/participants.tsv`.
- They are NOT overwritten by metadata group labels (even when `enableMetadataGroupingCorrection === true`), and the column/values are NOT stripped (even when `enableMetadataGroupingCorrection === false`).
- If `enableMetadataGroupingCorrection === true`, group labels are only filled in as fallback values for subjects/sessions that do not have a defined `site` value in the root-level file.
- If `enableMetadataGroupingCorrection === false`, the `site` column is still kept in the derivatives file to preserve the user's root-level `site` values.

For DICOM-import projects, the existing behavior is preserved (group labels written if correction enabled, stripped if disabled, no reading from root-level file). The root-level `<projectRoot>/participants.tsv` is never written or modified by GUI code for either project type.

#### Scenario: BIDS-direct project with site correction enabled and pre-existing site values

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = true` and root-level `participants.tsv` defines `site = "CenterA"` for `participant_id = sub-01`, with `sub-02_1` lacking a root `site` value
- **THEN** `<root>/derivatives/ExploreASL/participants.tsv` has `site = "CenterA"` for `sub-01_1` (user preference preserved) and group label fallback for `sub-02_1`

#### Scenario: BIDS-direct project with site correction disabled and pre-existing site values

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = false`, where the root-level `participants.tsv` defines `site = "CenterA"` for `participant_id = sub-01`
- **THEN** `<root>/derivatives/ExploreASL/participants.tsv` keeps the `site` column, containing `"CenterA"` for matching `sub-01_*` sessions (not stripped)

#### Scenario: Root-level participants.tsv preserved through processing

- **WHEN** ds000240 (with root-level `participants.tsv` containing 16 clinical columns) is processed end-to-end as a BIDS-direct project
- **THEN** root-level `participants.tsv` retains its original 16 columns throughout; ExploreASL-generated columns (`site`, `gm_vol`, `motion`, etc.) live in `derivatives/ExploreASL/participants.tsv` only

### Requirement: BIDS compatibility setup ensures rawdata directory

Confirmed BIDS-direct project creation SHALL ensure `rawdata/` exists. It SHALL preserve every pre-existing entry in `rawdata/`, including `README.md`, and SHALL add `rawdata/` to `.bidsignore` through the confirmed transaction. Existing `sub-*` directories SHALL produce a pre-confirmation warning that BIDS-direct processing scans root-level subjects and ignores those directories.

#### Scenario: Fresh project creates compatibility artifacts

- **WHEN** a fresh BIDS-direct project mutation plan commits
- **THEN** `rawdata/` and the planned `rawdata/` ignore entry SHALL exist before import review begins

#### Scenario: Existing README remains user-owned

- **WHEN** `rawdata/README.md` exists before project creation or processing
- **THEN** ExploreASL GUI SHALL never overwrite, replace, or delete it

#### Scenario: Existing rawdata subjects require informed confirmation

- **WHEN** preflight finds one or more `rawdata/sub-*` directories
- **THEN** the plan SHALL disclose their count and ignored-by-BIDS-direct behavior before commit is allowed

### Requirement: Processing verifies compatibility without mutation

Before BIDS-direct processing starts, the system SHALL verify that `rawdata/` is a real directory, not a symbolic link. Verification SHALL be read-only. A missing, symbolic-link, or wrong-type compatibility directory SHALL block processing with an action that returns the user to a fresh mutation preflight; processing SHALL NOT silently repair it. DICOM processing SHALL not require this verification.

#### Scenario: Valid setup permits BIDS processing

- **WHEN** BIDS-direct processing finds the expected directory
- **THEN** compatibility verification SHALL succeed without changing source-tree entries

#### Scenario: Missing directory blocks without repair

- **WHEN** BIDS-direct processing finds no `rawdata/` directory
- **THEN** processing SHALL remain unstarted, report that setup must be reviewed again, and SHALL not create the directory

#### Scenario: DICOM project remains unchanged

- **WHEN** processing starts for a DICOM project
- **THEN** BIDS-direct compatibility directory verification SHALL not run
