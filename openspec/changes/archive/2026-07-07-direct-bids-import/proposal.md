## Why

Users with pre-existing BIDS datasets must currently run the 6-step DICOM import wizard designed for raw DICOM tokenizing, aliasing, and studyPar.json assembly. For already-BIDS-formatted data these steps are redundant but downstream modules (processing, manifest) still depend on `mappingState.metadataGroups[]` and `subjectRows[]`. A "BIDS-direct" path reverse-derives these structures from existing BIDS JSON sidecars, bypassing the full DICOM import pipeline.

## What Changes

- **BREAKING**: `projectMeta.dataSource` becomes a required field (`"dicom" | "bids"`), set at creation, immutable for project lifetime. No default fallback — existing `.easl` files must be regenerated (pre-release, no migration).
- **BREAKING**: `BidsAslMetadataBaseSchema.PulseSequenceType` and `.Manufacturer` change from strict zod enums to Zod transforms with substring matching + canonical emission (per ExploreASL `regexpi` pattern). Loose inputs (`"3D_SPIRAL"`, `"SIEMENS"`) normalized to canonical (`"spiral"`, `"Siemens"`); unrecognized → `undefined`.
- **BREAKING**: `ImportUiState` gains required `bidsReviewConfirmed: boolean` and `skippedSubjects: string[]` fields.
- New `BidsReviewState` slice in `importStore` for scan lifecycle (`scanComplete`, `scanError`, `detectedGroups`, `retryBidsScan`, `backToLanding`).
- New `DerivedMetadataGroup` schema extending `MetadataGroup` with display-only `vendor`, `sequence`, `labelingType`, `subjects` fields; projects down to `MetadataGroup` + `SubjectRow[]` on confirm.
- `canAccessPhase()` dispatches processing gate on `dataSource`: BIDS path checks `bidsReviewConfirmed === true`, DICOM path keeps existing `completed === true`.
- `createProject()` accepts `dataSource` parameter; sets `currentPhase: "import"` for both paths unconditionally.
- New Rust commands: `check_bids_dataset` (lightweight scan, no JSON parse), `scan_bids_sidecars` (full sidecar fingerprinting + grouping), `ensure_rawdata_dir` (creates empty `rawdata/` + README.md + `.bidsignore` entry, idempotent, warns if `rawdata/` non-empty with `sub-*/` entries).
- New Rust module `src-tauri/src/bids/` (folder): `path.rs`, `scan.rs`, `sidecar.rs`, `group.rs`, `vendor.rs`, `mod.rs`.
- Existing `list_subjects()` refactored to delegate to `bids::scan::parse_bids_structure()`; frontend `SubjectInfo` contract preserved.
- New frontend folder module `src/lib/bids/` with `path.ts`, `validation.ts`, `sidecar.ts`, `schema.ts`, `index.ts`. `bidsUtils.ts` migrated in.
- New `BIDSReviewPanel` component rendered inside `ImportPage` conditional on `dataSource === "bids"`.
- LandingPage gains a confirmation dialog after folder pick when `check_bids_dataset` detects BIDS ASL subjects; user explicitly chooses "Skip Import" (BIDS-direct) or "Import from DICOM".
- Processing pipeline injects `x.opts.subjectFolder = rootPath` into `dataPar.json` when `dataSource === "bids"` (verified mechanism — ExploreASL's `bids.layout()` redirect).
- **BREAKING**: Cross-sectional subjects (no `ses-*` directory) default session label to `"1"` (not `"01"`) to match ExploreASL's `SessionID = '1'` synthesis in `xASL_init_SubjectList.m`. Explicit `ses-XX` preserves label after stripping `"ses-"` prefix.
- **BREAKING**: `dataset_description.json` no longer required for `is_bids` — relaxed to non-fatal warning when ASL subjects exist without it.
- **BREAKING**: Pre-existing `participants.tsv` at the root is never modified by GUI code. For BIDS-direct projects, if the root-level file contains a `site` column, these user-defined `site` values take precedence. The GUI reads the root-level `site` values and preserves/writes them to `derivatives/ExploreASL/participants.tsv` (never overwriting them with group labels, and never stripping the column even if site correction is disabled). The lookup matches root-level `participant_id` (e.g. `sub-01`) against the base subject label of the session record (e.g. `sub-01` matches `sub-01_1` and `sub-01_2`), assuming root-level `participants.tsv` always lists subjects at the subject level. Group labels are only filled in for subjects/sessions lacking a root-level `site` value when site correction is enabled. Persisted banner on `BIDSReviewPanel` informs the user of this.
- `M0Type` derived at scan time when sidecar doesn't say `"Estimate"`: `*_m0scan.nii.gz` presence → `"Separate"`; else `aslcontext.tsv` has `m0scan` → `"Included"`; else `"Absent"`. Sidecar's `M0Type: "Estimate"` is trusted (literature-derived M0 is not derivable from filesystem). Sidecar's other `M0Type` values are not trusted (converter inconsistency); derived value governs fingerprinting.
- Missing `aslcontext.tsv` → subject/session skipped (not fatal scan error).
- `find_asl_sidecars` walks only top-level `sub-*/` directories; excludes `derivatives/`, `sourcedata/`, `.easl_staging/`.
- ASLContext stored raw in `mappingState.bidsParams.ASLContext` (preserve data); displayed via `summarizeAslContext()` run-length summary in `BIDSReviewPanel` and manifest §1.
- Confirmed BIDS-direct projects can revisit Import, re-scan the BIDS source root, review regenerated groups/skips, and re-confirm to overwrite `mappingState.metadataGroups`, `mappingState.subjectRows`, `mappingState.ingestionComplete`, `mappingState.sourceDataPath`, `uiState.import.skippedSubjects`, and `uiState.import.bidsReviewConfirmed`.

## Capabilities

### New Capabilities

- `bids-direct-import`: Bypass DICOM import wizard for pre-existing BIDS datasets; scan sidecars, fingerprint metadata groups, user review/confirm, populate `mappingState` for downstream modules.
- `bids-dataset-detection`: Validate a folder as a BIDS dataset with ASL content at project creation; present confirmation dialog for user choice between BIDS-direct and DICOM import paths.
- `bids-sidecar-scanning`: Rust-side primitive for finding, reading, fingerprinting, and grouping BIDS `*_asl.json` sidecars across `sub-*/` trees with cross-sectional and longitudinal layouts.
- `bids-review-panel`: Frontend component rendering detected metadata groups with editable labels, per-subject lists, skipped-subject warnings, confirm flow, and revisit re-scan/re-confirm flow after initial confirmation.
- `exploreasl-rawdata-compat`: Create empty `rawdata/` directory + README.md + `.bidsignore` entry at processing startup to satisfy ExploreASL's `BIDS2Legacy` existence check; inject `x.opts.subjectFolder` override in `dataPar.json`.

### Modified Capabilities

- `import-store`: Add BIDS review slice (`scanComplete`, `scanError`, `detectedGroups`, `skippedSubjects`, `retryBidsScan`, `rescanConfirmedBidsProject`, `backToLanding`); drop redundant `confirmed` flag (read from `uiState.import.bidsReviewConfirmed`).
- `project-store`: `createProject()` accepts `dataSource` parameter, sets `currentPhase: "import"` unconditionally; strict immutability on `dataSource` (no runtime guard — trust callers + JSDoc).
- `import-execution`: `canAccessPhase()` dispatches processing gate on `dataSource`; ImportPage conditionally renders `BIDSReviewPanel` vs 6-step wizard.
- `processing-backend`: `list_subjects()` refactored to delegate to `bids::scan::parse_bids_structure(root.join("rawdata"))` preserving `SubjectInfo` contract; `startProcessing()` calls `ensure_rawdata_dir` before `run_pipeline` when `dataSource === "bids"`; `assembleDataPar()` injects `x.opts.subjectFolder = rootPath` for BIDS-direct.
- `metadata-grouping-ui`: `MetadataGroupSchema` extended via new `DerivedMetadataGroupSchema` (BIDS review display); `BidsAslMetadataBaseSchema` transforms for `PulseSequenceType` and `Manufacturer` (Zod transforms with ExploreASL `regexpi` pattern, canonical emission, `undefined` fallback).
- `manifest-preview-export`: `ManifestPreview.tsx` renders `summarizeAslContext()` for ASLContext display; existing `bidsParams` iteration continues to read raw sidecar fields (vendor/sequence/labelingType are review-panel display-only, not persisted in `mappingState`).
- `import-rerun`: BIDS-direct revisit supports persisted summary plus explicit re-scan/re-confirm against the BIDS source root; DICOM import rerun behavior remains unchanged.

## Impact

**Code:**

- `src/schemas/project.ts` — `ProjectMetaSchema` (required `dataSource`), `ImportUiStateSchema` (required `bidsReviewConfirmed`, `skippedSubjects`), `canAccessPhase()`, `DEFAULT_PROJECT_FILE`.
- `src/schemas/importSchemas.ts` — `BidsAslMetadataBaseSchema` Zod transforms for `PulseSequenceType`/`Manufacturer`; `DerivedMetadataGroupSchema` extending `MetadataGroupSchema`; `summarizeAslContext()` helper.
- `src/lib/bids/` — new folder module (path, validation, sidecar, schema, index).
- `src/stores/importStore.ts` — new BIDS review slice.
- `src/stores/projectStore.ts` — `createProject()` accepts `dataSource`; BIDS confirm projects down to `MetadataGroup`/`SubjectRow[]`.
- `src/components/import/BIDSReviewPanel.tsx` — new component.
- `src/pages/ImportPage.tsx` — conditional render on `dataSource`; BIDS-direct revisit routes into re-scan/re-confirm capable review panel.
- `src/pages/LandingPage.tsx` — `check_bids_dataset` call + confirmation/error dialogs.
- `src/components/manifest/ManifestPreview.tsx` — `summarizeAslContext()` call site.
- `src/lib/` — `bidsUtils.ts` migrated to `src/lib/bids/`.

**Rust:**

- `src-tauri/src/bids/` — new folder module (`mod.rs`, `path.rs`, `scan.rs`, `sidecar.rs`, `group.rs`, `vendor.rs`).
- `src-tauri/src/processing.rs` — `list_subjects()` refactored; `processing.rs::start_processing()` calls `ensure_rawdata_dir` when BIDS; `assembleDataPar` injects `subjectFolder`.
- `src-tauri/src/commands.rs` (or new file) — register new Tauri commands: `check_bids_dataset`, `scan_bids_sidecars`, `ensure_rawdata_dir`.
- `src-tauri/src/lib.rs` — register new module and commands.

**Dependencies:** No new crate dependencies. `serde_json` (existing) for sidecar parsing. SHA-256 via existing or stdlib.

**Testing:**

- Verified against `test/ds000240` (cross-sectional, Siemens Prisma 3T PCASL 3D, M0Type Included, 110 volumes — 10 m0scan + 50 label/control pairs).
- ds000240 sidecar post-normalization: `PulseSequenceType: "spiral"`, `M0Type: "Included"` (derived), `Manufacturer: "Siemens"`.
- Existing tests updated to set `dataSource` explicitly (no default). Schema/enum tests regenerated for transform behavior.

**External systems:**

- ExploreASL's `subjectFolder` mechanism verified against MATLAB source via prior investigation.
- BIDS 1.0.2 (ds000240's version) accepted; no minimum BIDSVersion check in v1.
