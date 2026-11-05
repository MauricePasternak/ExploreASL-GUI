import { comboboxTestIds } from "../common/comboboxTestIds";
import { Badge, Group, Paper, Select, Stack, Table, Text } from "@mantine/core";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { visualizationSettings } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";

const TYPE_OPTIONS = [
  { value: "continuous", label: "Continuous" },
  { value: "ordinal", label: "Ordinal" },
  { value: "nominal", label: "Nominal" },
  { value: "excluded", label: "Excluded" },
];

export default function ColumnTypes() {
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useProjectStore((s) => visualizationSettings(s.project).columnTypes);
  const setColumnType = useVisualizationStore((s) => s.setColumnType);
  const joinConfig = useProjectStore((s) => visualizationSettings(s.project).joinConfig);

  if (!inspection) {
    return (
      <Stack data-testid="column-types-table">
        <Text c="dimmed">No file selected.</Text>
      </Stack>
    );
  }

  const columnsToShow = [...inspection.columns].filter((c) => c.name !== "participant_id");

  columnsToShow.sort((a, b) => {
    const order = ["subject", "session", "run"];
    const idxA = order.indexOf(a.name);
    const idxB = order.indexOf(b.name);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  function isEnforcedContinuous(colName: string): boolean {
    const enforced = [
      "GM_vol",
      "WM_vol",
      "CSF_vol",
      "GM_ICVRatio",
      "GMWM_ICVRatio",
      "MeanMotion",
      "SubjectNList",
    ];
    return (
      enforced.includes(colName) ||
      colName.endsWith("_L") ||
      colName.endsWith("_R") ||
      colName.endsWith("_B")
    );
  }

  return (
    <Paper withBorder p="md" data-testid="column-types-table" className="dataviz-setup-panel">
      <Stack data-testid="column-types-content">
        <Group justify="space-between" data-testid="column-types-heading">
          <Text component="h2" size="md" fw={600} m={0} data-testid="column-types-title">
            Column types
          </Text>
          <Text size="sm" data-testid="column-types-count">
            {
              inspection.columns.filter(
                (col) => (columnTypes[col.name] ?? col.inferredType) !== "excluded",
              ).length
            }{" "}
            included / {inspection.columns.length} total columns
          </Text>
        </Group>
        <Text size="sm" c="dimmed" data-testid="column-types-help">
          Identifiers appear first; raw participant_id is hidden. Type edits preserve other columns
          and do not discover new levels. All columns remain available in the scrolling table.
        </Text>
        <Table.ScrollContainer
          minWidth={560}
          maxHeight="clamp(320px, calc(100dvh - 520px), 1200px)"
          type="native"
          tabIndex={0}
          role="region"
          aria-label="All column types"
          data-testid="column-types-scroll"
        >
          <Table className="dataviz-types-table" data-testid="column-types-rows">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Column</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Info</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {columnsToShow.map((col) => {
                const currentType = columnTypes[col.name] ?? col.inferredType;
                const isIdCol = ["subject", "session", "run"].includes(col.name);
                const isEnforced = isEnforcedContinuous(col.name);
                const selectData = isIdCol
                  ? [
                      { value: "nominal", label: "Nominal" },
                      { value: "ordinal", label: "Ordinal" },
                    ]
                  : TYPE_OPTIONS;

                return (
                  <Table.Tr
                    key={col.name}
                    data-testid={`column-type-row-${col.name}`}
                    style={{ opacity: currentType === "excluded" ? 0.5 : 1 }}
                  >
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm" className="dataviz-column-name">
                          {col.name}
                        </Text>
                        {col.isIdentifier && (
                          <Badge size="xs" color="blue" data-testid={`id-badge-${col.name}`}>
                            ID
                          </Badge>
                        )}
                        {joinConfig && col.source === "external" && (
                          <Badge size="xs" color="grape" data-testid={`source-badge-${col.name}`}>
                            external
                          </Badge>
                        )}
                        {joinConfig && col.source === "qcbf" && (
                          <Badge size="xs" color="blue" data-testid={`source-badge-${col.name}`}>
                            qCBF
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        data={selectData}
                        value={currentType}
                        onChange={(val) => setColumnType(col.name, val ?? col.inferredType)}
                        disabled={isEnforced}
                        size="xs"
                        aria-label={`Type for ${col.name}`}
                        style={{ width: 140 }}
                        {...comboboxTestIds(`type-select-${col.name}`)}
                      />
                    </Table.Td>
                    <Table.Td>
                      {col.units && (
                        <Text size="xs" c="dimmed">
                          {col.units}
                        </Text>
                      )}
                      {currentType !== "continuous" && col.levels.length > 0 && (
                        <Text size="xs" c="dimmed">
                          {col.levels.length} levels
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Paper>
  );
}
