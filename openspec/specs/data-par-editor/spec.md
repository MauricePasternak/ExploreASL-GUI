## ADDED Requirements

### Requirement: DataPar parameter state schema

The system SHALL define a Zod schema `DataParSchema` representing all dataPar.json fields in scope, using `.optional()` for every field. Field names SHALL match ExploreASL's exact JSON keys (e.g., `bTopUp`, `Initial_PLD`, `bPVCNativeSpace`). The schema SHALL be organized into sections matching the UI accordion panels: M0, Quantification, GeneralSettings, ASLProcessing, Atlases, Structural, Environment.

#### Scenario: Empty state produces minimal JSON

- **WHEN** all DataParSchema fields are undefined
- **THEN** the assembly function produces `{ "x": {} }` with no keys

#### Scenario: Explicitly set field appears in output

- **WHEN** `bTopUp` is set to `true` and all other fields are undefined
- **THEN** the assembly function produces `{ "x": { "modules": { "asl": { "bTopUp": true } } } }`

### Requirement: Field metadata constant

The system SHALL define a `FIELD_METADATA` constant mapping each dataPar field key to: `label` (human-readable display name), `description` (tooltip text from ExploreASL docs), `defaultHint` (ExploreASL default shown as placeholder), `section` (accordion section ID), `tier` ("basic" | "advanced"), `condition` (optional function receiving full state that returns boolean for conditional reveal), and `widget` (control type: "toggle" | "number" | "select" | "checkboxGroup" | "tags" | "numberTuple" | "selectWithCustom").

#### Scenario: Toggle field metadata

- **WHEN** `bTopUp` metadata is accessed
- **THEN** `label` is "FSL TopUp correction", `tier` is "basic", `widget` is "toggle", `defaultHint` is "true"

#### Scenario: Conditional field not shown

- **WHEN** `BackgroundSuppressionPulseTime` metadata `condition` is evaluated with state where `M0` is "Absent"
- **THEN** condition returns `false`

#### Scenario: Conditional field shown

- **WHEN** `BackgroundSuppressionPulseTime` metadata `condition` is evaluated with state where `M0` is "UseControlAsM0" AND `BackgroundSuppressionNumberPulses` > 0
- **THEN** condition returns `true`

### Requirement: M0 field widget

The `x.Q.M0` field SHALL be rendered as a Mantine `Select` with options: `separate_scan` ("Separate M0 scan"), `UseControlAsM0` ("Use control as M0"), `Absent` ("Absent — skip M0 processing"), and a fourth option `__custom__` ("Custom value"). Selecting `__custom__` SHALL reveal a `NumberInput` for the numeric M0 value. The default SHALL be `Absent`.

#### Scenario: User selects UseControlAsM0

- **WHEN** user selects "Use control as M0" from the M0 dropdown
- **THEN** state field `M0` is set to `"UseControlAsM0"`, no number input appears

#### Scenario: User selects custom value

- **WHEN** user selects "Custom value" from the M0 dropdown and enters 3739400
- **THEN** state field `M0` is set to `3739400`

#### Scenario: User switches from custom to Absent

- **WHEN** user changes M0 selection from "Custom value" to "Absent"
- **THEN** state field `M0` is set to `"Absent"`, any previously entered custom number is discarded

### Requirement: ApplyQuantification checkbox group

The `x.modules.asl.ApplyQuantification` field SHALL be rendered as 6 labeled checkboxes, each corresponding to one quantification step in order: "Apply ScaleSlopes ASL4D", "Apply ScaleSlopes M0", "Convert PWI a.u. to label", "Quantify M0 a.u.", "Perform division by M0", "Apply all scaling". A "Select all" / "Deselect all" toggle SHALL be shown above the group. Default SHALL be all checked.

#### Scenario: User deselects step 5

- **WHEN** user unchecks "Perform division by M0"
- **THEN** state field `ApplyQuantification` is set to `[1, 1, 1, 1, 0, 1]`

#### Scenario: Deselect all then select individual steps

- **WHEN** user clicks "Deselect all" then checks steps 3 and 4
- **THEN** state field `ApplyQuantification` is set to `[0, 0, 1, 1, 0, 0]`

### Requirement: Atlas multi-select with paired masking

The `x.S.Atlases` field SHALL be rendered as a Mantine `MultiSelect` with optgroups for "Free" and "Non-commercial only" atlases. Default selection SHALL be `["Total", "DeepWM"]`. For each selected atlas, a paired row SHALL appear showing `TissueMasking` (select: GM, WM, CSF, GM+WM, GM+WM+CSF) and `TissueThreshold` (NumberInput with "mL" suffix, default 0.7).

#### Scenario: User selects Thalamus atlas with GM masking

- **WHEN** user adds "Thalamus" to the atlas list and sets TissueMasking to "GM"
- **THEN** `Atlases` includes "Thalamus", `TissueMasking` array has a "GM" entry at the same index, `TissueThreshold` has 0.7 at that index

#### Scenario: User removes an atlas

- **WHEN** user removes "DeepWM" from the atlas list
- **THEN** corresponding TissueMasking and TissueThreshold entries are removed, remaining entries stay aligned

### Requirement: PVC conditional reveal

When `bPVCNativeSpace` is toggled on, the UI SHALL reveal `bPVCGaussianMM` (toggle, default off) and `PVCNativeSpaceKernel` (3 NumberInput fields labeled X, Y, Z). When `bPVCGaussianMM` is off, kernel labels SHALL show "Kernel size (voxels)" with default [5, 5, 1]. When `bPVCGaussianMM` is on, labels SHALL change to "Kernel FWHM (mm)" with default [10, 10, 4]. The GUI default for `bPVCNativeSpace` SHALL be `true` (overriding ExploreASL's default of 0).

#### Scenario: User enables PVC without Gaussian

- **WHEN** user toggles `bPVCNativeSpace` on and leaves `bPVCGaussianMM` off
- **THEN** PVCNativeSpaceKernel shows as [5, 5, 1] with label "Kernel size (voxels)"

#### Scenario: User enables Gaussian PVC

- **WHEN** user toggles `bPVCGaussianMM` on
- **THEN** PVCNativeSpaceKernel defaults change to [10, 10, 4] and label changes to "Kernel FWHM (mm)"

### Requirement: Basic/advanced toggle

Each accordion section SHALL contain a "Show advanced" sub-divider. Basic-tier fields are visible by default. Toggling "Show advanced" within a section reveals advanced-tier fields. The Structural and Environment sections SHALL NOT appear at all unless a global "Show advanced parameter sections" toggle (persisted in `uiState.showAdvancedParameters`) is enabled. The toggle state SHALL persist across page navigation and app restarts via the `.easl` project file.

#### Scenario: User enables global advanced toggle

- **WHEN** user clicks "Show advanced parameter sections"
- **THEN** Structural and Environment accordion panels appear, and each panel's advanced sub-fields become expandable

#### Scenario: User disables global advanced toggle

- **WHEN** user disables "Show advanced parameter sections"
- **THEN** Structural and Environment panels disappear, advanced sub-fields in remaining panels are hidden, but any previously-set advanced field values are preserved

### Requirement: Ghost placeholder defaults

All dataPar fields SHALL use Zod `.optional()`. When a field is empty (undefined), the input SHALL display the ExploreASL documented default as gray placeholder text. Only explicitly set values SHALL be written to dataPar.json. Placeholder text SHALL be sourced from `FIELD_METADATA.defaultHint`.

#### Scenario: User sees default for T1blood

- **WHEN** T1blood field is empty
- **THEN** input shows gray placeholder "1650" with a "(?)" tooltip explaining "T1 relaxation time of arterial blood (ms). Defaults (Alsop MRM 2014). @3T: 1650"

#### Scenario: User clears a field

- **WHEN** user clears the T1blood input
- **THEN** state field `T1blood` becomes `undefined`, the placeholder "1650" reappears, and the field will be omitted from the written dataPar.json

### Requirement: DataPar assembly function

The system SHALL provide an `assembleDataPar(state: DataParState): DataParJson` function that converts the flat Zod-validated state into the nested `x.*` JSON structure matching ExploreASL's expected format. The function SHALL omit undefined fields, producing a minimal JSON. Nested structure: `x.Q.*`, `x.modules.asl.*`, `x.modules.structural.*`, `x.settings.*`, `x.S.*`, `x.external.*`.

#### Scenario: Multiple sections produce correct nesting

- **WHEN** state has `bTopUp = true`, `Quality = 0`, `Lambda = 0.9`, `Atlases = ["Total"]`
- **THEN** output is `{ "x": { "modules": { "asl": { "bTopUp": true } }, "settings": { "Quality": 0 }, "Q": { "Lambda": 0.9 }, "S": { "Atlases": ["Total"] } } }`

#### Scenario: Empty section is omitted

- **WHEN** no ASL processing fields are set
- **THEN** output has no `"modules": { "asl": {} }` key — the `"asl"` key is omitted entirely

### Requirement: Write timing — dataPar.json at processing time

The dataPar.json file SHALL NOT be written to disk on every field change. Edits SHALL be persisted to `.easl` under `dataPar` immediately. The Rust backend SHALL merge `.easl` dataPar state with per-run dataset params and write the combined result to `<root>/derivatives/ExploreASL/dataPar.json` only when "Start Processing" is invoked.

#### Scenario: User edits parameters without running processing

- **WHEN** user toggles bTopUp and navigates away
- **THEN** `.easl` file contains `{ "dataPar": { "modules": { "asl": { "bTopUp": true } } } }` but `dataPar.json` on disk is unchanged

#### Scenario: User starts processing

- **WHEN** user clicks "Start Processing"
- **THEN** Rust reads `.easl` dataPar, merges with dataset params, writes combined result to `dataPar.json`, then spawns MATLAB

### Requirement: Parameter route

The `/project/:id/parameters` route SHALL render a page containing the dataPar editor — an accordion-based form with sections: M0 Configuration, Quantification, General Settings, ASL Processing, Atlases, Structural (advanced-only), Environment (advanced-only). The form SHALL load existing values from `.easl` project state on mount and save changes on every field interaction.

#### Scenario: User navigates to parameters page

- **WHEN** user navigates to `/project/abc123/parameters`
- **THEN** the page loads with 5 basic accordion panels (M0, Quantification, General Settings, ASL Processing, Atlases) and any previously saved values pre-filled

#### Scenario: User changes a field and navigates away

- **WHEN** user changes Quality from undefined to 0 and navigates to processing page
- **THEN** the change is persisted to `.easl` and available when returning to the parameters page

### Requirement: (?) Tooltip pattern for field labels

Each dataPar field label SHALL display a blue "(?)" icon next to it. Clicking or hovering the icon SHALL show a Mantine `Tooltip` with the field's description from `FIELD_METADATA.description`. The pattern SHALL follow the existing `BidsFieldLabel` component used in the import metadata modal, using `IconInfoCircle` with a 320px-wide multiline tooltip.

#### Scenario: User hovers over bTopUp label

- **WHEN** user hovers over "FSL TopUp correction (?)"
- **THEN** tooltip displays: "True to explicitly turn ON or OFF the FSL TopUp option if the M0 scan with reversed phase encoding direction is present. Default: true, but turned off when merging several ASL sessions."

### Requirement: External quantification conditional subtree

When `bUseExternalQuantification` is toggled on, the UI SHALL reveal: `ExternalQuantificationType` (select: BASIL | FABBER | VABY), `ExternalQuantificationSmoothGaussianMM` (3 NumberInput fields for FWHM mm), `bMaskingExternal` (toggle), `bSpatialBASIL` (toggle), `bInferT1BASIL` (toggle), `bInferATTBASIL` (toggle), `ExchBASIL` (select: mix | simple | 2cpt | spa), `DispBASIL` (select: none | gamma | gauss | sgauss), `ATTSDBASIL` (NumberInput), `bCleanUpExternal` (toggle). All external quantification fields are advanced-tier.

#### Scenario: User enables external quantification

- **WHEN** user toggles `bUseExternalQuantification` on
- **THEN** ExternalQuantificationType select appears with default "BASIL", and all BASIL-specific options appear below it

#### Scenario: User selects VABY

- **WHEN** user selects "VABY" as ExternalQuantificationType
- **THEN** all BASIL-specific fields (bSpatialBASIL, bInferT1BASIL, bInferATTBASIL, ExchBASIL, DispBASIL, ATTSDBASIL) remain visible (they may still apply depending on backend)
