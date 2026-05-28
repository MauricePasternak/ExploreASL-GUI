# Phase 3: Data Parameters (dataPar.json)

## Overview

Configuration interface for ExploreASL's processing parameters (`dataPar.json`). Exposes all parameters grouped per the official ExploreASL documentation. Dataset parameters (subject selection) are deferred to Phase 4.

Parameters are optional — ExploreASL uses defaults for missing fields. The UI shows each parameter's default value pre-filled. Users modify only what differs from defaults.

## User Flow

1. Navigate to `/project/:id/parameters`.
2. Left sidebar shows parameter groups matching ExploreASL docs organization. **Top of sidebar: Field Strength selector** (1.5T / 3T / 7T). Changing this updates all field-strength-dependent default values in real-time (T1blood, T2art, Lambda, T1GM, etc.).
3. Select a group → right panel shows the group's form fields.
4. Each field displays its ExploreASL default (adjusted for selected field strength). DESCRIPTION and DEFAULTS columns from docs are shown as help text.
5. User modifies fields as needed. Zod validates on blur.
6. "Preview JSON" button opens a read-only modal with the generated `dataPar.json`.
7. "Save" writes `<project_root>/derivatives/ExploreASL/dataPar.json`.
8. Saved state is tracked; unsaved changes show a "You have unsaved changes" indicator.

## Parameter Groups

Groups match the exact hierarchy from [ExploreASL Processing Parameters documentation](https://exploreasl.github.io/Documentation/latest/ProcessingParameters/):

### 1. Environment Parameters (`x.external`)
| Field | Type | Default |
|---|---|---|
| `bAutomaticallyDetectFSL` | boolean | `false` |
| `bAutomaticallyDetectVABY` | boolean | `false` |

### 2. Study Parameters (`x`)
| Field | Type | Default |
|---|---|---|
| `SESSIONS` | string[] (multi-input) | `["ASL_1"]` |
| `session.options` | string[] (multi-input) | `[]` |

Pre-populated from Phase 2 session aliases if import was run.

### 3. Dataset Parameters — DEFERRED TO PHASE 4
`x.dataset.subjectRegexp`, `x.dataset.exclusion`, `x.dataset.ForceInclusionList` are configured at execution time when the user selects which subjects to process.

### 4. M0 Parameters (`x.modules.asl`)
| Field | Type | Default |
|---|---|---|
| `M0_conventionalProcessing` | boolean (0/1) | `0` |
| `M0_GMScaleFactor` | number | `1` |
| `M0PositionInASL4D` | number[] (comma-separated) | `[]` |
| `DummyScanPositionInASL4D` | number[] (comma-separated) | `[]` |
| `RepetitionTimePreparationM0` | number[] (comma-separated) | `[]` |

Note: `M0PositionInASL4D`, `DummyScanPositionInASL4D`, `RepetitionTimePreparationM0` should normally be provided via `studyPar.json` during import. Present here as fallback with a note.

### 5. Quantification Parameters (`x.Q`)
| Field | Type | Default @ 3T |
|---|---|---|
| `Lambda` | number | `0.9` |
| `T2art` | number | `165` |
| `T1blood` | number | `1650` |
| `T1GM` | number | `1240` |
| `T1WM` | number | `800` |
| `T2GM` | number | `85` |
| `T2WM` | number | `76` |
| `T2tissueMultiTE` | number | `85` |
| `nCompartments` | 1 or 2 (Select) | `1` |

Field-strength-dependent defaults (1.5T / 3T / 7T) sourced from ExploreASL's internal defaults map. The field strength selector at the top of the sidebar controls which defaults are shown. User-set values persist across field strength changes.

### 6. ASL Processing Parameters (`x.modules.asl`)
| Field | Type | Default |
|---|---|---|
| `SaveCBF4D` | boolean | `false` |
| `motionCorrection` | boolean (0/1) | `1` |
| `SpikeRemovalThreshold` | number | `0.01` |
| `SpikeRemovalAbsoluteThreshold` | number | `0` |
| `bRegistrationContrast` | Select: 0/1/2/3 | `2` |
| `bAffineRegistration` | Select: 0/1/2 | `0` |
| `bDCTRegistration` | Select: 0/1/2 | `0` |
| `bRegisterM02ASL` | boolean (0/1) | `0` |
| `bUseMNIasDummyStructural` | boolean (0/1) | `0` |
| `bPVCNativeSpace` | boolean (0/1) | `0` |
| `PVCNativeSpaceKernel` | number[] (3 integers) | `[5, 5, 1]` |
| `bPVCGaussianMM` | boolean (0/1) | `0` |
| `bMakeNIfTI4DICOM` | boolean | `false` |
| `ApplyQuantification` | boolean[6] (checkbox group) | `[1,1,1,1,1,1]` |
| `SessionMergingList` | advanced (text area) | `[]` |
| `SessionMergingScaling` | advanced (text area) | `[]` |
| `bQuantifyMultiTE` | boolean | `true` |
| `bHct2BloodT1` | Select: 0/1/2 | auto |
| `bUseExternalQuantification` | boolean | `false` |
| `ExternalQuantificationType` | Select: BASIL/FABBER/VABY | `BASIL` |
| _(Additional external quantification params shown conditionally when `bUseExternalQuantification` is true)_ | | |

Conditional logic: external quantification fields (ExternalQuantificationSmoothGaussianMM, bMaskingExternal, bSpatialBASIL, bInferT1BASIL, bInferATTBASIL, ExchBASIL, DispBASIL, ATTSDBASIL, bCleanUpExternal) appear only when `bUseExternalQuantification` is enabled.

### 7. Structural Processing Parameters (`x.modules`)
| Field | Type | Default |
|---|---|---|
| `bRunLongReg` | boolean (0/1) | `0` |
| `bRunDARTEL` | boolean (0/1) | `0` |
| `WMHsegmAlg` | Select: LGA/LPA | `LPA` |
| `structural.bSegmentSPM12` | boolean (0/1) | `0` |
| `structural.bHammersCAT12` | boolean (0/1) | `0` |
| `structural.bFixResolution` | boolean | `false` |
| `population.bNativeSpaceAnalysis` | boolean | `false` |

### 8. General Processing Parameters (`x.settings`)
| Field | Type | Default |
|---|---|---|
| `Quality` | boolean (1/0) | `1` |
| `DELETETEMP` | boolean (0/1) | `1` |
| `SkipIfNoFlair` | boolean (0/1) | `0` |
| `SkipIfNoASL` | boolean (0/1) | `0` |
| `SkipIfNoM0` | boolean (0/1) | `0` |
| `stopAfterErrors` | number | `Infinity` |
| `bLesionFilling` | boolean | `true` |
| `bAutoACPC` | boolean | `true` |

### 9. Masking & Atlas Parameters (`x.S`)
| Field | Type | Default |
|---|---|---|
| `bMasking` | boolean[4] (checkbox group) | `[1,1,1,1]` |
| `MinimalROIVolume` | number (mL) | `1` |
| `bWMH` | boolean | `false` |
| `DataTypes` | string[] (multi-select) | `["qCBF"]` |
| `Atlases` | string[] (multi-select checkbox list) | `["Total", "DeepWM"]` |
| `TissueMasking` | string[] (one per atlas) | derived |
| `TissueThreshold` | number[] (one per atlas) | `[0.7, ...]` |
| `LesionROIThreshold` | number | `0.5` |

Atlas selection: render all available atlases from docs as checked/unchecked. Pre-grouped by license type (Free / Free for non-commercial).

## Component Tree

```
Phase3DataParams (route: /project/:id/parameters)
├── Layout (sidebar + content)
│   ├── Sidebar: GroupNav
│   │   └── NavLinks: Environment, Study, M0, Quantification, ASL, Structural, General, Masking
│   └── Content: GroupForm (dynamic based on selected group)
│       ├── ParameterField (reusable: renders correct input for type)
│       │   ├── BooleanField (Mantine Switch)
│       │   ├── NumberField (Mantine NumberInput)
│       │   ├── SelectField (Mantine Select)
│       │   ├── MultiSelectField (Mantine MultiSelect)
│       │   ├── ArrayField (Mantine TagsInput or TextInput with parser)
│       │   └── CheckboxGroupField (Mantine Checkbox.Group)
│       └── HelpText (Mantine Tooltip or Text, shows doc description + default)
├── JsonPreviewModal
│   └── ReadOnlyJsonViewer (syntax highlighted)
├── SaveButton
└── UnsavedChangesIndicator (Mantine Badge or text)
```

## Data Model (Zod Schemas)

```typescript
// Each group mirrors the x.* hierarchy exactly
const EnvironmentParams = z.object({
  bAutomaticallyDetectFSL: z.boolean().default(false),
  bAutomaticallyDetectVABY: z.boolean().default(false),
});

const StudyParams = z.object({
  SESSIONS: z.array(z.string()).default(["ASL_1"]),
  session: z.object({
    options: z.array(z.string()).default([]),
  }).optional(),
});

const M0Params = z.object({
  M0_conventionalProcessing: z.union([z.literal(0), z.literal(1)]).default(0),
  M0_GMScaleFactor: z.number().default(1),
  M0PositionInASL4D: z.array(z.number()).default([]),
  DummyScanPositionInASL4D: z.array(z.number()).default([]),
  RepetitionTimePreparationM0: z.array(z.number()).default([]),
});

const QuantificationParams = z.object({
  Lambda: z.number().default(0.9),
  T2art: z.number().default(165),
  T1blood: z.number().default(1650),
  T1GM: z.number().default(1240),
  T1WM: z.number().default(800),
  T2GM: z.number().default(85),
  T2WM: z.number().default(76),
  T2tissueMultiTE: z.number().default(85),
  nCompartments: z.union([z.literal(1), z.literal(2)]).default(1),
});

const AslParams = z.object({
  SaveCBF4D: z.boolean().default(false),
  motionCorrection: z.union([z.literal(0), z.literal(1)]).default(1),
  SpikeRemovalThreshold: z.number().default(0.01),
  SpikeRemovalAbsoluteThreshold: z.number().default(0),
  bRegistrationContrast: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(2),
  bAffineRegistration: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  bDCTRegistration: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  bRegisterM02ASL: z.union([z.literal(0), z.literal(1)]).default(0),
  bUseMNIasDummyStructural: z.union([z.literal(0), z.literal(1)]).default(0),
  bPVCNativeSpace: z.union([z.literal(0), z.literal(1)]).default(0),
  PVCNativeSpaceKernel: z.array(z.number()).default([5, 5, 1]),
  bPVCGaussianMM: z.union([z.literal(0), z.literal(1)]).default(0),
  bMakeNIfTI4DICOM: z.boolean().default(false),
  ApplyQuantification: z.array(z.boolean()).default([true, true, true, true, true, true]),
  bQuantifyMultiTE: z.boolean().default(true),
  bHct2BloodT1: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  bUseExternalQuantification: z.boolean().default(false),
  ExternalQuantificationType: z.enum(["BASIL", "FABBER", "VABY"]).default("BASIL"),
  // Conditional external params (only relevant when bUseExternalQuantification = true):
  ExternalQuantificationSmoothGaussianMM: z.array(z.number()).default([]),
  bMaskingExternal: z.boolean().default(true),
  bSpatialBASIL: z.boolean().default(false),
  bInferT1BASIL: z.boolean().default(false),
  bInferATTBASIL: z.boolean().default(true),
  ExchBASIL: z.enum(["mix", "simple", "2cpt", "spa"]).default("simple"),
  DispBASIL: z.enum(["none", "gamma", "gauss", "sgauss"]).default("none"),
  ATTSDBASIL: z.number().default(1.0),
  bCleanUpExternal: z.boolean().default(true),
  SessionMergingList: z.array(z.array(z.string())).default([]),
  SessionMergingScaling: z.array(z.array(z.number())).default([]),
});

const StructuralParams = z.object({
  bRunLongReg: z.union([z.literal(0), z.literal(1)]).default(0),
  bRunDARTEL: z.union([z.literal(0), z.literal(1)]).default(0),
  WMHsegmAlg: z.enum(["LGA", "LPA"]).default("LPA"),
  structural: z.object({
    bSegmentSPM12: z.union([z.literal(0), z.literal(1)]).default(0),
    bHammersCAT12: z.union([z.literal(0), z.literal(1)]).default(0),
    bFixResolution: z.boolean().default(false),
  }).optional(),
  population: z.object({
    bNativeSpaceAnalysis: z.boolean().default(false),
  }).optional(),
});

const GeneralParams = z.object({
  Quality: z.union([z.literal(0), z.literal(1)]).default(1),
  DELETETEMP: z.union([z.literal(0), z.literal(1)]).default(1),
  SkipIfNoFlair: z.union([z.literal(0), z.literal(1)]).default(0),
  SkipIfNoASL: z.union([z.literal(0), z.literal(1)]).default(0),
  SkipIfNoM0: z.union([z.literal(0), z.literal(1)]).default(0),
  stopAfterErrors: z.number().default(Infinity),
  bLesionFilling: z.boolean().default(true),
  bAutoACPC: z.boolean().default(true),
});

const MaskingAtlasParams = z.object({
  bMasking: z.array(z.boolean()).default([true, true, true, true]),
  MinimalROIVolume: z.number().default(1),
  bWMH: z.boolean().default(false),
  DataTypes: z.array(z.string()).default(["qCBF"]),
  Atlases: z.array(z.string()).default(["Total", "DeepWM"]),
  TissueMasking: z.array(z.string()).default([]),
  TissueThreshold: z.array(z.number()).default([]),
  LesionROIThreshold: z.number().default(0.5),
});

// Full dataPar schema (all groups optional — ExploreASL uses defaults for missing)
const DataParConfig = z.object({
  x: z.object({
    external: EnvironmentParams.optional(),
    SESSIONS: z.array(z.string()).optional(),
    session: z.object({ options: z.array(z.string()) }).optional(),
    Q: QuantificationParams.optional(),
    settings: GeneralParams.optional(),
    S: MaskingAtlasParams.optional(),
    modules: z.object({
      asl: z.object({
         // Zod 4: spread shapes instead of z.intersection(M0Params, AslParams)
         ...M0Params.shape,
         ...AslParams.shape,
       }).optional(),
      structural: StructuralParams.optional(),
    }).optional(),
  }).optional(),
});
```

## State Shape (Zustand Slices)

```typescript
interface DataParamsState {
  // Form state mirrors DataParConfig structure
  dataParams: DataParConfig;
  isDirty: boolean;

  // Actions
  updateParam: (path: string, value: unknown) => void;  // dot-path e.g. "x.Q.Lambda"
  resetToDefaults: () => void;
  loadFromFile: () => Promise<void>;    // reads existing dataPar.json
  saveToFile: () => Promise<void>;      // writes dataPar.json
  getJsonPreview: () => string;         // returns formatted JSON string
}
```

`updateParam` uses a dot-path notation to update deeply nested fields. Example: `updateParam("x.Q.Lambda", 0.8)`.

## Tauri Commands (Rust API)

```
read_data_par(project_root: String) -> Option<String>
  Reads <project_root>/derivatives/ExploreASL/dataPar.json if it exists. Returns JSON string or null.

write_data_par(project_root: String, contents: String) -> ()
  Writes JSON string to <project_root>/derivatives/ExploreASL/dataPar.json.
  Creates derivatives/ExploreASL/ directory if missing.
```

## Validation Rules

| Rule | Context |
|---|---|
| `PVCNativeSpaceKernel` must be 3 odd integers when `bPVCNativeSpace` is 1 | ASL params |
| `ExternalQuantificationType` is required when `bUseExternalQuantification` is true | ASL params |
| `TissueMasking` length must match `Atlases` length if provided | Masking params |
| `TissueThreshold` length must match `Atlases` length if provided | Masking params |
| `ApplyQuantification` must have exactly 6 boolean elements | ASL params |
| `bMasking` must have exactly 4 boolean elements | Masking params |
| `SESSIONS` must not be empty if provided | Study params |

## Error Handling

- **Invalid manual JSON edit:** If the user had previously hand-edited `dataPar.json` and it fails Zod parsing, the form loads defaults and shows a warning: "Existing dataPar.json contains invalid values. Defaults have been loaded instead."
- **Save failure (disk):** "Failed to save data parameters. Check that [path] is writable."
- **Validation errors:** Inline field errors (Mantine red border + error text). The "Save" button is disabled while there are unresolved validation errors.

## Out of Scope

- Presets / templates (V0 has no preset selector; all params start at their ExploreASL defaults)
- Sequence parameters (`x.Q.BackgroundSuppressionNumberPulses`, `x.Q.LabelingType`, etc.) — these should come from import via `studyPar.json`
- Parameter conflict detection across groups (e.g., warning when PVC is enabled without segmentation)
- Field-strength-aware defaults (always show 3T defaults)
- Custom atlas import (only ExploreASL-bundled atlases)
- JSON editor with manual editing capability (form-only in V0)
