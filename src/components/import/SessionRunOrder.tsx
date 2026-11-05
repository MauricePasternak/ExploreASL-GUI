import { numberInputTestIds } from "../common/numberInputTestIds";
import {
  Button,
  Card,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { useState } from "react";
import { useImportTablePagination } from "./useImportTablePagination";

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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const conflicts = new Map<string, number[]>();
  aliases.forEach((entry, index) => {
    const indexes = conflicts.get(portableKey(entry.alias)) ?? [];
    indexes.push(index);
    conflicts.set(portableKey(entry.alias), indexes);
  });
  const records = aliases.map((entry) => ({
    ...entry,
    message:
      componentValidationMessage(entry.alias) ??
      ((conflicts.get(portableKey(entry.alias))?.length ?? 0) > 1
        ? `${validationField === "session" ? "Session" : "Run"} alias collides with another row under portable filesystem rules.`
        : undefined),
  }));
  const issueCount = records.filter((row) => row.message).length;
  const filtered = records.filter(
    (row) =>
      `${row.captured} ${row.alias}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || (filter === "issues" ? row.message : row.alias !== row.captured)),
  );
  const { setPage, tableProps } = useImportTablePagination(filtered, tableTestId);
  function handleAliasChange(captured: string, alias: string) {
    onAliasesChange(
      aliases.map((entry) => (entry.captured === captured ? { ...entry, alias } : entry)),
    );
  }

  function handleIndexChange(captured: string, newOrder: number) {
    onAliasesChange(
      aliases.map((entry) => (entry.captured === captured ? { ...entry, index: newOrder } : entry)),
    );
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
      <Group align="flex-end" data-testid={`${tableTestId}-tools`}>
        <TextInput
          label="Search captured or target name"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1, minWidth: 180 }}
          data-testid={`${tableTestId}-search`}
        />
        <NativeSelect
          label="Show labels"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
            setPage(1);
          }}
          data={[
            { value: "all", label: "All" },
            { value: "issues", label: `Issues (${issueCount})` },
            { value: "changed", label: "Changed" },
          ]}
          data-testid={`${tableTestId}-filter`}
        />
      </Group>
      <Text
        size="xs"
        c={issueCount ? "red" : "dimmed"}
        role="status"
        data-testid={`${tableTestId}-validation`}
      >
        {issueCount} rows need attention across all {records.length} labels. Validation includes
        every page.
      </Text>
      <DataTable
        idAccessor="captured"
        {...tableProps}
        styles={{ table: { minWidth: 480 } }}
        highlightOnHover
        verticalAlign="top"
        customRowAttributes={(row) => ({
          "data-testid": `${tableTestId}-row-${row.captured.replace(/[^a-z0-9]/gi, "-")}`,
        })}
        columns={[
          {
            accessor: "captured",
            title: "Captured Value",
            width: "32%",
            render: (row) => (
              <Text size="sm" ff="monospace">
                {row.captured}
              </Text>
            ),
          },
          {
            accessor: "alias",
            title: "Alias",
            render: (alias) => {
              const rowId = alias.captured.replace(/[^a-z0-9]/gi, "-");
              const { message } = alias;
              const suggested = message ? suggestion(alias.alias) : undefined;
              return (
                <div>
                  <TextInput
                    aria-label={`Target label for ${alias.captured}`}
                    value={alias.alias}
                    onChange={(e) => handleAliasChange(alias.captured, e.currentTarget.value)}
                    size="sm"
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
                      onClick={() => handleAliasChange(alias.captured, suggested)}
                      data-testid={`${tableTestId}-suggestion-${rowId}`}
                    >
                      Use suggestion: {suggested}
                    </Button>
                  )}
                </div>
              );
            },
          },
          {
            accessor: "index",
            title: "Order",
            width: 90,
            render: (alias) => (
              <NumberInput
                aria-label={`Chronological order for ${alias.captured}`}
                value={alias.index}
                onChange={(v) => handleIndexChange(alias.captured, Number(v))}
                min={1}
                size="xs"
                w={70}
                {...numberInputTestIds(
                  `order-index-input-${alias.captured.replace(/[^a-z0-9]/gi, "-")}`,
                )}
              />
            ),
          },
        ]}
        data-testid={tableTestId}
      />
    </Stack>
  );
}
