import { Box, Paper, Stack, Text } from "@mantine/core";
import { useEffect } from "react";
import { useVisualizationStore } from "../../stores/visualizationStore";
import { useProjectStore } from "../../stores/projectStore";

import AxisAssignment from "./AxisAssignment";
import ChartPanel from "./ChartPanel";
import SettingsDrawer from "./SettingsDrawer";
import ScanComparisonPanel from "./ScanComparisonPanel";
import "./Visualization.css";

export default function VisualizeStep() {
  const mode = useVisualizationStore((s) => s.companionMode);
  const sourceKey = useProjectStore((s) =>
    JSON.stringify([
      s.project?.projectMeta.rootPath,
      s.project?.uiState.dataVis?.qcbfSource,
      s.project?.uiState.dataVis?.joinConfig,
    ]),
  );
  useEffect(() => () => useVisualizationStore.getState().resetComparison(), [sourceKey]);

  return (
    <Stack data-testid="dataviz-visualize-step" className="dataviz-workspace" gap="xs">
      <SettingsDrawer />
      <Box
        data-testid="dataviz-panel-group"
        className="dataviz-panels"
        data-companion={mode !== "off"}
      >
        <Paper
          id="chart-panel"
          data-testid="dataviz-chart-panel"
          className="dataviz-panel dataviz-chart"
          withBorder
          p="md"
        >
          <Text component="h2" size="md" fw={600} m={0} data-testid="dataviz-chart-heading">
            Population statistics
          </Text>
          <AxisAssignment />
          <Box className="dataviz-plot" data-testid="dataviz-plot">
            <ChartPanel />
          </Box>
        </Paper>
        <Box id="viewer-panel" data-testid="dataviz-viewer-panel" className="dataviz-panel">
          <ScanComparisonPanel key={sourceKey} />
        </Box>
      </Box>
    </Stack>
  );
}
