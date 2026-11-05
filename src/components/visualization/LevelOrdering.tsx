import { Button, Group, Pagination, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { useState } from "react";
import { comboboxTestIds } from "../common/comboboxTestIds";

import { useVisualizationStore } from "../../stores/visualizationStore";
import { visualizationSettings } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";

export default function LevelOrdering() {
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useProjectStore((s) => visualizationSettings(s.project).columnTypes);
  const levelOrderings = useProjectStore((s) => visualizationSettings(s.project).levelOrderings);
  const setLevelOrdering = useVisualizationStore((s) => s.setLevelOrdering);
  const [column, setColumn] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  if (!inspection) return null;

  const categoricalColumns = inspection.columns.filter(
    (c) =>
      !c.isIdentifier && (columnTypes[c.name] === "ordinal" || columnTypes[c.name] === "nominal"),
  );

  if (categoricalColumns.length === 0) {
    return (
      <Stack data-testid="level-ordering">
        <Text c="dimmed">No categorical columns to reorder.</Text>
      </Stack>
    );
  }

  function moveLevel(colName: string, index: number, direction: -1 | 1) {
    const current =
      levelOrderings[colName] ?? inspection!.columns.find((c) => c.name === colName)?.levels ?? [];
    const next = [...current];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= next.length) return;
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    setLevelOrdering(colName, next);
  }
  const selectedColumn =
    categoricalColumns.find((col) => col.name === column) ?? categoricalColumns[0];
  const levels = levelOrderings[selectedColumn.name] ?? selectedColumn.levels;
  const filteredLevels = levels
    .map((level, index) => ({ level, index }))
    .filter(({ level }) => level.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredLevels.length / 10));
  const currentPage = Math.min(page, pageCount);

  return (
    <Paper withBorder p="md" data-testid="level-ordering" className="dataviz-setup-panel">
      <Stack data-testid="level-ordering-content">
        <Text component="h2" size="md" fw={600} m={0} data-testid="level-ordering-title">
          Categorical level ordering
        </Text>
        <Text size="sm" c="dimmed">
          Reorder levels for categorical columns in this editor. Swarmplots keep categories in
          encounter order from filtered chart rows. Moves use full-list positions, including hidden
          and off-page neighbors.
        </Text>
        <Select
          label={`Categorical column · ${categoricalColumns.length} total`}
          data={categoricalColumns.map((col) => col.name)}
          value={selectedColumn.name}
          searchable
          onChange={(value) => {
            setColumn(value);
            setSearch("");
            setPage(1);
          }}
          {...comboboxTestIds("level-ordering-column")}
        />
        <TextInput
          label="Search levels"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
          data-testid="level-ordering-search"
        />
        <Text size="sm" data-testid="level-ordering-count">
          {levels.length} full-list levels ·{" "}
          {levelOrderings[selectedColumn.name] ? "custom order" : "file encounter order"}
        </Text>
        <Paper p="sm" withBorder data-testid={`level-order-${selectedColumn.name}`}>
          <Text
            size="sm"
            fw={500}
            mb="xs"
            className="dataviz-column-name"
            data-testid="level-ordering-selected-column"
          >
            {selectedColumn.name} · {selectedColumn.source}
            {selectedColumn.units && ` · ${selectedColumn.units}`}
          </Text>
          <Stack gap={4}>
            {filteredLevels
              .slice((currentPage - 1) * 10, currentPage * 10)
              .map(({ level, index: idx }) => (
                <Group
                  key={level}
                  gap="xs"
                  wrap="nowrap"
                  data-testid={`level-item-${selectedColumn.name}-${idx}`}
                >
                  <Text size="xs" className="dataviz-column-name" style={{ flex: 1 }}>
                    {idx + 1}. {level}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => moveLevel(selectedColumn.name, idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move ${level} up`}
                    data-testid={`level-up-${selectedColumn.name}-${idx}`}
                  >
                    <IconArrowUp size={14} />
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => moveLevel(selectedColumn.name, idx, 1)}
                    disabled={idx === levels.length - 1}
                    aria-label={`Move ${level} down`}
                    data-testid={`level-down-${selectedColumn.name}-${idx}`}
                  >
                    <IconArrowDown size={14} />
                  </Button>
                </Group>
              ))}
          </Stack>
        </Paper>
        {!filteredLevels.length && (
          <Text size="sm" c="dimmed" data-testid="level-ordering-empty">
            {levels.length
              ? "No matching levels."
              : "No inspection levels. Changing a type does not discover categories."}
          </Text>
        )}
        <Group justify="space-between" data-testid="level-ordering-pagination">
          <Text size="xs" c="dimmed" data-testid="level-ordering-range">
            {filteredLevels.length
              ? `${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, filteredLevels.length)} of ${filteredLevels.length} levels`
              : "0 levels"}{" "}
            · 10 per page
          </Text>
          <Pagination
            total={pageCount}
            value={currentPage}
            onChange={setPage}
            size="sm"
            getControlProps={(control) => ({
              "aria-label": `${control} level page`,
              "data-testid": `level-ordering-page-${control}`,
            })}
            getItemProps={(item) => ({
              "aria-label": `Level page ${item}`,
              "data-testid": `level-ordering-page-${item}`,
            })}
            data-testid="level-ordering-pages"
          />
        </Group>
      </Stack>
    </Paper>
  );
}
