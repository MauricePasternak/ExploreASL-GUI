import { Group, Paper, Stack, Text, Badge } from "@mantine/core";

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
  const extFileName = extFilePath.split("/").pop() ?? extFilePath;

  return (
    <Paper p="md" withBorder data-testid="join-diagram">
      <Stack gap="sm">
        <Text fw={500}>Join Preview</Text>
        <Group gap="md" align="flex-start">
          <Stack gap={0} style={{ flex: 1 }} data-testid="diagram-qcbf-box">
            <Paper p="xs" withBorder bg="blue.0">
              <Text size="sm" fw={500}>
                {qcbfFileName}
              </Text>
            </Paper>
            <Stack gap={2} p="xs">
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

          <Stack justify="center" style={{ flexShrink: 0 }} data-testid="diagram-connector">
            <Text size="xs" fw={700} ta="center">
              LEFT
            </Text>
            <Text size="xs" fw={700} ta="center">
              JOIN
            </Text>
          </Stack>

          <Stack gap={0} style={{ flex: 1 }} data-testid="diagram-external-box">
            <Paper p="xs" withBorder bg="grape.0">
              <Text size="sm" fw={500}>
                {extFileName}
              </Text>
            </Paper>
            <Stack gap={2} p="xs">
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
