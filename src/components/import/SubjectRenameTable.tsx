import {
  Card,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";

import { useImportStore } from "../../stores/importStore";

/**
 * Subject rename table.
 * Shows original subject names with editable target names.
 */
export default function SubjectRenameTable() {
  const subjectRenames = useImportStore((s) => s.subjectRenames);
  const updateSubjectRename = useImportStore((s) => s.updateSubjectRename);

  if (subjectRenames.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" size="sm">
          No subjects detected. Complete the Path Tokenizer step first and
          assign a &quot;Subject&quot; tag.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Rename subjects to BIDS-compliant names. Leave unchanged to keep
        the original names.
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Original</Table.Th>
            <Table.Th>BIDS Name</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {subjectRenames.map((rename) => (
            <Table.Tr key={rename.original}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {rename.original}
                </Text>
              </Table.Td>
              <Table.Td>
                <TextInput
                  value={rename.target}
                  onChange={(e) =>
                    updateSubjectRename(
                      rename.original,
                      e.currentTarget.value,
                    )
                  }
                  size="xs"
                  w={200}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
