import { Group, Paper, Stack, Text, Badge } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";

interface JoinDiagramProps {
  qcbfFileName: string;
  qcbfRowCount: number;
  qcbfColumns: Array<{ name: string; isIdentifier: boolean }>;
  extFilePath: string;
  extRowCount: number;
  extColumns: Array<{ name: string }>;
  keyPairs: { left: string; right: string }[];
}

export default function JoinDiagram({
  qcbfFileName,
  qcbfRowCount,
  qcbfColumns,
  extFilePath,
  extRowCount,
  extColumns,
  keyPairs,
}: JoinDiagramProps) {
  const pairedLeft = new Set(keyPairs.map((p) => p.left));
  const pairedRight = new Set(keyPairs.map((p) => p.right));
  const extFileName = extFilePath.split(/[/\\]/).pop() ?? extFilePath;

  return (
    <Paper p="md" withBorder data-testid="join-diagram">
      <Stack gap="sm">
        <Text fw={500}>Join Preview</Text>
        <Group gap="md" align="flex-start" wrap="nowrap" className="dataviz-join-diagram">
          <Stack gap={0} style={{ flex: 1 }} data-testid="diagram-qcbf-box">
            <Paper p="xs" withBorder className="dataviz-join-source">
              <Text size="sm" fw={500}>
                {qcbfFileName}
              </Text>
            </Paper>
            <Stack
              gap={2}
              p="xs"
              className="dataviz-join-columns"
              tabIndex={0}
              role="region"
              aria-label="qCBF columns"
              data-testid="diagram-qcbf-columns"
            >
              {qcbfColumns.map((col) => (
                <Text
                  component="div"
                  key={col.name}
                  size="xs"
                  c={pairedLeft.has(col.name) ? "blue" : "dimmed"}
                  fw={pairedLeft.has(col.name) ? 700 : 400}
                  data-testid={`diagram-qcbf-col-${col.name}`}
                >
                  {col.name}
                  {col.isIdentifier && (
                    <Badge size="xs" ml={4}>
                      ID
                    </Badge>
                  )}
                </Text>
              ))}
            </Stack>
            <Text size="xs" c="dimmed">
              {qcbfRowCount.toLocaleString()} rows
            </Text>
          </Stack>

          <Stack
            gap={4}
            align="center"
            justify="center"
            style={{ flexShrink: 0 }}
            data-testid="diagram-connector"
          >
            <Text size="xs" fw={700} ta="center">
              LEFT
            </Text>
            <IconArrowLeft
              size={16}
              data-testid="diagram-arrow"
              style={{ color: "var(--mantine-color-dimmed)" }}
            />
            <Text size="xs" fw={700} ta="center">
              JOIN
            </Text>
          </Stack>

          <Stack gap={0} style={{ flex: 1 }} data-testid="diagram-external-box">
            <Paper p="xs" withBorder className="dataviz-join-source">
              <Text size="sm" fw={500}>
                {extFileName}
              </Text>
            </Paper>
            <Stack
              gap={2}
              p="xs"
              className="dataviz-join-columns"
              tabIndex={0}
              role="region"
              aria-label="External columns"
              data-testid="diagram-external-columns"
            >
              {extColumns.map((col) => (
                <Text
                  key={col.name}
                  size="xs"
                  c={pairedRight.has(col.name) ? "grape" : "dimmed"}
                  fw={pairedRight.has(col.name) ? 700 : 400}
                  data-testid={`diagram-ext-col-${col.name}`}
                >
                  {col.name}
                </Text>
              ))}
            </Stack>
            <Text size="xs" c="dimmed">
              {extRowCount.toLocaleString()} rows
            </Text>
          </Stack>
        </Group>
      </Stack>
    </Paper>
  );
}
