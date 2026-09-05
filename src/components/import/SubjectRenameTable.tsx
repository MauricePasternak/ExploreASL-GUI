import { Button, Card, Stack, Table, Text, TextInput } from "@mantine/core";

import { componentValidationMessage, portableKey } from "../../lib/stagingValidation";
import { useImportStore } from "../../stores/importStore";

/**
 * Subject rename table.
 * Shows original subject names with editable target names.
 */
export default function SubjectRenameTable() {
  const subjectRenames = useImportStore((s) => s.subjectRenames);
  const updateSubjectRename = useImportStore((s) => s.updateSubjectRename);
  const conflicts = new Map<string, number[]>();
  subjectRenames.forEach((rename, index) => {
    const indexes = conflicts.get(portableKey(rename.target)) ?? [];
    indexes.push(index);
    conflicts.set(portableKey(rename.target), indexes);
  });

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
      <Table striped highlightOnHover data-testid="subject-rename-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Original</Table.Th>
            <Table.Th>BIDS Name</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {subjectRenames.map((rename) => {
            const rowId = rename.original.replace(/[^a-z0-9]/gi, "-");
            const validation = componentValidationMessage(rename.target);
            const invalidSubject =
              !/^[A-Za-z0-9]+$/.test(rename.target) || rename.target.startsWith("sub-");
            const collision = (conflicts.get(portableKey(rename.target))?.length ?? 0) > 1;
            const message =
              validation ??
              (invalidSubject
                ? "Subject must be ASCII alphanumeric and must not include the sub- prefix."
                : collision
                  ? "Subject target collides with another row under portable filesystem rules."
                  : undefined);
            const suggested = message ? suggestion(rename.target) : undefined;
            return (
              <Table.Tr key={rename.original} data-testid={`subject-rename-row-${rowId}`}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {rename.original}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <TextInput
                    value={rename.target}
                    onChange={(e) => updateSubjectRename(rename.original, e.currentTarget.value)}
                    size="xs"
                    w={200}
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
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
