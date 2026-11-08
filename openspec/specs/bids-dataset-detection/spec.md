# bids-dataset-detection Specification

## Purpose

Define detection and validation of BIDS ASL datasets before direct import.

## Requirements

### Requirement: check_bids_dataset command validates folder as BIDS ASL source

`check_bids_dataset` SHALL detect usable BIDS ASL structure and applicable metadata presence, returning typed counts, layout information, and actionable detection errors without parsing ASL sidecar contents.

#### Scenario: Candidate folder is inspected for usable BIDS ASL structure

- **WHEN** `check_bids_dataset` receives a candidate root
- **THEN** detection and the returned result SHALL satisfy this algorithm and field contract:

The Rust command `check_bids_dataset(root_path: String) -> BidsCheckResult` SHALL scan the provided folder for BIDS structure and ASL content. It does NOT parse sidecar JSON; it checks directory structure and sidecar presence only.

Algorithm:

1. Check whether `dataset_description.json` exists at `<root_path>`. If present, parse JSON to extract `BIDSVersion`. Parse failure is non-fatal; populate `dataset_desc_error`.
2. Call `parse_bids_structure(root_path)` to enumerate `sub-*/` subjects and their sessions.
3. For each subject/session containing ASL NIfTI files, discover applicable ASL JSON metadata per image, including inherited files as described in `bids-sidecar-scanning`. If every image has at least one applicable JSON file, increment `asl_session_count` once; if the subject has at least one such session, increment `asl_subject_count`. Context presence and readability do NOT determine detection validity.
4. If any image in a session lacks applicable JSON, add its subject/session identifier to `missing_sidecars` (`sub-XX_<session>`). Sessions without ASL NIfTIs are NOT added. For each image with applicable JSON, increment `missing_aslcontext_count` if no applicable context path exists. This count is per image, not per session; unreadable existing context is not counted. Missing context does NOT block `is_bids`. Discovery errors, including ambiguous associations, fail detection.
5. `is_bids = asl_subject_count >= 1`. `dataset_description.json` presence is informational — NOT a gate on `is_bids`.
6. `is_cross_sectional = true` unless at least one subject has more than one explicit `ses-*` directory with usable BIDS content (`perf/` or `anat/`). Datasets with no `ses-*`, or exactly one explicit session per subject, are cross-sectional for GUI purposes. A single subject with `ses-01/` and `ses-02/` makes the dataset longitudinal (`is_cross_sectional = false`).
7. If `!is_bids`, set `error` with a specific reason.

Result `BidsCheckResult` fields: `setup_recovered: usize`, `is_bids: bool`, `has_dataset_description: bool`, `dataset_desc_error: Option<String>`, `bids_version: Option<String>`, `asl_subject_count: u32`, `asl_session_count: u32`, `total_subject_count: u32`, `missing_sidecars: Vec<String>`, `missing_aslcontext_count: u32`, `has_perf_directory: bool`, `is_cross_sectional: bool`, `error: Option<String>`.

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

New-project folder selection SHALL always lead to explicit import setup confirmation, with detection-specific choices and a current reviewed mutation plan where required; creation SHALL precede activation and navigation.

#### Scenario: Detection determines setup choices and reviewed creation

- **WHEN** the new-project folder picker returns a path
- **THEN** dialog choices, mutation-plan review, cancellation, and creation SHALL follow these rules:

After the folder picker returns a path, `LandingPage.handleNewProject()` MUST invoke `check_bids_dataset` for read-only detection after any separately disclosed prior-setup recovery. Based on the result, a unified project import setup modal MUST always be shown:

- `error == null && is_bids` → show dialog: "Use this existing ASL dataset?" with both "Use existing BIDS images — Recommended" and "Import original scanner files (DICOM)" enabled, without automatically selecting either. Display the selected folder name, `asl_subject_count` as participants, and `asl_session_count` as imaging sessions, with singular/plural wording. Do not display the redundant "Cross-sectional: Yes/No" field. When `missing_aslcontext_count > 0`, show a non-blocking warning that this many ASL runs lack label/control information (`*_aslcontext.tsv`) and affected participant sessions will be excluded from BIDS review. This is a per-ASL-file/run count, never a count of distinct excluded sessions.
- `is_bids == false && asl_subject_count == 0 && total_subject_count == 0` → show dialog: "Set up a DICOM import" with BIDS option disabled and DICOM enabled/auto-selected. Explain that no existing BIDS ASL dataset was found and offer original scanner files or another BIDS folder.
- `is_bids == false && asl_subject_count == 0 && total_subject_count > 0` → show dialog: "No usable BIDS ASL images found" with BIDS option disabled and DICOM enabled/auto-selected. Explain that participant folders were found but ASL images with required scan information were not detected; offer another BIDS folder or DICOM import.
- `dataset_desc_error != null && asl_subject_count >= 1` → show dialog: "Dataset information needs attention" with both options enabled. Show a visible warning that `dataset_description.json` could not be read, ASL images were found, and continuing to scan review does not repair the file. Do not recommend the BIDS option without qualification.

When detection reports `is_bids = true`, `total_subject_count > 0`, `has_dataset_description = true`, or non-null `dataset_desc_error`, the modal MUST obtain and present the read-only mutation plan for the currently selected import option before enabling `[Create project]`. Present a plain-language overview by default and expose every applicable `create`, `update`, and `no-op` operation for `project.easl`, `.bidsignore`, and any data-source-specific directory under an initially collapsed "Technical details: planned file changes" disclosure. Warnings, conflicts, loading, and inspection errors MUST remain outside the disclosure. A blocking conflict or unavailable plan MUST disable confirmation. Changing the import option MUST replace the displayed plan rather than reusing a plan for another data source.

In all cases, the dialog features `[Create project]` (enabled only when an option is selected and, where required, has a current conflict-free plan), `[Choose another folder]`, and `[Cancel]`. After any disclosed prior-setup recovery, cancel, dismissal, folder reselection, scans, and plan review MUST NOT modify the selected tree. Where a plan is required, confirmation MUST submit its displayed identity; project creation and navigation occur only after its transaction commits. Ordinary non-BIDS DICOM creation with none of the above indicators SHALL instead use the normal single-project-file creation path after explicit confirmation, without preflight or a plan identity; activation and navigation MUST wait for successful creation.

#### Scenario: BIDS folder picked → user chooses BIDS-direct

- **WHEN** user picks ds000240, selects "Use existing BIDS images", reviews a current conflict-free mutation plan, and selects "Create project"
- **THEN** exactly the displayed BIDS-direct project mutations SHALL commit before navigation to `/project/:id/import` and `BIDSReviewPanel` rendering

#### Scenario: BIDS folder picked → user chooses DICOM anyway

- **WHEN** user picks a BIDS folder, selects "Import original scanner files (DICOM)", reviews its current conflict-free mutation plan, and selects "Create project"
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

### Requirement: Dataset setup uses accessible, non-technical language

Dataset setup SHALL explain import choices and planned changes in accessible language within a responsive, readable dialog, distinguishing new mutations from disclosed prior recovery.

#### Scenario: Setup choices and technical details are displayed

- **WHEN** a user reviews dataset setup on a desktop or narrow window
- **THEN** layout, choice descriptions, and mutation notices SHALL satisfy these rules:

The modal SHALL use a desktop width of approximately 720 CSS pixels, constrained to the available viewport on smaller windows. Body and option descriptions SHALL use readable text rather than extra-small technical captions. Long folder names, paths, hashes, and text previews SHALL wrap without horizontal overflow; actions SHALL wrap on narrow windows and remain reachable when technical details are expanded.

The BIDS option SHALL explain that existing images are used without DICOM conversion and scan information is reviewed before processing settings. The DICOM option SHALL explain that original scanner files are selected next and conversion does not start in this dialog. Neither choice nor confirmation SHALL use "Skip Import". A visible "What will change?" summary SHALL explain project settings/support files and preservation of existing images and documentation during setup. A notice SHALL state that nothing changes until "Create project" is selected. This notice concerns new setup mutations, not separately disclosed prior-setup recovery.

#### Scenario: Researcher opens the Oxford single-PLD dataset

- **WHEN** detection finds one ASL participant and one imaging session in `test_Oxford_ASL_singlePLD`
- **THEN** the dialog SHALL show the folder name and "1 participant · 1 imaging session", explain both choices, and leave confirmation unavailable until a choice and required plan are ready

#### Scenario: Exact details remain accessible without hiding problems

- **WHEN** a setup plan is presented with its technical disclosure collapsed
- **THEN** warnings and conflicts SHALL remain visible, and expanding the keyboard-accessible disclosure SHALL reveal the canonical folder, project summary, every operation, exact text previews, preservation notice, and temporary-artifact disclosure
