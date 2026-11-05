import { Box, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { segmentedControlTestIds } from "../common/segmentedControlTestIds";
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconExclamationMark,
  IconLoader,
  IconMinus,
} from "@tabler/icons-react";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LogFileInfo } from "../../lib/logViewer";
import type { SubjectInfo } from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import LogViewerModal from "./LogViewerModal";

import ReportViewerModal from "./ReportViewerModal";
import { useSubjectViewers } from "./useSubjectViewers";
import type { ModuleDisplayStatus } from "./SubjectSelection.helpers";
import { resolveLogBadge, resolveModuleDisplay } from "./SubjectSelection.helpers";
import { indexSubjectStatuses } from "./subjectStatusIndex";

type FilterValue = "all" | "pending" | "incomplete" | "complete";

const STATUS_LABELS: Record<ModuleDisplayStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  pending: "Pending",
  outdated: "Outdated",
  skipped: "No data",
};

interface SubjectRow extends SubjectInfo {
  /** selected in checkbox */
  _selected: boolean;
  /** per-module status */
  _structuralStatus: ModuleDisplayStatus;
  _aslStatus: ModuleDisplayStatus;
  /** derived overall status for filtering */
  _overallStatus: FilterValue;
  /** log file info for columns */
  _structuralLogInfo?: LogFileInfo[];
  _aslLogInfo?: LogFileInfo[];
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

export function StatusIcon({
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
      if (["preparing", "running", "finalizing", "cancelling"].includes(processingPhase)) {
        return (
          <Tooltip label="In progress">
            <IconLoader
              size={18}
              color="var(--mantine-color-orange-6)"
              data-testid="status-incomplete"
            />
          </Tooltip>
        );
      }
      return (
        <Tooltip label="Incomplete">
          <IconExclamationMark
            size={18}
            color="var(--mantine-color-red-6)"
            data-testid="status-incomplete-stalled"
          />
        </Tooltip>
      );
    case "pending":
      return (
        <Tooltip label="Pending">
          <IconMinus size={18} color="var(--mantine-color-gray-5)" data-testid="status-pending" />
        </Tooltip>
      );
    case "outdated":
      return (
        <Tooltip label="Outdated (upstream module completed more recently)">
          <IconAlertCircle
            size={18}
            color="var(--mantine-color-orange-6)"
            data-testid="status-outdated"
          />
        </Tooltip>
      );
    case "skipped":
      return (
        <Tooltip label="No data">
          <IconBan
            size={18}
            color="var(--mantine-color-gray-4)"
            style={{ opacity: 0.5 }}
            data-testid="status-skipped"
          />
        </Tooltip>
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(
  processingPhase: string,
  structuralLogInfo: Map<string, LogFileInfo[]>,
  aslLogInfo: Map<string, LogFileInfo[]>,
  existingReports: Set<string>,
  onViewLog: (subjectSession: string, module: "structural" | "asl") => void,
  onViewReport: (subjectSession: string, module: "structural" | "asl") => void,
): DataTableColumn<SubjectRow>[] {
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
    ...(
      [
        {
          module: "structural",
          label: "Structural",
          statusKey: "_structuralStatus",
          logs: structuralLogInfo,
        },
        { module: "asl", label: "ASL", statusKey: "_aslStatus", logs: aslLogInfo },
      ] as const
    ).flatMap<DataTableColumn<SubjectRow>>(({ module, label, statusKey, logs }) => [
      {
        accessor: statusKey,
        title: <>Status</>,
        textAlign: "center",
        render: (row) => (
          <Group
            gap={4}
            wrap="nowrap"
            className={`processing-status processing-status--${row[statusKey]}`}
            data-testid={`${module}-display-status`}
          >
            <StatusIcon status={row[statusKey]} processingPhase={processingPhase} />
            <Text size="xs" data-testid={`${module}-status-label`}>
              {STATUS_LABELS[row[statusKey]]}
            </Text>
          </Group>
        ),
      },
      {
        accessor: `_${module}LogInfo`,
        title: <>Logs / errors</>,
        textAlign: "center",
        render: (row) => {
          if (row[statusKey] === "skipped") return null;
          const badge = resolveLogBadge(row[statusKey], logs.get(row.subjectSession));
          if (badge === "no-logs") {
            return (
              <Text size="xs" c="dimmed" data-testid={`no-${module}-logs`}>
                No Logs
              </Text>
            );
          }
          const isError = badge === "errors";
          return (
            <Button
              size="compact-xs"
              color={isError ? "red" : "teal"}
              variant="subtle"
              onClick={() => onViewLog(row.subjectSession, module)}
              aria-label={`View ${label} ${isError ? "errors" : "logs"} for ${row.subjectSession}`}
              data-testid={`view-${module}-${isError ? "errors" : "logs"}`}
            >
              {isError ? "View Errors" : "View Logs"}
            </Button>
          );
        },
      },
      {
        accessor: `_${module}Report`,
        title: <>Report</>,
        textAlign: "center",
        render: (row) => {
          if (row[statusKey] === "skipped") return null;
          const hasReport =
            existingReports.has(`${row.subjectSession}:${module}`) ||
            (module === "asl" && existingReports.has(`${row.subjectSession}:m0`));
          if (!hasReport) {
            return (
              <Text size="xs" c="dimmed" data-testid={`no-${module}-report`}>
                No Report
              </Text>
            );
          }
          const isOutdated = row[statusKey] === "outdated";
          return (
            <Button
              size="compact-xs"
              color={isOutdated ? "orange" : "blue"}
              variant="subtle"
              onClick={() => onViewReport(row.subjectSession, module)}
              aria-label={`View ${isOutdated ? "outdated " : ""}${label} report for ${row.subjectSession}`}
              data-testid={`view-${module}-report`}
            >
              {isOutdated ? "View Outdated Report" : "View Report"}
            </Button>
          );
        },
      },
    ]),
  ];
}

// resolveModuleDisplay imported from helpers

function deriveOverallStatus(
  structural: ModuleDisplayStatus,
  asl: ModuleDisplayStatus,
): FilterValue {
  const statuses = [structural, asl].filter((s) => s !== "skipped");
  if (statuses.length === 0) return "pending";
  if (statuses.every((s) => s === "complete")) return "complete";
  if (statuses.some((s) => s === "incomplete")) return "incomplete";
  return "pending";
}

const FILTER_OPTIONS = [
  { label: "All", value: "all" as const },
  { label: "Pending", value: "pending" as const },
  { label: "Incomplete", value: "incomplete" as const },
  { label: "Complete", value: "complete" as const },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SubjectSelection() {
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const config = useProjectStore((s) => s.project?.uiState.processing?.config);
  const setConfig = useProcessingStore((s) => s.setConfig);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);

  const {
    structuralLogInfo,
    aslLogInfo,
    existingReports,
    handleViewLog,
    openReport,
    logModal,
    reportModal,
  } = useSubjectViewers(projectRoot);
  const { module: modalModule, subjectSession: modalSubjectSession } = logModal;

  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(10);
  const [prevFilter, setPrevFilter] = useState(filter);
  const [prevRecordsPerPage, setPrevRecordsPerPage] = useState(recordsPerPage);
  if (filter !== prevFilter || recordsPerPage !== prevRecordsPerPage) {
    setPrevFilter(filter);
    setPrevRecordsPerPage(recordsPerPage);
    setPage(1);
  }

  const selectedSet = useMemo(() => new Set(config?.subjects ?? []), [config?.subjects]);

  const statusIndex = useMemo(() => indexSubjectStatuses(subjectStatuses), [subjectStatuses]);

  // Sort only when the subject roster changes — independent of status churn.
  const sortedSubjects = useMemo(
    () =>
      [...availableSubjects].sort((a, b) =>
        a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
      ),
    [availableSubjects],
  );

  const rows: SubjectRow[] = useMemo(() => {
    return sortedSubjects.map((info) => {
      const structural = resolveModuleDisplay(info, "structural", statusIndex);
      const asl = resolveModuleDisplay(info, "asl", statusIndex);
      return {
        ...info,
        _selected: selectedSet.has(info.subjectSession),
        _structuralStatus: structural,
        _aslStatus: asl,
        _overallStatus: deriveOverallStatus(structural, asl),
        _structuralLogInfo: structuralLogInfo.get(info.subjectSession),
        _aslLogInfo: aslLogInfo.get(info.subjectSession),
      };
    });
  }, [sortedSubjects, statusIndex, selectedSet, structuralLogInfo, aslLogInfo]);

  // Ref-sync: latest rows without putting rows in callback deps.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r._overallStatus === filter);
  }, [rows, filter]);

  const paginatedRows = useMemo(() => {
    const from = (page - 1) * recordsPerPage;
    return filteredRows.slice(from, from + recordsPerPage);
  }, [filteredRows, page, recordsPerPage]);

  const selectedRecords = useMemo(() => rows.filter((r) => r._selected), [rows]);
  const subjectCount = new Set(availableSubjects.map((subject) => subject.subject)).size;

  const updateSubjects = useCallback(
    (next: string[] | ((subjects: string[]) => string[])) => {
      if (!config) return;
      void setConfig((current) => ({
        ...current!,
        subjects: typeof next === "function" ? next(current!.subjects) : next,
      })).catch(() => undefined);
    },
    [config, setConfig],
  );

  const handleSelectedRecordsChange = useCallback(
    (selected: SubjectRow[]) => {
      const selectedSessions = new Set(selected.map((r) => r.subjectSession));
      const changed = rowsRef.current.filter(
        (row) => row._selected !== selectedSessions.has(row.subjectSession),
      );
      updateSubjects((subjects) => {
        const next = new Set(subjects);
        for (const row of changed) {
          if (selectedSessions.has(row.subjectSession)) next.add(row.subjectSession);
          else next.delete(row.subjectSession);
        }
        return [...next];
      });
    },
    [updateSubjects],
  );

  const handleSelectAll = useCallback(() => {
    const allSessions = rowsRef.current.map((r) => r.subjectSession);
    updateSubjects(allSessions);
  }, [updateSubjects]);

  const handleDeselectAll = useCallback(() => {
    updateSubjects([]);
  }, [updateSubjects]);

  const handleViewReport = useCallback(
    (subjectSession: string, module: "structural" | "asl") => {
      const row = rowsRef.current.find((r) => r.subjectSession === subjectSession);
      openReport(subjectSession, module, row?.aslRuns || []);
    },
    [openReport],
  );

  const columns = useMemo(
    () =>
      buildColumns(
        processingPhase,
        structuralLogInfo,
        aslLogInfo,
        existingReports,
        handleViewLog,
        handleViewReport,
      ),
    [
      processingPhase,
      structuralLogInfo,
      aslLogInfo,
      existingReports,
      handleViewLog,
      handleViewReport,
    ],
  );

  const modalRunErrorMap = useMemo(() => {
    const files =
      modalModule === "structural"
        ? structuralLogInfo.get(modalSubjectSession)
        : aslLogInfo.get(modalSubjectSession);
    const row = rowsRef.current.find((r) => r.subjectSession === modalSubjectSession);
    const moduleIncomplete =
      modalModule === "structural"
        ? row?._structuralStatus === "incomplete"
        : row?._aslStatus === "incomplete";
    if (!files) return {};
    const map: Record<string, boolean> = {};
    for (const f of files) {
      map[f.filename] = f.hasError || !!moduleIncomplete;
    }
    return map;
  }, [modalModule, modalSubjectSession, structuralLogInfo, aslLogInfo]);

  const statusCounts = useMemo(() => {
    const counts = { all: rows.length, pending: 0, incomplete: 0, complete: 0 };
    for (const row of rows) {
      counts[row._overallStatus]++;
    }
    return counts;
  }, [rows]);

  return (
    <Stack gap="sm" className="processing-roster" data-testid="subject-selection">
      <Group justify="space-between" align="center">
        <Stack gap={4} data-testid="subject-selection-heading">
          <Text fw={600} size="sm" data-testid="subject-selection-title">
            Subject / session selection
          </Text>
          <Text size="xs" c="dimmed" aria-live="polite" data-testid="subject-selection-count">
            {selectedRecords.length} of {rows.length} sessions selected · {subjectCount} subject
            {subjectCount === 1 ? "" : "s"} available
          </Text>
        </Stack>
        <Group gap="xs">
          <Button size="xs" variant="subtle" onClick={handleSelectAll} data-testid="select-all-btn">
            Select all
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={handleDeselectAll}
            data-testid="deselect-all-btn"
          >
            Deselect all
          </Button>
        </Group>
      </Group>

      <Group
        gap="xs"
        align="center"
        wrap="nowrap"
        className="processing-filter-scroll"
        data-testid="subject-filter-scroll"
      >
        <SegmentedControl
          size="xs"
          fullWidth
          value={filter}
          onChange={(val) => setFilter(val as FilterValue)}
          data={FILTER_OPTIONS.map((opt) => ({
            ...opt,
            label: (
              <Stack gap={2} align="center" style={{ minWidth: 70, padding: "2px 0" }}>
                <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                  {opt.label}
                </Text>
                <Text size="xs" c="dimmed">
                  · {statusCounts[opt.value]}
                </Text>
              </Stack>
            ),
          }))}
          {...segmentedControlTestIds("subject-filter")}
        />
      </Group>

      <Box style={{ flexShrink: 0, isolation: "isolate" }} data-testid="subject-table-container">
        <DataTable
          records={paginatedRows}
          groups={[
            { id: "subject-session", title: "Subject / Session", columns: columns.slice(0, 2) },
            {
              id: "structural",
              title: "Structural",
              textAlign: "center",
              className: "processing-table-structural",
              columns: columns.slice(2, 5),
            },
            {
              id: "asl",
              title: "ASL",
              textAlign: "center",
              className: "processing-table-asl",
              columns: columns.slice(5),
            },
          ]}
          selectedRecords={selectedRecords}
          onSelectedRecordsChange={handleSelectedRecordsChange}
          allRecordsSelectionCheckboxProps={{
            attributes: { input: { "data-testid": "subject-table-select-all" } },
          }}
          getRecordSelectionCheckboxProps={(row) => ({
            attributes: { input: { "data-testid": `subject-table-select-${row.subjectSession}` } },
          })}
          idAccessor="subjectSession"
          striped
          highlightOnHover
          borderRadius="sm"
          withTableBorder
          page={page}
          onPageChange={setPage}
          totalRecords={filteredRows.length}
          recordsPerPage={recordsPerPage}
          recordsPerPageOptions={[10, 25, 50]}
          onRecordsPerPageChange={setRecordsPerPage}
          paginationSize="sm"
          getPaginationControlProps={(control) => ({
            "data-testid": `subject-table-page-${control}`,
            "aria-label": `${control[0].toUpperCase()}${control.slice(1)} page`,
          })}
          getPaginationItemProps={(page) => ({ "data-testid": `subject-table-page-${page}` })}
          data-testid="subject-table"
        />
      </Box>
      <Text size="xs" c="dimmed" data-testid="subject-selection-filter-note">
        Filters don't change your selection. Select all includes all {rows.length} sessions.
      </Text>
      <LogViewerModal {...logModal} runErrorMap={modalRunErrorMap} />
      <ReportViewerModal {...reportModal} />
    </Stack>
  );
}
