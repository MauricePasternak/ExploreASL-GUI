import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import {
  IconCheck,
  IconMinus,
  IconBan,
  IconAlertCircle,
  IconAlertTriangle,
  IconLoader,
  IconSelector,
} from "@tabler/icons-react";

import type { ImportProgress } from "../../schemas/importSchemas";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import type { LogFileInfo, LogContent } from "../../lib/logViewer";
import {
  fetchModuleLogs,
  fetchLogContent,
  importLogSubjectFromSession,
  importLogSubjectKey,
} from "../../lib/logViewer";
import LogViewerModal from "../processing/LogViewerModal";

type FilterValue = "all" | "pending" | "completed" | "failed" | "stale";

interface ImportSubjectTableProps {
  rows: ImportProgress[];
  selectedSubjects: string[];
  onSelectedSubjectsChange: (subjects: string[]) => void;
}

interface ImportRow extends ImportProgress {
  _selected: boolean;
  _filterStatus: FilterValue;
  _importLogInfo?: LogFileInfo[];
}

function StatusIcon({ status, stale }: { status: ImportProgress["status"]; stale?: boolean }) {
  const icon = (() => {
    switch (status) {
      case "completed":
        return (
          <IconCheck size={18} color="var(--mantine-color-teal-6)" data-testid="status-completed" />
        );
      case "running":
        return (
          <Tooltip label="Running">
            <IconLoader
              size={18}
              color="var(--mantine-color-orange-6)"
              className="animate-spin"
              data-testid="status-running"
            />
          </Tooltip>
        );
      case "pending":
        return (
          <Tooltip label="Pending">
            <IconMinus size={18} color="var(--mantine-color-gray-5)" data-testid="status-pending" />
          </Tooltip>
        );
      case "failed":
        return (
          <Tooltip label="Failed">
            <IconAlertCircle
              size={18}
              color="var(--mantine-color-red-6)"
              data-testid="status-failed"
            />
          </Tooltip>
        );
      case "cancelled":
        return (
          <Tooltip label="Cancelled">
            <IconBan
              size={18}
              color="var(--mantine-color-gray-4)"
              style={{ opacity: 0.5 }}
              data-testid="status-cancelled"
            />
          </Tooltip>
        );
    }
  })();

  if (!stale) {
    return status === "completed" ? (
      <Tooltip label="Import completed successfully.">{icon}</Tooltip>
    ) : (
      icon
    );
  }

  return (
    <Box
      style={{ position: "relative", display: "inline-flex" }}
      data-testid="status-stale-wrapper"
    >
      <Tooltip label="Configuration has changed since last import. Re-import recommended.">
        <Box style={{ position: "relative" }}>
          {icon}
          <IconAlertTriangle
            size={10}
            color="var(--mantine-color-amber-6)"
            style={{
              position: "absolute",
              top: -2,
              right: -4,
            }}
            data-testid="stale-overlay"
          />
        </Box>
      </Tooltip>
    </Box>
  );
}

function deriveFilterStatus(row: ImportProgress): FilterValue {
  if (row.stale) return "stale";
  if (row.status === "completed") return "completed";
  if (row.status === "failed" || row.status === "cancelled") return "failed";
  return "pending";
}

const FILTER_OPTIONS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Stale", value: "stale" },
];

export default function ImportSubjectTable({
  rows,
  selectedSubjects,
  onSelectedSubjectsChange,
}: ImportSubjectTableProps) {
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);
  const importPhase = useImportStore((s) => s.importPhase);

  const [logFiles, setLogFiles] = useState<Map<string, LogFileInfo[]>>(new Map());
  const [modalOpened, setModalOpened] = useState(false);
  const [modalSubjectSession, setModalSubjectSession] = useState("");
  const [modalContent, setModalContent] = useState<LogContent | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!projectRoot) return;
    fetchModuleLogs(projectRoot)
      .then((files) => {
        const map = new Map<string, LogFileInfo[]>();
        for (const f of files) {
          if (f.module !== "import") continue;
          const key = importLogSubjectFromSession(f.subjectSession);
          const existing = map.get(key) ?? [];
          existing.push(f);
          map.set(key, existing);
        }
        setLogFiles(map);
      })
      .catch((err) => {
        console.warn("[ImportSubjectTable] Failed to fetch import logs:", err);
        setLogFiles(new Map());
      });
  }, [projectRoot, importPhase]);

  const handleViewLog = useCallback(
    async (subject: string) => {
      if (!projectRoot) return;
      const logSubject = importLogSubjectKey(subject);
      setModalSubjectSession(logSubject);
      setModalOpened(true);
      setModalLoading(true);
      setModalError(null);
      try {
        const content = await fetchLogContent(projectRoot, logSubject, "import");
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

  const importLogInfo = useMemo(() => {
    const map = new Map<string, LogFileInfo[]>();
    for (const [key, files] of logFiles) {
      map.set(key, files);
    }
    return map;
  }, [logFiles]);

  const enrichRows: ImportRow[] = useMemo(() => {
    const sorted = [...rows].sort((a, b) =>
      a.subject.localeCompare(b.subject, undefined, { numeric: true }),
    );
    return sorted.map((row) => ({
      ...row,
      _selected: selectedSubjects.includes(row.subject),
      _filterStatus: deriveFilterStatus(row),
      _importLogInfo: importLogInfo.get(row.subject),
    }));
  }, [rows, selectedSubjects, importLogInfo]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return enrichRows;
    return enrichRows.filter((r) => r._filterStatus === filter);
  }, [enrichRows, filter]);

  const paginatedRows = useMemo(() => {
    const from = (page - 1) * recordsPerPage;
    return filteredRows.slice(from, from + recordsPerPage);
  }, [filteredRows, page, recordsPerPage]);

  const selectedRecords = useMemo(() => paginatedRows.filter((r) => r._selected), [paginatedRows]);

  const handleSelectedRecordsChange = useCallback(
    (selected: ImportRow[]) => {
      const pageSubjects = new Set(paginatedRows.map((r) => r.subject));
      const selectedOnPage = new Set(selected.map((r) => r.subject));
      const next = new Set(selectedSubjects.filter((subject) => !pageSubjects.has(subject)));
      for (const subject of selectedOnPage) {
        next.add(subject);
      }
      onSelectedSubjectsChange([...next]);
    },
    [paginatedRows, selectedSubjects, onSelectedSubjectsChange],
  );

  const columns: DataTableColumn<ImportRow>[] = useMemo(
    () => [
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
        accessor: "status",
        title: "Status",
        textAlign: "center" as const,
        render: (row) => <StatusIcon status={row.status} stale={row.stale} />,
      },
      {
        accessor: "currentStep",
        title: "Step",
        textAlign: "center" as const,
        render: (row) => row.currentStep ?? row.errorStep ?? "—",
      },
      {
        accessor: "_importLogInfo",
        title: "Import Logs/Errors",
        textAlign: "center" as const,
        render: (row) => {
          const files = row._importLogInfo;
          if (!files || files.length === 0) {
            return (
              <Text size="xs" c="dimmed" data-testid={`no-import-logs-${row.subject}`}>
                No Logs
              </Text>
            );
          }
          const hasError = row.status === "failed";
          return (
            <Badge
              size="sm"
              color={hasError ? "red" : "teal"}
              variant="outline"
              style={{ cursor: "pointer" }}
              onClick={() => handleViewLog(row.subject)}
              data-testid={
                hasError ? `view-import-errors-${row.subject}` : `view-import-logs-${row.subject}`
              }
            >
              {hasError ? "View Errors" : "View Logs"}
            </Badge>
          );
        },
      },
    ],
    [handleViewLog],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<FilterValue, number> = {
      all: enrichRows.length,
      pending: 0,
      completed: 0,
      failed: 0,
      stale: 0,
    };
    for (const row of enrichRows) {
      counts[row._filterStatus]++;
    }
    return counts;
  }, [enrichRows]);

  const modalRunErrorMap = useMemo(() => {
    const files = importLogInfo.get(importLogSubjectFromSession(modalSubjectSession));
    if (!files) return {};
    const subject = importLogSubjectFromSession(modalSubjectSession);
    const row = rows.find((r) => r.subject === subject);
    const subjectFailed = row?.status === "failed";
    const map: Record<string, boolean> = {};
    for (const f of files) {
      map[f.filename] = f.hasError || subjectFailed;
    }
    return map;
  }, [modalSubjectSession, importLogInfo, rows]);

  if (rows.length === 0) {
    return (
      <Box data-testid="import-progress-empty">
        <Text c="dimmed" size="sm">
          Progress will appear here when import preparation starts.
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap="sm" data-testid="import-subject-table">
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
          data-testid="import-filter"
        />
      </Group>

      <Box style={{ flexShrink: 0, isolation: "isolate" }} data-testid="import-table-container">
        <DataTable
          records={paginatedRows}
          columns={columns}
          selectedRecords={selectedRecords}
          onSelectedRecordsChange={handleSelectedRecordsChange}
          idAccessor="subject"
          minHeight={240}
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
          data-testid="import-table"
        />
      </Box>

      <LogViewerModal
        opened={modalOpened}
        onClose={handleCloseModal}
        logContent={modalContent}
        module="import"
        subjectSession={modalSubjectSession}
        loading={modalLoading}
        error={modalError}
        runErrorMap={modalRunErrorMap}
      />
    </Stack>
  );
}
