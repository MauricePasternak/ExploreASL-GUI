import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";

import { useVisualizationStore } from "../../stores/visualizationStore";

export default function LevelOrdering() {
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useVisualizationStore((s) => s.columnTypes);
  const levelOrderings = useVisualizationStore((s) => s.levelOrderings);
  const setLevelOrdering = useVisualizationStore((s) => s.setLevelOrdering);

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

  return (
    <Stack data-testid="level-ordering">
      <Text size="sm" c="dimmed">
        Reorder levels for categorical columns. This controls X-axis tick order in swarmplots.
      </Text>
      {categoricalColumns.map((col) => {
        const levels = levelOrderings[col.name] ?? col.levels;
        return (
          <Paper key={col.name} p="sm" withBorder data-testid={`level-order-${col.name}`}>
            <Text size="sm" fw={500} mb="xs">
              {col.name}
            </Text>
            <Stack gap={4}>
              {levels.map((level, idx) => (
                <Group key={level} gap="xs" data-testid={`level-item-${col.name}-${idx}`}>
                  <Text size="xs" style={{ flex: 1 }}>
                    {level}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => moveLevel(col.name, idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move ${level} up`}
                    data-testid={`level-up-${col.name}-${idx}`}
                  >
                    <IconArrowUp size={14} />
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => moveLevel(col.name, idx, 1)}
                    disabled={idx === levels.length - 1}
                    aria-label={`Move ${level} down`}
                    data-testid={`level-down-${col.name}-${idx}`}
                  >
                    <IconArrowDown size={14} />
                  </Button>
                </Group>
              ))}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
