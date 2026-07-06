import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import {
  IconBook,
  IconCheck,
  IconMinus,
  IconBan,
  IconExclamationMark,
  IconLoader,
  IconSelector,
  IconSquareCheck,
  IconSquareX,
  IconAlertCircle,
} from "@tabler/icons-react";

import type { SubjectInfo } from "../../schemas/processingSchemas";
import { useProcessingStore } from "../../stores/processingStore";
import { useProjectStore } from "../../stores/projectStore";
import type { LogFileInfo, LogContent } from "../../lib/logViewer";
import { fetchModuleLogs, fetchLogContent } from "../../lib/logViewer";
import LogViewerModal from "./LogViewerModal";
import { fetchSubjectReports } from "../../lib/reportViewer";
import ReportViewerModal from "./ReportViewerModal";
import type { ModuleDisplayStatus } from "./SubjectSelection.helpers";
import { resolveLogBadge, resolveModuleDisplay } from "./SubjectSelection.helpers";

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
        return (
          <Badge
            size="sm"
            color="blue"
            variant="outline"
            style={{ cursor: "pointer" }}
            onClick={() => onViewReport(row.subjectSession, "structural")}
            data-testid="view-structural-report"
          >
            View Report
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
  const config = useProcessingStore((s) => s.config);
  const setConfig = useProcessingStore((s) => s.setConfig);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);

  const [logFiles, setLogFiles] = useState<Map<string, LogFileInfo[]>>(new Map());
  const [modalOpened, setModalOpened] = useState(false);
  const [modalModule, setModalModule] = useState<"structural" | "asl">("structural");
  const [modalSubjectSession, setModalSubjectSession] = useState("");
  const [modalContent, setModalContent] = useState<LogContent | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [existingReports, setExistingReports] = useState<Set<string>>(new Set());
  const [reportModalOpened, setReportModalOpened] = useState(false);
  const [reportModalModule, setReportModalModule] = useState<"structural" | "asl">("structural");
  const [reportModalSubjectSession, setReportModalSubjectSession] = useState("");
  const [reportModalRuns, setReportModalRuns] = useState<string[]>([]);

  useEffect(() => {
    if (!projectRoot) return;
    fetchModuleLogs(projectRoot)
      .then((files) => {
        const map = new Map<string, LogFileInfo[]>();
        for (const f of files) {
          const key = `${f.subjectSession}:${f.module}`;
          const existing = map.get(key) ?? [];
          existing.push(f);
          map.set(key, existing);
        }
        setLogFiles(map);
      })
      .catch((err) => {
        console.warn("[SubjectSelection] Failed to fetch module logs:", err);
        setLogFiles(new Map());
      });
  }, [projectRoot, processingPhase]);

  useEffect(() => {
    if (!projectRoot) return;
    fetchSubjectReports(projectRoot)
      .then((reports) => {
        const set = new Set<string>();
        for (const r of reports) {
          set.add(`${r.subjectSession}:${r.module}`);
        }
        setExistingReports(set);
      })
      .catch((err) => {
        console.error("Failed to fetch reports list:", err);
        setExistingReports(new Set());
      });
  }, [projectRoot, processingPhase]);

  const structuralLogInfo = useMemo(() => {
    const map = new Map<string, LogFileInfo[]>();
    for (const [key, files] of logFiles) {
      if (key.endsWith(":structural")) {
        const ss = key.replace(/:structural$/, "");
        map.set(ss, files);
      }
    }
    return map;
  }, [logFiles]);

  const aslLogInfo = useMemo(() => {
    const map = new Map<string, LogFileInfo[]>();
    for (const [key, files] of logFiles) {
      if (key.endsWith(":asl")) {
        const ss = key.replace(/:asl$/, "");
        map.set(ss, files);
      }
    }
    return map;
  }, [logFiles]);

  const handleViewLog = useCallback(
    async (subjectSession: string, module: "structural" | "asl") => {
      console.log(
        `[SubjectSelection] Viewing logs for subjectSession: ${subjectSession}, module: ${module}`,
      );
      if (!projectRoot) return;
      setModalModule(module);
      setModalSubjectSession(subjectSession);
      setModalOpened(true);
      setModalLoading(true);
      setModalError(null);
      try {
        const content = await fetchLogContent(projectRoot, subjectSession, module);
        setModalContent(content);
      } catch {
        setModalError("Failed to load log content");
        setModalContent(null);
      } finally {
        setModalLoading(false);
      }
    },
    [projectRoot],
  );

  const handleCloseModal = useCallback(() => {
    setModalOpened(false);
    setModalContent(null);
    setModalLoading(false);
    setModalError(null);
  }, []);

  const handleCloseReportModal = useCallback(() => {
    setReportModalOpened(false);
    setReportModalSubjectSession("");
    setReportModalRuns([]);
  }, []);

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

  const rows: SubjectRow[] = useMemo(() => {
    const sorted = [...availableSubjects].sort((a, b) =>
      a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
    );
    return sorted.map((info) => {
      const structural = resolveModuleDisplay(info, "structural", subjectStatuses);
      const asl = resolveModuleDisplay(info, "asl", subjectStatuses);
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
  }, [availableSubjects, subjectStatuses, selectedSet, structuralLogInfo, aslLogInfo]);

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

  const handleViewReport = useCallback(
    (subjectSession: string, module: "structural" | "asl") => {
      console.log(
        `[SubjectSelection] Viewing reports for subjectSession: ${subjectSession}, module: ${module}`,
      );
      const row = rows.find((r) => r.subjectSession === subjectSession);
      const runs = row?.aslRuns || [];
      setReportModalSubjectSession(subjectSession);
      setReportModalModule(module);
      setReportModalRuns(runs);
      setReportModalOpened(true);
    },
    [rows],
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
    const row = rows.find((r) => r.subjectSession === modalSubjectSession);
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
  }, [modalModule, modalSubjectSession, structuralLogInfo, aslLogInfo, rows]);

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

      <Box style={{ flexShrink: 0, isolation: "isolate" }} data-testid="subject-table-container">
        <DataTable
          records={paginatedRows}
          columns={columns}
          selectedRecords={selectedRecords}
          onSelectedRecordsChange={handleSelectedRecordsChange}
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
          data-testid="subject-table"
        />
      </Box>
      <LogViewerModal
        opened={modalOpened}
        onClose={handleCloseModal}
        logContent={modalContent}
        module={modalModule}
        subjectSession={modalSubjectSession}
        loading={modalLoading}
        error={modalError}
        runErrorMap={modalRunErrorMap}
      />
      <ReportViewerModal
        opened={reportModalOpened}
        onClose={handleCloseReportModal}
        projectRoot={projectRoot}
        subjectSession={reportModalSubjectSession}
        module={reportModalModule}
        runs={reportModalRuns}
      />
    </Stack>
  );
}
