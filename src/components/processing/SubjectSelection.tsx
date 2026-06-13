import { useCallback, useMemo, useState } from "react";
import { Badge, Box, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import {
  IconCheck,
  IconMinus,
  IconBan,
  IconExclamationMark,
  IconLoader,
  IconSelector,
  IconSquareCheck,
  IconSquareX,
} from "@tabler/icons-react";

import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import { PROCESSING_MODULES } from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterValue = "all" | "pending" | "incomplete" | "complete";

interface SubjectRow extends SubjectInfo {
  /** selected in checkbox */
  _selected: boolean;
  /** per-module status */
  _structuralStatus: ModuleDisplayStatus;
  _aslStatus: ModuleDisplayStatus;
  _populationStatus: ModuleDisplayStatus;
  /** derived overall status for filtering */
  _overallStatus: FilterValue;
}

type ModuleDisplayStatus = "complete" | "incomplete" | "pending" | "skipped";

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
  processingPhase,
}: {
  status: ModuleDisplayStatus;
  processingPhase: string;
}) {
  switch (status) {
    case "complete":
      return (
        <Tooltip label="Complete">
          <IconCheck size={18} color="var(--mantine-color-teal-6)" data-testid="status-complete" />
        </Tooltip>
      );
    case "incomplete":
      if (processingPhase === "failed" || processingPhase === "cancelled") {
        return (
          <Tooltip label="Incomplete">
            <IconExclamationMark
              size={18}
              color="var(--mantine-color-red-6)"
              data-testid="status-incomplete-stalled"
            />
          </Tooltip>
        );
      }
      return (
        <Tooltip label="In progress">
          <IconLoader
            size={18}
            color="var(--mantine-color-orange-6)"
            data-testid="status-incomplete"
          />
        </Tooltip>
      );
    case "pending":
      return (
        <Tooltip label="Pending">
          <IconMinus size={18} color="var(--mantine-color-gray-5)" data-testid="status-pending" />
        </Tooltip>
      );
    case "skipped":
      return (
        <Tooltip label="No data">
          <IconBan size={18} color="var(--mantine-color-gray-4)" style={{ opacity: 0.5 }} data-testid="status-skipped" />
        </Tooltip>
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupModuleStatus(
  subjectSession: string,
  module: (typeof PROCESSING_MODULES)[number],
  statuses: SubjectModuleStatus[],
): SubjectModuleStatus | undefined {
  return statuses.find(
    (s) => s.subjectSession === subjectSession && s.module === module,
  );
}

function resolveModuleDisplay(
  subjectInfo: SubjectInfo,
  module: (typeof PROCESSING_MODULES)[number],
  statuses: SubjectModuleStatus[],
): ModuleDisplayStatus {
  if (module === "structural" && !subjectInfo.hasStructural) return "skipped";
  if (module === "asl" && !subjectInfo.hasASL) return "skipped";

  const entry = lookupModuleStatus(subjectInfo.subjectSession, module, statuses);
  if (!entry) return "pending";
  if (entry.status === "complete") return "complete";
  if (entry.status === "incomplete") return "incomplete";
  return "pending";
}

function deriveOverallStatus(
  structural: ModuleDisplayStatus,
  asl: ModuleDisplayStatus,
  population: ModuleDisplayStatus,
): FilterValue {
  const statuses = [structural, asl, population].filter((s) => s !== "skipped");
  if (statuses.length === 0) return "pending";
  if (statuses.every((s) => s === "complete")) return "complete";
  if (statuses.some((s) => s === "incomplete")) return "incomplete";
  return "pending";
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

const FILTER_OPTIONS = [
  { label: "All", value: "all" as const },
  { label: "Pending", value: "pending" as const },
  { label: "Incomplete", value: "incomplete" as const },
  { label: "Complete", value: "complete" as const },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(processingPhase: string): DataTableColumn<SubjectRow>[] {
  return [
    {
      accessor: "subject",
      title: "Subject",
      sortable: true,
      render: (row) => (
        <Text size="sm" ff="monospace">
          {row.subject}
        </Text>
      ),
    },
    {
      accessor: "session",
      title: "Session",
      sortable: true,
      render: (row) => (
        <Text size="sm" ff="monospace">
          {row.session}
        </Text>
      ),
    },
    {
      accessor: "_structuralStatus",
      title: "Structural",
      textAlign: "center",
      render: (row) => <StatusIcon status={row._structuralStatus} processingPhase={processingPhase} />,
    },
    {
      accessor: "_aslStatus",
      title: "ASL",
      textAlign: "center",
      render: (row) => <StatusIcon status={row._aslStatus} processingPhase={processingPhase} />,
    },
    {
      accessor: "_populationStatus",
      title: "Population",
      textAlign: "center",
      render: (row) => <StatusIcon status={row._populationStatus} processingPhase={processingPhase} />,
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SubjectSelection() {
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);
  const processingPhase = useProcessingStore((s) => s.processingPhase);

  const [filter, setFilter] = useState<FilterValue>("all");

  const selectedSet = useMemo(
    () => new Set(config?.subjects ?? []),
    [config?.subjects],
  );

  const rows: SubjectRow[] = useMemo(() => {
    return availableSubjects.map((info) => {
      const structural = resolveModuleDisplay(info, "structural", subjectStatuses);
      const asl = resolveModuleDisplay(info, "asl", subjectStatuses);
      const population = resolveModuleDisplay(info, "population", subjectStatuses);
      return {
        ...info,
        _selected: selectedSet.has(info.subjectSession),
        _structuralStatus: structural,
        _aslStatus: asl,
        _populationStatus: population,
        _overallStatus: deriveOverallStatus(structural, asl, population),
      };
    });
  }, [availableSubjects, subjectStatuses, selectedSet]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r._overallStatus === filter);
  }, [rows, filter]);

  const selectedRecords = useMemo(
    () => filteredRows.filter((r) => r._selected),
    [filteredRows],
  );

  const updateSubjects = useCallback(
    (next: string[]) => {
      if (!config) return;
      setConfig({ ...config, subjects: next });
    },
    [config, setConfig],
  );

  const handleSelectedRecordsChange = useCallback(
    (selected: SubjectRow[]) => {
      const selectedSessions = new Set(selected.map((r) => r.subjectSession));
      const next = rows
        .filter((r) => selectedSessions.has(r.subjectSession))
        .map((r) => r.subjectSession);
      updateSubjects(next);
    },
    [rows, updateSubjects],
  );

  const handleSelectAll = useCallback(() => {
    const allSessions = rows.map((r) => r.subjectSession);
    updateSubjects(allSessions);
  }, [rows, updateSubjects]);

  const handleDeselectAll = useCallback(() => {
    updateSubjects([]);
  }, [updateSubjects]);

  const columns = useMemo(() => buildColumns(processingPhase), [processingPhase]);

  const statusCounts = useMemo(() => {
    const counts = { all: rows.length, pending: 0, incomplete: 0, complete: 0 };
    for (const row of rows) {
      counts[row._overallStatus]++;
    }
    return counts;
  }, [rows]);

  return (
    <Stack gap="sm" data-testid="subject-selection">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          Select Subjects
        </Text>
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconSquareCheck size={14} />}
            onClick={handleSelectAll}
            data-testid="select-all-btn"
          >
            Select all
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconSquareX size={14} />}
            onClick={handleDeselectAll}
            data-testid="deselect-all-btn"
          >
            Deselect all
          </Button>
        </Group>
      </Group>

      <Group gap="xs" align="center">
        <IconSelector size={16} color="var(--mantine-color-dimmed)" />
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(val) => setFilter(val as FilterValue)}
          data={FILTER_OPTIONS.map((opt) => ({
            ...opt,
            label: (
              <Group gap={4}>
                <Text size="xs">{opt.label}</Text>
                <Badge size="xs" variant="light" circle>
                  {statusCounts[opt.value]}
                </Badge>
              </Group>
            ),
          }))}
          data-testid="subject-filter"
        />
      </Group>

      <Box
        h={300}
        style={{ flexShrink: 0, overflow: "hidden", isolation: "isolate" }}
        data-testid="subject-table-container"
      >
        <DataTable
          records={filteredRows}
          columns={columns}
          selectedRecords={selectedRecords}
          onSelectedRecordsChange={handleSelectedRecordsChange}
          idAccessor="subjectSession"
          striped
          highlightOnHover
          height={300}
          borderRadius="sm"
          withTableBorder
          data-testid="subject-table"
        />
      </Box>
    </Stack>
  );
}
