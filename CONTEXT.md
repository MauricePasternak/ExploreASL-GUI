# Context Glossary

## UI Primitives

- **Rail**: A persistent, collapsible navigation bar on desktop that pushes content aside (width toggles between 60px and 240px). Not an overlay.
- **Drawer**: A temporary navigation overlay used exclusively on mobile/small screens. Covers content when open.

## Data Parameters Module

- **dataPar module**: The `/project/:id/parameters` route. Edits `x.*` processing defaults that become `<root>/derivatives/ExploreASL/dataPar.json` at processing time.
- **dataPar.json**: ExploreASL's processing configuration file. Nested under `x` key. Written by the Rust backend at "Start Processing" time, merging `.easl` stored params + per-run dataset params.
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

## Key Design Decisions

- **bPVCNativeSpace**: GUI default is `true` (on), overriding ExploreASL's default of `0`. User choice persisted; only explicit user selection written to dataPar.json.
- **x.Q.M0**: Select widget (separate_scan | UseControlAsM0 | Absent | Custom number). Default Absent.
- **ApplyQuantification**: 6-checkbox group, not freeform. Select all/deselect all toggle.
- **Field defaults**: Ghost placeholders showing ExploreASL defaults. Zod `.optional()`. Only explicitly set values written to dataPar.json.
- **SessionMergingList/Scaling**: Out of scope. No UI. Future feature.
