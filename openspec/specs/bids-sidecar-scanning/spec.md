# bids-sidecar-scanning Specification

## Purpose
TBD - created by archiving change direct-bids-import. Update Purpose after archive.
## Requirements
### Requirement: parse_bids_structure scans any path containing sub-* directories

`bids::scan::parse_bids_structure(bids_root: &Path) -> Result<Vec<BidsSubject>>` SHALL enumerate `sub-*/` directories at the top level of `bids_root`. It handles two layouts:

- Cross-sectional: `sub-XX/perf/`, `sub-XX/anat/` directly (no intermediate `ses-*/`)
- Longitudinal: `sub-XX/ses-YY/perf/`, `sub-XX/ses-YY/anat/`

The function is path-agnostic — it scans whatever path it receives. Callers pass the appropriate path:
- `check_bids_dataset` and `scan_bids_sidecars` pass project root (BIDS-direct, root-level scan)
- `list_subjects` (DICOM-import path) passes `project_root.join("rawdata")`

Non-`sub-` top-level entries (`derivatives/`, `sourcedata/`, `.easl_staging/`, `notes/`, `rawdata/` when scanning root) are skipped by virtue of the `sub-` prefix check.

#### Scenario: Cross-sectional scan defaults session to "1"

- **WHEN** `parse_bids_structure` scans ds000240 root where `sub-01/perf/sub-01_asl.nii.gz` exists with no `ses-*` directory
- **THEN** the returned `BidsSubject` for sub-01 has one `BidsSession` with `session_label = "1"`, `session_dir = None`, `has_explicit_session = false`

#### Scenario: Longitudinal scan preserves session label

- **WHEN** `parse_bids_structure` scans a subject with `ses-01/` and `ses-02/` directories
- **THEN** two `BidsSession` entries are returned with `session_label = "01"` and `"02"` respectively, `has_explicit_session = true`

#### Scenario: Explicit ses-1 remains explicit

- **WHEN** `parse_bids_structure` scans a subject with only `ses-1/perf/` (no cross-sectional default)
- **THEN** one `BidsSession` is returned with `session_label = "1"` and `has_explicit_session = true` (explicitness is stored separately from the default cross-sectional label `"1"`)

#### Scenario: Subject-level anat inherited by session-level perf

- **WHEN** `parse_bids_structure` scans `sub-01/anat/sub-01_T1w.nii.gz` and `sub-01/ses-01/perf/sub-01_ses-01_asl.nii.gz`
- **THEN** the `ses-01` session has `has_anat = true` and `anat_files` populated from subject-level `anat/` even though `ses-01/anat/` is absent

#### Scenario: Mixed root perf and ses dirs uses session dirs only

- **WHEN** `parse_bids_structure` scans a subject with both `sub-01/perf/` and `sub-01/ses-01/perf/`
- **THEN** only `ses-01` is scanned; root-level `perf/` is ignored when any `ses-*` directory exists (BIDS convention: session hierarchy takes precedence)

#### Scenario: Non-sub directories ignored

- **WHEN** `parse_bids_structure` scans a root containing `derivatives/`, `sourcedata/`, `notes/`, and `sub-01/`
- **THEN** only `sub-01/` is enumerated; the others are silently skipped

### Requirement: Run entity parsed from filenames

`BidsFile` struct SHALL include `entities: HashMap<String, String>` capturing BIDS filename entities (e.g., `sub`, `ses`, `run`, `acq`). `BidsSession.asl_files` SHALL be `Vec<AslFile>` where `AslFile` carries the path plus `run_label: Option<String>` and `acquisition_label: Option<String>` parsed from the filename.

`SubjectInfo.asl_runs` (existing frontend contract) is populated from parsed `run-` entities. Missing `run-` entity → run label `"1"` (BIDS spec default for single-run).

#### Scenario: Single ASL file with no run entity

- **WHEN** `parse_bids_structure` scans a subject with `perf/sub-01_asl.nii.gz` (no `run-` entity)
- **THEN** the single `AslFile` has `run_label = None`, and downstream `SubjectInfo.asl_runs = ["1"]`

#### Scenario: Multiple ASL files with explicit run entities

- **WHEN** `parse_bids_structure` scans a subject with `perf/sub-01_run-1_asl.nii.gz` and `perf/sub-01_run-2_asl.nii.gz`
- **THEN** two `AslFile` entries have `run_label = Some("1")` and `Some("2")`; `SubjectInfo.asl_runs = ["1", "2"]` (sorted ascending)

### Requirement: find_asl_sidecars walks sub-*/ only

`bids::sidecar::find_asl_sidecars(bids_root: &Path) -> Vec<PathBuf>` SHALL iterate `std::fs::read_dir(bids_root)` and include only entries whose name starts with `"sub-"` and is a directory. Within each subject directory, the function walks into `perf/` directly (cross-sectional) and `ses-*/perf/` (longitudinal), collecting `*_asl.json` files.

Top-level directories not matching `sub-` (notably `derivatives/`, `sourcedata/`, `.easl_staging/`) are never traversed.

#### Scenario: Derivatives directory excluded

- **WHEN** `find_asl_sidecars` scans a root containing `sub-01/perf/sub-01_asl.json` and `derivatives/ExploreASL/sub-01_asl.json` (from prior processing)
- **THEN** only `sub-01/perf/sub-01_asl.json` is returned; `derivatives/` is skipped because it lacks the `sub-` prefix

#### Scenario: Both cross-sectional and longitudinal supported

- **WHEN** `find_asl_sidecars` scans a root containing `sub-01/perf/sub-01_asl.json` and `sub-02/ses-01/perf/sub-02_ses-01_asl.json`
- **THEN** both sidecars are returned

### Requirement: Sidecar extraction reads top-level keys only

`bids::sidecar::extract_fingerprint(sidecar: &serde_json::Value)` SHALL read fingerprint fields from the top-level key of the `*_asl.json` only. Nested objects — notably dcm2niiX's `global.const` block — are ignored. Keys absent at top-level are treated as null in the fingerprint (two subjects both missing the field → match).

#### Scenario: ds000240 sidecar top-level extraction

- **WHEN** `extract_fingerprint` reads `test/ds000240/sub-01/perf/sub-01_asl.json` which has `EchoTime: 0.0029` at top-level and `EchoTime: 10.03` inside `global.const`
- **THEN** the fingerprint's `EchoTime` value reflects `0.0029` (top-level); the `global.const` value is never consulted

### Requirement: Fingerprint number canonicalization

Fingerprint numeric fields SHALL be canonicalized as:
1. Extract value as `f64` regardless of int/float JSON representation
2. Round: `(value * 1000.0).round() / 1000.0`
3. Serialize for hashing via `format!("{:.3}", value)` — always 3 decimal places, string-form

`serde_json::to_string` MUST NOT be used for hash serialization of numbers (it renders `3` vs `3.0` vs `3.000` differently depending on int/float source).

#### Scenario: MagneticFieldStrength int vs float

- **WHEN** subject A's sidecar has `"MagneticFieldStrength": 3` (integer) and subject B's sidecar has `"MagneticFieldStrength": 3.0` (float)
- **THEN** both fingerprint hashes produce `"3.000"` and the subjects group together

### Requirement: Fingerprint array canonicalization sorts before hashing

Arrays of numbers in fingerprint fields SHALL be sorted ascending before hashing. Numbers within arrays: round to 3 decimals. Arrays of strings: sort ascending. Mixed-type arrays: serialize as-is (rare in ASL sidecars).

#### Scenario: Multi-PLD array order-independence

- **WHEN** subject A's sidecar has `"PostLabelingDelay": [1.0, 1.5, 2.0]` and subject B's sidecar has `"PostLabelingDelay": [2.0, 1.5, 1.0]` (same values, different order, from different conversion tools)
- **THEN** both arrays sort to `[1.000, 1.500, 2.000]` and the subjects group together

### Requirement: ASLContext excluded from fingerprint hash

`ASLContext` (parsed from `*_aslcontext.tsv` and injected into group `params`) SHALL NOT be part of `FINGERPRINT_FIELDS`. Two subjects with the same scanner/sequence parameters but different ASLContext layouts (e.g., 5 m0scans vs 100 m0scans) MUST group together.

The first subject's raw ASLContext string is stored in the group's `params.ASLContext` for display (BIDSReviewPanel + manifest §1).

#### Scenario: Same scanner, different ASLContext lengths group together

- **WHEN** subject A and subject B share all 15 fingerprint keys but A's `aslcontext.tsv` has 50 entries and B's has 100 entries
- **THEN** both subjects belong to the same fingerprint group; the group's `params.ASLContext` reflects subject A's raw string (first subject)

### Requirement: M0Type derived except sidecar's `"Estimate"` honored

`M0Type` SHALL be derived at scan time per these rules, in order:
1. If sidecar's `M0Type === "Estimate"` → return `"Estimate"` (trust sidecar; literature-derived M0 is not derivable from filesystem/ aslcontext)
2. Else if `perf/` contains `*_m0scan.nii.gz` → `"Separate"`
3. Else if `aslcontext.tsv` contains `m0scan` volume_type → `"Included"`
4. Else → `"Absent"`

The sidecar's `M0Type` values other than `"Estimate"` (including `"Integrated"` historically, `"Included"`, `"Separate"`, `"Absent"`, or missing field) are NOT trusted for fingerprinting — the derived value governs. Rationale: converter inconsistency for these values; `"Estimate"` is exceptional because it's a manual literature-derived setting with no filesystem signal.

#### Scenario: Sidecar says Estimate honored

- **WHEN** a subject's sidecar has `M0Type: "Estimate"`, no `*_m0scan.nii.gz` in `perf/`, no `m0scan` in `aslcontext.tsv`
- **THEN** derived `M0Type = "Estimate"` (sidecar trusted for this value)

#### Scenario: Separate M0 file present (sidecar value ignored)

- **WHEN** a subject's `perf/` directory contains `sub-XX_m0scan.nii.gz` alongside `sub-XX_asl.nii.gz`, and sidecar says `M0Type: "Included"`
- **THEN** derived `M0Type = "Separate"` (filesystem presence wins over sidecar's non-Estimate value)

#### Scenario: M0 volumes embedded in ASL4D

- **WHEN** a subject's `aslcontext.tsv` contains `m0scan` entries, no separate `*_m0scan.nii.gz` file, sidecar omits `M0Type`
- **THEN** derived `M0Type = "Included"` (matching ds000240's case)

#### Scenario: No M0 at all

- **WHEN** a subject's `aslcontext.tsv` contains only `control` and `label` entries, no `*_m0scan.nii.gz` file, sidecar has `M0Type: "Absent"`
- **THEN** derived `M0Type = "Absent"`

### Requirement: Missing or unparseable sidecars and aslcontext.tsv skip session

If `*_aslcontext.tsv` is missing or unparseable alongside a sidecar, or if **any** ASL file in a session lacks its companion `*_asl.json` sidecar or contains an unparseable sidecar file, the entire subject/session SHALL be added to `skippedSubjects[]` (and excluded from all fingerprint groups). The scan continues (non-fatal). The schema's `ASLContext` field stays `.optional()` because file-presence enforcement lives at the Rust scan layer.

`bids::sidecar::find_asl_context_for(sidecar_path: &Path) -> Option<PathBuf>` resolves `sub-XX_asl.json` → `sub-XX_aslcontext.tsv` (same directory, replace `_asl` with `_aslcontext`, `.json` with `.tsv`).

#### Scenario: Missing aslcontext.tsv

- **WHEN** `scan_bids_sidecars` processes subject sub-05 whose `perf/` has `sub-05_asl.nii.gz` and `sub-05_asl.json` but no `sub-05_aslcontext.tsv`
- **THEN** the subject/session `"sub-05_<session>"` is added to `skippedSubjects[]`; the scan continues; no other subjects are affected

#### Scenario: Partially missing sidecar file in multi-run session

- **WHEN** `scan_bids_sidecars` processes subject sub-06 whose `perf/` has two runs: `sub-06_run-1_asl.nii.gz` + `sub-06_run-1_asl.json` and `sub-06_run-2_asl.nii.gz` (lacking `sub-06_run-2_asl.json`)
- **THEN** the subject/session `"sub-06_<session>"` is added to `skippedSubjects[]` and excluded from any metadata groups; the scan continues

### Requirement: scan_bids_sidecars command returns typed SidecarGroup

`scan_bids_sidecars(root_path: String) -> Result<BidsSidecarScan, String>` SHALL call `parse_bids_structure` + `find_asl_sidecars` + `parse_sidecar` + `find_asl_context_for` + `parse_asl_context` + `inject_asl_context` + `extract_fingerprint` + `compute_group_hash` + `group_by_fingerprint` + `derive_vendor` + `derive_sequence` + `derive_labeling_type` + label auto-suggestion.

`SidecarGroup` SHALL have typed fields (not raw `serde_json::Value`):
- `fingerprint_hash: String`
- `label: String` — auto-suggested, computed by Rust per the label algorithm
- `vendor: String` — `derive_vendor()` output
- `sequence: String` — `derive_sequence()` output
- `labeling_type: String` — `derive_labeling_type()` output
- `bids_params: BidsAslMetadata` — typed struct mirroring TS `BidsAslMetadataBaseSchema` with `serde(rename_all = "camelCase")`
- `subjects: Vec<GroupSubject>` where `GroupSubject { subject_label: String, session_labels: Vec<String> }`. When multiple sidecars for the same subject/session are grouped together, `group_by_fingerprint` MUST merge them into one `GroupSubject` with accumulated `session_labels` (deduplicated, sorted).

`BidsSidecarScan { groups: Vec<SidecarGroup>, skipped: Vec<String> }`.

#### Scenario: Multi-run same session in one group

- **WHEN** `scan_bids_sidecars` processes `sub-01/perf/sub-01_run-1_asl.json` and `sub-01/perf/sub-01_run-2_asl.json` with identical fingerprint parameters
- **THEN** both runs group together; `GroupSubject` for `sub-01` has one entry with `session_labels = ["1"]`

#### Scenario: Multi-run same session in different groups warns at review

- **WHEN** two ASL runs in the same session have different fingerprint hashes (different acquisition parameters)
- **THEN** the subject/session appears in two groups; `BIDSReviewPanel` shows both group memberships (v1: user resolves by confirming both groups; subject gets two `SubjectRow` entries with different `groupId`)

`skipped` entries use the session convention (`sub-XX_<session>`).

#### Scenario: ds000240 single-group scan

- **WHEN** `scan_bids_sidecars` scans ds000240 (25 homogeneous Siemens Prisma subjects)
- **THEN** `groups.len() == 1`, `groups[0].subjects.len() == 25`, `groups[0].label == "Siemens_3T_PCASL_3D_Included"`, `groups[0].vendor == "Siemens"`, `skipped == []` (assuming all sidecars have matching `aslcontext.tsv`)

#### Scenario: Multi-vendor dataset produces multiple groups

- **WHEN** `scan_bids_sidecars` scans a dataset with 10 Philips subjects and 15 Siemens subjects, all distinct on fingerprint fields
- **THEN** `groups.len() == 2`; Philips group has 10 subjects; Siemens group has 15 subjects

### Requirement: Label auto-suggestion algorithm

Rust `vendor.rs` SHALL compute auto-suggested labels using the pattern:

```
label = "{Manufacturer}_{MagneticFieldStrength}T_{ArterialSpinLabelingType}_{MRAcquisitionType}_{M0Type}"
```

- `Manufacturer`: canonical vendor name from substring detection (`"Siemens"`, `"Philips"`, `"GE_product"`)
- `FieldStrength`: `MagneticFieldStrength` formatted as integer (e.g., `3` → `"3T"`, `1.5` → `"1.5T"`)
- `ArterialSpinLabelingType`: as-is (`"PCASL"`, `"PASL"`, `"CASL"`)
- `MRAcquisitionType`: `"2D"` or `"3D"`
- `M0Type`: derived value per D8 (`"Separate"`, `"Included"`, `"Absent"`, or sidecar-honored `"Estimate"`)

Missing component → omit the slot (no `"Unknown"` placeholder).

Collision resolution: when multiple groups produce the same label, suffix `_(2)` is applied to the second group onward. First retains unadorned label. Assignment deterministic: groups sorted by subject count (descending), tiebreak by sorted subject list head (alphabetical, ignoring directory scan order), tertiary tiebreak by full sorted subject list.

#### Scenario: ds000240 single-group label

- **WHEN** `scan_bids_sidecars` scans ds000240 (Siemens, MagneticFieldStrength=3, ArterialSpinLabelingType=PCASL, MRAcquisitionType=3D, derived M0Type=Included)
- **THEN** group label is `"Siemens_3T_PCASL_3D_Included"`

#### Scenario: Missing field omits label segment

- **WHEN** a group's sidecar lacks `MagneticFieldStrength` and `M0Type`, with `Manufacturer=Philips`, `ArterialSpinLabelingType=PCASL`, `MRAcquisitionType=2D`
- **THEN** group label is `"Philips_PCASL_2D"` (no `FieldStrengthT_` or `_{M0Type}` segments)

#### Scenario: Collision suffix assignment

- **WHEN** three fingerprint groups all would produce `Siemens_3T_PASL_3D_Absent`, with subject counts 10, 10, 5 (two tied at 10)
- **THEN** the group with the alphabetically-first subject (of the two tied) gets unadorned label; the other tied group gets `Siemens_3T_PASL_3D_Absent_(2)`; the smallest group gets `Siemens_3T_PASL_3D_Absent_(3)`

### Requirement: Vendor derivation uses substring matching with fuzzy fallback

`bids::vendor::derive_vendor(manufacturer: Option<&str>) -> String` and fingerprint normalization SHALL perform case-insensitive substring matching:
- Contains `"siemens"` → `"Siemens"`
- Contains `"philips"` → `"Philips"`
- Contains `"ge"` → `"GE_product"`
- **Fallback:** If substring matching fails, a token-based Jaro-Winkler fuzzy match (threshold `0.8`) is performed against the target names.
- No match → `"UnknownVendor"` / `None`

### Requirement: Sequence derivation cleans duplicate prefixes

`derive_sequence(acq_type: Option<&str>, pulse_seq: Option<&str>)` returns sequence name by joining present segments, defaulting to `"UnknownSequence"` if both are missing.
- When both `acq_type` and `pulse_seq` are present, it SHALL strip any duplicate `acq_type` prefix from the start of `pulse_seq` (supporting both `_` and `-` separators) before joining (e.g. `3D` + `3D_SPIRAL` or `3D` + `3d-spiral` maps to `"3D_spiral"` rather than `"3D_3D_SPIRAL"`).
- Pulse sequence type fingerprint normalization SHALL also use a Jaro-Winkler fuzzy fallback (threshold `0.8`) against target sequence keywords (`"epi"`, `"ep2d"`, `"epfid"`, `"pepolar"`, `"grase"`, `"tgse"`, `"spiral"`) to correctly identify misspelled sequences like `"3D_SPRIAL"`.

### Requirement: Labeling type derivation supports three main strategies

`derive_labeling_type(asl_type: Option<&str>)` and TS `deriveInjectedFields` SHALL derive the labeling type as:
- `"PCASL"` → `"PCASL"`
- `"CASL"` → `"CASL"`
- `"PASL"` → `"PASL"`
- Else → `"UnknownLabelingType"`

#### Scenario: Siemens with extra detail

- **WHEN** `derive_vendor("SIEMENS TrioTim")` is called
- **THEN** returns `"Siemens"` (case-insensitive, substring match)

#### Scenario: GE longhand

- **WHEN** `derive_vendor("GE MEDICAL SYSTEMS")` is called
- **THEN** returns `"GE_product"`

#### Scenario: Unrecognized vendor

- **WHEN** `derive_vendor("Canon Medical Systems")` is called
- **THEN** returns `"UnknownVendor"`

