import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { ResponsiveHeatMapCanvas } from "@nivo/heatmap";
import { useAtomValue } from "jotai";
import { round as lodashRound } from "lodash";
import React from "react";
import ColorBar from "../../../components/ColorBar";
import { atomMRIDataStats } from "../../../stores/DataFrameVisualizationStore";
function MRISingleView({ atomMRIData, atomMRISlice, orientation }) {
    console.log("MRIView Loaded for orientation: " + orientation);
    const data = useAtomValue(atomMRIData);
    const slice = useAtomValue(atomMRISlice);
    const { max, min } = useAtomValue(atomMRIDataStats);
    return data.length > 0 ? (React.createElement(Box, { height: "100%", display: "flex", pr: 3, className: `MRISingleView__${orientation}`, sx: {
            "&::after": {
                content: `'${orientation === "Sagittal" ? "Anterior" : "Left"}'`,
                position: "absolute",
                top: "50%",
                color: "white",
                left: `${orientation === "Sagittal" ? "-3%" : 0}`,
                transform: "rotate(-90deg)",
            },
        } },
        React.createElement(ResponsiveHeatMapCanvas, { data: data[slice], valueFormat: ">-.2s", axisTop: null, axisRight: null, axisLeft: null, axisBottom: null, colors: ({ value }) => {
                const hue = ((value) * 100) / (max);
                return `hsl(0, 0%, ${hue}%)`;
            }, emptyColor: "#000", borderWidth: 0, borderColor: "#000000", enableLabels: false, forceSquare: true, inactiveOpacity: 0.7, legends: [
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
            ], annotations: [], tooltip: ({ cell: { data, id, serieId } }) => {
                return (React.createElement(Paper, { elevation: 1, sx: { p: 1 } },
                    React.createElement(Typography, null,
                        "CBF: ",
                        lodashRound(data.y, 2)),
                    React.createElement(Typography, null,
                        "X: ",
                        serieId),
                    React.createElement(Typography, null,
                        "Y: ",
                        data.x)));
            } }),
        React.createElement(ColorBar, { alignSelf: "center", height: "90%", max: max, min: 0, title: "CBF (mL / 100g / min)" }))) : (React.createElement(Box, { display: "flex", flexDirection: "column", bgcolor: theme => (theme.palette.mode === "dark" ? "default" : "white"), height: "100%" },
        React.createElement(Skeleton, { variant: "rectangular", sx: { flexGrow: 1 } }),
        React.createElement(Typography, { variant: "caption", bgcolor: "black", color: "white" }, "The above will render with an MRI Volume once a datapoint is selected")));
}
export default React.memo(MRISingleView);
//# sourceMappingURL=MRISingleView.js.map