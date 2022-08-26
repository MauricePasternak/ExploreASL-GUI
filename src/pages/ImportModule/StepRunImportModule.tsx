import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import React, { useEffect, useRef } from "react";
import { SubmitErrorHandler, SubmitHandler } from "react-hook-form";
import ExploreASLIcon from "../../assets/svg/ExploreASLIcon.svg";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../components/FormComponents/RHFMultiStep";
import IPCQuill from "../../components/IPCComponents/IPCQuill";
import { atomImportModuleCurrentProcStatus, ImportModuleChannelName } from "../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../stores/SnackbarStore";

type StepRunImportModuleProps = RHFMultiStepReturnProps<ImportSchemaType>;

function StepRunImportModule({
  currentStep,
  setCurrentStep,
  handleSubmit,
  formState,
  getValues,
}: StepRunImportModuleProps) {
  const { api } = window;
  const { isSubmitting } = formState;
  const [procStatus, setProcStatus] = useAtom(atomImportModuleCurrentProcStatus);
  const setImportModuleSnackbar = useSetAtom(atomImportModuleSnackbar);
  const currentProcPID = useRef(-1);
  const wasTerminatedByUser = useRef(false);

  // Tracking the tasks performed
  const currentTask = useRef(0);
  const completedTasks = useRef([] as number[]);
  const failedTasks = useRef([] as number[]);

  function resetRefs() {
    currentTask.current = 0; // For indexing contexts; we start from the global context
    completedTasks.current = [];
    failedTasks.current = [];
    currentProcPID.current = -1;
  }

  const handleStartImportModule = async () => {
    console.log(`Running Import Module for context with index: ${currentTask.current}`);

    const values = getValues();
    const { payload, GUIMessage } = await api.invoke(
      "ExploreASL:RunImportModule",
      ImportModuleChannelName,
      values,
      currentTask.current
    );

    // If Successful, re-render in a running state and update the current PID
    if (GUIMessage.severity === "success") {
      procStatus !== "Running" && setProcStatus("Running");
      currentProcPID.current = payload.pids[0];
      wasTerminatedByUser.current = false;
      return;
    }

    // If Failed
    setImportModuleSnackbar({
      severity: GUIMessage.severity,
      title: "Failed to Run Import Module",
      message: GUIMessage.messages,
    });
    resetRefs();
    procStatus !== "Standby" && setProcStatus("Standby");
    return;
  };

  const handleFeedbackProcessSpawn = (pid: number) => {
    console.log("Import Module Process Spawned with Process ID: ", pid);
    currentProcPID.current = pid;
    procStatus !== "Running" && setProcStatus("Running");
  };

  const handleFeedbackProcessClose = async (pid: number, exitCode: number) => {
    console.log(`Import Module Process Closed with Process ID: ${pid} and Exit Code: ${exitCode}.`);
    console.log(`Prior to updating the currentTask, the currentTask is: ${currentTask.current}`);

    currentTask.current++; // Increment the current task to allow for indexing the next task
    console.log(`After updating the currentTask, the currentTask is: ${currentTask.current}`);

    // When the current task is equal to the length of contexts (minus 1), it means that all the tasks have been run
    const values = getValues();
    if (currentTask.current === values.ImportContexts.length) {
      console.log(`StepRunImportModule: All tasks completed. Resetting the current PID to -1`);
      resetRefs();
      setProcStatus("Standby");

      // Only give snackbar info feedback if the user did not terminate the process
      !wasTerminatedByUser.current &&
        setImportModuleSnackbar({
          severity: "info",
          title: "Import Completed",
          message: [
            "All Import Contexts have been imported.",
            `Before proceeding, you are recommended to review the contents of the following directories in order to verify import success:`,
            `${api.path.osSpecificString(values.EASLPath, "rawdata")}`,
            `${api.path.osSpecificString(values.EASLPath, "derivatives", "ExploreASL", "log")}`,
          ],
        });
      return;
    }

    console.log(`StepRunImportModule: Running the next task`);
    // Otherwise start up the next task
    await handleStartImportModule();
  };

  const handleFeedbackProcessPaused = (message: string, failedToPause: boolean) => {
    console.log(`Import Module Process Paused with Message: ${message}`);
    console.log(`Import Module Process Paused with Error? ${failedToPause}`);
    console.log(
      `Import Module Process Paused with can set to Paused state? `,
      procStatus !== "Paused" && !failedToPause
    );
    procStatus !== "Paused" && !failedToPause && setProcStatus("Paused");
  };

  const handleFeedbackProcessResume = (message: string, failedToResume: boolean) => {
    console.log(`Import Module Process Resumed with Message: ${message}`);
    console.log(`Import Module Process Resumed with Error? ${failedToResume}`);
    console.log(
      `Import Module Process Resumed with can set to Running state? `,
      procStatus !== "Running" && !failedToResume
    );
    procStatus !== "Running" && !failedToResume && setProcStatus("Running");
  };

  useEffect(() => {
    resetRefs(); // Reset the refs when the component is mounted
    console.log("SubmoduleImportMain is registering events");
    api.on(`${ImportModuleChannelName}:childProcessHasSpawned`, handleFeedbackProcessSpawn);
    api.on(`${ImportModuleChannelName}:childProcessHasClosed`, handleFeedbackProcessClose);
    api.on(`${ImportModuleChannelName}:childProcessHasBeenPaused`, handleFeedbackProcessPaused);
    api.on(`${ImportModuleChannelName}:childProcessHasBeenResumed`, handleFeedbackProcessResume);
    return () => {
      console.log("SubmoduleImportMain is cleaning up events");
      api.removeAllListeners(`${ImportModuleChannelName}:childProcessHasSpawned`);
      api.removeAllListeners(`${ImportModuleChannelName}:childProcessHasClosed`);
      api.removeAllListeners(`${ImportModuleChannelName}:childProcessHasBeenPaused`);
      api.removeAllListeners(`${ImportModuleChannelName}:childProcessHasBeenResumed`);
    };
  }, []);

  const handleValidSubmit: SubmitHandler<ImportSchemaType> = async values => {
    console.log("Step 'Run Import Module' -- Valid Submit Values: ", values);
    await handleStartImportModule();
  };

  // For naughty users who try to break the app
  const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = errors => {
    console.log("Step 'Run Import Module' -- Invalid Submit Errors: ", errors);

    setImportModuleSnackbar({
      severity: "error",
      title: "Failed to Start Import Module Due to User Tampering",
      message: [
        "One or more of the fields from previous steps are invalid.",
        "Have you changed any filepaths between those steps and clicking the 'Run Import Module' button?",
      ],
    });
  };

  const handlePause = async () => {
    // Sanity check
    if (currentProcPID.current === -1 || procStatus !== "Running") {
      console.log("Import Module Process is not running");
      return;
    }
    // Send the pause command
    await api.invoke("ChildProcess:Pause", currentProcPID.current, ImportModuleChannelName);
  };

  const handleResume = async () => {
    // Sanity check
    if (currentProcPID.current === -1 || procStatus !== "Paused") {
      console.log("Import Module Process is not paused");
      return;
    }
    // Send the resume command
    await api.invoke("ChildProcess:Resume", currentProcPID.current, ImportModuleChannelName);
  };

  const handleTerminate = async () => {
    if (procStatus === "Standby") {
      console.log("Import Module Process is in Standby; nothing to terminate");
      return;
    }
    // Send the terminate command and set the current PID to -1 in order to allow handleProcessClose to not start any followup tasks
    currentProcPID.current = -1;
    wasTerminatedByUser.current = true;
    await api.invoke("ChildProcess:Terminate", currentProcPID.current, ImportModuleChannelName);
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Box mt={3} pb={5}>
        <Card>
          <CardHeader
            title={<Typography variant="h4">Run Import Module</Typography>}
            subheader={<Typography>Run ExploreASL's Import Module and view progress</Typography>}
            avatar={
              procStatus === "Running" ? (
                <CircularProgress />
              ) : (
                <Avatar>
                  <SvgIcon component={ExploreASLIcon} inheritViewBox />
                </Avatar>
              )
            }
          />
          <Divider />
          <CardContent>
            <Box>
              <Typography variant="subtitle1">ExploreASL Progress Feedback</Typography>
              <IPCQuill defaultHeight="calc(100vh - 375px)" channelName={ImportModuleChannelName} />
            </Box>
            <ButtonGroup variant="contained" fullWidth color="inherit">
              <Button
                className="ImportSubmoduleResumeButton"
                disabled={procStatus !== "Paused" || isSubmitting}
                onClick={handleResume}
                endIcon={<PlayCircleOutlineIcon />}
                variant="contained"
                color="success"
              >
                Resume
              </Button>
              <Button
                className="ImportSubmodulePauseButton"
                disabled={procStatus !== "Running" || isSubmitting}
                onClick={handlePause}
                endIcon={<PauseCircleOutlineIcon />}
                variant="contained"
                color="warning"
              >
                Pause
              </Button>
              <Button
                className="ImportSubmoduleKillButton"
                disabled={procStatus === "Standby" || isSubmitting}
                onClick={handleTerminate}
                endIcon={<StopCircleIcon />}
                variant="contained"
                color="error"
              >
                Terminate
              </Button>
            </ButtonGroup>
          </CardContent>
        </Card>
        <RHFMultiStepButtons
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          backButtonProps={{ disabled: isSubmitting || procStatus !== "Standby" }}
          nextButtonProps={{ disabled: isSubmitting || procStatus !== "Standby" }}
          nextButtonText="Run ExploreASL Import Module"
        />
      </Box>
    </form>
  );
}

export default StepRunImportModule;
