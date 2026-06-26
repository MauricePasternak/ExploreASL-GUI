import { Alert, Button, Group, Stack, Stepper, Text, useMantineColorScheme } from "@mantine/core";
import { IconAlertCircle, IconChartDots } from "@tabler/icons-react";
import HeaderCard from "../components/HeaderCard";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import ColumnTypes from "../components/visualization/ColumnTypes";
import DataSelection from "../components/visualization/DataSelection";
import LevelOrdering from "../components/visualization/LevelOrdering";
import VisualizeStep from "../components/visualization/VisualizeStep";
import { useVisualizationSync } from "../hooks/useVisualizationSync";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";

interface FileStats {
  mtime: string;
  size: number;
}

interface DataInspection {
  columns: Array<{
    name: string;
    originalName: string;
    source: "qcbf" | "external";
    units: string;
    inferredType: string;
    levels: string[];
    isIdentifier: boolean;
  }>;
  rowCount: number;
  qcbfHash: string;
  externalHash: string | null;
}

export default function VisualizationPage() {
  useVisualizationSync();
  const { colorScheme } = useMantineColorScheme();

  const stage = useVisualizationStore((s) => s.stage);
  const setStage = useVisualizationStore((s) => s.setStage);
  const inspection = useVisualizationStore((s) => s.inspection);
  const columnTypes = useVisualizationStore((s) => s.columnTypes);
  const setAvailableFiles = useVisualizationStore((s) => s.setAvailableFiles);

  const project = useProjectStore((s) => s.project);
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
    async function scanStats() {
      if (!project) return;
      try {
        const files = await invoke<
          Array<{ fileName: string; relativePath: string; size: number; modified: string }>
        >("list_stats_files", { projectRoot: project.projectMeta.rootPath });
        setAvailableFiles(files);
        if (files.length === 0) {
          setStatsError("No statistics files found in Population/Stats.");
        } else {
          setStatsError(null);
        }
      } catch {
        setStatsError("Population Stats not found. Population may have been modified externally.");
      }
    }
    scanStats();

    const handleFocus = async () => {
      await scanStats();

      const joinConfig = useVisualizationStore.getState().joinConfig;
      const qcbfSource = useVisualizationStore.getState().qcbfSource;
      const currentProject = useProjectStore.getState().project;
      if (!joinConfig || !qcbfSource || !currentProject) return;

      // Step 1: Stat external file mtime (cheap, no full read)
      let stats: FileStats;
      try {
        stats = await invoke<FileStats>("stat_file", {
          path: joinConfig.externalSource.absolutePath,
        });
      } catch {
        // File deleted mid-session
        useVisualizationStore.getState().setJoinConfig(null);
        const filename =
          joinConfig.externalSource.absolutePath.split("/").pop() ??
          joinConfig.externalSource.absolutePath;
        setInvalidationBanner(`External file '${filename}' no longer exists.`);
        // Re-run load_qcbf_data to revert to qCBF-only
        try {
          const result = await invoke<DataInspection>("load_qcbf_data", {
            projectRoot: currentProject.projectMeta.rootPath,
            relativePath: qcbfSource.relativePath,
          });
          useVisualizationStore.getState().setInspection(result);
          const types: Record<string, string> = {};
          for (const col of result.columns) {
            types[col.name] = col.inferredType;
          }
          useVisualizationStore.getState().setColumnTypes(types);
          useVisualizationStore.getState().setLevelOrderings({});
          useVisualizationStore.getState().setAxisAssignment({ x: null, y: null, colorBy: null });
        } catch {
          // qCBF file also gone — full invalidation
          useVisualizationStore.getState().invalidateContract();
        }
        return;
      }

      // Step 2: Compare mtime — skip if unchanged
      const lastMtime = useVisualizationStore.getState()._lastExtMtime;
      if (lastMtime && stats.mtime === lastMtime) return;
      useVisualizationStore.getState()._setLastExtMtime(stats.mtime);

      // Step 3: mtime changed — re-run execute_join to get fresh hash
      try {
        const result = await invoke<DataInspection>("execute_join", {
          projectRoot: currentProject.projectMeta.rootPath,
          qcbfRelativePath: qcbfSource.relativePath,
          externalAbsolutePath: joinConfig.externalSource.absolutePath,
          keys: joinConfig.keys,
          dropRightOn: joinConfig.dropRightOn,
          naTokens: joinConfig.naTokens,
          sheetName: joinConfig.externalSource.sheetName,
          delimiter: joinConfig.delimiter === "auto" ? null : joinConfig.delimiter,
        });

        // Step 4: Compare external hash
        if (result.externalHash !== joinConfig.externalSource.fileHash) {
          // Content changed — invalidate join, revert to qCBF-only
          useVisualizationStore.getState().setJoinConfig(null);
          const qcbfOnlyResult = await invoke<DataInspection>("load_qcbf_data", {
            projectRoot: currentProject.projectMeta.rootPath,
            relativePath: qcbfSource.relativePath,
          });
          useVisualizationStore.getState().setInspection(qcbfOnlyResult);
          const types: Record<string, string> = {};
          for (const col of qcbfOnlyResult.columns) {
            types[col.name] = col.inferredType;
          }
          useVisualizationStore.getState().setColumnTypes(types);
          useVisualizationStore.getState().setLevelOrderings({});
          useVisualizationStore.getState().setAxisAssignment({ x: null, y: null, colorBy: null });
          setInvalidationBanner(
            "External data file has changed. Join configuration has been reset.",
          );
        } else {
          // Content identical (file was touched but unchanged) — update inspection with fresh merged data
          useVisualizationStore.getState().setInspection(result);
        }
      } catch {
        // execute_join failed (e.g., file became unreadable) — invalidate join
        useVisualizationStore.getState().setJoinConfig(null);
        setInvalidationBanner(
          "External data file could not be read. Join configuration has been reset.",
        );
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [project, setAvailableFiles]);

  useEffect(() => {
    async function validateContract() {
      const currentProject = useProjectStore.getState().project;
      const qcbfSource = useVisualizationStore.getState().qcbfSource;
      const joinConfig = useVisualizationStore.getState().joinConfig;
      if (!currentProject || !qcbfSource) return;

      if (joinConfig) {
        // Join-active path: call execute_join
        try {
          const result = await invoke<{
            columns: Array<{
              name: string;
              originalName: string;
              source: "qcbf" | "external";
              units: string;
              inferredType: string;
              levels: string[];
              isIdentifier: boolean;
            }>;
            rowCount: number;
            qcbfRowCount: number;
            qcbfHash: string;
            externalHash: string | null;
          }>("execute_join", {
            projectRoot: currentProject.projectMeta.rootPath,
            qcbfRelativePath: qcbfSource.relativePath,
            externalAbsolutePath: joinConfig.externalSource.absolutePath,
            keys: joinConfig.keys,
            dropRightOn: joinConfig.dropRightOn,
            naTokens: joinConfig.naTokens,
            sheetName: joinConfig.externalSource.sheetName,
            delimiter: joinConfig.delimiter,
          });
          if (result.qcbfHash !== qcbfSource.fileHash) {
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner("Data file has changed. Please reconfigure.");
            return;
          }
          if (result.externalHash !== joinConfig.externalSource.fileHash) {
            useVisualizationStore.getState().setJoinConfig(null);
            setInvalidationBanner(
              "External data file has changed. Join configuration has been reset.",
            );
            return;
          }
          useVisualizationStore.getState().setInspection(result);
        } catch {
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
          return;
        }
      } else {
        // qCBF-only path: call load_qcbf_data
        try {
          const result = await invoke<{
            columns: Array<{
              name: string;
              originalName: string;
              source: "qcbf" | "external";
              units: string;
              inferredType: string;
              levels: string[];
              isIdentifier: boolean;
            }>;
            rowCount: number;
            qcbfRowCount: number;
            qcbfHash: string;
            externalHash: string | null;
          }>("load_qcbf_data", {
            projectRoot: currentProject.projectMeta.rootPath,
            relativePath: qcbfSource.relativePath,
          });
          if (result.qcbfHash !== qcbfSource.fileHash) {
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner("Data file has changed. Please reconfigure.");
            return;
          }
          useVisualizationStore.getState().setInspection(result);
        } catch {
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${qcbfSource.relativePath}' no longer exists.`);
          return;
        }
      }
    }
    validateContract();
  }, []);

  async function handleSelectDataNext() {
    const joinConfig = useVisualizationStore.getState().joinConfig;
    const qcbfSource = useVisualizationStore.getState().qcbfSource;
    const project = useProjectStore.getState().project;
    if (!project || !qcbfSource) return;

    if (
      joinConfig &&
      joinConfig.keys.length > 0 &&
      joinConfig.keys.every((k) => k.left && k.right)
    ) {
      // Join active: call execute_join to produce merged schema
      try {
        const result = await invoke<{
          columns: Array<{
            name: string;
            originalName: string;
            source: "qcbf" | "external";
            units: string;
            inferredType: string;
            levels: string[];
            isIdentifier: boolean;
          }>;
          rowCount: number;
          qcbfRowCount: number;
          qcbfHash: string;
          externalHash: string | null;
        }>("execute_join", {
          projectRoot: project.projectMeta.rootPath,
          qcbfRelativePath: qcbfSource.relativePath,
          externalAbsolutePath: joinConfig.externalSource.absolutePath,
          keys: joinConfig.keys,
          dropRightOn: joinConfig.dropRightOn,
          naTokens: joinConfig.naTokens,
          sheetName: joinConfig.externalSource.sheetName,
          delimiter: joinConfig.delimiter === "auto" ? null : joinConfig.delimiter,
        });
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
    (stage === "selectData" && !inspection) ||
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
      h="calc(100vh - 128px)"
      style={{ overflow: "hidden" }}
    >
      <HeaderCard
        icon={IconChartDots}
        title="Visualization"
        subtitle="Filter and plot ROI results against clinical parameters using dynamic, interactive charts."
        color="orange"
        dataTestId="visualization-header"
      />
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
          root: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
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
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
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
