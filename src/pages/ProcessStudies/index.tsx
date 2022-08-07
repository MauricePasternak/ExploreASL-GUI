import Box from "@mui/material/Box";
import { useAtomValue } from "jotai";
import React from "react";
import { atomProcStudyCurrentTab } from "../../stores/ProcessStudiesStore";
import ProcessStudiesTabs from "./ProcessStudiesTabs";
import SubmoduleReRunAStudy from "./SubmoduleReRunAStudy";
import SubmoduleRunEASL from "./SubmoduleRunEASL";

function ProcessStudiesPage() {
  const currentProcessStudiesTab = useAtomValue(atomProcStudyCurrentTab);

  return (
    <>
      <ProcessStudiesTabs />
      <Box className="ProcessStudies__TabContentContainer">
        <Box display={currentProcessStudiesTab === "RunExploreASL" ? "block" : "none"}>
          <SubmoduleRunEASL />
        </Box>
        <Box display={currentProcessStudiesTab === "PrepareARerun" ? "block" : "none"}>
          <SubmoduleReRunAStudy />
        </Box>
      </Box>
    </>
  );
}

export default ProcessStudiesPage;
