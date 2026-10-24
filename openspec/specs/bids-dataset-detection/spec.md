# bids-dataset-detection Specification

## Purpose

Define detection and validation of BIDS ASL datasets before direct import.

## Requirements

### Requirement: check_bids_dataset command validates folder as BIDS ASL source

The Rust command `check_bids_dataset(root_path: String) -> BidsCheckResult` SHALL scan the provided folder for BIDS structure and ASL content. It does NOT parse sidecar JSON; it checks directory structure and sidecar presence only.

Algorithm:

1. Check whether `dataset_description.json` exists at `<root_path>`. If present, parse JSON to extract `BIDSVersion`. Parse failure is non-fatal; populate `dataset_desc_error`.
2. Call `parse_bids_structure(root_path)` to enumerate `sub-*/` subjects and their sessions.
3. For each subject/session containing ASL NIfTI files, verify that **every** `*_asl.nii` or `*_asl.nii.gz` file has a matching `*_asl.json` sidecar. If **all** runs have matching JSON sidecars, the session is valid for detection — increment `asl_session_count` once (not per run); if the subject has at least one such session, increment `asl_subject_count`. Context presence and readability do NOT determine detection validity.
4. If a session contains ASL files but **any** run lacks its companion `*_asl.json` sidecar, add the subject/session identifier to `missing_sidecars` (using `sub-XX_<session>` convention). Sessions without ASL NIfTIs, including `anat/`-only sessions, are NOT added. For each ASL NIfTI whose JSON sidecar exists, increment `missing_aslcontext_count` if its corresponding `*_aslcontext.tsv` path is absent. This count is per ASL file/run, not per distinct session; existing but unreadable context paths are not counted. Missing context does NOT block `is_bids`, even when no session has context.
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
- **THEN** `is_bids = false`, `total_subject_count = 5`, `asl_subject_count = 0`, `missing_sidecars = []`, `error = "No valid ASL BIDS data found"`

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

- **WHEN** `check_bids_dataset` runs on a folder where 10 subjects each have one ASL NIfTI with matching `*_asl.json` in one session, but 2 sessions lack `*_aslcontext.tsv`
- **THEN** `is_bids = true`, `asl_subject_count = 10`, `missing_aslcontext_count = 2`

#### Scenario: Only ASL session lacks context for multiple runs

- **WHEN** the only subject/session contains two ASL NIfTIs with matching JSON sidecars but neither run has its corresponding `*_aslcontext.tsv`
- **THEN** `is_bids = true`, `asl_subject_count = 1`, `asl_session_count = 1`, `missing_aslcontext_count = 2`, and `missing_sidecars = []`

### Requirement: LandingPage shows confirmation dialog on BIDS detection

After the folder picker returns a path, `LandingPage.handleNewProject()` MUST invoke `check_bids_dataset` for read-only detection after any separately disclosed prior-setup recovery. Based on the result, a unified project import setup modal MUST always be shown:

- `error == null && is_bids` → show dialog: "BIDS Dataset Detected" with both "Skip Import — review BIDS metadata" and "Import from DICOM" enabled. Dialog displays `asl_subject_count`, `asl_session_count`, and "Cross-sectional: Yes/No" from `is_cross_sectional` (longitudinal only when at least one subject has multiple explicit sessions). When `missing_aslcontext_count > 0`, show a non-blocking missing-context warning using the reported per-ASL-file/run count. The current UI labels this number "session(s)", but it is not a count of distinct skipped sessions: multiple missing-context runs in one session contribute multiple counts.
- `is_bids == false && asl_subject_count == 0 && total_subject_count == 0` → show dialog: "No BIDS Subjects Found" with BIDS option disabled and "Import from DICOM" enabled/auto-selected. Display the callout: "No BIDS subjects found in the selected folder. Ensure the folder contains sub-* directories with ASL data."
- `is_bids == false && asl_subject_count == 0 && total_subject_count > 0` → show dialog: "No Valid ASL BIDS Data Found" with BIDS option disabled and "Import from DICOM" enabled/auto-selected. Display the callout: "The selected folder contains BIDS subjects but none have valid ASL data. Ensure at least one subject has a perf/ directory with *_asl.json sidecars."
- `dataset_desc_error != null && asl_subject_count >= 1` → show dialog: "Corrupt dataset_description.json" with both options enabled. Display the callout: "dataset_description.json is corrupt, but ASL subjects were found."

When detection reports `is_bids = true`, `total_subject_count > 0`, `has_dataset_description = true`, or non-null `dataset_desc_error`, the modal MUST obtain and display the read-only mutation plan for the currently selected import option before enabling `[Confirm]`. The displayed list MUST identify every applicable `create`, `update`, `no-op`, warning, and conflict for `project.easl`, `.bidsignore`, and any data-source-specific directory or marker. A blocking conflict or unavailable plan MUST disable confirmation. Changing the import option MUST replace the displayed plan rather than reusing a plan for another data source.

In all cases, the dialog features `[Confirm]` (enabled only when an option is selected and, where required, has a current conflict-free plan), `[Choose a Different Folder]`, and `[Cancel]`. After any disclosed prior-setup recovery, cancel, dismissal, folder reselection, scans, and plan review MUST NOT modify the selected tree. Where a plan is required, confirmation MUST submit its displayed identity; project creation and navigation occur only after its transaction commits. Ordinary non-BIDS DICOM creation with none of the above indicators SHALL instead use the normal single-project-file creation path after explicit confirmation, without preflight or a plan identity; activation and navigation MUST wait for successful creation.

#### Scenario: BIDS folder picked → user chooses BIDS-direct

- **WHEN** user picks ds000240, selects "Skip Import", reviews a current conflict-free mutation plan, and confirms it
- **THEN** exactly the displayed BIDS-direct project mutations SHALL commit before navigation to `/project/:id/import` and `BIDSReviewPanel` rendering

#### Scenario: BIDS folder picked → user chooses DICOM anyway

- **WHEN** user picks a BIDS folder, selects "Import from DICOM", reviews its current conflict-free mutation plan, and confirms it
- **THEN** exactly the displayed DICOM project mutations SHALL commit before navigation to the DICOM import wizard, without applying BIDS-direct-only compatibility mutations

#### Scenario: Import option changes

- **WHEN** the user reviews the BIDS-direct plan and then selects DICOM import
- **THEN** confirmation SHALL remain unavailable until a DICOM-specific plan is displayed and SHALL never submit the superseded BIDS-direct plan

#### Scenario: Non-BIDS folder picked → error, retry

- **WHEN** `check_bids_dataset` finds no BIDS subjects and the user chooses another folder or cancels
- **THEN** no project SHALL be created and the inspected source tree SHALL remain unchanged

#### Scenario: Ordinary non-BIDS folder picked → direct DICOM creation

- **WHEN** detection reports no BIDS subjects, no BIDS ASL data, no dataset description, and no description error, and the user confirms DICOM import
- **THEN** the GUI SHALL create `project.easl` through the normal creation path without requesting a mutation plan and SHALL activate and navigate only after creation succeeds

#### Scenario: Corrupt dataset_description but ASL present → user proceeds anyway

- **WHEN** valid ASL subjects accompany a corrupt `dataset_description.json` and the user reviews the warning and current BIDS-direct mutation plan
- **THEN** confirmation SHALL commit exactly that plan before project activation, while cancellation SHALL leave the source tree unchanged
