import ScatterPlotIcon from "@mui/icons-material/ScatterPlot";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { toPng } from "html-to-image";
import { useAtomValue, useSetAtom } from "jotai";
import React, { useRef } from "react";

import {
  atomDataVizCurrentStep,
  atomNivoGraphDataVariablesSchema,
  atomNivoGraphType,
} from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import EASLScatterplot from "./DataVizPlots/EASLScatterplot";
import EASLSwarmplot from "./DataVizPlots/EASLSwarmplot";
import PlotSettingsDrawer from "./DataVizSettings/PlotSettingsDrawer";
import MRIMultiView from "./MRIView/MRIMultiView";

function PlotEASLMainView() {
  const graphType = useAtomValue(atomNivoGraphType);
  const dataVarsSchema = useAtomValue(atomNivoGraphDataVariablesSchema);
  const setDataVizSnackbar = useSetAtom(atomDataVizModuleSnackbar);

  const validAxisVars =
    !!dataVarsSchema.XAxisVar &&
    dataVarsSchema.XAxisVar !== "" &&
    !!dataVarsSchema.YAxisVar &&
    dataVarsSchema.YAxisVar !== "";
  const canRenderScatterplot = graphType === "Scatterplot" && validAxisVars;
  const canRenderSwarmplot = graphType === "Swarmplot" && validAxisVars;

  const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);
  const figureContainer = useRef<HTMLDivElement>(null);

  const handleSavePNGFigure = async () => {
    if (!figureContainer.current) return;
    try {
      const dataUrl = await toPng(figureContainer.current, { cacheBust: true });
      const link = document.createElement("a");
      link.download = "ExploreASLJSPlot.png";
      link.href = dataUrl;
      link.click();
      link.remove();
    } catch (error) {
      setDataVizSnackbar({
        severity: "error",
        title: "Error saving figure as PNG",
        message: ["Could not save figure as PNG due to error:", error.message],
      });
    }
  };

  return (
    <Box display="flex" padding={3}>
      <Grid
        pb={3}
        container
        className="PlotEASLMain__GridContainer"
        // The widths below are necessary to offset the width of the PlotSettingsDrawer
        width={{
          xs: "calc(100% - 300px)",
          sm: "calc(100% - 300px)",
          md: "calc(100% - 400px)",
          lg: "calc(100% - 500px)",
        }}
      >
        <Grid item xs={12}>
          <Card>
            <CardHeader
              title={<Typography variant="h4">Data Visualization</Typography>}
              subheader={
                <Typography>
                  Plot an interactive chart and load CBF volumes from individual subjects/visits/sessions by clicking on
                  data points
                </Typography>
              }
              avatar={
                <Avatar sizes="large">
                  <ScatterPlotIcon />
                </Avatar>
              }
            />
            <Divider />
          </Card>
        </Grid>
        <Grid
          container
          item
          xs={12}
          id="PlotEASLMain__FigureContainer"
          ref={figureContainer}
          sx={{
            backgroundColor: "background.paper",
          }}
        >
          <Grid
            item
            xs={12}
            sx={{
              display: "flex",
              flexGrow: 1,
              position: "relative",
              height: {
                xs: "300px",
                sm: "500px",
                md: "600px",
                lg: "800px",
              },
              mb: 0,
            }}
            className="PlotEASLMain__CanvasContainer"
          >
            {canRenderSwarmplot && <EASLSwarmplot />}
            {canRenderScatterplot && <EASLScatterplot />}
            {!canRenderSwarmplot && !canRenderScatterplot && (
              <Stack width={"100%"}>
                <Skeleton
                  sx={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: {
                      xs: "300px",
                      sm: "700px",
                      md: "600px",
                      lg: "800px",
                    },
                  }}
                  variant="rectangular"
                  width="100%"
                />
                <Skeleton variant="text" />
                <Typography variant="caption">
                  The above will render a chart once the appropriate variables are indicated
                </Typography>
              </Stack>
            )}
          </Grid>
          <MRIMultiView />
        </Grid>
      </Grid>
      <PlotSettingsDrawer />
      <Paper
        elevation={10}
        sx={{
          position: "fixed",
          left: 0,
          bottom: 0,
          px: 2,
          borderRadius: 0,
          display: "flex",
          justifyContent: "space-between",
          width: {
            xs: "calc(100% - 300px)",
            sm: "calc(100% - 300px)",
            md: "calc(100% - 400px)",
            lg: "calc(100% - 500px)",
          },
        }}
      >
        <Button onClick={() => setDataVizCurrentStep("DefineDTypes")}>Return To Clarify Data Types</Button>
        <Button disabled={!canRenderScatterplot && !canRenderSwarmplot} onClick={handleSavePNGFigure}>
          Export Figure to PNG
        </Button>
      </Paper>
    </Box>
  );
}

export default React.memo(PlotEASLMainView);
