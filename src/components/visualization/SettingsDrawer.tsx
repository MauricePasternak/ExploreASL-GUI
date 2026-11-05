import { comboboxTestIds } from "../common/comboboxTestIds";
import { segmentedControlTestIds } from "../common/segmentedControlTestIds";
import { useMemo } from "react";
import { numberInputTestIds } from "../common/numberInputTestIds";
import { useProjectStore } from "../../stores/projectStore";
import { visualizationSettings } from "../../stores/visualizationStore";
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
  Tabs,
} from "@mantine/core";
import {
  useVisualizationStore,
  type NvSliceType,
  type NvBackColor,
} from "../../stores/visualizationStore";
import { translateColumnName } from "../../lib/tsvUtils";

export default function SettingsDrawer() {
  const chartData = useVisualizationStore((s) => s.chartData);
  const domainFilters = useProjectStore((s) => visualizationSettings(s.project).domainFilters);
  const setDomainFilters = useVisualizationStore((s) => s.setDomainFilters);
  const filtersExpanded = useProjectStore((s) => visualizationSettings(s.project).filtersExpanded);
  const setFiltersExpanded = useVisualizationStore((s) => s.setFiltersExpanded);

  // Nivo Settings
  const pointSize = useProjectStore((s) => visualizationSettings(s.project).pointSize);
  const setPointSize = useVisualizationStore((s) => s.setPointSize);
  const swarmSpacing = useProjectStore((s) => visualizationSettings(s.project).swarmSpacing);
  const setSwarmSpacing = useVisualizationStore((s) => s.setSwarmSpacing);
  const chartOpacity = useProjectStore((s) => visualizationSettings(s.project).chartOpacity);
  const setChartOpacity = useVisualizationStore((s) => s.setChartOpacity);
  const showGridX = useProjectStore((s) => visualizationSettings(s.project).showGridX);
  const setShowGridX = useVisualizationStore((s) => s.setShowGridX);
  const showGridY = useProjectStore((s) => visualizationSettings(s.project).showGridY);
  const setShowGridY = useVisualizationStore((s) => s.setShowGridY);

  // NiiVue Settings
  const nvRadiological = useProjectStore((s) => visualizationSettings(s.project).nvRadiological);
  const setNvRadiological = useVisualizationStore((s) => s.setNvRadiological);
  const nvColorbar = useProjectStore((s) => visualizationSettings(s.project).nvColorbar);
  const setNvColorbar = useVisualizationStore((s) => s.setNvColorbar);
  const nvCrosshair = useProjectStore((s) => visualizationSettings(s.project).nvCrosshair);
  const setNvCrosshair = useVisualizationStore((s) => s.setNvCrosshair);
  const nvCornerOrientation = useProjectStore(
    (s) => visualizationSettings(s.project).nvCornerOrientation,
  );
  const setNvCornerOrientation = useVisualizationStore((s) => s.setNvCornerOrientation);
  const nvColormap = useProjectStore((s) => visualizationSettings(s.project).nvColormap);
  const setNvColormap = useVisualizationStore((s) => s.setNvColormap);
  const nvSliceType = useProjectStore((s) => visualizationSettings(s.project).nvSliceType);
  const setNvSliceType = useVisualizationStore((s) => s.setNvSliceType);
  const nvBackColor = useProjectStore((s) => visualizationSettings(s.project).nvBackColor);
  const setNvBackColor = useVisualizationStore((s) => s.setNvBackColor);

  // Axis Assignments & Customizations
  const axisAssignment = useProjectStore((s) => visualizationSettings(s.project).axisAssignment);
  const xTickSize = useProjectStore((s) => visualizationSettings(s.project).xTickSize);
  const setXTickSize = useVisualizationStore((s) => s.setXTickSize);
  const xTickPadding = useProjectStore((s) => visualizationSettings(s.project).xTickPadding);
  const setXTickPadding = useVisualizationStore((s) => s.setXTickPadding);
  const xTickRotation = useProjectStore((s) => visualizationSettings(s.project).xTickRotation);
  const setXTickRotation = useVisualizationStore((s) => s.setXTickRotation);
  const xLegendOverride = useProjectStore((s) => visualizationSettings(s.project).xLegendOverride);
  const setXLegendOverride = useVisualizationStore((s) => s.setXLegendOverride);
  const xLegendOffset = useProjectStore((s) => visualizationSettings(s.project).xLegendOffset);
  const setXLegendOffset = useVisualizationStore((s) => s.setXLegendOffset);

  const yTickSize = useProjectStore((s) => visualizationSettings(s.project).yTickSize);
  const setYTickSize = useVisualizationStore((s) => s.setYTickSize);
  const yTickPadding = useProjectStore((s) => visualizationSettings(s.project).yTickPadding);
  const setYTickPadding = useVisualizationStore((s) => s.setYTickPadding);
  const yTickRotation = useProjectStore((s) => visualizationSettings(s.project).yTickRotation);
  const setYTickRotation = useVisualizationStore((s) => s.setYTickRotation);
  const yLegendOverride = useProjectStore((s) => visualizationSettings(s.project).yLegendOverride);
  const setYLegendOverride = useVisualizationStore((s) => s.setYLegendOverride);
  const yLegendOffset = useProjectStore((s) => visualizationSettings(s.project).yLegendOffset);
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
      size={440}
      data-testid="settings-drawer"
      attributes={{
        close: {
          "data-testid": "settings-drawer-close",
          "aria-label": "Close visualization settings",
        },
      }}
    >
      <Tabs defaultValue="chart" data-testid="settings-tabs">
        <Tabs.List grow data-testid="settings-tab-list">
          <Tabs.Tab value="chart" data-testid="settings-tab-chart">
            Chart
          </Tabs.Tab>
          <Tabs.Tab value="axes" data-testid="settings-tab-axes">
            Axes
          </Tabs.Tab>
          <Tabs.Tab value="images" data-testid="settings-tab-images">
            Images
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="chart" pt="md" data-testid="settings-panel-chart">
          <Stack gap="md" data-testid="settings-chart-content">
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
                    aria-label="Point size"
                    min={2}
                    max={20}
                    step={1}
                    value={pointSize}
                    onChange={setPointSize}
                    data-testid="setting-point-size"
                    attributes={{ thumb: { "data-testid": "setting-point-size-thumb" } }}
                  />
                </div>

                <div>
                  <Text size="xs" fw={500} mb={4}>
                    Swarmplot Node Spacing ({swarmSpacing})
                  </Text>
                  <Slider
                    aria-label="Swarmplot node spacing"
                    min={0}
                    max={10}
                    step={1}
                    value={swarmSpacing}
                    onChange={setSwarmSpacing}
                    data-testid="setting-swarm-spacing"
                    attributes={{ thumb: { "data-testid": "setting-swarm-spacing-thumb" } }}
                  />
                </div>

                <div>
                  <Text size="xs" fw={500} mb={4}>
                    Point Opacity ({Math.round(chartOpacity * 100)}%)
                  </Text>
                  <Slider
                    aria-label="Point opacity"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={chartOpacity}
                    onChange={setChartOpacity}
                    data-testid="setting-chart-opacity"
                    attributes={{ thumb: { "data-testid": "setting-chart-opacity-thumb" } }}
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
                    onChange={(val) =>
                      setDomainFilters({ xMin: typeof val === "number" ? val : null })
                    }
                    size="xs"
                    {...numberInputTestIds("filter-x-min")}
                  />
                </Grid.Col>
                <Grid.Col span={6}>
                  <NumberInput
                    label="X max"
                    placeholder={xMax !== undefined ? String(xMax) : "\u2014"}
                    value={domainFilters.xMax ?? undefined}
                    onChange={(val) =>
                      setDomainFilters({ xMax: typeof val === "number" ? val : null })
                    }
                    size="xs"
                    {...numberInputTestIds("filter-x-max")}
                  />
                </Grid.Col>
                <Grid.Col span={6}>
                  <NumberInput
                    label="Y min"
                    placeholder={yMin !== undefined ? String(yMin) : "\u2014"}
                    value={domainFilters.yMin ?? undefined}
                    onChange={(val) =>
                      setDomainFilters({ yMin: typeof val === "number" ? val : null })
                    }
                    size="xs"
                    {...numberInputTestIds("filter-y-min")}
                  />
                </Grid.Col>
                <Grid.Col span={6}>
                  <NumberInput
                    label="Y max"
                    placeholder={yMax !== undefined ? String(yMax) : "\u2014"}
                    value={domainFilters.yMax ?? undefined}
                    onChange={(val) =>
                      setDomainFilters({ yMax: typeof val === "number" ? val : null })
                    }
                    size="xs"
                    {...numberInputTestIds("filter-y-max")}
                  />
                </Grid.Col>
              </Grid>
            </div>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="axes" pt="md" data-testid="settings-panel-axes">
          <Stack gap="md" data-testid="settings-axes-content">
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
                      {...numberInputTestIds("setting-x-legend-offset")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Size"
                      value={xTickSize}
                      onChange={(val) => setXTickSize(typeof val === "number" ? val : 5)}
                      size="xs"
                      {...numberInputTestIds("setting-x-tick-size")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Padding"
                      value={xTickPadding}
                      onChange={(val) => setXTickPadding(typeof val === "number" ? val : 5)}
                      size="xs"
                      {...numberInputTestIds("setting-x-tick-padding")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Rotation"
                      value={xTickRotation}
                      onChange={(val) => setXTickRotation(typeof val === "number" ? val : 0)}
                      size="xs"
                      {...numberInputTestIds("setting-x-tick-rotation")}
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
                      {...numberInputTestIds("setting-y-legend-offset")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Size"
                      value={yTickSize}
                      onChange={(val) => setYTickSize(typeof val === "number" ? val : 5)}
                      size="xs"
                      {...numberInputTestIds("setting-y-tick-size")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Padding"
                      value={yTickPadding}
                      onChange={(val) => setYTickPadding(typeof val === "number" ? val : 5)}
                      size="xs"
                      {...numberInputTestIds("setting-y-tick-padding")}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <NumberInput
                      label="Tick Rotation"
                      value={yTickRotation}
                      onChange={(val) => setYTickRotation(typeof val === "number" ? val : 0)}
                      size="xs"
                      {...numberInputTestIds("setting-y-tick-rotation")}
                    />
                  </Grid.Col>
                </Grid>
              </Stack>
            </div>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="images" pt="md" data-testid="settings-panel-images">
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
                {...comboboxTestIds("setting-nv-slice-type")}
              />

              <Select
                label="Volume Colormap"
                data={colormapOptions}
                value={nvColormap}
                onChange={(val) => setNvColormap(val || "gray")}
                size="xs"
                {...comboboxTestIds("setting-nv-colormap")}
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
                  {...segmentedControlTestIds("setting-nv-back-color")}
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
        </Tabs.Panel>
      </Tabs>
    </Drawer>
  );
}
