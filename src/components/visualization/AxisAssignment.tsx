import {
  Badge,
  Group,
  Select,
  Box,
  Button,
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
  source?: string;
}

export default function AxisAssignment() {
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
      label: `${c.name}${c.units ? ` (${c.units})` : ""}`,
      type: columnTypes[c.name] ?? c.inferredType,
      source: c.source,
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
      <Group gap="xs" wrap="wrap">
        <Badge size="xs" color={color}>
          {option.type}
        </Badge>
        <span className="dataviz-column-name" data-testid={`axis-option-name-${option.value}`}>
          {option.label}
        </span>
        {option.source && (
          <span
            className="dataviz-option-source"
            data-testid={`axis-option-source-${option.value}`}
          >
            {option.source}
          </span>
        )}
      </Group>
    );
  }

  return (
    <Box data-testid="axis-assignment" className="dataviz-axes">
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
      <Select
        label="Color by"
        data={colorByData}
        value={axisAssignment.colorBy ?? ""}
        onChange={(val) => setAxisAssignment({ colorBy: val || null })}
        renderOption={renderOption}
        {...comboboxTestIds("color-by-select")}
      />
      <Button
        leftSection={<IconAdjustmentsHorizontal size={14} />}
        variant="light"
        fullWidth
        onClick={() => setFiltersExpanded(!filtersExpanded)}
        aria-haspopup="dialog"
        aria-expanded={filtersExpanded}
        data-testid="settings-toggle-btn"
      >
        Settings
      </Button>
    </Box>
  );
}
