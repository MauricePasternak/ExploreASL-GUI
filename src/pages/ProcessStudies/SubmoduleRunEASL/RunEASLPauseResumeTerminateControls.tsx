import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import { useAtom, useSetAtom } from "jotai";
import React from "react";
import { atomProcStudyPIDs, atomSetStatusForAStudy } from "../../../stores/ProcessStudiesStore";
import { RunEASLStatusType } from "../../../common/types/ExploreASLTypes";
import { atomProcessStudiesSnackbar } from "../../../stores/SnackbarStore";

function RunEASLPauseResumeTerminateControls({
  studyIndex,
  channelName,
  currentStatus,
}: {
  studyIndex: number;
  channelName: string;
  currentStatus: RunEASLStatusType;
}) {
  const { api } = window;
  const [pids, setPids] = useAtom(atomProcStudyPIDs);
  const changeStatus = useSetAtom(atomSetStatusForAStudy);
  const setProcessStudiesSnackbar = useSetAtom(atomProcessStudiesSnackbar);

  console.log("RunEASLPauseResumeTerminateControls rendered with PIDS:", pids);

  const handlePause = async () => {
    const successfulPauses: boolean[] = [];
    for (const pid of pids) {
      const result = await api.invoke("ChildProcess:Pause", pid, channelName, true);
      if (pids.includes(result.pid)) successfulPauses.push(result.success);
    }
    if (successfulPauses.every(v => v)) {
      changeStatus({ studyIndex: studyIndex, status: "Paused" });
    } else {
      setProcessStudiesSnackbar({
        severity: "error",
        title: "Failed to pause study",
        message: "If this problem persists, shut down the application and restart your system for safe measure.",
      });
    }
  };

  const handleResume = async () => {
    const successfulResumes: boolean[] = [];
    for (const pid of pids) {
      const result = await api.invoke("ChildProcess:Resume", pid, channelName, true);
      if (pids.includes(result.pid)) successfulResumes.push(result.success);
    }
    if (successfulResumes.every(v => v)) {
      changeStatus({ studyIndex: studyIndex, status: "Running" });
    } else {
      setProcessStudiesSnackbar({
        severity: "error",
        title: "Failed to resume study",
        message: "If this problem persists, shut down the application and restart your system for safe measure.",
      });
    }
  };

  const handleTerminate = async () => {
    const successfulKills: boolean[] = [];

    console.log(`Killing the following processes: ${pids}`);

    for (const pid of pids) {
      const result = await api.invoke("ChildProcess:Terminate", pid, channelName, true);
      console.log(`Attempting to kill PID ${pid} Result: ${result}`);
      if (pids.includes(result.pid)) successfulKills.push(result.success);
    }
    if (successfulKills.every(v => v)) {
      changeStatus({ studyIndex: studyIndex, status: "Standby" });
      setPids([]);
    } else {
      setProcessStudiesSnackbar({
        severity: "error",
        title: "Failed to terminate study",
        message: "If this problem persists, shut down the application and restart your system for safe measure.",
      });
    }
  };

  return (
    <ButtonGroup variant="contained" fullWidth color="inherit">
      <Button onClick={handleResume} disabled={currentStatus !== "Paused"} variant="contained" color="success">
        Resume
      </Button>
      <Button onClick={handlePause} disabled={currentStatus !== "Running"} variant="contained" color="warning">
        Pause
      </Button>
      <Button onClick={handleTerminate} disabled={currentStatus !== "Running"} variant="contained" color="error">
        Teminate
      </Button>
    </ButtonGroup>
  );
}

export default RunEASLPauseResumeTerminateControls;
