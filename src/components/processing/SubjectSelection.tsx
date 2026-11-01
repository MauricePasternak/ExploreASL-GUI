import { Badge, Box, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { segmentedControlTestIds } from "../common/segmentedControlTestIds";
import {
  IconAlertCircle,
  IconBan,
  IconBook,
  IconCheck,
  IconExclamationMark,
  IconLoader,
  IconMinus,
  IconSelector,
  IconSquareCheck,
  IconSquareX,
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
    {
      accessor: "_structuralStatus",
      title: (
        <>
          Structural
          <br />
          Status
        </>
      ),
      textAlign: "center",
      render: (row) => (
        <StatusIcon status={row._structuralStatus} processingPhase={processingPhase} />
      ),
    },
    {
      accessor: "_structuralLogInfo",
      title: (
        <>
          Structural
          <br />
          Logs/Errors
        </>
      ),
      textAlign: "center",
      render: (row) => {
        if (row._structuralStatus === "skipped") return null;
        const files = structuralLogInfo.get(row.subjectSession);
        const badge = resolveLogBadge(row._structuralStatus, files);
        if (badge === "no-logs") {
          return (
            <Text size="xs" c="dimmed" data-testid="no-structural-logs">
              No Logs
            </Text>
          );
        }
        const isError = badge === "errors";
        return (
          <Badge
            size="sm"
            color={isError ? "red" : "teal"}
            variant="outline"
            leftSection={<IconBook size={12} />}
            style={{ cursor: "pointer" }}
            onClick={() => onViewLog(row.subjectSession, "structural")}
            data-testid={isError ? "view-structural-errors" : "view-structural-logs"}
          >
            {isError ? "View Errors" : "View Logs"}
          </Badge>
        );
      },
    },
    {
      accessor: "_structuralReport",
      title: (
        <>
          Structural
          <br />
          Report
        </>
      ),
      textAlign: "center",
      render: (row) => {
        if (row._structuralStatus === "skipped") return null;
        const hasReport = existingReports.has(`${row.subjectSession}:structural`);
        if (!hasReport) {
          return (
            <Text size="xs" c="dimmed" data-testid="no-structural-report">
              No Report
            </Text>
          );
        }
        const isOutdated = row._structuralStatus === "outdated";
        return (
          <Badge
            size="sm"
            color={isOutdated ? "orange" : "blue"}
            variant="outline"
            style={{ cursor: "pointer" }}
            onClick={() => onViewReport(row.subjectSession, "structural")}
            data-testid="view-structural-report"
          >
            {isOutdated ? "View Outdated Report" : "View Report"}
          </Badge>
        );
      },
    },
    {
      accessor: "_aslStatus",
      title: (
        <>
          ASL
          <br />
          Status
        </>
      ),
      textAlign: "center",
      render: (row) => <StatusIcon status={row._aslStatus} processingPhase={processingPhase} />,
    },
    {
      accessor: "_aslLogInfo",
      title: (
        <>
          ASL
          <br />
          Logs/Errors
        </>
      ),
      textAlign: "center",
      render: (row) => {
        if (row._aslStatus === "skipped") return null;
        const files = aslLogInfo.get(row.subjectSession);
        const badge = resolveLogBadge(row._aslStatus, files);
        if (badge === "no-logs") {
          return (
            <Text size="xs" c="dimmed" data-testid="no-asl-logs">
              No Logs
            </Text>
          );
        }
        const isError = badge === "errors";
        return (
          <Badge
            size="sm"
            color={isError ? "red" : "teal"}
            variant="outline"
            leftSection={<IconBook size={12} />}
            style={{ cursor: "pointer" }}
            onClick={() => onViewLog(row.subjectSession, "asl")}
            data-testid={isError ? "view-asl-errors" : "view-asl-logs"}
          >
            {isError ? "View Errors" : "View Logs"}
          </Badge>
        );
      },
    },
    {
      accessor: "_aslReport",
      title: (
        <>
          ASL
          <br />
          Report
        </>
      ),
      textAlign: "center",
      render: (row) => {
        if (row._aslStatus === "skipped") return null;
        const hasReport =
          existingReports.has(`${row.subjectSession}:asl`) ||
          existingReports.has(`${row.subjectSession}:m0`);
        if (!hasReport) {
          return (
            <Text size="xs" c="dimmed" data-testid="no-asl-report">
              No Report
            </Text>
          );
        }
        const isOutdated = row._aslStatus === "outdated";
        return (
          <Badge
            size="sm"
            color={isOutdated ? "orange" : "blue"}
            variant="outline"
            style={{ cursor: "pointer" }}
            onClick={() => onViewReport(row.subjectSession, "asl")}
            data-testid="view-asl-report"
          >
            {isOutdated ? "View Outdated Report" : "View Report"}
          </Badge>
        );
      },
    },
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

  const selectedRecords = useMemo(() => paginatedRows.filter((r) => r._selected), [paginatedRows]);

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
    <Stack gap="sm" data-testid="subject-selection">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          Select Subject/Session Entries
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
              <Stack gap={2} align="center" style={{ minWidth: 70, padding: "2px 0" }}>
                <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                  {opt.label}
                </Text>
                <Badge size="xs" variant="light">
                  {statusCounts[opt.value]}
                </Badge>
              </Stack>
            ),
          }))}
          {...segmentedControlTestIds("subject-filter")}
        />
      </Group>

      <Box style={{ flexShrink: 0, isolation: "isolate" }} data-testid="subject-table-container">
        <DataTable
          records={paginatedRows}
          columns={columns}
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
      <LogViewerModal {...logModal} runErrorMap={modalRunErrorMap} />
      <ReportViewerModal {...reportModal} />
    </Stack>
  );
}
