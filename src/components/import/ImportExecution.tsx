import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import { useNavigate } from "react-router";

import {
  copyLockFilesForRetry,
  runImportPipeline,
  setupImportListeners,
  stopImportProcess,
} from "../../lib/importEvents";
import { buildAllStagingMappings } from "../../lib/importPreviewUtils";
import { assembleSourcestructure, assembleStudyPar } from "../../lib/tokenizerUtils";
import type { ImportProgress } from "../../schemas/importSchemas";
import { useGlobalStore } from "../../stores/globalStore";
import { type ImportPhase, useImportStore } from "../../stores/importStore";
import { useProjectStore } from "../../stores/projectStore";

const PHASE_META: Record<ImportPhase, { label: string; color: string; variant?: "light" | "filled" }> = {
  idle: { label: "Idle", color: "gray" },
  preparing: { label: "Preparing", color: "blue" },
  running: { label: "Running", color: "blue", variant: "filled" },
  completed: { label: "Completed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "orange" },
};

const STATUS_META: Record<ImportProgress["status"], { label: string; color: string }> = {
  pending: { label: "Pending", color: "gray" },
  running: { label: "Running", color: "blue" },
  completed: { label: "Completed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "orange" },
};

function formatDuration(seconds?: number) {
  if (seconds === undefined) {
    return "—";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function ImportExecutionHeader({ phase }: { phase: ImportPhase }) {
  const meta = PHASE_META[phase];

  return (
    <Group justify="space-between" align="flex-start">
      <div>
        <Title order={3}>Run Import Module</Title>
        <Text c="dimmed" size="sm">
          Execute the ExploreASL import module and track per-subject progress.
        </Text>
      </div>
      <Badge
        color={meta.color}
        variant={meta.variant ?? "light"}
        size="lg"
        style={phase === "running" ? { boxShadow: "0 0 0 3px var(--mantine-color-blue-light)" } : undefined}
      >
        {meta.label}
      </Badge>
    </Group>
  );
}

function ImportExecutionControls({
  phase,
  canRun,
  onRun,
  onStop,
}: {
  phase: ImportPhase;
  canRun: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const runAllowedByPhase = phase === "idle" || phase === "failed" || phase === "cancelled";
  const showRetry = phase === "failed" || phase === "cancelled";

  return (
    <Group>
      <Button
        leftSection={<IconPlayerPlay size={16} />}
        disabled={!runAllowedByPhase || !canRun}
        onClick={onRun}
      >
        Run Import
      </Button>
      <Button
        leftSection={<IconPlayerStop size={16} />}
        color="red"
        variant="light"
        disabled={phase !== "running"}
        onClick={onStop}
      >
        Stop
      </Button>
      {showRetry ? (
        <Button
          leftSection={<IconRefresh size={16} />}
          variant="light"
          disabled={!canRun}
          onClick={onRun}
        >
          Retry Import
        </Button>
      ) : null}
    </Group>
  );
}

function ImportProgressTable({ rows }: { rows: ImportProgress[] }) {
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Paper withBorder p="md">
        <Text c="dimmed" size="sm">
          Progress will appear here when import preparation starts.
        </Text>
      </Paper>
    );
  }

  return (
    <Table withTableBorder withColumnBorders verticalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Subject</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Step</Table.Th>
          <Table.Th>Duration</Table.Th>
          <Table.Th>Error</Table.Th>
          <Table.Th>Details</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => {
          const status = STATUS_META[row.status];
          const isExpanded = expandedSubject === row.subject;
          const hasDetails = Boolean(row.error || row.warnings?.length);
          const detailId = `import-progress-details-${row.subject}`;

          return (
            <Fragment key={row.subject}>
              <Table.Tr>
                <Table.Td>{row.subject}</Table.Td>
                <Table.Td>
                  <Badge color={status.color} variant={row.status === "running" ? "filled" : "light"}>
                    {status.label}
                  </Badge>
                </Table.Td>
                <Table.Td>{row.currentStep ?? row.errorStep ?? "—"}</Table.Td>
                <Table.Td>{formatDuration(row.duration)}</Table.Td>
                <Table.Td>{row.error ?? "—"}</Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!hasDetails}
                    aria-controls={detailId}
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedSubject(isExpanded ? null : row.subject)}
                  >
                    {isExpanded ? `Hide details for ${row.subject}` : `Show details for ${row.subject}`}
                  </Button>
                </Table.Td>
              </Table.Tr>
              {isExpanded ? (
                <Table.Tr id={detailId}>
                  <Table.Td colSpan={6} p={0}>
                    <Stack gap="xs" p="sm">
                      {row.error ? (
                        <div>
                          <Text fw={600} size="sm">Full error detail</Text>
                          <Text size="sm">{row.error}</Text>
                        </div>
                      ) : null}
                      {row.warnings?.length ? (
                        <div>
                          <Text fw={600} size="sm">Warnings</Text>
                          {row.warnings.map((warning) => (
                            <Text key={warning} size="sm">{warning}</Text>
                          ))}
                        </div>
                      ) : null}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Fragment>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function ImportLogPanel({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Text fw={600}>Import log</Text>
        <div ref={scrollRef} style={{ maxHeight: 180, overflow: "auto" }}>
          <Code block>{lines.length > 0 ? lines.join("\n") : "Waiting for import output..."}</Code>
        </div>
      </Stack>
    </Paper>
  );
}

function ImportSummary({
  phase,
  rows,
  onRetry,
  onNextParameters,
}: {
  phase: ImportPhase;
  rows: ImportProgress[];
  onRetry: () => void;
  onNextParameters: () => void;
}) {
  const succeeded = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;

  return (
    <Card withBorder p="md">
      <Group justify="space-between">
        <div>
          <Text fw={600}>Import summary</Text>
          <Text size="sm">Succeeded: {succeeded}</Text>
          <Text size="sm">Failed: {failed}</Text>
        </div>
        {phase === "completed" ? (
          <Button onClick={onNextParameters}>Next: Parameters</Button>
        ) : null}
        {phase === "failed" ? (
          <Button leftSection={<IconRefresh size={16} />} variant="light" onClick={onRetry}>
            Retry Import
          </Button>
        ) : null}
      </Group>
    </Card>
  );
}

export default function ImportExecution() {
  const navigate = useNavigate();
  const importPhase = useImportStore((state) => state.importPhase);
  const importProgress = useImportStore((state) => state.importProgress);
  const importLog = useImportStore((state) => state.importLog);
  const importCompleted = useImportStore((state) => state.importCompleted);
  const subjectRows = useImportStore((state) => state.subjectRows);
  const setActiveStep = useImportStore((state) => state.setActiveStep);
  const startImport = useImportStore((state) => state.startImport);
  const cancelImportAction = useImportStore((state) => state.cancelImport);
  const resetImportPhase = useImportStore((state) => state.resetImportPhase);
  const addLogLine = useImportStore((state) => state.addLogLine);
  const failImport = useImportStore((state) => state.failImport);
  const settings = useGlobalStore((state) => state.settings);
  const backLocked = importPhase === "running";
  const progressRows = Object.values(importProgress).sort((left, right) => left.subject.localeCompare(right.subject));
  const hasMatlab = settings.matlabInstallations.some((installation) => installation.path.trim().length > 0);
  const hasExploreAsl = settings.exploreAslPath.trim().length > 0;
  const hasSubjects = subjectRows.length > 0;
  const canRun = hasMatlab && hasExploreAsl && hasSubjects;

  const pidRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Set up event listeners when entering "preparing" phase, clean up on unmount or terminal phase
  useEffect(() => {
    if (importPhase !== "preparing") return;

    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath ?? "";
    const stagingRoot = `${projectRoot}/.easl_staging`;
    const allSubjects = [
      ...new Set(useImportStore.getState().subjectRows.map((r) => r.subject)),
    ];

    let cancelled = false;

    void setupImportListeners(stagingRoot, projectRoot, allSubjects).then(
      (cleanup) => {
        if (cancelled) {
          cleanup();
        } else {
          cleanupRef.current = cleanup;
        }
      },
    );

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [importPhase]);

  const runImport = useCallback(() => {
    const previousPhase = importPhase;
    const succeededForRetry =
      previousPhase === "failed" || previousPhase === "cancelled"
        ? Object.values(useImportStore.getState().importProgress)
            .filter((progress) => progress.status === "completed")
            .map((progress) => progress.subject)
        : [];

    if (previousPhase === "failed" || previousPhase === "cancelled") {
      resetImportPhase();
    }
    startImport();

    // Launch Tauri import pipeline asynchronously
    const launchPipeline = async () => {
      try {
        const store = useImportStore.getState();
        const globalSettings = useGlobalStore.getState().settings;
        const projectRoot =
          useProjectStore.getState().project?.projectMeta.rootPath ?? "";

        // Build staging entries from the full mapping pipeline
        const subjectRenamesMap = Object.fromEntries(
          store.subjectRenames.map((r) => [r.original, r.target]),
        );
        const mappings = buildAllStagingMappings(
          store.rawPaths,
          store.sourceDataPath,
          store.pathPatterns,
          store.tokenizerConfigs,
          subjectRenamesMap,
          store.modalityAliases,
          globalSettings.tokenSubDelimiters,
        );
        const stagingEntries = mappings.flatMap((m) => m.entries);

        // Build sourcestructure.json and studyPar.json
        const sourcestructureJson = assembleSourcestructure(
          store.sessionAliases,
          store.runAliases,
          store.modalityAliases,
          store.bMatchDirectories,
        ) as Record<string, unknown>;

        const studyparJson = assembleStudyPar(
          store.metadataGroups,
        ) as Record<string, unknown>;

        const matlabPath = globalSettings.matlabInstallations[0]?.path ?? "";
        const exploreaslPath = globalSettings.exploreAslPath;
        const subjectList = [
          ...new Set(store.subjectRows.map((r) => r.subject)),
        ];
        const stagingRoot = `${projectRoot}/.easl_staging`;

        if (succeededForRetry.length > 0) {
          await copyLockFilesForRetry({
            projectRoot,
            stagingRoot,
            subjects: succeededForRetry,
          });
        }

        const pid = await runImportPipeline({
          projectRoot,
          stagingEntries,
          sourcestructureJson,
          studyparJson,
          matlabPath,
          exploreaslPath,
          subjectList,
        });

        pidRef.current = pid;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start import";
        addLogLine(message);
        failImport();
      }
    };

    void launchPipeline();
  }, [importPhase, resetImportPhase, startImport, addLogLine, failImport]);

  const handleStop = useCallback(() => {
    if (pidRef.current !== null) {
      void stopImportProcess(pidRef.current).catch(() => {});
      pidRef.current = null;
    }
    cancelImportAction();
  }, [cancelImportAction]);

  const advanceToParameters = () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState((state) => {
      if (!state.project || state.project.projectMeta.currentPhase === "parameters") {
        return state;
      }

      return {
        project: {
          ...state.project,
          projectMeta: {
            ...state.project.projectMeta,
            currentPhase: "parameters",
            lastOpened: new Date().toISOString(),
          },
        },
        isDirty: true,
      };
    });
    if (project) {
      navigate(`/project/${project.projectMeta.id}/parameters`);
    }
  };

  return (
    <Stack gap="md">
      <ImportExecutionHeader phase={importPhase} />

      <ImportExecutionControls
        phase={importPhase}
        canRun={canRun}
        onRun={runImport}
        onStop={handleStop}
      />

      {!canRun ? (
        <Text c="dimmed" size="sm">
          {hasMatlab && hasExploreAsl
            ? "Stage at least one subject before running import."
            : "Configure MATLAB and ExploreASL paths in settings before running import."}
        </Text>
      ) : null}

      {subjectRows.length === 0 ? (
        <Paper withBorder p="md">
          <Text c="dimmed" size="sm">
            No subjects are staged for import yet.
          </Text>
        </Paper>
      ) : null}

      <ImportProgressTable rows={progressRows} />
      <ImportLogPanel lines={importLog} />

      {importCompleted || importPhase === "completed" || importPhase === "failed" ? (
        <ImportSummary
          phase={importPhase}
          rows={progressRows}
          onRetry={runImport}
          onNextParameters={advanceToParameters}
        />
      ) : null}

      <Group justify="space-between">
        <Button
          leftSection={<IconArrowLeft size={16} />}
          variant="light"
          disabled={backLocked}
          onClick={() => setActiveStep(4)}
        >
          Back: Preview
        </Button>
      </Group>
    </Stack>
  );
}
