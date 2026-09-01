# BIDS-Direct Import Implementation Plan & Tasks

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add a BIDS-direct import path that bypasses the 6-step DICOM wizard for pre-existing BIDS datasets, reverse-deriving `metadataGroups` and `subjectRows` from BIDS `*_asl.json` sidecars so downstream modules work unchanged.

**Architecture:** Binary `dataSource` on `ProjectMeta` (immutable post-creation) routes between the existing DICOM wizard and a new `BIDSReviewPanel`. Rust-side `bids/` folder module handles directory scan + sidecar parse + fingerprint + group; typed payload returned to frontend. Processing injects `x.opts.subjectFolder` override in `dataPar.json` + empty `rawdata/` directory to satisfy ExploreASL's `BIDS2Legacy` module.

**Tech Stack:** Tauri 2, React 19, TS 6, Mantine 9, Zustand 5, Zod 4, Rust (serde_json,SHA-256), Vitest.

---

## Phase 1: Schema & Type Foundations

- [x] 1.1 Add `dataSource` to `ProjectMetaSchema` (required enum `"dicom" | "bids"`, no default)
  - [x] Update `DEFAULT_PROJECT_FILE` to include `dataSource: "dicom"` for new DICOM project fixtures
  - [x] Update all existing schema tests to explicitly set `dataSource` (pre-release breaking change — no migration)
  - [x] Add test: `createProject()` without `dataSource` throws validation error
  - File: `src/schemas/project.ts`
- [x] 1.2 Add `bidsReviewConfirmed: boolean` and `skippedSubjects: string[]` to `ImportUiStateSchema` (both required, default `false`/`[]`)
  - [x] Update `DEFAULT_PROJECT_FILE` and existing fixtures
  - File: `src/schemas/project.ts`
- [x] 1.3 Rewrite `canAccessPhase()` processing gate to dispatch on `dataSource` (pseudocode, see `specs/bids-direct-import/spec.md` requirement "Processing gate dispatches on dataSource" for exact branch logic)
  - [x] Update existing `canAccessPhase` tests: add fixtures for both `dataSource` values
  - [x] Test: BIDS project with `bidsReviewConfirmed=false` blocked from processing
  - [x] Test: BIDS project with `bidsReviewConfirmed=true` reaches processing
  - [x] Test: DICOM project keeps existing `completed` gate (unchanged)
  - File: `src/schemas/project.ts`
- [x] 1.4 Zod transform: `PulseSequenceType` in `BidsAslMetadataBaseSchema` (replace strict enum with `.string().transform(...)`)
  - [x] Transform rules: case-insensitive substring match (including variants like `ep2d`, `epfid`, `pepolar` → `"EPI"`; `grase`, `tgse` → `"GRASE"`; `spiral` → `"spiral"`); no match → `undefined`
  - [x] Place transform logic in `src/lib/bids/normalize.ts` (new file); consume from schema
  - [x] Update existing schema tests: `"3D_SPIRAL"` → `"spiral"`; `"unknown_readout"` → `undefined`
  - File: `src/schemas/importSchemas.ts`, `src/lib/bids/normalize.ts`
- [x] 1.5 Zod transform: `Manufacturer` in `BidsAslMetadataBaseSchema` (replace enum with `.string().transform(...)`)
  - [x] Transform rules: case-insensitive substring `siemens`→`"Siemens"`, `philips`→`"Philips"`, `ge`→`"GE_product"`; no match → `undefined`
  - [x] Update existing tests: `"SIEMENS TrioTim"` → `"Siemens"`, `"GE MEDICAL SYSTEMS"` → `"GE_product"`, `"Canon..."` → `undefined`
  - File: same as 1.4
- [x] 1.6 Replace `M0Type` enum value `"Included"` with `"Included"` throughout schema + tests + .refine rules + `validateBidsMetadataGroup`
  - [x] Find all `Included` occurrences; replace with `Included`
  - [x] Run `pnpm test` to catch any stale test assertions
  - File: `src/schemas/importSchemas.ts`, `src/schemas/importSchemas.test.ts`
- [x] 1.7 Add `DerivedMetadataGroupSchema` extending `MetadataGroupSchema` with display-only `vendor`, `sequence`, `labelingType`, `subjects`
  - [x] Type only — no runtime behavior yet
  - [x] Test: `DerivedMetadataGroupSchema.parse(complete fixture)` returns full shape
  - File: `src/schemas/importSchemas.ts`
- [x] 1.8 Add `summarizeAslContext(raw: string | undefined): string` helper
  - [x] Run-length encode adjacent identical tokens; format `"m0scan×10, label×50, control×50"`
  - [x] Undefined/empty → `""`
  - [x] Test: ds000240's 109-token raw → summarized; `summarizeAslContext(undefined)` → `""`
  - File: `src/lib/bids/sidecar.ts` (new module file)
- **Commit point:** `feat(schema): add dataSource, BIDS review state, Zod transforms, DerivedMetadataGroup`

## Phase 2: Frontend `src/lib/bids/` Folder Module

- [x] 2.1 Create `src/lib/bids/` folder module: `index.ts`, `path.ts`, `validation.ts`, `sidecar.ts`, `schema.ts`, `normalize.ts`
  - [x] `index.ts` re-exports all
  - [x] `path.ts`: `isBidsFilename`, `parseBidsEntities`, `isAslSuffix`, `isM0Suffix`, `isSubjectDir`, `isSessionDir` (refer to draft `09-shared-bids-validation.md` signatures; pseudocode, adjust to fit)
  - [x] `validation.ts`: migrate `isBidsProject`, `ensureBidsIgnore` from `bidsUtils.ts` (delete old file after migration)
  - [x] `schema.ts`: re-export `BidsAslMetadataSchema`, `BidsAslMetadataBaseSchema`, `MetadataGroup`, `SubjectRow`, `DerivedMetadataGroup` from `../../schemas/importSchemas`
  - [x] `sidecar.ts`: `validateBidsAslParams`, `extractFingerprint`, `deriveInjectedFields`, `parseAslContext`, `summarizeAslContext`
  - [x] Update import paths in `projectStore.ts`, etc. (replace `bidsUtils` imports with `lib/bids/validation`)
  - [x] Unit tests for migrated/added functions
- **Commit point:** `refactor(lib): migrate bidsUtils to src/lib/bids/ folder module`

## Phase 3: Rust `src-tauri/src/bids/` Folder Module

- [x] 3.1 Create `bids/mod.rs` and register in `lib.rs`
  - [x] `mod bids;` declaration + re-exports from `bids::{path, scan, sidecar, group, vendor}`
  - File: `src-tauri/src/bids/mod.rs`, `src-tauri/src/lib.rs`
- [x] 3.2 `bids/path.rs`: BIDS path parsing
  - [x] `struct BidsPath { root, subject, session, has_explicit_session, modalities }`
  - [x] `struct ModalityEntry { modality: String, files: Vec<BidsFile> }`
  - [x] `struct BidsFile { filename, suffix, extension, entities: HashMap<String,String> }`
  - [x] `parse_bids_filename(&str) -> Result<HashMap<String, String>>` — key-value pairs from `"sub-001_ses-01_run-2_asl.nii.gz"`
  - [x] `is_subject_dir(name: &str) -> bool` — starts with `"sub-"`
  - [x] `is_session_dir(name: &str) -> bool` — starts with `"ses-"`
  - [x] `resolve_sessions(subject_dir: &Path) -> Vec<String>` — returns explicit `ses-*` labels after stripping `"ses-"`; if no `ses-*` and `perf/` or `anat/` present directly, returns `vec!["1"]` (NOT `"01"`)
  - [x] Unit tests for cross-sectional default `"1"` vs explicit `ses-01` → `"01"` vs non-numeric `ses-baseline` → `"baseline"`
  - File: `src-tauri/src/bids/path.rs`
- [x] 3.3 `bids/scan.rs`: directory scanning
  - [x] `struct BidsSubject { subject_label: String, subject_dir: String, sessions: Vec<BidsSession> }`
  - [x] `struct BidsSession { session_label: String, session_dir: Option<String>, has_explicit_session: bool, has_perf, has_anat, asl_files: Vec<AslFile>, asl_sidecars: Vec<String>, has_m0: bool, anat_files: Vec<String> }`
  - [x] `struct AslFile { path: String, run_label: Option<String>, acquisition_label: Option<String> }`
  - [x] `parse_bids_structure(bids_root: &Path) -> Result<Vec<BidsSubject>>` — path-agnostic, scans `sub-*/` at top level, walks into `perf/` (cross-sectional) and `ses-*/perf/` (longitudinal)
  - [x] Unit tests: cross-sectional default; longitudinal preservation; non-sub dirs skipped
  - File: `src-tauri/src/bids/scan.rs`
- [x] 3.4 `bids/sidecar.rs`: sidecar reading
  - [x] `find_asl_sidecars(bids_root: &Path) -> Vec<PathBuf>` — iterate `read_dir(bids_root)`, include `sub-*/` dirs only, walk `perf/` and `ses-*/perf/`
  - [x] `parse_sidecar(path: &Path) -> Result<serde_json::Value>` — `serde_json::from_reader`
  - [x] `find_asl_context_for(sidecar_path: &Path) -> Option<PathBuf>` — stem.replace `"_asl"` → `"_aslcontext"`, `.json` → `.tsv`
  - [x] `parse_asl_context(path: &Path) -> Result<String>` — read TSV, skip header, comma-join `volume_type` values
  - [x] `inject_asl_context(sidecar_path: &Path, params: &mut serde_json::Map<String, Value>) -> Result<()>` — find + parse + insert `"ASLContext"` key
  - [x] `extract_fingerprint(sidecar: &Value) -> HashMap<String, Value>` — top-level keys only (no nested `global.const` recursion)
  - [x] `FINGERPRINT_FIELDS` const: 15 fields (see design D24)
  - [x] Number canonicalization: `format!("{:.3}", (n * 1000.0).round() / 1000.0)`
  - [x] Array canonicalization: sort ascending, round each to 3 decimals
  - [x] Unit tests: ds000240 top-level vs `global.const` extraction; number int-vs-float hash equality; array sort independence
  - File: `src-tauri/src/bids/sidecar.rs`
- [x] 3.5 `bids/group.rs`: fingerprint hashing + grouping
  - [x] `compute_group_hash(fingerprint: &HashMap<String, Value>) -> String` — deterministic SHA-256 over canonicalized key-value pairs (keys sorted alphabetically; values canonicalized per type rules)
  - [x] `struct GroupSubject { subject_label: String, session_labels: Vec<String> }`
  - [x] `struct SidecarGroup { fingerprint_hash, label, vendor, sequence, labeling_type, bids_params: BidsAslMetadata, subjects: Vec<GroupSubject> }` (serde rename_all camelCase)
  - [x] `struct BidsSidecarScan { groups: Vec<SidecarGroup>, skipped: Vec<String> }`
  - [x] `group_by_fingerprint(sidecar_paths: &[PathBuf], subjects: &[BidsSubject]) -> Result<BidsSidecarScan>` — iterate sidecars, parse, inject asl context, extract fingerprint, hash, group; skipped = subjects with perf but missing sidecar or missing aslcontext.tsv
  - [x] `skipped` entries use `"sub-XX_<session>"` format (per D2)
  - [x] Unit tests: single-group (ds000240 single-scanner scenario with mocked sidecars); multi-group (two distinct fingerprints); skipped (missing sidecar)
  - File: `src-tauri/src/bids/group.rs`
- [x] 3.6 `bids/vendor.rs`: vendor detection + derived fields + M0Type derivation + label auto-suggestion
  - [x] `derive_vendor(manufacturer: Option<&str>) -> String` — case-insensitive substring match (`"siemens"`/`"philips"`/`"ge"`); fallback `"UnknownVendor"`
  - [x] `derive_sequence(acq_type: Option<&str>, pulse_seq: Option<&str>) -> String` — `"{acq}_{pulse}"` with `Unknown*` fallbacks
  - [x] `derive_labeling_type(asl_type: Option<&str>) -> String` — `PCASL`/`CASL` → `"CASL"`; `PASL` → `"PASL"`; else `"UnknownLabelingType"`
  - [x] `derive_m0_type(perf_path: &Path, aslcontext: Option<&str>, sidecar_m0type: Option<&str>) -> String` — if sidecar's `M0Type === "Estimate"` → return `"Estimate"` (trust); else if `*_m0scan.nii.gz` present → `"Separate"`; else if aslcontext contains `"m0scan"` → `"Included"`; else `"Absent"`
  - [x] `suggest_label(group: &SidecarGroup-ish params) -> String` — pattern `"{Manufacturer}_{FieldStrength}T_{ArterialSpinLabelingType}_{MRAcquisitionType}_{M0Type}"`; omit missing segments
  - [x] Collision suffix: sort groups by subject count desc, tiebreak by sorted subject list head alphabetically, tertiary by full sorted subject list; suffix `_(2)`, `_(3)`, ...
  - [x] Unit tests: ds000240 single-group label `"Siemens_3T_PCASL_3D_Included"`; collision with 3 groups; missing-segment omission
  - File: `src-tauri/src/bids/vendor.rs`
- [x] 3.7 `BidsAslMetadata` Rust struct mirroring TS `BidsAslMetadataBaseSchema`
  - [x] `#[derive(Serialize, Deserialize)]` with `#[serde(rename_all = "PascalCase")]` (BIDS uses PascalCase; verify against existing `BidsAslMetadataBaseSchema` field names exactly)
  - [x] All fields `Option<T>` matching schema `.optional()` counterparts
  - File: `src-tauri/src/bids/sidecar.rs` or new `bids/schema.rs`
- **Commit point:** `feat(rust): add bids/ folder module (path, scan, sidecar, group, vendor)`

## Phase 4: Rust Commands & list_subjects Refactor

- [x] 4.1 Refactor `processing.rs::list_subjects()` to delegate to `bids::scan::parse_bids_structure`
  - [x] `list_subjects(project_root)` calls `parse_bids_structure(Path::new(&project_root).join("rawdata"))`
  - [x] Map `Vec<BidsSubject>` → `Vec<SubjectInfo>` preserving existing frontend contract (`subject_session`, `subject`, `session`, `has_structural`, `has_asl`, `asl_runs`)
  - [x] `asl_runs` populated from parsed `run-` entities (default `"1"` when missing); sorted ascending
  - [x] Run existing `processing_tests.rs::list_subjects_*` tests — expect no regression
  - File: `src-tauri/src/processing.rs`
- [x] 4.2 `check_bids_dataset` Tauri command
  - [x] `struct BidsCheckResult` per spec (is_bids, has_dataset_description, dataset_desc_error, bids_version, asl_subject_count, asl_session_count, total_subject_count, missing_sidecars, has_perf_directory, is_cross_sectional, error)
  - [x] Algorithm: parse_bids_structure(root_path); count subjects with `has_perf` and matching `*_asl.json` in same dir (no JSON parse); populate missing_sidecars
  - [x] `is_bids = asl_subject_count >= 1` (no `dataset_description.json` gate)
  - [x] `is_cross_sectional = true` unless at least one subject has more than one explicit `ses-*` directory with usable BIDS content
  - [x] Register in `main.rs`/`lib.rs` commands list
  - [x] Unit tests: valid ds000240 folder mock; corrupt dataset_description; no ASL subjects; missing dataset_description but ASL present
  - File: `src-tauri/src/bids_commands.rs`
- [x] 4.3 `scan_bids_sidecars` Tauri command
  - [x] Calls `parse_bids_structure` + `find_asl_sidecars` + `parse_sidecar` + `find_asl_context_for` + `inject_asl_context` + `extract_fingerprint` + `compute_group_hash` + `group_by_fingerprint` + `derive_vendor`/`derive_sequence`/`derive_labeling_type`/`derive_m0_type` + `suggest_label` + collision suffix
  - [x] Returns `BidsSidecarScan`
  - [x] Missing `aslcontext.tsv` → subject/session `skipped` (not fatal)
  - [x] Register
  - [x] Unit tests: ds000240 scan produces single group with 25 subjects and `label = "Siemens_3T_PCASL_3D_Included"`; missing aslcontext produces skipped entry
  - File: `src-tauri/src/bids_commands.rs`
- [x] 4.4 `ensure_rawdata_dir` Tauri command
  - [x] Algorithm per spec: create `rawdata/` if missing; write `rawdata/README.md` (idempotent overwrite); manage `.bidsignore` (create or append `rawdata/` line)
  - [x] If `rawdata/` exists and non-empty (contains `sub-*/` entries): return warning payload with count
  - [x] Register
  - [x] Unit tests: fresh creates rawdata + README + .bidsignore; idempotent re-run; existing non-empty returns warning; .bidsignore append when present but missing `rawdata/` line
  - File: `src-tauri/src/bids_commands.rs`
- **Commit point:** `feat(rust): add check_bids_dataset, scan_bids_sidecars, ensure_rawdata_dir commands`

## Phase 5: Frontend Stores

- [x] 5.1 `importStore.ts`: add BIDS review slice
  - [x] `interface BidsReviewState { scanComplete: boolean; scanError: string | null; detectedGroups: DerivedMetadataGroup[]; skippedSubjects: string[]; }` — NO `confirmed` field (read from `project.uiState.import.bidsReviewConfirmed`)
  - [x] Actions: `startBidsScan(rootPath)`, `setDetectedGroups(groups)`, `retryBidsScan()`, `backToLanding()`, `resetBidsReview()`
  - [x] `startBidsScan` invokes Tauri `scan_bids_sidecars`; on success populates `detectedGroups` + `skippedSubjects`; on error sets `scanError`
  - [x] `retryBidsScan` clears `scanError` and re-invokes
  - [x] `backToLanding` navigates to `"/"`
  - [x] Test: scan success/error; retry clears error; actions update state slice correctly
  - File: `src/stores/importStore.ts`
- [x] 5.1a Add confirmed-project BIDS re-scan action
  - [x] Add `rescanConfirmedBidsProject(rootPath)` or equivalent explicit action that reuses `scan_bids_sidecars`
  - [x] Ensure failed re-scan only updates session scan error state and never clears persisted `mappingState` / `uiState.import.skippedSubjects`
  - [x] Test: failed confirmed-project re-scan preserves previous confirmed mapping state
  - File: `src/stores/importStore.ts`
- [x] 5.2 `projectStore.ts`: `createProject` accepts `dataSource`
  - [x] `createProject(path, name, options: { dataSource: "dicom" | "bids" })` — required, no default
  - [x] Sets `projectMeta.dataSource` + `projectMeta.currentPhase: "import"` (both paths)
  - [x] JSDoc documents immutability of `dataSource`
  - [x] Update all existing callers/tests to pass `dataSource` explicitly
  - File: `src/stores/projectStore.ts`
- [x] 5.3 `projectStore.ts`: `confirmBidsReview()` action
  - [x] Validate no empty + no duplicate (case-insensitive) labels — throw if invalid (UI catches before action but action defends)
  - [x] Project `detectedGroups` to `MetadataGroup[]` (pick `id`, `label`, `bidsParams`)
  - [x] Flatten `detectedGroups[].subjects[]` to `SubjectRow[]` with stripped `subject` (no `sub-` prefix), `session`, `id = "{subject}/{session}"`, `groupId = group.id`; merge duplicate GroupSubject entries by subject
  - [x] Write to `project.mappingState` ONLY 4 fields: `metadataGroups`, `subjectRows`, `ingestionComplete = true`, `sourceDataPath = rootPath`. Other fields left at zod defaults (`.catch([])` / `.catch({})`) — they are DICOM-wizard-specific.
  - [x] Copy `importStore.BidsReviewState.skippedSubjects` → `project.uiState.import.skippedSubjects`
  - [x] Set `uiState.import.bidsReviewConfirmed = true`
  - [x] Set `projectMeta.currentPhase = "parameters"`
  - [x] Save project; navigate to `/project/:id/parameters`
  - [x] Test: 2-group + 1-skipped scenario produces 2 metadataGroups + 24 subjectRows + correct uiState flags
  - File: `src/stores/projectStore.ts`
- **Commit point:** `feat(stores): createProject dataSource + importStore BIDS review slice + confirmBidsReview`

## Phase 6: LandingPage Detection Dialogs

- [x] 6.1 `LandingPage.tsx`: invoke `check_bids_dataset` after folder pick
  - [x] Replace synchronous project creation with async detection flow
  - [x] On `error == null && is_bids`: show BIDS detection dialog (radio: Skip Import / DICOM Import; display asl_subject_count, asl_session_count, is_cross_sectional; mention `rawdata/` creation)
  - [x] On `is_bids == false && total_subject_count == 0`: error "No BIDS subjects found" with [Choose Different Folder] / [Cancel]
  - [x] On `is_bids == false && asl_subject_count == 0 && total_subject_count > 0`: error "No valid ASL BIDS data found" with same buttons
  - [x] On `dataset_desc_error != null && asl_subject_count >= 1`: corrupt warning "proceed anyway?" with [Skip Import anyway] / [Cancel]
  - [x] [Cancel] or dismiss → return to landing, no project created
  - [x] [Continue + Skip Import] → `createProject(path, name, { dataSource: "bids" })` → navigate to import
  - [x] [Continue + DICOM] → `createProject(path, name, { dataSource: "dicom" })` → navigate to import (existing wizard)
  - [x] Mock `invoke("check_bids_dataset")` in tests
  - File: `src/pages/LandingPage.tsx`
- **Commit point:** `feat(landing): BIDS detection dialog flow`

## Phase 7: BIDSReviewPanel & ImportPage

- [x] 7.1 Create `src/components/import/BIDSReviewPanel.tsx` (skeleton + state machine)
  - [x] Component reads `importStore.BidsReviewState` + `project.uiState.import.bidsReviewConfirmed`
  - [x] On mount (when not confirmed): call `startBidsScan(rootPath)`
  - [x] Render states: scan-running (skeleton), scan-error (alert + Retry/Back to Landing), 0-groups (alert + same buttons), normal (group cards), persisted re-scan summary (when `bidsReviewConfirmed = true`)
  - [x] 10+ groups: all collapsed by default; ≤1 group: parameter table expanded
  - File: `src/components/import/BIDSReviewPanel.tsx`
- [x] 7.2 BIDSReviewPanel: group cards
  - [x] Per `DerivedMetadataGroup`: card with editable label input (auto-suggested label pre-filled), vendor/sequence/labelingType chips, subject count, collapsible subject list (alphabetical), expandable params table
  - [x] Params table renders `bidsParams` entries (skip `id`/`label`); `ASLContext` rendered via `summarizeAslContext()`
  - [x] Skipped subjects warning block rendered when `skippedSubjects.length > 0`
  - [x] Persisted participants.tsv banner rendered when file exists at root (check via Tauri fs plugin or new helper)
  - File: same
- [x] 7.3 BIDSReviewPanel: confirm flow
  - [x] [Confirm] button
  - [x] Validate labels non-empty + unique (case-insensitive) — inline errors per offending group if fail
  - [x] Block confirm while invalid; on valid → call `projectStore.confirmBidsReview()`
  - File: same
- [x] 7.4 BIDSReviewPanel: persisted summary + re-scan on revisit (when `bidsReviewConfirmed === true`)
  - [x] Banner: "BIDS metadata groups confirmed. Import is complete."
  - [x] Collapsed group cards sourced from persisted `mappingState.metadataGroups` + `mappingState.subjectRows`
  - [x] Skipped subjects warning (persisted)
  - [x] Participants.tsv banner (persisted)
  - [x] Render `[Re-scan BIDS]` action on the persisted summary
  - [x] On re-scan success, render normal editable group-review state with `[Confirm]`
  - [x] On re-scan error or 0 groups, keep prior confirmed mapping state intact and allow return to persisted summary
  - [x] Test: revisit after confirmation does not skeleton indefinitely; persisted groups render from project state before any new scan
  - [x] Test: re-scan success shows editable labels and latest skipped subjects
  - [x] Test: re-scan failure preserves previous confirmed summary
  - File: same
- [x] 7.5 ImportPage conditional rendering on `dataSource`
  - [x] `dataSource === "bids"` → `<BIDSReviewPanel />`
  - [x] `dataSource === "dicom"` → existing 6-step wizard
  - File: `src/pages/ImportPage.tsx`
- **Commit point:** `feat(ui): BIDSReviewPanel + ImportPage conditional routing`

## Phase 8: Processing Integration

- [x] 8.1 `assemblyDataPar` / `write_data_par_json`: inject `x.opts.subjectFolder` when `dataSource === "bids"`
  - [x] Pseudocode: `if dataSource === "bids" { dataParJson.x = { ...x, opts: { ...(x?.opts ?? {}), subjectFolder: rootPath } }; }`
  - [x] Test: BIDS-direct JSON contains `subjectFolder`; DICOM JSON does not
  - Files: `src/lib/dataPar*` (frontend) or `src-tauri/src/processing.rs` (`write_data_par_json`) — pick the layer that actually writes `dataPar.json`
- [x] 8.2 `startProcessing`: call `ensure_rawdata_dir` before `run_pipeline` when `dataSource === "bids"`
  - [x] On warning payload (non-empty `rawdata/`): show confirmation dialog; proceed only on user confirm
  - [x] On error: abort processing with user-visible message
  - File: `src/stores/processingStore.ts` (or wherever `startProcessing` lives)
- [x] 8.3 Update `ensureParticipantsFiles` to implement site-precedence for BIDS-direct projects
  - [x] If `dataSource === "bids"` and root-level `participants.tsv` exists with a `site` column, read and parse it to extract user-defined `site` values
  - [x] Perform lookup matching at the subject level, matching the root-level `participant_id` (e.g. `sub-01`) against the base subject label of the session record (e.g., `sub-01` matches `sub-01_1` and `sub-01_2`)
  - [x] In `ensureParticipantsFiles`, preserve these root `site` values in the derivatives `participants.tsv` (do not overwrite with group labels, and do not strip the `site` column even if site correction is disabled)
  - [x] Apply group labels as fallback values for subjects/sessions lacking a root-level `site` value only when correction is enabled
  - [x] Test: BIDS-direct project with root-level `site` values preserves them in the derivatives file when correction is enabled
  - [x] Test: BIDS-direct project with root-level `site` values preserves them in the derivatives file when correction is disabled
- **Commit point:** `feat(processing): subjectFolder inject + ensure_rawdata_dir`

## Phase 9: Manifest Integration

- [x] 9.1 `ManifestPreview.tsx` §1: render `summarizeAslContext(group.bidsParams.ASLContext)` for ASLContext field
  - [x] Add conditional: if key === `"ASLContext"` → render `summarizeAslContext(String(val))` instead of `String(val)`
  - [x] Test: ds000240 group's 109-token raw → summarized form in §1 table
  - File: `src/components/manifest/ManifestPreview.tsx`
- **Commit point:** `feat(manifest): ASLContext summarized display`

## Phase 10: Integration Tests

- [x] 10.1 E2E: BIDS project creation → review → confirmation → processing access
- [x] 10.2 E2E: DICOM project wizard unchanged (regression test)
- [x] 10.3 E2E: corrupt dataset_description handling with ASL present
- [x] 10.4 E2E: no-sidecar error dialog → cancel back to landing
- [x] 10.5 E2E: revisit import after confirmation (persisted summary, re-scan/re-confirm, persisted skipped subjects)
- [x] 10.6 Integration: processing re-run with `ensure_rawdata_dir` idempotency on ds000240
- [x] 10.7 E2E: confirmed BIDS project re-scan after externally added subject updates `subjectRows` only after re-confirm
- **Commit point:** `test(e2e): BIDS-direct flows`

## Phase 11: Polish

- [x] 11.1 Special characters in labels → sanitize on input
- [x] 11.2 `rawdata/` already exists from prior DICOM import → conflict detection (covered by `ensure_rawdata_dir` warning per spec; verify UX rendering)
- [x] 11.3 Edge case: explicit `ses-1` directory — `has_explicit_session = true` while `session_label = "1"`; ensure test reflects behavior
- [x] 11.4 Performance note added to `bids/sidecar.rs` JSDoc/Rustdoc: "Typical studies <500ms; 500-subject ~3-5s; 1000+ deferred"
- **Commit point:** `chore: polish + edge-case handling`

## Verification

- [x] `pnpm test` — all unit tests pass (note known React 19 + jsdom teardown race per AGENTS.md)
- [x] `pnpm lint` — no new lint errors
- [x] `pnpm format` — formatting applied
- [x] `cargo check` — Rust compiles
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit tests pass
- [x] `pnpm lint:rust` — Rust lint + format
- [x] Manual: open ds000240 as new BIDS-direct project → review panel shows 1 group `Siemens_3T_PCASL_3D_Included` with 25 subjects → confirm → parameters page reachable → processing gate opens

## Out of Scope (v1.5+)

- Hybrid projects (BIDS+DICOM mixing)
- Group splitting / merging in BIDSReviewPanel
- Editing `bidsParams` in review panel
- M0 / anatomical sidecar fingerprint integration
- Progress reporting for 1000+ subject datasets (synchronous scan acceptable for v1)
- Per-subject ASLContext display (first-subject value used when divergence within fingerprint group)
- User-defined custom label pattern preferences
- Configurable fingerprint field set
