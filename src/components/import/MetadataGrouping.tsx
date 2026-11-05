import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  NativeSelect,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { IconArrowLeft, IconArrowRight, IconFileImport, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import HeaderCard from "../common/HeaderCard";

import { showErrorNotification } from "../../lib/errorNotifications";

import { getRelativePath, splitBySubDelimiters } from "../../lib/pathUtils";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";
import {
  type BidsAslMetadata,
  type MetadataGroup,
  type SubjectRow,
  type TokenAssignment,
  validateBidsMetadataGroup,
} from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { EMPTY_IMPORT_SETTINGS, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import type { PathPattern_Serialize as PathPattern } from "../../generated/bindings";
import MetadataModal from "./MetadataModal";
import ImportStepLayout from "./ImportStepLayout";
import { useImportTablePagination } from "./useImportTablePagination";

const DEFAULT_GROUP_ID = "global-defaults";

function pathMatchesPattern(segments: string[], pattern: PathPattern): boolean {
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
  pathPatterns: PathPattern[];
  tokenizerConfigs: Record<string, TokenAssignment[]>;
  subjectRenames: typeof EMPTY_IMPORT_SETTINGS.subjectRenames;
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
      const relativePath = getRelativePath(fullPath, sourceDataPath);
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

      // Keep source identity separate from mutable final subject labels.
      const id = `captured:${rawSubject}/${session}`;
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
  const rawPaths = useProjectStore(
    (s) => s.project?.mappingState.rawPaths ?? EMPTY_IMPORT_SETTINGS.rawPaths,
  );
  const sourceDataPath = useProjectStore((s) => s.project?.mappingState.sourceDataPath ?? "");
  const pathPatterns = useProjectStore(
    (s) => s.project?.mappingState.pathPatterns ?? EMPTY_IMPORT_SETTINGS.pathPatterns,
  );
  const tokenizerConfigs = useProjectStore(
    (s) => s.project?.mappingState.tokenizerConfigs ?? EMPTY_IMPORT_SETTINGS.tokenizerConfigs,
  );
  const subjectRenames = useProjectStore(
    (s) => s.project?.mappingState.subjectRenames ?? EMPTY_IMPORT_SETTINGS.subjectRenames,
  );
  const metadataGroups = useProjectStore(
    (s) => s.project?.mappingState.metadataGroups ?? EMPTY_IMPORT_SETTINGS.metadataGroups,
  );
  const subjectRows = useProjectStore(
    (s) => s.project?.mappingState.subjectRows ?? EMPTY_IMPORT_SETTINGS.subjectRows,
  );
  const setSubjectRows = useImportStore((state) => state.setSubjectRows);
  const assignmentError = useProjectStore((state) => state.draftErrors["import.subjectRows"]);
  const addMetadataGroup = useImportStore((state) => state.addMetadataGroup);
  const removeMetadataGroup = useImportStore((state) => state.removeMetadataGroup);
  const updateMetadataGroup = useImportStore((state) => state.updateMetadataGroup);
  const tokenSubDelimiters = useGlobalStore((state) => state.settings.tokenSubDelimiters);
  const hasDerivationContext =
    sourceDataPath.length > 0 && rawPaths.length > 0 && pathPatterns.length > 0;

  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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

    const existingRowMap = new Map(subjectRows.map((row) => [row.id, row]));
    const existingTargets = new Map(
      subjectRows.map((row) => [`${row.subject}/${row.session}`, row]),
    );
    const targetCounts = new Map<string, number>();
    for (const row of derivedRows) {
      const target = `${row.subject}/${row.session}`;
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    const ambiguous = derivedRows.some((row) => {
      const target = `${row.subject}/${row.session}`;
      return (
        !existingRowMap.has(row.id) &&
        existingTargets.has(target) &&
        (targetCounts.get(target) ?? 0) > 1
      );
    });
    useProjectStore
      .getState()
      .setDraftError(
        "import.subjectRows",
        ambiguous
          ? "Existing subject assignments are ambiguous. Restore a known-good mapping before renaming."
          : null,
      );
    if (ambiguous) return;
    const nextRows = derivedRows.map((row) => {
      const existing = existingRowMap.get(row.id);
      const prior =
        existing?.subject === row.subject
          ? existing
          : existingTargets.get(`${row.subject}/${row.session}`);
      return {
        ...row,
        id: prior?.id ?? row.id,
        groupId: prior?.groupId ?? DEFAULT_GROUP_ID,
      };
    });

    if (
      subjectRows.length !== nextRows.length ||
      subjectRows.some(
        (row, index) =>
          row.id !== nextRows[index]?.id ||
          row.subject !== nextRows[index]?.subject ||
          row.groupId !== nextRows[index]?.groupId,
      )
    ) {
      setSubjectRows(nextRows);
    }
  }, [derivedRows, hasDerivationContext, setSubjectRows, subjectRows]);

  useEffect(() => {
    const hasDefault = metadataGroups.some((g) => g.id === DEFAULT_GROUP_ID);
    if (!hasDefault) {
      addMetadataGroup({
        id: DEFAULT_GROUP_ID,
        label: "Global Defaults",
        bidsParams: {},
      });
    }
  }, [addMetadataGroup, metadataGroups]);

  const groupLabelById = useMemo(
    () => new Map(metadataGroups.map((group) => [group.id, group.label])),
    [metadataGroups],
  );
  const filteredRows = subjectRows.filter(
    (row) =>
      `${row.subject} ${row.session} ${groupLabelById.get(row.groupId) ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (groupFilter === "all" || row.groupId === groupFilter),
  );
  const { setPage, tableProps } = useImportTablePagination(filteredRows, "metadata");

  const defaultGroup = metadataGroups.find((group) => group.id === DEFAULT_GROUP_ID) ?? null;

  const modalInitialValues = useMemo(() => {
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
  }, [modalMode, editingGroupId, metadataGroups]);

  function handleBack() {
    setActiveStep(2);
  }

  function handleNext() {
    for (const group of metadataGroups) {
      if (!subjectRows.some((row) => row.groupId === group.id)) continue;
      const errors = validateBidsMetadataGroup(group.bidsParams);
      if (errors.length > 0) {
        showErrorNotification({
          id: `metadata-validation:${useProjectStore.getState().project?.projectMeta.id}:${group.id}`,
          title: `Validation Error in Group "${group.label}"`,
          message: "Assigned metadata needs correction before import.",
          details: errors.join(" "),
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

  async function handleModalSubmit(values: { label: string; bidsParams: BidsAslMetadata }) {
    const lease = captureProjectLease();
    if (modalMode === "edit" && editingGroupId) {
      await updateMetadataGroup(editingGroupId, {
        label: values.label,
        bidsParams: values.bidsParams as MetadataGroup["bidsParams"],
      });
    }

    if (modalMode === "override" && selectedRowIds.length > 0) {
      const groupId = `override-${Date.now()}`;
      const overrideGroup: MetadataGroup = {
        id: groupId,
        label: values.label,
        bidsParams: values.bidsParams as MetadataGroup["bidsParams"],
      };

      await addMetadataGroup(overrideGroup, selectedRowIds);
      if (!mounted.current || !isCurrentProjectLease(lease)) return;
      setSelectedRowIds([]);
    }

    if (!mounted.current || !isCurrentProjectLease(lease)) return;
    setModalMode(null);
    setEditingGroupId(null);
  }

  return (
    <ImportStepLayout
      testId="metadata-grouping"
      navigation={
        <Group justify="space-between" data-testid="metadata-nav">
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
      }
    >
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
        <Table.ScrollContainer minWidth={480} data-testid="metadata-groups-scroll">
          <Table highlightOnHover data-testid="metadata-groups-table">
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
                            {uniqueSessions} session{uniqueSessions !== 1 ? "s" : ""}) ·{" "}
                            {groupRows.length} subject/session entries
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
        </Table.ScrollContainer>
      </Card>

      <Card withBorder p="md" data-testid="metadata-assignments">
        {assignmentError && (
          <Text c="red" role="alert" data-testid="metadata-assignment-error">
            {assignmentError}
          </Text>
        )}
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
        <Group align="flex-end" mb="sm" data-testid="metadata-filter-tools">
          <TextInput
            label="Search subjects, visits or groups"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            style={{ flex: 1, minWidth: 180 }}
            data-testid="metadata-search"
          />
          <NativeSelect
            label="Filter by group"
            value={groupFilter}
            onChange={(event) => {
              setGroupFilter(event.currentTarget.value);
              setPage(1);
            }}
            data={[
              { value: "all", label: "All groups" },
              ...metadataGroups.map((group) => ({ value: group.id, label: group.label })),
            ]}
            data-testid="metadata-group-filter"
          />
        </Group>
        <Group gap="sm" mb="md" data-testid="metadata-selection-tools">
          <Button
            size="xs"
            variant="light"
            disabled={filteredRows.length === 0}
            onClick={() =>
              setSelectedRowIds((selected) => [
                ...new Set([...selected, ...filteredRows.map((row) => row.id)]),
              ])
            }
            data-testid="metadata-select-matching"
          >
            Select all {filteredRows.length} matching
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={() => setSelectedRowIds([])}
            data-testid="metadata-clear-selection"
          >
            Clear selection
          </Button>
          <Text size="xs" data-testid="metadata-selected-count">
            {selectedRowIds.length} selected across all pages and filters
          </Text>
        </Group>

        {subjectRows.length === 0 ? (
          <Text c="dimmed" size="sm">
            Complete the tokenizer and alias steps to generate metadata rows.
          </Text>
        ) : (
          <DataTable
            idAccessor="id"
            {...tableProps}
            styles={{ table: { minWidth: 480 } }}
            highlightOnHover
            columns={[
              {
                accessor: "selected",
                title: "Select",
                width: 65,
                render: (row) => (
                  <Checkbox
                    checked={selectedRowIds.includes(row.id)}
                    onChange={(event) => toggleRowSelection(row.id, event.currentTarget.checked)}
                    aria-label={`Select ${row.id}`}
                    data-testid={`metadata-row-checkbox-${row.id.replace(/[^a-z0-9]/gi, "-")}`}
                  />
                ),
              },
              { accessor: "subject", title: "Subject" },
              { accessor: "session", title: "Session (= Visit)" },
              {
                accessor: "groupId",
                title: "Metadata Group",
                render: (row) => (
                  <Badge variant="light" color="gray" className="dicom-import-group-tag">
                    {groupLabelById.get(row.groupId) ?? "Global Defaults"}
                  </Badge>
                ),
              },
            ]}
            data-testid="metadata-table"
          />
        )}
      </Card>

      <MetadataModal
        opened={modalMode !== null && defaultGroup !== null}
        title={
          modalMode === "override" ? "Apply Override Metadata" : "Configure Default BIDS Metadata"
        }
        initialValues={modalInitialValues}
        onClose={() => {
          setModalMode(null);
          setEditingGroupId(null);
        }}
        onSubmit={handleModalSubmit}
      />
    </ImportStepLayout>
  );
}
