import { comboboxTestIds } from "../common/comboboxTestIds";
import { Card, Group, NativeSelect, Select, Stack, Text, TextInput } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { useState } from "react";
import { useImportTablePagination } from "./useImportTablePagination";

import { EMPTY_IMPORT_SETTINGS, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import type { ModalityAlias } from "../../schemas/importSchemas";

const MODALITY_OPTIONS = [
  { value: "__ignore__", label: "— Ignore —" },
  { value: "T1w", label: "T1-weighted Acquisition" },
  { value: "T2w", label: "T2-weighted Acquisition" },
  { value: "ASL4D", label: "ASL Acquisition" },
  { value: "M0", label: "M0 Calibration" },
  { value: "FLAIR", label: "FLAIR Acquisition" },
  { value: "WMH_SEGM", label: "White Matter Hyperintensity Segmentation" },
];

/**
 * Modality mapping table.
 * Shows all unique captured modality strings with a dropdown
 * to map each to an ExploreASL modality type or "Ignore".
 */
export default function ModalityMappingTable() {
  const modalityAliases = useProjectStore(
    (s) => s.project?.mappingState.modalityAliases ?? EMPTY_IMPORT_SETTINGS.modalityAliases,
  );
  const updateModalityAlias = useImportStore((s) => s.updateModalityAlias);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = modalityAliases.filter(
    (row) =>
      `${row.captured} ${row.mapped ?? "Ignore"}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || (filter === "mapped" ? row.mapped !== null : row.mapped === null)),
  );
  const { setPage, tableProps } = useImportTablePagination(filtered, "modality");

  function handleChange(captured: string, value: string | null) {
    const mapped =
      value === "__ignore__" || value === null ? null : (value as ModalityAlias["mapped"]);
    updateModalityAlias(captured, mapped);
  }

  if (modalityAliases.length === 0) {
    return (
      <Card withBorder p="md" data-testid="modality-empty">
        <Text c="dimmed" size="sm">
          No modalities detected. Complete the Path Tokenizer step first and assign a
          &quot;Modality&quot; tag.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Map each captured scan name to an ExploreASL modality. Ignored modalities will be excluded
        from the import.
      </Text>
      <Group align="flex-end" data-testid="modality-tools">
        <TextInput
          label="Search captured or target name"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1, minWidth: 180 }}
          data-testid="modality-search"
        />
        <NativeSelect
          label="Show mappings"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
            setPage(1);
          }}
          data={[
            { value: "all", label: "All" },
            { value: "mapped", label: "Mapped" },
            { value: "ignored", label: "Ignored" },
          ]}
          data-testid="modality-filter"
        />
      </Group>
      <Text size="xs" c="dimmed" data-testid="modality-summary">
        {modalityAliases.length} unique scan names. Multiple captured names may map to the same
        modality.
      </Text>
      <DataTable
        idAccessor="captured"
        {...tableProps}
        styles={{ table: { minWidth: 440 } }}
        highlightOnHover
        columns={[
          {
            accessor: "captured",
            title: "Captured Name",
            width: "35%",
            render: (row) => (
              <Text size="sm" ff="monospace">
                {row.captured}
              </Text>
            ),
          },
          {
            accessor: "mapped",
            title: "Mapped Modality",
            render: (alias) => (
              <Select
                aria-label={`Map ${alias.captured}`}
                data={MODALITY_OPTIONS}
                value={alias.mapped ?? "__ignore__"}
                onChange={(v) => handleChange(alias.captured, v)}
                size="sm"
                maw="100%"
                comboboxProps={{ withinPortal: true }}
                {...comboboxTestIds(
                  `modality-select-${alias.captured.replace(/[^a-z0-9]/gi, "-")}`,
                )}
              />
            ),
          },
        ]}
        data-testid="modality-table"
      />
    </Stack>
  );
}
