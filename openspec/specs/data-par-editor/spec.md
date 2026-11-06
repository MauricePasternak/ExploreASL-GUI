## Purpose

Define editing and serialization of ExploreASL dataPar configuration.

## Requirements

### Requirement: Authoritative scalar switches

The 25 scalar Switch/FlagToggle controls SHALL display two states using native-owned defaults projected through existing bindings, with explicit stored values taking precedence. These choices SHALL be GUI policy, not claims about scientific appropriateness or universal engine defaults. Sparse projects SHALL require explicit acceptance of missing choices before fresh processing. Summaries SHALL describe displayed choices without a third default state.

#### Scenario: Sparse project confirms choices

- **WHEN** the user explicitly confirms missing switch choices in Parameters
- **THEN** native acceptance SHALL store the missing proposed values while preserving all explicit and unrelated settings
- **AND** Parameters SHALL prominently explain that missing displayed choices are proposed explicit overrides, with one explicit confirmation action submitting only missing defaults merged with accepted values through the existing Parameters edit
- **AND** inspection, opening, ordinary save, unrelated edits and individual switch edits SHALL NOT fill other missing choices
- **AND** complete configurations SHALL NOT require confirmation
- **AND** assembly SHALL preserve explicit false/zero without injecting defaults

#### Scenario: New project uses explicit choices

- **WHEN** a new project reaches Parameters
- **THEN** PVC SHALL display Off and all scoped switches SHALL have typed explicit values matching the native policy
- **AND** new projects SHALL store numeric 0/1 for bRegisterM02ASL, M0_conventionalProcessing, DELETETEMP, motionCorrection, bPVCNativeSpace, bUseMNIasDummyStructural, bRunLongReg, bRunDARTEL, bSegmentSPM12 and bHammersCAT12; only motionCorrection SHALL initially be 1
- **AND** boolean bAutomaticallyDetectFSL and bAutomaticallyDetectVABY SHALL initially be true; bUseExternalQuantification, bMaskingExternal, bSpatialBASIL, bInferT1BASIL, bInferATTBASIL, bCleanUpExternal, bLesionFilling, bAutoACPC, enableMetadataGroupingCorrection, bTopUp, SaveCBF4D, bWMH and bFixResolution SHALL initially be false
- **AND** selectors including Flat/Gaussian, numeric/text fields, arrays, tuple checkboxes, advanced visibility and hidden SkipIfNo fields SHALL remain outside this policy

#### Scenario: Confirmation fails or becomes stale

- **WHEN** confirmation fails or a replacement project activates before its response
- **THEN** shared error/unsaved behavior SHALL apply only to the originating lifecycle and unrelated drafts SHALL remain intact
- **AND** confirmation SHALL preserve unrelated values, drafts and errors and follow shared pending, save, failure and lifecycle rules; a stale response SHALL NOT mutate a replacement project

### Requirement: DataPar parameter state schema

The system SHALL represent supported flat DataPar settings through the shared current project contract with optional fields named exactly as ExploreASL requires. Known types, numeric flag representations, array sizes, and supported ranges SHALL validate before configuration acceptance. Unknown loose scientific extension keys SHALL survive `.easl` project load, accepted edits, save, and reopen; this persistence guarantee SHALL NOT imply inclusion in nested outbound processing JSON, whose assembly enumerates supported keys only. UI panels SHALL remain M0, Quantification, General Settings, ASL Processing, Atlases, Structural, and Environment. Form placeholders SHALL not inject processing defaults; ordinary editing SHALL not require a complete execution-ready configuration.

#### Scenario: Empty state produces minimal JSON

- **WHEN** no DataPar field is explicitly set
- **THEN** existing scientific assembly SHALL produce `{ "x": {} }`

#### Scenario: Explicitly set field appears in output

- **WHEN** only `bTopUp` is explicitly true
- **THEN** existing scientific assembly SHALL produce `{ "x": { "modules": { "asl": { "bTopUp": true } } } }`

#### Scenario: Scientific extension survives project persistence only

- **WHEN** a project contains unknown `dataPar.vendor = { "nested": [true, null, 3] }` and the user edits a supported field, saves, and reopens
- **THEN** `.easl` SHALL retain the unknown extension unchanged
- **AND** `assembleDataPar` SHALL NOT include that unknown key in the outbound nested processing JSON

### Requirement: Field metadata constant

The system SHALL define `FIELD_METADATA` for field labels, help, hints and non-switch defaults. Scalar switch choices SHALL come only from native-owned defaults projected through the existing bindings generator. Parameter components SHALL own section placement, basic/advanced grouping, widget selection and conditional visibility without duplicating those descriptors in `FIELD_METADATA`. Descriptions SHALL match operative meanings and units in the audited ExploreASL checkout `6dafdba4cd2333eede4525d05f110b1cfa3f63c6`, identified by `VERSION_2.0.0_BETA`; this SHALL NOT imply support across all releases. Hints SHALL distinguish explicit GUI policy from fixed or data-dependent MATLAB defaults. Metadata hints SHALL NOT populate unset processing fields.

FSL help SHALL describe the explicit initially on choice and MATLAB's automatic search when no FSL directory is already available. Lesion-filling help SHALL distinguish the explicit initially off choice from MATLAB's true default when unset. VABY discovery help SHALL state that the audited checkout does not implement automatic discovery and requires configured `x.external.VABYdir` for requested VABY quantification; existing discovery flag values SHALL remain preserved. Legacy ATT inference SHALL retain its checkout-specific unsupported warning.

#### Scenario: Toggle field metadata

- **WHEN** `bTopUp` metadata is accessed
- **THEN** help SHALL explain that the explicit initially off choice overrides automatic data-dependent TopUp selection

### Requirement: M0 field widget

The `x.Q.M0` field SHALL be rendered as a Mantine `Select` with options: `separate_scan` ("Separate M0 scan"), `UseControlAsM0` ("Use control as M0"), `Absent` ("Absent — skip M0 processing"), and a fourth option `__custom__` ("Custom value"). Selecting `__custom__` SHALL reveal a `NumberInput` for the numeric M0 value. A fresh project's unset M0 SHALL display no selection and the placeholder "Select M0 source", not select `Absent`. Display hints and ExploreASL runtime defaults SHALL NOT populate the field.

#### Scenario: Fresh project has no M0 selection

- **WHEN** a fresh project opens with M0 unset
- **THEN** the dropdown SHALL display "Select M0 source" and processing assembly SHALL omit `x.Q.M0`

#### Scenario: User selects UseControlAsM0

- **WHEN** user selects "Use control as M0" from the M0 dropdown
- **THEN** state field `M0` is set to `"UseControlAsM0"`, no number input appears

#### Scenario: User selects custom value

- **WHEN** user selects "Custom value" from the M0 dropdown and enters 3739400
- **THEN** state field `M0` is set to `3739400`

#### Scenario: User switches from custom to Absent

- **WHEN** user changes M0 selection from "Custom value" to "Absent"
- **THEN** state field `M0` is set to `"Absent"`, any previously entered custom number is discarded

#### Scenario: Conditional field not shown

- **WHEN** the M0 section is displayed with `M0` set to "Absent"
- **THEN** the pulse-time control SHALL be hidden

#### Scenario: Conditional field shown

- **WHEN** the M0 section is displayed with `M0` set to "UseControlAsM0" AND `BackgroundSuppressionNumberPulses` > 0
- **THEN** the pulse-time control SHALL appear with milliseconds as its processing unit

### Requirement: ApplyQuantification checkbox group

The `x.modules.asl.ApplyQuantification` field SHALL be rendered as 6 labeled checkboxes, in order: "Apply pixel intensity scaling to ASL timeseries", "Apply pixel intensity scaling to M0 image", "Convert perfusion-weighted signal to label volume", "Calibrate M0 intensity (correct T1 relaxation)", "Divide perfusion signal by M0", "Apply global scaling factors to final CBF map". A "Select all" / "Deselect all" toggle SHALL be shown above the group. An unset value SHALL display all checked without writing a default.

#### Scenario: User deselects step 5

- **WHEN** user unchecks "Divide perfusion signal by M0"
- **THEN** state field `ApplyQuantification` is set to `[1, 1, 1, 1, 0, 1]`

#### Scenario: Deselect all then select individual steps

- **WHEN** user clicks "Deselect all" then checks steps 3 and 4
- **THEN** state field `ApplyQuantification` is set to `[0, 0, 1, 1, 0, 0]`

### Requirement: Atlas multi-select with paired masking

The `x.S.Atlases` field SHALL use a multi-select grouped into free and non-commercial-only atlases. A fresh project's unset `Atlases` SHALL display an empty selection, not preselect `["Total", "DeepWM"]`; hints or runtime defaults SHALL NOT populate it. Each selected atlas SHALL have paired `TissueMasking` and `TissueThreshold` controls with aligned indices. Tissue choices SHALL include GM, WM, CSF, GM+WM and GM+WM+CSF. `TissueThreshold` SHALL be a unitless probability from 0 to 1, with GUI initial value 0.7, not a volume. Only `MinimalROIVolume` SHALL use mL. ROI mask controls SHALL emit the existing four-element 0/1 tuple representation, including all-on and all-off selections.

#### Scenario: Fresh project has no selected atlases

- **WHEN** a fresh project opens with `Atlases` unset
- **THEN** the multi-select SHALL have no selected atlases, paired atlas controls SHALL be absent, and processing assembly SHALL omit `x.S.Atlases`

#### Scenario: User selects Thalamus atlas with GM masking

- **WHEN** user adds "Thalamus" to the atlas list and sets TissueMasking to "GM"
- **THEN** `Atlases` includes "Thalamus", `TissueMasking` array has a "GM" entry at the same index, `TissueThreshold` has 0.7 at that index

#### Scenario: User removes an atlas

- **WHEN** user removes "DeepWM" from the atlas list
- **THEN** corresponding TissueMasking and TissueThreshold entries are removed, remaining entries stay aligned

#### Scenario: User deselects all masks

- **WHEN** user deselects all ROI masks
- **THEN** state SHALL contain `bMasking = [0, 0, 0, 0]`, accepted by project persistence

### Requirement: PVC conditional reveal

PVC SHALL initially be explicitly Off for new projects; missing values in existing sparse projects SHALL display proposed Off without mutation until explicit acceptance. When displayed on, advanced controls SHALL reveal the optional `bPVCGaussianMM` selector and three-dimensional kernel. Flat kernel dimensions SHALL use voxels and `[5, 5, 1]`; Gaussian FWHM SHALL use mm and `[10, 10, 4]` when no explicit kernel exists. Explicit kernels SHALL survive shape changes. Current persisted PVC flags SHALL use numeric 0/1 only; legacy boolean normalization SHALL not occur during project reading.

#### Scenario: User enables PVC without Gaussian

- **WHEN** PVC is enabled without Gaussian mode
- **THEN** the unset kernel display SHALL show `[5, 5, 1]` in voxels

#### Scenario: User enables Gaussian PVC

- **WHEN** Gaussian mode is enabled without an explicit kernel
- **THEN** the display SHALL show `[10, 10, 4]` in mm without injecting an unset kernel

#### Scenario: Boolean PVC flag is rejected rather than normalized

- **WHEN** a current project document contains `bPVCGaussianMM = true` or `false`
- **THEN** parsing SHALL reject that field rather than normalize it to numeric 1 or 0

### Requirement: Basic/advanced toggle

M0, Quantification, General Settings, ASL Processing, and Atlases SHALL each contain a local "Show advanced" sub-divider, with advanced fields initially hidden. Their local visibility flags SHALL remain independent of the global "Show advanced parameter sections" toggle. The global toggle SHALL gate only the Structural and Environment accordion sections; when those panels are opened, their controls SHALL appear directly without a local advanced sub-divider. Global and local flags SHALL persist under `.easl` `uiState.datapar.advancedVisibility`, with the global flag named `showAdvancedSections`, across page navigation and app restarts.

#### Scenario: User enables global advanced toggle

- **WHEN** user clicks "Show advanced parameter sections"
- **THEN** Structural and Environment accordion panels SHALL appear, with their controls directly available when each panel is opened

#### Scenario: User disables global advanced toggle

- **WHEN** user disables "Show advanced parameter sections"
- **THEN** Structural and Environment panels SHALL disappear while remaining panels retain their local advanced visibility flags and all previously-set field values SHALL be preserved

#### Scenario: Local advanced controls remain independent

- **WHEN** global advanced sections are off and the user enables "Show advanced" in Atlases
- **THEN** the Atlases advanced controls SHALL appear while Structural and Environment remain hidden

### Requirement: Ghost placeholder defaults

Persisted processing fields SHALL remain optional for sparse-project compatibility. Non-switch empty inputs SHALL display a hint from `FIELD_METADATA.defaultHint` without writing its value. Hints SHALL qualify magnetic-field-dependent relaxation constants and other data-dependent choices instead of asserting universal runtime defaults. Clearing a field to undefined SHALL omit it from outbound JSON; an explicitly stored empty array SHALL remain defined and SHALL be emitted. In particular, clearing the `DataTypes` text input SHALL store `[]`, not undefined, and processing assembly SHALL preserve `x.S.DataTypes = []`. Scalar switch acceptance SHALL follow Authoritative scalar switches; selectors, arrays, numeric fields and hidden SkipIfNo fields SHALL remain optional.

#### Scenario: User sees default for T1blood

- **WHEN** T1blood field is empty
- **THEN** its placeholder SHALL identify 1650 ms as a 3 T reference and SHALL NOT write that value to state

#### Scenario: User clears a field

- **WHEN** user clears the T1blood input
- **THEN** state SHALL become undefined, the hint SHALL reappear and outbound JSON SHALL omit T1blood

#### Scenario: Clearing DataTypes preserves an explicit empty array

- **WHEN** the user clears the `DataTypes` text input
- **THEN** accepted state and `.easl` SHALL retain `DataTypes = []` and outbound JSON SHALL contain `x.S.DataTypes = []`

### Requirement: DataPar assembly function

The system SHALL convert supported flat optional project settings into nested ExploreASL JSON, preserving explicit numbers, arrays (including empty arrays), zero and false while omitting undefined fields and empty sections. Unknown scientific extension keys preserved in `.easl` SHALL NOT be copied into outbound JSON. The assembly SHALL use these destinations:

| Destination            | Flat GUI keys                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x`                    | `WMHsegmAlg`                                                                                                                                                                                                |
| `x.modules`            | `bRunLongReg`, `bRunDARTEL`                                                                                                                                                                                 |
| `x.Q`                  | `M0`, `nCompartments`, `Lambda`, `T2art`, `T1blood`, `T1GM`, `T1WM`, `T2GM`, `T2WM`, `T2tissueMultiTE`, `BackgroundSuppressionNumberPulses`, `BackgroundSuppressionPulseTime`                               |
| `x.modules.asl`        | `M0_GMScaleFactor`, `bRegisterM02ASL`, `M0_conventionalProcessing`, all external quantification settings, motion, distortion, PVC, registration, hematocrit, spike-removal and quantification-step settings |
| `x.modules.structural` | `bSegmentSPM12`, `bHammersCAT12`, `bFixResolution`                                                                                                                                                          |
| `x.settings`           | `Quality`, `DELETETEMP`, `SkipIfNoFlair`, `SkipIfNoASL`, `SkipIfNoM0`, `bLesionFilling`, `bAutoACPC`                                                                                                        |
| `x.S`                  | `Atlases`, `TissueMasking`, `TissueThreshold`, `bMasking`, `MinimalROIVolume`, `bWMH`, `DataTypes`                                                                                                          |
| `x.external`           | `bAutomaticallyDetectFSL`, `bAutomaticallyDetectVABY`                                                                                                                                                       |

The legacy `RepetitionTimePreparationM0` key SHALL remain preserved under `x.Q` for saved-project compatibility, with help stating that the audited processing code has no operative reader. `bInferATTBASIL` SHALL remain preserved under its deprecated-map destination `x.modules.asl`, with help stating that the audited checkout has no operative reader. It SHALL NOT be converted to `bInferArtBASIL`. Existing Methods flattening SHALL continue to read relocated explicit root/module options without a Methods redesign. Native request validation SHALL admit `x.WMHsegmAlg`.

#### Scenario: Multiple sections produce correct nesting

- **WHEN** state has `bTopUp = true`, `Quality = 0`, `Lambda = 0.9`, `Atlases = ["Total"]`
- **THEN** output is `{ "x": { "modules": { "asl": { "bTopUp": true } }, "settings": { "Quality": 0 }, "Q": { "Lambda": 0.9 }, "S": { "Atlases": ["Total"] } } }`

#### Scenario: Empty section is omitted

- **WHEN** no ASL settings are set but `bRunLongReg = 1`
- **THEN** output SHALL contain `x.modules.bRunLongReg = 1` without empty ASL or structural sections

### Requirement: Write timing — dataPar.json at processing time

Edits SHALL persist as flat optional settings under `.easl` `dataPar`; parameter edits SHALL NOT write processing JSON. Processing submission SHALL assemble those settings in the frontend request. Native preparation SHALL add per-run dataset/path parameters and write `<root>/derivatives/ExploreASL/dataPar.json` from the admitted request without relocating or dropping scientific settings. Corrected assembly SHALL NOT rewrite existing projects or require a migration.

#### Scenario: User edits parameters without running processing

- **WHEN** user edits `bTopUp` and the normal project save completes
- **THEN** `.easl` SHALL contain flat `dataPar.bTopUp` and processing JSON SHALL remain unchanged

#### Scenario: User starts processing

- **WHEN** user clicks "Start Processing"
- **THEN** explicit supported values SHALL reach the assembled request and processing JSON at their operative destinations

### Requirement: Parameter route

The parameter route SHALL retain its existing accordion panels and previously accepted values. Valid field interactions SHALL submit to the shared configuration owner without a page-owned copy delay; unfinished input SHALL remain a draft. Phase navigation and Save SHALL flush pending submissions before leaving. Current optional-setting, atlas pairing, advanced visibility, scientific assembly, and field-help behavior SHALL remain unchanged.

#### Scenario: User navigates to parameters page

- **WHEN** the parameter route opens
- **THEN** five basic panels SHALL display alongside enabled advanced panels and saved values

#### Scenario: User changes a field and navigates away

- **WHEN** Quality changes from unset to 0 and the user immediately visits Processing
- **THEN** Quality 0 SHALL persist and remain available without waiting for a parameter-page timer

### Requirement: (?) Tooltip pattern for field labels

Each rendered processing field SHALL display an information icon with metadata help in a multiline tooltip. Help SHALL distinguish WMH ROI inclusion from segmentation, numeric M0 scalar calibration from an image, relative t-statistic improvement from a Z-score, and absolute motion threshold in mm from signal intensity. Providing absolute threshold 0 SHALL NOT be described as disabling fixed-threshold removal. Registration contrast choices SHALL describe 0 as control-to-T1w, 1 as CBF/PWI-to-pseudoCBF, 2 as automatic combined registration and 3 as combined registration with forced CBF attempts.

#### Scenario: User hovers over bTopUp label

- **WHEN** user hovers over the TopUp information icon
- **THEN** help SHALL describe explicit Off overriding automatic selection, including reversed phase-encoding scans and session-merging exceptions

#### Scenario: User inspects WMH ROI help

- **WHEN** user inspects `bWMH` help
- **THEN** it SHALL explain inclusion of existing WMH voxels in ROI masks, not WMH detection

### Requirement: External quantification conditional subtree

When `bUseExternalQuantification` is explicitly on, advanced controls SHALL reveal engine selection BASIL/FABBER/VABY, optional decimal FWHM smoothing widths in mm, masking, BASIL options and cleanup. Unset smoothing SHALL NOT display a fixed `[5, 5, 1]` runtime default or request additional smoothing. Engine hints SHALL describe data-dependent selection when unset. BASIL exchange choices SHALL remain mix/simple/2cpt/spa and dispersion choices none/gamma/gauss/sgauss. ATT prior standard deviation SHALL use seconds. Legacy ATT inference SHALL carry checkout-specific unsupported help while preserving saved values.

#### Scenario: User enables external quantification

- **WHEN** user toggles `bUseExternalQuantification` on
- **THEN** the engine and advanced controls SHALL appear without injecting their placeholders into state

#### Scenario: User selects VABY

- **WHEN** user selects "VABY" as ExternalQuantificationType
- **THEN** BASIL controls SHALL remain visible for compatibility without claiming they operate for that engine
