/**
 * #######################################################################
 * THIS IS A BACKEND FILE DO NOT IMPORT FRONTEND VARIABLES INTO THIS FILE!
 * #######################################################################
 * This module is responsible for defining the mapping between event names used by IPCRenderer.invoke()
 * and the IPCMain handlers that will be invoked by the event
 */
import { handleProcessPause, handleProcessResume, handleProcessTerminate } from "../backend/childProcessFunctions";
import { mainWindow } from "..";
import { handleFilepathDialogue, handleMessageBox } from "../backend/dialogFunctions";
import { handleInitializeWatcher, handleShutdownWatcher } from "../backend/filepathWatcherFunctions";
import { DropFirstParameter } from "../common/types/utilityTypes";
import { handleRunImportModule } from "../backend/runImportModule";
import { handleRunExploreASL } from "../backend/runExploreASL";
import { handleLoadNifti } from "../backend/niftiFuncs";
import { IpcMainInvokeEvent } from "electron";
import { handleLoadDataframe } from "../backend/dataforgeFuncs";
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
 *     * `Dialog:OpenDialog` - Open a file/folder dialogue and return filepaths.
 *     * `Dialog:OpenMessageBox` - Open a message box and return the response.
 *     * `FSWatcher:Initialize` - Initialize the filepath watcher.
 *     * `FSWatcher:Shutdown` - Shutdown the filepath watcher.
 *     * `Process:Pause` - Pauses a given child process based on its PID.
 *     * `Process:Resume` - Resumes a given child process based on its PID.
 *     * `Process:Terminate` - Terminates a given child process based on its PID.
 *     * `ExploreASL:RunImportModule` - Runs an ExploreASL module.
 */
const MappingIPCMainEventsToHanders = {
  "App:Minimize": () => mainWindow.minimize(),
  "App:Maximize": () => (mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize()),
  "App:Quit": () => mainWindow.close(),
  "Dialog:OpenDialog": handleFilepathDialogue,
  "Dialog:OpenMessageBox": handleMessageBox,
  "FSWatcher:Initialize": handleInitializeWatcher,
  "FSWatcher:Shutdown": handleShutdownWatcher,
  "ChildProcess:Resume": handleProcessResume,
  "ChildProcess:Pause": handleProcessPause,
  "ChildProcess:Terminate": handleProcessTerminate,
  "ExploreASL:RunImportModule": handleRunImportModule,
  "ExploreASL:RunExploreASL": handleRunExploreASL,
  "NIFTI:load": handleLoadNifti,
  "Dataframe:Load": (event: IpcMainInvokeEvent, filepath: string) => handleLoadDataframe(filepath),
};

// These types will be used in the preload script
export type InvokeEventNames = keyof typeof MappingIPCMainEventsToHanders;
/**
 * A type which defines the parameters of IPCMain handlers.
 * The first parameter of the handler function, IPCMainInvokeEvent, is omitted.
 */
export type InvokeHandlerSignature<N extends InvokeEventNames> = DropFirstParameter<
  typeof MappingIPCMainEventsToHanders[N]
>;
export default MappingIPCMainEventsToHanders;
