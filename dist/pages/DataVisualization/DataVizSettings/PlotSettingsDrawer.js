import SettingsIcon from "@mui/icons-material/Settings";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import { useAtomValue } from "jotai";
import React from "react";
import { APPBARHEIGHTPIXELS } from "../../../common/GLOBALS";
import { atomNivoGraphType } from "../../../stores/DataFrameVisualizationStore";
import MRIViewSettings from "./MRIViewSettings";
import PlotTypeSettings from "./PlotTypeSettings";
import ScatterPlotVisualsSettings from "./ScatterPlotVisualsSettings";
import SubsettingSettings from "./SubsettingSettings";
import SwarmPlotVisualsSettings from "./SwarmPlotVisualsSettings";
function PlotSettingsDrawer() {
    const nivoGraphType = useAtomValue(atomNivoGraphType);
    return (React.createElement(Drawer, { variant: "permanent", anchor: "right", sx: {
            width: { xs: 300, sm: 300, md: 400, lg: 500 },
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: {
                width: { xs: 300, sm: 300, md: 400, lg: 500 },
                boxSizing: "border-box",
                marginTop: `${APPBARHEIGHTPIXELS}px`,
                padding: 0.5,
            },
        } },
        React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4", textAlign: "center" }, "Plot Control"), avatar: React.createElement(Avatar, null,
                React.createElement(SettingsIcon, null)) }),
        React.createElement(Divider, null),
        React.createElement(Box, { sx: { overflow: "auto", mb: 7 } },
            React.createElement(PlotTypeSettings, null),
            React.createElement(Divider, null),
            React.createElement(SubsettingSettings, null),
            React.createElement(Divider, null),
            React.createElement(MRIViewSettings, null),
            React.createElement(Divider, null),
            nivoGraphType === "Scatterplot" ? React.createElement(ScatterPlotVisualsSettings, null) : React.createElement(SwarmPlotVisualsSettings, null))));
}
export default PlotSettingsDrawer;
//# sourceMappingURL=PlotSettingsDrawer.js.map