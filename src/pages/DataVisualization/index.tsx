import Box from "@mui/material/Box";
import { useAtom } from "jotai";
import React from "react";
import AtomicSnackbarMessage from "../../components/AtomicSnackbarMessage";
import { atomDataVizCurrentStep } from "../../stores/DataFrameVisualizationStore";
import { atomDataVizModuleSnackbar } from "../../stores/SnackbarStore";
import PlotEASLMainView from "./PlotEASLMainView";
import StepClarifyDataTypes from "./StepClarifyDataTypes";
import StepDefineDataframeLoc from "./StepDefineDataframeLoc";

const testPath =
  "/home/mpasternak/Documents/Bar/derivatives/ExploreASL/Population/Stats/mean_qCBF_StandardSpace_MNI_Structural_n=4_30-Jul-2022_PVC2.tsv";

function DataVisualizationPage() {
  const { api } = window;
  const [currentStep, setCurrentStep] = useAtom(atomDataVizCurrentStep);

  // TODO: Data visualization pages should have a helper modal
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
