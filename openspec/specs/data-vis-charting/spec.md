# data-vis-charting Specification

## ADDED Requirements

### Requirement: Axis Assignment UI

The "Visualize" step SHALL render three dropdowns: X-axis, Y-axis, and color-by. Each dropdown SHALL list non-excluded columns. Each entry SHALL display a type badge (continuous/ordinal/nominal) next to the column name. The Y-axis dropdown SHALL be labeled "Y-axis (continuous)". The color-by dropdown SHALL include a "None" option (default). Only categorical (ordinal/nominal) columns SHALL be available in the color-by dropdown.

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
- **THEN** a scatterplot SHALL render using `ScatterPlotCanvas`

#### Scenario: Swarmplot for continuous×categorical

- **WHEN** X-axis is assigned a categorical column and Y-axis is assigned a continuous column
- **THEN** a swarmplot SHALL render using `SwarmPlotCanvas`

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

Changing any axis dropdown (X, Y, or color-by) SHALL trigger `read_tsv_columns` for the newly needed columns and re-render the chart immediately. No "Render" button SHALL be required. The chart SHALL update as soon as the new data arrives.

#### Scenario: X-axis change triggers re-render

- **WHEN** the user changes the X-axis dropdown from "Total_GM_B" to "MeanMotion"
- **THEN** `read_tsv_columns` SHALL be called with the new column set and the chart SHALL re-render upon data arrival

#### Scenario: Color-by change triggers re-render

- **WHEN** the user changes color-by from "None" to "Site"
- **THEN** the chart SHALL re-render with points colored by the Site column values

### Requirement: Canvas Chart Rendering

Both scatterplot and swarmplot SHALL use nivo's canvas variants (`ScatterPlotCanvas` and `SwarmPlotCanvas`) exclusively. SVG variants SHALL NOT be used. This ensures acceptable performance with 1000+ data points.

#### Scenario: Scatterplot uses canvas renderer

- **WHEN** a scatterplot is rendered
- **THEN** the `ScatterPlotCanvas` component SHALL be used, not `ScatterPlot`

#### Scenario: Swarmplot uses canvas renderer

- **WHEN** a swarmplot is rendered
- **THEN** the `SwarmPlotCanvas` component SHALL be used, not `SwarmPlot`

### Requirement: Hover Tooltips

Hovering over a datapoint SHALL display a tooltip containing: Subject, Session, Run, X-axis value, Y-axis value. If color-by is active, the color-by column name and value SHALL also be displayed. The tooltip SHALL use monospace font for identifier values.

#### Scenario: Tooltip shows identifiers and values

- **WHEN** the user hovers over a datapoint with Subject="sub-001Philips", Session="01", Run="ASL_1", X=258.76, Y=0.64
- **THEN** the tooltip SHALL display all five values

#### Scenario: Tooltip includes color-by value

- **WHEN** color-by is set to "Site" and the user hovers over a point with Site="1"
- **THEN** the tooltip SHALL include "Site: 1" in addition to the standard fields

### Requirement: Point Click and Highlight

Clicking a datapoint SHALL highlight the clicked point with a border/halo and dim all other points slightly. The highlight SHALL persist until a different point is clicked. The clicked point's identifier values (participant_id, session) SHALL be passed to the NiiVue viewer for image loading. If the image fails to load, the highlight SHALL remain on the clicked point.

#### Scenario: Click highlights point

- **WHEN** the user clicks a datapoint
- **THEN** the clicked point SHALL display a visible border/halo and all other points SHALL be rendered at reduced opacity

#### Scenario: Click passes identifiers to viewer

- **WHEN** the user clicks a datapoint with participant_id="sub-001Philips_01" and session="ASL_1"
- **THEN** the viewer SHALL receive these identifiers to construct the qCBF file request

#### Scenario: Highlight persists on image failure

- **WHEN** the user clicks a datapoint and the qCBF image fails to load
- **THEN** the point highlight SHALL remain visible on the chart

#### Scenario: Clicking new point clears previous highlight

- **WHEN** a point is highlighted and the user clicks a different point
- **THEN** the previous point's highlight SHALL be removed and the new point SHALL be highlighted

### Requirement: Selected Point Clearing on Axis Change

When any axis assignment changes (X, Y, or color-by), the selected point SHALL be cleared (`selectedPointId` set to `null`). The viewer panel SHALL return to its idle state.

#### Scenario: X-axis change clears selection

- **WHEN** a point is selected (highlighted) and the user changes the X-axis dropdown
- **THEN** the point highlight SHALL be removed and the viewer panel SHALL return to idle state

#### Scenario: Color-by change clears selection

- **WHEN** a point is selected and the user changes the color-by dropdown
- **THEN** the point highlight SHALL be removed and the viewer panel SHALL return to idle state

### Requirement: Color-By Grouping

When color-by is set to a categorical column, points SHALL be colored by the column's values using the Okabe-Ito 8-color colorblind-safe palette. If color-by is "None", all points SHALL use a single default color. For swarmplots, color-by SHALL create grouped swarms within each X-axis category.

#### Scenario: Single color when no color-by

- **WHEN** color-by is "None"
- **THEN** all points SHALL be rendered with a single default color

#### Scenario: Okabe-Ito palette for color-by

- **WHEN** color-by is set to a categorical column with 3 unique values
- **THEN** points SHALL be colored using the first 3 colors of the Okabe-Ito palette

#### Scenario: Grouped swarm with color-by

- **WHEN** a swarmplot is rendered with color-by set to "Site" and X-axis is "Subject"
- **THEN** within each subject group, points SHALL be colored by their Site value

### Requirement: Missing Data Exclusion in Charts

Rows where either the X or Y column value is missing SHALL be excluded from chart data. The chart SHALL display a counter: "N points plotted (M rows excluded due to missing data)." Rows with missing color-by values SHALL be grouped under "Unknown" and rendered in gray. Rows with missing non-axis values SHALL NOT be excluded.

#### Scenario: Rows excluded for missing axis values

- **WHEN** a 1000-row dataset has 50 rows with missing Y values
- **THEN** 950 points SHALL be plotted and the counter SHALL read "950 points plotted (50 rows excluded due to missing data)"

#### Scenario: Missing color-by shows as Unknown

- **WHEN** color-by is set to "Site" and 10 rows have missing Site values
- **THEN** those 10 points SHALL be colored gray and labeled "Unknown" in the legend

#### Scenario: All rows excluded

- **WHEN** all rows have missing values in either X or Y column
- **THEN** the chart area SHALL show "No plottable data. Selected columns have no valid values."

### Requirement: Domain Filter Inputs

A collapsible "Filters" panel SHALL appear above the chart, toggled by a "Filters" button. When expanded, it SHALL show four inputs: X min, X max, Y min, Y max. Each input SHALL display the actual data range min/max as placeholder values. Empty inputs SHALL mean no filter (show all). Entered values SHALL filter the visible data range. The panel's expanded state SHALL persist in `uiState.dataVis.filtersExpanded`.

#### Scenario: Filters panel collapsed by default

- **WHEN** the Visualize step is entered for the first time
- **THEN** the Filters panel SHALL be collapsed (hidden)

#### Scenario: Placeholder values show data range

- **WHEN** the Filters panel is expanded and the X-axis data ranges from 0.63 to 0.68
- **THEN** the X min input placeholder SHALL show "0.63" and the X max input placeholder SHALL show "0.68"

#### Scenario: Filter narrows visible data

- **WHEN** the user enters X min = 0.65 on a scatterplot
- **THEN** only points with X ≥ 0.65 SHALL be rendered

#### Scenario: Empty inputs show all data

- **WHEN** all four filter inputs are empty
- **THEN** all non-missing data points SHALL be rendered

#### Scenario: Filter panel state persists

- **WHEN** the user expands the Filters panel, navigates away, and returns
- **THEN** the Filters panel SHALL be expanded (state restored from `uiState.dataVis.filtersExpanded`)

### Requirement: Nivo Theme Integration

Chart colors SHALL adapt to the active Mantine color scheme (light/dark). A shared `buildNivoTheme(colorScheme)` utility SHALL return a nivo theme object mapping: `axis.text.fill`, `axis.ticks.line.stroke`, `grid.line.stroke` (low opacity), `axis.domain.line.stroke`, and `legends.text.fill`. Point colors SHALL come from the Okabe-Ito palette, not the theme. The chart background SHALL be transparent (inherit from Mantine card/paper).

#### Scenario: Dark mode theme

- **WHEN** the Mantine color scheme is "dark"
- **THEN** axis text SHALL use a light color, grid lines SHALL use a low-opacity light color, and legend text SHALL be light

#### Scenario: Light mode theme

- **WHEN** the Mantine color scheme is "light"
- **THEN** axis text SHALL use a dark color, grid lines SHALL use a low-opacity dark color, and legend text SHALL be dark

#### Scenario: Point colors unaffected by theme

- **WHEN** color-by is active and the theme switches from light to dark
- **THEN** point colors SHALL remain the same (Okabe-Ito palette is theme-independent)

### Requirement: Chart Data Transformation

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
