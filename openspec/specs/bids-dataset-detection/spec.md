# bids-dataset-detection Specification

## Purpose

Define detection and validation of BIDS ASL datasets before direct import.

## Requirements

### Requirement: check_bids_dataset command validates folder as BIDS ASL source

The Rust command `check_bids_dataset(root_path: String) -> BidsCheckResult` SHALL scan the provided folder for BIDS structure and ASL content. It does NOT parse sidecar JSON; it checks directory structure and sidecar presence only.

Algorithm:

1. Check whether `dataset_description.json` exists at `<root_path>`. If present, parse JSON to extract `BIDSVersion`. Parse failure is non-fatal; populate `dataset_desc_error`.
2. Call `parse_bids_structure(root_path)` to enumerate `sub-*/` subjects and their sessions.
3. For each subject/session, verify that **every** `*_asl.nii` or `*_asl.nii.gz` file has a matching `*_asl.json` sidecar and a matching `*_aslcontext.tsv` companion file. If **all** runs in the session have matching sidecars and context files, the session is valid — increment `asl_session_count` once (not per run); if the subject has at least one valid ASL session, increment `asl_subject_count`.
4. If a session contains ASL files but **any** run lacks its companion `*_asl.json` sidecar or `*_aslcontext.tsv` file, the session is invalid — add the subject/session identifier to `missing_sidecars` (using `sub-XX_<session>` convention). Sessions with only `anat/` (no `perf/`) are NOT added to `missing_sidecars`. Missing or unreadable context files also increment `missing_aslcontext_count` but do NOT block `is_bids` if other valid ASL sessions exist in the dataset.
5. `is_bids = asl_subject_count >= 1`. `dataset_description.json` presence is informational — NOT a gate on `is_bids`.
6. `is_cross_sectional = true` unless at least one subject has more than one explicit `ses-*` directory with usable BIDS content (`perf/` or `anat/`). Datasets with no `ses-*`, or exactly one explicit session per subject, are cross-sectional for GUI purposes. A single subject with `ses-01/` and `ses-02/` makes the dataset longitudinal (`is_cross_sectional = false`).
7. If `!is_bids`, set `error` with a specific reason.

Result `BidsCheckResult` fields: `is_bids: bool`, `has_dataset_description: bool`, `dataset_desc_error: Option<String>`, `bids_version: Option<String>` (renders as "Unknown" when field missing or parse failed), `asl_subject_count: u32`, `asl_session_count: u32`, `total_subject_count: u32`, `missing_sidecars: Vec<String>` (using `sub-XX_<session>` convention), `missing_aslcontext_count: u32`, `has_perf_directory: bool`, `is_cross_sectional: bool`, `error: Option<String>`.

#### Scenario: Valid BIDS dataset with ASL

- **WHEN** `check_bids_dataset` runs on a folder with `dataset_description.json`, 25 `sub-*/` directories each containing `perf/sub-XX_asl.nii.gz` + `sub-XX_asl.json`
- **THEN** `is_bids = true`, `asl_subject_count = 25`, `has_dataset_description = true`, `error = None`

#### Scenario: ASL subjects without dataset_description.json

- **WHEN** `check_bids_dataset` runs on a folder with 10 `sub-*/` directories each with `perf/sub-XX_asl.{nii.gz,json}` but no `dataset_description.json`
- **THEN** `is_bids = true` (ASL data present), `has_dataset_description = false`, `bids_version = None`

#### Scenario: Corrupt dataset_description.json but ASL present

- **WHEN** `dataset_description.json` exists but JSON parse fails (e.g., syntax error), while 12 subjects with valid ASL sidecars are present
- **THEN** `is_bids = true`, `dataset_desc_error = "Unexpected token at line 3..."`, `asl_subject_count = 12`

#### Scenario: Empty or non-BIDS folder

- **WHEN** `check_bids_dataset` runs on `<user>/Documents/` (no `sub-*/` directories)
- **THEN** `is_bids = false`, `total_subject_count = 0`, `error = "No BIDS subjects found"`

#### Scenario: Subjects present but no ASL sidecars

- **WHEN** `check_bids_dataset` runs on a folder with 5 `sub-*/` directories, none containing `perf/` or `*_asl.json`
- **THEN** `is_bids = false`, `total_subject_count = 5`, `asl_subject_count = 0`, `missing_sidecars` populates with the 5 subject identifiers, `error = "No valid ASL BIDS data found"`

#### Scenario: Cross-sectional detection

- **WHEN** `check_bids_dataset` runs on ds000240 (no `ses-*` directories; subjects have `perf/`, `anat/` directly)
- **THEN** `is_cross_sectional = true`

#### Scenario: Longitudinal detection via multi-session subject

- **WHEN** `check_bids_dataset` runs on a dataset where `sub-01` has `ses-01/perf/` and `ses-02/perf/` with valid ASL sidecars
- **THEN** `is_cross_sectional = false`

#### Scenario: Single explicit session per subject is still cross-sectional

- **WHEN** `check_bids_dataset` runs on a dataset where every subject has exactly one `ses-01/perf/` directory and no subject has two or more explicit sessions
- **THEN** `is_cross_sectional = true`

#### Scenario: Missing aslcontext counted but does not block is_bids

- **WHEN** `check_bids_dataset` runs on a folder where 10 subjects have valid `*_asl.json` but 2 sessions lack `*_aslcontext.tsv`
- **THEN** `is_bids = true`, `asl_subject_count = 10`, `missing_aslcontext_count = 2`

### Requirement: LandingPage shows confirmation dialog on BIDS detection

After the folder picker returns a path, `LandingPage.handleNewProject()` MUST invoke `check_bids_dataset`. Based on the result, a unified project import setup modal MUST always be shown:

- `error == null && is_bids` → show dialog: "BIDS Dataset Detected" with both "Skip Import — review BIDS metadata" and "Import from DICOM" enabled. Dialog displays `asl_subject_count`, `asl_session_count`, and "Cross-sectional: Yes/No" from `is_cross_sectional` (longitudinal only when at least one subject has multiple explicit sessions). When `missing_aslcontext_count > 0`, show a non-blocking warning that those sessions will be skipped during review. Dialog body mentions `rawdata/` creation requirement for upstream-compat.
- `is_bids == false && asl_subject_count == 0 && total_subject_count == 0` → show dialog: "No BIDS Subjects Found" with BIDS option disabled and "Import from DICOM" enabled/auto-selected. Display the callout: "No BIDS subjects found in the selected folder. Ensure the folder contains sub-\* directories with ASL data."
- `is_bids == false && asl_subject_count == 0 && total_subject_count > 0` → show dialog: "No Valid ASL BIDS Data Found" with BIDS option disabled and "Import from DICOM" enabled/auto-selected. Display the callout: "The selected folder contains BIDS subjects but none have valid ASL data. Ensure at least one subject has a perf/ directory with \*\_asl.json sidecars."
- `dataset_desc_error != null && asl_subject_count >= 1` → show dialog: "Corrupt dataset_description.json" with both options enabled. Display the callout: "dataset_description.json is corrupt, but ASL subjects were found."

In all cases, the dialog features three buttons: `[Confirm]` (disabled unless an option is selected; when BIDS is disabled, DICOM is pre-selected and `[Confirm]` is enabled), `[Choose a Different Folder]`, and `[Cancel]`.

`Cancel` or dismissed dialog → return to landing page (no project created, no state mutation). `Continue + Skip Import` → `createProject(path, name, { dataSource: "bids" })`, navigate to import. `Continue + DICOM` → `createProject(path, name, { dataSource: "dicom" })`, navigate to import.

#### Scenario: BIDS folder picked → user chooses BIDS-direct

- **WHEN** user picks ds000240 root, `check_bids_dataset` returns `is_bids = true, asl_subject_count = 25, is_cross_sectional = true`, user selects "Skip Import"
- **THEN** `createProject(path, name, { dataSource: "bids" })` is called, navigation goes to `/project/:id/import`, `BIDSReviewPanel` renders

#### Scenario: BIDS folder picked → user chooses DICOM anyway

- **WHEN** user picks a BIDS folder and explicitly selects "Import from DICOM"
- **THEN** `createProject(path, name, { dataSource: "dicom" })` is called, navigation goes to DICOM import wizard (existing flow)

#### Scenario: Non-BIDS folder picked → error, retry

- **WHEN** user picks `<user>/Documents/` (no BIDS data), `check_bids_dataset` returns `is_bids = false`, error dialog shows
- **THEN** `[Choose Different Folder]` reopens the folder picker; `[Cancel]` returns to landing page; no project is created in either case

#### Scenario: Corrupt dataset_description but ASL present → user proceeds anyway

- **WHEN** `dataset_description.json` exists with invalid JSON, 12 subjects have valid ASL sidecars
- **THEN** corrupt warning dialog shows; `[Skip Import anyway]` creates BIDS-direct project; `[Cancel]` returns to landing
