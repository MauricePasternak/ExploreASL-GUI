var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createRequire } from "module";
import spawn from "cross-spawn";
import process from "process";
import treeKill from "tree-kill";
import { reverse as reverseLodash } from "lodash";
// LOCAL IMPORTS
import { sleep } from "../common/utils/sleepFunctions";
import { respondToIPCRenderer } from "../ipc/MappingIPCRendererEvents";
let handleProcessPauseWindows;
let handleProcessResumeWindows;
let ntsuspend;
function InitializeNtSuspend() {
    return __awaiter(this, void 0, void 0, function* () {
        // Until Electron can support optional Dependencies imports, we have to comment the line out on Linux and Mac.
        // then comment it back in on Windows. UGH!
        try {
            ntsuspend = createRequire(import.meta.url)("./win32-x64_lib.node");
            // ntsuspend = await import("ntsuspend");
            console.log("Initialized ntsuspend module.", ntsuspend);
        }
        catch (error) {
            console.warn("\n%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%\nFailed to initialize ntsuspend module. Error:\n", error);
        }
    });
}
function asyncTreeKill(pid, signal) {
    return new Promise((resolve, reject) => {
        treeKill(pid, signal, (error) => {
            if (error)
                reject(error);
            else
                resolve({ pid, success: true });
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
    handleProcessPauseWindows = (event, pid, responseChannel, verbose = true) => __awaiter(void 0, void 0, void 0, function* () {
        const errors = [];
        const exitsWereSuccess = [];
        // Pids are put in reverse since pausing should occur from deepest grandchild to most recent
        const pidsReverse = reverseLodash(getWindowsPIDS(pid));
        for (const childPid of [...pidsReverse, pid]) {
            try {
                const suspendResult = ntsuspend.suspend(childPid);
                // const suspendResult = await suspend(childPid);
                exitsWereSuccess.push(suspendResult);
                console.log(`Attempted to pause child process with PID ${childPid}. Success? ${suspendResult}`);
            }
            catch (error) {
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
        }
        else {
            verbose && console.log(`Main Process successfully resumed process with PID ${pid}`);
            if (responseChannel)
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenPaused`, `Main Process paused process with PID ${pid} and had the following statuses: ${exitsWereSuccess.map((v) => v)}`, false);
            return { pid: pid, success: true };
        }
    });
    handleProcessResumeWindows = (event, pid, responseChannel, verbose = true) => __awaiter(void 0, void 0, void 0, function* () {
        const errors = [];
        const exitsWereSuccess = [];
        // Pids are resumed in the order of parent -> child -> grandchild, etc.
        const pidsForward = getWindowsPIDS(pid);
        for (const childPid of [pid, ...pidsForward]) {
            try {
                const resumeResult = ntsuspend.resume(childPid);
                // const resumeResult = await resume(childPid);
                console.log(`Attempted to resume child process with PID ${childPid}. Success? ${resumeResult}`);
            }
            catch (error) {
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
        }
        else {
            verbose && console.log(`Main Process successfully resumed process with PID ${pid}`);
            if (responseChannel) {
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenResumed`, `Main Process resumed process with PID ${pid} and had the following statuses: ${exitsWereSuccess.map((v) => v)}`, false);
            }
            return { pid: pid, success: true };
        }
    });
}
else {
    // ntsuspend = null;
    handleProcessPauseWindows = null;
    handleProcessResumeWindows = null;
}
function handleProcessPauseUnix(event, pid, responseChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform === "win32")
            throw new Error("This function cannot be executed on a Windows platform.");
        try {
            const result = yield asyncTreeKill(pid, "SIGSTOP");
            if (responseChannel) {
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenPaused`, `Main Process successfully paused process with PID ${pid}`, false);
            }
            return result;
        }
        catch (error) {
            if (responseChannel) {
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenPaused`, error.message, true);
            }
            return { pid: pid, success: false, error: error };
        }
    });
}
function handleProcessResumeUnix(event, pid, responseChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        if (process.platform === "win32")
            throw new Error("This function cannot be executed on a Windows platform.");
        try {
            const result = yield asyncTreeKill(pid, "SIGCONT");
            if (responseChannel) {
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenResumed`, `Main Process successfully resumed process with PID ${pid}`, false);
            }
            return result;
        }
        catch (error) {
            if (responseChannel) {
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenResumed`, error.message, true);
            }
            return { pid: pid, success: false, error: error };
        }
    });
}
/**
 * Retrieve an array of process IDs in a Windows setting.
 * @param startingPid The PID from which to retrieve the PIDs of all descendants.
 * @returns An array of PIDs, the order of which follows child1 > grandchild1_1 ; child2 > grandchild2_1, grandchild2_2, etc.
 */
function getWindowsPIDS(startingPid) {
    if (process.platform !== "win32") {
        throw new Error("This function must only be executed on a Windows platform.");
    }
    // Instantiate the PIDs array which will be referenced in the recursive function
    const pids = [];
    /**
     * Adds the process ids of child processes to the outer-scope pids array.
     * @param parentPid The process ID of a parent process.
     */
    function getChildPids(parentPid) {
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
export function handleProcessPause(event, pid, responseChannel, verbose) {
    return __awaiter(this, void 0, void 0, function* () {
        verbose && console.log("Main Process recieved a request to pause process with PID ", pid);
        return process.platform === "win32"
            ? yield handleProcessPauseWindows(event, pid, responseChannel)
            : yield handleProcessPauseUnix(event, pid, responseChannel);
    });
}
/**
 * Handler for resuming a paused root process and all its children lauched by the application.
 * @param event IpcMainEvent given as placeholder argument, as this is intended to be used as an IpcMain handle.
 * @param pid The process ID of the root process from which all others should be resumed.
 * @param responseChannel Name of the channel base to respond to.
 * Uses overall event name: `${responseChannel}:childProcessHasBeenResumed`
 */
export function handleProcessResume(event, pid, responseChannel, verbose) {
    return __awaiter(this, void 0, void 0, function* () {
        verbose && console.log("Main Process recieved a request to resume process with PID ", pid);
        return process.platform === "win32"
            ? yield handleProcessResumeWindows(event, pid, responseChannel)
            : yield handleProcessResumeUnix(event, pid, responseChannel);
    });
}
/**
 * Handler for terminating a root process and all its children lauched by the application.
 * @param event IpcMainEvent given as placeholder argument, as this is intended to be used as an IpcMain handle.
 * @param pid The process ID of the root process from which all others should be killed.
 * @param responseChannel Name of the channel base to respond to.
 * Uses overall event name: `${responseChannel}:childProcessHasBeenKilled`
 */
export function handleProcessTerminate(event, pid, responseChannel, verbose = true) {
    return __awaiter(this, void 0, void 0, function* () {
        verbose && console.log("Main Process received a request to terminate process with PID ", pid);
        try {
            // Since we're using SIGTERM first, we should ensure that the process is resumed (if paused) so that we can gracefully end it.
            yield handleProcessResume(event, pid);
            const result = yield asyncTreeKill(pid, "SIGTERM");
            // Unresponsive attempts to end should be met with SIGKILL which can't be ignored
            if (result.error) {
                yield asyncTreeKill(pid, "SIGKILL");
            }
            responseChannel &&
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenKilled`, `Successfully killed child process with PID: ${pid}`, false);
            return result;
        }
        catch (error) {
            respondToIPCRenderer &&
                respondToIPCRenderer(event, `${responseChannel}:childProcessHasBeenKilled`, `Failed to kill child process with PID: ${pid} due to error: ${error}`, true);
            return { pid: pid, success: false, error: error };
        }
    });
}
//# sourceMappingURL=childProcessFunctions.js.map