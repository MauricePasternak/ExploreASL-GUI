var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Fade from "@mui/material/Fade";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useAtom, useSetAtom } from "jotai";
import React, { useEffect, useRef, useState } from "react";
import ExploreASLIcon from "../../../assets/svg/ExploreASLIcon.svg";
import { IPCQuill } from "../../../components/IPCComponents";
import { RHFMultiStepButtons } from "../../../components/RHFComponents/RHFMultiStep";
import { atomImportModuleCurrentProcStatus, ImportModuleChannelName } from "../../../stores/ImportPageStore";
import { atomImportModuleSnackbar } from "../../../stores/SnackbarStore";
export function StepRunImportModule({ currentStep, setCurrentStep, handleSubmit, formState, reset, getValues, }) {
    const { api } = window;
    const { isSubmitting } = formState;
    // Local State
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    // Atom States
    const [procStatus, setProcStatus] = useAtom(atomImportModuleCurrentProcStatus);
    const setImportModuleSnackbar = useSetAtom(atomImportModuleSnackbar);
    // Refs
    const currentProcPID = useRef(-1);
    const wasTerminatedByUser = useRef(false);
    /** Resets ref variables back to their default values */
    function resetRefs() {
        currentProcPID.current = -1;
        wasTerminatedByUser.current = false;
    }
    /** Handler for receiving a spawn child process event from the backend */
    const handleFeedbackProcessSpawn = (pid) => {
        console.log("Import Module Process Spawned with Process ID: ", pid);
        currentProcPID.current = pid;
        procStatus !== "Running" && setProcStatus("Running");
    };
    /** Handler for receiving an exit event from the backend */
    const handleFeedbackProcessClose = (pid, exitCode) => __awaiter(this, void 0, void 0, function* () {
        console.log(`Import Module Process Closed with Process ID: ${pid} and Exit Code: ${exitCode}.`);
        // Early return if the process was terminated by the user
        if (wasTerminatedByUser.current) {
            console.log("The process was terminated by the user. Resetting refs and setting status back to standby.");
            resetRefs();
            setProcStatus("Standby");
            return;
        }
        else {
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
    });
    const handleFeedbackProcessPaused = (message, failedToPause) => {
        console.log(`Import Module Process Paused with Message: ${message}`);
        console.log(`Import Module Process Paused with Error? ${failedToPause}`);
        console.log(`Import Module Process Paused with can set to Paused state? `, procStatus !== "Paused" && !failedToPause);
        procStatus !== "Paused" && !failedToPause && setProcStatus("Paused");
    };
    const handleFeedbackProcessResume = (message, failedToResume) => {
        console.log(`Import Module Process Resumed with Message: ${message}`);
        console.log(`Import Module Process Resumed with Error? ${failedToResume}`);
        console.log(`Import Module Process Resumed with can set to Running state? `, procStatus !== "Running" && !failedToResume);
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
    const handleValidSubmit = (values) => __awaiter(this, void 0, void 0, function* () {
        console.log("Step 'Run Import Module' -- Valid Submit Values: ", values);
        const { payload, GUIMessage } = yield api.invoke("ExploreASL:RunImportModule", ImportModuleChannelName, values);
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
    });
    /** Handler for attempting to start the Import Module with invalid values that may have changed since the last step */
    const handleInvalidSubmit = (errors) => {
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
    const handlePause = () => __awaiter(this, void 0, void 0, function* () {
        // Sanity check
        if (currentProcPID.current === -1 || procStatus !== "Running") {
            console.log("Cannot pause Import Module, as the current state is not running");
            return;
        }
        // Send the pause command
        console.log("StepRunImportModule -- Sending pause command");
        const pauseResult = yield api.invoke("ChildProcess:Pause", currentProcPID.current, ImportModuleChannelName);
        console.log("StepRunImportModule -- Pause Result: ", pauseResult);
    });
    /** Handler for resuming a paused and pending Import Module execution */
    const handleResume = () => __awaiter(this, void 0, void 0, function* () {
        // Sanity check
        if (currentProcPID.current === -1 || procStatus !== "Paused") {
            console.log("Cannot resume Import Module, as the current state is not paused");
            return;
        }
        // Send the resume command
        console.log("StepRunImportModule -- Sending resume command");
        const resumeResult = yield api.invoke("ChildProcess:Resume", currentProcPID.current, ImportModuleChannelName);
        console.log("StepRunImportModule -- Resume Result: ", resumeResult);
    });
    /** Handler for killing the child process executing the Import Module */
    const handleTerminate = () => __awaiter(this, void 0, void 0, function* () {
        if (procStatus === "Standby") {
            console.log("Import Module Process is in Standby; nothing to terminate");
            return;
        }
        // Send the terminate command and set the current PID to -1 in order to allow handleProcessClose to not start any followup tasks
        const procToTerminate = currentProcPID.current;
        currentProcPID.current = -1;
        wasTerminatedByUser.current = true;
        console.log("StepRunImportModule -- Sending terminate command");
        const terminateResult = yield api.invoke("ChildProcess:Terminate", procToTerminate, ImportModuleChannelName);
        console.log("StepRunImportModule -- Terminate Result: ", terminateResult);
    });
    return (React.createElement(Fade, { in: true },
        React.createElement("form", { onSubmit: handleSubmit(handleValidSubmit, handleInvalidSubmit) },
            React.createElement(Box, { mt: 3, pb: 5 },
                React.createElement(Card, null,
                    React.createElement(CardHeader, { title: React.createElement(Typography, { variant: "h4" }, "Run Import Module"), subheader: React.createElement(Typography, null, "Run ExploreASL's Import Module and view progress"), avatar: procStatus === "Running" ? (React.createElement(CircularProgress, null)) : (React.createElement(Avatar, null,
                            React.createElement(SvgIcon, { component: ExploreASLIcon, inheritViewBox: true }))) }),
                    React.createElement(Divider, null),
                    React.createElement(CardContent, null,
                        React.createElement(Box, null,
                            React.createElement(Typography, { variant: "subtitle1" }, "ExploreASL Progress Feedback"),
                            React.createElement(IPCQuill, { defaultHeight: "calc(100vh - 375px)", channelName: ImportModuleChannelName })),
                        React.createElement(ButtonGroup, { variant: "contained", fullWidth: true, color: "inherit", sx: { mt: 2 } },
                            React.createElement(Button, { className: "ImportSubmoduleResumeButton", disabled: procStatus !== "Paused" || isSubmitting, onClick: handleResume, endIcon: React.createElement(PlayCircleOutlineIcon, null), variant: "contained", color: "success" }, "Resume"),
                            React.createElement(Button, { className: "ImportSubmodulePauseButton", disabled: procStatus !== "Running" || isSubmitting, onClick: handlePause, endIcon: React.createElement(PauseCircleOutlineIcon, null), variant: "contained", color: "warning" }, "Pause"),
                            React.createElement(Button, { className: "ImportSubmoduleKillButton", disabled: procStatus === "Standby" || isSubmitting, onClick: handleTerminate, endIcon: React.createElement(StopCircleIcon, null), variant: "contained", color: "error" }, "Terminate")))),
                React.createElement(RHFMultiStepButtons, { currentStep: currentStep, setCurrentStep: setCurrentStep, backButtonProps: { disabled: isSubmitting || procStatus !== "Standby" }, nextButtonProps: { disabled: isSubmitting || procStatus !== "Standby" }, nextButtonText: "Run ExploreASL Import Module" },
                    React.createElement(Divider, { sx: { borderWidth: 1 }, variant: "middle", flexItem: true, orientation: "vertical" }),
                    React.createElement(Button, { size: "large", disabled: isSubmitting || procStatus !== "Standby", onClick: () => setResetDialogOpen(true) }, "RESET ALL")),
                React.createElement(ConfirmResetDialog, { resetDialogOpen: resetDialogOpen, setResetDialogOpen: setResetDialogOpen, setCurrentStep: setCurrentStep, reset: reset })))));
}
function ConfirmResetDialog({ resetDialogOpen, setResetDialogOpen, setCurrentStep, reset, }) {
    return (React.createElement(Dialog, { open: resetDialogOpen },
        React.createElement(DialogTitle, null, "Reset Back to First Step?"),
        React.createElement(DialogContent, null,
            React.createElement(DialogContentText, null, "Are you sure you want to reset the module and go back to the first step?")),
        React.createElement(DialogActions, null,
            React.createElement(Button, { onClick: () => setResetDialogOpen(false) }, "Cancel"),
            React.createElement(Button, { onClick: () => {
                    setResetDialogOpen(false);
                    reset();
                    setCurrentStep(0);
                }, autoFocus: true }, "Confirm"))));
}
//# sourceMappingURL=StepRunImportModule.js.map