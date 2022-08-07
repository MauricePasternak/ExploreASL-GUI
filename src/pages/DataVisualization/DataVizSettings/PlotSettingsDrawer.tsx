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

  return (
    <Drawer
      variant="permanent"
      anchor="right"
      sx={{
        width: { xs: 300, sm: 300, md: 400, lg: 500 },
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: {
          width: { xs: 300, sm: 300, md: 400, lg: 500 },
          boxSizing: "border-box",
          marginTop: `${APPBARHEIGHTPIXELS}px`,
          padding: 0.5,
        },
      }}
    >
      <CardHeader
        title={
          <Typography variant="h4" textAlign="center">
            Plot Control
          </Typography>
        }
        avatar={
          <Avatar>
            <SettingsIcon />
          </Avatar>
        }
      />

      <Divider />
      <Box sx={{ overflow: "auto", mb: 7 }}>
        <PlotTypeSettings />
        <Divider />
        <SubsettingSettings />
        <Divider />
        <MRIViewSettings />
        <Divider />
        {nivoGraphType === "Scatterplot" ? <ScatterPlotVisualsSettings /> : <SwarmPlotVisualsSettings />}
      </Box>
    </Drawer>
  );
}

export default PlotSettingsDrawer;
