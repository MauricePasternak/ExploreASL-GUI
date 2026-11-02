# data-vis-scan-comparison Specification

## Purpose

Provide spatial context and scan-to-scan comparison during exploratory visualization without adding a second QC decision workflow.

## Requirements

### Requirement: Bounded companion modes

Visualize SHALL offer Off, Structural, and Pinned companion modes, defaulting to Off. The primary pane SHALL display selected qCBF; Structural SHALL display its corresponding rT1; Pinned SHALL display the pinned qCBF. At most two canvases SHALL exist, each displaying one volume without overlays. Pane headers SHALL identify modality, Subject, Session, and applicable Run. Narrow layouts SHALL stack panes with accessible controls and distinct test identifiers.

#### Scenario: Inspect anatomy

- **WHEN** Structural is selected for `sub-01_1`, Run `ASL_1`
- **THEN** primary qCBF SHALL remain visible beside or above `rT1_sub-01_1`, without loading another subject's anatomy

#### Scenario: Hide companion

- **WHEN** Off is selected
- **THEN** the companion canvas SHALL be released and the primary pane SHALL retain its scan and navigation

#### Scenario: Resize comparison workspace

- **WHEN** available content width changes, including after navigation expansion
- **THEN** wide layouts SHALL give the comparison pair more width than the chart; intermediate layouts SHALL place the chart above paired viewers; narrow comparison containers SHALL stack viewers without horizontal overflow or recreating them
- **AND** short windows SHALL allow vertical content scrolling rather than shrinking canvases below a usable minimum

#### Scenario: Align paired image areas

- **WHEN** pane headers wrap differently or qCBF hover/shared-window text changes
- **THEN** side-by-side panes SHALL retain equal canvas dimensions and aligned canvas tops and bottoms through shared header/image/footer rows

### Requirement: One independent pinned reference

Pin current SHALL capture raw participant identifier, Run, and display identifiers independently of later selection and SHALL activate Pinned mode. Replacing the pin SHALL replace scan identity, not a screenshot or camera. Unpin SHALL clear the reference and return Pinned mode to Off. Pinned SHALL be unavailable without a pin.

#### Scenario: Compare another point

- **WHEN** scan A is pinned and point B is clicked
- **THEN** primary SHALL display B, companion SHALL retain A, and the pin SHALL remain associated with A

#### Scenario: Inspect anatomy without losing reference

- **WHEN** a pin exists and mode changes to Off or Structural, then back to Pinned
- **THEN** Off and Structural SHALL preserve the pin, Structural SHALL follow current selection, and Pinned SHALL restore the original reference identity

#### Scenario: Locate the reference

- **WHEN** filtering changes whether the pinned point is visible
- **THEN** a visible pin SHALL have a distinct chart marker without recoloring categorical groups or styling selected points; a hidden pin SHALL remain identified in comparison controls

### Requirement: Spatial navigation linking

Link navigation SHALL default to enabled. With two loaded panes, crosshair position and 2D pan/zoom SHALL synchronize bidirectionally using world millimeters, not matching voxel indices. Initial companion loading and scan replacement SHALL preserve the primary world-space location. Disabling linking SHALL permit independent navigation. Equal coordinates SHALL NOT be presented as proof of accurate registration; no registration or resampling SHALL run in this stage.

#### Scenario: Corresponding anatomical position

- **WHEN** linked primary navigation changes with Structural loaded
- **THEN** companion SHALL show the corresponding world location even when voxel grids differ, without copying CBF intensity limits to T1

#### Scenario: Independent navigation

- **WHEN** linking is disabled and one pane is navigated
- **THEN** the other pane's navigation SHALL remain unchanged

### Requirement: Optional shared CBF window

Share CBF window SHALL default to off and SHALL be available only with two loaded qCBF panes in Pinned mode. It SHALL synchronize numeric display limits, not voxel values or NIfTI scaling. Structural SHALL retain an independent grayscale window. Unpin or pin replacement SHALL reset sharing to off.

#### Scenario: Compare absolute intensities

- **WHEN** sharing is enabled with a reference pinned
- **THEN** both qCBF panes SHALL use the pinned image's current numeric display limits and display their CBF scale

#### Scenario: Keep shared limits current

- **WHEN** either shared qCBF window changes or primary qCBF is replaced
- **THEN** both panes SHALL use the latest shared limits, including on replacement primary images

#### Scenario: Protect structural contrast

- **WHEN** Structural replaces a shared-window qCBF companion
- **THEN** sharing SHALL suspend and rT1 SHALL use its own intensity window, not the CBF limits

### Requirement: Two-dimensional voxel hover readout

Hover over a loaded qCBF slice SHALL display the nearest voxel's scaled CBF in mL/100g/min and world coordinates in millimeters without moving the crosshair. Sampling SHALL use loaded voxel data, not displayed colors. Readout updates SHALL occur only for changed sampled voxels and at most once per animation frame.

#### Scenario: Scaled hover value

- **WHEN** the pointer enters a valid slice voxel whose stored value is 20 with slope 2 and intercept 10
- **THEN** readout SHALL display CBF 50 mL/100g/min at that voxel's world coordinates without changing navigation

#### Scenario: Local-only sampling

- **WHEN** hover events occur over a slice
- **THEN** sampling SHALL preserve zero and negative values and SHALL NOT issue filesystem/IPC/network requests or trigger full-volume processing or synchronized scene redraws

#### Scenario: Invalid or ambiguous location

- **WHEN** the pointer is outside volume coverage, over non-finite or unloaded data, over a 3D tile, or off-canvas
- **THEN** readout SHALL show an em dash rather than a stale or clamped edge value

### Requirement: Compact source-aware measurement card

With a selected point, Visualize SHALL show Subject/Session/Run, source filename, X/Y names and values, and available included qCBF-source mean motion. Inspection metadata SHALL determine units and distinguish mean, median, and CoV sources. Missing values SHALL show an em dash. The card SHALL NOT import QC JSON, assign ratings or thresholds, or alter exclusions or processing.

#### Scenario: CoV source is not CBF

- **WHEN** the selected Y is `Total_GM_B` from a CoV table with units `SD/mean`
- **THEN** the card SHALL show that source and unit, not mL/100g/min

#### Scenario: Joined motion provenance

- **WHEN** a join renames qCBF-source `MeanMotion` and supplies an external motion column
- **THEN** the card SHALL select the included qCBF column by its original name and metadata units, not the external column

#### Scenario: Motion is unavailable

- **WHEN** mean motion is absent, excluded, or missing for the selected point
- **THEN** the card SHALL show an em dash for mean motion without hiding the point or inventing a measurement

### Requirement: Transient comparison lifetime

Pin, companion mode, navigation linking, shared window, and hover state SHALL remain transient and SHALL NOT schedule project saves. Axis and domain-filter changes SHALL preserve the pin. Leaving Visualize, replacing or invalidating the source contract, or closing/replacing the project SHALL clear comparison state, release its viewer resources, and prevent earlier loads or callbacks from modifying replacement panes.

#### Scenario: Axis change preserves reference

- **WHEN** axes change while A is pinned
- **THEN** existing primary-selection clearing SHALL occur and A SHALL remain available as reference

#### Scenario: Project or source replacement

- **WHEN** project or source identity changes while image loading is pending
- **THEN** pin and hover SHALL clear and the old completion SHALL NOT install an image or update replacement pane state
