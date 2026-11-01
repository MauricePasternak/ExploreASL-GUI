# bids-sidecar-scanning Specification

## Purpose

Define scanning and interpretation of BIDS ASL sidecar metadata.

## Requirements

### Requirement: parse_bids_structure scans any path containing sub-\* directories

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

`BidsSession.asl_files` SHALL be `Vec<AslFile>` where `AslFile` carries the path plus `run_label: Option<String>` and `acquisition_label: Option<String>` parsed from the filename.

`SubjectInfo.asl_runs` (existing frontend contract) is populated from parsed `run-` entities. Missing `run-` entity → run label `"1"` (BIDS spec default for single-run).

#### Scenario: Single ASL file with no run entity

- **WHEN** `parse_bids_structure` scans a subject with `perf/sub-01_asl.nii.gz` (no `run-` entity)
- **THEN** the single `AslFile` has `run_label = None`, and downstream `SubjectInfo.asl_runs = ["1"]`

#### Scenario: Multiple ASL files with explicit run entities

- **WHEN** `parse_bids_structure` scans a subject with `perf/sub-01_run-1_asl.nii.gz` and `perf/sub-01_run-2_asl.nii.gz`
- **THEN** two `AslFile` entries have `run_label = Some("1")` and `Some("2")`; `SubjectInfo.asl_runs = ["1", "2"]` (sorted ascending)

### Requirement: Image-owned metadata discovery

`discover_metadata` SHALL resolve metadata separately for each ASL image by inspecting its directory and ancestors through the selected root. Applicable `_asl.json` and `_aslcontext.tsv` filenames have matching entity pairs that are a subset of the image's entities. More than one applicable file of either type at one level is an error. JSON files are merged root-to-image, with nearer top-level values replacing earlier values; context uses the nearest applicable file.

Subject discovery does not traverse unrelated top-level directories such as `derivatives/` or `sourcedata/`.

#### Scenario: Derivatives directory excluded

- **WHEN** discovery resolves `sub-01/perf/sub-01_asl.nii.gz` and an unrelated sidecar exists under `derivatives/`
- **THEN** the derivatives sidecar is not applicable

#### Scenario: Both cross-sectional and longitudinal supported

- **WHEN** discovery resolves cross-sectional and longitudinal ASL images
- **THEN** each image uses applicable metadata from its own ancestor chain

### Requirement: Sidecar extraction reads top-level keys only

`bids::sidecar::extract_fingerprint(sidecar: &serde_json::Value)` SHALL read top-level keys of the effective inherited JSON. Nested objects — notably dcm2niiX's `global.const` block — are ignored. Keys absent at top-level are treated as null in the fingerprint (two subjects both missing the field → match).

Fingerprint fields SHALL include every sidecar field projected into `BidsAslMetadata`, except `ASLContext` (handled separately below), plus `ManufacturersModelName`. In addition to the original 15 fields, this includes `PCASLType`, `CASLType`, `LabelingPulseAverageGradient`, `LabelingPulseMaximumGradient`, `LabelingPulseAverageB1`, `LabelingPulseDuration`, `LabelingPulseInterval`, `BolusCutOffFlag`, `BackgroundSuppressionPulseTime`, `VascularCrushing`, `FlipAngle`, `SliceTiming`, `M0_GMScaleFactor`, `DatasetType`, `LabelingType`, `DummyScanPositionInASL4D`, and `RepetitionTimePreparationM0`. Derived `M0Type` overrides the raw sidecar value as specified below.

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

### Requirement: Fingerprint array canonicalization preserves acquisition order

Arrays in fingerprint fields SHALL preserve their original order and multiplicity before hashing. Numbers within numeric arrays SHALL retain the scalar three-decimal canonicalization rule. String and mixed-type arrays SHALL remain in their original order. Sorting timing arrays is forbidden: equal sets of timing values do not establish equal volume- or slice-indexed acquisitions.

#### Scenario: Reordered multi-PLD acquisitions remain distinct

- **WHEN** subject A's sidecar has `"PostLabelingDelay": [1.0, 1.5, 2.0]` and subject B's sidecar has `"PostLabelingDelay": [2.0, 1.5, 1.0]`
- **THEN** their fingerprint hashes differ; the acquisitions SHALL NOT collapse into one group solely because their timing values form the same set

### Requirement: Group metadata does not assert differing member values

Group `bids_params` SHALL project only raw sidecar values present and equal across every contributing acquisition. If rounding or descriptive normalization allows differing raw values into one fingerprint group, the differing sidecar fields SHALL be omitted rather than copied from the first acquisition. Derived `M0Type` remains the common derived value; parsed `ASLContext` SHALL likewise be projected only when equal across every contributing acquisition. Fingerprint equality is a grouping rule, not evidence of scientific or numerical equivalence.

Before fingerprinting and common-value projection, each acquisition's projected metadata SHALL pass the existing native typed metadata parsing and domain validation, including context tokens, positive M0 scale, conditional suppression pulse count, and timing ranges. Invalid acquisition metadata SHALL fail the review scan rather than disappear through projection or produce confirmable partial results. Validation SHALL normalize a copy of only the frontend's existing comma-number and comma-array fields (trim strings, ignore empty comma parts, omit empty values, unwrap a single number only for scalar-or-array fields); scanned raw values SHALL remain unchanged. This SHALL NOT introduce a second set of scientific range rules.

#### Scenario: Rounded fingerprint match does not imply a shared exact echo time

- **WHEN** two acquisitions have `EchoTime` values `0.0141` and `0.0142`, with all other fingerprint values equal
- **THEN** the existing three-decimal fingerprint rule groups them together, but group `bids_params.EchoTime` SHALL be absent rather than asserting either exact value for both acquisitions

#### Scenario: Different projected slice timing separates acquisition groups

- **WHEN** two runs in one subject/session have different canonicalized `SliceTiming`, including present versus absent timing
- **THEN** their fingerprint hashes differ and the existing conflicting subject/session confirmation rule applies; no run-level mapping is inferred

### Requirement: ASLContext excluded from fingerprint hash

`ASLContext` (parsed from `*_aslcontext.tsv` and injected into group `params`) SHALL NOT be part of `FINGERPRINT_FIELDS`. Two subjects with the same scanner/sequence parameters but different ASLContext layouts (e.g., 5 m0scans vs 100 m0scans) MUST group together.

The parsed raw ASLContext string SHALL be stored in the group's `params.ASLContext` for display (BIDSReviewPanel + manifest §1) only when every contributing acquisition has the same context string. If any contributing contexts differ, the group field SHALL be omitted rather than copying one acquisition's context. This projection SHALL NOT change fingerprint membership, per-acquisition M0Type derivation, or skip behavior.

#### Scenario: Same scanner, different ASLContext lengths group together

- **WHEN** subject A and subject B share all fingerprint keys but A's `aslcontext.tsv` has 50 entries and B's has 100 entries
- **THEN** both subjects belong to the same fingerprint group; the group's `params.ASLContext` SHALL be absent because the contexts differ

### Requirement: M0Type derived except sidecar's `"Estimate"` honored

`M0Type` SHALL be derived at scan time per these rules, in order:

1. If sidecar's `M0Type === "Estimate"` → return `"Estimate"` (trust sidecar; literature-derived M0 is not derivable from filesystem/ aslcontext)
2. Else if `perf/` contains `*_m0scan.nii` or `*_m0scan.nii.gz` → `"Separate"`
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

### Requirement: Image metadata checks report skipped sessions

For sessions containing ASL NIfTIs, native scan SHALL resolve applicable JSON and context per image before grouping. Missing, ambiguous, unreadable, non-object, or invalid JSON, missing context, or association discovery errors skip the entire session. The scan continues; the frontend exposes `skipped` as `skippedSubjects`.

A context file that cannot be read as UTF-8 SHALL also cause a skipped entry without aborting the scan. Limitation: a context read failure encountered after earlier sidecars from that session have contributed group memberships does not remove those memberships; later sidecars from that session are omitted. A skipped identifier therefore does not always imply absence from every returned group.

Native context extraction SHALL discard the first line, trim the remaining rows, ignore blanks, and comma-join their trimmed first TSV columns. Extraction does not validate the header or token content. Before grouping, existing native metadata validation SHALL reject an empty context or tokens outside `control`, `label`, `m0scan`, and `deltam`. Readable malformed context SHALL fail the review scan rather than produce a per-session skipped entry or disappear through common-context projection.

#### Scenario: Missing aslcontext.tsv

- **WHEN** `scan_bids_sidecars` processes subject sub-05 whose `perf/` has `sub-05_asl.nii.gz` and `sub-05_asl.json` but no `sub-05_aslcontext.tsv`
- **THEN** the subject/session `"sub-05_<session>"` is added to `skippedSubjects[]`; the scan continues; no other subjects are affected

#### Scenario: Partially missing sidecar file in multi-run session

- **WHEN** `scan_bids_sidecars` processes two ASL NIfTI runs and only run 1 has applicable JSON, with no inherited JSON for run 2
- **THEN** the subject/session `"sub-06_<session>"` is added to `skippedSubjects[]` and excluded from any metadata groups; the scan continues

#### Scenario: Unrelated sidecar does not supply metadata

- **WHEN** a session has two ASL images and two JSON files, but one image has no applicable JSON and no inherited JSON
- **THEN** the scan SHALL skip that session regardless of the number of unrelated JSON files

#### Scenario: Readable malformed context is not a native skip

- **WHEN** an otherwise valid single-run session has context bytes `not_a_header\nunexpected\n`
- **THEN** existing native metadata validation SHALL fail the review scan with a context validation error before returning groups; the malformed value SHALL NOT be converted into an absent group field

#### Scenario: Later unreadable context leaves earlier membership

- **WHEN** one run contributes a group membership before another run's existing context path in the same session fails to read
- **THEN** the native scan SHALL report the session in `skipped[]`; the earlier membership remains and subsequent sidecars for that session are omitted

### Requirement: scan_bids_sidecars command returns typed SidecarGroup

`scan_bids_sidecars(root_path: String) -> Result<BidsSidecarScan, String>` SHALL discover subjects and sidecars, perform the session/context checks above, and group parsed sidecar metadata by fingerprint with derived vendor, sequence, labeling type, and suggested labels.

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

#### Scenario: Multi-run same session in different groups cannot be confirmed together

- **WHEN** two ASL runs in the same session have different fingerprint hashes (different acquisition parameters)
- **THEN** the native scan SHALL return the subject/session in both groups and `BIDSReviewPanel` SHALL show both memberships; confirming both groups SHALL be rejected because one subject/session cannot map to different group IDs, even with unique labels

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

- **WHEN** a group's sidecar lacks `MagneticFieldStrength`, with `Manufacturer=Philips`, `ArterialSpinLabelingType=PCASL`, `MRAcquisitionType=2D`, and derived `M0Type=Absent`
- **THEN** group label is `"Philips_PCASL_2D_Absent"` (no field-strength segment)

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

#### Scenario: Misspelled manufacturer uses fuzzy fallback

- **WHEN** a manufacturer value does not contain a target name but fuzzy-matches one at threshold `0.8`
- **THEN** vendor derivation returns that target vendor name

### Requirement: Sequence derivation cleans duplicate prefixes

`derive_sequence(acq_type: Option<&str>, pulse_seq: Option<&str>)` returns sequence name by joining present segments, defaulting to `"UnknownSequence"` if both are missing.

- When both `acq_type` and `pulse_seq` are present, it SHALL strip any duplicate `acq_type` prefix from the start of `pulse_seq` (supporting `_`, `-`, or no separator) before joining, preserving the remaining pulse string's case.
- Pulse sequence type fingerprint normalization SHALL also use a Jaro-Winkler fuzzy fallback (threshold `0.8`) against target sequence keywords (`"epi"`, `"ep2d"`, `"epfid"`, `"pepolar"`, `"grase"`, `"tgse"`, `"spiral"`) to correctly identify misspelled sequences like `"3D_SPRIAL"`.

#### Scenario: Duplicate acquisition prefix is removed

- **WHEN** `derive_sequence` receives `acq_type` `"3D"` and `pulse_seq` `"3D_SPIRAL"`
- **THEN** it returns `"3D_SPIRAL"` without a duplicate prefix; group construction normalizes the pulse sequence before calling this function

### Requirement: Labeling type derivation supports three main strategies

`derive_labeling_type(asl_type: Option<&str>)` SHALL derive the labeling type as:

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
