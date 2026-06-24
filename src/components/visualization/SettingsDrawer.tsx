import { useMemo } from "react";
import {
  Drawer,
  Stack,
  Text,
  Divider,
  Grid,
  NumberInput,
  Slider,
  Switch,
  Select,
  SegmentedControl,
  Group,
  TextInput,
} from "@mantine/core";
import {
  useVisualizationStore,
  type NvSliceType,
  type NvBackColor,
} from "../../stores/visualizationStore";
import { translateColumnName } from "../../lib/tsvUtils";

export default function SettingsDrawer() {
  const chartData = useVisualizationStore((s) => s.chartData);
  const domainFilters = useVisualizationStore((s) => s.domainFilters);
  const setDomainFilters = useVisualizationStore((s) => s.setDomainFilters);
  const filtersExpanded = useVisualizationStore((s) => s.filtersExpanded);
  const setFiltersExpanded = useVisualizationStore((s) => s.setFiltersExpanded);

  // Nivo Settings
  const pointSize = useVisualizationStore((s) => s.pointSize);
  const setPointSize = useVisualizationStore((s) => s.setPointSize);
  const swarmSpacing = useVisualizationStore((s) => s.swarmSpacing);
  const setSwarmSpacing = useVisualizationStore((s) => s.setSwarmSpacing);
  const chartOpacity = useVisualizationStore((s) => s.chartOpacity);
  const setChartOpacity = useVisualizationStore((s) => s.setChartOpacity);
  const showGridX = useVisualizationStore((s) => s.showGridX);
  const setShowGridX = useVisualizationStore((s) => s.setShowGridX);
  const showGridY = useVisualizationStore((s) => s.showGridY);
  const setShowGridY = useVisualizationStore((s) => s.setShowGridY);

  // NiiVue Settings
  const nvRadiological = useVisualizationStore((s) => s.nvRadiological);
  const setNvRadiological = useVisualizationStore((s) => s.setNvRadiological);
  const nvColorbar = useVisualizationStore((s) => s.nvColorbar);
  const setNvColorbar = useVisualizationStore((s) => s.setNvColorbar);
  const nvCrosshair = useVisualizationStore((s) => s.nvCrosshair);
  const setNvCrosshair = useVisualizationStore((s) => s.setNvCrosshair);
  const nvCornerOrientation = useVisualizationStore((s) => s.nvCornerOrientation);
  const setNvCornerOrientation = useVisualizationStore((s) => s.setNvCornerOrientation);
  const nvColormap = useVisualizationStore((s) => s.nvColormap);
  const setNvColormap = useVisualizationStore((s) => s.setNvColormap);
  const nvSliceType = useVisualizationStore((s) => s.nvSliceType);
  const setNvSliceType = useVisualizationStore((s) => s.setNvSliceType);
  const nvBackColor = useVisualizationStore((s) => s.nvBackColor);
  const setNvBackColor = useVisualizationStore((s) => s.setNvBackColor);

  // Axis Assignments & Customizations
  const axisAssignment = useVisualizationStore((s) => s.axisAssignment);
  const xTickSize = useVisualizationStore((s) => s.xTickSize);
  const setXTickSize = useVisualizationStore((s) => s.setXTickSize);
  const xTickPadding = useVisualizationStore((s) => s.xTickPadding);
  const setXTickPadding = useVisualizationStore((s) => s.setXTickPadding);
  const xTickRotation = useVisualizationStore((s) => s.xTickRotation);
  const setXTickRotation = useVisualizationStore((s) => s.setXTickRotation);
  const xLegendOverride = useVisualizationStore((s) => s.xLegendOverride);
  const setXLegendOverride = useVisualizationStore((s) => s.setXLegendOverride);
  const xLegendOffset = useVisualizationStore((s) => s.xLegendOffset);
  const setXLegendOffset = useVisualizationStore((s) => s.setXLegendOffset);

  const yTickSize = useVisualizationStore((s) => s.yTickSize);
  const setYTickSize = useVisualizationStore((s) => s.setYTickSize);
  const yTickPadding = useVisualizationStore((s) => s.yTickPadding);
  const setYTickPadding = useVisualizationStore((s) => s.setYTickPadding);
  const yTickRotation = useVisualizationStore((s) => s.yTickRotation);
  const setYTickRotation = useVisualizationStore((s) => s.setYTickRotation);
  const yLegendOverride = useVisualizationStore((s) => s.yLegendOverride);
  const setYLegendOverride = useVisualizationStore((s) => s.setYLegendOverride);
  const yLegendOffset = useVisualizationStore((s) => s.yLegendOffset);
  const setYLegendOffset = useVisualizationStore((s) => s.setYLegendOffset);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const xValues = chartData.map((p) => p.x).filter((v): v is number => typeof v === "number");
    const yValues = chartData.map((p) => p.y);
    return {
      xMin: xValues.length > 0 ? Math.min(...xValues) : undefined,
      xMax: xValues.length > 0 ? Math.max(...xValues) : undefined,
      yMin: yValues.length > 0 ? Math.min(...yValues) : undefined,
      yMax: yValues.length > 0 ? Math.max(...yValues) : undefined,
    };
  }, [chartData]);

  const colormapOptions = [
    { value: "gray", label: "Grayscale" },
    { value: "red", label: "Red" },
    { value: "green", label: "Green" },
    { value: "blue", label: "Blue" },
    { value: "hot", label: "Hot" },
    { value: "cool", label: "Cool" },
    { value: "warm", label: "Warm" },
    { value: "jet", label: "Jet" },
    { value: "viridis", label: "Viridis" },
    { value: "plasma", label: "Plasma" },
    { value: "magma", label: "Magma" },
    { value: "inferno", label: "Inferno" },
  ];

  const sliceTypeOptions = [
    { value: "multiplanar", label: "Multiplanar (Grid)" },
    { value: "axial", label: "Axial" },
    { value: "coronal", label: "Coronal" },
    { value: "sagittal", label: "Sagittal" },
    { value: "render", label: "3D Volume Render" },
  ];

  return (
    <Drawer
      opened={filtersExpanded}
      onClose={() => setFiltersExpanded(false)}
      position="right"
      title="Visualization Settings"
      size="md"
      data-testid="settings-drawer"
    >
      <Stack gap="md">
        {/* Nivo Chart Section */}
        <div>
          <Text fw={600} size="sm" mb="xs" c="blue">
            Nivo Chart Settings
          </Text>
          <Stack gap="sm">
            <div>
              <Text size="xs" fw={500} mb={4}>
                Point Size ({pointSize})
              </Text>
              <Slider
                min={2}
                max={20}
                step={1}
                value={pointSize}
                onChange={setPointSize}
                data-testid="setting-point-size"
              />
            </div>

            <div>
              <Text size="xs" fw={500} mb={4}>
                Swarmplot Node Spacing ({swarmSpacing})
              </Text>
              <Slider
                min={0}
                max={10}
                step={1}
                value={swarmSpacing}
                onChange={setSwarmSpacing}
                data-testid="setting-swarm-spacing"
              />
            </div>

            <div>
              <Text size="xs" fw={500} mb={4}>
                Point Opacity ({Math.round(chartOpacity * 100)}%)
              </Text>
              <Slider
                min={0.1}
                max={1}
                step={0.05}
                value={chartOpacity}
                onChange={setChartOpacity}
                data-testid="setting-chart-opacity"
              />
            </div>

            <Group gap="lg" mt={4}>
              <Switch
                label="Show X Grid"
                checked={showGridX}
                onChange={(e) => setShowGridX(e.currentTarget.checked)}
                size="xs"
                data-testid="setting-show-grid-x"
              />
              <Switch
                label="Show Y Grid"
                checked={showGridY}
                onChange={(e) => setShowGridY(e.currentTarget.checked)}
                size="xs"
                data-testid="setting-show-grid-y"
              />
            </Group>
          </Stack>
        </div>

        <Divider />

        {/* Axes Range Filters */}
        <div>
          <Text fw={600} size="sm" mb="xs" c="blue">
            Axes Range Filters
          </Text>
          <Grid>
            <Grid.Col span={6}>
              <NumberInput
                label="X min"
                placeholder={xMin !== undefined ? String(xMin) : "\u2014"}
                value={domainFilters.xMin ?? undefined}
                onChange={(val) => setDomainFilters({ xMin: typeof val === "number" ? val : null })}
                size="xs"
                data-testid="filter-x-min"
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <NumberInput
                label="X max"
                placeholder={xMax !== undefined ? String(xMax) : "\u2014"}
                value={domainFilters.xMax ?? undefined}
                onChange={(val) => setDomainFilters({ xMax: typeof val === "number" ? val : null })}
                size="xs"
                data-testid="filter-x-max"
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <NumberInput
                label="Y min"
                placeholder={yMin !== undefined ? String(yMin) : "\u2014"}
                value={domainFilters.yMin ?? undefined}
                onChange={(val) => setDomainFilters({ yMin: typeof val === "number" ? val : null })}
                size="xs"
                data-testid="filter-y-min"
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <NumberInput
                label="Y max"
                placeholder={yMax !== undefined ? String(yMax) : "\u2014"}
                value={domainFilters.yMax ?? undefined}
                onChange={(val) => setDomainFilters({ yMax: typeof val === "number" ? val : null })}
                size="xs"
                data-testid="filter-y-max"
              />
            </Grid.Col>
          </Grid>
        </div>

        <Divider />

        {/* X-Axis Settings */}
        <div>
          <Text fw={600} size="sm" mb="xs" c="blue">
            X-Axis Label & Ticks
          </Text>
          <Stack gap="xs">
            <TextInput
              label="Axis Label (Legend)"
              placeholder={axisAssignment.x ? translateColumnName(axisAssignment.x) : "X-axis"}
              value={xLegendOverride ?? ""}
              onChange={(e) => setXLegendOverride(e.currentTarget.value || null)}
              size="xs"
              data-testid="setting-x-legend-override"
            />
            <Grid>
              <Grid.Col span={6}>
                <NumberInput
                  label="Legend Offset"
                  value={xLegendOffset}
                  onChange={(val) => setXLegendOffset(typeof val === "number" ? val : 36)}
                  size="xs"
                  data-testid="setting-x-legend-offset"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Size"
                  value={xTickSize}
                  onChange={(val) => setXTickSize(typeof val === "number" ? val : 5)}
                  size="xs"
                  data-testid="setting-x-tick-size"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Padding"
                  value={xTickPadding}
                  onChange={(val) => setXTickPadding(typeof val === "number" ? val : 5)}
                  size="xs"
                  data-testid="setting-x-tick-padding"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Rotation"
                  value={xTickRotation}
                  onChange={(val) => setXTickRotation(typeof val === "number" ? val : 0)}
                  size="xs"
                  data-testid="setting-x-tick-rotation"
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </div>

        <Divider />

        {/* Y-Axis Settings */}
        <div>
          <Text fw={600} size="sm" mb="xs" c="blue">
            Y-Axis Label & Ticks
          </Text>
          <Stack gap="xs">
            <TextInput
              label="Axis Label (Legend)"
              placeholder={axisAssignment.y ? translateColumnName(axisAssignment.y) : "Y-axis"}
              value={yLegendOverride ?? ""}
              onChange={(e) => setYLegendOverride(e.currentTarget.value || null)}
              size="xs"
              data-testid="setting-y-legend-override"
            />
            <Grid>
              <Grid.Col span={6}>
                <NumberInput
                  label="Legend Offset"
                  value={yLegendOffset}
                  onChange={(val) => setYLegendOffset(typeof val === "number" ? val : -40)}
                  size="xs"
                  data-testid="setting-y-legend-offset"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Size"
                  value={yTickSize}
                  onChange={(val) => setYTickSize(typeof val === "number" ? val : 5)}
                  size="xs"
                  data-testid="setting-y-tick-size"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Padding"
                  value={yTickPadding}
                  onChange={(val) => setYTickPadding(typeof val === "number" ? val : 5)}
                  size="xs"
                  data-testid="setting-y-tick-padding"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput
                  label="Tick Rotation"
                  value={yTickRotation}
                  onChange={(val) => setYTickRotation(typeof val === "number" ? val : 0)}
                  size="xs"
                  data-testid="setting-y-tick-rotation"
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </div>

        <Divider />

        {/* NiiVue Options Section */}
        <div>
          <Text fw={600} size="sm" mb="xs" c="blue">
            NiiVue Image Viewer Settings
          </Text>
          <Stack gap="sm">
            <Select
              label="Layout / Orientation"
              data={sliceTypeOptions}
              value={nvSliceType}
              onChange={(val) => setNvSliceType(val as NvSliceType)}
              size="xs"
              data-testid="setting-nv-slice-type"
            />

            <Select
              label="Volume Colormap"
              data={colormapOptions}
              value={nvColormap}
              onChange={(val) => setNvColormap(val || "gray")}
              size="xs"
              data-testid="setting-nv-colormap"
            />

            <div>
              <Text size="xs" fw={500} mb={4}>
                Background Color
              </Text>
              <SegmentedControl
                data={[
                  { label: "Black", value: "black" },
                  { label: "Gray", value: "gray" },
                  { label: "White", value: "white" },
                ]}
                value={nvBackColor}
                onChange={(val) => setNvBackColor(val as NvBackColor)}
                size="xs"
                fullWidth
                data-testid="setting-nv-back-color"
              />
            </div>

            <Grid mt={4}>
              <Grid.Col span={6}>
                <Switch
                  label="Show Colorbar"
                  checked={nvColorbar}
                  onChange={(e) => setNvColorbar(e.currentTarget.checked)}
                  size="xs"
                  data-testid="setting-nv-colorbar"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <Switch
                  label="Show 3D Crosshair"
                  checked={nvCrosshair}
                  onChange={(e) => setNvCrosshair(e.currentTarget.checked)}
                  size="xs"
                  data-testid="setting-nv-crosshair"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <Switch
                  label="Radiological"
                  checked={nvRadiological}
                  onChange={(e) => setNvRadiological(e.currentTarget.checked)}
                  size="xs"
                  data-testid="setting-nv-radiological"
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <Switch
                  label="Orientation Cube"
                  checked={nvCornerOrientation}
                  onChange={(e) => setNvCornerOrientation(e.currentTarget.checked)}
                  size="xs"
                  data-testid="setting-nv-corner-orientation"
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </div>
      </Stack>
    </Drawer>
  );
}
