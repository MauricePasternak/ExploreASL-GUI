import { contextBridge, ipcRenderer } from "electron";
import { Options as FastGlobOptions } from "fast-glob";
import { JsonReadOptions, JsonWriteOptions } from "fs-extra";
import { cpus } from "os";
import { basename } from "path";
import Path from "pathlib-js";
import { getFilepathType, getTree, loadJSONSafe, recursiveDelete } from "./backend/filepathFunctions";
// LOCAL IMPORTS
import { ExtractChannelName } from "./common/types/utilityTypes";
import MappingIPCMainEventsToHanders, {
	InvokeEventNames,
	InvokeHandlerSignature,
} from "./ipc/MappingIPCMainEventsToHanders";
import { MappingIPCRendererEventsType } from "./ipc/MappingIPCRendererEvents";
import { rm } from "fs/promises";

const pathOperations = {
	/**
	 * Wrapper for determining whether the filepath is a file, directory, other, or non-existent.
	 * @param filePath Filepath to be assessed.
	 * @returns One of "dir", "file", "other", or false if the filepath does not exist.
	 */
	getFilepathType: async (filePath: string) => await getFilepathType(filePath),
	/**
	 * Wrapper for determining the nature of multiple filepaths.
	 * @param filePaths Filepaths to be assessed.
	 * @returns An array of whose elements are one of "dir", "file", "other", or false if the filepath does not exist.
	 */
	getFilepathsType: async (filePaths: string[]) => await Promise.all(filePaths.map((fp) => getFilepathType(fp))),
	/**
	 * Converts a string representation of a filepath into a Path-like instance.
	 * @param filePath Filepath to be converted.
	 * @returns A Path instance lacking the methods (as electron cannot include methods in the IPC transfer).
	 */
	asPath: (...filePath: string[]) => {
		return new Path(...filePath).toJSON();
	},
	/**
	 * Resolves a filepath to be os-specific.
	 * @param filePath Filepath to be converted.
	 * @returns A string representation of the filepath that is correct to the operating system.
	 */
	osSpecificString: (...filePath: string[]) => {
		const path = new Path(...filePath);
		return process.platform === "win32" ? path.toString(true) : path.path;
	},
	/**
	 *
	 * @param filePath Filepath to be assessed.
	 * @returns A boolean of whether the filepath exists or not.
	 */
	filepathExists: async (filePath: string) => await new Path(filePath).exists(),
	getBasename: (filePath: string) => basename(filePath),
	/**
	 * Gets the parent/grandparent/great-grandparent/etc. of a filepath.
	 * @param filePath Filepath to be assessed.
	 * @param level The number of levels to go up in the filepath in retrieving some ancestor path.
	 * @returns A `PathJSON` instance of the ancestor path.
	 */
	parent: (filePath: string, level = 1) => new Path(filePath).parent(level).toJSON(),
	getTree: getTree,
	/**
	 * Globs for patterns from a given starting filepath.
	 * @param filepath The filepath to be globbed.
	 * @param patterns The patterns to be globbed for.
	 * @param options fast-glob options.
	 * @returns An array of Path objects that match the patterns.
	 */
	glob: (filepath: string, patterns: string[] | string, options?: FastGlobOptions) =>
		new Path(filepath).glob(patterns, options),
	/**
	 * Checks whether a given basename is within the provided parent directory.
	 * @param filepath The filepath to be assessed.
	 * @param child The basename or array of basenames to be searched for.
	 * @returns An array of either false or Path objects that match the basename(s).
	 */
	containsImmediateChild: async (filepath: string, child: string) =>
		await new Path(filepath).containsImmediateChild(child),
	containsChildren: async (filepath: string, children: string | string[]) => {
		const fp = new Path(filepath);
		if (!Array.isArray(children)) children = [children];
		return await Promise.all(children.map((child) => fp.resolve(child).exists()));
	},
	/**
	 * Deletes the filepath from the system.
	 * @param filePath Filepath to be deleted.
	 */
	deleteFilepath: async (filePath: string) => {
		const asPath = new Path(filePath);
		console.log(`Backend attempting to delete ${asPath.path}...`);
		try {
			return await rm(new Path(filePath).path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
		} catch (error) {
			console.log(
				`Encountered error ${error.code} when trying to delete ${asPath.path}. Trying with the recursiveDelete function.`
			);
			// ENOEMPTY can sometimes be thrown when trying to delete a directory that is not empty. We have to recurse in that case.
			try {
				return await recursiveDelete(new Path(filePath));
			} catch (error) {
				console.log(`Even recursiveDelete failed to delete ${asPath.path}. Encountered error: ${error}`);
			}
		}
	},

	getPathsAtNthLevel: async (filepath: string, nthLevel: number, globOptions?: FastGlobOptions) =>
		await new Path(filepath).getPathsNLevelsAway(nthLevel, false, globOptions),

	writeJSON: async (filepath: string, data: any, options?: JsonWriteOptions) =>
		await new Path(filepath).writeJSON(data, options),

	readJSON: async (filepath: string, options?: string | JsonReadOptions) => await new Path(filepath).readJSON(options),

	readJSONSafe: async (filepath: string, options?: string | JsonReadOptions) => await loadJSONSafe(filepath, options),
};

const ApplicationProgramInterface = {
	// Add more here as needed
	cpuCount: cpus().length,
	platform: process.platform,
	path: pathOperations,

	// Communication Properties
	/**
	 * Listen for an event coming from the backend.
	 * @param channel The channel that the frontend should listen on. The following channel suffixes are in play to inform the frontend:
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
	 * @param listener The corresponding listener function.
	 */
	on<K extends string, T = ExtractChannelName<K>>(
		channel: K,
		listener: MappingIPCRendererEventsType[T extends keyof MappingIPCRendererEventsType ? T : never]
	) {
		// @ts-expect-error A spread argument must either have a tuple type or be passed to a rest parameter.
		ipcRenderer.on(channel, (event, ...args) => listener(...args));
	},
	/**
	 * Listen **only once** for an event coming from the backend.
	 * @param channel The channel that the frontend should listen on. The following channel suffixes are in play to inform the frontend:
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
	 * @param listener The corresponding listener function.
	 */
	// IPC Renderer API for continually listening to a "send" callback coming from IPCMain
	once<K extends string, T = ExtractChannelName<K>>(
		channel: K,
		listener: MappingIPCRendererEventsType[T extends keyof MappingIPCRendererEventsType ? T : never]
	): void {
		// @ts-expect-error A spread argument must either have a tuple type or be passed to a rest parameter.
		ipcRenderer.once(channel, (event, ...args) => listener(...args));
	},

	// IPC Renderer API for removing a particular function from being called due to a "send" message from IPCMain
	removeListener<K extends string, T = ExtractChannelName<K>>(
		channel: K,
		listener: MappingIPCRendererEventsType[T extends keyof MappingIPCRendererEventsType ? T : never]
	) {
		ipcRenderer.removeListener(channel, listener);
	},

	// IPC Renderer API for removing all functions associated with a particular event/channel name
	removeAllListeners<K extends string, T = ExtractChannelName<K>>(
		channel: T extends keyof MappingIPCRendererEventsType ? K : never
	) {
		ipcRenderer.removeAllListeners(channel as unknown as string);
	},

	/**
	 * IPC Renderer API for sending data from IPCRenderer to IPCMain
	 * Current Events, which are intended to be sent from the frontend to the backend, are as follows:
	 * * `App:Minimize` - Minimize the main window.
	 * * `App:Maximize` - Maximize the main window.
	 * * `App:Quit` - Quit the application.
	 * * `App:SoundNotification` - Play a sound notification.
	 * * `Dialog:OpenDialog` - Open a file/folder dialogue and return filepaths.
	 * * `Dialog:OpenMessageBox` - Open a message box and return the response.
	 * * `FSWatcher:Initialize` - Initialize the filepath watcher.
	 * * `FSWatcher:Shutdown` - Shutdown the filepath watcher.
	 * * `ChildProcess:Pause` - Pauses a given child process based on its PID.
	 * * `ChildProcess:Resume` - Resumes a given child process based on its PID.
	 * * `ChildProcess:Terminate` - Terminates a given child process based on its PID.
	 * * `ExploreASL:RunImportModule` - Runs an ExploreASL module.
	 * * `ExploreASL:RunExploreASL` - Runs the main modules of the ExploreASL program.
	 * * `NIFTI:Load` - Loads the array numerical data coming from a NIFTI file.
	 * * `Dataframe:Load` - Loads a dataframe from a CSV/TSV file as a CSV-encoded string to the frontend.
	 * * `Shortcut:Register` - Registers a event callbacks to be emitted when users click certain keyboard shortcuts.
	 * * `Shortcut:Unregister` - Halts the emission of event callbacks when users click certain keyboard shortcuts.
	 * @param channel One of the above channels to execute their corresponding handler function.
	 * @param args Arguments to provide to the handler function.
	 * @returns The return of the handler function, as a Promise (must be awaited)
	 */
	async invoke<InvokeEventName extends InvokeEventNames>(
		channel: InvokeEventName,
		...args: InvokeHandlerSignature<InvokeEventName>
	): Promise<ReturnType<typeof MappingIPCMainEventsToHanders[InvokeEventName]>> {
		return await ipcRenderer.invoke(channel, ...args);
	},
};

// This allows the frontend to access functions defined here using the "api" property that
// will be tacked onto the window object.
contextBridge.exposeInMainWorld("api", ApplicationProgramInterface);

// We export this so that it can be declared in the types/declarations.d.ts file and allow
// typescript autocompletion when using the api property of the windows object.
export default ApplicationProgramInterface;
