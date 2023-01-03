var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import { useAtom, useSetAtom } from "jotai";
import React from "react";
import { atomProcStudyPIDs, atomSetStatusForAStudy } from "../../../stores/ProcessStudiesStore";
import { atomProcessStudiesSnackbar } from "../../../stores/SnackbarStore";
function RunEASLPauseResumeTerminateControls({ studyIndex, channelName, currentStatus, }) {
    const { api } = window;
    const [pids, setPids] = useAtom(atomProcStudyPIDs);
    const changeStatus = useSetAtom(atomSetStatusForAStudy);
    const setProcessStudiesSnackbar = useSetAtom(atomProcessStudiesSnackbar);
    console.log("RunEASLPauseResumeTerminateControls rendered with PIDS:", pids);
    const handlePause = () => __awaiter(this, void 0, void 0, function* () {
        const successfulPauses = [];
        for (const pid of pids) {
            const result = yield api.invoke("ChildProcess:Pause", pid, channelName, true);
            if (pids.includes(result.pid))
                successfulPauses.push(result.success);
        }
        if (successfulPauses.every((v) => v)) {
            changeStatus({ studyIndex: studyIndex, status: "Paused" });
        }
        else {
            setProcessStudiesSnackbar({
                severity: "error",
                title: "Failed to pause study",
                message: "If this problem persists, shut down the application and restart your system for safe measure.",
            });
        }
    });
    const handleResume = () => __awaiter(this, void 0, void 0, function* () {
        const successfulResumes = [];
        for (const pid of pids) {
            const result = yield api.invoke("ChildProcess:Resume", pid, channelName, true);
            if (pids.includes(result.pid))
                successfulResumes.push(result.success);
        }
        if (successfulResumes.every((v) => v)) {
            changeStatus({ studyIndex: studyIndex, status: "Running" });
        }
        else {
            setProcessStudiesSnackbar({
                severity: "error",
                title: "Failed to resume study",
                message: "If this problem persists, shut down the application and restart your system for safe measure.",
            });
        }
    });
    const handleTerminate = () => __awaiter(this, void 0, void 0, function* () {
        const successfulKills = [];
        console.log(`Killing the following processes: ${pids}`);
        for (const pid of pids) {
            const result = yield api.invoke("ChildProcess:Terminate", pid, channelName, true);
            console.log(`Attempting to kill PID ${pid} Result: ${result}`);
            if (pids.includes(result.pid))
                successfulKills.push(result.success);
        }
        if (successfulKills.every((v) => v)) {
            changeStatus({ studyIndex: studyIndex, status: "Standby" });
            setPids([]);
        }
        else {
            setProcessStudiesSnackbar({
                severity: "error",
                title: "Failed to terminate study",
                message: "If this problem persists, shut down the application and restart your system for safe measure.",
            });
        }
    });
    return (React.createElement(ButtonGroup, { variant: "contained", fullWidth: true, color: "inherit" },
        React.createElement(Button, { onClick: handleResume, disabled: currentStatus !== "Paused", variant: "contained", color: "success" }, "Resume"),
        React.createElement(Button, { onClick: handlePause, disabled: currentStatus !== "Running", variant: "contained", color: "warning" }, "Pause"),
        React.createElement(Button, { onClick: handleTerminate, disabled: currentStatus === "Standby", variant: "contained", color: "error" }, "Terminate")));
}
export default RunEASLPauseResumeTerminateControls;
//# sourceMappingURL=RunEASLPauseResumeTerminateControls.js.map