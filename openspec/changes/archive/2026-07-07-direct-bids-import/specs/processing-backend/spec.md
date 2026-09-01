## MODIFIED Requirements

### Requirement: list_subjects Command

`processing.rs::list_subjects(project_root: String, data_source: Option<String>)` SHALL delegate to `bids::scan::parse_bids_structure` on:

- `project_root.join("rawdata")` when `data_source` is `"dicom"` or omitted (existing DICOM-import contract)
- `project_root` when `data_source` is `"bids"` (BIDS-direct subjects live at project root)

The function maps `Vec<BidsSubject>` to `Vec<SubjectInfo>` preserving the existing frontend contract:

| Old `SubjectInfo` field | Mapping from `BidsSubject`/`BidsSession`                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `subject_session`       | `format!("sub-{}_{}", subject_label, session_label)`                                                 |
| `subject`               | `subject_label`                                                                                      |
| `session`               | `session_label`                                                                                      |
| `has_structural`        | `has_anat`                                                                                           |
| `has_asl`               | `has_perf`                                                                                           |
| `asl_runs`              | parsed from `asl_files` (run_label resolved, sorted ascending, default `"1"` when run entity absent) |

Cross-sectional handling: missing `ses-*` directories default to session `"1"` per D2.

Registered in `lib.rs` and exported via Tauri commands list (existing behavior preserved).

#### Scenario: DICOM project list_subjects unchanged output shape

- **WHEN** `list_subjects` runs on a DICOM-import project with `rawdata/sub-001/ses-01/perf/sub-001_asl.nii.gz`
- **THEN** returns `SubjectInfo { subject_session: "sub-001_01", subject: "001", session: "01", has_structural: ..., has_asl: true, asl_runs: ["1"] }`

#### Scenario: Cross-sectional session defaults to "1" in SubjectInfo

- **WHEN** `parse_bids_structure` scans ds000240 with `sub-01/perf/sub-01_asl.nii.gz` (no `ses-*`)
- **THEN** returns `SubjectInfo { subject_session: "sub-01_1", subject: "01", session: "1", ... }`

#### Scenario: BIDS-direct list_subjects scans project root

- **WHEN** `list_subjects` runs on a BIDS-direct project with subjects at root and empty `rawdata/`
- **THEN** returns subjects from project root, not empty list

## ADDED Requirements

### Requirement: startProcessing calls ensure_rawdata_dir for BIDS projects

`startProcessing` SHALL invoke `ensure_rawdata_dir(project_root)` before `run_pipeline` when `project.projectMeta.dataSource === "bids"`. For `dataSource === "dicom"`, `ensure_rawdata_dir` is NOT called. If `ensure_rawdata_dir` returns a warning payload (non-empty `rawdata/`), processing MUST wait for user confirmation before proceeding.

#### Scenario: BIDS project flow calls ensure_rawdata_dir

- **WHEN** user clicks Start Processing on a BIDS-direct project (`dataSource = "bids"`)
- **THEN** `ensure_rawdata_dir(project_root)` is invoked; on success the pipeline proceeds; on warning, user is prompted to confirm before proceeding

#### Scenario: DICOM project flow skips ensure_rawdata_dir

- **WHEN** user clicks Start Processing on a DICOM project (`dataSource = "dicom"`)
- **THEN** `ensure_rawdata_dir` is NOT invoked; existing behavior preserved

### Requirement: assembleDataPar injects subjectFolder for BIDS projects

`assembleDataPar` (or Rust `processing.rs::write_data_par_json`) SHALL include `x.opts.subjectFolder = project_root` in the resulting `dataPar.json` when `dataSource === "bids"`. For `dataSource === "dicom"`, `subjectFolder` MUST NOT be injected; `dataPar.json` matches existing behavior.

Resulting `dataPar.json` for BIDS-direct:

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

#### Scenario: BIDS-direct dataPar.json

- **WHEN** `assembleDataPar` runs for a BIDS-direct project with `rootPath = "/home/user/ds000240"`
- **THEN** resulting `dataPar.json` contains `"x": { "opts": { "subjectFolder": "/home/user/ds000240" } }` alongside `Q`, `M0` blocks

#### Scenario: DICOM project dataPar.json unchanged

- **WHEN** `assembleDataPar` runs for a DICOM project
- **THEN** resulting `dataPar.json` matches existing behavior; no `subjectFolder` key present

### Requirement: Processing pre-flight handling for participants.tsv

`ensureParticipantsFiles` operates on `<projectRoot>/derivatives/ExploreASL/participants.tsv`. Root-level user-authored `participants.tsv` is never modified by GUI code regardless of `dataSource`.

For BIDS-direct projects (`dataSource === "bids"`), if root-level `<projectRoot>/participants.tsv` exists and contains a `site` column, the GUI reads it to extract user-defined `site` values. Lookup matches root-level `participant_id` (e.g. `sub-01`) against the base subject label of session records (e.g. `sub-01_1`, `sub-01_2`). User `site` values are preserved in derivatives `participants.tsv` and are NOT overwritten by group labels. When `enableMetadataGroupingCorrection === true`, group labels fill in only for subjects/sessions lacking a root-level `site`. When `false`, the `site` column is still kept in derivatives to preserve root-level values.

For DICOM-import projects, existing behavior is preserved (group labels when correction enabled, stripped when disabled, no root read).

#### Scenario: BIDS-direct project with enableMetadataGroupingCorrection=true

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = true` and root-level `participants.tsv` defines `site = "CenterA"` for `participant_id = sub-01`
- **THEN** derivatives `participants.tsv` has `site = "CenterA"` for `sub-01_1` and `sub-01_2`; subjects without root `site` receive group label fallback

#### Scenario: BIDS-direct project with enableMetadataGroupingCorrection=false

- **WHEN** user clicks Start Processing on a BIDS-direct project with `enableMetadataGroupingCorrection = false` and root-level `participants.tsv` defines `site = "CenterA"` for `sub-01`
- **THEN** derivatives `participants.tsv` keeps the `site` column with `"CenterA"` for matching sessions (not stripped)

#### Scenario: Root-level participants.tsv preserved through processing

- **WHEN** ds000240 (with root-level `participants.tsv` containing 16 clinical columns) is processed end-to-end as a BIDS-direct project
- **THEN** root-level `participants.tsv` retains its original 16 columns throughout; ExploreASL-generated columns live in `derivatives/ExploreASL/participants.tsv` only
