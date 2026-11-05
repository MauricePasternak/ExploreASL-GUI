import { comboboxTestIds } from "../common/comboboxTestIds";
import { segmentedControlTestIds } from "../common/segmentedControlTestIds";
import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  NativeSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";

import { FAIL_REASON_LABELS } from "../../schemas/manifestSchemas";
import type { ManifestFailReason, ManifestVerdict, Reviewer } from "../../schemas/project";
import { fetchLogContent, type LogContent } from "../../lib/logViewer";
import { useManifestStore, type ManifestDisagreement } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import LogViewerModal from "../processing/LogViewerModal";
import ReportViewerModal from "../processing/ReportViewerModal";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";
import QcMetricsPopover from "./QcMetricsPopover";
import "./Manifest.css";

interface ResolutionRow extends ManifestDisagreement {
  subject: string;
  session: string;
  resolution?: ManifestVerdict;
}

type PendingFail = { reason?: ManifestFailReason; notes?: string };

export interface ResolutionDrafts {
  pendingFails: Record<string, PendingFail>;
  notes: Record<string, string>;
}

interface VerdictResolutionProps {
  disagreements: ManifestDisagreement[];
  draftState: [ResolutionDrafts, Dispatch<SetStateAction<ResolutionDrafts>>];
}

const EMPTY_RUN_ERROR_MAP: Record<string, boolean> = {};
const EMPTY_REVIEWERS: Reviewer[] = [];

function parseSubjectSession(subjectSession: string) {
  const [subject, session = "01"] = subjectSession.split("_");
  return { subject, session };
}

function isManifestFailReason(value: string): value is ManifestFailReason {
  return value in FAIL_REASON_LABELS;
}

export default function VerdictResolution({ disagreements, draftState }: VerdictResolutionProps) {
  const qcData = useManifestStore((state) => state.qcData);
  const projectRoot = useProjectStore((state) => state.project?.projectMeta.rootPath);
  const reviewers = useProjectStore(
    (state) => state.project?.uiState.manifest?.reviewers ?? EMPTY_REVIEWERS,
  );
  const resolvedVerdicts = useProjectStore(
    (state) => state.project?.uiState.manifest?.resolvedVerdicts,
  );
  const setResolvedVerdict = useProjectStore((state) => state.setResolvedVerdict);

  const [drafts, setDrafts] = draftState;
  const pendingFails = drafts.pendingFails;
  const setPendingFails = useCallback(
    (update: SetStateAction<Record<string, PendingFail>>) => {
      setDrafts((previous) => ({
        ...previous,
        pendingFails: typeof update === "function" ? update(previous.pendingFails) : update,
      }));
    },
    [setDrafts],
  );
  const updateNotesDraft = useCallback(
    // A supplied third argument is an ACK, including an explicitly submitted undefined.
    (
      subjectSession: string,
      notes: string | undefined,
      ...acknowledgement: [] | [submittedNotes: string | undefined]
    ) => {
      setDrafts((previous) => {
        if (notes === undefined && !(subjectSession in previous.notes)) return previous;
        if (acknowledgement.length && previous.notes[subjectSession] !== acknowledgement[0])
          return previous;
        const next = { ...previous.notes };
        if (notes === undefined) delete next[subjectSession];
        else next[subjectSession] = notes;
        return { ...previous, notes: next };
      });
    },
    [setDrafts],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reportSubjectSession, setReportSubjectSession] = useState<string | null>(null);
  const [logSubjectSession, setLogSubjectSession] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<LogContent | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const logRequestId = useRef(0);

  const rows = useMemo<ResolutionRow[]>(
    () =>
      disagreements.map((disagreement) => ({
        ...disagreement,
        ...parseSubjectSession(disagreement.subjectSession),
        resolution: resolvedVerdicts?.[disagreement.subjectSession],
      })),
    [disagreements, resolvedVerdicts],
  );
  const unresolvedCount = disagreements.filter(
    ({ subjectSession }) => !resolvedVerdicts?.[subjectSession],
  ).length;
  const filteredRows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (!search || row.subjectSession.toLocaleLowerCase().includes(search)) &&
        (filter === "all" ||
          (filter === "unresolved"
            ? !row.resolution ||
              pendingFails[row.subjectSession] ||
              row.subjectSession in drafts.notes
            : row.resolution &&
              !pendingFails[row.subjectSession] &&
              !(row.subjectSession in drafts.notes))),
    );
  }, [rows, query, filter, pendingFails, drafts.notes]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filteredRows.length / pageSize)));
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleStatusChange = useCallback(
    (subjectSession: string, status: string) => {
      if (status === "pass") {
        updateNotesDraft(subjectSession, undefined);
        const existing =
          useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
        setPendingFails((current) => {
          const { [subjectSession]: _, ...remaining } = current;
          return remaining;
        });
        setResolvedVerdict(subjectSession, "pass", {
          notes: existing?.notes,
        }).catch(() => undefined);
        return;
      }

      if (status === "fail") {
        const existing =
          useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
        setPendingFails((current) => ({
          ...current,
          [subjectSession]: current[subjectSession] ?? { notes: existing?.notes },
        }));
      }
    },
    [setResolvedVerdict, setPendingFails, updateNotesDraft],
  );

  const handleReasonChange = useCallback(
    (subjectSession: string, reason: string | null) => {
      if (!reason || !isManifestFailReason(reason)) return;
      const pendingFail = pendingFails[subjectSession];
      const notes =
        drafts.notes[subjectSession] ??
        pendingFail?.notes ??
        resolvedVerdicts?.[subjectSession]?.notes;
      setPendingFails((current) => ({
        ...current,
        [subjectSession]: { ...current[subjectSession], reason },
      }));
      if (Array.from(notes ?? "").length > 500) return;
      const lease = captureProjectLease();
      setResolvedVerdict(subjectSession, "fail", {
        reason,
        notes,
      })
        .then(() => {
          if (!isCurrentProjectLease(lease)) return;
          setPendingFails((current) => {
            if (current[subjectSession]?.reason !== reason) return current;
            const { [subjectSession]: _, ...remaining } = current;
            return remaining;
          });
          updateNotesDraft(subjectSession, undefined, notes);
        })
        .catch(() => undefined);
    },
    [
      pendingFails,
      drafts.notes,
      resolvedVerdicts,
      setResolvedVerdict,
      setPendingFails,
      updateNotesDraft,
    ],
  );

  const handleNotesBlur = useCallback(
    (subjectSession: string, notes: string) => {
      if (Array.from(notes).length > 500) return;
      if (pendingFails[subjectSession]) {
        const reason = pendingFails[subjectSession].reason;
        if (reason) handleReasonChange(subjectSession, reason);
        return;
      }
      const verdict =
        useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
      if (!verdict) return;
      const lease = captureProjectLease();
      setResolvedVerdict(subjectSession, verdict.status, {
        reason: verdict.reason,
        notes: notes || undefined,
      })
        .then(() => {
          if (isCurrentProjectLease(lease)) updateNotesDraft(subjectSession, undefined, notes);
        })
        .catch(() => undefined);
    },
    [setResolvedVerdict, pendingFails, handleReasonChange, updateNotesDraft],
  );

  const handleBulkResolve = useCallback(
    (reviewer: Reviewer) => {
      const currentResolved =
        useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts;
      for (const disagreement of disagreements) {
        if (currentResolved?.[disagreement.subjectSession]) continue;
        if (
          pendingFails[disagreement.subjectSession] ||
          disagreement.subjectSession in drafts.notes
        )
          continue;
        const verdict = disagreement.verdictsByReviewer[reviewer.id];
        if (!verdict) continue;
        setResolvedVerdict(disagreement.subjectSession, verdict.status, {
          reason: verdict.reason,
          notes: verdict.notes,
        }).catch(() => undefined);
      }
    },
    [disagreements, setResolvedVerdict, pendingFails, drafts.notes],
  );

  const handleViewLogs = useCallback(
    async (subjectSession: string) => {
      if (!projectRoot) return;
      const requestId = ++logRequestId.current;
      setLogSubjectSession(subjectSession);
      setLogContent(null);
      setLogError(null);
      setLogLoading(true);
      try {
        const content = await fetchLogContent(projectRoot, subjectSession, "asl");
        if (requestId !== logRequestId.current) return;
        setLogContent(content);
      } catch {
        if (requestId !== logRequestId.current) return;
        setLogError("Failed to load log content");
      } finally {
        if (requestId === logRequestId.current) setLogLoading(false);
      }
    },
    [projectRoot],
  );

  const columns = useMemo<DataTableColumn<ResolutionRow>[]>(
    () => [
      {
        accessor: "subject",
        title: "Subject",
        width: 140,
        render: (row) => (
          <Text ff="monospace" data-testid={`resolution-subject-${row.subjectSession}`}>
            {row.subject}
          </Text>
        ),
      },
      {
        accessor: "session",
        title: "Session",
        width: 90,
        render: (row) => (
          <Text ff="monospace" data-testid={`resolution-session-${row.subjectSession}`}>
            {row.session}
          </Text>
        ),
      },
      ...reviewers.map<DataTableColumn<ResolutionRow>>((reviewer) => ({
        accessor: `reviewer-${reviewer.id}`,
        title: reviewer.label,
        width: 150,
        render: (row) => {
          const verdict = row.verdictsByReviewer[reviewer.id];
          return (
            <Stack gap={2} data-testid={`reviewer-verdict-${reviewer.id}-${row.subjectSession}`}>
              <Text size="sm">{verdict?.status === "pass" ? "✅ Pass" : "❌ Fail"}</Text>
              {verdict?.status === "fail" && verdict.reason && (
                <Text size="xs" c="dimmed">
                  {verdict.reason}
                </Text>
              )}
              {verdict?.notes && (
                <Text size="xs" data-testid={`reviewer-notes-${reviewer.id}-${row.subjectSession}`}>
                  {verdict.notes}
                </Text>
              )}
            </Stack>
          );
        },
      })),
      {
        accessor: "finalVerdict",
        title: "Final Verdict",
        width: 320,
        render: (row) => {
          const pendingFail = pendingFails[row.subjectSession];
          const selectedStatus = pendingFail ? "fail" : (row.resolution?.status ?? "");
          const reason = pendingFail?.reason ?? row.resolution?.reason ?? null;
          return (
            <Stack gap="xs">
              <Group gap="xs" wrap="nowrap">
                <SegmentedControl
                  size="xs"
                  value={selectedStatus}
                  data={[
                    { value: "pass", label: "Pass" },
                    { value: "fail", label: "Fail" },
                  ]}
                  onChange={(status) => handleStatusChange(row.subjectSession, status)}
                  aria-label={`Final verdict for ${row.subjectSession}`}
                  {...segmentedControlTestIds(`final-verdict-${row.subjectSession}`)}
                />
                <Badge
                  color={row.resolution && !pendingFail ? "teal" : "yellow"}
                  variant="light"
                  data-testid={`resolution-state-${row.subjectSession}`}
                >
                  {row.resolution && !pendingFail ? "Resolved" : "Pending"}
                </Badge>
              </Group>
              {selectedStatus === "fail" && (
                <Select
                  size="xs"
                  value={reason}
                  data={Object.entries(FAIL_REASON_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  placeholder="Reason required"
                  error={!reason ? "Reason required" : undefined}
                  onChange={(value) => handleReasonChange(row.subjectSession, value)}
                  aria-label={`Failure reason for ${row.subjectSession}`}
                  {...comboboxTestIds(`final-reason-${row.subjectSession}`)}
                />
              )}
              {(row.resolution || pendingFail) && (
                <TextInput
                  size="xs"
                  value={
                    drafts.notes[row.subjectSession] ??
                    pendingFail?.notes ??
                    row.resolution?.notes ??
                    ""
                  }
                  onChange={(event) =>
                    updateNotesDraft(row.subjectSession, event.currentTarget.value)
                  }
                  error={
                    Array.from(
                      drafts.notes[row.subjectSession] ??
                        pendingFail?.notes ??
                        row.resolution?.notes ??
                        "",
                    ).length > 500
                      ? "Maximum 500 Unicode characters"
                      : undefined
                  }
                  placeholder="Notes (optional)"
                  onBlur={(event) => handleNotesBlur(row.subjectSession, event.currentTarget.value)}
                  aria-label={`Resolution notes for ${row.subjectSession}`}
                  data-testid={`final-notes-${row.subjectSession}`}
                />
              )}
            </Stack>
          );
        },
      },
      {
        accessor: "actions",
        title: "Actions",
        width: "30%",
        render: (row) => {
          return (
            <Group gap={4} wrap="wrap" data-testid={`resolution-actions-${row.subjectSession}`}>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setReportSubjectSession(row.subjectSession)}
                aria-label={`View images for ${row.subjectSession}`}
                data-testid={`view-images-${row.subjectSession}`}
              >
                View Images/Reports
              </Button>
              <QcMetricsPopover
                subjectSession={row.subjectSession}
                metrics={qcData?.[row.subjectSession]}
                dropdownTestId={`resolution-qc-metrics-${row.subjectSession}`}
              />
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => void handleViewLogs(row.subjectSession)}
                aria-label={`View logs for ${row.subjectSession}`}
                data-testid={`view-logs-${row.subjectSession}`}
              >
                View Logs
              </Button>
            </Group>
          );
        },
      },
    ],
    [
      handleNotesBlur,
      handleReasonChange,
      handleStatusChange,
      handleViewLogs,
      pendingFails,
      qcData,
      reviewers,
      drafts.notes,
      updateNotesDraft,
    ],
  );

  if (disagreements.length === 0) {
    return (
      <Stack data-testid="verdict-resolution">
        <Text c="dimmed" data-testid="verdict-resolution-empty">
          No disagreements require resolution.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="sm" className="manifest-worklist" data-testid="verdict-resolution">
      <Group justify="space-between" align="center">
        <Text fw={600}>Verdict Resolution</Text>
        <Text
          size="sm"
          c={unresolvedCount === 0 ? "teal" : "dimmed"}
          data-testid="resolution-remaining"
        >
          {unresolvedCount === 0
            ? "All disagreements resolved"
            : `${unresolvedCount} disagreements remaining`}
        </Text>
      </Group>
      <Text size="sm" c="dimmed" data-testid="resolution-scope-note">
        Compare original ratings, then choose final verdicts. Initial agreement remains based on
        original reviewer ratings.
      </Text>
      <Group gap="xs" data-testid="bulk-resolution-actions">
        {reviewers.map((reviewer) => (
          <Button
            key={reviewer.id}
            size="xs"
            variant="light"
            onClick={() => handleBulkResolve(reviewer)}
            data-testid={`bulk-resolve-${reviewer.id}`}
          >
            Resolve all as {reviewer.label}
          </Button>
        ))}
      </Group>
      <Text size="xs" c="dimmed" data-testid="resolution-bulk-scope">
        Bulk resolution covers every unresolved disagreement, across pages and filters. Accepted
        resolutions and explicit drafts are not overwritten.
      </Text>
      <Text size="xs" c="dimmed" data-testid="resolution-draft-status">
        {Object.keys(pendingFails).length} pending Fail drafts · {Object.keys(drafts.notes).length}{" "}
        pending notes across all pages and filters
      </Text>
      <Group align="end" gap="xs" data-testid="resolution-tools">
        <TextInput
          label="Search subject or visit"
          size="sm"
          className="manifest-search"
          value={query}
          data-testid="resolution-search"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setPage(1);
          }}
        />
        <NativeSelect
          label="Resolution status"
          size="sm"
          value={filter}
          data={[
            { value: "all", label: "All disagreements" },
            { value: "unresolved", label: "Unresolved only" },
            { value: "resolved", label: "Resolved only" },
          ]}
          data-testid="resolution-filter"
          onChange={(event) => {
            setFilter(event.currentTarget.value);
            setPage(1);
          }}
        />
      </Group>
      <Box className="manifest-table-frame" data-testid="resolution-table-frame">
        <DataTable
          classNames={{ root: "manifest-editor", table: "manifest-resolution-table" }}
          records={paginatedRows}
          columns={columns}
          idAccessor="subjectSession"
          highlightOnHover
          withTableBorder
          minHeight={200}
          height="auto"
          page={currentPage}
          onPageChange={setPage}
          totalRecords={filteredRows.length}
          recordsPerPage={pageSize}
          recordsPerPageOptions={[10, 25, 50]}
          onRecordsPerPageChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
          recordsPerPageLabel="Entries per page"
          paginationSize="sm"
          paginationWithEdges
          getPaginationControlProps={(control) => ({
            "data-testid": `resolution-table-page-${control}`,
            "aria-label": `${control} resolution page`,
          })}
          getPaginationItemProps={(value) => ({
            "data-testid": `resolution-table-page-${value}`,
            "aria-label": `Resolution page ${value}`,
          })}
          scrollAreaProps={{
            type: "auto",
            viewportProps: {
              tabIndex: 0,
              role: "region",
              "aria-label": "Reviewer disagreements",
              ...{ "data-testid": "resolution-table-scroll" },
            },
          }}
          data-testid="verdict-resolution-table"
        />
      </Box>
      <ReportViewerModal
        opened={reportSubjectSession !== null}
        onClose={() => setReportSubjectSession(null)}
        projectRoot={projectRoot}
        subjectSession={reportSubjectSession ?? ""}
        module="asl"
      />
      <LogViewerModal
        opened={logSubjectSession !== null}
        onClose={() => {
          logRequestId.current++;
          setLogSubjectSession(null);
          setLogContent(null);
          setLogLoading(false);
          setLogError(null);
        }}
        logContent={logContent}
        module="asl"
        subjectSession={logSubjectSession ?? ""}
        loading={logLoading}
        error={logError}
        runErrorMap={EMPTY_RUN_ERROR_MAP}
      />
    </Stack>
  );
}
