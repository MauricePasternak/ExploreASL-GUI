import {
  Card,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";

import { useImportStore } from "../../stores/importStore";

/**
 * Session / Run ordering table.
 * Shows captured session values with alias assignment and ordering.
 */
export default function SessionRunOrder() {
  const sessionAliases = useImportStore((s) => s.sessionAliases);
  const setSessionAliases = useImportStore((s) => s.setSessionAliases);

  function handleAliasChange(index: number, alias: string) {
    const updated = [...sessionAliases];
    updated[index] = { ...updated[index], alias };
    setSessionAliases(updated);
  }

  function handleIndexChange(index: number, newOrder: number) {
    const updated = [...sessionAliases];
    updated[index] = { ...updated[index], index: newOrder };
    setSessionAliases(updated);
  }

  if (sessionAliases.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" size="sm">
          No sessions detected. If your data has only one session per subject,
          the default &quot;01&quot; will be used automatically.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Assign display aliases and chronological ordering to each captured
        session value.
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Captured Value</Table.Th>
            <Table.Th>Alias</Table.Th>
            <Table.Th>Order</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sessionAliases.map((alias, idx) => (
            <Table.Tr key={alias.captured}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {alias.captured}
                </Text>
              </Table.Td>
              <Table.Td>
                <TextInput
                  value={alias.alias}
                  onChange={(e) => handleAliasChange(idx, e.currentTarget.value)}
                  size="xs"
                  w={120}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  value={alias.index}
                  onChange={(v) => handleIndexChange(idx, Number(v))}
                  min={1}
                  size="xs"
                  w={70}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
