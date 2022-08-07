import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import React, { useEffect, useRef } from "react";
import { SubmitErrorHandler, SubmitHandler } from "react-hook-form";
import AtomicSnackbarMessage from "../../components/AtomicSnackbarMessage";
import { ImportSchemaType } from "../../common/types/ImportSchemaTypes";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../components/FormComponents/RHFMultiStep";
import IPCQuill from "../../components/IPCComponents/IPCQuill";
import {
  atomImportModuleCurrentProcPID,
  atomImportModuleCurrentProcStatus,
  ImportModuleChannelName,
} from "../../stores/ImportPageStore";
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

  // Tracking the tasks performed
  const currentTask = useRef(0);
  const completedTasks = useRef([] as number[]);
  const failedTasks = useRef([] as number[]);

  function resetRefs() {
    const values = getValues();
    currentTask.current = values.ImportContexts.length - 1; // For indexing
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
    currentTask.current--; // Decrement the current task to allow for indexing the next task

    // When the current task is negative, it means that all the tasks have been run
    if (currentTask.current < 0) {
      console.log(`StepRunImportModule: All tasks completed. Resetting the current PID to -1`);
      resetRefs();
      setProcStatus("Standby");
      return;
    }

    // Otherwise start up the next task
    await handleStartImportModule();
  };

  const handleFeedbackProcessPaused = (message: string, failedToPause: boolean) => {
    console.log(`Import Module Process Paused with Message: ${message}`);
    console.log(`Import Module Process Paused with Error? ${failedToPause}`);
    procStatus !== "Paused" && !failedToPause && setProcStatus("Paused");
  };

  const handleFeedbackProcessResume = (message: string, failedToResume: boolean) => {
    console.log(`Import Module Process Resumed with Message: ${message}`);
    console.log(`Import Module Process Resumed with Error? ${failedToResume}`);
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
    await api.invoke("ChildProcess:Pause", currentProcPID.current);
  };

  const handleResume = async () => {
    // Sanity check
    if (currentProcPID.current === -1 || procStatus !== "Paused") {
      console.log("Import Module Process is not paused");
      return;
    }
    // Send the resume command
    await api.invoke("ChildProcess:Resume", currentProcPID.current);
  };

  const handleTerminate = async () => {
    if (procStatus === "Standby") {
      console.log("Import Module Process is in Standby; nothing to terminate");
      return;
    }
    // Send the terminate command and set the current PID to -1 in order to allow handleProcessClose to not start any followup tasks
    await api.invoke("ChildProcess:Terminate", currentProcPID.current);
    currentProcPID.current = -1;
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit, handleInvalidSubmit)}>
      <Box mt={3} pb={5}>
        <Typography variant="h5">Run ExploreASL Import Module</Typography>
        <Box display="flex" justifyContent="center">
          {procStatus === "Running" && <CircularProgress />}
        </Box>
        <Box>
          <Typography variant="subtitle1">ExploreASL Progress Feedback</Typography>
          <IPCQuill channelName={ImportModuleChannelName} />
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
        <RHFMultiStepButtons
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          backButtonProps={{ disabled: isSubmitting || procStatus !== "Standby" }}
          nextButtonProps={{ disabled: isSubmitting || procStatus !== "Standby" }}
          nextButtonText="Run ExploreASL Import Module"
        />
      </Box>
      <AtomicSnackbarMessage atomConfig={atomImportModuleSnackbar} />
    </form>
  );
}

export default StepRunImportModule;
