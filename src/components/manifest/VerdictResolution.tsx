import { useCallback, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { DataTable, type DataTableColumn } from "mantine-datatable";

import { FAIL_REASON_LABELS } from "../../schemas/manifestSchemas";
import type { ManifestFailReason, ManifestVerdict, Reviewer } from "../../schemas/project";
import { aggregateMotionBySubject } from "../../lib/manifestQc";
import { fetchLogContent, type LogContent } from "../../lib/logViewer";
import { useManifestStore, type ManifestDisagreement } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import LogViewerModal from "../processing/LogViewerModal";
import ReportViewerModal from "../processing/ReportViewerModal";

interface ResolutionRow extends ManifestDisagreement {
  subject: string;
  session: string;
  resolution?: ManifestVerdict;
}

type PendingFail = { reason?: ManifestFailReason; notes?: string };

interface VerdictResolutionProps {
  disagreements?: ManifestDisagreement[];
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

function formatMetric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "Unavailable" : `${value}${suffix}`;
}

export default function VerdictResolution({
  disagreements: suppliedDisagreements,
}: VerdictResolutionProps) {
  const storedDisagreements = useManifestStore((state) => state.disagreements);
  const disagreements = suppliedDisagreements ?? storedDisagreements;
  const priorModulesMtimes = useManifestStore((state) => state.priorModulesMtimes);
  const qcData = useManifestStore((state) => state.qcData);
  const projectRoot = useProjectStore((state) => state.project?.projectMeta.rootPath);
  const reviewers = useProjectStore(
    (state) => state.project?.uiState.manifest?.reviewers ?? EMPTY_REVIEWERS,
  );
  const resolvedVerdicts = useProjectStore(
    (state) => state.project?.uiState.manifest?.resolvedVerdicts,
  );
  const setResolvedVerdict = useProjectStore((state) => state.setResolvedVerdict);
  const removeResolvedVerdict = useProjectStore((state) => state.removeResolvedVerdict);

  const [pendingFails, setPendingFails] = useState<Record<string, PendingFail>>({});
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

  const handleStatusChange = useCallback(
    (subjectSession: string, status: string) => {
      if (status === "pass") {
        const existing =
          useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
        setPendingFails((current) => {
          const { [subjectSession]: _, ...remaining } = current;
          return remaining;
        });
        setResolvedVerdict(subjectSession, "pass", {
          notes: existing?.notes,
          setAt: priorModulesMtimes[subjectSession] ?? 0,
        });
        return;
      }

      if (status === "fail") {
        const existing =
          useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
        if (existing?.status === "pass") removeResolvedVerdict(subjectSession);
        setPendingFails((current) => ({
          ...current,
          [subjectSession]: current[subjectSession] ?? { notes: existing?.notes },
        }));
      }
    },
    [priorModulesMtimes, removeResolvedVerdict, setResolvedVerdict],
  );

  const handleReasonChange = useCallback(
    (subjectSession: string, reason: string | null) => {
      if (!reason || !isManifestFailReason(reason)) return;
      const pendingFail = pendingFails[subjectSession];
      setResolvedVerdict(subjectSession, "fail", {
        reason,
        notes: pendingFail?.notes,
        setAt: priorModulesMtimes[subjectSession] ?? 0,
      });
      setPendingFails((current) => {
        const { [subjectSession]: _, ...remaining } = current;
        return remaining;
      });
    },
    [pendingFails, priorModulesMtimes, setResolvedVerdict],
  );

  const handleNotesBlur = useCallback(
    (subjectSession: string, notes: string) => {
      const verdict =
        useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts?.[subjectSession];
      if (!verdict) return;
      setResolvedVerdict(subjectSession, verdict.status, {
        reason: verdict.reason,
        notes: notes || undefined,
        setAt: priorModulesMtimes[subjectSession] ?? 0,
      });
    },
    [priorModulesMtimes, setResolvedVerdict],
  );

  const handleBulkResolve = useCallback(
    (reviewer: Reviewer) => {
      const currentResolved =
        useProjectStore.getState().project?.uiState.manifest?.resolvedVerdicts;
      for (const disagreement of disagreements) {
        if (currentResolved?.[disagreement.subjectSession]) continue;
        const verdict = disagreement.verdictsByReviewer[reviewer.id];
        if (!verdict) continue;
        setResolvedVerdict(disagreement.subjectSession, verdict.status, {
          reason: verdict.reason,
          notes: verdict.notes,
          setAt: priorModulesMtimes[disagreement.subjectSession] ?? 0,
        });
      }
    },
    [disagreements, priorModulesMtimes, setResolvedVerdict],
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
                  data-testid={`final-verdict-${row.subjectSession}`}
                />
                <Badge
                  color={row.resolution ? "teal" : "yellow"}
                  variant="light"
                  data-testid={`resolution-state-${row.subjectSession}`}
                >
                  {row.resolution ? "Resolved" : "Pending"}
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
                  data-testid={`final-reason-${row.subjectSession}`}
                />
              )}
              {row.resolution && !pendingFail && (
                <TextInput
                  key={`${row.subjectSession}-${row.resolution.status}-${row.resolution.notes ?? ""}`}
                  size="xs"
                  defaultValue={row.resolution.notes ?? ""}
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
          const metrics = qcData?.[row.subjectSession];
          const maxMotion = metrics ? aggregateMotionBySubject(metrics.motion) : null;
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
              <Popover width={240} position="bottom" withArrow shadow="md">
                <Popover.Target>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    aria-label={`View QC metrics for ${row.subjectSession}`}
                    data-testid={`view-qc-metrics-${row.subjectSession}`}
                  >
                    QC Metrics
                  </Button>
                </Popover.Target>
                <Popover.Dropdown data-testid={`resolution-qc-metrics-${row.subjectSession}`}>
                  <Table withTableBorder={false} verticalSpacing="xs">
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>Coverage</Table.Td>
                        <Table.Td>{formatMetric(metrics?.coverage, "%")}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>SpatialCoV</Table.Td>
                        <Table.Td>{formatMetric(metrics?.spatialCov)}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>Max Motion</Table.Td>
                        <Table.Td>{formatMetric(maxMotion, " mm RMS")}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>Motion Exclusion</Table.Td>
                        <Table.Td>{formatMetric(metrics?.motionExclusionPct, "%")}</Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </Popover.Dropdown>
              </Popover>
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
    <Stack gap="sm" data-testid="verdict-resolution">
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
      <Box style={{ isolation: "isolate" }}>
        <DataTable
          records={rows}
          columns={columns}
          idAccessor="subjectSession"
          striped
          highlightOnHover
          withTableBorder
          minHeight={200}
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
