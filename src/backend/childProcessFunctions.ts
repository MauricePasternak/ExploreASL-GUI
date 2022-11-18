/**
 * This backend module is for functions handling child processes (kill, suspend, resume).
 */
// EXTERNAL IMPORTS
import { IpcMainEvent } from "electron";
import { createRequire } from "module";
import spawn from "cross-spawn";
import process from "process";
import treeKill from "tree-kill";
import { reverse as reverseLodash } from "lodash";
// LOCAL IMPORTS
import { sleep } from "../common/utilityFunctions/sleepFunctions";
import { respondToIPCRenderer } from "../ipc/MappingIPCRendererEvents";

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// TYPES
/**
 * The return type of backend handlers which alter the state of a child process.
 */
type ProcessFuncResult = {
  pid: number;
  success: boolean;
  error?: string | string[];
};
type handleProcessPauseWindowsFunc = (
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string
) => Promise<ProcessFuncResult>;
type handleProcessResumeWindowsFunc = (
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string
) => Promise<ProcessFuncResult>;
let handleProcessPauseWindows: null | handleProcessPauseWindowsFunc;
let handleProcessResumeWindows: null | handleProcessResumeWindowsFunc;

// The ntSuspendModule may not be available on Linux and Mac. This is a workaround.
interface ntSuspendModule {
  resume: (pid: number) => boolean;
  suspend: (pid: number) => boolean;
}
let ntsuspend: null | ntSuspendModule;
async function InitializeNtSuspend() {
  // Until Electron can support optional Dependencies imports, we have to comment the line out on Linux and Mac.
  // then comment it back in on Windows. UGH!
  try {
    ntsuspend = createRequire(import.meta.url)("./win32-x64_lib.node");
    // ntsuspend = await import("ntsuspend");
    console.log("Initialized ntsuspend module.", ntsuspend);
  } catch (error) {
    console.warn("\n%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%\nFailed to initialize ntsuspend module. Error:\n", error);
  }
}

function asyncTreeKill(
  pid: number,
  signal?: "SIGCONT" | "SIGTERM" | "SIGKILL" | "SIGSTOP"
): Promise<ProcessFuncResult> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (error) => {
      if (error) reject(error);
      else resolve({ pid, success: true });
    });
  });
}

/**
 * COMPATIBILITY WITH NTSUSPEND NOT BEING AVAILABLE ON UNIX
 */
if (process.platform === "win32") {
  InitializeNtSuspend();
  // hack to ensure reference changes for ntsuspend
  sleep(100);

  handleProcessPauseWindows = async (
    event: IpcMainEvent,
    pid: number,
    responseChannel?: string,
    verbose = true
  ): Promise<ProcessFuncResult> => {
    const errors = [] as string[];
    const exitsWereSuccess = [] as boolean[];
    // Pids are put in reverse since pausing should occur from deepest grandchild to most recent
    const pidsReverse = reverseLodash(getWindowsPIDS(pid));
    for (const childPid of [...pidsReverse, pid]) {
      try {
        const suspendResult = ntsuspend.suspend(childPid);
        // const suspendResult = await suspend(childPid);
        exitsWereSuccess.push(suspendResult);
        console.log(`Attempted to pause child process with PID ${childPid}. Success? ${suspendResult}`);
      } catch (error) {
        console.warn(`Could not resume PID #${childPid} due to error: ${error}`);
        errors.push(`Could not resume PID #${childPid} due to error: ${error}`);
      }
    }

    // Optionally, send a ping back to indicate the handle Pause has finished
    if (errors.length > 0) {
      if (responseChannel) {
        respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenPaused`, errors.join("\n"), true);
      }
      return { pid: pid, success: false, error: errors };
    } else {
      verbose && console.log(`Main Process successfully resumed process with PID ${pid}`);
      if (responseChannel)
        respondToIPCRenderer(
          event,
          `${responseChannel}:childProcessHasBeenPaused`,
          `Main Process paused process with PID ${pid} and had the following statuses: ${exitsWereSuccess.map(
            (v) => v
          )}`,
          false
        );
      return { pid: pid, success: true };
    }
  };

  handleProcessResumeWindows = async (
    event: IpcMainEvent,
    pid: number,
    responseChannel?: string,
    verbose = true
  ): Promise<ProcessFuncResult> => {
    const errors = [] as string[];
    const exitsWereSuccess = [] as boolean[];
    // Pids are resumed in the order of parent -> child -> grandchild, etc.
    const pidsForward = getWindowsPIDS(pid);
    for (const childPid of [pid, ...pidsForward]) {
      try {
        const resumeResult = ntsuspend.resume(childPid);
        // const resumeResult = await resume(childPid);
        console.log(`Attempted to resume child process with PID ${childPid}. Success? ${resumeResult}`);
      } catch (error) {
        console.warn(`Could not resume PID #${childPid} due to error: ${error}`);
        errors.push(`Could not resume PID #${childPid} due to error: ${error}`);
      }
    }
    // Optionally, send a ping back to indicate the handle Resume has finished
    if (errors.length > 0) {
      if (responseChannel) {
        respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenResumed`, errors.join("\n"), true);
      }
      return { pid: pid, success: false, error: errors };
    } else {
      verbose && console.log(`Main Process successfully resumed process with PID ${pid}`);
      if (responseChannel) {
        respondToIPCRenderer(
          event,
          `${responseChannel}:childProcessHasBeenResumed`,
          `Main Process resumed process with PID ${pid} and had the following statuses: ${exitsWereSuccess.map(
            (v) => v
          )}`,
          false
        );
      }
      return { pid: pid, success: true };
    }
  };
} else {
  // ntsuspend = null;
  handleProcessPauseWindows = null;
  handleProcessResumeWindows = null;
}

async function handleProcessPauseUnix(
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string
): Promise<ProcessFuncResult> {
  if (process.platform === "win32") throw new Error("This function cannot be executed on a Windows platform.");
  try {
    const result = await asyncTreeKill(pid, "SIGSTOP");
    if (responseChannel) {
      respondToIPCRenderer(
        event,
        `${responseChannel}:childProcessHasBeenPaused`,
        `Main Process successfully paused process with PID ${pid}`,
        false
      );
    }
    return result;
  } catch (error) {
    if (responseChannel) {
      respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenPaused`, error.message, true);
    }
    return { pid: pid, success: false, error: error };
  }
}

async function handleProcessResumeUnix(
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string
): Promise<ProcessFuncResult> {
  if (process.platform === "win32") throw new Error("This function cannot be executed on a Windows platform.");
  try {
    const result = await asyncTreeKill(pid, "SIGCONT");
    if (responseChannel) {
      respondToIPCRenderer(
        event,
        `${responseChannel}:childProcessHasBeenResumed`,
        `Main Process successfully resumed process with PID ${pid}`,
        false
      );
    }
    return result;
  } catch (error) {
    if (responseChannel) {
      respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenResumed`, error.message, true);
    }
    return { pid: pid, success: false, error: error };
  }
}

/**
 * Retrieve an array of process IDs in a Windows setting.
 * @param startingPid The PID from which to retrieve the PIDs of all descendants.
 * @returns An array of PIDs, the order of which follows child1 > grandchild1_1 ; child2 > grandchild2_1, grandchild2_2, etc.
 */
function getWindowsPIDS(startingPid: number) {
  if (process.platform !== "win32") {
    throw new Error("This function must only be executed on a Windows platform.");
  }

  // Instantiate the PIDs array which will be referenced in the recursive function
  const pids: number[] = [];

  /**
   * Adds the process ids of child processes to the outer-scope pids array.
   * @param parentPid The process ID of a parent process.
   */
  function getChildPids(parentPid: number) {
    const { stdout } = spawn.sync("wmic", ["process", "where", `(ParentProcessId=${parentPid})`, "get", "ProcessId"], {
      encoding: "ascii",
    });

    if (/\d+/gm.test(stdout)) {
      const childPids = stdout.match(/\d+/gm).map((pid) => parseInt(pid));
      for (const childPid of childPids) {
        pids.push(childPid);
        getChildPids(childPid);
      }
    }
  }
  getChildPids(startingPid);
  return pids;
}

/**
 * Handler for pausing a root process and all its children lauched by the application.
 * @param event IpcMainEvent given as placeholder argument, as this is intended to be used as an IpcMain handle.
 * @param pid The process ID of the root process from which all others should be paused.
 * @param responseChannel Name of the channel base to respond to.
 * Uses overall event name: `${responseChannel}:childProcessHasBeenPaused`
 */
export async function handleProcessPause(
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string,
  verbose?: boolean
) {
  verbose && console.log("Main Process recieved a request to pause process with PID ", pid);
  return process.platform === "win32"
    ? await handleProcessPauseWindows(event, pid, responseChannel)
    : await handleProcessPauseUnix(event, pid, responseChannel);
}

/**
 * Handler for resuming a paused root process and all its children lauched by the application.
 * @param event IpcMainEvent given as placeholder argument, as this is intended to be used as an IpcMain handle.
 * @param pid The process ID of the root process from which all others should be resumed.
 * @param responseChannel Name of the channel base to respond to.
 * Uses overall event name: `${responseChannel}:childProcessHasBeenResumed`
 */
export async function handleProcessResume(
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string,
  verbose?: boolean
) {
  verbose && console.log("Main Process recieved a request to resume process with PID ", pid);
  return process.platform === "win32"
    ? await handleProcessResumeWindows(event, pid, responseChannel)
    : await handleProcessResumeUnix(event, pid, responseChannel);
}

/**
 * Handler for terminating a root process and all its children lauched by the application.
 * @param event IpcMainEvent given as placeholder argument, as this is intended to be used as an IpcMain handle.
 * @param pid The process ID of the root process from which all others should be killed.
 * @param responseChannel Name of the channel base to respond to.
 * Uses overall event name: `${responseChannel}:childProcessHasBeenKilled`
 */
export async function handleProcessTerminate(
  event: IpcMainEvent,
  pid: number,
  responseChannel?: string,
  verbose = true
): Promise<ProcessFuncResult> {
  verbose && console.log("Main Process received a request to terminate process with PID ", pid);
  try {
    // Since we're using SIGTERM first, we should ensure that the process is resumed (if paused) so that we can gracefully end it.
    await handleProcessResume(event, pid);
    const result = await asyncTreeKill(pid, "SIGTERM");

    // Unresponsive attempts to end should be met with SIGKILL which can't be ignored
    if (result.error) {
      await asyncTreeKill(pid, "SIGKILL");
    }

    responseChannel &&
      respondToIPCRenderer(
        event,
        `${responseChannel}:childProcessHasBeenKilled`,
        `Successfully killed child process with PID: ${pid}`,
        false
      );
    return result;
  } catch (error) {
    respondToIPCRenderer &&
      respondToIPCRenderer(
        event,
        `${responseChannel}:childProcessHasBeenKilled`,
        `Failed to kill child process with PID: ${pid} due to error: ${error}`,
        true
      );
    return { pid: pid, success: false, error: error };
  }
}
