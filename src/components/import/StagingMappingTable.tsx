import { Card, Stack, Table, Text, Title } from "@mantine/core";
import { TableVirtuoso } from "react-virtuoso";

import type {
  MetadataGroup,
  StagingMappingByPattern,
  SubjectRow,
} from "../../schemas/importSchemas";
import { decodePatternSignature } from "../../lib/tokenizerUtils";
import { useGlobalStore } from "../../stores/globalStore";

const TABLE_HEIGHT = 400;
const ROW_HEIGHT = 28;
const TH_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "var(--mantine-color-body)",
};

interface StagingMappingTableProps {
  mappings: StagingMappingByPattern[];
  subjectRows: SubjectRow[];
  metadataGroups: MetadataGroup[];
}

export default function StagingMappingTable({
  mappings,
  subjectRows,
  metadataGroups,
}: StagingMappingTableProps) {
  const tokenSubDelimiters = useGlobalStore((s) => s.settings.tokenSubDelimiters);

  if (mappings.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No staging mappings yet. Complete tokenizer and alias steps first.
      </Text>
    );
  }

  const rowById = new Map(subjectRows.map((r) => [r.id, r]));
  const groupLabelById = new Map(metadataGroups.map((g) => [g.id, g.label]));

  function getGroupLabel(subject: string, session: string): string {
    const id = `${subject}/${session}`;
    const row = rowById.get(id);
    if (!row) return "—";
    return groupLabelById.get(row.groupId) ?? row.groupId;
  }

  return (
    <Stack gap="md" data-testid="staging-mapping-table">
      <Title order={4}>Staging Preview</Title>
      <Text c="dimmed" size="sm">
        Raw DICOM paths are organized into a normalized{" "}
        <Text fw={600} component="span">
          Subject/Session/Run/Modality
        </Text>{" "}
        tree before ExploreASL processes them. The table below shows how each path maps to its
        staging location.
      </Text>

      {mappings.map((mapping) => {
        const decodedSignature = decodePatternSignature(
          mapping.patternSignature,
          mapping.assignments,
          tokenSubDelimiters,
        );

        const height = Math.min(mapping.entries.length * ROW_HEIGHT, TABLE_HEIGHT);

        return (
          <Card
            key={mapping.patternSignature}
            withBorder
            p="md"
            data-testid={`staging-mapping-${decodedSignature}`}
          >
            <Text fw={600} size="sm" mb="xs">
              Pattern: {decodedSignature}
            </Text>
            <Text c="dimmed" size="xs" mb="xs">
              {mapping.entries.length} path{mapping.entries.length !== 1 ? "s" : ""} ·{" "}
              {mapping.pattern.count} total matching
            </Text>

            <TableVirtuoso
              style={{ height }}
              data={mapping.entries}
              components={{
                Table: (props) => <Table striped highlightOnHover fz="xs" {...props} />,
                TableHead: (props) => <Table.Thead {...props} />,
                TableBody: (props) => <Table.Tbody {...props} />,
                TableRow: (props) => <Table.Tr {...props} />,
              }}
              fixedHeaderContent={() => (
                <Table.Tr>
                  <Table.Th style={TH_STYLE}>Source (relative)</Table.Th>
                  <Table.Th style={TH_STYLE}>→</Table.Th>
                  <Table.Th style={TH_STYLE}>Staging Path</Table.Th>
                  <Table.Th style={TH_STYLE}>Metadata Group</Table.Th>
                </Table.Tr>
              )}
              itemContent={(_idx, entry) => {
                const relative = entry.sourcePath.split("/sourcedata/").pop() ?? entry.sourcePath;
                const stagingPath = `${entry.subject}/${entry.session}/${entry.run}/${entry.modality}`;
                return (
                  <>
                    <Table.Td>{relative}</Table.Td>
                    <Table.Td>→</Table.Td>
                    <Table.Td>{stagingPath}</Table.Td>
                    <Table.Td>{getGroupLabel(entry.subject, entry.session)}</Table.Td>
                  </>
                );
              }}
            />
          </Card>
        );
      })}
    </Stack>
  );
}
