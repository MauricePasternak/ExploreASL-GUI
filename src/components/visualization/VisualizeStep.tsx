import { Box, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import AxisAssignment from "./AxisAssignment";
import ChartPanel from "./ChartPanel";
import FilterPanel from "./FilterPanel";
import NiftiViewer from "./NiftiViewer";

/** Below this width, stack chart above viewer so the chart gets full width. */
const STACK_BREAKPOINT = "(max-width: 63.9375em)";

const panelStyle = {
  minWidth: 0,
  minHeight: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  overflow: "visible" as const,
};

export default function VisualizeStep() {
  const isStacked = useMediaQuery(STACK_BREAKPOINT) ?? false;

  return (
    <Stack
      data-testid="visualize-step"
      flex={1}
      h="100%"
      gap="xs"
      style={{ minHeight: 0, width: "100%" }}
    >
      <AxisAssignment />
      <FilterPanel />
      <Box
        data-testid="panel-group"
        style={{
          flex: 1,
          minHeight: 420,
          width: "100%",
          display: "grid",
          gridTemplateColumns: isStacked ? "1fr" : "3fr 2fr",
          gridTemplateRows: isStacked ? "1fr 1fr" : "1fr",
          gap: "var(--mantine-spacing-md)",
          overflow: "visible",
        }}
      >
        <Box id="chart-panel" data-testid="panel" style={panelStyle}>
          <ChartPanel />
        </Box>
        <Box id="viewer-panel" data-testid="panel" style={panelStyle}>
          <NiftiViewer />
        </Box>
      </Box>
    </Stack>
  );
}
