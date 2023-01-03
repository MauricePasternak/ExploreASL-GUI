import { app, BrowserWindow, globalShortcut, ipcMain, protocol, shell, } from "electron";
import { debounce as lodashDebounce } from "lodash";
import { join as pathJoin } from "path";
import treeKill from "tree-kill";
import { GLOBAL_CHILD_PROCESSES, MEDIAPROTOCOL } from "./common/GLOBALS";
import { sleep } from "./common/utils/sleepFunctions";
import MappingIPCMainEventsToHanders from "./ipc/MappingIPCMainEventsToHanders";
console.log(`MAIN_WINDOW_WEBPACK_ENTRY: ${MAIN_WINDOW_WEBPACK_ENTRY}`);
console.log(`MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: ${MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY}`);
// This turns off warnings in development mode
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
    // eslint-disable-line global-require
    app.quit();
}
// Register the media protocol for loading local media files into app without being hindered by CSP.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIAPROTOCOL, privileges: { bypassCSP: true } }]);
// This set up is preferred, as mainWindow can be exported to work with ipcMain handlers
export let mainWindow;
const createWindow = () => {
    sleep(100); // Hack; allows for other processes to start up before the window is created.
    const mainWindowOptions = {
        height: 750,
        width: 900,
        minWidth: 600,
        minHeight: 500,
        frame: false,
        show: false,
        icon: pathJoin(__dirname, "assets/appIcons/ExploreASLGUI_Logo_Blank.png"),
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        },
    };
    // For linux, we need to set the icon explicitly.
    if (process.platform === "linux") {
        Object.assign(mainWindowOptions, { icon: pathJoin(__dirname, "assets/appIcons/ExploreASLGUI_Logo_Blank.png") });
    }
    // Create the browser window.
    mainWindow = new BrowserWindow(mainWindowOptions);
    // and load the index.html of the app.
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    // Remove the default menu
    mainWindow.setMenu(null);
    // While beta-testing, we want to be able to refresh the app if it encounters an error.
    globalShortcut.register("CommandOrControl+R", () => mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.reload());
    // Open the DevTools in detached mode for less interference with CSS breakpoints.
    !app.isPackaged && mainWindow.webContents.openDevTools({ mode: "detach" });
    // Only show once it is actually ready to display the HTML content. This gives the appearance of a smoother opening
    mainWindow.on("ready-to-show", () => mainWindow.show());
    // Anchor links inside the GUI should open a separate browser window, not change the view inside the GUI
    mainWindow.webContents.on("new-window", function (e, url) {
        e.preventDefault();
        lodashDebounce((url) => shell.openExternal(url), 20)(url);
    });
    // Register the priveleged media protocol for loading local media files into app.
    protocol.registerFileProtocol(MEDIAPROTOCOL, (request, callback) => {
        const url = request.url.slice(MEDIAPROTOCOL.length + 3); // Remove the "protocolname://" prefix from the URL
        callback({ path: url }); // url is expected to be an absolute file path
    });
};
// Refuse second instance.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
else {
    app.on("second-instance", () => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on("ready", createWindow);
    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    app.on("window-all-closed", () => {
        app.quit();
        // if (process.platform !== 'darwin') {
        //   app.quit();
        // }
    });
    app.on("activate", () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
    app.on("quit", () => {
        // On complete quitout, kill all child processes to avoid zombies.
        if (GLOBAL_CHILD_PROCESSES.length > 0) {
            for (const pid of GLOBAL_CHILD_PROCESSES) {
                treeKill(pid);
            }
        }
    });
}
// Register IPCMain to listen for predefined events using the newer "handle" syntax.
for (const [eventName, handler] of Object.entries(MappingIPCMainEventsToHanders)) {
    ipcMain.handle(eventName, handler);
}
//# sourceMappingURL=index.js.map