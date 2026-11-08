# data-vis-charting Specification

## Purpose

Define chart configuration and rendering for population analysis data.

## Requirements

### Requirement: Axis Assignment UI

The "Visualize" step SHALL render three dropdowns: X-axis, Y-axis, and color-by. X SHALL list non-excluded columns, Y only non-excluded continuous columns, and color-by only non-excluded categorical (ordinal/nominal) columns plus "None" (default). Column entries SHALL display a type badge. The Y-axis dropdown SHALL be labeled "Y-axis (continuous)". Changing X or Y SHALL clear color-by.

#### Scenario: Dropdowns show type badges

- **WHEN** the axis assignment dropdowns render
- **THEN** each column entry SHALL display a colored badge indicating its type (continuous, ordinal, or nominal)

#### Scenario: Color-by only shows categorical columns

- **WHEN** the color-by dropdown is opened
- **THEN** only ordinal and nominal columns SHALL be listed, plus a "None" option

#### Scenario: Color-by defaults to None

- **WHEN** the "Visualize" step is entered for the first time (no persisted assignment)
- **THEN** the color-by dropdown SHALL default to "None"

### Requirement: Chart Type Selection

The chart type SHALL be determined by the axis types: continuous Y + continuous X → scatterplot; continuous Y + categorical (ordinal/nominal) X → swarmplot. Other combinations (categorical Y, categorical X + categorical Y) SHALL disable chart rendering and show: "Unsupported combination. Use continuous×continuous (scatter) or continuous×categorical (swarm)." The Y-axis SHALL always be continuous — if a categorical column is assigned to Y, the chart SHALL show the unsupported combination message.

#### Scenario: Scatterplot for continuous×continuous

- **WHEN** X-axis is assigned a continuous column and Y-axis is assigned a continuous column
- **THEN** a scatterplot SHALL render using `ResponsiveScatterPlotCanvas`

#### Scenario: Swarmplot for continuous×categorical

- **WHEN** X-axis is assigned a categorical column and Y-axis is assigned a continuous column
- **THEN** a swarmplot SHALL render using `ResponsiveSwarmPlotCanvas`

#### Scenario: Unsupported categorical Y

- **WHEN** Y-axis is assigned a categorical column
- **THEN** the chart area SHALL show "Unsupported combination. Use continuous×continuous (scatter) or continuous×categorical (swarm)." and no chart SHALL render

#### Scenario: Unsupported categorical×categorical

- **WHEN** both X and Y are assigned categorical columns
- **THEN** the chart area SHALL show the unsupported combination message and no chart SHALL render

### Requirement: Empty Axis State

When no axes are assigned, the chart area SHALL show "Select X and Y columns to begin." When only one axis is assigned, the chart area SHALL show "Assign both X and Y to render the chart."

#### Scenario: No axes assigned

- **WHEN** both X and Y dropdowns are empty
- **THEN** the chart area SHALL show "Select X and Y columns to begin."

#### Scenario: Only X assigned

- **WHEN** X-axis has a column assigned but Y-axis is empty
- **THEN** the chart area SHALL show "Assign both X and Y to render the chart."

### Requirement: Axis Assignment Restoration

On entering the "Visualize" step with a valid contract, the axis assignment dropdowns SHALL restore the last persisted values from `uiState.dataVis.axisAssignment`. If no persisted assignment exists, all dropdowns SHALL be empty.

#### Scenario: Restore last assignment

- **WHEN** the user re-enters the Visualize step with a valid contract and `axisAssignment` has `{ x: "Total_GM_B", y: "GM_vol", colorBy: "Site" }`
- **THEN** the dropdowns SHALL be pre-set to those values and the chart SHALL render immediately

#### Scenario: Empty assignment for fresh contract

- **WHEN** the user enters the Visualize step for the first time (no persisted assignment)
- **THEN** all dropdowns SHALL be empty and the chart area SHALL show the empty state

### Requirement: Immediate Chart Re-render on Axis Change

Changing any axis dropdown (X, Y, or color-by) SHALL trigger `read_data_columns` for the newly needed columns and re-render the chart immediately. No "Render" button SHALL be required. The chart SHALL update as soon as the new data arrives.

#### Scenario: X-axis change triggers re-render

- **WHEN** the user changes the X-axis dropdown from "Total_GM_B" to "MeanMotion"
- **THEN** `read_data_columns` SHALL be called with the new column set and the chart SHALL re-render upon data arrival

#### Scenario: Color-by change triggers re-render

- **WHEN** the user changes color-by from "None" to "Site"
- **THEN** the chart SHALL re-render with points colored by the Site column values

### Requirement: Canvas Chart Rendering

Both scatterplot and swarmplot SHALL use nivo's responsive canvas variants (`ResponsiveScatterPlotCanvas` and `ResponsiveSwarmPlotCanvas`) exclusively. SVG variants SHALL NOT be used.

#### Scenario: Scatterplot uses canvas renderer

- **WHEN** a scatterplot is rendered
- **THEN** the `ResponsiveScatterPlotCanvas` component SHALL be used, not `ScatterPlot`

#### Scenario: Swarmplot uses canvas renderer

- **WHEN** a swarmplot is rendered
- **THEN** the `ResponsiveSwarmPlotCanvas` component SHALL be used, not `SwarmPlot`

### Requirement: Hover Tooltips

Hovering over a datapoint SHALL display a tooltip containing fields labeled Subject, Session, Run, X, and Y. If color-by is active, its value SHALL also be displayed under the label "Hue". Identifier values SHALL use the tooltip's inherited font, without a dedicated monospace style.

#### Scenario: Tooltip shows identifiers and values

- **WHEN** the user hovers over a datapoint with Subject="sub-001Philips", Session="01", Run="ASL_1", X=258.76, Y=0.64
- **THEN** the tooltip SHALL display all five values

#### Scenario: Tooltip includes color-by value

- **WHEN** color-by is set to "Site" and the user hovers over a point with Site="1"
- **THEN** the tooltip SHALL include "Hue: 1" in addition to the standard fields

### Requirement: Point Click Selection

Clicking a datapoint SHALL store its composite ID in transient `selectedPointId`. The NiiVue viewer SHALL resolve that ID in chart data and use the point's raw `participantId` and `run` (TSV `session`, GUI Run) for image loading. Chart rendering SHALL NOT apply a selected-point halo, border, or dimming based on this ID. Image loading failure SHALL NOT clear the selected ID.

#### Scenario: Click stores selection without chart styling

- **WHEN** the user clicks a datapoint
- **THEN** `selectedPointId` SHALL become the clicked point's ID without changing chart styling based on selection

#### Scenario: Click passes identifiers to viewer

- **WHEN** the user clicks a datapoint with participantId="sub-001Philips_01" and run="ASL_1"
- **THEN** the viewer SHALL resolve the selected point and use those values to construct the qCBF file request

#### Scenario: Selection persists on image failure

- **WHEN** the user clicks a datapoint and the qCBF image fails to load
- **THEN** `selectedPointId` SHALL remain the clicked point's ID

#### Scenario: Clicking new point replaces selection

- **WHEN** a point is selected and the user clicks a different point
- **THEN** `selectedPointId` SHALL be replaced with the new point's ID

### Requirement: Selected Point Clearing on Axis Change

When any axis assignment changes (X, Y, or color-by), the selected point SHALL be cleared (`selectedPointId` set to `null`). The primary pane SHALL return to idle. An existing pinned reference SHALL remain available independently of current chart rows; Pinned mode SHALL retain its reference image. This SHALL NOT change the existing prohibition on selected-point chart styling.

#### Scenario: X-axis change clears selection

- **WHEN** a point is selected and the user changes the X-axis dropdown
- **THEN** `selectedPointId` SHALL be cleared and primary SHALL return to idle without discarding a pin

#### Scenario: Color-by change clears selection

- **WHEN** a point is selected and the user changes color-by
- **THEN** `selectedPointId` SHALL be cleared while an existing pinned reference remains available

### Requirement: Color-By Grouping

Charts SHALL color categorical values with the specified accessible palette and encounter ordering, without adding color-by legends or swarmplot subgroups.

#### Scenario: Filtered chart rows are grouped and colored

- **WHEN** color-by is categorical or None
- **THEN** palette assignment and swarmplot grouping SHALL follow these rules:

When color-by is set to a categorical column, points SHALL be colored by the column's values using the Okabe-Ito 8-color colorblind-safe palette, assigned in encounter order among filtered chart rows and cycled for additional values. If color-by is "None", all points SHALL use a single default color. Swarmplots SHALL group points by X-axis category and color individual nodes within each group, without separate color-by subgroups. X-axis groups SHALL follow encounter order in filtered chart rows, not persisted `levelOrderings`. Neither chart SHALL configure a color-by legend.

#### Scenario: Single color when no color-by

- **WHEN** color-by is "None"
- **THEN** all points SHALL be rendered with a single default color

#### Scenario: Okabe-Ito palette for color-by

- **WHEN** color-by is set to a categorical column with 3 unique values
- **THEN** points SHALL be colored using the first 3 colors of the Okabe-Ito palette

#### Scenario: Grouped swarm with color-by

- **WHEN** a swarmplot is rendered with color-by set to "Site" and X-axis is "Subject"
- **THEN** within each subject group, points SHALL be colored by their Site value without creating separate Site swarms

#### Scenario: Saved level order does not reorder chart groups

- **WHEN** X is assigned to Site, saved `levelOrderings` specifies `["Site_1", "Site_2"]`, and filtered chart rows first encounter `Site_2`, then `Site_1`
- **THEN** swarmplot X-axis groups SHALL remain `["Site_2", "Site_1"]`

### Requirement: Missing Data Exclusion in Charts

Charts SHALL exclude rows missing axis values, distinguish missing-data exclusions from domain filtering, and retain rows missing only non-axis data.

#### Scenario: Chart rows contain missing values or become unplottable

- **WHEN** supported axes and domain filters are applied
- **THEN** exclusions, counters, empty-state text, and Unknown coloring SHALL follow these rules:

Rows where either the X or Y column value is missing SHALL be excluded from chart data. With supported axes assigned and at least one plottable point remaining after domain filtering, the chart SHALL display "N points plotted" with an additional "(M rows excluded due to missing data)" count when exclusions exist, and a separate count when domain filters hide points. When supported assigned axes yield no remaining points, the chart SHALL instead show "No plottable data. Selected columns have no valid values." without a point, exclusion, or domain-filter counter. Rows with missing color-by values SHALL be grouped under "Unknown" and receive the next palette color like other categorical values, not a reserved gray color. Rows with missing non-axis values SHALL NOT be excluded.

#### Scenario: Rows excluded for missing axis values

- **WHEN** supported axes are assigned, a 1000-row dataset has 50 rows with missing Y values and 950 otherwise plottable rows, and no domain filters hide points
- **THEN** 950 points SHALL be plotted and the counter SHALL read "950 points plotted (50 rows excluded due to missing data)"

#### Scenario: Missing color-by shows as Unknown

- **WHEN** color-by is set to "Site" and 10 rows have missing Site values
- **THEN** those 10 points SHALL have color-by value "Unknown", receive its encounter-order palette color, and show "Hue: Unknown" in their tooltips; no color-by legend SHALL be configured

#### Scenario: All rows excluded

- **WHEN** supported axes are assigned and all rows have missing values in either X or Y column
- **THEN** the chart area SHALL show "No plottable data. Selected columns have no valid values." without a point or exclusion counter

### Requirement: Domain Filter Inputs

Visualization settings SHALL expose persisted axis-range filters in a right-side drawer, treating empty bounds as unrestricted and deriving placeholders from chart data.

#### Scenario: A user opens settings and changes axis bounds

- **WHEN** visualization range filters are displayed or edited
- **THEN** drawer state, inputs, placeholders, and filtering SHALL follow these rules:

A "Settings" button beside the axis controls SHALL toggle a right-side drawer titled "Visualization Settings". Its "Axes Range Filters" section SHALL contain four inputs: X min, X max, Y min, Y max. Placeholders SHALL show numeric chart-data min/max values, or an em dash when unavailable. Empty inputs SHALL mean no filter for that bound. Entered values SHALL filter chart rows; an X bound SHALL retain only numeric X values satisfying that bound. Drawer open state SHALL persist in `uiState.dataVis.filtersExpanded`, alongside separate persisted domain filter values.

#### Scenario: Settings drawer closed by default

- **WHEN** the Visualize step is entered for the first time
- **THEN** the Visualization Settings drawer SHALL be closed

#### Scenario: Placeholder values show data range

- **WHEN** the Settings drawer is open and numeric X-axis chart data ranges from 0.63 to 0.68
- **THEN** the X min input placeholder SHALL show "0.63" and the X max input placeholder SHALL show "0.68"

#### Scenario: Filter narrows visible data

- **WHEN** the user enters X min = 0.65 on a scatterplot
- **THEN** only points with X ≥ 0.65 SHALL be rendered

#### Scenario: Empty inputs show all data

- **WHEN** all four filter inputs are empty
- **THEN** all non-missing data points SHALL be rendered

#### Scenario: Settings drawer state persists

- **WHEN** the user opens the Settings drawer, navigates away, and returns
- **THEN** the drawer SHALL be open (state restored from `uiState.dataVis.filtersExpanded`)

### Requirement: Nivo Theme Integration

Chart colors SHALL adapt to the active Mantine color scheme (light/dark). A shared `buildNivoTheme(colorScheme)` utility SHALL return a nivo theme object mapping: `axis.text.fill`, `axis.ticks.line.stroke`, `grid.line.stroke` (low opacity), `axis.domain.line.stroke`, and `legends.text.fill`. Point colors SHALL come from the Okabe-Ito palette, not the theme. The chart background SHALL be transparent (inherit from Mantine card/paper).

#### Scenario: Dark mode theme

- **WHEN** the Mantine color scheme is "dark"
- **THEN** axis text SHALL use a light color, grid lines SHALL use a low-opacity light color, and the theme's legend text color SHALL be light without configuring a color-by legend

#### Scenario: Light mode theme

- **WHEN** the Mantine color scheme is "light"
- **THEN** axis text SHALL use a dark color, grid lines SHALL use a low-opacity dark color, and the theme's legend text color SHALL be dark without configuring a color-by legend

#### Scenario: Point colors unaffected by theme

- **WHEN** color-by is active and the theme switches from light to dark
- **THEN** point colors SHALL remain the same (Okabe-Ito palette is theme-independent)

### Requirement: Chart Data Transformation

`chartData` SHALL contain typed nivo-ready points with preserved raw participant identifiers and correctly translated GUI Session and Run fields.

#### Scenario: Inspected rows become chart points

- **WHEN** visualization transforms rows using the saved column contract
- **THEN** point fields and numeric parsing SHALL satisfy this shape:

The `visualizationStore.chartData` SHALL store transformed nivo-ready data points, not raw TSV rows. Each point SHALL be an object with: `x` (X column value), `y` (Y column value, number), `id` (composite `participantId + "_" + run`), `colorBy` (categorical value or undefined), `participantId` (raw TSV `participant_id` value, e.g. `"sub-001Philips_01"`), `subject` (parsed from `participant_id`, e.g. `"sub-001Philips"`), `session` (parsed from `participant_id`, e.g. `"01"` — GUI Session), `run` (TSV `session` column value, e.g. `"ASL_1"` — GUI Run, used for qCBF filename and protocol URL). The transformation SHALL parse numeric values according to column types from the contract.

#### Scenario: Data point structure

- **WHEN** chart data is transformed from TSV rows with participant_id="sub-001Philips_01" and TSV session="ASL_1"
- **THEN** each point SHALL have `id` = `"sub-001Philips_01_ASL_1"` (participantId + "\_" + run), `subject` = `"sub-001Philips"`, `session` = `"01"`, `run` = `"ASL_1"`

#### Scenario: Tooltip fields map to correct values

- **WHEN** a tooltip displays for a point with participant_id="sub-001Philips_01" and TSV session="ASL_1"
- **THEN** the tooltip SHALL show Subject = `subject` field (`"sub-001Philips"`), Session = `session` field (`"01"`), Run = `run` field (`"ASL_1"`)

#### Scenario: Numeric values parsed for continuous columns

- **WHEN** a continuous column has value `"258.7638"` in the TSV
- **THEN** the transformed data point SHALL have the value as a number (`258.7638`), not a string
