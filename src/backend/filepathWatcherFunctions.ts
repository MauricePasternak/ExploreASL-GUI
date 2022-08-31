import Path, { PathWatcher } from "pathlib-js";
import chokidar, { WatchOptions } from "chokidar";
import { IpcMainEvent } from "electron";
import { respondToIPCRenderer } from "../communcations/MappingIPCRendererEvents";

export const GLOBAL_WATCHERS: { [key: string]: chokidar.FSWatcher } = {};

/**
 * Helper function for getting a `PathWatcher` that is ready by the time it is returned.
 * @param paths - Array of paths to watch
 * @param options - Options for the watcher
 * @returns A `PathWatcher` instance that is guareenteed to have emitted a `ready` event.
 */
export function getReadyPathWatcher(
  paths: string | string[] | Path | Path[],
  options?: WatchOptions
): Promise<PathWatcher> {
  return new Promise(resolve => {
    const watcher = new PathWatcher(options);
    watcher.add(paths);
    watcher.on("ready", () => {
      resolve(watcher);
    });
  });
}

export function handleInitializeWatcher(
  event: IpcMainEvent,
  responseChannel: string,
  filepath: string,
  options?: WatchOptions
) {
  const defaultOptions: WatchOptions = { depth: 5 };
  options = Object.assign(defaultOptions, options);
  const watcher = chokidar.watch(filepath, options);
  watcher.on("all", (watcherEvent, path) => {
    respondToIPCRenderer(event, `${responseChannel}:FSWatcherEvent`, watcherEvent, path);
  });
  GLOBAL_WATCHERS[filepath] = watcher;
}

export async function handleShutdownWatcher(event: IpcMainEvent, filepath: string) {
  if (Object.keys(GLOBAL_WATCHERS).includes(filepath)) {
    await GLOBAL_WATCHERS[filepath].close();
    delete GLOBAL_WATCHERS[filepath];
    console.log("Watcher closed for", filepath);
    return true;
  } else {
    throw new Error(`No watcher found for filepath: ${filepath}`);
  }
}
