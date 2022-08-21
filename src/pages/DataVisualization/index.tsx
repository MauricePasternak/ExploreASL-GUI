import Box from "@mui/material/Box";
import { useAtomValue } from "jotai";
import React from "react";
import AtomicSnackbarMessage from "../../components/AtomicSnackbarMessage";
import { atomDataVizCurrentStep } from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import PlotEASLMainView from "./PlotEASLMainView";
import StepClarifyDataTypes from "./StepClarifyDataTypes";
import StepDefineDataframeLoc from "./StepDefineDataframeLoc";

function DataVisualizationPage() {
  const currentStep = useAtomValue(atomDataVizCurrentStep);
  return (
    <Box>
      {currentStep === "DefinePaths" && <StepDefineDataframeLoc />}
      {currentStep === "DefineDTypes" && <StepClarifyDataTypes />}
      {currentStep === "Plotting" && <PlotEASLMainView />}
      <AtomicSnackbarMessage atomConfig={atomDataVizModuleSnackbar} />
    </Box>
  );
}

export default React.memo(DataVisualizationPage);
