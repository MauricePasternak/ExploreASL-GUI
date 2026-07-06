import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconInfoCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { exists } from "@tauri-apps/plugin-fs";

import { summarizeAslContext } from "../../lib/bids/sidecar";
import { sanitizeLabel } from "../../lib/bids/normalize";
import { logAction } from "../../lib/debug";
import type { DerivedMetadataGroup, MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import HeaderCard from "../HeaderCard";
import BIDSIcon from "../BIDSIcon";

/** Keys from bidsParams that are not displayed in the params table. */
const SKIP_PARAMS_KEYS = new Set(["id", "label"]);

function ensureSubPrefix(subject: string): string {
  return subject.startsWith("sub-") ? subject : `sub-${subject}`;
}

function groupsFromPersistedMapping(
  metadataGroups: MetadataGroup[],
  subjectRows: SubjectRow[],
): DerivedMetadataGroup[] {
  return metadataGroups.map((group) => {
    const sessionsBySubject = new Map<string, Set<string>>();
    for (const row of subjectRows) {
      if (row.groupId !== group.id) continue;
      const subjectLabel = ensureSubPrefix(row.subject);
      const sessions = sessionsBySubject.get(subjectLabel) ?? new Set<string>();
      sessions.add(row.session);
      sessionsBySubject.set(subjectLabel, sessions);
    }

    const subjects = Array.from(sessionsBySubject.entries())
      .map(([subjectLabel, sessions]) => ({
        subjectLabel,
        sessionLabels: Array.from(sessions).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.subjectLabel.localeCompare(b.subjectLabel));

    const manufacturer = group.bidsParams.Manufacturer;
    const acquisition = group.bidsParams.MRAcquisitionType;
    const sequence = group.bidsParams.PulseSequenceType;
    const labeling = group.bidsParams.ArterialSpinLabelingType ?? group.bidsParams.LabelingType;

    return {
      ...group,
      vendor: manufacturer ?? "UnknownVendor",
      sequence: [acquisition, sequence].filter(Boolean).join("_") || "UnknownSequence",
      labelingType: labeling ?? "UnknownLabelingType",
      subjects,
    };
  });
}

function formatVendor(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes("siemens")) return "Siemens";
  if (v.includes("philips")) return "Philips";
  if (v.includes("ge")) return "GE";
  return vendor;
}

function formatSequence(seq: string): string {
  const s = seq.toLowerCase();
  if (s.includes("grase") || s.includes("tgse")) {
    return "Gradient & Spin Echo";
  }
  if (s.includes("epi") || s.includes("ep2d") || s.includes("epfid") || s.includes("pepolar")) {
    return "Echo Planar Imaging";
  }
  if (s.includes("spiral") || s.includes("sprial")) {
    return "Stack of Spirals";
  }
  return seq;
}

function formatLabelingType(labeling: string): string {
  const l = labeling.toLowerCase();
  if (l.includes("pcasl")) {
    return "Pseudo-continuous ASL";
  }
  if (l.includes("casl")) {
    return "Continuous ASL";
  }
  if (l.includes("pasl")) {
    return "Pulsed ASL";
  }
  return labeling;
}

export default function BIDSReviewPanel() {
  const navigate = useNavigate();

  // Import store state
  const scanComplete = useImportStore((s) => s.bidsReview.scanComplete);
  const scanError = useImportStore((s) => s.bidsReview.scanError);
  const detectedGroups = useImportStore((s) => s.bidsReview.detectedGroups);
  const skippedSubjects = useImportStore((s) => s.bidsReview.skippedSubjects);
  const startBidsScan = useImportStore((s) => s.startBidsScan);
  const retryBidsScan = useImportStore((s) => s.retryBidsScan);
  const rescanConfirmedBidsProject = useImportStore((s) => s.rescanConfirmedBidsProject);
  const backToLanding = useImportStore((s) => s.backToLanding);

  // Project store state
  const project = useProjectStore((s) => s.project);
  const confirmBidsReview = useProjectStore((s) => s.confirmBidsReview);

  const rootPath = project?.projectMeta.rootPath ?? "";
  const projectId = project?.projectMeta.id ?? "";
  const bidsReviewConfirmed = project?.uiState?.import?.bidsReviewConfirmed ?? false;
  const persistedSkippedSubjects = project?.uiState?.import?.skippedSubjects ?? [];
  const persistedSourceDataPath = project?.mappingState?.sourceDataPath ?? "";
  const persistedGroups = useMemo(
    () =>
      groupsFromPersistedMapping(
        project?.mappingState?.metadataGroups ?? [],
        project?.mappingState?.subjectRows ?? [],
      ),
    [project?.mappingState?.metadataGroups, project?.mappingState?.subjectRows],
  );

  // Local state for editable labels (only stores user edits)
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});
  const [labelErrors, setLabelErrors] = useState<Record<string, string>>({});
  const [retryCount, setRetryCount] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [rescanMode, setRescanMode] = useState(false);
  // Persisted banner: populated when `<projectRoot>/participants.tsv` exists.
  // Checked once on mount via the Tauri fs `exists` plugin (D21).
  const [participantsTsvExists, setParticipantsTsvExists] = useState(false);

  // Track whether initial scan has been triggered
  const scanTriggered = useRef(false);

  // Trigger scan on mount for the initial unconfirmed review. Confirmed
  // projects re-scan only after the explicit revisit action.
  useEffect(() => {
    if (!bidsReviewConfirmed && rootPath && !scanTriggered.current) {
      scanTriggered.current = true;
      logAction("bids_review_scan_start", { rootPath });
      void startBidsScan(rootPath);
    }
  }, [bidsReviewConfirmed, rootPath, startBidsScan]);

  // Async check for root-level `participants.tsv` (D21). Effect cleanup sets a
  // stale flag so we ignore resolves arriving after unmount. `Promise.resolve`
  // wraps the call so partial mocks returning undefined (jsdom test setup)
  // don't crash the panel — defensively resolves to "absent".
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    const candidatesTsvPath = `${rootPath}/participants.tsv`;
    Promise.resolve(exists(candidatesTsvPath))
      .then((found) => {
        if (!cancelled) setParticipantsTsvExists(found === true);
      })
      .catch(() => {
        if (!cancelled) setParticipantsTsvExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Derive effective labels: auto-suggested label as default, user overrides on top
  function getEffectiveLabel(group: DerivedMetadataGroup): string {
    return labelOverrides[group.id] ?? group.label;
  }

  function handleRetry() {
    setRetryCount((c) => c + 1);
    logAction("bids_review_retry", { rootPath, retryCount: retryCount + 1 });
    if (rescanMode && bidsReviewConfirmed) {
      void rescanConfirmedBidsProject(getScanRootPath());
    } else {
      void retryBidsScan(rootPath);
    }
  }

  function getScanRootPath() {
    return persistedSourceDataPath || rootPath;
  }

  function handleRescanConfirmedProject() {
    const scanRootPath = getScanRootPath();
    setRescanMode(true);
    setRetryCount(0);
    setLabelOverrides({});
    setLabelErrors({});
    logAction("bids_review_confirmed_rescan_start", { rootPath: scanRootPath });
    void rescanConfirmedBidsProject(scanRootPath);
  }

  function handleReturnToSummary() {
    setRescanMode(false);
    setRetryCount(0);
    setLabelOverrides({});
    setLabelErrors({});
  }

  function handleBackToLanding() {
    logAction("bids_review_back_to_landing");
    backToLanding();
    navigate("/");
  }

  function handleLabelChange(groupId: string, value: string) {
    // Phase 11.1: block-list sanitizer strips path/control/shell-special
    // characters at the input layer so they never enter the label state.
    const sanitized = sanitizeLabel(value);
    setLabelOverrides((prev) => ({ ...prev, [groupId]: sanitized }));
    // Clear error on edit
    setLabelErrors((prev) => {
      if (!(groupId in prev)) return prev;
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }

  function validateLabels(): boolean {
    const errors: Record<string, string> = {};
    const lowerMap = new Map<string, string[]>();

    for (const group of detectedGroups) {
      const label = getEffectiveLabel(group);
      if (!label.trim()) {
        errors[group.id] = "Label is required";
      }
      const lower = label.trim().toLowerCase();
      if (lower) {
        const existing = lowerMap.get(lower) ?? [];
        existing.push(group.id);
        lowerMap.set(lower, existing);
      }
    }

    // Check duplicates
    for (const [, groupIds] of lowerMap) {
      if (groupIds.length > 1) {
        for (const gid of groupIds) {
          const lbl = getEffectiveLabel(detectedGroups.find((g) => g.id === gid)!);
          errors[gid] = `Label '${lbl}' already in use`;
        }
      }
    }

    setLabelErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleConfirm() {
    if (!validateLabels()) return;

    // Update labels in importStore before confirming
    const updatedGroups = detectedGroups.map((g) => ({
      ...g,
      label: getEffectiveLabel(g),
    }));
    useImportStore.getState().setDetectedGroups(updatedGroups);

    setConfirming(true);
    logAction("bids_review_confirm", {
      groupCount: updatedGroups.length,
      subjectCount: updatedGroups.reduce((sum, g) => sum + g.subjects.length, 0),
    });
    try {
      await confirmBidsReview();
      logAction("bids_review_confirmed", { groupCount: updatedGroups.length });
      navigate(`/project/${projectId}/parameters`);
    } catch (err) {
      console.error("[BIDSReviewPanel] confirmBidsReview failed:", err);
      logAction("bids_review_confirm_error", { error: String(err) });
    } finally {
      setConfirming(false);
    }
  }

  // --- Render states ---

  // Confirmed revisit summary. This must render from persisted project state
  // before any session-only scan state checks so app reloads do not show only
  // skeletons when `bidsReview.detectedGroups` is empty.
  if (bidsReviewConfirmed && !rescanMode) {
    return (
      <Stack gap="md" data-testid="bids-review-panel">
        <HeaderCard
          icon={BIDSIcon}
          title="BIDS Review"
          subtitle="Review and organize the detected BIDS dataset. Match your subjects and confirm metadata grouping before proceeding."
          color="blue"
          dataTestId="bids-review-header"
        />
        <Alert
          color="green"
          icon={<IconCheck size={16} />}
          data-testid="bids-review-readonly-banner"
        >
          BIDS metadata groups confirmed. Import is complete.
        </Alert>

        {renderParticipantsBanner()}

        {renderSkippedWarning(
          persistedSkippedSubjects,
          "To include them, add the missing file externally and click Re-scan BIDS.",
        )}

        {persistedGroups.map((group) => renderGroupCard(group, true, persistedGroups.length))}

        <Group justify="flex-end">
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={handleRescanConfirmedProject}
            data-testid="bids-review-rescan-btn"
          >
            Re-scan BIDS
          </Button>
        </Group>
      </Stack>
    );
  }

  // Scan running
  if (!scanComplete && !scanError) {
    return (
      <Stack gap="md" data-testid="bids-review-panel">
        <HeaderCard
          icon={BIDSIcon}
          title="BIDS Review"
          subtitle="Review and organize the detected BIDS dataset. Match your subjects and confirm metadata grouping before proceeding."
          color="blue"
          dataTestId="bids-review-header"
        />
        <Skeleton height={40} data-testid="bids-review-scan-running" />
        <Skeleton height={100} />
        <Skeleton height={100} />
      </Stack>
    );
  }

  // Scan error
  if (scanError) {
    return (
      <Stack gap="md" data-testid="bids-review-panel">
        <HeaderCard
          icon={BIDSIcon}
          title="BIDS Review"
          subtitle="Review and organize the detected BIDS dataset. Match your subjects and confirm metadata grouping before proceeding."
          color="blue"
          dataTestId="bids-review-header"
        />
        <Alert color="red" data-testid="bids-review-scan-error">
          <Text fw={500}>Scan failed</Text>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {scanError}
          </Text>
          {retryCount >= 2 && (
            <Text size="sm" mt="xs" c="dimmed">
              Persistent scan failure — check directory permissions or delete project and recreate.
            </Text>
          )}
        </Alert>
        <Group>
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={handleRetry}
            data-testid="bids-review-retry-btn"
          >
            Retry
          </Button>
          <Button
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
            onClick={
              rescanMode && bidsReviewConfirmed ? handleReturnToSummary : handleBackToLanding
            }
            data-testid="bids-review-back-btn"
          >
            {rescanMode && bidsReviewConfirmed ? "Back to Confirmed Summary" : "Back to Landing"}
          </Button>
        </Group>
      </Stack>
    );
  }

  // 0 groups
  if (detectedGroups.length === 0) {
    return (
      <Stack gap="md" data-testid="bids-review-panel">
        <HeaderCard
          icon={BIDSIcon}
          title="BIDS Review"
          subtitle="Review and organize the detected BIDS dataset. Match your subjects and confirm metadata grouping before proceeding."
          color="blue"
          dataTestId="bids-review-header"
        />
        <Alert color="red" data-testid="bids-review-no-groups">
          <Text fw={500}>No ASL metadata groups detected</Text>
          <Text size="sm">
            The scan completed but found no ASL metadata groups. Check that the directory contains
            valid ASL sidecars.
          </Text>
        </Alert>
        <Group>
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={handleRetry}
            data-testid="bids-review-retry-btn"
          >
            Retry
          </Button>
          <Button
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
            onClick={
              rescanMode && bidsReviewConfirmed ? handleReturnToSummary : handleBackToLanding
            }
            data-testid="bids-review-back-btn"
          >
            {rescanMode && bidsReviewConfirmed ? "Back to Confirmed Summary" : "Back to Landing"}
          </Button>
        </Group>
      </Stack>
    );
  }

  // Normal view — editable
  return (
    <Stack gap="md" data-testid="bids-review-panel">
      <HeaderCard
        icon={BIDSIcon}
        title="BIDS Review"
        subtitle="Review and organize the detected BIDS dataset. Match your subjects and confirm metadata grouping before proceeding."
        color="blue"
        dataTestId="bids-review-header"
      />
      {renderParticipantsBanner()}

      {renderSkippedWarning(skippedSubjects)}

      {detectedGroups.map((group) => renderGroupCard(group, false, detectedGroups.length))}

      <Group justify="flex-end">
        <Button
          leftSection={<IconCheck size={16} />}
          onClick={handleConfirm}
          loading={confirming}
          data-testid="bids-review-confirm-btn"
        >
          Confirm
        </Button>
      </Group>
    </Stack>
  );

  // --- Helper renderers ---

  function renderParticipantsBanner() {
    // D21: banner persists in both editable and confirmed-summary branches when a
    // root-level `participants.tsv` file exists. Details ExploreASL's own
    // derivatives working copy and root-level immutability.
    if (!participantsTsvExists) return null;
    return (
      <Alert
        color="blue"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        data-testid="bids-review-participants-banner"
      >
        <Text size="sm" ff="monospace">
          participants.tsv
        </Text>{" "}
        detected at project root. Your existing{" "}
        <Text span ff="monospace" size="sm">
          participants.tsv
        </Text>{" "}
        (at project root) is not modified by ExploreASL GUI. During processing, ExploreASL generates
        its own working copy at{" "}
        <Text span ff="monospace" size="sm">
          derivatives/ExploreASL/participants.tsv
        </Text>{" "}
        and appends processing-derived columns (
        <Text span ff="monospace" size="xs">
          site
        </Text>
        ,{" "}
        <Text span ff="monospace" size="xs">
          gm_vol
        </Text>
        ,{" "}
        <Text span ff="monospace" size="xs">
          motion
        </Text>
        , etc.) there. Your root-level file stays as you authored it.
      </Alert>
    );
  }

  function renderSkippedWarning(skipped: string[], guidance?: string) {
    if (skipped.length === 0) return null;
    return (
      <Alert
        color="yellow"
        icon={<IconAlertTriangle size={16} />}
        data-testid="bids-review-skipped-warning"
      >
        <Text fw={500} size="sm">
          Skipped subjects ({skipped.length})
        </Text>
        <Stack gap={2} mt="xs">
          {skipped.map((entry) => (
            <Text key={entry} size="xs" ff="monospace">
              {entry}
            </Text>
          ))}
        </Stack>
        <Text size="xs" c="dimmed" mt="xs">
          These subjects will be excluded from processing.{" "}
          {guidance ?? "To include them, add the missing file externally and click Retry."}
        </Text>
      </Alert>
    );
  }

  function renderGroupCard(group: DerivedMetadataGroup, readOnly: boolean, groupCount: number) {
    const label = readOnly ? group.label : getEffectiveLabel(group);
    const error = labelErrors[group.id];
    const subjectCount = group.subjects.length;
    const sessionCount = group.subjects.reduce((sum, s) => sum + s.sessionLabels.length, 0);
    const defaultCollapsed = groupCount >= 10;
    // Read-only summary: cards collapsed by default (import-rerun spec).
    // Editable view: ≤1 group auto-expands params (bids-review-panel spec).
    const paramsExpanded = !readOnly && groupCount <= 1 && !defaultCollapsed;

    // Build sorted subject list
    const sortedSubjects = [...group.subjects].sort((a, b) =>
      a.subjectLabel.localeCompare(b.subjectLabel),
    );

    // Build params entries (skip id, label)
    const paramsEntries = Object.entries(group.bidsParams).filter(
      ([key]) => !SKIP_PARAMS_KEYS.has(key),
    );

    return (
      <Card key={group.id} withBorder p="md" data-testid={`bids-group-card-${group.id}`}>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <TextInput
              value={label}
              onChange={
                readOnly ? undefined : (e) => handleLabelChange(group.id, e.currentTarget.value)
              }
              readOnly={readOnly}
              label="Group Label"
              error={error}
              data-testid={`bids-group-label-input-${group.id}`}
              style={{ flex: 1 }}
            />
          </Group>

          {error && (
            <Text c="red" size="xs" data-testid={`bids-group-error-${group.id}`}>
              {error}
            </Text>
          )}

          <Group gap="xs">
            <Badge variant="light">{formatVendor(group.vendor)}</Badge>
            <Badge variant="light">{formatSequence(group.sequence)}</Badge>
            <Badge variant="light">{formatLabelingType(group.labelingType)}</Badge>
          </Group>

          <Text size="sm">
            {subjectCount} subject{subjectCount !== 1 ? "s" : ""}
            {sessionCount > subjectCount &&
              `, ${sessionCount} session${sessionCount !== 1 ? "s" : ""}`}
          </Text>

          <Accordion
            variant="separated"
            multiple
            defaultValue={paramsExpanded ? ["params", "subjects"] : []}
          >
            <Accordion.Item value="params">
              <Accordion.Control>Parameters</Accordion.Control>
              <Accordion.Panel>
                <Table striped>
                  <Table.Tbody>
                    {paramsEntries.map(([key, value]) => (
                      <Table.Tr key={key}>
                        <Table.Td fw={500}>{key}</Table.Td>
                        <Table.Td>
                          {key === "ASLContext"
                            ? summarizeAslContext(String(value ?? ""))
                            : formatParamValue(value)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="subjects">
              <Accordion.Control>Subjects ({subjectCount})</Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  {sortedSubjects.map((subj) => (
                    <Group key={subj.subjectLabel} gap="xs">
                      <Text size="sm" ff="monospace">
                        {subj.subjectLabel}
                      </Text>
                      <Text size="xs" c="dimmed">
                        sessions: {subj.sessionLabels.join(", ")}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Card>
    );
  }
}

function formatParamValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
