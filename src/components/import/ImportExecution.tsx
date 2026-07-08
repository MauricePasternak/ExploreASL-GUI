import { Alert, Badge, Button, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCopy,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Virtuoso } from "react-virtuoso";

import { runImportPipeline, setupImportListeners, stopImportProcess } from "../../lib/importEvents";
import { buildAllStagingMappings } from "../../lib/importPreviewUtils";
import { computeStaleness } from "../../lib/importStaleness";
import { readImportStatus } from "../../lib/importStatus";
import { assembleSourcestructure, assembleStudyPar } from "../../lib/tokenizerUtils";
import { useGlobalStore } from "../../stores/globalStore";
import { type ImportPhase, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";
import HeaderCard from "../common/HeaderCard";
import ProfileSelector from "../common/ProfileSelector";
import ImportSubjectTable from "./ImportSubjectTable";

const PHASE_META: Record<
  ImportPhase,
  { label: string; color: string; variant?: "light" | "filled" }
> = {
  idle: { label: "Idle", color: "gray" },
  preparing: { label: "Preparing", color: "blue" },
  running: { label: "Running", color: "blue", variant: "filled" },
  completed: { label: "Completed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "orange" },
};

function ImportExecutionHeader({ phase }: { phase: ImportPhase }) {
  const meta = PHASE_META[phase];

  return (
    <HeaderCard
      icon={IconPlayerPlay}
      title="Run Import Module"
      subtitle="Execute the ExploreASL import module and track per-subject progress."
      color="blue"
      dataTestId="import-execution-header"
      rightSection={
        <Badge
          color={meta.color}
          variant={meta.variant ?? "light"}
          size="lg"
          style={
            phase === "running"
              ? { boxShadow: "0 0 0 3px var(--mantine-color-blue-light)" }
              : undefined
          }
        >
          {meta.label}
        </Badge>
      }
    />
  );
}

function ImportExecutionControls({
  phase,
  canRun,
  onStart,
  onStop,
  noProfiles,
  selectedProfileId,
  onProfileChange,
  hasSelectedSubjects,
  profileError,
}: {
  phase: ImportPhase;
  canRun: boolean;
  onStart: () => void;
  onStop: () => void;
  noProfiles: boolean;
  selectedProfileId: string;
  onProfileChange: (id: string) => void;
  hasSelectedSubjects: boolean;
  profileError: string | null;
}) {
  return (
    <Stack gap="sm" data-testid="import-execution-controls">
      <Group align="flex-end">
        <ProfileSelector
          value={selectedProfileId}
          onChange={onProfileChange}
          disabled={phase === "running"}
          minWidth={300}
        />
        <Button
          leftSection={<IconPlayerPlay size={16} />}
          disabled={phase === "running" || !canRun || !hasSelectedSubjects || noProfiles}
          onClick={onStart}
          data-testid="start-import-btn"
        >
          Start Import
        </Button>
        <Button
          leftSection={<IconPlayerStop size={16} />}
          color="red"
          variant="light"
          disabled={phase !== "running"}
          onClick={onStop}
          data-testid="stop-import-btn"
        >
          Stop
        </Button>
      </Group>
      {noProfiles ? (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={16} />}
          p="xs"
          data-testid="no-profiles-alert"
        >
          <Text size="sm">No execution profiles configured. Add one in Settings.</Text>
        </Alert>
      ) : null}
      {profileError ? (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={16} />}
          p="xs"
          data-testid="profile-error-alert"
        >
          <Text size="sm">{profileError}</Text>
        </Alert>
      ) : null}
    </Stack>
  );
}

function ImportLogPanel({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = lines.join("\n");
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [lines]);

  if (lines.length === 0) {
    return (
      <Paper withBorder p="md" data-testid="import-log-empty">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Import log</Text>
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconCopy size={14} />}
              disabled
            >
              Copy
            </Button>
          </Group>
          <Text c="dimmed" size="sm">
            Waiting for import output...
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" data-testid="import-log-panel">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>Import log</Text>
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconCopy size={14} />}
            onClick={handleCopy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </Group>
        <div style={{ height: 300 }}>
          <Virtuoso
            data={lines}
            followOutput="smooth"
            itemContent={(_index, line) => (
              <div
                style={{
                  fontFamily: "var(--mantine-font-family-monospace)",
                  fontSize: "var(--mantine-font-size-xs)",
                  lineHeight: 1.4,
                  whiteSpace: "pre",
                  minHeight: "1.4em",
                }}
              >
                {line || "\u00A0"}
              </div>
            )}
          />
        </div>
      </Stack>
    </Paper>
  );
}

function ConfirmReimportDialog({
  opened,
  onClose,
  onConfirm,
  subjects,
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  subjects: string[];
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Re-import completed subject?"
      data-testid="confirm-reimport-dialog"
    >
      <Text size="sm">
        The following subjects appear to have completed successfully. Re-importing will overwrite
        their existing output.
      </Text>
      <ul>
        {subjects.map((subject) => (
          <li key={subject}>{subject}</li>
        ))}
      </ul>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose} data-testid="confirm-reimport-cancel">
          Cancel
        </Button>
        <Button color="orange" onClick={onConfirm} data-testid="confirm-reimport-confirm">
          Re-import anyway
        </Button>
      </Group>
    </Modal>
  );
}

export default function ImportExecution() {
  const navigate = useNavigate();
  const importPhase = useImportStore((state) => state.importPhase);
  const importProgress = useImportStore((state) => state.importProgress);
  const importLog = useImportStore((state) => state.importLog);
  const subjectRows = useImportStore((state) => state.subjectRows);
  const selectedProfileId = useImportStore((state) => state.selectedProfileId);
  const setSelectedProfileId = useImportStore((state) => state.setSelectedProfileId);
  const autoSelectProfile = useImportStore((state) => state.autoSelectProfile);
  const profileError = useImportStore((state) => state.profileError);
  const clearProfileError = useImportStore((state) => state.clearProfileError);
  const setActiveStep = useImportStore((state) => state.setActiveStep);
  const startImport = useImportStore((state) => state.startImport);
  const cancelImportAction = useImportStore((state) => state.cancelImport);
  const resetImportPhase = useImportStore((state) => state.resetImportPhase);
  const addLogLine = useImportStore((state) => state.addLogLine);
  const failImport = useImportStore((state) => state.failImport);
  const executionProfiles = useGlobalStore((state) => state.settings.executionProfiles);
  const profileValidationState = useGlobalStore((state) => state.profileValidationState);
  const backLocked = importPhase === "running";
  const progressRows = Object.values(importProgress).sort((left, right) =>
    left.subject.localeCompare(right.subject),
  );
  const hasSubjects = subjectRows.length > 0;
  const selectedId = selectedProfileId ?? "";
  const selectedProfileValid =
    selectedId.length > 0 && profileValidationState[selectedId]?.valid === true;
  const noProfiles = executionProfiles.length === 0;
  const canRun = selectedProfileValid && hasSubjects;

  const [prevImportProgress, setPrevImportProgress] = useState(importProgress);
  const [prevImportPhase, setPrevImportPhase] = useState(importPhase);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(() => {
    const subjects = Object.values(importProgress);
    if (subjects.length === 0) return [];
    if (importPhase === "idle" || importPhase === "failed" || importPhase === "cancelled") {
      const hasCompleted = subjects.some((s) => s.status === "completed");
      if (!hasCompleted) {
        return subjects.map((s) => s.subject);
      }
      const toSelect = subjects
        .filter(
          (s) =>
            s.stale ||
            s.status === "failed" ||
            s.status === "pending" ||
            s.status === "running" ||
            s.status === "cancelled",
        )
        .map((s) => s.subject);
      return toSelect.length > 0 ? toSelect : subjects.map((s) => s.subject);
    }
    return [];
  });
  const [confirmSubjects, setConfirmSubjects] = useState<string[] | null>(null);

  if (importProgress !== prevImportProgress || importPhase !== prevImportPhase) {
    setPrevImportProgress(importProgress);
    setPrevImportPhase(importPhase);

    const subjects = Object.values(importProgress);
    if (subjects.length > 0) {
      if (importPhase === "idle" || importPhase === "failed" || importPhase === "cancelled") {
        const hasCompleted = subjects.some((s) => s.status === "completed");

        if (!hasCompleted) {
          setSelectedSubjects(subjects.map((s) => s.subject));
        } else {
          const toSelect = subjects
            .filter(
              (s) =>
                s.stale ||
                s.status === "failed" ||
                s.status === "pending" ||
                s.status === "running" ||
                s.status === "cancelled",
            )
            .map((s) => s.subject);
          setSelectedSubjects(toSelect.length > 0 ? toSelect : subjects.map((s) => s.subject));
        }
      }
    }
  }

  useEffect(() => {
    autoSelectProfile();
  }, [autoSelectProfile, executionProfiles, profileValidationState]);

  useEffect(() => {
    clearProfileError();
  }, [selectedProfileId, clearProfileError]);

  const pidRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (importPhase === "running" || importPhase === "preparing") {
      return;
    }

    let cancelled = false;
    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) return;

    const store = useImportStore.getState();
    const subjects = [...new Set(store.subjectRows.map((r) => r.subject))];
    if (subjects.length === 0) return;

    readImportStatus(projectRoot)
      .then((statuses) => {
        if (cancelled) return;
        const currentStore = useImportStore.getState();
        if (currentStore.importPhase === "running" || currentStore.importPhase === "preparing")
          return;
        const staleness = computeStaleness(currentStore, currentStore.mostRecentConfig);
        currentStore.reconstructProgressFromLockFiles(statuses, subjects, staleness);
      })
      .catch((err) => {
        console.debug(
          "[ImportExecution] readImportStatus failed (stale reconstruction is best-effort):",
          err,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [importPhase]);

  const doRunImport = useCallback(
    async (subjectsToImport: string[]) => {
      const previousPhase = importPhase;

      const allProgress = Object.values(useImportStore.getState().importProgress);
      const succeededForRetry = allProgress
        .filter(
          (progress) =>
            progress.status === "completed" && !subjectsToImport.includes(progress.subject),
        )
        .map((progress) => progress.subject);

      if (previousPhase === "failed" || previousPhase === "cancelled") {
        resetImportPhase();
      }
      startImport();

      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath ?? "";
      const stagingRoot = `${projectRoot}/.easl_staging`;

      cleanupRef.current?.();
      cleanupRef.current = null;

      try {
        const cleanup = await setupImportListeners(stagingRoot, projectRoot, subjectsToImport);
        if (!isMountedRef.current) {
          cleanup();
          return;
        }
        cleanupRef.current = cleanup;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to set up import listeners";
        addLogLine(message);
        failImport();
        return;
      }

      try {
        const store = useImportStore.getState();
        const globalSettings = useGlobalStore.getState().settings;
        const globalState = useGlobalStore.getState();
        const profileId = store.selectedProfileId;
        const executionProfile = profileId ? globalState.getProfileById(profileId) : undefined;
        if (!executionProfile) {
          throw new Error("No execution profile selected.");
        }

        const subjectRenamesMap = Object.fromEntries(
          store.subjectRenames.map((r) => [r.original, r.target]),
        );
        const mappings = buildAllStagingMappings(
          store.rawPaths,
          store.sourceDataPath,
          store.pathPatterns,
          store.tokenizerConfigs,
          subjectRenamesMap,
          store.sessionAliases,
          store.modalityAliases,
          globalSettings.tokenSubDelimiters,
        );
        const stagingEntries = mappings.flatMap((m) => m.entries);

        const sourcestructureJson = assembleSourcestructure(
          store.sessionAliases,
          store.runAliases,
          store.modalityAliases,
          store.bMatchDirectories,
        ) as Record<string, unknown>;

        const studyparJson = assembleStudyPar(store.metadataGroups, store.subjectRows) as Record<
          string,
          unknown
        >;

        const subjectList = subjectsToImport;

        if (succeededForRetry.length > 0) {
          addLogLine(
            `Preserving lock files for previously-completed subjects: ${succeededForRetry.join(", ")}`,
          );
        }

        const pid = await runImportPipeline({
          projectRoot,
          stagingEntries,
          sourcestructureJson,
          studyparJson,
          executionProfile,
          subjectList,
          subjectsToPreserve: succeededForRetry.length > 0 ? succeededForRetry : undefined,
        });

        pidRef.current = pid;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start import";
        addLogLine(message);
        failImport();
      }
    },
    [importPhase, resetImportPhase, startImport, addLogLine, failImport],
  );

  const handleStartImport = useCallback(() => {
    const progress = useImportStore.getState().importProgress;
    const subjectsToImport =
      selectedSubjects.length > 0
        ? selectedSubjects
        : [...new Set(useImportStore.getState().subjectRows.map((r) => r.subject))];

    const freshlyCompleted = subjectsToImport.filter(
      (s) => progress[s]?.status === "completed" && progress[s]?.stale !== true,
    );

    if (freshlyCompleted.length > 0) {
      setConfirmSubjects(freshlyCompleted);
    } else {
      void doRunImport(subjectsToImport);
    }
  }, [selectedSubjects, doRunImport]);

  const handleConfirmReimport = useCallback(() => {
    setConfirmSubjects(null);
    const subjectsToImport =
      selectedSubjects.length > 0
        ? selectedSubjects
        : [...new Set(useImportStore.getState().subjectRows.map((r) => r.subject))];
    void doRunImport(subjectsToImport);
  }, [selectedSubjects, doRunImport]);

  const handleCancelReimport = useCallback(() => {
    setConfirmSubjects(null);
  }, []);

  const handleStop = useCallback(() => {
    if (pidRef.current !== null) {
      void stopImportProcess(pidRef.current).catch((err) => {
        console.warn("[ImportExecution] stopImportProcess failed:", err);
      });
      pidRef.current = null;
    }
    cancelImportAction();
  }, [cancelImportAction]);

  const advanceToParameters = () => {
    const project = useProjectStore.getState().project;
    if (project) {
      useProjectStore.getState().setPhase("parameters");
      void useProjectStore.getState().saveProject();
      navigate(`/project/${project.projectMeta.id}/parameters`);
    }
  };

  return (
    <Stack gap="md" data-testid="import-execution">
      <ImportExecutionHeader phase={importPhase} />

      <ImportExecutionControls
        phase={importPhase}
        canRun={canRun}
        onStart={handleStartImport}
        onStop={handleStop}
        noProfiles={noProfiles}
        selectedProfileId={selectedId}
        onProfileChange={setSelectedProfileId}
        profileError={profileError}
        hasSelectedSubjects={
          selectedSubjects.length > 0 ||
          (Object.keys(importProgress).length === 0 && subjectRows.length > 0)
        }
      />

      {!canRun ? (
        <Text c="dimmed" size="sm">
          {selectedProfileValid
            ? "Stage at least one subject before running import."
            : "Select a valid execution profile in Settings before running import."}
        </Text>
      ) : null}

      {subjectRows.length === 0 ? (
        <Paper withBorder p="md">
          <Text c="dimmed" size="sm">
            No subjects are staged for import yet.
          </Text>
        </Paper>
      ) : null}

      <ImportSubjectTable
        rows={progressRows}
        selectedSubjects={selectedSubjects}
        onSelectedSubjectsChange={setSelectedSubjects}
      />
      <ImportLogPanel lines={importLog} />

      <ConfirmReimportDialog
        opened={confirmSubjects !== null}
        onClose={handleCancelReimport}
        onConfirm={handleConfirmReimport}
        subjects={confirmSubjects ?? []}
      />

      <Group
        justify="space-between"
        pos="sticky"
        bottom={40}
        style={{
          zIndex: 2,
          paddingTop: "var(--mantine-spacing-md)",
          paddingBottom: "var(--mantine-spacing-md)",
          backgroundColor: "var(--mantine-color-body)",
          boxShadow: "0 -4px 6px -1px rgba(0, 0, 0, 0.06)",
        }}
        data-testid="import-execution-nav"
      >
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          disabled={backLocked}
          onClick={() => setActiveStep(4)}
          data-testid="import-back-btn"
        >
          Back: Preview
        </Button>
        <Button
          onClick={advanceToParameters}
          disabled={importPhase === "running"}
          data-testid="import-next-params-btn"
        >
          Next: Parameters
        </Button>
      </Group>
    </Stack>
  );
}
