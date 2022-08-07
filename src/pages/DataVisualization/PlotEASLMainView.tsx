import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";
import {
  atomDataVizCurrentStep,
  atomNivoGraphDataVariablesSchema,
  atomNivoGraphType,
} from "../../stores/DataFrameVisualizationStore";
import EASLScatterplot from "./DataVizPlots/EASLScatterplot";
import EASLSwarmplot from "./DataVizPlots/EASLSwarmplot";
import PlotSettingsDrawer from "./DataVizSettings/PlotSettingsDrawer";
import MRIMultiView from "./MRIView/MRIMultiView";

function PlotEASLMainView() {
  const graphType = useAtomValue(atomNivoGraphType);
  const dataVarsSchema = useAtomValue(atomNivoGraphDataVariablesSchema);

  const validAxisVars =
    !!dataVarsSchema.XAxisVar &&
    dataVarsSchema.XAxisVar !== "" &&
    !!dataVarsSchema.YAxisVar &&
    dataVarsSchema.YAxisVar !== "";
  const canRenderScatterplot = graphType === "Scatterplot" && validAxisVars;
  const canRenderSwarmplot = graphType === "Swarmplot" && validAxisVars;

  const setDataVizCurrentStep = useSetAtom(atomDataVizCurrentStep);

  return (
    <Box display="flex" padding={3}>
      <Grid
        pb={3}
        container
        className="PlotEASLMain__GridContainer"
        width={{
          xs: "calc(100% - 300px)",
          sm: "calc(100% - 300px)",
          md: "calc(100% - 400px)",
          lg: "calc(100% - 500px)",
        }}
      >
        <Grid item xs={12}>
          <Typography variant="h3">Data Visualization</Typography>
          <Box
            position={"relative"}
            display="flex"
            flexGrow={1}
            height={{
              xs: "300px",
              sm: "500px",
              md: "600px",
              lg: "800px",
            }}
            mb={1}
            className="CanvasContainer"
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
          </Box>
        </Grid>
        <MRIMultiView />
      </Grid>
      <PlotSettingsDrawer />
      <Paper
        elevation={10}
        sx={{
          position: "fixed",
          left: 0,
          bottom: 0,
          width: "100%",
          borderRadius: 0,
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        <Button onClick={() => setDataVizCurrentStep("DefineDTypes")}>Return To Clarify Data Types</Button>
      </Paper>
    </Box>
  );
}

export default React.memo(PlotEASLMainView);
