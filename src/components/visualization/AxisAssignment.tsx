import { Badge, Group, Select, Stack } from "@mantine/core";
import { useVisualizationStore } from "../../stores/visualizationStore";

export default function AxisAssignment() {
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useVisualizationStore((s) => s.columnTypes);
  const axisAssignment = useVisualizationStore((s) => s.axisAssignment);
  const setAxisAssignment = useVisualizationStore((s) => s.setAxisAssignment);

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

  function renderOption(item: any) {
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
    <Stack data-testid="axis-assignment" gap="sm">
      <Select
        label="X-axis"
        placeholder="Select column"
        data={xData}
        value={axisAssignment.x}
        onChange={(val) => setAxisAssignment({ x: val, colorBy: null })}
        renderOption={renderOption}
        searchable
        data-testid="x-axis-select"
      />
      <Select
        label="Y-axis (continuous)"
        placeholder="Select column"
        data={yData}
        value={axisAssignment.y}
        onChange={(val) => setAxisAssignment({ y: val, colorBy: null })}
        renderOption={renderOption}
        searchable
        data-testid="y-axis-select"
      />
      <Select
        label="Color by"
        data={colorByData}
        value={axisAssignment.colorBy ?? ""}
        onChange={(val) => setAxisAssignment({ colorBy: val || null })}
        renderOption={renderOption}
        data-testid="color-by-select"
      />
    </Stack>
  );
}
