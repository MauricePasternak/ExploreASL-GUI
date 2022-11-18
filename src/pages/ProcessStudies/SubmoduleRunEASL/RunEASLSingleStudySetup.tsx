import CircleIcon from "@mui/icons-material/Circle";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { SelectChangeEvent } from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import {
  isEmpty as lodashIsEmpty,
  range as lodashRange,
  sum as lodashSum,
  cloneDeep as lodashCloneDeep,
  set as lodashSet,
} from "lodash";
import React, { useEffect } from "react";
import { Controller, SubmitErrorHandler, SubmitHandler, useForm } from "react-hook-form";
import { Regex } from "../../../common/utilityFunctions/Regex";
import { DATAPARFILE_BASENAME } from "../../../common/GLOBALS";
import { DataParFieldNameTranslator } from "../../../common/schemas/DataParFieldNameTranslator";
import { SchemaDataPar } from "../../../common/schemas/DataParSchema";
import { SchemaRunEASLSingleStudySetup } from "../../../common/schemas/RunEASLSchema";
import { DataParValuesType } from "../../../common/types/ExploreASLDataParTypes";
import { RunEASLChildProcSummary, RunEASLStatusType } from "../../../common/types/ExploreASLTypes";
import { RunEASLModuleNamesType, RunEASLStudySetupType } from "../../../common/types/ProcessStudiesTypes";
import {
  formatErrorsForDisplay,
  YupResolverFactoryBase,
  YupValidate,
} from "../../../common/utilityFunctions/formFunctions";
import LabelledSelect from "../../../components/RegularFormComponents/LabelledSelect";
import {
  atomProcStudyPIDs,
  atomSetModuleToRunForAStudy,
  atomSetNumCoresForAStudy,
  atomSetPathForAStudy,
  atomSetStatusForAStudy,
  ProcessStudiesChannelBaseName,
} from "../../../stores/ProcessStudiesStore";
import { atomProcessStudiesSnackbar } from "../../../stores/SnackbarStore";
import RunEASLAccordionSummary from "./RunEASLAccordionSummary";
import RunEASLPauseResumeTerminateControls from "./RunEASLPauseResumeTerminateControls";
import { OutlinedGroupBox } from "../../../components/WrapperComponents";
import { IPCProgressWithLabel, IPCQuill } from "../../../components/IPCComponents";
import { DebouncedFilepathInput } from "../../../components/DebouncedComponents";

type RunEASLSingleStudySetupProps = {
  studyIndex: number;
  isDuplicatePath: boolean;
  numUsedCoresAllStudies: number;
  numUsedCoresForThisStudy: number;
  studyRootPath: string;
  currentStatus: RunEASLStatusType;
  whichModulesToRun: RunEASLModuleNamesType;
};

function RunEASLSingleStudySetup({
  studyIndex,
  studyRootPath,
  isDuplicatePath,
  numUsedCoresAllStudies,
  numUsedCoresForThisStudy,
  whichModulesToRun,
  currentStatus,
}: RunEASLSingleStudySetupProps) {
  const { api } = window;
  const [pids, setPids] = useAtom(atomProcStudyPIDs);
  const changeNumCores = useSetAtom(atomSetNumCoresForAStudy);
  const changeStatus = useSetAtom(atomSetStatusForAStudy);
  const changeModulesToRun = useSetAtom(atomSetModuleToRunForAStudy);
  const changeDataParPath = useSetAtom(atomSetPathForAStudy);
  const setProcessStudiesSnackbar = useSetAtom(atomProcessStudiesSnackbar);

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm({
    defaultValues: { studyRootPath: studyRootPath },
    resolver: YupResolverFactoryBase(SchemaRunEASLSingleStudySetup),
  });

  // console.log(
  //   `RunEASLSingleStudySetup: studyIndex: ${studyIndex} has rendered with studyRootPath: ${studyRootPath} and isDuplicatePath: ${isDuplicatePath}`
  // );

  // Variables stemming from the study setup props
  const channelName = `${ProcessStudiesChannelBaseName}${studyIndex}`;
  const numPhysicalCores = Math.floor(api.cpuCount / 2);
  const numCoresUsedByOtherStudies = numUsedCoresAllStudies - numUsedCoresForThisStudy;
  const coreLabelOptions = lodashRange(1, numPhysicalCores + 1).map((count) => ({
    label: `${count}`,
    value: count,
    disabled:
      count > numPhysicalCores - numCoresUsedByOtherStudies || (whichModulesToRun === "Population" && count > 1),
  }));
  const modulesToRunOptions: { label: string; value: RunEASLModuleNamesType; disabled?: boolean }[] = [
    { label: "Structural Module", value: "Structural" },
    { label: "ASL Module", value: "ASL" },
    { label: "Structural and ASL Modules", value: "Both" },
    {
      label: "Population Module",
      value: "Population",
      disabled: numUsedCoresForThisStudy > 1,
    },
  ];

  /**
   * useEffect for updating the studyRootPath atom when the studyRootPath textfield changes
   */
  useEffect(() => {
    const subscription = watch(({ studyRootPath: formStudyRootPath }) => {
      // console.log(
      //   `Subscription in StudySetup${studyIndex}. The current formStudyRootPath is ${formStudyRootPath} while the provided studyRootPath is ${studyRootPath}`
      // );
      if (studyRootPath !== formStudyRootPath) {
        // console.log(`Syncing the studyRootPath atom with the formStudyRootPath for study ${studyIndex}`);
        changeDataParPath({ studyIndex, newStudyRootPath: formStudyRootPath });
      }
    });
    return () => {
      console.log(`Unsubscribing from StudySetup${studyIndex}`);
      subscription.unsubscribe();
    };
  }, [watch]);

  function handleFeedbackProcessError(pid: number, err: Error | string) {
    console.warn(`Study ${channelName} has received a childProcessHasErrored Event with error: ${err}`);
    pids.includes(pid) && setPids((currentPids) => currentPids.filter((p) => p !== pid));
  }

  function handleFeedbackProcessClosed(pid: number, exitCode: number, runSummary: RunEASLChildProcSummary) {
    const numUnsuccesfulProcs = lodashSum(runSummary.exitSummaries.map((summary) => (summary.exitCode !== 0 ? 1 : 0)));
    console.log(
      `Study ${channelName} -- handleFeedbackProcessClosed callback has givens:\n`,
      JSON.stringify({ pid, exitCode, runSummary, numUnsuccesfulProcs }, null, 2)
    );
    const reportError = numUnsuccesfulProcs > 0 || runSummary.numIncompleteSteps > 0;

    if (reportError) {
      setProcessStudiesSnackbar({
        severity: "error",
        title: numUnsuccesfulProcs > 0 ? "Errors in one or more cores" : "Finished with incomplete steps",
        message: [
          "Run Error Summary:",
          `Number of alloted cores which reported an error: ${numUnsuccesfulProcs}`,
          `Number of incomplete steps: ${runSummary.numIncompleteSteps}`,
          "The following a general summary of which parts failed and when (some of these may be false-positives if this was due to a crash):",
          ...runSummary.missedStepsMessages,
          " ",
          "Please refer to the logs directory located within derivatives/ExploreASL for this study to ascertain what errors occured.",
        ],
      });
    } else {
      setProcessStudiesSnackbar({
        severity: "success",
        title: "Successful ExploreASL Run",
        message: [
          "Completed all anticipated steps.",
          "Please remember to cite this program if you intend to publish these results.",
        ],
      });
    }

    console.log(
      `Study ${channelName} -- handleFeedbackProcessClosed will now reset status to Standby and clear its PIDS`
    );
    changeStatus({ studyIndex, status: "Standby" });
    pids.length > 0 && setPids([]);
    api.invoke("App:SoundNotification");
  }

  /**
   * useEffects for api-related tasks
   */
  useEffect(() => {
    api.on(`${channelName}:childProcessHasErrored`, handleFeedbackProcessError);
    api.on(`${channelName}:childProcessHasClosed`, handleFeedbackProcessClosed);
    // On unmount, remove the event listeners
    return () => {
      api.removeAllListeners(`${channelName}:childProcessHasErrored`);
      api.removeAllListeners(`${channelName}:childProcessHasClosed`);
    };
  }, []);

  /**
   * Starts up processing the individual study using ExploreASL
   * @param studyRootPath the path to the study data directory. Should be pre-validated to contain a DataPar.json file.
   */
  const handleValidSubmit: SubmitHandler<Pick<RunEASLStudySetupType, "studyRootPath">> = async ({ studyRootPath }) => {
    console.log("handleValidSubmit", studyRootPath);

    // Load the data par JSON file
    const jsonFilePath = `${studyRootPath}/${DATAPARFILE_BASENAME}`;
    const { error: loadDataParError, payload: initialDataParJSON } = await api.path.readJSONSafe(jsonFilePath);
    if (loadDataParError) {
      console.warn("Error loading DataPar.json", loadDataParError);
      setProcessStudiesSnackbar({
        severity: "error",
        title:
          loadDataParError.type === "FileIsNotJSON"
            ? "Provided filepath is not a valid JSON file"
            : "Invalid syntax in JSON file",
        message: loadDataParError.message,
      });
      await api.invoke("App:SoundNotification");
      return;
    }

    // Minor formatting operations before validation
    // Correct the exclusions field by removing the trailing "_#"
    const exclusion = (initialDataParJSON as DataParValuesType).x?.dataset?.exclusion;
    let originalExclusion = lodashCloneDeep(exclusion);
    console.log("exclusion", exclusion);
    if (exclusion && Array.isArray(exclusion) && exclusion.length > 0) {
      const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
      const reformattedExclusion = exclusion
        .map((v) => {
          const match = exclusionRegex.search(v);
          return match ? match.groupsObject.SUBJECT : null;
        })
        .filter((v) => v);
      console.log("reformattedExclusion", reformattedExclusion);
      (initialDataParJSON as DataParValuesType).x.dataset.exclusion = Array.from(new Set(reformattedExclusion));
    }

    // Validate the data par JSON file
    const { errors: validateDataParError, values: dataParValues } = await YupValidate(
      SchemaDataPar,
      initialDataParJSON as DataParValuesType
    );
    if (!lodashIsEmpty(validateDataParError)) {
      console.warn("Error validating DataPar.json", validateDataParError);
      const parsedErrors = formatErrorsForDisplay(validateDataParError, DataParFieldNameTranslator);
      const finalErrorMessage = (
        <div>
          <Typography>
            The following fields were found to be invalid and/or missing when loading the data parameters file. Please
            correct them in the "Define Parameters" step of this program and try again.
          </Typography>
          <List>
            {parsedErrors.map((error, index) => (
              <ListItem key={`ProcessStudiesLoadErrorItem_${index}`}>
                <ListItemIcon>
                  <CircleIcon />
                </ListItemIcon>
                <ListItemText>{error}</ListItemText>
              </ListItem>
            ))}
          </List>
        </div>
      );
      await api.invoke("App:SoundNotification");
      setProcessStudiesSnackbar({
        severity: "error",
        title: "Invalid data parameters file",
        message: finalErrorMessage,
      });
      return;
    }

    // Last check, the number of cores shouldn't be greater than the number of subjects selected to process
    let finalNumCores: number = numUsedCoresForThisStudy;
    if (whichModulesToRun !== "Population" && numUsedCoresForThisStudy > dataParValues.x.GUI.SUBJECTS.length) {
      finalNumCores = dataParValues.x.GUI.SUBJECTS.length;
    }

    // Re-adjust some fields back to what ExploreASL accepts
    if (originalExclusion && dataParValues.x?.dataset?.exclusion) {
      lodashSet(dataParValues, "x.dataset.exclusion", originalExclusion);
    }

    // Call the backend to start the process
    const startupEASLResult = await api.invoke("ExploreASL:RunExploreASL", channelName, dataParValues, {
      studyRootPath: studyRootPath,
      numberOfCores: finalNumCores,
      whichModulesToRun: whichModulesToRun,
    } as Omit<RunEASLStudySetupType, "currentStatus">);

    if (startupEASLResult.GUIMessage.severity !== "success") {
      await api.invoke("App:SoundNotification");
      setProcessStudiesSnackbar({
        severity: startupEASLResult.GUIMessage.severity,
        title: startupEASLResult.GUIMessage.title,
        message: startupEASLResult.GUIMessage.messages,
      });
      return;
    }

    // Otherwise, all is ready to be updated

    setPids(startupEASLResult.payload.pids);
    changeStatus({ studyIndex, status: "Running" });
    console.log(`Set the following PIDs: ${pids}`);
    console.log(`Set the following status: ${status}`);
  };

  const handleInvalidSubmit: SubmitErrorHandler<Pick<RunEASLSingleStudySetupProps, "studyRootPath">> = (error) => {
    console.log("handleInvalidSubmit", error);
  };

  return (
    <Accordion defaultExpanded={true}>
      <RunEASLAccordionSummary studyIndex={studyIndex} currentStatus={currentStatus} />
      <AccordionDetails>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6} className="StudySetupForm" display="flex" flexDirection="column">
            <form
              onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}
              style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}
            >
              <Box rowGap={3} mt={3} justifyContent="space-between" flexGrow={1} display="flex" flexDirection="column">
                <OutlinedGroupBox
                  label="Study Settings"
                  labelBackgroundColor={(theme) =>
                    theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper
                  }
                  display="flex"
                  flexDirection="column"
                  flexGrow={1}
                  padding={3}
                >
                  <Stack rowGap={3}>
                    <Controller
                      control={control}
                      name="studyRootPath"
                      render={({ field, fieldState }) => {
                        // Adjust error when is a duplicate
                        const alteredFieldState = isDuplicatePath
                          ? {
                              ...fieldState,
                              error: {
                                message: "Another study is already using this indicated filepath",
                                type: "DuplicateError",
                              },
                            }
                          : fieldState;
                        return (
                          <DebouncedFilepathInput
                            {...field}
                            label="Study Root Path"
                            filepathType="dir"
                            dialogOptions={{
                              properties: ["openDirectory"],
                              title: "Select the Study Root Folder",
                            }}
                            errorMessage={alteredFieldState.error?.message}
                            error={!!alteredFieldState.error}
                            disabled={currentStatus !== "Standby"}
                            helperText='The root folder of the study. Expected to contain "derivatives/ExploreASL", "rawdata" and "sourcedata" subfolders'
                            buttonProps={{ disabled: currentStatus !== "Standby" }}
                          />
                        );
                      }}
                    />
                    <LabelledSelect
                      disabled={currentStatus !== "Standby"}
                      options={coreLabelOptions}
                      value={numUsedCoresForThisStudy}
                      label="Number of Cores Allocated for this Study"
                      fullWidth
                      helperText="Take care that each extra core adds ~3.5GB of memory usage"
                      onChange={(e) =>
                        changeNumCores({ studyIndex: studyIndex, numberOfCores: Number(e.target.value) })
                      }
                    />
                    <LabelledSelect
                      disabled={currentStatus !== "Standby"}
                      options={modulesToRunOptions}
                      value={whichModulesToRun}
                      label="Modules to Run"
                      fullWidth
                      helperText="The Population Module requires that only 1 core be alloted"
                      onChange={(e: SelectChangeEvent<RunEASLModuleNamesType>) =>
                        changeModulesToRun({
                          studyIndex: studyIndex,
                          moduleToRun: e.target.value as RunEASLModuleNamesType,
                        })
                      }
                    />
                  </Stack>
                </OutlinedGroupBox>
                <OutlinedGroupBox
                  label="Run Control"
                  labelBackgroundColor={(theme) =>
                    theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper
                  }
                  padding={3}
                >
                  <Box>
                    <Typography>Progress</Typography>
                    <IPCProgressWithLabel channelName={channelName} />
                  </Box>
                  <RunEASLPauseResumeTerminateControls
                    studyIndex={studyIndex}
                    channelName={channelName}
                    currentStatus={currentStatus}
                  />
                  <Button
                    sx={{ minHeight: "100px", fontSize: (theme) => theme.typography.h4.fontSize }}
                    variant="contained"
                    type="submit"
                    color="primary"
                    fullWidth
                    disabled={
                      // Do not run if there are errors with the folderPath, its already running or is a copy of another filepath
                      currentStatus !== "Standby" || Object.keys(errors).length > 0 || isDuplicatePath
                    }
                    endIcon={
                      <DirectionsRunIcon
                        fontSize="large"
                        sx={{ ml: (theme) => theme.spacing(2), transform: "scale(2.5)" }}
                      />
                    }
                  >
                    Run Study
                  </Button>
                </OutlinedGroupBox>
              </Box>
            </form>
          </Grid>
          <Grid item xs={12} md={6} display="flex" flexDirection="column">
            {/* <Box mt={3} flexGrow={1}> */}
            <OutlinedGroupBox
              label="Program Feedback"
              labelBackgroundColor={(theme) =>
                theme.palette.mode === "dark" ? "#1e1e1e" : theme.palette.background.paper
              }
              padding={3}
              mt={3}
              flexGrow={1}
            >
              <IPCQuill channelName={channelName} defaultHeight={561} />
            </OutlinedGroupBox>
            {/* </Box> */}
          </Grid>
        </Grid>
      </AccordionDetails>
    </Accordion>
  );
}

export default React.memo(RunEASLSingleStudySetup);
