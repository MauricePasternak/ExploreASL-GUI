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
import { IPCQuill } from "../../../components/IPCComponents";
import ExploreASLIcon from "../../../assets/svg/ExploreASLIcon.svg";
import { ImportSchemaType } from "../../../common/types/ImportSchemaTypes";
import { RHFMultiStepButtons, RHFMultiStepReturnProps } from "../../../components/RHFComponents/RHFMultiStep";
import { atomImportModuleCurrentProcStatus, ImportModuleChannelName } from "../../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../../stores/SnackbarStore";

type StepRunImportModuleProps = RHFMultiStepReturnProps<ImportSchemaType>;

export function StepRunImportModule({
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

  /** Resets ref variables back to their default values */
  function resetRefs() {
    currentProcPID.current = -1;
    wasTerminatedByUser.current = false;
  }

  /** Handler for receiving a spawn child process event from the backend */
  const handleFeedbackProcessSpawn = (pid: number) => {
    console.log("Import Module Process Spawned with Process ID: ", pid);
    currentProcPID.current = pid;
    procStatus !== "Running" && setProcStatus("Running");
  };

  /** Handler for receiving an exit event from the backend */
  const handleFeedbackProcessClose = async (pid: number, exitCode: number) => {
    console.log(`Import Module Process Closed with Process ID: ${pid} and Exit Code: ${exitCode}.`);

    // Early return if the process was terminated by the user
    if (wasTerminatedByUser.current) {
      console.log("The process was terminated by the user. Resetting refs and setting status back to standby.");
      resetRefs();
      setProcStatus("Standby");
      return;
    } else {
      const values = getValues();
      // if (currentTask.current === values.ImportContexts.length) {
      console.log(`StepRunImportModule: All tasks completed. Resetting the current PID to -1`);
      resetRefs();
      setProcStatus("Standby");

      // Only give snackbar info feedback if the user did not terminate the process
      setImportModuleSnackbar({
        severity: "info",
        title: "Import Completed",
        message: [
          "All Import Contexts have been imported.",
          `Before proceeding, you are recommended to review the contents of the following directories in order to verify import success:`,
          `${api.path.osSpecificString(values.StudyRootPath, "rawdata")}`,
          `${api.path.osSpecificString(values.StudyRootPath, "derivatives", "ExploreASL", "log")}`,
        ],
      });
    }
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

  /** Handler for starting up the Import Module */
  const handleValidSubmit: SubmitHandler<ImportSchemaType> = async (values) => {
    console.log("Step 'Run Import Module' -- Valid Submit Values: ", values);
    const { payload, GUIMessage } = await api.invoke("ExploreASL:RunImportModule", ImportModuleChannelName, values);

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

  /** Handler for attempting to start the Import Module with invalid values that may have changed since the last step */
  const handleInvalidSubmit: SubmitErrorHandler<ImportSchemaType> = (errors) => {
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

  /** Handler for pausing the current Import Module execution */
  const handlePause = async () => {
    // Sanity check
    if (currentProcPID.current === -1 || procStatus !== "Running") {
      console.log("Cannot pause Import Module, as the current state is not running");
      return;
    }
    // Send the pause command
    console.log("StepRunImportModule -- Sending pause command");
    const pauseResult = await api.invoke("ChildProcess:Pause", currentProcPID.current, ImportModuleChannelName);
    console.log("StepRunImportModule -- Pause Result: ", pauseResult);
  };

  /** Handler for resuming a paused and pending Import Module execution */
  const handleResume = async () => {
    // Sanity check
    if (currentProcPID.current === -1 || procStatus !== "Paused") {
      console.log("Cannot resume Import Module, as the current state is not paused");
      return;
    }
    // Send the resume command
    console.log("StepRunImportModule -- Sending resume command");
    const resumeResult = await api.invoke("ChildProcess:Resume", currentProcPID.current, ImportModuleChannelName);
    console.log("StepRunImportModule -- Resume Result: ", resumeResult);
  };

  /** Handler for killing the child process executing the Import Module */
  const handleTerminate = async () => {
    if (procStatus === "Standby") {
      console.log("Import Module Process is in Standby; nothing to terminate");
      return;
    }
    // Send the terminate command and set the current PID to -1 in order to allow handleProcessClose to not start any followup tasks
    const procToTerminate = currentProcPID.current;
    currentProcPID.current = -1;
    wasTerminatedByUser.current = true;
    console.log("StepRunImportModule -- Sending terminate command");
    const terminateResult = await api.invoke("ChildProcess:Terminate", procToTerminate, ImportModuleChannelName);
    console.log("StepRunImportModule -- Terminate Result: ", terminateResult);
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
