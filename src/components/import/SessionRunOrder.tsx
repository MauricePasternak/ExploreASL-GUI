import {
  Card,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";

import type { SessionAlias } from "../../schemas/importSchemas";

interface OrderAliasTableProps {
  aliases: SessionAlias[];
  onAliasesChange: (aliases: SessionAlias[]) => void;
  emptyMessage: string;
  description: string;
  emptyTestId: string;
  tableTestId: string;
}

/**
 * Session or run ordering table.
 * Shows captured values with alias assignment and chronological ordering.
 */
export default function OrderAliasTable({
  aliases,
  onAliasesChange,
  emptyMessage,
  description,
  emptyTestId,
  tableTestId,
}: OrderAliasTableProps) {
  function handleAliasChange(index: number, alias: string) {
    const updated = [...aliases];
    updated[index] = { ...updated[index], alias };
    onAliasesChange(updated);
  }

  function handleIndexChange(index: number, newOrder: number) {
    const updated = [...aliases];
    updated[index] = { ...updated[index], index: newOrder };
    onAliasesChange(updated);
  }

  if (aliases.length === 0) {
    return (
      <Card withBorder p="md" data-testid={emptyTestId}>
        <Text c="dimmed" size="sm">
          {emptyMessage}
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {description}
      </Text>
      <Table striped highlightOnHover data-testid={tableTestId}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Captured Value</Table.Th>
            <Table.Th>Alias</Table.Th>
            <Table.Th>Order</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {aliases.map((alias, idx) => (
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
                  data-testid={`order-alias-input-${alias.captured.replace(/[^a-z0-9]/gi, "-")}`}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  value={alias.index}
                  onChange={(v) => handleIndexChange(idx, Number(v))}
                  min={1}
                  size="xs"
                  w={70}
                  data-testid={`order-index-input-${alias.captured.replace(/[^a-z0-9]/gi, "-")}`}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
