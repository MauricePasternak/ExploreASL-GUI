import { Alert, Button, Group, Stack, Stepper, Text, useMantineColorScheme } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import ColumnTypes from "../components/visualization/ColumnTypes";
import FileSelection from "../components/visualization/FileSelection";
import LevelOrdering from "../components/visualization/LevelOrdering";
import VisualizeStep from "../components/visualization/VisualizeStep";
import { useVisualizationSync } from "../hooks/useVisualizationSync";
import { useProjectStore } from "../stores/projectStore";
import { useVisualizationStore } from "../stores/visualizationStore";

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

  const hasCategorical =
    inspection?.columns.some(
      (c) =>
        !c.isIdentifier && (columnTypes[c.name] === "ordinal" || columnTypes[c.name] === "nominal"),
    ) ?? false;

  const visibleSteps = ["selectFile", "columnTypes"];
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

    const handleFocus = () => scanStats();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [project?.projectMeta.rootPath, setAvailableFiles]);

  useEffect(() => {
    async function validateContract() {
      const currentProject = useProjectStore.getState().project;
      const sources = useVisualizationStore.getState().contractSources;
      if (!currentProject || sources.length === 0) return;
      for (const source of sources) {
        try {
          const result = await invoke<{
            columns: Array<{
              name: string;
              units: string;
              inferredType: string;
              levels: string[];
              isIdentifier: boolean;
            }>;
            rowCount: number;
            fileHash: string;
          }>("inspect_tsv", {
            projectRoot: currentProject.projectMeta.rootPath,
            relativePath: source.relativePath,
          });
          if (result.fileHash !== source.fileHash) {
            useVisualizationStore.getState().invalidateContract();
            setInvalidationBanner("Data file has changed. Please reconfigure.");
            return;
          }
          useVisualizationStore.getState().setInspection(result);
        } catch {
          useVisualizationStore.getState().invalidateContract();
          setInvalidationBanner(`File '${source.relativePath}' no longer exists.`);
          return;
        }
      }
    }
    validateContract();
  }, []);

  function handleNext() {
    if (stage === "selectFile") {
      setStage("columnTypes");
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
      setStage("selectFile");
    }
  }

  const nextDisabled =
    (stage === "selectFile" && !inspection) ||
    (stage === "columnTypes" && Object.values(columnTypes).every((t) => t === "excluded"));

  const nextLabel =
    stage === "selectFile"
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
      {invalidationBanner && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="invalidation-banner">
          {invalidationBanner}
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
        <Stepper.Step label="Select File" data-testid="step-select-file">
          <FileSelection />
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
