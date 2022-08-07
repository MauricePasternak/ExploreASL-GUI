import Box from "@mui/material/Box";
import { SelectChangeEvent } from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { useAtomValue, useSetAtom } from "jotai";
import { countBy as lodashCountBy, range as lodashRange, sumBy as lodashSumBy } from "lodash";
import React from "react";
import { atomProcessStudiesSnackbar } from "../../../stores/SnackbarStore";
import AtomicSnackbarMessage from "../../../components/AtomicSnackbarMessage";
import LabelledSelect from "../../../components/LabelledSelect";
import { atomAddOrRemoveStudy, atomProcStudySetups } from "../../../stores/ProcessStudiesStore";
import RunEASLSingleStudySetup from "./RunEASLSingleStudySetup";
import FabDialogWrapper from "../../../components/WrapperComponents/FabDialogWrapper";
import HelpProcessStudies__RunEASL from "../../Help/HelpProcessStudies__RunEASL";

function SubmoduleRunEASL() {
  const studySetups = useAtomValue(atomProcStudySetups);
  const addOrRemoveStudySetups = useSetAtom(atomAddOrRemoveStudy);

  const { cpuCount } = window.api;
  const numPhysicalCores = Math.floor(cpuCount / 2);
  const numUsedCores = lodashSumBy(studySetups, "numberOfCores");
  const numFreeCores = numPhysicalCores - numUsedCores;
  const numStudies = studySetups.length;

  // Options for selecting the number of studies
  const labelOptions = lodashRange(1, numPhysicalCores + 1).map(count => {
    return {
      label: `${count}`,
      value: count,
      disabled: count > numFreeCores + numStudies,
    };
  });

  // Whether there are duplicates in the study
  const hasStudyDuplicates = lodashCountBy(studySetups, "studyRootPath");

  /**
   * Handler for adding/removing studies
   */
  const handleSelect = (e: SelectChangeEvent<typeof labelOptions[number]["value"]>) => {
    const selectedValue = Number(e.target.value);
    addOrRemoveStudySetups(selectedValue);
  };

  return (
    <Box display="flex" flexDirection="column" gap={2} padding={2} position="relative">
      <FabDialogWrapper
        maxWidth="xl"
        fabProps={{ sx: { position: "absolute", top: "20px", right: "1rem", zIndex: 1 } }}
        PaperProps={{ sx: { minWidth: "499px" } }}
        sx={{ marginTop: "40px" }}
      >
        <HelpProcessStudies__RunEASL />
      </FabDialogWrapper>
      <AtomicSnackbarMessage atomConfig={atomProcessStudiesSnackbar} />
      <Typography variant="h4">Run ExploreASL</Typography>
      <LabelledSelect
        variant="outlined"
        onChange={handleSelect}
        value={studySetups.length}
        sx={{ width: "17rem" }}
        disabled={studySetups.some(study => study.currentStatus !== "Standby")}
        label="Select the number of studies to process"
        helperText="This will be disabled while any study is actively running"
        options={labelOptions}
      />
      {studySetups.map((studySetup, studyIndex) => {
        const isDuplicate = hasStudyDuplicates[studySetup.studyRootPath] > 1 && studySetup.studyRootPath !== "";
        console.log(`Study ${studyIndex} ${studySetup.studyRootPath} is duplicate? ${isDuplicate}`);

        return (
          <RunEASLSingleStudySetup
            key={`RunEASLSingleStudySetup_${studyIndex}`}
            studyIndex={studyIndex}
            studyRootPath={studySetup.studyRootPath}
            isDuplicatePath={isDuplicate}
            numUsedCoresAllStudies={numUsedCores}
            numUsedCoresForThisStudy={studySetup.numberOfCores}
            whichModulesToRun={studySetup.whichModulesToRun}
            currentStatus={studySetup.currentStatus}
          />
        );
      })}
    </Box>
  );
}

export default React.memo(SubmoduleRunEASL);
