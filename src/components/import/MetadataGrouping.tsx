import { Badge, Button, Card, Checkbox, Group, Stack, Table, Text } from "@mantine/core";
import { IconArrowLeft, IconArrowRight, IconFileImport, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import HeaderCard from "../common/HeaderCard";

import { notifications } from "@mantine/notifications";

import { splitBySubDelimiters } from "../../lib/pathUtils";
import {
  type BidsAslMetadata,
  type MetadataGroup,
  type SubjectRow,
  type TokenAssignment,
  validateBidsMetadataGroup,
} from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { useImportStore } from "../../stores/importStore";
import MetadataModal from "./MetadataModal";

const DEFAULT_GROUP_ID = "global-defaults";

function pathMatchesPattern(
  segments: string[],
  pattern: ReturnType<typeof useImportStore.getState>["pathPatterns"][number],
): boolean {
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

    for (const fullPath of rawPaths) {
      if (!fullPath.startsWith(sourceDataPath)) {
        continue;
      }

      const relativePath = fullPath.slice(sourceDataPath.length).replace(/^\/+/, "");
      const segments = relativePath.split("/").filter(Boolean);
      if (!pathMatchesPattern(segments, pattern)) {
        continue;
      }

      const rawSubject = extractAssignmentValue(segments, subjectAssignment, tokenSubDelimiters);
      if (!rawSubject) {
        continue;
      }

      const subject = renameMap.get(rawSubject) ?? rawSubject;
      const session = sessionAssignment
        ? extractAssignmentValue(segments, sessionAssignment, tokenSubDelimiters) || "01"
        : "01";

      const id = `${subject}/${session}`;
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          subject,
          session,
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
  const removeMetadataGroup = useImportStore((state) => state.removeMetadataGroup);
  const updateMetadataGroup = useImportStore((state) => state.updateMetadataGroup);
  const updateSubjectRowGroup = useImportStore((state) => state.updateSubjectRowGroup);
  const tokenSubDelimiters = useGlobalStore((state) => state.settings.tokenSubDelimiters);
  const hasDerivationContext =
    sourceDataPath.length > 0 && rawPaths.length > 0 && pathPatterns.length > 0;

  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [modalMode, setModalMode] = useState<"edit" | "override" | null>(() =>
    metadataGroups.length === 0 ? "edit" : null,
  );
  const [editingGroupId, setEditingGroupId] = useState<string | null>(() =>
    metadataGroups.length === 0 ? DEFAULT_GROUP_ID : null,
  );

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
    [rawPaths, sourceDataPath, pathPatterns, tokenizerConfigs, subjectRenames, tokenSubDelimiters],
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
        (row, index) => row.id !== nextRows[index]?.id || row.groupId !== nextRows[index]?.groupId,
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
      });
    }
  }, [addMetadataGroup, metadataGroups.length]);

  const groupLabelById = useMemo(
    () => new Map(metadataGroups.map((group) => [group.id, group.label])),
    [metadataGroups],
  );

  const defaultGroup = metadataGroups.find((group) => group.id === DEFAULT_GROUP_ID) ?? null;

  function handleBack() {
    setActiveStep(2);
  }

  function handleNext() {
    for (const group of metadataGroups) {
      const errors = validateBidsMetadataGroup(group.bidsParams);
      if (errors.length > 0) {
        notifications.show({
          color: "red",
          title: `Validation Error in Group "${group.label}"`,
          message: errors.join(" "),
        });
        return;
      }
    }
    setActiveStep(4);
  }

  function toggleRowSelection(rowId: string, checked: boolean) {
    setSelectedRowIds((current) =>
      checked ? [...new Set([...current, rowId])] : current.filter((id) => id !== rowId),
    );
  }

  function handleEditGroup(group: MetadataGroup) {
    setEditingGroupId(group.id);
    setModalMode("edit");
  }

  function handleDeleteGroup(groupId: string) {
    removeMetadataGroup(groupId);
  }

  function handleModalSubmit(values: { label: string; bidsParams: BidsAslMetadata }) {
    if (modalMode === "edit" && editingGroupId) {
      updateMetadataGroup(editingGroupId, {
        label: values.label,
        bidsParams: values.bidsParams,
      });
    }

    if (modalMode === "override" && selectedRowIds.length > 0) {
      const groupId = `override-${Date.now()}`;
      const overrideGroup: MetadataGroup = {
        id: groupId,
        label: values.label,
        bidsParams: values.bidsParams,
      };

      addMetadataGroup(overrideGroup);
      updateSubjectRowGroup(selectedRowIds, groupId);
      setSelectedRowIds([]);
    }

    setModalMode(null);
    setEditingGroupId(null);
  }

  return (
    <Stack gap="md" data-testid="metadata-grouping">
      <HeaderCard
        icon={IconFileImport}
        title="Metadata Grouping"
        subtitle="Assign subject and session combinations to metadata groups that will become studyPar.json entries."
        color="blue"
        dataTestId="metadata-grouping-header"
      />

      <Card withBorder p="md" data-testid="metadata-groups-list">
        <Text fw={500} mb="md">
          Defined Metadata Groups
        </Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Group Label</Table.Th>
              <Table.Th>Scope / Target</Table.Th>
              <Table.Th style={{ width: 150 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {metadataGroups.map((group) => {
              const isDefault = group.id === DEFAULT_GROUP_ID;
              return (
                <Table.Tr key={group.id} data-testid={`metadata-group-row-${group.id}`}>
                  <Table.Td>
                    <Text size="sm" fw={isDefault ? 600 : 400}>
                      {group.label}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {(() => {
                      const groupRows = subjectRows.filter((row) => row.groupId === group.id);
                      const uniqueSubjects = new Set(groupRows.map((r) => r.subject)).size;
                      const uniqueSessions = new Set(groupRows.map((r) => r.session)).size;
                      if (uniqueSubjects === 0) {
                        return (
                          <Text size="xs" c="dimmed">
                            No subjects assigned
                          </Text>
                        );
                      }
                      return (
                        <Text size="xs">
                          Assigned to {uniqueSubjects} subject{uniqueSubjects !== 1 ? "s" : ""} (
                          {uniqueSessions} session{uniqueSessions !== 1 ? "s" : ""})
                        </Text>
                      );
                    })()}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => handleEditGroup(group)}
                        data-testid={`edit-group-btn-${group.id}`}
                      >
                        Edit
                      </Button>
                      {!isDefault && (
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          onClick={() => handleDeleteGroup(group.id)}
                          data-testid={`delete-group-btn-${group.id}`}
                        >
                          Delete
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder p="md">
        <Group justify="space-between" mb="md">
          <Text fw={500}>Discovered combinations</Text>
          <Group>
            <Button
              variant="light"
              onClick={() => {
                setEditingGroupId(DEFAULT_GROUP_ID);
                setModalMode("edit");
              }}
              data-testid="metadata-edit-defaults-btn"
            >
              Edit Defaults
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={selectedRowIds.length === 0}
              onClick={() => setModalMode("override")}
              data-testid="metadata-apply-override-btn"
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
          <Table striped highlightOnHover data-testid="metadata-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th>Subject</Table.Th>
                <Table.Th>Session</Table.Th>
                <Table.Th>Metadata Group</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {subjectRows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Checkbox
                      checked={selectedRowIds.includes(row.id)}
                      onChange={(event) => toggleRowSelection(row.id, event.currentTarget.checked)}
                      aria-label={`Select ${row.id}`}
                      data-testid={`metadata-row-checkbox-${row.id.replace(/[^a-z0-9]/gi, "-")}`}
                    />
                  </Table.Td>
                  <Table.Td>{row.subject}</Table.Td>
                  <Table.Td>{row.session}</Table.Td>
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

      <Group
        justify="space-between"
        pos="sticky"
        bottom={40}
        style={{
          zIndex: 2,
          paddingTop: "var(--mantine-spacing-md)",
          paddingBottom: "var(--mantine-spacing-md)",
          backgroundColor: "var(--mantine-color-body)",
          boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.06)",
        }}
        data-testid="metadata-nav"
      >
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          onClick={handleBack}
          data-testid="metadata-back-btn"
        >
          Back: Resolve Aliases
        </Button>
        <Button
          rightSection={<IconArrowRight size={16} />}
          onClick={handleNext}
          data-testid="metadata-next-btn"
        >
          Next: Preview Import
        </Button>
      </Group>

      <MetadataModal
        opened={modalMode !== null && defaultGroup !== null}
        title={
          modalMode === "override" ? "Apply Override Metadata" : "Configure Default BIDS Metadata"
        }
        initialValues={(() => {
          if (modalMode === "edit" && editingGroupId) {
            const group = metadataGroups.find((g) => g.id === editingGroupId);
            return {
              label: group?.label ?? "",
              bidsParams: group?.bidsParams ?? {},
            };
          }
          return {
            label: `Override ${metadataGroups.length}`,
            bidsParams: {},
          };
        })()}
        onClose={() => {
          setModalMode(null);
          setEditingGroupId(null);
        }}
        onSubmit={handleModalSubmit}
      />
    </Stack>
  );
}
