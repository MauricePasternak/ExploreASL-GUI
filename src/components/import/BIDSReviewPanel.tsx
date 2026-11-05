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
  IconArrowRight,
  IconCheck,
  IconInfoCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { exists } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { sanitizeLabel } from "../../lib/bids/normalize";
import { summarizeAslContext } from "../../lib/bids/sidecar";
import { logAction } from "../../lib/debug";
import { showErrorNotification } from "../../lib/errorNotifications";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
} from "../../lib/projectLifecycle";
import { resolveLogicalSource } from "../../lib/projectPaths";
import type { DerivedMetadataGroup, MetadataGroup, SubjectRow } from "../../schemas/importSchemas";
import { canAccessPhase } from "../../schemas/project";
import { useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import BIDSIcon from "../BIDSIcon";
import HeaderCard from "../common/HeaderCard";
import "./BIDSReviewPanel.css";

/** Keys from bidsParams that are not displayed in the params table. */
const SKIP_PARAMS_KEYS = new Set(["id", "label"]);

function ensureSubPrefix(subject: string): string {
  return subject.startsWith("sub-") ? subject : `sub-${subject}`;
}

function countMemberships(groups: DerivedMetadataGroup[]) {
  const sessionsBySubject = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const subject of group.subjects) {
      const label = ensureSubPrefix(subject.subjectLabel);
      const sessions = sessionsBySubject.get(label) ?? new Set<string>();
      for (const session of subject.sessionLabels) sessions.add(session);
      sessionsBySubject.set(label, sessions);
    }
  }
  return {
    subjectCount: sessionsBySubject.size,
    subjectSessionCount: Array.from(sessionsBySubject.values()).reduce(
      (sum, sessions) => sum + sessions.size,
      0,
    ),
  };
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
  const importActive = useImportStore(
    (s) =>
      s.importRunning ||
      ["preparing", "running", "finalizing", "cancelling"].includes(s.importPhase),
  );

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
  const conflictingMemberships = useMemo(() => {
    const memberships = new Map<string, Set<string>>();
    for (const group of detectedGroups) {
      for (const subject of group.subjects) {
        for (const session of subject.sessionLabels) {
          const id = `${ensureSubPrefix(subject.subjectLabel)}_${session}`;
          const groupIds = memberships.get(id) ?? new Set<string>();
          groupIds.add(group.id);
          memberships.set(id, groupIds);
        }
      }
    }
    return [...memberships]
      .filter(([, groupIds]) => groupIds.size > 1)
      .map(([id]) => id)
      .sort();
  }, [detectedGroups]);

  // Local state for editable labels (only stores user edits)
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});
  const [labelErrors, setLabelErrors] = useState<Record<string, string>>({});
  const [retryCount, setRetryCount] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [continuing, setContinuing] = useState(false);
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
    return resolveLogicalSource(rootPath, persistedSourceDataPath, "bids");
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
    if (conflictingMemberships.length > 0 || !validateLabels()) return;

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
      showErrorNotification({
        id: `bids-review-confirm:${projectId}`,
        title: "BIDS review not confirmed",
        message: "BIDS review could not be confirmed. Stay on this page and try again.",
        error: err,
      });
    } finally {
      setConfirming(false);
    }
  }

  async function handleContinue() {
    const lease = captureProjectLease();
    const currentProject = useProjectStore.getState().project;
    const importing = useImportStore.getState();
    if (
      !currentProject ||
      !lease ||
      !isCurrentProjectLease(lease) ||
      !isProjectWorkAccepted() ||
      !canAccessPhase(currentProject, "parameters") ||
      importing.importRunning ||
      ["preparing", "running", "finalizing", "cancelling"].includes(importing.importPhase)
    ) {
      return;
    }
    setContinuing(true);
    try {
      await useProjectStore.getState().setPhase("parameters");
      if (!isCurrentProjectLease(lease)) return;
      await useProjectStore.getState().saveProject();
      if (!isCurrentProjectLease(lease)) return;
      navigate(`/project/${currentProject.projectMeta.id}/parameters`);
    } catch {
      // Shared save status retains the error; navigation stays here.
    } finally {
      setContinuing(false);
    }
  }

  const readOnly = bidsReviewConfirmed && !rescanMode;
  const reviewGroups = readOnly ? persistedGroups : detectedGroups;

  return (
    <Stack gap="md" className="bids-review-panel" data-testid="bids-review-panel">
      <HeaderCard
        icon={BIDSIcon}
        title="BIDS Review"
        subtitle={
          readOnly
            ? "Continue to Parameters, or re-scan to review changed source data."
            : "Review acquisition metadata and subject assignments before confirming."
        }
        color="blue"
        dataTestId="bids-review-header"
      />
      {renderContent()}
    </Stack>
  );

  function renderContent() {
    // Persisted summary takes priority over session-only scan state after reload.
    if (readOnly) return renderReview();
    if (!scanComplete && !scanError) {
      return (
        <>
          <Text size="sm" role="status" data-testid="bids-review-scan-status">
            Scanning BIDS metadata…
          </Text>
          <Skeleton height={40} data-testid="bids-review-scan-running" />
          <Skeleton height={100} data-testid="bids-review-scan-group-skeleton" />
          <Skeleton height={100} data-testid="bids-review-scan-details-skeleton" />
        </>
      );
    }
    if (scanError) {
      return (
        <>
          <Alert color="red" data-testid="bids-review-scan-error">
            <Text fw={500} data-testid="bids-review-scan-error-title">
              Scan failed
            </Text>
            <Text
              size="sm"
              style={{ whiteSpace: "pre-wrap" }}
              data-testid="bids-review-scan-error-message"
            >
              {scanError}
            </Text>
            {retryCount >= 2 && (
              <Text size="sm" mt="xs" c="dimmed" data-testid="bids-review-scan-error-hint">
                Persistent scan failure — check directory permissions or delete project and
                recreate.
              </Text>
            )}
          </Alert>
          {renderRecoveryActions()}
        </>
      );
    }
    if (detectedGroups.length === 0) {
      return (
        <>
          <Alert color="red" data-testid="bids-review-no-groups">
            <Text fw={500} data-testid="bids-review-no-groups-title">
              No ASL metadata groups detected
            </Text>
            <Text size="sm" data-testid="bids-review-no-groups-message">
              The scan completed but found no ASL metadata groups. Check that the directory contains
              valid ASL sidecars.
            </Text>
          </Alert>
          {renderSkippedWarning(skippedSubjects)}
          {renderRecoveryActions()}
        </>
      );
    }
    return renderReview();
  }

  function renderRecoveryActions() {
    return (
      <Group className="bids-review-actions" data-testid="bids-review-recovery-actions">
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
          onClick={rescanMode && bidsReviewConfirmed ? handleReturnToSummary : handleBackToLanding}
          data-testid="bids-review-back-btn"
        >
          {rescanMode && bidsReviewConfirmed ? "Back to Confirmed Summary" : "Back to Landing"}
        </Button>
      </Group>
    );
  }

  function renderReview() {
    const { subjectCount, subjectSessionCount } = countMemberships(reviewGroups);
    return (
      <>
        {readOnly && (
          <Alert
            color="blue"
            title="Confirmed · read-only"
            icon={<IconCheck size={16} />}
            data-testid="bids-review-readonly-banner"
          >
            BIDS metadata groups confirmed. Import is complete.
          </Alert>
        )}
        <div className="bids-review-summary" data-testid="bids-review-dataset-summary">
          {[
            ["subjects", "Subjects", subjectCount],
            ["subject-sessions", "Subject / session entries", subjectSessionCount],
            ["groups", "Metadata groups", reviewGroups.length],
          ].map(([id, label, count]) => (
            <Card key={id} withBorder p="md" data-testid={`bids-review-summary-${id}`}>
              <Text size="xs" c="dimmed" data-testid={`bids-review-summary-${id}-label`}>
                {label}
              </Text>
              <Text size="xl" fw={600} mt={4} data-testid={`bids-review-summary-${id}-count`}>
                {count}
              </Text>
            </Card>
          ))}
        </div>
        {!readOnly && conflictingMemberships.length > 0 && (
          <>
            <Alert
              color="red"
              role="alert"
              title="Conflicting acquisition groups"
              icon={<IconAlertTriangle size={16} />}
              data-testid="bids-review-group-conflict"
            >
              Different acquisition metadata places the same subject/session in multiple groups:
              <Text size="sm" ff="monospace" data-testid="bids-review-conflicting-memberships">
                {conflictingMemberships.join(", ")}
              </Text>
              This project supports one metadata group per subject/session, not per run. Renaming
              groups cannot resolve this conflict. Check the source metadata, then re-scan. Runs
              with genuinely different acquisition parameters cannot be confirmed together. Your
              previous project mapping is unchanged.
            </Alert>
            {renderRecoveryActions()}
          </>
        )}
        {renderParticipantsBanner()}
        {renderSkippedWarning(
          readOnly ? persistedSkippedSubjects : skippedSubjects,
          readOnly
            ? "To include them, add the missing file externally and click Re-scan BIDS."
            : undefined,
        )}
        {reviewGroups.map((group, index) =>
          renderGroupCard(group, readOnly, reviewGroups.length, index),
        )}
        <Group
          justify={readOnly ? "space-between" : "flex-end"}
          className="bids-review-actions"
          data-testid="bids-review-actions"
        >
          {readOnly ? (
            <>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={handleRescanConfirmedProject}
                disabled={continuing}
                data-testid="bids-review-rescan-btn"
              >
                Re-scan BIDS
              </Button>
              <Button
                color="blue"
                rightSection={<IconArrowRight size={16} />}
                onClick={() => void handleContinue()}
                loading={continuing}
                disabled={!project || !canAccessPhase(project, "parameters") || importActive}
                data-testid="bids-review-continue-btn"
              >
                Continue to Parameters
              </Button>
            </>
          ) : (
            <Button
              color="blue"
              leftSection={<IconCheck size={16} />}
              onClick={handleConfirm}
              loading={confirming}
              disabled={conflictingMemberships.length > 0}
              data-testid="bids-review-confirm-btn"
            >
              Confirm and continue
            </Button>
          )}
        </Group>
      </>
    );
  }

  // --- Helper renderers ---

  function renderParticipantsBanner() {
    if (!participantsTsvExists) return null;
    return (
      <Alert
        color="gray"
        variant="default"
        title="Your root participants.tsv stays unchanged"
        icon={<IconInfoCircle size={16} />}
        data-testid="bids-review-participants-banner"
      >
        <details
          className="bids-review-source-details"
          data-testid="bids-review-participants-details"
        >
          <summary data-testid="bids-review-participants-toggle">
            How processing uses participant data
          </summary>
          <Text size="sm" mt="xs" data-testid="bids-review-participants-explanation">
            Your existing{" "}
            <Text span ff="monospace" size="sm" data-testid="bids-review-participants-source-path">
              participants.tsv
            </Text>{" "}
            (at project root) is not modified by ExploreASL GUI. During processing, ExploreASL
            generates its own working copy at{" "}
            <Text span ff="monospace" size="sm" data-testid="bids-review-participants-working-path">
              derivatives/ExploreASL/participants.tsv
            </Text>{" "}
            and appends processing-derived columns (
            <Text span ff="monospace" size="xs" data-testid="bids-review-participants-site-column">
              site
            </Text>
            ,{" "}
            <Text span ff="monospace" size="xs" data-testid="bids-review-participants-gm-column">
              gm_vol
            </Text>
            ,{" "}
            <Text
              span
              ff="monospace"
              size="xs"
              data-testid="bids-review-participants-motion-column"
            >
              motion
            </Text>
            , etc.) there. Your root-level file stays as you authored it.
          </Text>
        </details>
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

  function renderGroupCard(
    group: DerivedMetadataGroup,
    readOnly: boolean,
    groupCount: number,
    index: number,
  ) {
    const label = readOnly ? group.label : getEffectiveLabel(group);
    const error = labelErrors[group.id];
    const { subjectCount, subjectSessionCount } = countMemberships([group]);
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
    const paramsSummary = [
      group.bidsParams.ArterialSpinLabelingType ?? group.bidsParams.LabelingType,
      group.bidsParams.MRAcquisitionType,
      group.bidsParams.M0Type ? `M0 ${group.bidsParams.M0Type}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <Card key={group.id} withBorder p="md" data-testid={`bids-group-card-${group.id}`}>
        <Stack gap="sm" data-testid={`bids-group-content-${group.id}`}>
          <Group justify="space-between" data-testid={`bids-group-heading-${group.id}`}>
            <Text
              size="xs"
              c="dimmed"
              fw={600}
              tt="uppercase"
              lts="0.08em"
              data-testid={`bids-group-number-${group.id}`}
            >
              Metadata group {String(index + 1).padStart(2, "0")}
            </Text>
            <Badge
              color="gray"
              variant="light"
              className="bids-review-tag"
              data-testid={`bids-group-status-${group.id}`}
            >
              {readOnly ? "Confirmed · read-only" : "Needs confirmation"}
            </Badge>
          </Group>
          <TextInput
            value={label}
            onChange={
              readOnly ? undefined : (e) => handleLabelChange(group.id, e.currentTarget.value)
            }
            readOnly={readOnly}
            label="Group label"
            error={error}
            data-testid={`bids-group-label-input-${group.id}`}
          />

          {error && (
            <Text c="red" size="xs" data-testid={`bids-group-error-${group.id}`}>
              {error}
            </Text>
          )}

          <Group gap="xs" data-testid={`bids-group-acquisition-${group.id}`}>
            <Badge
              color="gray"
              variant="light"
              className="bids-review-tag"
              data-testid={`bids-group-vendor-${group.id}`}
            >
              {formatVendor(group.vendor)}
            </Badge>
            {group.bidsParams.MagneticFieldStrength != null && (
              <Badge
                color="gray"
                variant="light"
                className="bids-review-tag"
                data-testid={`bids-group-field-strength-${group.id}`}
              >
                {formatParamValue(group.bidsParams.MagneticFieldStrength)} T
              </Badge>
            )}
            <Badge
              color="gray"
              variant="light"
              className="bids-review-tag"
              data-testid={`bids-group-sequence-${group.id}`}
            >
              {formatSequence(group.sequence)}
            </Badge>
            <Badge
              color="gray"
              variant="light"
              className="bids-review-tag"
              data-testid={`bids-group-labeling-${group.id}`}
            >
              {formatLabelingType(group.labelingType)}
            </Badge>
          </Group>

          <Text size="sm" data-testid={`bids-group-counts-${group.id}`}>
            {subjectCount} subject{subjectCount !== 1 ? "s" : ""} · {subjectSessionCount}{" "}
            subject/session {subjectSessionCount === 1 ? "entry" : "entries"}
          </Text>

          <Accordion
            variant="default"
            multiple
            defaultValue={paramsExpanded ? ["params", "subjects"] : []}
            className="bids-review-details"
            data-testid={`bids-group-details-${group.id}`}
          >
            <Accordion.Item value="params" data-testid={`bids-group-parameters-${group.id}`}>
              <Accordion.Control data-testid="bids-review-parameters-toggle">
                Parameters
                <Text
                  span
                  size="xs"
                  c="dimmed"
                  className="bids-review-detail-summary"
                  data-testid={`bids-group-parameters-summary-${group.id}`}
                >
                  {paramsEntries.length} fields{paramsSummary ? ` · ${paramsSummary}` : ""}
                </Text>
              </Accordion.Control>
              <Accordion.Panel data-testid={`bids-group-parameters-panel-${group.id}`}>
                <div
                  className="bids-review-parameters-scroll"
                  role="region"
                  aria-label={`${label} metadata parameters`}
                  tabIndex={0}
                  data-testid={`bids-group-parameters-scroll-${group.id}`}
                >
                  <Table
                    striped
                    className="bids-review-parameters-table"
                    data-testid={`bids-group-parameters-table-${group.id}`}
                  >
                    <Table.Tbody data-testid={`bids-group-parameters-body-${group.id}`}>
                      {paramsEntries.map(([key, value]) => (
                        <Table.Tr key={key} data-testid={`bids-group-parameter-${group.id}-${key}`}>
                          <Table.Th
                            scope="row"
                            fw={500}
                            data-testid={`bids-group-parameter-key-${group.id}-${key}`}
                          >
                            {key}
                          </Table.Th>
                          <Table.Td data-testid={`bids-group-parameter-value-${group.id}-${key}`}>
                            {key === "ASLContext"
                              ? summarizeAslContext(String(value ?? ""))
                              : formatParamValue(value)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="subjects" data-testid={`bids-group-subjects-${group.id}`}>
              <Accordion.Control data-testid="bids-review-subjects-toggle">
                Subjects ({subjectCount})
                <Text
                  span
                  size="xs"
                  c="dimmed"
                  className="bids-review-detail-summary"
                  data-testid={`bids-group-subjects-summary-${group.id}`}
                >
                  {subjectSessionCount} subject/session{" "}
                  {subjectSessionCount === 1 ? "entry" : "entries"}
                </Text>
              </Accordion.Control>
              <Accordion.Panel data-testid={`bids-group-subjects-panel-${group.id}`}>
                <Stack gap={4} data-testid={`bids-group-subject-list-${group.id}`}>
                  {sortedSubjects.map((subj) => (
                    <Group
                      key={subj.subjectLabel}
                      gap="xs"
                      data-testid={`bids-group-subject-${group.id}-${subj.subjectLabel}`}
                    >
                      <Text
                        size="sm"
                        ff="monospace"
                        data-testid={`bids-group-subject-label-${group.id}-${subj.subjectLabel}`}
                      >
                        {subj.subjectLabel}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        data-testid={`bids-group-subject-sessions-${group.id}-${subj.subjectLabel}`}
                      >
                        sessions:{" "}
                        {[...subj.sessionLabels].sort((a, b) => a.localeCompare(b)).join(", ")}
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
