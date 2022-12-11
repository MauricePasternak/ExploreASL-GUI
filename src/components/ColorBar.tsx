import Box, { BoxProps } from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import createColormap from "colormap";
import { round as lodashRound } from "lodash";
import React from "react";
import { linspace } from "../common/utils/arrayFunctions";

export function generateLinearGradient(cmap: string, nSteps: number, direction = "to top") {
  const colors = createColormap({
    colormap: cmap,
    nshades: nSteps,
    format: "hex",
  });

  return `linear-gradient(${direction}, ${colors.map(c => `${c}`).join(", ")})`;
}

type ColorBarProps = {
  max?: number;
  min?: number;
  nshades?: number;
  cmap?: string;
  nlabels?: number;
  title?: string;
  cmapDirection?: "to top" | "to bottom";
  reverseLabels?: boolean;
} & BoxProps;

/**
 * Basic color bar component.
 * @param max The maximum value of the colorbar. Defaults to 1000.
 * @param min The minimum value of the colorbar. Defaults to 0.
 * @param nshades The number of colors in the colorbar. Defaults to 10.
 * @param cmap The colormap to use. Defaults to "greys".
 * @param nlabels The number of labels to display. Defaults to 5.
 * @param title The title of the colorbar. Defaults to "".
 * @param cmapDirection The direction of the gradient. Defaults to "to top".
 * @param reverseLabels Whether to reverse the order of the labels. Defaults to `true`.
 * @param height The height of the colorbar. Defaults to `100%`.
 */
function ColorBar({
  max = 1000,
  min = 0,
  nshades = 10,
  cmap = "greys",
  nlabels = 5,
  title = "",
  cmapDirection = "to top",
  reverseLabels = true,
  ...boxProps
}: ColorBarProps) {
  const data = createColormap({
    colormap: cmap,
    nshades: nshades,
    format: "hex",
  }).reverse();
  const gradient = generateLinearGradient(cmap, nshades, cmapDirection);
  const legendRows = linspace(min, max, nlabels).map(v => {
    return (
      <Typography key={v} variant="body1" color="white">
        {lodashRound(v, 0)}
      </Typography>
    );
  });

  return (
    <Box display="flex" gap={1} className="Colorbar__MainContainer" {...boxProps}>
      <Box
        sx={{
          background: gradient,
        }}
        height="100%"
        width="12px"
        className="Colorbar__ColorBar"
      />
      <Box
        display="flex"
        flexDirection="column"
        height="calc(100% + 20px)"
        justifyContent="space-between"
        sx={{ transform: "translateY(-10px)" }}
        className="Colorbar__LegendContainer"
      >
        {reverseLabels ? legendRows.reverse() : legendRows}
      </Box>
      {title && (
        <Typography alignSelf="center" sx={{ writingMode: "vertical-lr", color: "white" }} variant="h6">
          {title}
        </Typography>
      )}
    </Box>
  );
}

export default ColorBar;
export const memoColorBar = React.memo(ColorBar);
