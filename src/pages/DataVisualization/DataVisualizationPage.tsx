import Box from "@mui/material/Box";
import { useAtomValue } from "jotai";
import React from "react";
import { AtomicSnackbarMessage } from "../../components/AtomicComponents";
import { APPBARHEIGHTPIXELS } from "../../common/GLOBALS";
import { atomDataVizCurrentStep } from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import PlotEASLMainView from "./PlotEASLMainView";
import StepClarifyDataTypes from "./StepClarifyDataTypes";
import StepDefineDataframeLoc from "./StepDefineDataframeLoc";

export const DataVisualizationPage = React.memo(() => {
  const currentStep = useAtomValue(atomDataVizCurrentStep);
  return (
    <Box className="currentMainPage" height={`calc(100% - ${APPBARHEIGHTPIXELS}px)`}>
      {currentStep === "DefinePaths" && <StepDefineDataframeLoc />}
      {currentStep === "DefineDTypes" && <StepClarifyDataTypes />}
      {currentStep === "Plotting" && <PlotEASLMainView />}
      <AtomicSnackbarMessage atomConfig={atomDataVizModuleSnackbar} />
    </Box>
  );
});
