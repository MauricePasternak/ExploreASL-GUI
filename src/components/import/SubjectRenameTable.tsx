import { Button, Card, Group, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { useState } from "react";
import { useImportTablePagination } from "./useImportTablePagination";

import { componentValidationMessage, portableKey } from "../../lib/stagingValidation";
import { EMPTY_IMPORT_SETTINGS, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

/**
 * Subject rename table.
 * Shows original subject names with editable target names.
 */
export default function SubjectRenameTable() {
  const acceptedRenames = useProjectStore(
    (s) => s.project?.mappingState.subjectRenames ?? EMPTY_IMPORT_SETTINGS.subjectRenames,
  );
  const drafts = useImportStore((s) => s.aliasDrafts.subjectRenames);
  const subjectRenames = drafts ?? acceptedRenames;
  const updateSubjectRename = useImportStore((s) => s.updateSubjectRename);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const conflicts = new Map<string, number[]>();
  subjectRenames.forEach((rename, index) => {
    const indexes = conflicts.get(portableKey(rename.target)) ?? [];
    indexes.push(index);
    conflicts.set(portableKey(rename.target), indexes);
  });
  const records = subjectRenames.map((rename) => ({
    ...rename,
    message:
      componentValidationMessage(rename.target) ??
      (!/^[A-Za-z0-9]+$/.test(rename.target) || rename.target.startsWith("sub-")
        ? "Subject must be ASCII alphanumeric and must not include the sub- prefix."
        : (conflicts.get(portableKey(rename.target))?.length ?? 0) > 1
          ? "Subject target collides with another row under portable filesystem rules."
          : undefined),
  }));
  const issueCount = records.filter((row) => row.message).length;
  const filtered = records.filter(
    (row) =>
      `${row.original} ${row.target}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || (filter === "issues" ? row.message : row.original !== row.target)),
  );
  const { setPage, tableProps } = useImportTablePagination(filtered, "subject-rename");

  function suggestion(target: string): string | undefined {
    const base = target.replace(/^sub-/i, "").replace(/[^A-Za-z0-9]/g, "");
    if (!base || !/^[A-Za-z0-9]+$/.test(base)) return undefined;
    const used = new Set(subjectRenames.map((rename) => portableKey(rename.target)));
    if (!used.has(portableKey(base))) return base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}${suffix}`;
      if (!used.has(portableKey(candidate))) return candidate;
    }
    return undefined;
  }

  if (subjectRenames.length === 0) {
    return (
      <Card withBorder p="md" data-testid="subject-rename-empty">
        <Text c="dimmed" size="sm">
          No subjects detected. Complete the Path Tokenizer step first and assign a
          &quot;Subject&quot; tag.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Rename subjects to BIDS-compliant names. Leave unchanged to keep the original names.
      </Text>
      <Group align="flex-end" data-testid="subject-rename-tools">
        <TextInput
          label="Search captured or target name"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1, minWidth: 180 }}
          data-testid="subject-rename-search"
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
          data-testid="subject-rename-filter"
        />
      </Group>
      <Text
        size="xs"
        c={issueCount ? "red" : "dimmed"}
        role="status"
        data-testid="subject-rename-validation"
      >
        {issueCount} rows need attention across all {records.length} labels. Validation includes
        every page.
      </Text>
      <DataTable
        idAccessor="original"
        {...tableProps}
        styles={{ table: { minWidth: 440 } }}
        highlightOnHover
        verticalAlign="top"
        customRowAttributes={(row) => ({
          "data-testid": `subject-rename-row-${row.original.replace(/[^a-z0-9]/gi, "-")}`,
        })}
        columns={[
          {
            accessor: "original",
            title: "Captured from source",
            width: "40%",
            render: (row) => (
              <Text size="sm" ff="monospace">
                {row.original}
              </Text>
            ),
          },
          {
            accessor: "target",
            title: "BIDS Name",
            render: (rename) => {
              const rowId = rename.original.replace(/[^a-z0-9]/gi, "-");
              const { message } = rename;
              const suggested = message ? suggestion(rename.target) : undefined;
              return (
                <div>
                  <TextInput
                    aria-label={`Target label for ${rename.original}`}
                    value={rename.target}
                    onChange={(e) => updateSubjectRename(rename.original, e.currentTarget.value)}
                    size="sm"
                    error={message}
                    data-testid={`subject-rename-input-${rowId}`}
                  />
                  {message && (
                    <Text c="red" size="xs" data-testid={`subject-rename-error-${rowId}`}>
                      {message}
                    </Text>
                  )}
                  {suggested && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => updateSubjectRename(rename.original, suggested)}
                      data-testid={`subject-rename-suggestion-${rowId}`}
                    >
                      Use suggestion: {suggested}
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
        data-testid="subject-rename-table"
      />
    </Stack>
  );
}
