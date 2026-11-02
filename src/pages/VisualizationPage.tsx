import {
  Alert,
  Button,
  Code,
  Group,
  Stack,
  Stepper,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import { IconAlertCircle, IconChartDots } from "@tabler/icons-react";
import { commands, unwrap } from "../lib/ipc";
import type { FileStats } from "../generated/bindings";
import { useEffect, useState } from "react";
import HeaderCard from "../components/common/HeaderCard";

import ColumnTypes from "../components/visualization/ColumnTypes";
import DataSelection from "../components/visualization/DataSelection";
import LevelOrdering from "../components/visualization/LevelOrdering";
import VisualizeStep from "../components/visualization/VisualizeStep";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";
import { visualizationSettings, acceptedVisualizationSettings } from "../stores/visualizationStore";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";

export default function VisualizationPage() {
  const { colorScheme } = useMantineColorScheme();

  const stage = useProjectStore((s) => visualizationSettings(s.project).stage);
  const setStage = useVisualizationStore((s) => s.setStage);
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useProjectStore((s) => visualizationSettings(s.project).columnTypes);
  const setAvailableFiles = useVisualizationStore((s) => s.setAvailableFiles);
  const joinConfig = useProjectStore((s) => visualizationSettings(s.project).joinConfig);
  const externalSourceAvailability = useVisualizationStore((s) => s.externalSourceAvailability);

  const projectRoot = useProjectStore((s) => s.project?.projectMeta.rootPath);
  const [invalidationBanner, setInvalidationBanner] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasCategorical =
    inspection?.columns.some(
      (c) =>
        !c.isIdentifier && (columnTypes[c.name] === "ordinal" || columnTypes[c.name] === "nominal"),
    ) ?? false;

  const visibleSteps = ["selectData", "columnTypes"];
  if (hasCategorical) visibleSteps.push("levelOrdering");
  visibleSteps.push("visualize");
  const activeStep = visibleSteps.indexOf(stage);

  useEffect(() => {
    const lease = captureProjectLease();
    const isCurrent = () => !lease || isCurrentProjectLease(lease);
    async function scanStats() {
      if (!projectRoot) return;
      try {
        const files = await unwrap(commands.listStatsFiles(projectRoot));
        if (!isCurrent()) return;
        setAvailableFiles(files);
        if (files.length === 0) {
          setStatsError("No statistics files found in Population/Stats.");
        } else {
          setStatsError(null);
        }
      } catch {
        if (!isCurrent()) return;
        setStatsError("Population Stats not found. Population may have been modified externally.");
      }
    }
    scanStats();

    const handleFocus = async () => {
      await scanStats();
      if (!isCurrent()) return;

      const { joinConfig, qcbfSource } = acceptedVisualizationSettings();
      const currentProject = useProjectStore.getState().project;
      if (!joinConfig || !qcbfSource || !currentProject) return;

      const loadQcbfOnly = async () => {
        const result = await unwrap(
          commands.loadQcbfData(currentProject.projectMeta.rootPath, qcbfSource.relativePath),
        );
        if (!isCurrent()) return null;
        if (result.qcbfHash !== qcbfSource.fileHash) {
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner("Data file has changed. Please reconfigure.");
          return null;
        }
        useVisualizationStore.getState().setInspection(result);
        return result;
      };

      // Step 1: Stat external file mtime (cheap, no full read)
      let stats: FileStats;
      try {
        stats = await unwrap(commands.statFile(joinConfig.externalSource.absolutePath));
        if (!isCurrent()) return;
      } catch {
        if (!isCurrent()) return;
        useVisualizationStore.getState().setExternalSourceAvailability({
          status: "missing",
          savedPath: joinConfig.externalSource.absolutePath,
          message:
            "The saved external visualization file is missing. Relink it to restore joined data.",
        });
        try {
          await loadQcbfOnly();
        } catch {
          if (!isCurrent()) return;
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
        }
        return;
      }

      // Step 2: Compare mtime — skip if unchanged
      const lastMtime = useVisualizationStore.getState()._lastExtMtime;
      if (lastMtime && stats.mtime === lastMtime) return;
      useVisualizationStore.getState()._setLastExtMtime(stats.mtime);

      // Step 3: mtime changed — re-run execute_join to get fresh hash
      try {
        const result = await unwrap(
          commands.executeJoin(
            currentProject.projectMeta.rootPath,
            qcbfSource.relativePath,
            joinConfig.externalSource.absolutePath,
            joinConfig.keys,
            joinConfig.dropRightOn,
            joinConfig.naTokens,
            joinConfig.externalSource.sheetName,
            joinConfig.delimiter === "auto" ? null : joinConfig.delimiter,
          ),
        );
        if (!isCurrent()) return;

        // Step 4: Compare external hash
        if (result.externalHash !== joinConfig.externalSource.fileHash) {
          useVisualizationStore.getState().setExternalSourceAvailability({
            status: "changed",
            savedPath: joinConfig.externalSource.absolutePath,
            message:
              "External data content changed. Relink and confirm before resetting dependent visualization setup.",
          });
          await loadQcbfOnly();
        } else {
          useVisualizationStore.getState().setExternalSourceAvailability({
            status: "available",
            savedPath: joinConfig.externalSource.absolutePath,
            message: null,
          });
          useVisualizationStore.getState().setInspection(result);
        }
      } catch {
        if (!isCurrent()) return;
        useVisualizationStore.getState().setExternalSourceAvailability({
          status: "unreadable",
          savedPath: joinConfig.externalSource.absolutePath,
          message:
            "The saved external visualization file is unreadable. Relink it to restore joined data.",
        });
        try {
          await loadQcbfOnly();
        } catch {
          if (!isCurrent()) return;
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [projectRoot, setAvailableFiles]);

  useEffect(() => {
    const lease = captureProjectLease();
    const isCurrent = () => !lease || isCurrentProjectLease(lease);
    async function validateContract() {
      const currentProject = useProjectStore.getState().project;
      const { qcbfSource, joinConfig } = acceptedVisualizationSettings();
      if (!currentProject || !qcbfSource) return;

      if (joinConfig) {
        // Join-active path: call execute_join
        try {
          const result = await unwrap(
            commands.executeJoin(
              currentProject.projectMeta.rootPath,
              qcbfSource.relativePath,
              joinConfig.externalSource.absolutePath,
              joinConfig.keys,
              joinConfig.dropRightOn,
              joinConfig.naTokens,
              joinConfig.externalSource.sheetName,
              joinConfig.delimiter,
            ),
          );
          if (!isCurrent()) return;
          if (result.qcbfHash !== qcbfSource.fileHash) {
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner("Data file has changed. Please reconfigure.");
            return;
          }
          if (result.externalHash !== joinConfig.externalSource.fileHash) {
            useVisualizationStore.getState().setExternalSourceAvailability({
              status: "changed",
              savedPath: joinConfig.externalSource.absolutePath,
              message:
                "External data content changed. Relink and confirm before resetting dependent visualization setup.",
            });
            const qcbfOnly = await unwrap(
              commands.loadQcbfData(currentProject.projectMeta.rootPath, qcbfSource.relativePath),
            );
            if (!isCurrent()) return;
            useVisualizationStore.getState().setInspection(qcbfOnly);
            return;
          }
          useVisualizationStore.getState().setExternalSourceAvailability({
            status: "available",
            savedPath: joinConfig.externalSource.absolutePath,
            message: null,
          });
          useVisualizationStore.getState().setInspection(result);
        } catch {
          if (!isCurrent()) return;
          try {
            const qcbfOnly = await unwrap(
              commands.loadQcbfData(currentProject.projectMeta.rootPath, qcbfSource.relativePath),
            );
            if (!isCurrent()) return;
            if (qcbfOnly.qcbfHash !== qcbfSource.fileHash) {
              useVisualizationStore.getState().invalidateContract();
              setInvalidationBanner("Data file has changed. Please reconfigure.");
              return;
            }
            useVisualizationStore.getState().setInspection(qcbfOnly);
            useVisualizationStore.getState().setExternalSourceAvailability({
              status: "unreadable",
              savedPath: joinConfig.externalSource.absolutePath,
              message:
                "The saved external visualization file is missing or unreadable. Relink it to restore joined data.",
            });
          } catch {
            if (!isCurrent()) return;
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
          }
          return;
        }
      } else {
        // qCBF-only path: call load_qcbf_data
        try {
          const result = await unwrap(
            commands.loadQcbfData(currentProject.projectMeta.rootPath, qcbfSource.relativePath),
          );
          if (!isCurrent()) return;
          if (result.qcbfHash !== qcbfSource.fileHash) {
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner("Data file has changed. Please reconfigure.");
            return;
          }
          useVisualizationStore.getState().setInspection(result);
        } catch {
          if (!isCurrent()) return;
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
          return;
        }
      }
    }
    validateContract();
  }, []);

  async function handleSelectDataNext() {
    const lease = captureProjectLease();
    const { joinConfig, qcbfSource } = acceptedVisualizationSettings();
    const project = useProjectStore.getState().project;
    if (!project || !qcbfSource) return;

    if (
      joinConfig &&
      joinConfig.keys.length > 0 &&
      joinConfig.keys.every((k) => k.left && k.right)
    ) {
      // Join active: call execute_join to produce merged schema
      try {
        const result = await unwrap(
          commands.executeJoin(
            project.projectMeta.rootPath,
            qcbfSource.relativePath,
            joinConfig.externalSource.absolutePath,
            joinConfig.keys,
            joinConfig.dropRightOn,
            joinConfig.naTokens,
            joinConfig.externalSource.sheetName,
            joinConfig.delimiter === "auto" ? null : joinConfig.delimiter,
          ),
        );
        if (lease && !isCurrentProjectLease(lease)) return;
        useVisualizationStore.getState().setInspection(result);
        // Reset column types, level orderings, axis assignment (schema changed)
        const types: Record<string, string> = {};
        for (const col of result.columns) {
          types[col.name] = col.inferredType;
        }
        useVisualizationStore.getState().setColumnTypes(types);
        useVisualizationStore.getState().setLevelOrderings({});
        useVisualizationStore.getState().setAxisAssignment({ x: null, y: null, colorBy: null });
        useVisualizationStore.getState().setStage("columnTypes");
      } catch (err) {
        if (lease && !isCurrentProjectLease(lease)) return;
        setError(`Join failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    } else {
      // No join: advance directly, inspection already set by load_qcbf_data
      useVisualizationStore.getState().setStage("columnTypes");
    }
  }

  async function handleNext() {
    if (stage === "selectData") {
      await handleSelectDataNext();
    } else if (stage === "columnTypes") {
      if (hasCategorical) {
        setStage("levelOrdering");
      } else {
        setStage("visualize");
      }
    } else if (stage === "levelOrdering") {
      setStage("visualize");
    }
  }

  function handleBack() {
    if (stage === "visualize") {
      setStage(hasCategorical ? "levelOrdering" : "columnTypes");
    } else if (stage === "levelOrdering") {
      setStage("columnTypes");
    } else if (stage === "columnTypes") {
      setStage("selectData");
    }
  }

  const nextDisabled =
    (stage === "selectData" &&
      (!inspection ||
        (joinConfig !== null && externalSourceAvailability.status !== "available"))) ||
    (stage === "columnTypes" && Object.values(columnTypes).every((t) => t === "excluded"));

  const nextLabel =
    stage === "selectData"
      ? "Next"
      : stage === "columnTypes"
        ? hasCategorical
          ? "Next"
          : "Visualize"
        : stage === "levelOrdering"
          ? "Visualize"
          : "Next";

  if (statsError) {
    return (
      <Stack data-testid="visualization-page" p="md">
        <Alert icon={<IconAlertCircle size={16} />} color="yellow" data-testid="stats-error">
          {statsError}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack
      data-testid="visualization-page"
      p="md"
      h={stage === "visualize" ? undefined : "calc(100vh - 128px)"}
      mih="calc(100vh - 128px)"
      style={{
        flexShrink: stage === "visualize" ? 0 : undefined,
        overflowX: stage === "visualize" ? "clip" : "hidden",
        overflowY: stage === "visualize" ? "visible" : "hidden",
      }}
    >
      <HeaderCard
        icon={IconChartDots}
        title="Visualization"
        subtitle="Filter and plot ROI results against clinical parameters using dynamic, interactive charts."
        color="orange"
        dataTestId="visualization-header"
      />

      {["missing", "unreadable", "changed"].includes(externalSourceAvailability.status) && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="yellow"
          title="External visualization data unavailable"
          data-testid="visualization-missing-source-warning"
        >
          <Stack gap="xs">
            <Text size="sm">{externalSourceAvailability.message}</Text>
            <Code data-testid="visualization-missing-source-path">
              {externalSourceAvailability.savedPath}
            </Code>
            {stage !== "selectData" && (
              <Button
                variant="light"
                onClick={() => setStage("selectData")}
                data-testid="visualization-relink-btn"
              >
                Relink
              </Button>
            )}
          </Stack>
        </Alert>
      )}
      {invalidationBanner && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="invalidation-banner">
          {invalidationBanner}
        </Alert>
      )}
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="join-error">
          {error}
        </Alert>
      )}

      <Stepper
        active={activeStep}
        data-testid="visualization-stepper"
        styles={{
          root: {
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: stage === "visualize" ? "auto" : 0,
          },
          steps: {
            paddingBottom: "var(--mantine-spacing-md)",
            borderBottom: colorScheme === "dark" ? "1px solid #373a40" : "1px solid #e9ecef",
            boxShadow:
              colorScheme === "dark"
                ? "0 4px 6px -1px rgba(0, 0, 0, 0.3)"
                : "0 4px 6px -1px rgba(0, 0, 0, 0.03)",
            zIndex: 10,
          },
          content: {
            flex: 1,
            minHeight: stage === "visualize" ? "auto" : 0,
            display: "flex",
            flexDirection: "column",
            overflow: stage === "visualize" ? "visible" : "auto",
            paddingRight: "16px",
            paddingLeft: "4px",
            paddingTop: "var(--mantine-spacing-md)",
          },
        }}
      >
        <Stepper.Step label="Select Data" data-testid="step-select-data">
          <DataSelection />
        </Stepper.Step>
        <Stepper.Step label="Column Types" data-testid="step-column-types">
          <ColumnTypes />
        </Stepper.Step>
        {hasCategorical && (
          <Stepper.Step label="Level Ordering" data-testid="step-level-ordering">
            <LevelOrdering />
          </Stepper.Step>
        )}
        <Stepper.Step label="Visualize" data-testid="step-visualize">
          <VisualizeStep />
        </Stepper.Step>
      </Stepper>

      <Group
        justify={activeStep > 0 ? "space-between" : "flex-end"}
        mt="md"
        data-testid="dataviz-stepper-buttons-group"
        style={{
          borderTop: colorScheme === "dark" ? "1px solid #373a40" : "1px solid #e9ecef",
          boxShadow:
            colorScheme === "dark"
              ? "0 -4px 6px -1px rgba(0, 0, 0, 0.3)"
              : "0 -4px 6px -1px rgba(0, 0, 0, 0.03)",
          paddingTop: "var(--mantine-spacing-md)",
          zIndex: 10,
        }}
      >
        {activeStep > 0 && (
          <Button variant="default" onClick={handleBack} data-testid="stepper-back-btn">
            Back
          </Button>
        )}
        {activeStep < visibleSteps.length - 1 && (
          <Button onClick={handleNext} disabled={nextDisabled} data-testid="stepper-next-btn">
            {nextLabel}
          </Button>
        )}
      </Group>

      {stage === "columnTypes" && nextDisabled && (
        <Text c="red" size="sm" data-testid="all-excluded-message">
          All columns excluded. Include at least one to proceed.
        </Text>
      )}
    </Stack>
  );
}
