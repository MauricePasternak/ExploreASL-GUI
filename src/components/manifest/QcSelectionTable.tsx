import { comboboxTestIds } from "../common/comboboxTestIds";
import { segmentedControlTestIds } from "../common/segmentedControlTestIds";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
import "./Manifest.css";

import { useManifestStore } from "../../stores/manifestStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessingStore } from "../../stores/processingStore";
import type { MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { FAIL_REASON_LABELS } from "../../schemas/manifestSchemas";
import {
  MANIFEST_FAIL_REASONS,
  type ManifestVerdict,
  type ManifestFailReason,
} from "../../schemas/project";

import LogViewerModal from "../processing/LogViewerModal";

import ReportViewerModal from "../processing/ReportViewerModal";
import { useSubjectViewers } from "../processing/useSubjectViewers";
import type { ModuleDisplayStatus } from "../processing/SubjectSelection.helpers";
import { resolveLogBadge, resolveModuleDisplay } from "../processing/SubjectSelection.helpers";
import { StatusIcon } from "../processing/SubjectSelection";
import { indexSubjectStatuses } from "../processing/subjectStatusIndex";
import { captureProjectLease, isCurrentProjectLease } from "../../lib/projectLifecycle";
import QcMetricsPopover from "./QcMetricsPopover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DisplayVerdict = "neutral" | "pass" | "fail" | "no-info";
type FilterValue = "all" | "neutral" | "pass" | "fail" | "no-info" | "stale";

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
  reviewerId?: string;
  draftState: [QcSelectionDrafts, Dispatch<SetStateAction<QcSelectionDrafts>>];
}

type FlatManifestVerdicts = Record<string, ManifestVerdict>;
type PendingFails = Map<string, string | undefined>;
type PendingFailsByScope = Map<string, PendingFails>;

export interface QcSelectionDrafts {
  pendingFails: PendingFailsByScope;
  notes: Map<string, Map<string, string>>;
}

const EMPTY_VERDICTS: FlatManifestVerdicts = {};
const EMPTY_STALE_VERDICTS = new Set<string>();
const EMPTY_PENDING_FAILS: PendingFails = new Map();

function isManifestFailReason(value: string): value is ManifestFailReason {
  return MANIFEST_FAIL_REASONS.some((reason) => reason === value);
}

function verdictSlice(
  value: Record<string, FlatManifestVerdicts> | undefined,
  reviewerId: string | undefined,
): FlatManifestVerdicts {
  return reviewerId ? (value?.[reviewerId] ?? EMPTY_VERDICTS) : EMPTY_VERDICTS;
}

function staleVerdictSlice(
  value: Record<string, Set<string>>,
  reviewerId: string | undefined,
): Set<string> {
  return reviewerId ? (value[reviewerId] ?? EMPTY_STALE_VERDICTS) : EMPTY_STALE_VERDICTS;
}

const FILTER_OPTIONS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Neutral", value: "neutral" },
  { label: "Pass", value: "pass" },
  { label: "Fail", value: "fail" },
  { label: "No Info", value: "no-info" },
  { label: "Stale", value: "stale" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QcSelectionTable({ reviewerId, draftState }: QcSelectionTableProps) {
  const availableSubjects = useProcessingStore((s) => s.availableSubjects);
  const subjectStatuses = useProcessingStore((s) => s.subjectStatuses);
  const processingPhase = useProcessingStore((s) => s.processingPhase);
  const mappingState = useProjectStore((s) => s.project?.mappingState);
  const reviewers = useProjectStore((s) => s.project?.uiState?.manifest?.reviewers);
  const activeReviewerId = useProjectStore((s) => s.project?.uiState?.manifest?.activeReviewerId);
  const selectedReviewerId = reviewerId ?? activeReviewerId;
  const scopedReviewerId = reviewers?.some((reviewer) => reviewer.id === selectedReviewerId)
    ? selectedReviewerId
    : undefined;
  const verdictScopeKey = scopedReviewerId ?? "unselected";
  const verdicts = useProjectStore((s) =>
    verdictSlice(s.project?.uiState?.manifest?.verdicts, scopedReviewerId),
  );
  const staleVerdicts = useManifestStore((s) =>
    staleVerdictSlice(s.staleVerdicts, scopedReviewerId),
  );
  const qcData = useManifestStore((s) => s.qcData);
  const qcLoaded = useManifestStore((s) => s.qcLoaded);
  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);

  const {
    structuralLogInfo,
    aslLogInfo,
    existingReports,
    handleViewLog,
    openReport,
    logModal,
    reportModal,
  } = useSubjectViewers(projectRoot, processingPhase);
  const { module: modalModule, subjectSession: modalSubjectSession } = logModal;

  const noInfoSubjects = useMemo(() => {
    const set = new Set<string>();
    if (qcLoaded && qcData) {
      for (const info of availableSubjects) {
        if (!(info.subjectSession in qcData)) {
          set.add(info.subjectSession);
        }
      }
    }
    return set;
  }, [availableSubjects, qcData, qcLoaded]);

  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [query, setQuery] = useState("");
  const [visit, setVisit] = useState("");
  const [drafts, setDrafts] = draftState;
  const pendingFailsByScope = drafts.pendingFails;
  const pendingFails = pendingFailsByScope.get(verdictScopeKey) ?? EMPTY_PENDING_FAILS;
  const notesDrafts = drafts.notes.get(verdictScopeKey);

  const updatePendingFails = useCallback(
    (update: (pendingFails: PendingFails) => void) => {
      setDrafts((previous) => {
        const next = new Map(previous.pendingFails);
        const previousSlice = next.get(verdictScopeKey);
        const pendingFailsForScope = new Map(next.get(verdictScopeKey));
        update(pendingFailsForScope);
        if (!previousSlice?.size && !pendingFailsForScope.size) return previous;
        if (pendingFailsForScope.size === 0) {
          next.delete(verdictScopeKey);
        } else {
          next.set(verdictScopeKey, pendingFailsForScope);
        }
        return { ...previous, pendingFails: next };
      });
    },
    [verdictScopeKey, setDrafts],
  );

  const updateNotesDraft = useCallback(
    // A supplied third argument is an ACK, including an explicitly submitted undefined.
    (
      subjectSession: string,
      notes: string | undefined,
      ...acknowledgement: [] | [submittedNotes: string | undefined]
    ) => {
      setDrafts((previous) => {
        const previousSlice = previous.notes.get(verdictScopeKey);
        if (notes === undefined && !previousSlice?.has(subjectSession)) return previous;
        if (acknowledgement.length && previousSlice?.get(subjectSession) !== acknowledgement[0])
          return previous;
        const next = new Map(previous.notes);
        const slice = new Map(next.get(verdictScopeKey));
        if (notes === undefined) slice.delete(subjectSession);
        else slice.set(subjectSession, notes);
        if (slice.size) next.set(verdictScopeKey, slice);
        else next.delete(verdictScopeKey);
        return { ...previous, notes: next };
      });
    },
    [setDrafts, verdictScopeKey],
  );

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

  const statusIndex = useMemo(() => indexSubjectStatuses(subjectStatuses), [subjectStatuses]);

  const handleVerdictChange = useCallback(
    (subjectSession: string, value: string) => {
      if (value === "pass") {
        updateNotesDraft(subjectSession, undefined);
        updatePendingFails((pendingFailsForScope) => pendingFailsForScope.delete(subjectSession));
        useProjectStore
          .getState()
          .setManifestVerdict(subjectSession, "pass", {}, scopedReviewerId)
          .catch(() => undefined);
      } else if (value === "fail") {
        updatePendingFails((pendingFailsForScope) =>
          pendingFailsForScope.set(subjectSession, undefined),
        );
      } else if (value === "neutral") {
        updateNotesDraft(subjectSession, undefined);
        updatePendingFails((pendingFailsForScope) => pendingFailsForScope.delete(subjectSession));
        useProjectStore
          .getState()
          .removeManifestVerdict(subjectSession, scopedReviewerId)
          .catch(() => undefined);
      }
    },
    [scopedReviewerId, updatePendingFails, updateNotesDraft],
  );

  const handleReasonChange = useCallback(
    (subjectSession: string, reason: string | null) => {
      if (!reason) return;
      if (!isManifestFailReason(reason)) return;
      const notes = notesDrafts?.get(subjectSession) ?? verdicts[subjectSession]?.notes;
      updatePendingFails((pendingFailsForScope) =>
        pendingFailsForScope.set(subjectSession, reason),
      );
      if (Array.from(notes ?? "").length > 500) return;
      const lease = captureProjectLease();
      useProjectStore
        .getState()
        .setManifestVerdict(
          subjectSession,
          "fail",
          { reason, ...(notes !== undefined ? { notes } : {}) },
          scopedReviewerId,
        )
        .then(() => {
          if (!isCurrentProjectLease(lease)) return;
          updatePendingFails((pending) => {
            if (pending.get(subjectSession) === reason) pending.delete(subjectSession);
          });
          updateNotesDraft(subjectSession, undefined, notes);
        })
        .catch(() => undefined);
    },
    [scopedReviewerId, updatePendingFails, notesDrafts, verdicts, updateNotesDraft],
  );

  const handleNotesBlur = useCallback(
    (subjectSession: string, notes: string) => {
      const current = verdicts[subjectSession];
      if (Array.from(notes).length > 500) return;
      if (pendingFails.has(subjectSession)) {
        const reason = pendingFails.get(subjectSession);
        if (reason) handleReasonChange(subjectSession, reason);
        return;
      }
      if (!current) return;
      const lease = captureProjectLease();
      useProjectStore
        .getState()
        .setManifestVerdict(
          subjectSession,
          current.status,
          { reason: current.reason, notes: notes || undefined },
          scopedReviewerId,
        )
        .then(() => {
          if (isCurrentProjectLease(lease)) updateNotesDraft(subjectSession, undefined, notes);
        })
        .catch(() => undefined);
    },
    [verdicts, scopedReviewerId, pendingFails, handleReasonChange, updateNotesDraft],
  );

  const sortedSubjects = useMemo(
    () =>
      [...availableSubjects].sort((a, b) =>
        a.subjectSession.localeCompare(b.subjectSession, undefined, { numeric: true }),
      ),
    [availableSubjects],
  );
  const rows: QcRow[] = useMemo(() => {
    return sortedSubjects.map((info) => {
      const structuralStatus = resolveModuleDisplay(info, "structural", statusIndex);
      const aslStatus = resolveModuleDisplay(info, "asl", statusIndex);
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
  }, [sortedSubjects, statusIndex, rowGroupMap, groupMap, verdicts, noInfoSubjects]);

  const handleViewReport = useCallback(
    (subjectSession: string, module: "structural" | "asl") => {
      const row = rows.find((r) => r.subjectSession === subjectSession);
      openReport(subjectSession, module, row?.aslRuns || []);
    },
    [rows, openReport],
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
      stale: 0,
    };
    for (const row of rows) {
      if (!row.noInfo && staleVerdicts.has(row.subjectSession)) counts.stale++;
      if (pendingFails.has(row.subjectSession)) {
        counts.fail++;
      } else {
        counts[row.displayedVerdict]++;
      }
    }
    return counts;
  }, [rows, pendingFails, staleVerdicts]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (search && !`${row.subject} ${row.groupLabel}`.toLocaleLowerCase().includes(search))
        return false;
      if (visit && row.session !== visit) return false;
      if (filter === "all") return true;
      if (filter === "stale") return !row.noInfo && staleVerdicts.has(row.subjectSession);
      if (pendingFails.has(row.subjectSession)) return filter === "fail";
      return row.displayedVerdict === filter;
    });
  }, [rows, filter, pendingFails, query, visit, staleVerdicts]);

  const currentPage = Math.min(page, Math.max(1, Math.ceil(filteredRows.length / pageSize)));

  const paginatedRows = useMemo(() => {
    const from = (currentPage - 1) * pageSize;
    return filteredRows.slice(from, from + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const renderModuleEvidence = useCallback(
    (row: QcRow, module: "structural" | "asl") => {
      const status = module === "structural" ? row.structuralStatus : row.aslStatus;
      const files = (module === "structural" ? structuralLogInfo : aslLogInfo).get(
        row.subjectSession,
      );
      const logBadge = resolveLogBadge(status, files);
      const hasReport =
        existingReports.has(`${row.subjectSession}:${module}`) ||
        (module === "asl" && existingReports.has(`${row.subjectSession}:m0`));
      return (
        <Stack gap={4} align="start" data-testid={`qc-${module}-evidence-${row.subjectSession}`}>
          <Group gap={4} wrap="nowrap">
            <StatusIcon status={status} processingPhase={processingPhase} />
            <Text size="xs" tt="capitalize">
              {status}
            </Text>
          </Group>
          {status !== "skipped" && (
            <>
              {logBadge === "no-logs" ? (
                <Text size="xs" c="dimmed" data-testid={`no-${module}-logs`}>
                  No Logs
                </Text>
              ) : (
                <Button
                  size="compact-xs"
                  color={logBadge === "errors" ? "red" : "blue"}
                  variant="subtle"
                  onClick={() => handleViewLog(row.subjectSession, module)}
                  aria-label={`View ${module} ${logBadge === "errors" ? "errors" : "logs"} for ${row.subjectSession}`}
                  data-testid={`view-${module}-${logBadge === "errors" ? "errors" : "logs"}`}
                >
                  {logBadge === "errors" ? "View Errors" : "View Logs"}
                </Button>
              )}
              {hasReport ? (
                <Button
                  size="compact-xs"
                  color="blue"
                  variant="subtle"
                  onClick={() => handleViewReport(row.subjectSession, module)}
                  aria-label={`View ${status === "outdated" ? "outdated " : ""}${module} report for ${row.subjectSession}`}
                  data-testid={`view-${module}-report`}
                >
                  {status === "outdated" ? "View Outdated Report" : "View Report"}
                </Button>
              ) : (
                <Text size="xs" c="dimmed" data-testid={`no-${module}-report`}>
                  No Report
                </Text>
              )}
            </>
          )}
        </Stack>
      );
    },
    [
      structuralLogInfo,
      aslLogInfo,
      existingReports,
      processingPhase,
      handleViewLog,
      handleViewReport,
    ],
  );

  const columns: DataTableColumn<QcRow>[] = useMemo(
    () => [
      {
        accessor: "subject",
        title: "Subject / Session (visit)",
        render: (row) => (
          <Stack gap={2} align="start">
            <Text size="sm" fw={600} ff="monospace">
              {row.subject.replace(/^sub-/, "")}
            </Text>
            <Text size="xs" c="dimmed">
              Session {row.session}
            </Text>
            <QcMetricsPopover
              subjectSession={row.subjectSession}
              metrics={qcData?.[row.subjectSession]}
              dropdownTestId={`qc-metrics-${row.subjectSession}`}
            />
          </Stack>
        ),
      },
      {
        accessor: "groupLabel",
        title: "Metadata group",
      },
      {
        accessor: "structuralStatus",
        title: "Structural",
        render: (row) => renderModuleEvidence(row, "structural"),
      },
      {
        accessor: "aslStatus",
        title: "ASL",
        render: (row) => renderModuleEvidence(row, "asl"),
      },
      {
        accessor: "verdict",
        title: "Reviewer verdict",
        render: (row) => {
          if (row.noInfo) {
            return (
              <Stack gap={4} align="start">
                <Badge color="gray" data-testid={`no-info-badge-${row.subjectSession}`}>
                  No Info
                </Badge>
                <Text size="xs" c="dimmed">
                  Absent after successful QC load; not a verdict.
                </Text>
              </Stack>
            );
          }

          const isPendingFail = pendingFails.has(row.subjectSession);
          const reasonValue = pendingFails.get(row.subjectSession);
          const effectiveVerdict = isPendingFail ? "fail" : row.displayedVerdict;
          const segValue = effectiveVerdict === "no-info" ? "neutral" : effectiveVerdict;

          return (
            <Box className="manifest-decision" data-testid={`qc-decision-${row.subjectSession}`}>
              <SegmentedControl
                size="xs"
                aria-label={`Verdict for ${row.subjectSession}`}
                data={[
                  { value: "neutral", label: "Neutral" },
                  { value: "pass", label: "Pass" },
                  { value: "fail", label: "Fail" },
                ]}
                value={segValue}
                disabled={row.noInfo}
                onChange={(v) => handleVerdictChange(row.subjectSession, v)}
                {...segmentedControlTestIds(`verdict-control-${row.subjectSession}`)}
              />
              {effectiveVerdict === "fail" && (
                <Select
                  size="xs"
                  data={Object.entries(FAIL_REASON_LABELS).map(([v, l]) => ({
                    value: v,
                    label: l,
                  }))}
                  value={(isPendingFail ? reasonValue : row.reason) ?? null}
                  onChange={(v) => handleReasonChange(row.subjectSession, v)}
                  label="Fail reason"
                  placeholder="Choose required reason"
                  error={
                    isPendingFail && !reasonValue
                      ? "Reason required · previous accepted verdict unchanged"
                      : undefined
                  }
                  aria-label={`Failure reason for ${row.subjectSession}`}
                  {...comboboxTestIds(`verdict-reason-${row.subjectSession}`)}
                />
              )}
              {effectiveVerdict !== "neutral" && (
                <TextInput
                  size="xs"
                  className="manifest-notes"
                  label="Notes (optional)"
                  aria-label={`Notes for ${row.subjectSession}`}
                  value={notesDrafts?.get(row.subjectSession) ?? row.notes ?? ""}
                  onChange={(event) =>
                    updateNotesDraft(row.subjectSession, event.currentTarget.value)
                  }
                  onBlur={(e) => handleNotesBlur(row.subjectSession, e.currentTarget.value)}
                  error={
                    Array.from(notesDrafts?.get(row.subjectSession) ?? row.notes ?? "").length > 500
                      ? "Maximum 500 Unicode characters"
                      : undefined
                  }
                  data-testid={`verdict-notes-${row.subjectSession}`}
                />
              )}
              {staleVerdicts.has(row.subjectSession) && (
                <Badge
                  size="xs"
                  color="orange"
                  style={{ flexShrink: 0 }}
                  data-testid={`stale-badge-${row.subjectSession}`}
                >
                  Stale
                </Badge>
              )}
            </Box>
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
      renderModuleEvidence,
      notesDrafts,
      updateNotesDraft,
      qcData,
    ],
  );

  const handleBulkMarkPass = useCallback(() => {
    const lease = captureProjectLease();
    for (const row of rows) {
      if (row.structuralStatus === "complete" && row.aslStatus === "complete" && !row.noInfo) {
        const previousNotesDraft = notesDrafts?.get(row.subjectSession);
        const hadPendingFail = pendingFails.has(row.subjectSession);
        const previousPendingFail = pendingFails.get(row.subjectSession);
        useProjectStore
          .getState()
          .setManifestVerdict(row.subjectSession, "pass", {}, scopedReviewerId)
          .then(() => {
            if (!isCurrentProjectLease(lease)) return;
            updatePendingFails((pending) => {
              if (
                pending.has(row.subjectSession) === hadPendingFail &&
                pending.get(row.subjectSession) === previousPendingFail
              )
                pending.delete(row.subjectSession);
            });
            updateNotesDraft(row.subjectSession, undefined, previousNotesDraft);
          })
          .catch(() => undefined);
      }
    }
  }, [rows, scopedReviewerId, updatePendingFails, updateNotesDraft, notesDrafts, pendingFails]);

  return (
    <Stack gap="sm" data-testid="qc-selection-table">
      <Box className="manifest-review-tools" data-testid="qc-review-tools">
        <SegmentedControl
          size="xs"
          className="manifest-status-filter"
          aria-label="Filter QC verdicts"
          value={filter}
          onChange={(val) => {
            setFilter(val as FilterValue);
            setPage(1);
          }}
          data={FILTER_OPTIONS.map((opt) => ({
            ...opt,
            label: (
              <Text span size="sm" style={{ whiteSpace: "nowrap" }}>
                {opt.label} ·{" "}
                <span data-testid={`qc-filter-count-${opt.value}`}>{filterCounts[opt.value]}</span>
              </Text>
            ),
          }))}
          {...segmentedControlTestIds("qc-filter")}
        />
        <Group gap="xs" align="end" className="manifest-search-tools" data-testid="qc-search-tools">
          <TextInput
            size="sm"
            label="Search subject or group"
            value={query}
            className="manifest-search"
            data-testid="qc-search"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(1);
            }}
          />
          <NativeSelect
            size="sm"
            label="Visit (GUI Session)"
            value={visit}
            data={[
              { value: "", label: "All visits" },
              ...Array.from(new Set(rows.map((row) => row.session)))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map((value) => ({ value, label: value })),
            ]}
            data-testid="qc-visit-filter"
            onChange={(event) => {
              setVisit(event.currentTarget.value);
              setPage(1);
            }}
          />
          <Button
            size="sm"
            variant="default"
            onClick={handleBulkMarkPass}
            data-testid="bulk-mark-pass"
          >
            Mark all complete→Pass
          </Button>
        </Group>
      </Box>
      <Text size="xs" c="dimmed" data-testid="qc-bulk-scope">
        Bulk Pass covers all eligible entries with both modules Complete, across pages and filters;
        only this reviewer's decisions change.
      </Text>

      <Box className="manifest-table-frame" data-testid="qc-table-frame">
        <DataTable
          classNames={{ root: "manifest-editor", table: "manifest-qc-table" }}
          records={paginatedRows}
          columns={columns}
          idAccessor="subjectSession"
          highlightOnHover
          borderRadius="sm"
          withTableBorder
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
          paginationWithEdges
          paginationSize="sm"
          getPaginationControlProps={(control) => ({
            "data-testid": `qc-verdict-table-page-${control}`,
            "aria-label": `${control[0].toUpperCase()}${control.slice(1)} page`,
          })}
          getPaginationItemProps={(page) => ({ "data-testid": `qc-verdict-table-page-${page}` })}
          minHeight={240}
          height="auto"
          scrollAreaProps={{
            type: "auto",
            viewportProps: {
              tabIndex: 0,
              role: "region",
              "aria-label": "QC work list",
              ...{ "data-testid": "qc-table-scroll" },
            },
          }}
          data-testid="qc-verdict-table"
        />
      </Box>
      <LogViewerModal {...logModal} runErrorMap={modalRunErrorMap} />
      <ReportViewerModal {...reportModal} />
    </Stack>
  );
}
