# exploreasl-rawdata-compat Specification

## Purpose

Preserve raw BIDS and DICOM source data compatibility while ExploreASL processing runs.

## Requirements

### Requirement: Root-level participants.tsv never modified

For both DICOM-import and BIDS-direct projects, root-level `<projectRoot>/participants.tsv` (if present) SHALL never be read, written, or modified by GUI code. `ensureParticipantsFiles` operates exclusively on `<projectRoot>/derivatives/ExploreASL/participants.tsv`. ExploreASL Population module appends processing-derived columns (`gm_vol`, `motion`, etc.) to the derivatives file, not root.

#### Scenario: User-authored participants.tsv preserved

- **WHEN** a BIDS-direct project is created on a root with `participants.tsv` (16 clinical columns: Age, Gender, MMSE, etc.) and processing runs end-to-end
- **THEN** root-level `participants.tsv` retains its original 16 columns throughout; GUI and ExploreASL operations target `derivatives/ExploreASL/participants.tsv` only

### Requirement: ensure_rawdata_dir command creates empty rawdata directory

The Rust command `ensure_rawdata_dir(root_path: String) -> Result<EnsureRawdataResult, String>` SHALL:

1. Create `<root_path>/rawdata/` directory if it does not exist (idempotent — succeeds silently if already present).
2. Write `<root_path>/rawdata/README.md` (idempotent, overwrite). Content:

   ```
   # rawdata/

   This directory exists for ExploreASL compatibility.
   The actual BIDS subjects live at the project root level.
   ExploreASL's BIDS2Legacy module checks for this directory
   at startup but uses the subjectFolder override in dataPar.json
   to scan subjects from the project root.

   Do not delete this directory while the project is active.
   ```

3. Manage `<root_path>/.bidsignore`:
   - If `.bidsignore` does not exist → create with content `"rawdata/\n"`
   - If `.bidsignore` exists but lacks `rawdata/` line → append `"rawdata/\n"`
   - If `.bidsignore` exists with `rawdata/` line → no-op
4. If `rawdata/` already exists AND is non-empty (contains any `sub-*/` entry): return a warning payload to frontend. Frontend shows confirmation dialog: "`rawdata/` at `<root>/rawdata/` already contains `<N>` sub-directories. `subjectFolder` override scans root-level subjects only; files in `rawdata/` will be ignored. Proceed?" Confirm/Cancel.

Called at processing startup before `run_pipeline` when `dataSource === "bids"`. Single call per processing run; `rawdata/` persists across sessions.

#### Scenario: Fresh project creates rawdata

- **WHEN** `ensure_rawdata_dir` runs on a BIDS-direct project root with no existing `rawdata/`
- **THEN** `<root>/rawdata/` directory is created, `rawdata/README.md` is written, `.bidsignore` is created with `"rawdata/\n"` entry

#### Scenario: Idempotent re-run

- **WHEN** `ensure_rawdata_dir` runs again on the same project root (after a prior successful run)
- **THEN** no errors; `rawdata/README.md` is overwritten (same content); `.bidsignore` already contains `rawdata/` line → no-op

#### Scenario: Existing non-empty rawdata warns

- **WHEN** `ensure_rawdata_dir` runs on a root where `rawdata/` already exists and contains `sub-001/ses-01/perf/sub-001_asl.nii.gz` (e.g., old DICOM-import project root)
- **THEN** command returns warning with subject count = 1; frontend shows confirmation dialog; only proceeds if user clicks Confirm

#### Scenario: .bidsignore append

- **WHEN** `.bidsignore` already exists with content `"derivatives/\n"` but no `rawdata/` entry
- **THEN** `ensure_rawdata_dir` appends `"rawdata/\n"`; final content is `"derivatives/\nrawdata/\n"`

### Requirement: subjectFolder override injected into dataPar.json

When `assembleDataPar` (or `rust processing.rs::write_data_par_json`) runs for a project with `dataSource === "bids"`, the resulting `dataPar.json` MUST include the absolute path to the project root directory in `x.opts.subjectFolder`:

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

For `dataSource === "dicom"` projects, `subjectFolder` is NOT injected; `dataPar.json` matches existing behavior.

ExploreASL reads `x.opts.subjectFolder` in `xASL_init_SubjectList.m` and overrides `bids.layout()`'s scan path. The empty `rawdata/` directory satisfies `xASL_init_DataLoading.m`'s `xASL_exist(<root>/rawdata, 'dir')` check (verified mechanism).

#### Scenario: BIDS-direct project processing

- **WHEN** `startProcessing` runs on a BIDS-direct project (`dataSource = "bids"`)
- **THEN** `ensure_rawdata_dir` is called first; `dataPar.json` is written with `x.opts.subjectFolder = <rootPath>`; `run_pipeline` starts ExploreASL which scans root-level `sub-*/`

#### Scenario: DICOM project processing unchanged

- **WHEN** `startProcessing` runs on a DICOM project (`dataSource = "dicom"`)
- **THEN** `ensure_rawdata_dir` is NOT called; `dataPar.json` is written without `subjectFolder` (existing behavior preserved)

### Requirement: list_subjects refactored to parse_bids_structure

`processing.rs::list_subjects(project_root: String)` SHALL delegate to `bids::scan::parse_bids_structure(Path::new(&project_root).join("rawdata"))`. The existing `SubjectInfo` frontend contract is preserved — `BidsSubject`/`BidsSession` mappings produce equivalent `SubjectInfo` entries (the `subject_session`, `subject`, `session`, `has_structural`, `has_asl`, `asl_runs` fields map 1:1).

Cross-sectional handling: `parse_bids_structure` defaults missing `ses-*` to session `"1"` (per cross-sectional convention). DICOM-import projects (which always have `ses-*` directories after import via NII2BIDS) remain unaffected.

#### Scenario: DICOM project list_subjects unchanged

- **WHEN** `list_subjects` runs on a DICOM-import project with `rawdata/sub-001/ses-01/perf/sub-001_asl.nii.gz`
- **THEN** `SubjectInfo` entries match the previous behavior (subject="001", session="01", asl_runs=["1"])

#### Scenario: parse_bids_structure handles rawdata scan

- **WHEN** `parse_bids_structure` scans a path with `sub-001/ses-01/perf/`, `sub-002/ses-01/perf/`
- **THEN** two `BidsSubject` entries returned, each with `subject_label = "001"`/`"002"`, single `BidsSession` with `session_label = "01"` and `has_explicit_session = true`

### Requirement: participants.tsv site-column precedence for BIDS-direct projects

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
