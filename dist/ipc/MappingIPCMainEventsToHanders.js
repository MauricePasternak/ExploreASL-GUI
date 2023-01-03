/**
 * #######################################################################
 * THIS IS A BACKEND FILE DO NOT IMPORT FRONTEND VARIABLES INTO THIS FILE!
 * #######################################################################
 * This module is responsible for defining the mapping between event names used by `IPCRenderer.invoke()`
 * and the IPCMain handlers that will be invoked by the event
 */
import { handleProcessPause, handleProcessResume, handleProcessTerminate } from "../backend/childProcessFunctions";
import { mainWindow } from "..";
import { handleFilepathDialogue, handleMessageBox } from "../backend/dialogFunctions";
import { handleInitializeWatcher, handleShutdownWatcher } from "../backend/filepathWatcherFunctions";
import { handleRunImportModule } from "../backend/runImportModule";
import { handleRunExploreASL } from "../backend/runExploreASL";
import { handleLoadNifti } from "../backend/niftiFuncs";
import { globalShortcut, shell } from "electron";
import { handleLoadDataframe } from "../backend/dataforgeFuncs";
import { respondToIPCRenderer } from "./MappingIPCRendererEvents";
/**
 * Mapping of backend event names to their backend handlers. Convention is as follows:
 * - Keys are strings of event names used in the first argument of `IPCRenderer.invoke()`.
 * It is recommended that the event name follow the convention "Subject:Action" (i.e. "App:Minimize")
 * - Values are `IPCMain` handler functions that will be executed when the event is invoked by the frontend.
 * The handler functions are expected to be compatible with their first argument being IpcMainInvokeEvent.
 * * The current events are as follows (add more and document them here as needed):
 *     * `App:Minimize` - Minimize the main window.
 *     * `App:Maximize` - Maximize the main window.
 *     * `App:Quit` - Quit the application.
 *     * `App:SoundNotification` - Play a sound notification.
 *     * `Dialog:OpenDialog` - Open a file/folder dialogue and return filepaths.
 *     * `Dialog:OpenMessageBox` - Open a message box and return the response.
 *     * `FSWatcher:Initialize` - Initialize the filepath watcher.
 *     * `FSWatcher:Shutdown` - Shutdown the filepath watcher.
 *     * `ChildProcess:Pause` - Pauses a given child process based on its PID.
 *     * `ChildProcess:Resume` - Resumes a given child process based on its PID.
 *     * `ChildProcess:Terminate` - Terminates a given child process based on its PID.
 *     * `ExploreASL:RunImportModule` - Runs an ExploreASL module.
 *     * `ExploreASL:RunExploreASL` - Runs the main modules of the ExploreASL program.
 *     * `NIFTI:Load` - Loads the array numerical data coming from a NIFTI file.
 *     * `Dataframe:Load` - Loads a dataframe from a CSV/TSV file as a CSV-encoded string to the frontend.
 *     * `Shortcut:Register` - Registers a event callbacks to be emitted when users click certain keyboard shortcuts.
 *     * `Shortcut:Unregister` - Halts the emission of event callbacks when users click certain keyboard shortcuts.
 */
const MappingIPCMainEventsToHanders = {
    "App:Minimize": () => mainWindow.minimize(),
    "App:Maximize": () => (mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize()),
    "App:Quit": () => mainWindow.close(),
    "App:SoundNotification": () => {
        console.log("App:SoundNotification");
        shell.beep();
    },
    "Dialog:OpenDialog": handleFilepathDialogue,
    "Dialog:OpenMessageBox": handleMessageBox,
    "FSWatcher:Initialize": handleInitializeWatcher,
    "FSWatcher:Shutdown": handleShutdownWatcher,
    "ChildProcess:Resume": handleProcessResume,
    "ChildProcess:Pause": handleProcessPause,
    "ChildProcess:Terminate": handleProcessTerminate,
    "ExploreASL:RunImportModule": handleRunImportModule,
    "ExploreASL:RunExploreASL": handleRunExploreASL,
    "NIFTI:Load": handleLoadNifti,
    "Dataframe:Load": (event, filepath) => handleLoadDataframe(filepath),
    "Shortcut:Register": (event, responseChannel, accelerator) => {
        console.log(`Registering shortcut ${accelerator}`);
        globalShortcut.register(accelerator, () => respondToIPCRenderer(event, `${responseChannel}:shortcutTriggered`));
    },
    "Shortcut:Unregister": (event, accelerator) => {
        console.log(`Unregistering shortcut ${accelerator}`);
        globalShortcut.unregister(accelerator);
    }
};
export default MappingIPCMainEventsToHanders;
//# sourceMappingURL=MappingIPCMainEventsToHanders.js.map