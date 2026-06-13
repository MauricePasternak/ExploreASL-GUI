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

| Accordion | Basic fields | Advanced sub-fields |
|---|---|---|
| M0 Configuration | M0, BGSUPNumberPulses, BGSUPPulseTime (conditional), M0_GMScaleFactor, bRegisterM02ASL | M0_conventionalProcessing, RepetitionTimePreparationM0 |
| Quantification | nCompartments | Lambda, T2art, T1blood, T1GM, T1WM, T2GM, T2WM, T2tissueMultiTE + External quantification subtree |
| General Settings | Quality | DELETETEMP, SkipIfNoFlair, SkipIfNoASL, SkipIfNoM0, stopAfterErrors |
| ASL Processing | motionCorrection, bTopUp, bPVCNativeSpace+conditionals, SaveCBF4D | SpikeRemoval*, bRegistrationContrast, bAffineRegistration, bDCTRegistration, bUseMNIasDummyStructural, bHct2BloodT1, ApplyQuantification |
| Atlases | Atlas multi-select + paired TissueMasking/Threshold | bMasking, MinimalROIVolume, bWMH, DataTypes |
| Structural | *(none — all advanced)* | bSegmentSPM12, bHammersCAT12, bFixResolution, bRunLongReg, bRunDARTEL, WMHsegmAlg, bLesionFilling, bAutoACPC |
| Environment | *(none — all advanced)* | bAutomaticallyDetectFSL, bAutomaticallyDetectVABY |

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

## Key Design Decisions

- **bPVCNativeSpace**: GUI default is `true` (on), overriding ExploreASL's default of `0`. User choice persisted; only explicit user selection written to dataPar.json.
- **x.Q.M0**: Select widget (separate_scan | UseControlAsM0 | Absent | Custom number). Default Absent.
- **ApplyQuantification**: 6-checkbox group, not freeform. Select all/deselect all toggle.
- **Field defaults**: Ghost placeholders showing ExploreASL defaults. Zod `.optional()`. Only explicitly set values written to dataPar.json.
- **SessionMergingList/Scaling**: Out of scope. No UI. Future feature.