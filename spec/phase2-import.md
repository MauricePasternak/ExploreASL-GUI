# Phase 2: Import (DICOM → BIDS)

## Overview

Converts raw DICOM data from arbitrary directory structures into ASL-BIDS format consumable by ExploreASL. The core challenge: clinicians' DICOM directories have varying, unpredictable folder structures with anonymized names. ExploreASL requires fixed directory depth, regular expressions, and correct BIDS naming.

This phase abstracts regex generation and BIDS mapping behind a visual, spreadsheet-driven interface.

## User Flow

### Step 1: DICOM Ingestion

1. User sees a Mantine Dropzone: "Drag and drop DICOM folders here, or click to browse."
2. User toggles "DICOMs are in subdirectories" (default: `true`, maps to `bMatchDirectories: true`). When `false`, `walk_directory` scans for individual `.dcm` files at leaf level instead of directories.
3. On drop/selection, Rust `walk_directory` scans for leaf directories (or files) containing `.dcm` data.
4. Frontend discovers unique **structural patterns** by analyzing paths:
   - Paths are tokenized by configurable delimiters (`/`, `_`, `-`) into blocks.
   - A pattern signature is derived by replacing varying blocks (e.g., `M01`, `M02`) with placeholders while preserving fixed blocks (e.g., `DICOM`).
   - Example: `M01/DICOM/26041205/51410000` and `M02/DICOM/26041206/19120000` share the signature `SUBJECT/DICOM/NUMBER/NUMBER` — one pattern.
   - `Subject1_Visit1/DICOM/series/*dcm` has a different signature — a separate pattern.
5. UI displays: "Found X DICOM locations across Y unique path patterns" with one representative sample per pattern shown.
6. User confirms and proceeds to tokenization.

### Step 2: Visual Path Tokenizer

1. For each unique structural pattern, the sample path is displayed split by delimiters (`/`, `_`, `-`) into clickable "blocks."
2. User clicks a block, selects from dropdown: **Subject**, **Session**, **Run**, **Modality**, **Ignore**. If subject **and** session share one block (e.g., `M01_Visit1`), the user can assign both tags to that block — the tokenizer splits it internally.
3. Multiple non-contiguous blocks can share the same tag.
4. A live preview shows the generated `folderHierarchy` regex array and `tokenOrdering`:
   - Tagged blocks → `(.*)` capture group
   - Ignored blocks → `.*` (no capture)
5. Live preview also shows how many unique subjects/sessions/runs/modalities were captured across the entire dataset for this pattern.
6. **Defaults for unassigned tags:** If Session is not tagged by any pattern, it defaults to `01` for all subjects. If Run is not tagged, it defaults to `01`. Subject and Modality are required — the user must tag at least one block as each. The staging tree always normalizes to `Subject/Session/Run/Modality` regardless of raw data depth.
6. User confirms token assignment for each unique pattern.

### Step 3: Alias Resolution

Three sub-sections presented as tabs or accordion panels:

#### 3a. Modality Mapping
- Table: Column A = unique captured modality strings (read-only). Column B = Mantine Select dropdown with ExploreASL modality options: `T1w`, `T2w`, `ASL4D`, `M0`, `FLAIR`, `WMH_SEGM`.
- Dropdown includes "Ignore" option for modalities not relevant to processing.
- Generates `tokenScanAliases` pairs: `["^capturedName$", "ExploreASLName"]`.

#### 3b. Session / Run Ordering
- Drag-and-drop list of unique captured session/run strings.
- User reorders the list to define chronological order.
- Each position generates an alias: position 1 → `ASL_1`, position 2 → `ASL_2`, etc.
- If captured names are ISO dates (detected via regex), auto-sort chronologically by default.
- Generates `tokenSessionAliases` pairs: `["^capturedName$", "ASL_N"]`.

#### 3c. Subject Renaming (Optional)
- Editable table: original captured subject names → target BIDS-compliant names.
- Bulk operations: "Prepend `sub-` to all", "Strip special characters", "Make uppercase/lowercase."
- "Import CSV" button for key mapping from external spreadsheets.
- Stored as a flat mapping: `{ original: target }`.

### Step 4: Metadata Grouping (studyPar.json)

1. **On first entry to this step:** A defaults modal automatically opens. Title: "Configure Default BIDS Metadata". Form with BIDS parameters fields. When submitted, this becomes the "Global Defaults" group — applied to ALL subjects/sessions/runs. The modal can be re-opened later to edit defaults.
2. Mantine DataTable displays all discovered subject/session/run combinations (rows). Columns: Subject, Session, Run, Metadata Group (shows "Global Defaults" initially).
3. User selects rows (checkbox selection) to override defaults for specific subjects. "Apply Override Metadata" button opens a modal with EIP fields. On submit: selected rows updated to show the override group label.
4. Multiple override groups can be defined. Each row belongs to exactly one group (defaults or an override).
5. Generates `studyPar.json` with a `StudyPars` array: the first entry is the catch-all (no SubjectRegExp/SessionRegExp — catches everything). Subsequent entries are overrides with exact-match regex derived from row selection.

### Step 5: Run Import

**Symlink Tree Normalization:** The raw DICOM paths have arbitrary depth and structure. Before running ExploreASL, the GUI constructs a clean, uniform staging tree:

```
.easl_staging/sourcedata/<Subject>/<Session>/<Run>/<Modality>/
```

Every level is always present — missing levels are injected with defaults:
- **Subject:** required — always extracted from tokenizer
- **Session:** defaults to `01` if not captured by tokenizer (single well-zero-padded value)
- **Run:** defaults to `01` if not captured (single well-zero-padded value)
- **Modality:** required — always captured and aliased

This guarantees `sourcestructure.json` is always generated for a fixed 4-level structure:
```json
{
  "folderHierarchy": ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
  "tokenOrdering": [1, 0, 2, 3],
  "tokenSessionAliases": ["^01$", "ASL_1", ...],
  "tokenScanAliases": ["^T1w$", "T1w", "^ASL4D$", "ASL4D", ...],
  "bMatchDirectories": true
}
```

The session aliases always include at minimum `["^01$", "ASL_1"]`. Additional aliases are appended if the user defined session ordering in Step 3b. Similarly, run aliases always include `["^01$", "ASL_1"]` at minimum. This is identical to ExploreASL's own defaults.

**Import Flow:**

1. Frontend generates final config files:
   - `sourcestructure.json` (always 4-level, defaults-filled)
   - `studyPar.json` (from metadata groups)
2. Validation: Zod checks both files for completeness.
3. "Run Import" button triggers Rust backend:
   - Creates `<project_root>/.easl_staging/sourcedata/` with BIDS symlink tree.
   - Writes `sourcestructure.json` and `studyPar.json` at `<project_root>/.easl_staging/`.
   - Spawns MATLAB subprocess: `ExploreASL(<staging_root>, [1 1 0], 0)`.
   - Streams stdout/stderr to frontend. **Import module uses stdout parsing for error detection, NOT lock files.** The import module only produces 3 coarse status files (`010_DCM2NII.status`, `020_NII2BIDS.status`, `999_ready.status`) which are insufficient for per-subject or per-step error granularity.
   - On success: atomic `mv` of completed BIDS data to `<project_root>/rawdata/`.
    - On failure per subject: error extracted from stdout pattern matching (e.g., `NII2BIDS failed for`).
      **Critical cleanup:** ExploreASL's import module creates all 3 status files even when a subject fails.
      On detecting failure, the frontend must instruct Rust to delete `010_DCM2NII.status`, `020_NII2BIDS.status`,
      and `999_ready.status` for that subject. Otherwise the subject appears "completed" to ExploreASL and
      cannot be retried.
   - Cleans up `.easl_staging/` on full completion.
4. Frontend shows progress per subject via stdout parsing. Status files are read for completion check only.
5. Summary page: X succeeded, Y failed (with error details from stdout).
6. **Retry:** If any subjects failed, "Retry Import" button appears. Re-runs the full import. ExploreASL skips already-completed subjects (prints `ASL4D already existed, skipping...`), so only failed subjects are re-processed. The user can fix studyPar.json / sourcestructure.json before retrying.

## Component Tree

```
Phase2Import (route: /project/:id/import)
├── MantineStepper (activeStep managed in Zustand)
│   ├── Step1: DICOM Ingestion
│   │   ├── DropzoneComponent (Mantine Dropzone)
│   │   ├── ScanResults (subject count, pattern summary)
│   │   └── ErrorSummary (invalid files, empty directories)
│   ├── Step2: Path Tokenizer
│   │   ├── DepthPatternSelector (dropdown for each unique depth)
│   │   ├── PathBlockViewer (clickable path blocks split by /)
│   │   ├── TagAssignmentDropdown (reusable per block)
│   │   └── GeneratedRegexPreview (live folderHierarchy + tokenOrdering)
│   ├── Step3: Alias Resolution
│   │   ├── Tab: ModalityMap
│   │   │   └── ModalityMappingTable (read-only capture + Select dropdown)
│   │   ├── Tab: SessionOrder
│   │   │   └── DragDropList (Mantine DnD or custom)
│   │   └── Tab: SubjectRename
│   │       └── SubjectRenameTable (editable grid + bulk actions + CSV import)
│   ├── Step4: Metadata Grouping
│   │   ├── SubjectsDataTable (Mantine DataTable with checkbox selection)
│   │   ├── MetadataGroupModal (BIDS parameter form + group label)
│   │   └── GroupLegend (color-coded group labels)
│   └── Step5: Import Runner
│       ├── ConfigPreview (read-only JSON of sourcestructure + studyPar)
│       ├── RunButton
│       ├── ProgressPerSubject (expandable rows, step status)
│       └── ImportSummary (success/failure counts, error log)
```

## Data Model (Zod Schemas)

```typescript
// --- Step 1: Ingestion ---
const PathPattern = z.object({
  signature: z.string(),          // e.g. "SUBJECT/DICOM/NUMBER/NUMBER"
  samplePath: z.string(),         // representative full path
  blocks: z.array(z.string()),    // path split by delimiters
  uniqueNames: z.record(z.number(), z.array(z.string())),  // block index => unique values
  count: z.number(),              // how many paths match this pattern
});

// --- Step 2: Tokenizer ---
const TokenTag = z.enum(["Subject", "Session", "Run", "Modality", "Ignore"]);

const TokenAssignment = z.object({
  depthLevel: z.number(),              // which folder depth this applies to
  tag: TokenTag,
  pattern: z.string(),                 // the regex pattern for this block
});

const TokenizerConfig = z.object({
  folderHierarchy: z.array(z.string()), // generated regex array
  tokenOrdering: z.tuple([              // [Subject, Visit, Session, Scan]
    z.number(), z.number(), z.number(), z.number()
  ]),
  assignments: z.array(TokenAssignment),
});

// --- Step 3: Aliases ---
const ModalityAlias = z.object({
  captured: z.string(),
  mapped: z.enum(["T1w", "T2w", "ASL4D", "M0", "FLAIR", "WMH_SEGM"]).nullable(),
});

const SessionAlias = z.object({
  captured: z.string(),
  alias: z.string(),    // e.g. "ASL_1"
  index: z.number(),    // chronological order
});

const SubjectRename = z.object({
  original: z.string(),
  target: z.string(),
});

// --- Step 4: Metadata Groups ---
const BidsMetadata = z.object({
  ArterialSpinLabelingType: z.string().optional(),
  PostLabelingDelay: z.union([z.number(), z.array(z.number())]).optional(),
  LabelingDuration: z.number().optional(),
  BackgroundSuppression: z.boolean().optional(),
  BackgroundSuppressionNumberPulses: z.number().optional(),
  BackgroundSuppressionPulseTime: z.array(z.number()).optional(),
  MRAcquisitionType: z.enum(["2D", "3D"]).optional(),
  Vendor: z.string().optional(),
  PulseSequenceType: z.enum(["spiral", "GRASE", "EPI"]).optional(),
  LabelingType: z.enum(["PASL", "CASL"]).optional(),
  Initial_PLD: z.number().optional(),
  SliceReadoutTime: z.number().optional(),
  M0: z.union([z.string(), z.number()]).optional(),
  M0Estimate: z.number().optional(),
  M0PositionInASL4D: z.array(z.number()).optional(),
  DummyScanPositionInASL4D: z.array(z.number()).optional(),
  RepetitionTimePreparationM0: z.array(z.number()).optional(),
}).passthrough(); // allow additional BIDS fields

const MetadataGroup = z.object({
  id: z.string(),
  label: z.string(),
  bidsParams: BidsMetadata,
  // Autogenerated from row selection:
  subjectRegExp: z.string(),
  sessionRegExp: z.string(),
  runRegExp: z.string(),
});

// --- Step 5: Import Execution ---
const ImportConfig = z.object({
  sourcestructure: z.object({
    folderHierarchy: z.array(z.string()),
    tokenOrdering: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    tokenSessionAliases: z.array(z.string()),
    tokenScanAliases: z.array(z.string()),
    bMatchDirectories: z.boolean(),
    dcm2nii_version: z.string().optional(),
  }),
   studyPar: z.object({
     StudyPars: z.array(z.object({
       SubjectRegExp: z.string(),
       VisitRegExp: z.string(),
       SessionRegExp: z.string(),
       RunRegExp: z.string(),
       // Zod 4: spread BidsMetadata.shape instead of .merge()
       ...BidsMetadata.shape,
     })),
   }),
});

const ImportProgress = z.object({
  subject: z.string(),
  session: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  currentStep: z.enum(["DCM2NII", "NII2BIDS"]).optional(),  // parsed from stdout
  error: z.string().optional(),   // extracted from stdout failure pattern
});
```

### Expected JSON Output: sourcestructure.json

Always 4-level, with defaults injected for Session/Run if not captured.

```json
{
  "folderHierarchy": ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"],
  "tokenOrdering": [1, 0, 2, 3],
  "tokenSessionAliases": ["^01$", "ASL_1", "^02$", "ASL_2"],
  "tokenScanAliases": ["^T1w$", "T1w", "^ASL4D$", "ASL4D", "^M0$", "M0"],
  "bMatchDirectories": true,
  "dcm2nii_version": "20220720"
}
```

Zod:

```typescript
const SourcestructureJson = z.object({
  folderHierarchy: z.array(z.string()),
  tokenOrdering: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  tokenSessionAliases: z.array(z.string()),
  tokenScanAliases: z.array(z.string()),
  bMatchDirectories: z.boolean(),
  dcm2nii_version: z.string().optional(),
});
```

### Expected JSON Output: studyPar.json

An array of metadata contexts. First entry is the catch-all (no SubjectRegExp/SessionRegExp/VisitRegExp). Subsequent entries are overrides with exact-match regex from row selection.

```json
{
  "StudyPars": [
    {
      "ArterialSpinLabelingType": "PCASL",
      "MRAcquisitionType": "3D",
      "PostLabelingDelay": [1.8],
      "LabelingDuration": 1.8,
      "BackgroundSuppression": true,
      "BackgroundSuppressionNumberPulses": 4,
      "BackgroundSuppressionPulseTime": [1.465, 2.1, 2.6, 2.88],
      "VascularCrushing": false,
      "M0": true,
      "ASLContext": "m0scan, control, label",
      "Vendor": "Siemens",
      "PulseSequenceType": "GRASE",
      "Manufacturer": "Siemens",
      "MagneticFieldStrength": 3,
      "PCASLType": "balanced",
      "TotalAcquiredPairs": 8,
      "RepetitionTimePreparation": 4000,
      "EchoTime": 0.014
    }
  ]
}
```

Zod — BIDS ASL metadata fields with conditional rendering:

```typescript
// -- REQUIRED for all ASL --
// ArterialSpinLabelingType, PostLabelingDelay, MRAcquisitionType,
// MagneticFieldStrength, EchoTime, RepetitionTimePreparation

// -- CONDITIONAL rendering rules (RHF watch()) --
// ArterialSpinLabelingType = PCASL → show PCASLType (balanced|unbalanced), LabelingDuration
// ArterialSpinLabelingType = CASL → show CASLType (single-coil|double-coil), LabelingDuration
// ArterialSpinLabelingType = PASL → show BolusCutOffFlag
// BolusCutOffFlag = true     → show BolusCutOffDelayTime, BolusCutOffTechnique
// BackgroundSuppression=true → show BackgroundSuppressionNumberPulses, BackgroundSuppressionPulseTime
// MRAcquisitionType = "2D"   → show SliceTiming

const BidsAslMetadata = z.object({
  // === Required for all ASL ===
  ArterialSpinLabelingType: z.enum(["CASL", "PCASL", "PASL"]),
  PostLabelingDelay: z.union([
    z.number(),
    z.array(z.number()),
  ]),
  MRAcquisitionType: z.enum(["2D", "3D"]),
  MagneticFieldStrength: z.number().optional(),
  EchoTime: z.number().optional(),

  // === (P)CASL required ===
  LabelingDuration: z.union([z.number(), z.array(z.number())]).optional(),

  // === (P)CASL recommended (conditional) ===
  PCASLType: z.enum(["balanced", "unbalanced"]).optional(),
  CASLType: z.enum(["single-coil", "double-coil"]).optional(),
  LabelingPulseAverageGradient: z.number().optional(),
  LabelingPulseMaximumGradient: z.number().optional(),
  LabelingPulseAverageB1: z.number().optional(),
  LabelingPulseDuration: z.number().optional(),
  LabelingPulseInterval: z.number().optional(),

  // === PASL required ===
  BolusCutOffFlag: z.boolean().optional(),

  // === PASL conditional (when BolusCutOffFlag=true) ===
  BolusCutOffDelayTime: z.union([z.number(), z.array(z.number())]).optional(),
  BolusCutOffTechnique: z.string().optional(),

  // === Recommended ===
  BackgroundSuppression: z.boolean().optional(),
  BackgroundSuppressionNumberPulses: z.number().optional(),
  BackgroundSuppressionPulseTime: z.array(z.number()).optional(),
  VascularCrushing: z.boolean().optional(),
  TotalAcquiredPairs: z.number().optional(),
  RepetitionTimePreparation: z.number().optional(),
  FlipAngle: z.union([z.number(), z.array(z.number())]).optional(),
  SliceTiming: z.array(z.number()).optional(),

  // === Vendor (REQUIRED for ASL quantification) ===
  Vendor: z.enum(["Siemens", "Philips", "GE_product", "GE_WIP"]).optional(),
  // ExploreASL applies vendor-specific scale factors. Wrong value breaks CBF quantification.
  PulseSequenceType: z.enum(["spiral", "GRASE", "EPI"]).optional(),
  Manufacturer: z.string().optional(),

  // === M0 ===
  M0: z.boolean().optional(),
  M0Type: z.enum(["separate", "integrated", "absent", "estimate"]).optional(),

  // === Other ExploreASL-specific ===
  ASLContext: z.enum(["m0scan,deltam", "control,label", "label,control", "cbf"]).optional(),
  // ExploreASL auto-detects structure from this field and generates *_aslcontext.tsv.
  // "m0scan,deltam" — Case 2: scanner exports deltaM + M0
  // "control,label"  — Case 1: scanner exports control/label pairs (control first)
  // "label,control"  — Case 1 reversed: label then control
  // "cbf"            — Case 3: scanner only exports pre-calculated CBF
  DatasetType: z.string().optional(),
  LabelingType: z.enum(["PASL", "CASL"]).optional(),
  DummyScanPositionInASL4D: z.array(z.number()).optional(),
  M0PositionInASL4D: z.array(z.number()).optional(),
  RepetitionTimePreparationM0: z.array(z.number()).optional(),

  // catch-all for unknown BIDS fields
}).passthrough();

const StudyParEntry = BidsAslMetadata.extend({
  SubjectRegExp: z.string().optional(),  // absent on catch-all entry
  VisitRegExp: z.string().optional(),
  SessionRegExp: z.string().optional(),
  RunRegExp: z.string().optional(),
});

const StudyParJson = z.object({
  StudyPars: z.array(StudyParEntry).min(1),
});
```

The modal form in Step 4 uses React Hook Form's `watch("ArterialSpinLabelingType")` to conditionally show/hide dependent fields. Implemented as:

```tsx
const aslType = watch("ArterialSpinLabelingType");
const hasBolus = watch("BolusCutOffFlag");
const hasBgSupp = watch("BackgroundSuppression");
const is2D = watch("MRAcquisitionType") === "2D";
```



## State Shape (Zustand Slices)

```typescript
interface ImportState {
  // Step 1
  pathPatterns: PathPattern[];
  ingestedPaths: string[];
  bMatchDirectories: boolean;

  // Step 2
  tokenizerConfigs: TokenizerConfig[];  // one per pattern

  // Step 3
  modalityAliases: ModalityAlias[];
  sessionAliases: SessionAlias[];
  subjectRenames: SubjectRename[];

  // Step 4
  metadataGroups: MetadataGroup[];
  subjectRows: SubjectRow[];           // all subject/session/run combos with group assignment

  // Step 5
  importProgress: Map<string, ImportProgress>;
  importRunning: boolean;
  importSummary: { succeeded: number; failed: number; errors: string[] } | null;

  // Actions
  setPathPatterns: (patterns: PathPattern[]) => void;
  setTokenizerConfig: (tc: TokenizerConfig) => void;
  setModalityAliases: (ma: ModalityAlias[]) => void;
  setSessionAliases: (sa: SessionAlias[]) => void;
  setSubjectRenames: (sr: SubjectRename[]) => void;
  addMetadataGroup: (group: MetadataGroup) => void;
  removeMetadataGroup: (id: string) => void;
  startImport: () => Promise<void>;
  updateProgress: (subject: string, progress: ImportProgress) => void;
}
```

## Tauri Commands (Rust API)

```
walk_directory(root: String, max_depth: u32, b_match_directories: bool) -> WalkResult
  Recursively walks directory tree. If b_match_directories is true: returns leaf directories containing .dcm files.
  If false: returns leaf paths where .dcm files exist directly (flat DICOM structure).
  WalkResult: { paths: Vec<String>, patterns: Vec<PathPattern> } where PathPattern contains the structural signature.

create_symlink_tree(mapping: SymlinkMapping, staging_root: String) -> ()
  Creates BIDS-compliant tree at staging_root/sourcedata/ linking back to original DICOM locations.
  SymlinkMapping: { subject, session, run, modality, source_path } per subject.
  Platform strategy:
  - Linux/macOS: POSIX symlinks via std::os::unix::fs::symlink.
  - Windows: Fallback chain per DICOM file:
    1) Try std::os::windows::fs::symlink_file (needs Developer Mode). On failure →
    2) Try std::fs::hard_link (no admin needed, same-volume only). On failure →
    3) std::fs::copy (always works, temporary overhead acceptable).
  The staging tree directories are created via mkdir regardless. Only DICOM files are linked.
  Emits progress events so the frontend shows per-file link method used.

run_import(staging_root: String, matlab_path: String, exploreasl_path: String) -> u32
  Spawns MATLAB subprocess: cd(exploreasl_path); ExploreASL(staging_root, [1,1,0], 0).
  Returns process ID. Emits ImportStdoutEvent { line: String } on each stdout/stderr line.
  IMPORTANT: Import module lock files (010_DCM2NII.status, 020_NII2BIDS.status, 999_ready.status)
  are too coarse for per-subject error detection. Parse stdout for failure patterns instead:
  "NII2BIDS failed for", "DCM2NII failed for", "ERROR:", etc. Completion is detected by
  the process exit code and "xASL_module_Import completed" in stdout.

stop_import(pid: u32) -> ()
  Sends SIGTERM to import process. Waits 5s. Sends SIGKILL if still alive.

clean_import_status(staging_root: String, subject: String) -> ()
  Deletes 010_DCM2NII.status, 020_NII2BIDS.status, and 999_ready.status for a given subject
  from <staging_root>/derivatives/ExploreASL/lock/. Called when stdout parsing detects a failure
  for that subject, to prevent ExploreASL from treating it as completed on retry.

cleanup_staging(staging_root: String) -> ()
  Recursively deletes .easl_staging/ directory.

kill_import(pid: u32) -> ()
  Sends SIGTERM to import process. Waits 5s. Sends SIGKILL if still alive.
```

Generation of `sourcestructure.json` and `studyPar.json` happens in the frontend (TypeScript). Rust only writes the generated JSON strings to disk and executes the MATLAB subprocess.

## Validation Rules

| Rule | Context |
|---|---|
| At least one .dcm file must be found | DICOM ingestion |
| Subject token tag is required (cannot all be Ignore) | Path tokenizer |
| Modality tag is required (at least one block must be Modality) | Path tokenizer |
| Each modality must be mapped to an ExploreASL type | Modality mapping |
| Session aliases must be unique (no duplicate ASL_N labels) | Session ordering |
| Subject rename targets must be valid BIDS sub- IDs | Subject renaming |
| Every subject/session/run combo must belong to exactly one MetadataGroup | Metadata grouping |
| MATLAB path must be configured in global settings | Import execution |
| ExploreASL path must be configured in global settings | Import execution |

## Error Handling

- **No DICOM files found:** "No DICOM (.dcm) files found in the provided directory tree. Check that the folders contain valid DICOM data."
- **Import failures per subject:** Frontend parses stdout for failure patterns. Known patterns: `NII2BIDS failed for`, `DCM2NII failed for`. Error message extracted from the line and shown per-subject. On detection, Rust deletes all 3 status files (`010_DCM2NII`, `020_NII2BIDS`, `999_ready`) for that subject to mark it as incomplete (ExploreASL creates them despite failure). `TODO: collect comprehensive list of import failure patterns from ExploreASL stdout.`
- **MATLAB subprocess crash:** "MATLAB process terminated unexpectedly. The staging directory has been preserved at [path] for debugging."
- **Disk full:** Mantine notification: "Import failed: insufficient disk space. Free up space and retry."
- **Symlink creation failure:** "Unable to create import structure. Check file permissions at [path]."

## Out of Scope

- DICOM header parsing for SeriesDescription-based modality detection
- Partial re-execution of failed subjects (full re-import only)
- Defacing (third import module step `DEFACE` — not exposed in V0)
- Import of NIfTI source data (DICOM only for V0)
- `dcm2nii_version` override UI (uses default)
