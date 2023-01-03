var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { PathWatcher } from "pathlib-js";
import chokidar from "chokidar";
import { respondToIPCRenderer } from "../ipc/MappingIPCRendererEvents";
import { platform } from "os";
export const GLOBAL_WATCHERS = {};
/**
 * Helper function for getting a `PathWatcher` that is ready by the time it is returned.
 * @param paths - Array of paths to watch
 * @param options - Options for the watcher
 * @returns A `PathWatcher` instance that is guareenteed to have emitted a `ready` event.
 */
export function getReadyPathWatcher(paths, options) {
    return new Promise((resolve) => {
        const watcher = new PathWatcher(options);
        watcher.add(paths);
        watcher.on("ready", () => {
            resolve(watcher);
        });
    });
}
export function handleInitializeWatcher(event, responseChannel, filepath, options) {
    console.log("Initializing watcher for", filepath);
    const defaultOptions = { depth: 5 };
    options = Object.assign(defaultOptions, options);
    const watcher = chokidar.watch(filepath, options);
    watcher.on("all", (watcherEvent, path) => {
        respondToIPCRenderer(event, `${responseChannel}:FSWatcherEvent`, watcherEvent, path);
    });
    watcher.on("error", (error) => {
        console.log("Watcher error", error);
        // Ignore EPERM errors in windows, which happen if you delete watched folders...
        // @ts-ignore
        if (platform() === "win32")
            return;
    });
    GLOBAL_WATCHERS[filepath] = watcher;
}
export function handleShutdownWatcher(event, filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        if (Object.keys(GLOBAL_WATCHERS).includes(filepath)) {
            yield GLOBAL_WATCHERS[filepath].close();
            delete GLOBAL_WATCHERS[filepath];
            console.log("Watcher closed for", filepath);
            return true;
        }
        else {
            throw new Error(`No watcher found for filepath: ${filepath}`);
        }
    });
}
//# sourceMappingURL=filepathWatcherFunctions.js.map