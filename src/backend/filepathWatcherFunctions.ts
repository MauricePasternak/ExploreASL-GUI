import chokidar, { WatchOptions } from "chokidar";
import { IpcMainEvent } from "electron";
import { respondToIPCRenderer } from "../communcations/MappingIPCRendererEvents";

export const GLOBAL_WATCHERS: { [key: string]: chokidar.FSWatcher } = {};

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
