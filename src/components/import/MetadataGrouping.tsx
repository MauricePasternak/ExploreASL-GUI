import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconPlus } from "@tabler/icons-react";

import type {
  BidsAslMetadata,
  MetadataGroup,
  SubjectRow,
  TokenAssignment,
} from "../../schemas/importSchemas";
import { splitBySubDelimiters } from "../../lib/pathUtils";
import { useImportStore } from "../../stores/importStore";
import { useGlobalStore } from "../../stores/globalStore";
import MetadataModal from "./MetadataModal";

const DEFAULT_GROUP_ID = "global-defaults";

function pathMatchesPattern(segments: string[], pattern: ReturnType<typeof useImportStore.getState>["pathPatterns"][number]): boolean {
  if (segments.length !== pattern.depth) {
    return false;
  }

  return segments.every((segment, index) => {
    const allowedValues = pattern.uniqueNames[index] ?? [];
    return allowedValues.length === 0 || allowedValues.includes(segment);
  });
}

function extractAssignmentValue(
  segments: string[],
  assignment: TokenAssignment,
  tokenSubDelimiters: string[],
): string {
  const value = segments[assignment.blockIndex] ?? "";
  if (assignment.subBlockIndex === null) {
    return value;
  }

  const { subBlocks } = splitBySubDelimiters(value, tokenSubDelimiters);
  const parts = subBlocks;
  return parts[assignment.subBlockIndex] ?? "";
}

function buildExactMatchRegex(values: string[]): string {
  const escaped = [...new Set(values)]
    .filter(Boolean)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (escaped.length === 0) {
    return "";
  }

  return `^(${escaped.join("|")})$`;
}

function deriveSubjectRows({
  rawPaths,
  sourceDataPath,
  pathPatterns,
  tokenizerConfigs,
  subjectRenames,
  tokenSubDelimiters,
}: {
  rawPaths: string[];
  sourceDataPath: string;
  pathPatterns: ReturnType<typeof useImportStore.getState>["pathPatterns"];
  tokenizerConfigs: ReturnType<typeof useImportStore.getState>["tokenizerConfigs"];
  subjectRenames: ReturnType<typeof useImportStore.getState>["subjectRenames"];
  tokenSubDelimiters: string[];
}): SubjectRow[] {
  const renameMap = new Map(subjectRenames.map((entry) => [entry.original, entry.target]));
  const rows = new Map<string, SubjectRow>();

  for (const pattern of pathPatterns) {
    const assignments = tokenizerConfigs[pattern.signature] ?? [];
    const subjectAssignment = assignments.find((assignment) => assignment.tag === "Subject");

    if (!subjectAssignment) {
      continue;
    }

    const sessionAssignment = assignments.find((assignment) => assignment.tag === "Session");
    const runAssignment = assignments.find((assignment) => assignment.tag === "Run");

    for (const fullPath of rawPaths) {
      if (!fullPath.startsWith(sourceDataPath)) {
        continue;
      }

      const relativePath = fullPath.slice(sourceDataPath.length).replace(/^\/+/, "");
      const segments = relativePath.split("/").filter(Boolean);
      if (!pathMatchesPattern(segments, pattern)) {
        continue;
      }

      const rawSubject = extractAssignmentValue(
        segments,
        subjectAssignment,
        tokenSubDelimiters,
      );
      if (!rawSubject) {
        continue;
      }

      const subject = renameMap.get(rawSubject) ?? rawSubject;
      const session = sessionAssignment
        ? extractAssignmentValue(segments, sessionAssignment, tokenSubDelimiters) || "01"
        : "01";
      const run = runAssignment
        ? extractAssignmentValue(segments, runAssignment, tokenSubDelimiters) || "01"
        : "01";

      const id = `${subject}/${session}/${run}`;
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          subject,
          session,
          run,
          groupId: DEFAULT_GROUP_ID,
        });
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export default function MetadataGrouping() {
  const setActiveStep = useImportStore((state) => state.setActiveStep);
  const rawPaths = useImportStore((state) => state.rawPaths);
  const sourceDataPath = useImportStore((state) => state.sourceDataPath);
  const pathPatterns = useImportStore((state) => state.pathPatterns);
  const tokenizerConfigs = useImportStore((state) => state.tokenizerConfigs);
  const subjectRenames = useImportStore((state) => state.subjectRenames);
  const metadataGroups = useImportStore((state) => state.metadataGroups);
  const subjectRows = useImportStore((state) => state.subjectRows);
  const setSubjectRows = useImportStore((state) => state.setSubjectRows);
  const addMetadataGroup = useImportStore((state) => state.addMetadataGroup);
  const updateMetadataGroup = useImportStore((state) => state.updateMetadataGroup);
  const updateSubjectRowGroup = useImportStore((state) => state.updateSubjectRowGroup);
  const tokenSubDelimiters = useGlobalStore((state) => state.settings.tokenSubDelimiters);
  const hasDerivationContext =
    sourceDataPath.length > 0 && rawPaths.length > 0 && pathPatterns.length > 0;

  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [modalMode, setModalMode] = useState<"defaults" | "override" | null>(null);

  const derivedRows = useMemo(
    () =>
      deriveSubjectRows({
        rawPaths,
        sourceDataPath,
        pathPatterns,
        tokenizerConfigs,
        subjectRenames,
        tokenSubDelimiters,
      }),
    [
      rawPaths,
      sourceDataPath,
      pathPatterns,
      tokenizerConfigs,
      subjectRenames,
      tokenSubDelimiters,
    ],
  );

  useEffect(() => {
    if (!hasDerivationContext) {
      return;
    }

    const existingGroupMap = new Map(subjectRows.map((row) => [row.id, row.groupId]));
    const nextRows = derivedRows.map((row) => ({
      ...row,
      groupId: existingGroupMap.get(row.id) ?? DEFAULT_GROUP_ID,
    }));

    if (
      subjectRows.length !== nextRows.length ||
      subjectRows.some(
        (row, index) =>
          row.id !== nextRows[index]?.id || row.groupId !== nextRows[index]?.groupId,
      )
    ) {
      setSubjectRows(nextRows);
    }
  }, [derivedRows, hasDerivationContext, setSubjectRows, subjectRows]);

  useEffect(() => {
    if (metadataGroups.length === 0) {
      addMetadataGroup({
        id: DEFAULT_GROUP_ID,
        label: "Global Defaults",
        bidsParams: {},
        subjectRegExp: "",
        sessionRegExp: "",
        runRegExp: "",
      });
      setModalMode("defaults");
    }
  }, [addMetadataGroup, metadataGroups.length]);

  const groupLabelById = useMemo(
    () => new Map(metadataGroups.map((group) => [group.id, group.label])),
    [metadataGroups],
  );

  const defaultGroup =
    metadataGroups.find((group) => group.id === DEFAULT_GROUP_ID) ?? null;

  function handleBack() {
    setActiveStep(2);
  }

  function handleNext() {
    setActiveStep(4);
  }

  function toggleRowSelection(rowId: string, checked: boolean) {
    setSelectedRowIds((current) =>
      checked ? [...new Set([...current, rowId])] : current.filter((id) => id !== rowId),
    );
  }

  function handleModalSubmit(values: {
    label: string;
    bidsParams: BidsAslMetadata;
  }) {
    if (modalMode === "defaults" && defaultGroup) {
      updateMetadataGroup(defaultGroup.id, {
        label: values.label,
        bidsParams: values.bidsParams,
      });
    }

    if (modalMode === "override" && selectedRowIds.length > 0) {
      const selectedRows = subjectRows.filter((row) => selectedRowIds.includes(row.id));
      const groupId = `override-${metadataGroups.length}`;
      const overrideGroup: MetadataGroup = {
        id: groupId,
        label: values.label,
        bidsParams: values.bidsParams,
        subjectRegExp: buildExactMatchRegex(selectedRows.map((row) => row.subject)),
        sessionRegExp: buildExactMatchRegex(selectedRows.map((row) => row.session)),
        runRegExp: buildExactMatchRegex(selectedRows.map((row) => row.run)),
      };

      addMetadataGroup(overrideGroup);
      updateSubjectRowGroup(selectedRowIds, groupId);
      setSelectedRowIds([]);
    }

    setModalMode(null);
  }

  return (
    <Stack gap="md">
      <Title order={3}>Metadata Grouping</Title>
      <Text c="dimmed" size="sm">
        Assign subject, session, and run combinations to metadata groups that
        will become `studyPar.json` entries.
      </Text>

      <Card withBorder p="md">
        <Group justify="space-between" mb="md">
          <Text fw={500}>Discovered combinations</Text>
          <Group>
            <Button
              variant="light"
              onClick={() => setModalMode("defaults")}
            >
              Edit Defaults
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={selectedRowIds.length === 0}
              onClick={() => setModalMode("override")}
            >
              Apply Override Metadata
            </Button>
          </Group>
        </Group>

        {subjectRows.length === 0 ? (
          <Text c="dimmed" size="sm">
            Complete the tokenizer and alias steps to generate metadata rows.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th>Subject</Table.Th>
                <Table.Th>Session</Table.Th>
                <Table.Th>Run</Table.Th>
                <Table.Th>Metadata Group</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {subjectRows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Checkbox
                      checked={selectedRowIds.includes(row.id)}
                      onChange={(event) =>
                        toggleRowSelection(row.id, event.currentTarget.checked)
                      }
                      aria-label={`Select ${row.id}`}
                    />
                  </Table.Td>
                  <Table.Td>{row.subject}</Table.Td>
                  <Table.Td>{row.session}</Table.Td>
                  <Table.Td>{row.run}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">
                      {groupLabelById.get(row.groupId) ?? "Global Defaults"}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Group justify="space-between">
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          onClick={handleBack}
        >
          Back: Resolve Aliases
        </Button>
        <Button
          rightSection={<IconArrowRight size={16} />}
          onClick={handleNext}
        >
          Next: Run Import
        </Button>
      </Group>

      <MetadataModal
        opened={modalMode !== null && defaultGroup !== null}
        title={
          modalMode === "override"
            ? "Apply Override Metadata"
            : "Configure Default BIDS Metadata"
        }
        initialValues={{
          label:
            modalMode === "override"
              ? `Override ${metadataGroups.length}`
              : (defaultGroup?.label ?? "Global Defaults"),
          bidsParams:
            modalMode === "override" ? {} : (defaultGroup?.bidsParams ?? {}),
        }}
        onClose={() => setModalMode(null)}
        onSubmit={handleModalSubmit}
      />
    </Stack>
  );
}
