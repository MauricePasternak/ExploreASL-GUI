import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import { IconSquareCheck, IconBook } from "@tabler/icons-react";

import { useManifestStore } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { FAIL_REASON_LABELS } from "../../schemas/manifestSchemas";
import type { ManifestVerdict, ManifestFailReason } from "../../schemas/project";

import type { LogFileInfo, LogContent } from "../../lib/logViewer";
import { fetchModuleLogs, fetchLogContent } from "../../lib/logViewer";
import LogViewerModal from "../processing/LogViewerModal";
import { fetchSubjectReports } from "../../lib/reportViewer";
import ReportViewerModal from "../processing/ReportViewerModal";
import type { ModuleDisplayStatus } from "../processing/SubjectSelection.helpers";
import { resolveLogBadge, resolveModuleDisplay } from "../processing/SubjectSelection.helpers";
import { StatusIcon } from "../processing/SubjectSelection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DisplayVerdict = "neutral" | "pass" | "fail" | "no-info";
type FilterValue = "all" | "neutral" | "pass" | "fail" | "no-info";

interface QcRow {
  subjectSession: string;
  subject: string;
  session: string;
  groupLabel: string;
  structuralStatus: ModuleDisplayStatus;
  aslStatus: ModuleDisplayStatus;
  noInfo: boolean;
  displayedVerdict: DisplayVerdict;
  storedVerdict?: ManifestVerdict;
  reason?: ManifestFailReason;
  notes?: string;
  aslRuns: string[];
}

interface QcSelectionTableProps {
  noInfoSubjects?: Set<string>;
  onNextReady?: (ready: boolean) => void;
}

const FILTER_OPTIONS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Neutral", value: "neutral" },
  { label: "Pass", value: "pass" },
  { label: "Fail", value: "fail" },
  { label: "No Info", value: "no-info" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QcSelectionTable({
  noInfoSubjects: propNoInfoSubjects = new Set(),
  onNextReady,
}: QcSelectionTableProps) {
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const mappingState = useProjectStore((s) => s.project?.mappingState);
  const rawVerdicts = useProjectStore((s) => s.project?.uiState?.manifest?.verdicts);
  const verdicts = useMemo(() => rawVerdicts ?? {}, [rawVerdicts]);
  const staleVerdicts = useManifestStore((s) => s.staleVerdicts);
  const qcData = useManifestStore((s) => s.qcData);
  const qcLoaded = useManifestStore((s) => s.qcLoaded);
  const lastPopulationRunMtime =
    useProjectStore((s) => s.project?.uiState?.manifest?.lastPopulationRunMtime) ?? undefined;
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
        console.warn("[QcSelectionTable] Failed to fetch module logs:", err);
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

  const noInfoSubjects = useMemo(() => {
    const set = new Set<string>(propNoInfoSubjects);
    if (qcLoaded && qcData) {
      for (const info of availableSubjects) {
        if (!(info.subjectSession in qcData)) {
          set.add(info.subjectSession);
        }
      }
    }
    return set;
  }, [propNoInfoSubjects, availableSubjects, qcData, qcLoaded]);

  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [pendingFails, setPendingFails] = useState<Map<string, string | undefined>>(new Map());

  const groupMap = useMemo(() => {
    const groups: MetadataGroup[] = (mappingState as Record<string, unknown> | null)?.metadataGroups
      ? ((mappingState as Record<string, unknown>).metadataGroups as MetadataGroup[])
      : [];
    const map = new Map<string, MetadataGroup>();
    for (const group of groups) {
      map.set(group.id, group);
    }
    return map;
  }, [mappingState]);

  const rowGroupMap = useMemo(() => {
    const rows: SubjectRow[] = (mappingState as Record<string, unknown> | null)?.subjectRows
      ? ((mappingState as Record<string, unknown>).subjectRows as SubjectRow[])
      : [];
    const map = new Map<string, string>();
    for (const row of rows) {
      const cleanSub = row.subject.replace(/^sub-/, "");
      map.set(`${cleanSub}_${row.session}`, row.groupId);
    }
    return map;
  }, [mappingState]);

  const handleVerdictChange = useCallback(
    (subjectSession: string, value: string) => {
      if (value === "pass") {
        setPendingFails((prev) => {
          const next = new Map(prev);
          next.delete(subjectSession);
          return next;
        });
        useProjectStore.getState().setManifestVerdict(subjectSession, "pass", {
          setAt: lastPopulationRunMtime,
        });
      } else if (value === "fail") {
        setPendingFails((prev) => {
          const next = new Map(prev);
          next.set(subjectSession, undefined);
          return next;
        });
      } else if (value === "neutral") {
        setPendingFails((prev) => {
          const next = new Map(prev);
          next.delete(subjectSession);
          return next;
        });
        useProjectStore.getState().removeManifestVerdict(subjectSession);
      }
    },
    [lastPopulationRunMtime],
  );

  const handleReasonChange = useCallback(
    (subjectSession: string, reason: string | null) => {
      if (!reason) return;
      setPendingFails((prev) => {
        const next = new Map(prev);
        next.set(subjectSession, reason);
        return next;
      });
      useProjectStore.getState().setManifestVerdict(subjectSession, "fail", {
        reason: reason as ManifestFailReason,
        setAt: lastPopulationRunMtime,
      });
    },
    [lastPopulationRunMtime],
  );

  const handleNotesBlur = useCallback(
    (subjectSession: string, notes: string) => {
      const current = verdicts[subjectSession];
      if (!current) return;
      useProjectStore.getState().setManifestVerdict(subjectSession, current.status, {
        reason: current.reason,
        notes: notes || undefined,
        setAt: current.setAt,
      });
    },
    [verdicts],
  );

  const rows: QcRow[] = useMemo(() => {
    const sorted = [...availableSubjects].sort((a, b) =>
      a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
    );
    return sorted.map((info) => {
      const structuralStatus = resolveModuleDisplay(info, "structural", subjectStatuses);
      const aslStatus = resolveModuleDisplay(info, "asl", subjectStatuses);
      const cleanSs = info.subjectSession.replace(/^sub-/, "");
      const groupId = rowGroupMap.get(cleanSs);
      const groupLabel = groupId ? (groupMap.get(groupId)?.label ?? "Ungrouped") : "Ungrouped";
      const verdict = verdicts[info.subjectSession];
      const noInfo = noInfoSubjects.has(info.subjectSession);

      let displayedVerdict: DisplayVerdict = "neutral";
      if (noInfo) {
        displayedVerdict = "no-info";
      } else if (verdict) {
        displayedVerdict = verdict.status;
      }

      return {
        subjectSession: info.subjectSession,
        subject: info.subject,
        session: info.session,
        groupLabel,
        structuralStatus,
        aslStatus,
        noInfo,
        displayedVerdict,
        storedVerdict: verdict,
        reason: verdict?.reason,
        notes: verdict?.notes,
        aslRuns: info.aslRuns || [],
      };
    });
  }, [availableSubjects, subjectStatuses, rowGroupMap, groupMap, verdicts, noInfoSubjects]);

  const handleViewLog = useCallback(
    async (subjectSession: string, module: "structural" | "asl") => {
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

  const handleViewReport = useCallback(
    (subjectSession: string, module: "structural" | "asl") => {
      const row = rows.find((r) => r.subjectSession === subjectSession);
      const runs = row?.aslRuns || [];
      setReportModalSubjectSession(subjectSession);
      setReportModalModule(module);
      setReportModalRuns(runs);
      setReportModalOpened(true);
    },
    [rows],
  );

  const modalRunErrorMap = useMemo(() => {
    const files =
      modalModule === "structural"
        ? structuralLogInfo.get(modalSubjectSession)
        : aslLogInfo.get(modalSubjectSession);
    const row = rows.find((r) => r.subjectSession === modalSubjectSession);
    const moduleIncomplete =
      modalModule === "structural"
        ? row?.structuralStatus === "incomplete"
        : row?.aslStatus === "incomplete";
    if (!files) return {};
    const map: Record<string, boolean> = {};
    for (const f of files) {
      map[f.filename] = f.hasError || !!moduleIncomplete;
    }
    return map;
  }, [modalModule, modalSubjectSession, structuralLogInfo, aslLogInfo, rows]);

  const filterCounts = useMemo(() => {
    const counts: Record<FilterValue, number> = {
      all: rows.length,
      neutral: 0,
      pass: 0,
      fail: 0,
      "no-info": 0,
    };
    for (const row of rows) {
      if (pendingFails.has(row.subjectSession)) {
        counts.fail++;
      } else {
        counts[row.displayedVerdict]++;
      }
    }
    return counts;
  }, [rows, pendingFails]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => {
      if (pendingFails.has(row.subjectSession)) return filter === "fail";
      return row.displayedVerdict === filter;
    });
  }, [rows, filter, pendingFails]);

  const paginatedRows = useMemo(() => {
    const from = (page - 1) * 10;
    return filteredRows.slice(from, from + 10);
  }, [filteredRows, page]);

  const columns: DataTableColumn<QcRow>[] = useMemo(
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
        accessor: "groupLabel",
        title: "Metadata Group",
        sortable: true,
      },
      {
        accessor: "structuralStatus",
        title: (
          <>
            Structural
            <br />
            Status
          </>
        ),
        textAlign: "center",
        render: (row) => (
          <StatusIcon status={row.structuralStatus} processingPhase={processingPhase} />
        ),
      },
      {
        accessor: "structuralLogs",
        title: (
          <>
            Structural
            <br />
            Logs/Errors
          </>
        ),
        textAlign: "center",
        render: (row) => {
          if (row.structuralStatus === "skipped") return null;
          const files = structuralLogInfo.get(row.subjectSession);
          const badge = resolveLogBadge(row.structuralStatus, files);
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
              style={isError ? undefined : { cursor: "pointer" }}
              onClick={isError ? undefined : () => handleViewLog(row.subjectSession, "structural")}
              data-testid={isError ? "view-structural-errors" : "view-structural-logs"}
            >
              {isError ? "View Errors" : "View Logs"}
            </Badge>
          );
        },
      },
      {
        accessor: "structuralReport",
        title: (
          <>
            Structural
            <br />
            Report
          </>
        ),
        textAlign: "center",
        render: (row) => {
          if (row.structuralStatus === "skipped") return null;
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
              onClick={() => handleViewReport(row.subjectSession, "structural")}
              data-testid="view-structural-report"
            >
              View Report
            </Badge>
          );
        },
      },
      {
        accessor: "aslStatus",
        title: (
          <>
            ASL
            <br />
            Status
          </>
        ),
        textAlign: "center",
        render: (row) => <StatusIcon status={row.aslStatus} processingPhase={processingPhase} />,
      },
      {
        accessor: "aslLogs",
        title: (
          <>
            ASL
            <br />
            Logs/Errors
          </>
        ),
        textAlign: "center",
        render: (row) => {
          if (row.aslStatus === "skipped") return null;
          const files = aslLogInfo.get(row.subjectSession);
          const badge = resolveLogBadge(row.aslStatus, files);
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
              style={isError ? undefined : { cursor: "pointer" }}
              onClick={isError ? undefined : () => handleViewLog(row.subjectSession, "asl")}
              data-testid={isError ? "view-asl-errors" : "view-asl-logs"}
            >
              {isError ? "View Errors" : "View Logs"}
            </Badge>
          );
        },
      },
      {
        accessor: "aslReport",
        title: (
          <>
            ASL
            <br />
            Report
          </>
        ),
        textAlign: "center",
        render: (row) => {
          if (row.aslStatus === "skipped") return null;
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
          const isOutdated = row.aslStatus === "outdated";
          return (
            <Badge
              size="sm"
              color={isOutdated ? "orange" : "blue"}
              variant="outline"
              style={{ cursor: "pointer" }}
              onClick={() => handleViewReport(row.subjectSession, "asl")}
              data-testid="view-asl-report"
            >
              {isOutdated ? "View Outdated Report" : "View Report"}
            </Badge>
          );
        },
      },
      {
        accessor: "verdict",
        title: "Verdict",
        render: (row) => {
          if (row.noInfo) {
            return (
              <Badge color="gray" data-testid={`no-info-badge-${row.subjectSession}`}>
                No Info
              </Badge>
            );
          }

          const isPendingFail = pendingFails.has(row.subjectSession);
          const reasonValue = pendingFails.get(row.subjectSession);
          const effectiveVerdict = isPendingFail ? "fail" : row.displayedVerdict;
          const segValue = effectiveVerdict === "no-info" ? "neutral" : effectiveVerdict;

          return (
            <Group gap="xs" wrap="nowrap">
              <SegmentedControl
                size="xs"
                data={[
                  { value: "neutral", label: "Neutral" },
                  { value: "pass", label: "Pass" },
                  { value: "fail", label: "Fail" },
                ]}
                value={segValue}
                disabled={row.noInfo}
                onChange={(v) => handleVerdictChange(row.subjectSession, v)}
                data-testid={`verdict-control-${row.subjectSession}`}
              />
              {isPendingFail && (
                <Select
                  size="xs"
                  data={Object.entries(FAIL_REASON_LABELS).map(([v, l]) => ({
                    value: v,
                    label: l,
                  }))}
                  value={reasonValue ?? null}
                  onChange={(v) => handleReasonChange(row.subjectSession, v)}
                  placeholder="Reason"
                  error={!reasonValue ? "Reason required" : undefined}
                  data-testid={`verdict-reason-${row.subjectSession}`}
                />
              )}
              {effectiveVerdict !== "neutral" && !isPendingFail && (
                <TextInput
                  size="xs"
                  placeholder="Notes (optional)"
                  defaultValue={row.notes ?? ""}
                  onBlur={(e) => handleNotesBlur(row.subjectSession, e.currentTarget.value)}
                  maxLength={500}
                  data-testid={`verdict-notes-${row.subjectSession}`}
                />
              )}
              {staleVerdicts.has(row.subjectSession) && (
                <Badge size="xs" color="orange" data-testid={`stale-badge-${row.subjectSession}`}>
                  Stale
                </Badge>
              )}
            </Group>
          );
        },
      },
    ],
    [
      pendingFails,
      handleVerdictChange,
      handleReasonChange,
      handleNotesBlur,
      staleVerdicts,
      processingPhase,
      structuralLogInfo,
      aslLogInfo,
      existingReports,
      handleViewLog,
      handleViewReport,
    ],
  );

  const handleBulkMarkPass = useCallback(() => {
    for (const row of rows) {
      if (row.structuralStatus === "complete" && row.aslStatus === "complete" && !row.noInfo) {
        useProjectStore.getState().setManifestVerdict(row.subjectSession, "pass", {
          setAt: lastPopulationRunMtime,
        });
      }
    }
  }, [rows, lastPopulationRunMtime]);

  const hasNeutral = useMemo(() => {
    const visible = filter === "all" ? rows : filteredRows;
    return visible.some((row) => {
      if (row.noInfo) return false;
      if (pendingFails.has(row.subjectSession)) return false;
      return row.displayedVerdict === "neutral";
    });
  }, [rows, filteredRows, filter, pendingFails]);

  const hasPendingFails = useMemo(() => {
    const visible = filter === "all" ? rows : filteredRows;
    return visible.some(
      (row) => pendingFails.has(row.subjectSession) && !pendingFails.get(row.subjectSession),
    );
  }, [rows, filteredRows, filter, pendingFails]);

  const nextReady = !hasNeutral && !hasPendingFails;

  useEffect(() => {
    onNextReady?.(nextReady);
  }, [nextReady, onNextReady]);

  return (
    <Stack gap="sm" data-testid="qc-selection-table">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          QC Verdicts
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconSquareCheck size={14} />}
          onClick={handleBulkMarkPass}
          data-testid="bulk-mark-pass"
        >
          Mark all complete→Pass
        </Button>
      </Group>

      <Group gap="xs" align="center">
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(val) => {
            setFilter(val as FilterValue);
            setPage(1);
          }}
          data={FILTER_OPTIONS.map((opt) => ({
            ...opt,
            label: (
              <Group gap={4}>
                <Text size="xs">{opt.label}</Text>
                <Badge
                  size="xs"
                  variant="light"
                  circle
                  data-testid={`qc-filter-count-${opt.value}`}
                >
                  {filterCounts[opt.value]}
                </Badge>
              </Group>
            ),
          }))}
          data-testid="qc-filter"
        />
      </Group>

      <Box style={{ flexShrink: 0, isolation: "isolate" }}>
        <DataTable
          records={paginatedRows}
          columns={columns}
          idAccessor="subjectSession"
          striped
          highlightOnHover
          borderRadius="sm"
          withTableBorder
          page={page}
          onPageChange={setPage}
          totalRecords={filteredRows.length}
          recordsPerPage={10}
          paginationSize="sm"
          minHeight={240}
          data-testid="qc-verdict-table"
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
