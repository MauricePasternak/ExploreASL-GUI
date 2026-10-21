import { Card, Select, Stack, Table, Text } from "@mantine/core";

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
      <Table striped highlightOnHover data-testid="modality-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Captured Name</Table.Th>
            <Table.Th>Mapped Modality</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {modalityAliases.map((alias) => (
            <Table.Tr key={alias.captured}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {alias.captured}
                </Text>
              </Table.Td>
              <Table.Td>
                <Select
                  data={MODALITY_OPTIONS}
                  value={alias.mapped ?? "__ignore__"}
                  onChange={(v) => handleChange(alias.captured, v)}
                  size="xs"
                  w={360}
                  maw="100%"
                  comboboxProps={{ withinPortal: false }}
                  data-testid={`modality-select-${alias.captured.replace(/[^a-z0-9]/gi, "-")}`}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
