/**
 * #######################################################################
 * THIS IS A FRONTEND FILE DO NOT IMPORT BACKEND VARIABLES INTO THIS FILE!
 * #######################################################################
 * This module is responsible for defining the mapping between event names used by IPCMainEvent.send()
 * These are also the same event names that `api.on` or `api.once` should listen for either as the exact name
 * or as a suffix in the format `{name}:channel` where name is dynamic and channel is a key in the mapping
 * feature below.
 */
import { IpcMainInvokeEvent } from "electron";
import { ExtractChannelName } from "../common/types/utilityTypes";
import { QuillFormat } from "../common/types/quillExtraTypes";
/**
 * Mapping between IPCMain event names (or their channel suffixes) and the signature of the handlers they correspond to.
 * These are intended to be used in 2 ways:
 * - defining the `"on"`, `"once"`, `"removeListener"`, and `"removeAllListeners"` methods of IPCRenderer in the global API
 * - helping utility functions in IPCMain understand what event names they should be used when responding.
 * The following channel suffixes are in play to inform the frontend:
 * - `childProcessHasBeenPaused` - Inform the frontend that a child process has been paused.
 * - `childProcessHasBeenResumed` - Inform the frontend that a child process has been resumed.
 * - `childProcessHasBeenKilled` - Inform the frontend that a child process has been terminated.
 * - `childProcessHasSpawned` - Inform the frontend that a child process has spawned.
 * - `childProcessHasClosed` - Inform the frontend that a child process has closed/exited.
 * - `childProcessHasErrored` - Inform the frontend that a child process has failed to spawn and/or could not be killed.
 * - `childProcessSTDOUT` - Pass a STDOUT stream of text to the frontend (i.e. to IPCQuill)
 * - `childProcessSTDERR` - Pass a STDERR stream of text to the frontend (i.e. to IPCQuill)
 * - `childProcessRequestsMediaDisplay` - The backend has detected a local file that it would like displayed on the frontend
 * - `FSWatcherEvent` - Inform the frontend about a child in a watched file structure.
 * - `progressBarIncrement` - Increment the value of a progressbar by a given amount.
 * - `progressBarReset` - Reset the value of a progressbar back to zero.
 */
export type MappingIPCRendererEventsType = {
  childProcessHasBeenPaused: (message?: string, isError?: boolean) => void;
  childProcessHasBeenResumed: (message?: string, isError?: boolean) => void;
  childProcessHasBeenKilled: (message?: string, isError?: boolean) => void;
  childProcessHasSpawned: (pid?: number, shouldClearText?: boolean) => void;
  childProcessHasClosed: (pid?: number, exitCode?: number, payloadOfLast?: Record<string, unknown>) => void;
  childProcessHasErrored: (pid?: number, err?: Error | string) => void;
  childProcessSTDOUT: (text: string, quillFormat?: QuillFormat) => void;
  childProcessSTDERR: (errorText: string, quillFormat?: QuillFormat) => void;
  childProcessRequestsMediaDisplay: (url: string) => void;
  FSWatcherEvent: (event: "add" | "addDir" | "change" | "unlink" | "unlinkDir", filepath: string) => void;
  progressBarIncrement: (amount: number) => void;
  progressBarReset: (resetTo?: number) => void;
};

/**
 * Wrapper function for IPCMainEvent.send() that provides type safety for the event name and payload.
 * @param event The Electron IPCMainInvokeEvent that will respond to IPCRenderer.
 * @param responseChannel The channel name to respond to. The following channel suffixes are in play to inform the frontend:
 * - `childProcessHasBeenPaused` - Inform the frontend that a child process has been paused.
 * - `childProcessHasBeenResumed` - Inform the frontend that a child process has been resumed.
 * - `childProcessHasBeenKilled` - Inform the frontend that a child process has been terminated.
 * - `childProcessHasSpawned` - Inform the frontend that a child process has spawned.
 * - `childProcessHasClosed` - Inform the frontend that a child process has closed/exited.
 * - `childProcessHasErrored` - Inform the frontend that a child process has failed to spawn and/or could not be killed.
 * - `childProcessSTDOUT` - Pass a STDOUT stream of text to the frontend (i.e. to IPCQuill)
 * - `childProcessSTDERR` - Pass a STDERR stream of text to the frontend (i.e. to IPCQuill)
 * - `childProcessRequestsMediaDisplay` - The backend has detected a local file that it would like displayed on the frontend
 * - `FSWatcherEvent` - Inform the frontend about a child in a watched file structure.
 * - `progressBarIncrement` - Increment the value of a progressbar by a given amount.
 * - `progressBarReset` - Reset the value of a progressbar back to zero.
 * @param args Additional arguments to return to IPCRenderer. Must match the expected signature in {@link MappingIPCRendererEventsType}
 * @example
 * ```
 * // In frontend:
 * api.on("foo:childProcessHasBeenKilled", (pid) => console.log(`Child process ${pid} has been killed`));
 *
 * // In backend:
 * const pid = 9001;
 * respondToIPCRenderer("foo:childProcessHasBeenKilled", pid);
 * ```
 */
export function respondToIPCRenderer<K extends string, T = ExtractChannelName<K>>(
  event: IpcMainInvokeEvent,
  responseChannel: T extends keyof MappingIPCRendererEventsType ? K : never,
  ...args: Parameters<MappingIPCRendererEventsType[T extends keyof MappingIPCRendererEventsType ? T : never]>
) {
  event.sender.send(responseChannel, ...args);
}
