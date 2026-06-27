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
import { IconCheck, IconMinus, IconAlertCircle, IconSquareCheck } from "@tabler/icons-react";

import { useManifestStore } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import type { SubjectInfo, SubjectModuleStatus } from "../../schemas/processingSchemas";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { FAIL_REASON_LABELS } from "../../schemas/manifestSchemas";
import type { ManifestVerdict, ManifestFailReason } from "../../schemas/project";

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
  structuralStatus: "complete" | "incomplete" | "pending" | "skipped";
  aslStatus: "complete" | "incomplete" | "pending" | "skipped";
  noInfo: boolean;
  displayedVerdict: DisplayVerdict;
  storedVerdict?: ManifestVerdict;
  reason?: ManifestFailReason;
  notes?: string;
}

interface QcSelectionTableProps {
  noInfoSubjects?: Set<string>;
  onNextReady?: (ready: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "skipped")
    return (
      <Badge size="sm" color="gray" data-testid={`status-${status}`}>
        —
      </Badge>
    );
  if (status === "complete")
    return (
      <Badge
        size="sm"
        color="green"
        leftSection={<IconCheck size={12} />}
        data-testid={`status-${status}`}
      >
        Done
      </Badge>
    );
  if (status === "incomplete")
    return (
      <Badge
        size="sm"
        color="orange"
        leftSection={<IconMinus size={12} />}
        data-testid={`status-${status}`}
      >
        Partial
      </Badge>
    );
  return (
    <Badge
      size="sm"
      color="yellow"
      leftSection={<IconAlertCircle size={12} />}
      data-testid={`status-${status}`}
    >
      Pending
    </Badge>
  );
}

function resolveModuleDisplay(
  subjectInfo: SubjectInfo,
  module: "structural" | "asl",
  statuses: SubjectModuleStatus[],
): "complete" | "incomplete" | "pending" | "skipped" {
  if (module === "structural" && !subjectInfo.hasStructural) return "skipped";
  if (module === "asl" && !subjectInfo.hasASL) return "skipped";

  const entry = statuses.find(
    (s) => s.subjectSession === subjectInfo.subjectSession && s.module === module,
  );
  if (!entry) return "pending";
  if (entry.status === "complete") return "complete";
  if (entry.status === "incomplete") return "incomplete";
  return "pending";
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
  noInfoSubjects = new Set(),
  onNextReady,
}: QcSelectionTableProps) {
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const mappingState = useProjectStore((s) => s.project?.mappingState);
  const rawVerdicts = useProjectStore((s) => s.project?.uiState?.manifest?.verdicts);
  const verdicts = useMemo(() => rawVerdicts ?? {}, [rawVerdicts]);
  const staleVerdicts = useManifestStore((s) => s.staleVerdicts);

  const [filter, setFilter] = useState<FilterValue>("neutral");
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
      map.set(`${row.subject}_${row.session}`, row.groupId);
    }
    return map;
  }, [mappingState]);

  const handleVerdictChange = useCallback((subjectSession: string, value: string) => {
    if (value === "pass") {
      setPendingFails((prev) => {
        const next = new Map(prev);
        next.delete(subjectSession);
        return next;
      });
      useProjectStore.getState().setManifestVerdict(subjectSession, "pass", {
        setAt: Date.now(),
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
  }, []);

  const handleReasonChange = useCallback((subjectSession: string, reason: string | null) => {
    if (!reason) return;
    setPendingFails((prev) => {
      const next = new Map(prev);
      next.set(subjectSession, reason);
      return next;
    });
    useProjectStore.getState().setManifestVerdict(subjectSession, "fail", {
      reason: reason as ManifestFailReason,
      setAt: Date.now(),
    });
  }, []);

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
      const groupId = rowGroupMap.get(info.subjectSession);
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
      };
    });
  }, [availableSubjects, subjectStatuses, rowGroupMap, groupMap, verdicts, noInfoSubjects]);

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
        title: "Structural",
        textAlign: "center",
        render: (row) => <StatusBadge status={row.structuralStatus} />,
      },
      {
        accessor: "aslStatus",
        title: "ASL",
        textAlign: "center",
        render: (row) => <StatusBadge status={row.aslStatus} />,
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
    [pendingFails, handleVerdictChange, handleReasonChange, handleNotesBlur, staleVerdicts],
  );

  const handleBulkMarkPass = useCallback(() => {
    for (const row of rows) {
      if (
        row.structuralStatus === "complete" &&
        row.aslStatus === "complete" &&
        !row.noInfo &&
        row.displayedVerdict === "neutral"
      ) {
        useProjectStore.getState().setManifestVerdict(row.subjectSession, "pass", {
          setAt: Date.now(),
        });
      }
    }
  }, [rows]);

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
    </Stack>
  );
}
