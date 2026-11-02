import {
  Badge,
  Group,
  Select,
  Grid,
  Button,
  useMantineTheme,
  type ComboboxItem,
  type ComboboxLikeRenderOptionInput,
} from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useVisualizationStore } from "../../stores/visualizationStore";
import { visualizationSettings } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";
import { comboboxTestIds } from "../common/comboboxTestIds";

interface AxisComboboxItem extends ComboboxItem {
  type?: string;
}

export default function AxisAssignment() {
  const theme = useMantineTheme();
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useProjectStore((s) => visualizationSettings(s.project).columnTypes);
  const axisAssignment = useProjectStore((s) => visualizationSettings(s.project).axisAssignment);
  const setAxisAssignment = useVisualizationStore((s) => s.setAxisAssignment);
  const filtersExpanded = useProjectStore((s) => visualizationSettings(s.project).filtersExpanded);
  const setFiltersExpanded = useVisualizationStore((s) => s.setFiltersExpanded);

  if (!inspection) return null;

  const availableColumns = inspection.columns.filter(
    (c) => (columnTypes[c.name] ?? c.inferredType) !== "excluded",
  );

  const categoricalColumns = availableColumns.filter((c) => {
    const type = columnTypes[c.name] ?? c.inferredType;
    return type === "ordinal" || type === "nominal";
  });

  function buildData(columns: typeof availableColumns) {
    return columns.map((c) => ({
      value: c.name,
      label: c.name,
      type: columnTypes[c.name] ?? c.inferredType,
    }));
  }

  const xData = buildData(availableColumns);
  const yData = buildData(
    availableColumns.filter((c) => {
      const type = columnTypes[c.name] ?? c.inferredType;
      return type === "continuous";
    }),
  );
  const colorByData = [{ value: "", label: "None" }, ...buildData(categoricalColumns)];

  function renderOption(item: ComboboxLikeRenderOptionInput<AxisComboboxItem>) {
    const option = item.option;
    const color =
      option.type === "continuous" ? "blue" : option.type === "ordinal" ? "orange" : "green";
    return (
      <Group gap="xs">
        <Badge size="xs" color={color}>
          {option.type}
        </Badge>
        <span>{option.label}</span>
      </Group>
    );
  }

  return (
    <Grid
      data-testid="axis-assignment"
      type="container"
      breakpoints={theme.breakpoints}
      align="flex-end"
      gap="sm"
    >
      <Grid.Col span={{ base: 12, xs: 6, sm: 3.5 }}>
        <Select
          label="X-axis"
          placeholder="Select column"
          data={xData}
          value={axisAssignment.x}
          onChange={(val) => setAxisAssignment({ x: val, colorBy: null })}
          renderOption={renderOption}
          searchable
          {...comboboxTestIds("x-axis-select")}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, xs: 6, sm: 3.5 }}>
        <Select
          label="Y-axis (continuous)"
          placeholder="Select column"
          data={yData}
          value={axisAssignment.y}
          onChange={(val) => setAxisAssignment({ y: val, colorBy: null })}
          renderOption={renderOption}
          searchable
          {...comboboxTestIds("y-axis-select")}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, xs: 6, sm: 3.5 }}>
        <Select
          label="Color by"
          data={colorByData}
          value={axisAssignment.colorBy ?? ""}
          onChange={(val) => setAxisAssignment({ colorBy: val || null })}
          renderOption={renderOption}
          {...comboboxTestIds("color-by-select")}
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, xs: 6, sm: 1.5 }}>
        <Button
          leftSection={<IconAdjustmentsHorizontal size={14} />}
          variant="light"
          fullWidth
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          data-testid="settings-toggle-btn"
        >
          Settings
        </Button>
      </Grid.Col>
    </Grid>
  );
}
