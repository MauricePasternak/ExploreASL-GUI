# Context Glossary

## UI Primitives

- **Rail**: A persistent, collapsible navigation bar on desktop that pushes content aside (width toggles between 60px and 240px). Not an overlay.
- **Drawer**: A temporary navigation overlay used exclusively on mobile/small screens. Covers content when open.

## Data Parameters Module

- **dataPar module**: The `/project/:id/parameters` route. Edits `x.*` processing defaults that become `<project_root>/derivatives/ExploreASL/dataPar.json` at processing time.
- **dataPar.json**: ExploreASL's processing configuration file. Nested under `x` key. Written by the Rust backend at "Start Processing" time, merging `.easl` stored params + per-run dataset params.
- **Project file**: `<project_root>/project.easl` — stores project state including `processingConfig` and `processingPhase`.
- **Per-run params**: `x.dataset.*`, `x.SESSIONS`, `x.session.options` — set on the processing route, NOT in the dataPar module.
- **Sequence fallbacks**: `x.Q` sequence fields (LabelingType, Initial_PLD, etc.) — out of scope for dataPar module. Handled by import metadata (studyPar.json).
- **Basic tier**: Sections/fields visible by default. Advanced fields hidden behind a "Show advanced" toggle within each accordion.
- **Advanced tier**: Fields revealed per-section by the "Show advanced" toggle. Structural and Environment sections only appear when the global toggle is on.

## DataPar Section Layout

| Accordion        | Basic fields                                                                           | Advanced sub-fields                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Configuration | M0, BGSUPNumberPulses, BGSUPPulseTime (conditional), M0_GMScaleFactor, bRegisterM02ASL | M0_conventionalProcessing, RepetitionTimePreparationM0                                                                                    |
| Quantification   | nCompartments                                                                          | Lambda, T2art, T1blood, T1GM, T1WM, T2GM, T2WM, T2tissueMultiTE + External quantification subtree                                         |
| General Settings | Quality                                                                                | DELETETEMP, SkipIfNoFlair, SkipIfNoASL, SkipIfNoM0, stopAfterErrors                                                                       |
| ASL Processing   | motionCorrection, bTopUp, bPVCNativeSpace+conditionals, SaveCBF4D                      | SpikeRemoval\*, bRegistrationContrast, bAffineRegistration, bDCTRegistration, bUseMNIasDummyStructural, bHct2BloodT1, ApplyQuantification |
| Atlases          | Atlas multi-select + paired TissueMasking/Threshold                                    | bMasking, MinimalROIVolume, bWMH, DataTypes                                                                                               |
| Structural       | _(none — all advanced)_                                                                | bSegmentSPM12, bHammersCAT12, bFixResolution, bRunLongReg, bRunDARTEL, WMHsegmAlg, bLesionFilling, bAutoACPC                              |
| Environment      | _(none — all advanced)_                                                                | bAutomaticallyDetectFSL, bAutomaticallyDetectVABY                                                                                         |

## Processing Module

- **SubjectSession**: The concatenated ExploreASL string (e.g. `sub-C9ORF007Philips_01`). Primary tracking key for processing progress. Parsed for display into subject/session columns. Matches lock directory naming verbatim — no separate mapping layer.
- **Module vector (bProcess)**: 3-element boolean vector `[Structural, ASL, Population]` passed directly to ExploreASL. GUI maps module checkboxes to this vector.
- **SubjectRegexp**: Regex filter for ExploreASL subject selection. All subjects → `^sub-.*$`. Subset → alternation e.g. `^(sub-X_Y|sub-Z_W)$`. Written to `x.dataset.subjectRegexp` in dataPar.json at launch.
- **Step code**: Numeric-prefix status file name (e.g. `010_LinearReg_T1w2MNI`). Part of ExploreASL's contract. Hardcoded in the frontend as step code mappings per module.
- **Locked folder**: `locked/` subdirectory inside a module/subject lock path. Acts as mutex — present while ExploreASL is processing that subject. Stale after crash; GUI clears before launch.
- **Status file**: `.status` file created by ExploreASL on step completion. `999_ready.status` marks module completion for a subject.
- **Re-run**: Selecting a completed subject + module and clicking Start. `.status` files for that module/subject are deleted before spawning workers. Subject output directories are NOT deleted — ExploreASL overwrites as needed.
- **Clean**: Destructive action for corrupted data. Deletes entire `sub-X_Y/` output directory, lock files, log files, AND Population files matching `*sub-X_Y*`. Not part of normal re-run.
- **kill_pipeline**: Kills all worker PIDs stored in `AppState.processing_state`. Frontend doesn't pass PIDs — Rust reads from state. No risk of killing wrong processes.
- **BIDS2Legacy**: ExploreASL module that converts BIDS `sub-X/ses-Y` structure to `sub-X_Y` SubjectSession format. Runs before processing modules.

## Processing Lock Directory Structure

```
lock/
├── xASL_module_Structural/
│   └── sub-X_Y/xASL_module_Structural/
│       ├── 010_LinearReg_T1w2MNI.status
│       └── ... (per SubjectSession)
├── xASL_module_ASL/
│   └── sub-X_Y/xASL_module_ASL_ASL_<run>/
│       ├── 020_RealignASL.status
│       └── ... (per SubjectSession per ASL run)
└── xASL_module_Population/
    └── xASL_module_Population/
        ├── 010_CreatePopulationTemplates.status
        └── ... (study-level, no subject subfolder)
```

## Step Code Mappings

Hardcoded — part of ExploreASL's contract. Rarely changes.

**Structural:**
010_LinearReg_T1w2MNI, 020_LinearReg_FLAIR2T1w, 030_FLAIR_BiasfieldCorrection, 040_LST_Segment_FLAIR_WMH, 050_LST_T1w_LesionFilling_WMH, 060_Segment_T1w, 070_CleanUpWMH_SEGM, 080_Resample2StandardSpace, 090_GetVolumetrics, 100_VisualQC_Structural, 999_ready

**ASL:**
020_RealignASL, 030_RegisterASL, 040_ResampleASL, 050_PreparePV, 060_ProcessM0, 070_CreateAnalysisMask, 080_Quantification, 090_VisualQC_ASL, 999_ready

**Population:**
010_CreatePopulationTemplates, 020_CreateAnalysisMask, 030_CreateBiasfield, 040_GetDICOMStatistics, 050_GetVolumeStatistics, 060_GetMotionStatistics, 065_GetRegistrationStatistics, 070_GetROIstatistics, 080_SortBySpatialCoV, 090_DeleteTempFiles, 100_GZipAllFiles, 999_ready

## Visualization Module

- **External Data**: Covariate file (CSV/TSV/xlsx) from outside ExploreASL output, joined onto qCBF data. Selected via native file dialog; stored as absolute path in `joinConfig.externalSource` (separate from `qcbfSource`, which holds the single qCBF source).
- **Join Config**: Persisted configuration of an external data left-join. Shape: `{ externalSource, leftOn, rightOn, dropRightOn, naTokens, sheetName }`. `null` when no external file selected.
- **Left Join**: The only supported join type. qCBF rows preserved; external covariates appended; unmatched qCBF rows get NaN covariates. Not user-selectable.
- **Key Pair**: A `(left_on, right_on)` column pairing for join condition. Positional, pandas semantics — `leftOn[i]` joins with `rightOn[i]`. Multi-key joins require equal array lengths.
- **Select Data**: The first stepper step (renamed from "Select File"). Encompasses qCBF file dropdown + external file selection + join configuration + sanity checks + graphical join diagram. Denser than other steps but comparable complexity.
- **Merged Inspection**: The `inspection` store field when a join is active. Populated by `execute_join` instead of `inspect_tsv`. Same shape, but columns carry `source` ("qcbf" | "external") and `originalName` (pre-suffix). Identifier columns are qCBF-side only.
- **NA Tokens**: User-specified missing-value strings for the external file. Defaults: `["", "NaN", "NA", "n/a", "<NA>"]`. Applied during `execute_join`; normalized to empty strings in cached merged data. qCBF side keeps its existing missing-value handling.

## Manifest Module

- **Manifest Verdict**: User QC judgment on a SubjectSession after Population module completion: `pass` or `fail`. Stored in `.easl` under `uiState.manifest.verdicts` keyed by SubjectSession. Distinct from pipeline `ModuleDisplayStatus` — orthogonal to it. Set via the QC Selection step of the Manifest stepper.
  _Avoid_: QC flag, subject status, review mark
- **Verdict Unit**: SubjectSession only (`sub-X_Y`). One verdict per SubjectSession regardless of ASL run count. Q3 resolution.
- **Neutral Verdict**: Default unset state — a SubjectSession rendered in QC Selection before the user has triaged it. Progression to Manifest Preview is gated on zero Neutral verdicts across visible rows.
  _Avoid_: pending (collides with pipeline status), unreviewed
- **No Info Verdict**: Derived, non-user-touchable exclusion state — SubjectSession whose Population QC outputs (coverage / SpatialCoV / motion CSVs) are missing or unreadable. Removed from manifest aggregation; not counted in Pass/Total.
  _Avoid_: missing data, no data
- **Stale Verdict**: A Manifest verdict whose `setAtPopulationRunId` differs from the current Population run id. Re-running Population marks prior verdicts stale (mirrors the Import StaleSubject pattern); stale verdicts cannot enter a manifest without re-confirmation.
- **N Subjects (per group)**: Count of unique SubjectSessions assigned to a metadata group.
- **N Total Runs (per group)**: Sum of `aslRuns.length` across SubjectSessions in the group. Distinct from N Subjects (e.g. one SubjectSession with 3 ASL runs contributes 1 to N Subjects, 3 to N Total Runs).
- **Per-SubjectSession Mean Motion**: Worst ASL run within the SubjectSession — `max(runs[].motionRmsMm)`, not mean. Coverage and SpatialCoV are emitted per-SubjectSession (no across-run aggregation needed).

## Import Module

- **Stale import subject**: An import subject whose result may no longer reflect current configuration. Structural config changes (tokenizer, aliases, renames) stale all subjects; metadata group changes stale only subjects in affected groups.
- **Fresh import subject**: An import subject whose result is still valid — no relevant config has changed since its import run.
- **Import status**: What happened during the last run: pending, running, completed, failed, or cancelled. Independent of staleness.

## Key Design Decisions

- **bPVCNativeSpace**: GUI default is `true` (on), overriding ExploreASL's default of `0`. User choice persisted; only explicit user selection written to dataPar.json.
- **x.Q.M0**: Select widget (separate_scan | UseControlAsM0 | Absent | Custom number). Default Absent.
- **ApplyQuantification**: 6-checkbox group, not freeform. Select all/deselect all toggle.
- **Field defaults**: Ghost placeholders showing ExploreASL defaults. Zod `.optional()`. Only explicitly set values written to dataPar.json.
- **SessionMergingList/Scaling**: Out of scope. No UI. Future feature.
