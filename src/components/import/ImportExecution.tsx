import { Alert, Badge, Button, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCopy,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Virtuoso } from "react-virtuoso";

import {
  attachImportRun,
  cancelImportRun,
  confirmImportWorkerStopped,
  getActiveImportRun,
  launchImportRun,
  reserveImportRun,
  setupImportDiscoveryListeners,
  setupImportListeners,
} from "../../lib/importEvents";
import { buildImportPlan, selectImportEntries } from "../../lib/importPlan";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
} from "../../lib/projectLifecycle";
import {
  reconcileCommittedImportStatus,
  reconcileImportTerminal,
} from "../../lib/importTerminalCoordinator";
import { resolveLogicalSource } from "../../lib/projectPaths";
import { useGlobalStore } from "../../stores/globalStore";
import { type ImportPhase, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import HeaderCard from "../common/HeaderCard";
import ProfileSelector from "../common/ProfileSelector";
import ImportSubjectTable from "./ImportSubjectTable";

const PHASE_META: Record<ImportPhase, { label: string; color: string }> = {
  idle: { label: "Idle", color: "gray" },
  preparing: { label: "Preparing", color: "blue" },
  running: { label: "Running", color: "blue" },
  finalizing: { label: "Finalizing", color: "violet" },
  completed: { label: "Completed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelling: { label: "Cancelling", color: "orange" },
  cancelled: { label: "Cancelled", color: "orange" },
  interrupted: { label: "Interrupted", color: "yellow" },
};
const ACTIVE: ImportPhase[] = ["preparing", "running", "finalizing", "cancelling"];

interface RelocationPlan {
  planId: string;
  subjects: Array<{
    subject: string;
    entries: Array<{ path: string; kind: "file" | "directory"; bytes: number }>;
    fileCount: number;
    byteTotal: number;
    sessions: string[];
    fingerprint: string;
  }>;
  fingerprint: string;
}

function importPlan(projectRoot: string) {
  const store = useImportStore.getState();
  const sourceRoot = resolveLogicalSource(projectRoot, store.sourceDataPath, "dicom");
  return buildImportPlan({
    rawPaths: store.rawPaths,
    sourceRoot,
    pathPatterns: store.pathPatterns,
    tokenizerConfigs: store.tokenizerConfigs,
    subjectRenames: store.subjectRenames,
    sessionAliases: store.sessionAliases,
    runAliases: store.runAliases,
    modalityAliases: store.modalityAliases,
    tokenSubDelimiters: useGlobalStore.getState().settings.tokenSubDelimiters,
    bMatchDirectories: store.bMatchDirectories,
    metadataGroups: store.metadataGroups,
    subjectRows: store.subjectRows,
  });
}

function ImportLogPanel({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    const text = lines.join("\n");
    try {
      await writeText(text);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [lines]);

  return (
    <Paper withBorder p="sm" data-testid="import-log-panel">
      <Group justify="space-between">
        <Text fw={600}>Import log</Text>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconCopy size={14} />}
          onClick={() => void copy()}
          disabled={lines.length === 0}
          data-testid="copy-import-log"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </Group>
      {lines.length === 0 ? (
        <Text c="dimmed" size="sm" data-testid="import-log-empty">
          Waiting for import output…
        </Text>
      ) : (
        <div style={{ height: 300 }} data-testid="import-log-lines">
          <Virtuoso
            data={lines}
            followOutput="smooth"
            itemContent={(_index, line) => (
              <Text size="xs" ff="monospace" style={{ whiteSpace: "pre" }}>
                {line || "\u00a0"}
              </Text>
            )}
          />
        </div>
      )}
    </Paper>
  );
}

export default function ImportExecution() {
  const navigate = useNavigate();
  const phase = useImportStore((state) => state.importPhase);
  const progress = useImportStore((state) => state.importProgress);
  const log = useImportStore((state) => state.importLog);
  const activeRunId = useImportStore((state) => state.activeRunId);
  const terminalRunId = useImportStore((state) => state.terminalRunId);
  const confirmationRequired = useImportStore((state) => state.confirmationRequired);
  const runError = useImportStore((state) => state.importRunError);
  const summary = useImportStore((state) => state.importSummary);
  const stagingIssues = useImportStore((state) => state.stagingPreflight.issues);
  const subjectRows = useImportStore((state) => state.subjectRows);
  const selectedProfileId = useImportStore((state) => state.selectedProfileId);
  const setSelectedProfileId = useImportStore((state) => state.setSelectedProfileId);
  const profileError = useImportStore((state) => state.profileError);
  const sourceAvailability = useImportStore((state) => state.sourceAvailability);
  const setActiveStep = useImportStore((state) => state.setActiveStep);
  const validation = useGlobalStore((state) => state.profileValidationState);
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const effectiveProfileId =
    selectedProfileId ??
    executionProfiles.find((profile) => validation[profile.id]?.valid)?.id ??
    null;
  const [discovery, setDiscovery] = useState<"loading" | "ready" | "error">(() =>
    captureProjectLease() ? "loading" : "ready",
  );
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [selectedSubjectOverride, setSelectedSubjectOverride] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const confirmingStoppedRunId = useImportStore((state) => state.confirmingStoppedRunId);
  const confirmingStoppedGeneration = useImportStore((state) => state.confirmingStoppedGeneration);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    subjects: string[];
    plan: RelocationPlan;
  } | null>(null);
  const rows = useMemo(
    () => Object.values(progress).sort((a, b) => a.subject.localeCompare(b.subject)),
    [progress],
  );
  const selectedSubjects = useMemo(
    () =>
      selectedSubjectOverride ??
      (rows.length > 0
        ? rows
            .filter((row) => row.status !== "completed" || row.stale === true)
            .map((row) => row.subject)
        : [...new Set(subjectRows.map((row) => row.subject))]),
    [rows, selectedSubjectOverride, subjectRows],
  );
  const cleanupRef = useRef<(() => void) | null>(null);

  const bindListeners = useCallback(async (runId: string) => {
    cleanupRef.current?.();
    const cleanup = await setupImportListeners(runId);
    cleanupRef.current = cleanup;
    return cleanup;
  }, []);

  useEffect(() => {
    let disposed = false;
    const lease = captureProjectLease();
    if (!lease)
      return () => {
        disposed = true;
      };
    const discover = async () => {
      try {
        const listeners = await setupImportDiscoveryListeners(lease);
        cleanupRef.current = listeners.cleanup;
        if (disposed || !isCurrentProjectLease(lease)) {
          listeners.cleanup();
          return;
        }
        const run = await getActiveImportRun();
        if (disposed || !lease || !isCurrentProjectLease(lease)) return;
        if (run) {
          useImportStore.getState().bindImportRunSnapshot(run);
          listeners.bindRun(run.runId);
          const attached = await attachImportRun(run.runId);
          if (disposed || !isCurrentProjectLease(lease)) {
            listeners.cleanup();
            return;
          }
          useImportStore.getState().reconcileImportRunSnapshot(attached, lease);
          if (["completed", "failed", "cancelled", "interrupted"].includes(attached.lifecycle)) {
            void reconcileImportTerminal(attached.runId, lease).catch(() => undefined);
          }
        } else {
          await reconcileCommittedImportStatus(lease);
        }
        if (!disposed) setDiscovery("ready");
      } catch (error) {
        if (!disposed) {
          setDiscoveryError(error instanceof Error ? error.message : String(error));
          setDiscovery("error");
        }
      }
    };
    void discover();
    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [bindListeners]);

  const startAttempt = useCallback(
    async (confirmed?: { subjects: string[]; plan: RelocationPlan }) => {
      if (starting || discovery !== "ready" || activeRunId) return;
      const lease = captureProjectLease();
      if (!lease || !isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
      if (!useImportStore.getState().selectedProfileId) {
        useImportStore.getState().autoSelectProfile();
      }
      const profile = effectiveProfileId
        ? useGlobalStore.getState().getProfileById(effectiveProfileId)
        : undefined;
      if (!profile || !validation[profile.id]?.valid) return;
      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (!projectRoot) return;
      const subjects =
        confirmed?.subjects ??
        (selectedSubjects.length > 0
          ? selectedSubjects
          : [...new Set(subjectRows.map((row) => row.subject))]);
      if (subjects.length === 0) return;
      setStarting(true);
      try {
        const relocation =
          confirmed?.plan ??
          (await invoke<RelocationPlan>("plan_import_relocation", { subjectList: subjects }));
        if (!isCurrentProjectLease(lease)) return;
        const selectedFreshSubject = subjects.some((subject) => {
          const entry = useImportStore.getState().importProgress[subject];
          return entry?.status === "completed" && entry.stale !== true;
        });
        if (
          !confirmed &&
          (selectedFreshSubject || relocation.subjects.some((subject) => subject.fileCount > 0))
        ) {
          setPendingConfirmation({ subjects: [...subjects], plan: relocation });
          return;
        }
        const preservedSubjects = Object.values(useImportStore.getState().importProgress)
          .filter((entry) => entry.status === "completed" && !subjects.includes(entry.subject))
          .map((entry) => entry.subject);
        const reserved = await reserveImportRun({
          subjectList: subjects,
          relocationPlanId: relocation.planId,
          profileId: profile.id,
          subjectsToPreserve: preservedSubjects,
          preserveStaging: useGlobalStore.getState().settings.import.preserveStagingDir,
        });
        if (!isCurrentProjectLease(lease)) return;
        useImportStore.getState().startImport(subjects);
        useImportStore.getState().bindImportRunSnapshot(reserved);
        await bindListeners(reserved.runId);
        if (!isCurrentProjectLease(lease)) return;
        const attached = await attachImportRun(reserved.runId);
        if (!isCurrentProjectLease(lease)) return;
        useImportStore.getState().reconcileImportRunSnapshot(attached);
        const plan = importPlan(projectRoot);
        const launched = await launchImportRun({
          runId: reserved.runId,
          stagingEntries: selectImportEntries(plan.entries, subjects),
          sourcestructureJson: plan.sourcestructureJson,
          studyparJson: plan.studyparJson,
          executionProfile: profile,
          subjectList: subjects,
          relocationPlanId: relocation.planId,
        });
        if (!isCurrentProjectLease(lease)) return;
        useImportStore.getState().reconcileImportRunSnapshot(launched);
        if (["completed", "failed", "cancelled", "interrupted"].includes(launched.lifecycle)) {
          void reconcileImportTerminal(launched.runId, lease).catch(() => undefined);
        }
      } catch (error) {
        useImportStore.setState({
          importRunError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setStarting(false);
      }
    },
    [
      activeRunId,
      bindListeners,
      discovery,
      effectiveProfileId,
      selectedSubjects,
      starting,
      subjectRows,
      validation,
    ],
  );

  // Admission and launch span several awaits. Track the whole sequence so a
  // project transition drains it before native root replacement.
  const start = useCallback(
    (confirmed?: { subjects: string[]; plan: RelocationPlan }) => {
      try {
        return registerProjectTask(() => startAttempt(confirmed));
      } catch (error) {
        useImportStore.setState({
          importRunError: error instanceof Error ? error.message : String(error),
        });
        return Promise.resolve();
      }
    },
    [startAttempt],
  );

  const stop = useCallback(async () => {
    if (!activeRunId) return;
    const lease = captureProjectLease();
    if (!lease || !isCurrentProjectLease(lease) || !isProjectWorkAccepted()) return;
    setStopping(true);
    try {
      await registerProjectTask(async () => {
        const snapshot = await cancelImportRun(activeRunId);
        if (!isCurrentProjectLease(lease)) return;
        useImportStore.getState().reconcileImportRunSnapshot(snapshot, lease);
        if (["completed", "failed", "cancelled", "interrupted"].includes(snapshot.lifecycle)) {
          await reconcileImportTerminal(snapshot.runId, lease);
        }
      });
    } catch (error) {
      if (isCurrentProjectLease(lease)) {
        useImportStore.setState({
          importRunError: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setStopping(false);
    }
  }, [activeRunId]);

  const confirmStopped = useCallback(async () => {
    if (!terminalRunId || !confirmationRequired) return;
    const lease = captureProjectLease();
    if (!lease || !isCurrentProjectLease(lease)) return;
    const runId = terminalRunId;
    if (confirmingStoppedRunId === runId && confirmingStoppedGeneration === lease.generation)
      return;
    useImportStore.setState({
      confirmingStoppedRunId: runId,
      confirmingStoppedGeneration: lease.generation,
    });
    try {
      await registerProjectTask(async () => {
        const snapshot = await confirmImportWorkerStopped(runId);
        if (!isCurrentProjectLease(lease)) return;
        const current = useImportStore.getState();
        if (current.terminalRunId !== runId || !current.confirmationRequired) return;
        useImportStore.getState().reconcileImportRunSnapshot(snapshot, lease);
        await reconcileImportTerminal(snapshot.runId, lease);
      });
    } catch (error) {
      const current = useImportStore.getState();
      if (
        isCurrentProjectLease(lease) &&
        current.terminalRunId === runId &&
        current.confirmationRequired
      ) {
        useImportStore.setState({
          importRunError: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      const current = useImportStore.getState();
      if (
        current.confirmingStoppedRunId === runId &&
        current.confirmingStoppedGeneration === lease.generation
      ) {
        useImportStore.setState({
          confirmingStoppedRunId: null,
          confirmingStoppedGeneration: null,
        });
      }
    }
  }, [confirmationRequired, confirmingStoppedGeneration, confirmingStoppedRunId, terminalRunId]);

  const locked = ACTIVE.includes(phase) || discovery !== "ready";
  const runAdmissionLocked = locked || terminalRunId !== null;
  const profileValid = Boolean(effectiveProfileId && validation[effectiveProfileId]?.valid);
  const sourceAvailable = ["available", "unconfigured"].includes(sourceAvailability.status);
  const meta = PHASE_META[phase];
  return (
    <Stack gap="md" data-testid="import-execution">
      <HeaderCard
        icon={IconPlayerPlay}
        title="Run Import Module"
        subtitle="Native verification and relocation determine completion."
        color="blue"
        dataTestId="import-execution-header"
        rightSection={
          <Badge color={meta.color} size="lg" data-testid="import-lifecycle-badge">
            {meta.label}
          </Badge>
        }
      />
      {discovery === "loading" ? (
        <Alert data-testid="import-discovery-loading">Checking native import work…</Alert>
      ) : null}
      {discoveryError ? (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={16} />}
          data-testid="import-discovery-error"
        >
          {discoveryError}
        </Alert>
      ) : null}
      {runError ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid="import-run-error">
          {runError}
        </Alert>
      ) : null}
      {stagingIssues.length > 0 ? (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={16} />}
          data-testid="import-staging-issues"
        >
          <Stack gap={2}>
            {stagingIssues.map((issue, index) => (
              <Text key={`${issue.code}-${issue.entryIndex ?? index}`} size="sm">
                {issue.field}: {issue.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {phase === "finalizing" ? (
        <Alert color="violet" data-testid="import-finalizing-message">
          Verifying completion evidence and relocating output. Do not close this project.
        </Alert>
      ) : null}
      {phase === "interrupted" ? (
        <Alert color="yellow" data-testid="import-interrupted-message">
          Previous native import was interrupted. Check operating-system process tools for MATLAB or
          Apptainer before confirming workers stopped. Staging remains preserved.
          {confirmationRequired ? (
            <Button
              mt="sm"
              color="yellow"
              onClick={() => void confirmStopped()}
              disabled={
                confirmingStoppedRunId === terminalRunId &&
                confirmingStoppedGeneration === captureProjectLease()?.generation
              }
              data-testid="confirm-import-stopped-btn"
            >
              I confirmed worker stopped
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {summary ? (
        <Paper withBorder p="sm" data-testid="import-terminal-summary">
          <Text>
            Committed: {summary.succeeded}; failed: {summary.failed}
          </Text>
        </Paper>
      ) : null}
      <Group align="flex-end" data-testid="import-execution-controls">
        <ProfileSelector
          value={effectiveProfileId ?? ""}
          onChange={setSelectedProfileId}
          disabled={runAdmissionLocked}
          minWidth={300}
        />
        <Button
          leftSection={<IconPlayerPlay size={16} />}
          onClick={() => void start()}
          disabled={
            runAdmissionLocked ||
            starting ||
            !profileValid ||
            !sourceAvailable ||
            selectedSubjects.length === 0
          }
          data-testid="start-import-btn"
        >
          Start Import
        </Button>
        <Button
          leftSection={<IconPlayerStop size={16} />}
          color="red"
          variant="light"
          onClick={() => void stop()}
          disabled={phase !== "running" || stopping}
          data-testid="stop-import-btn"
        >
          Stop
        </Button>
      </Group>
      {profileError ? (
        <Alert color="red" data-testid="profile-error-alert">
          {profileError}
        </Alert>
      ) : null}
      {executionProfiles.length === 0 ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid="no-profiles-alert">
          No execution profiles configured. Add one in Settings.
        </Alert>
      ) : null}
      {!sourceAvailable ? (
        <Alert color="red" data-testid="import-source-unavailable-alert">
          Saved DICOM source is unavailable. Relink it before starting import.
        </Alert>
      ) : null}
      <ImportSubjectTable
        rows={rows}
        selectedSubjects={selectedSubjects}
        onSelectedSubjectsChange={setSelectedSubjectOverride}
        selectionLocked={runAdmissionLocked}
      />
      <ImportLogPanel lines={log} />
      <Modal
        opened={pendingConfirmation !== null}
        onClose={() => setPendingConfirmation(null)}
        title="Replace existing imported data?"
        data-testid="confirm-reimport-dialog"
      >
        <Text size="sm">
          Re-importing replaces complete selected subject output. Native verification still decides
          which replacements commit.
        </Text>
        <Stack gap="xs" mt="sm" data-testid="relocation-inventory">
          {pendingConfirmation?.plan.subjects.map((subject) => (
            <details key={subject.subject} data-testid={`relocation-inventory-${subject.subject}`}>
              <summary>
                {subject.subject}: {subject.fileCount} files, {subject.byteTotal} bytes
                {subject.sessions.length > 0 ? `, ${subject.sessions.join(", ")}` : ""}
              </summary>
              <ul>
                {subject.entries.map((entry) => (
                  <li key={entry.path}>{entry.path}</li>
                ))}
              </ul>
            </details>
          ))}
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => setPendingConfirmation(null)}
            data-testid="confirm-reimport-cancel"
          >
            Cancel
          </Button>
          <Button
            color="orange"
            onClick={() => {
              const confirmation = pendingConfirmation;
              setPendingConfirmation(null);
              if (confirmation) void start(confirmation);
            }}
            data-testid="confirm-reimport-confirm"
          >
            Replace and import
          </Button>
        </Group>
      </Modal>
      <Group justify="space-between" data-testid="import-execution-nav">
        <Button
          leftSection={<IconArrowLeft size={16} />}
          disabled={locked}
          onClick={() => setActiveStep(4)}
          data-testid="import-back-btn"
        >
          Back: Preview
        </Button>
        <Button
          disabled={locked}
          onClick={() => {
            const project = useProjectStore.getState().project;
            if (project) {
              useProjectStore.getState().setPhase("parameters");
              void useProjectStore.getState().saveProject();
              navigate(`/project/${project.projectMeta.id}/parameters`);
            }
          }}
          data-testid="import-next-params-btn"
        >
          Next: Parameters
        </Button>
      </Group>
    </Stack>
  );
}
