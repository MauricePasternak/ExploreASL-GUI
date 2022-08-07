import { ResponsiveHeatMapCanvas } from "@nivo/heatmap";
import { PrimitiveAtom, useAtomValue } from "jotai";
import React from "react";
import { atomMRIDataStats } from "../../../stores/DataFrameVisualizationStore";
import { NivoHeatmapData } from "../../../common/types/nivoTypes";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { round as lodashRound } from "lodash";
import Skeleton from "@mui/material/Skeleton";
import Box from "@mui/material/Box";
import ColorBar from "../../../components/ColorBar";

function hslToHex(h: number, s: number, l: number) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0"); // convert to Hex and prefix "0" if needed
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface MRISingleViewProps {
  atomMRIData: PrimitiveAtom<NivoHeatmapData[]>;
  atomMRISlice: PrimitiveAtom<number>;
  orientation: "Axial" | "Coronal" | "Sagittal";
}

function MRISingleView({ atomMRIData, atomMRISlice, orientation }: MRISingleViewProps) {
  console.log("MRIView Loaded for orientation: " + orientation);
  const data = useAtomValue(atomMRIData);
  const slice = useAtomValue(atomMRISlice);
  const { max, min } = useAtomValue(atomMRIDataStats);
  return data.length > 0 ? (
    <Box
      height="100%"
      display="flex"
      pr={3}
      className={`MRISingleView__${orientation}`}
      // sx={{
      //   "& > *:first-child": {
      //     position: "relative",
      //   },
      //   "& > *:first-child::after": {
      //     content: `'${orientation === "Sagittal" ? "Anterior" : "Left"}'`,
      //     position: "absolute",
      //     top: "50%",
      //     left: "-7%",
      //     transform: "rotate(-90deg)",
      //   },
      // }}
      sx={{
        "&::after": {
          content: `'${orientation === "Sagittal" ? "Anterior" : "Left"}'`,
          position: "absolute",
          top: "50%",
          left: `${orientation === "Sagittal" ? "-3%" : 0}`,
          transform: "rotate(-90deg)",
        },
      }}
    >
      <ResponsiveHeatMapCanvas
        data={data[slice]}
        // margin={{ top: 70, right: 60, bottom: 20, left: 80 }}
        valueFormat=">-.2s"
        axisTop={null}
        axisRight={null}
        axisLeft={null}
        axisBottom={null}
        colors={({ value }) => {
          const hue = (value * 100) / (max - 10);
          return `hsl(0, 0%, ${hue}%)`;
          // return hslToHex(0, 0, (value * 100) / max);
        }}
        emptyColor="#000"
        borderWidth={0}
        borderColor="#000000"
        enableLabels={false}
        forceSquare
        // layers={["cells"]}
        inactiveOpacity={0.7}
        legends={[
          {
            anchor: "right",
            translateX: 120,
            translateY: 0,
            length: 200,
            thickness: 100,
            direction: "column",
            tickPosition: "after",
            tickSize: 3,
            tickSpacing: 4,
            tickOverlap: false,
            tickFormat: ">-.2s",
            title: "Value →",
            titleAlign: "start",
            titleOffset: 4,
          },
        ]}
        // theme={{
        //   background: "#000",
        //   grid: {
        //     line: {
        //       stroke: "#000",
        //       strokeWidth: 0,
        //     },
        //   },
        // }}
        annotations={[]}
        tooltip={({ cell: { data, id, serieId } }) => {
          return (
            <Paper elevation={1} sx={{ p: 1 }}>
              <Typography>CBF: {lodashRound(data.y, 2)}</Typography>
              <Typography>X: {serieId}</Typography>
              <Typography>Y: {data.x}</Typography>
            </Paper>
          );
        }}
      />
      <ColorBar alignSelf="center" height="90%" max={max} min={0} title="CBF (mL / 100g / min)" />
    </Box>
  ) : (
    <Box
      display="flex"
      flexDirection="column"
      bgcolor={theme => (theme.palette.mode === "dark" ? "default" : "white")}
      height="100%"
    >
      <Skeleton variant="rectangular" sx={{ flexGrow: 1 }} />
      <Typography variant="caption" bgcolor="black" color="white">
        The above will render with an MRI Volume once a datapoint is selected
      </Typography>
    </Box>
  );
}

export default React.memo(MRISingleView);
