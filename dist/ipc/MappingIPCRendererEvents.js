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
 * - `shortcutTriggered` - Respond to the user clicking certain keyboard buttons/accelerators.
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
export function respondToIPCRenderer(event, responseChannel, ...args) {
    event.sender.send(responseChannel, ...args);
}
//# sourceMappingURL=MappingIPCRendererEvents.js.map