import { Button, Card, NumberInput, Stack, Table, Text, TextInput } from "@mantine/core";

import type { SessionAlias } from "../../schemas/importSchemas";
import {
  componentValidationMessage,
  portableKey,
  suggestPortableComponent,
} from "../../lib/stagingValidation";

interface OrderAliasTableProps {
  aliases: SessionAlias[];
  onAliasesChange: (aliases: SessionAlias[]) => void;
  emptyMessage: string;
  description: string;
  emptyTestId: string;
  tableTestId: string;
  validationField: "session" | "runAlias";
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
  validationField,
}: OrderAliasTableProps) {
  const conflicts = new Map<string, number[]>();
  aliases.forEach((entry, index) => {
    const indexes = conflicts.get(portableKey(entry.alias)) ?? [];
    indexes.push(index);
    conflicts.set(portableKey(entry.alias), indexes);
  });
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

  function suggestion(value: string): string | undefined {
    const base = suggestPortableComponent(value) ?? value;
    if (componentValidationMessage(base)) return undefined;
    const used = new Set(aliases.map((entry) => portableKey(entry.alias)));
    if (base !== value && !used.has(portableKey(base))) return base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!used.has(portableKey(candidate))) return candidate;
    }
    return undefined;
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
          {aliases.map((alias, idx) => {
            const rowId = alias.captured.replace(/[^a-z0-9]/gi, "-");
            const message =
              componentValidationMessage(alias.alias) ??
              ((conflicts.get(portableKey(alias.alias))?.length ?? 0) > 1
                ? `${validationField === "session" ? "Session" : "Run"} alias collides with another row under portable filesystem rules.`
                : undefined);
            const suggested = message ? suggestion(alias.alias) : undefined;
            return (
              <Table.Tr key={alias.captured} data-testid={`${tableTestId}-row-${rowId}`}>
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
                    error={message}
                    data-testid={`order-alias-input-${rowId}`}
                  />
                  {message && (
                    <Text c="red" size="xs" data-testid={`${tableTestId}-error-${rowId}`}>
                      {message}
                    </Text>
                  )}
                  {suggested && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => handleAliasChange(idx, suggested)}
                      data-testid={`${tableTestId}-suggestion-${rowId}`}
                    >
                      Use suggestion: {suggested}
                    </Button>
                  )}
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    value={alias.index}
                    onChange={(v) => handleIndexChange(idx, Number(v))}
                    min={1}
                    size="xs"
                    w={70}
                    data-testid={`order-index-input-${rowId}`}
                  />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
