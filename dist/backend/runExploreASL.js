var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import spawn from "cross-spawn";
import { range as lodashRange } from "lodash";
import Path, { PathWatcher } from "pathlib-js";
import { CreateRuntimeError } from "../common/errors/runExploreASLErrors";
import { GLOBAL_CHILD_PROCESSES } from "../common/GLOBALS";
import { EASLWorkloadMapping } from "../common/schemas/ExploreASLWorkloads/ExploreASLWorkloads";
import { MATLABCommandLineArgsPost2019, MATLABCommandLineArgsPre2019, } from "../common/schemas/MATLABCommandLineArgs";
import { calculatePercent } from "../common/utils/numberFunctions";
import { sleep } from "../common/utils/sleepFunctions";
import { matlabEscapeBlockChar } from "../common/utils/stringFunctions";
import { Lock } from "../common/utils/threadingFunctions";
import { respondToIPCRenderer } from "../ipc/MappingIPCRendererEvents";
import { calculateWorkload, createRuntimeEnvironment, getExploreASLExitSummary, getExploreASLVersion, getMATLABPathAndVersion, RemoveBIDS2LegacyLockDirs, } from "./runExploreASLHelperFunctions";
export function handleRunExploreASL(event, channelName, dataPar, studySetup) {
    var _a, e_1, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        // console.log(`EASLProcess ${channelName} -- dataPar:`, dataPar);
        const defaultPayload = { pids: [-1], channelName };
        let MATLABGithubArgs;
        /***********************
         * STEP 0: Sanity Checks
         **********************/
        if (!["linux", "darwin", "win32"].includes(process.platform)) {
            return {
                GUIMessage: {
                    severity: "error",
                    title: "Non-supported platform",
                    messages: [`The platform ${process.platform} is not supported by ExploreASL.`],
                },
                payload: defaultPayload,
            };
        }
        /******************************************************************
         * STEP 1: get the ExploreASL Program version and the Workload type
         *****************************************************************/
        const { EASLVersionPath, EASLVersionNumber } = yield getExploreASLVersion(dataPar.x.GUI.EASLPath);
        if (!EASLVersionPath || !EASLVersionNumber) {
            return {
                GUIMessage: {
                    severity: "error",
                    title: "No ExploreASL version found",
                    messages: [
                        "No valid ExploreASL version found in the provided ExploreASL folder:",
                        `${new Path(dataPar.x.GUI.EASLPath).toString(true)}`,
                        " ",
                        "This is necessary to the operation of this program.",
                    ],
                },
                payload: defaultPayload,
            };
        }
        if (!(EASLVersionPath.basename in EASLWorkloadMapping)) {
            return {
                GUIMessage: {
                    title: "ExploreASL Executable Version Incompatible",
                    severity: "error",
                    messages: ["ExploreASL must be at least version 1.9.0 in order to be executed."],
                },
                payload: defaultPayload,
            };
        }
        // We use the version number to determine specific behaviors
        console.log(`EASLProcess ${channelName} -- EASLVersionNumber:`, EASLVersionNumber);
        const workloadMapping = EASLWorkloadMapping[EASLVersionPath.basename];
        /************************************************************************
         * STEP 2: Get the MATLAB Versions and Calculate the anticipated Workload
         ***********************************************************************/
        const [{ matlabPath, matlabVersion, message: getMatlabMessage }, getWorkloadResult] = yield Promise.all([
            getMATLABPathAndVersion(),
            calculateWorkload(dataPar, studySetup, workloadMapping),
        ]);
        console.log(`EASL Process ${channelName} -- getMATLABResult`, { matlabPath, matlabVersion });
        console.log(`EASL Process ${channelName} -- getWorkloadResult`, getWorkloadResult);
        let executablePath = "";
        /************************************************************************************
         * STEP 3: Ascertain the filepath of the executable to call (MATLAB or compile based)
         ***********************************************************************************/
        // For Github ExploreASL
        if (dataPar.x.GUI.EASLType === "Github") {
            if (!matlabPath || !matlabVersion) {
                return {
                    GUIMessage: {
                        title: "Could not locate MATLAB",
                        severity: "error",
                        messages: [
                            "Unable to determine the MATLAB path and/or version. Please ensure that MATLAB is installed and that the path to MATLAB is correctly configured.",
                            "The following error was encountered while attempting to determine the MATLAB path and version:",
                            " ",
                            getMatlabMessage,
                        ],
                    },
                    payload: defaultPayload,
                };
            }
            executablePath = matlabPath;
            const matlabVersionNumber = matlabVersion;
            if (matlabVersionNumber < 2016) {
                return {
                    GUIMessage: {
                        title: "MATLAB Version Incompatible",
                        severity: "error",
                        messages: [
                            "MATLAB must be at least version 2016b in order to be executed.",
                            "Please contact your system's administrator about upgrading.",
                            " ",
                            "Note that if you have multiple versions of MATLAB installed, this error may be the result of an earlier version having priority on your system.",
                        ],
                    },
                    payload: defaultPayload,
                };
            }
            else if (matlabVersionNumber < 2019) {
                MATLABGithubArgs = MATLABCommandLineArgsPre2019[process.platform];
            }
            else {
                MATLABGithubArgs = MATLABCommandLineArgsPost2019[process.platform];
            }
            // For compiled ExploreASL
        }
        else {
            const xASL_latest_dir = new Path(dataPar.x.GUI.EASLPath);
            const xASL_latest_basename = process.platform === "win32" ? "xASL_latest.exe" : "run_xASL_latest.sh";
            const xASL_runnable = yield xASL_latest_dir.containsImmediateChild(xASL_latest_basename);
            if (!xASL_runnable) {
                return {
                    GUIMessage: {
                        title: "Compiled ExploreASL Executable could not be found",
                        severity: "error",
                        messages: [
                            "Something went wrong.",
                            `There should be a file with name: ${xASL_latest_basename} located within the ExploreASL directory you specified:`,
                            `${xASL_latest_dir.path}`,
                        ],
                    },
                    payload: defaultPayload,
                };
            }
            executablePath = xASL_runnable.path;
        }
        console.log(`EASL Process ${channelName} -- executablePath`, executablePath);
        /*************************************
         * STEP 4: Assess the workload results
         ************************************/
        if (getWorkloadResult.GUIMessage.severity === "error" || getWorkloadResult.GUIMessage.severity === "info") {
            return {
                GUIMessage: getWorkloadResult.GUIMessage,
                payload: {
                    pids: [-1],
                    channelName: channelName,
                },
            };
        }
        const { anticipatedFilepaths, anticipatedWorkload } = getWorkloadResult.payload;
        const setOfAnticipatedFilepaths = new Set(anticipatedFilepaths);
        /****************************************
         * STEP 5: Create the runtime environment
         ***************************************/
        const EASLEnv = yield createRuntimeEnvironment(dataPar.x.GUI.EASLType, dataPar.x.GUI.EASLPath, dataPar.x.GUI.MATLABRuntimePath);
        if (EASLEnv instanceof CreateRuntimeError)
            return {
                GUIMessage: {
                    title: "Could not create the ExploreASL Runtime Environment",
                    severity: "error",
                    messages: [
                        "An Error occurred while trying to create the ExploreASL Runtime Environment:",
                        EASLEnv.message,
                        " ",
                        "Also ensure that you have the following environmental variables set depending on your operating system:",
                        "- for Windows, PATH",
                        "- for Mac, DYLD_LIBRARY_PATH",
                        "- for Linux, LD_LIBRARY_PATH",
                        "Contact your system's administrator about setting these variables.",
                    ],
                },
                payload: defaultPayload,
            };
        // console.log(`EASL Process ${channelName} -- EASLEnv`, EASLEnv);
        /********************************************
         * STEP 6: Delete any folders called "locked"
         *******************************************/
        const StudyDerivExploreASLDir = new Path(dataPar.x.GUI.StudyRootPath).resolve("derivatives", "ExploreASL");
        console.log(`EASL Process ${channelName} -- Proceeding to delete locked dirs for: ${StudyDerivExploreASLDir.path}`);
        try {
            for (var _d = true, _e = __asyncValues(StudyDerivExploreASLDir.globIter("**/locked", { onlyDirectories: true })), _f; _f = yield _e.next(), _a = _f.done, !_a;) {
                _c = _f.value;
                _d = false;
                try {
                    const filepath = _c;
                    try {
                        yield filepath.remove();
                    }
                    catch (error) {
                        console.warn(`An Error occurred while trying to delete filepath ${filepath.path}: ${error}`);
                        continue;
                    }
                }
                finally {
                    _d = true;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
        /********************************************************************************************************
         * STEP 7: In later versions of ExploreASL, we should automatically re-run BIDS2Legacy for the subjects
         * involved, especially if the user has changed BIDS-specific fields using the BIDSDatagrid module.
         *******************************************************************************************************/
        const BIDS2LegacyLockDir = StudyDerivExploreASLDir.resolve("lock", "xASL_module_BIDS2Legacy");
        if (EASLVersionNumber >= 110 &&
            studySetup.whichModulesToRun !== "Population" &&
            (yield BIDS2LegacyLockDir.exists())) {
            yield RemoveBIDS2LegacyLockDirs(BIDS2LegacyLockDir, [...setOfAnticipatedFilepaths]);
        }
        /*****************************************************
         * STEP 8: Define the behavior of the filepath watcher
         ****************************************************/
        // First define all the regexes, and translator mappings
        const regexLockDir = /lock\/xASL_module_(?<Module>ASL|Structural|Population|DARTEL_T1)\/?(?<Subject>.*)?\/xASL_module_(?:ASL|Structural|Population|DARTEL)_?(?<Session>.*)\/locked$/m;
        const regexStatusFile = /lock\/xASL_module_(?<Module>ASL|Structural|Population|DARTEL_T1)\/?(?<Subject>.*)?\/xASL_module_(?:ASL|Structural|Population|DARTEL)_?(?<Session>.*)\/.*\.status$/m;
        const regexImageFile = /(?<Axis>Cor|Tra)_(?<ImageType>Reg_rT1|Seg_rT1|Reg_noSmooth_M0|noSmooth_M0|Reg_qCBF|qCBF)(?!.*Contour)_(?<Target>[\w-]+?_\d?)_?.*\.jpe?g$/m;
        let debugCounter = 0;
        const lock = new Lock();
        const ImageTypeMapping = {
            // Structurals
            Reg_rT1: "MNI Space Coregistered T1-weighted Image",
            Seg_rT1: "MNI Space White Matter Segementation Overlaid upon a T1-weighted Image",
            // M0 Submodule
            noSmooth_M0: "MNI Space M0 Image without smoothing",
            Reg_noSmooth_M0: "MNI Space Gray Matter Segmentation Overlaid upon an unsmoothed M0 Image",
            // ASL Submodule
            Reg_qCBF: "MNI Space White Matter Segmentation Overlaid upon a CBF Image",
            qCBF: "MNI Space qCBF Image",
        };
        const AxisTypeMapping = {
            Tra: "Transverse",
            Cor: "Coronal",
            Sag: "Sagittal",
        };
        const SeenPaths = new Set();
        const SentImages = new Set();
        const studyFilepathWatcher = new PathWatcher({
            ignoreInitial: true,
            persistent: true,
            ignored: [
                `${StudyDerivExploreASLDir.path}/**/*.nii*`,
                `${StudyDerivExploreASLDir.path}/**/*.mat*`,
                `${StudyDerivExploreASLDir.path}/**/*.txt*`,
                `${StudyDerivExploreASLDir.path}/**/*.json*`,
                `${StudyDerivExploreASLDir.path}/**/*.csv*`,
                `${StudyDerivExploreASLDir.path}/**/*.tsv*`,
                `${StudyDerivExploreASLDir.path}/**/*.pdf*`,
                `${StudyDerivExploreASLDir.path}/**/*.log*`,
                `${StudyDerivExploreASLDir.resolve("Logs").path}/*`,
            ],
        });
        studyFilepathWatcher.add([
            StudyDerivExploreASLDir.resolve("lock").path,
            StudyDerivExploreASLDir.resolve("Population").path,
        ]);
        // When ready, should be responsible for clearing the processbar
        studyFilepathWatcher.on("ready", () => {
            console.log(`Watcher for channel ${channelName} is ready`);
            respondToIPCRenderer(event, `${channelName}:progressBarReset`);
        });
        // Handler for directories
        studyFilepathWatcher.on("addDir", (path) => __awaiter(this, void 0, void 0, function* () {
            if (SeenPaths.has(path.path))
                return;
            SeenPaths.add(path.path);
            if (regexLockDir.test(path.path)) {
                // Acquire lock, Respond to frontend, release lock
                const { Module, Subject, Session } = regexLockDir.exec(path.path)["groups"];
                const unlock = (yield lock.lock());
                if (Module === "ASL") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Starting ASL Module for Subject: ${Subject} -- Visit/Session: ${Session}`);
                }
                else if (Module === "Structural") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Starting Structural Module for Subject: ${Subject}`);
                }
                else if (Module === "Population") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, "Starting Population Module");
                }
                yield unlock();
            }
            else {
                console.log(`Watcher's "addDir" path: ${path.path} ... did not match any regex`);
            }
        }));
        // Handler for files
        studyFilepathWatcher.on("add", (path) => __awaiter(this, void 0, void 0, function* () {
            console.log(`Watcher's "add" event got path: ${path.path}`);
            if (SeenPaths.has(path.path))
                return;
            SeenPaths.add(path.path);
            // Decide whether this is a status file or an image file
            if (regexStatusFile.test(path.path)) {
                // THIS IS A STATUS FILE
                console.log("This is a status file");
                // Early Exit. Not one of the anticipated status files or the status file isn't supported
                if (!setOfAnticipatedFilepaths.has(path.path) || !(path.basename in workloadMapping))
                    return;
                // Get the data for the given status file
                const regexResult = regexStatusFile.exec(path.path);
                if (!("groups" in regexResult) || regexResult.groups == null) {
                    console.warn(`Could not parse image file ${path.path} ; regexResult: ${regexResult}`);
                    return;
                }
                const { Module, Subject, Session } = regexStatusFile.exec(path.path)["groups"];
                const statusFileCriteria = workloadMapping[path.basename];
                // Increment associated progressbar
                const progressbarIncrementAmount = calculatePercent(statusFileCriteria.loadingBarValue, anticipatedWorkload, 4) * 100;
                debugCounter += statusFileCriteria.loadingBarValue;
                console.log(`Incrementing progressbar by ${progressbarIncrementAmount}`, `based on a value of ${statusFileCriteria.loadingBarValue} `, `from a total of ${anticipatedWorkload}`);
                console.log(`The debug Counter post-addition is: ${debugCounter}`);
                respondToIPCRenderer(event, `${channelName}:progressBarIncrement`, progressbarIncrementAmount);
                // Acquire lock, Respond to frontend, release lock
                const unlock = (yield lock.lock());
                if (Module === "ASL") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Completed step in ${Module} Module for:\n\tSubject: ${Subject}\n\tSession: ${Session}\n\tDescription: ${statusFileCriteria.description}`);
                }
                else if (Module === "Structural") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Completed step in ${Module} Module for:\n\tSubject: ${Subject}\n\tDescription: ${statusFileCriteria.description}`);
                }
                else if (Module === "Population" || Module === "DARTEL_T1") {
                    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Completed step in ${Module} Module\n\tDescription: ${statusFileCriteria.description}`);
                }
                yield unlock();
                return; // END OF STATUS FILE SCENARIO
            }
            else if (regexImageFile.test(path.basename)) {
                // THIS IS AN IMAGE FILE
                // Do not display images if the module being run is the Population Module
                if (studySetup.whichModulesToRun === "Population")
                    return;
                // Get the data for the given image file
                const { Axis, ImageType, Target } = regexImageFile.exec(path.basename)["groups"];
                const whichImageType = ImageTypeMapping[ImageType];
                const whichAxis = AxisTypeMapping[Axis];
                const statement = `Processed a ${whichAxis} ${whichImageType} image for ${Target}:`;
                console.log(statement);
                // Acquire lock, Respond to frontend, release lock
                SentImages.add(path.path);
                const unlock = (yield lock.lock());
                yield sleep(100);
                console.log(`Sleeping for 100ms before sending image file ${path.path}`);
                respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, statement, { bold: true });
                respondToIPCRenderer(event, `${channelName}:childProcessRequestsMediaDisplay`, path.path);
                yield unlock();
                return; // END OF IMAGE FILE SCENARIO
            }
            return;
        }));
        // Handler for changed files
        studyFilepathWatcher.on("change", (path) => __awaiter(this, void 0, void 0, function* () {
            if (!regexImageFile.test(path.basename) ||
                SentImages.has(path.path) ||
                studySetup.whichModulesToRun === "Population")
                return;
            // THIS IS AN IMAGE FILE
            console.log("This is an image file");
            // Get the data for the given image file
            const { Axis, ImageType, Target } = regexImageFile.exec(path.basename)["groups"];
            const whichImageType = ImageTypeMapping[ImageType];
            const whichAxis = AxisTypeMapping[Axis];
            const statement = `Processed a ${whichAxis} ${whichImageType} for ${Target}:`;
            console.log(statement);
            // Acquire lock, Respond to frontend, release lock
            SentImages.add(path.path);
            const unlock = (yield lock.lock());
            // Currently this setup works...many need to implement a SetInterval & Queue alternative to Locks & Sleeps
            // if users report issues with this
            console.log(`Sleeping for 200ms before sending image file ${path.path}`);
            yield sleep(200); // This works to prevent premature cancellation of image render for some reason???
            respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, statement, { bold: true });
            respondToIPCRenderer(event, `${channelName}:childProcessRequestsMediaDisplay`, path.path);
            yield unlock();
            return; // END OF IMAGE FILE SCENARIO
        }));
        /****************************************************************************************
         * STEP 9: Spawn the child processs for the given module and define its callback behavior
         ***************************************************************************************/
        const moduleMapping = {
            Structural: `[1 0 0]`,
            ASL: `[0 1 0]`,
            Both: `[1 1 0]`,
            Population: `[0 0 1]`,
        };
        const whichModule = moduleMapping[studySetup.whichModulesToRun];
        const rangeArg = lodashRange(studySetup.numberOfCores);
        const nWorkers = rangeArg.length;
        const bPause = 0;
        const runImport = 0;
        const pids = [];
        const RunEASLExitSummaries = {
            exitSummaries: [],
            numIncompleteSteps: 0,
            missedStepsMessages: [],
        };
        for (let index = 0; index < rangeArg.length; index++) {
            const iWorker = rangeArg[index] + 1; // +1 due to MATLAB indexing rules
            console.log(`EASL Process ${channelName} -- ExploreASL-specific command:`, `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`);
            let child;
            if (dataPar.x.GUI.EASLType === "Github") {
                console.log(`EASL Process ${channelName} -- commandline input:\n`, `${executablePath}`, ...MATLABGithubArgs, `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`);
                child = spawn(executablePath, [
                    ...MATLABGithubArgs,
                    `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`,
                ], {
                    cwd: dataPar.x.GUI.EASLPath,
                    env: EASLEnv,
                });
            }
            else {
                console.log(`EASL Process ${channelName} -- commandline input:\n`, `${executablePath}`, dataPar.x.GUI.MATLABRuntimePath, dataPar.x.GUI.StudyRootPath, `${runImport}`, `${whichModule}`, `${bPause} ${iWorker} ${nWorkers}`);
                child = spawn(executablePath, [
                    dataPar.x.GUI.MATLABRuntimePath,
                    dataPar.x.GUI.StudyRootPath,
                    `${runImport}`,
                    `${whichModule}`,
                    `${bPause} ${iWorker} ${nWorkers}`,
                ], {
                    cwd: dataPar.x.GUI.EASLPath,
                    env: EASLEnv,
                });
            }
            // On failed spawn inform the frontend
            child.on("error", (err) => {
                console.warn(`Child process with ID: ${child.pid} has failed to spawn due to ERROR: ${err}`);
                respondToIPCRenderer(event, `${channelName}:childProcessHasErrored`, child.pid, err);
            });
            // On successful spawn, add to the globalChildProcesses and clear the corresponding text display
            child.on("spawn", () => {
                console.log("ExploreASL process has spawned with PID", child.pid);
                GLOBAL_CHILD_PROCESSES.push(child.pid);
                respondToIPCRenderer(event, `${channelName}:childProcessHasSpawned`, child.pid);
                respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, "STARTING UP MATLAB ExploreASL", { bold: true });
            });
            child.stdout.on("data", (data) => {
                // const asString = matlabEscapeBlockChar(data);
                // console.error(`STDOUT: ${asString}`);
            });
            // Process STDERR and forward it to the appropriate text display
            child.stderr.on("data", (data) => {
                const asString = matlabEscapeBlockChar(data);
                console.error(`STDERR: ${data}`);
                const currentColor = /^[Ww]arning/gm.test(asString) ? "orange" : "red";
                respondToIPCRenderer(event, `${channelName}:childProcessSTDERR`, asString, { color: currentColor, bold: true });
            });
            // On process closure, the following needs to happen:
            // 1) The studyFilepathWatcher needs to be closed (last pid only)
            // 2) The frontend needs to be informed of the end result (last pid only)
            // 3) Local and Global pids need to be removed from their respective lists
            child.on("close", (code, signal) => __awaiter(this, void 0, void 0, function* () {
                console.log(`child process exited with code ${code} and signal ${signal}`);
                RunEASLExitSummaries.exitSummaries.push({ pid: child.pid, exitCode: code });
                // The last child on its responsibilities go here
                if (pids.length === 1 && pids.includes(child.pid)) {
                    console.log(`EASL Process ${channelName} -- Last ChildProc onClose: Run Closing studyFilepathWatcher`);
                    studyFilepathWatcher && (yield studyFilepathWatcher.close());
                    const { missedStatusFiles, missedStepsMessages } = yield getExploreASLExitSummary(StudyDerivExploreASLDir, setOfAnticipatedFilepaths, workloadMapping);
                    console.log(`EASL Process ${channelName} -- Last ChildProc onClose: Incomplete Steps`, missedStatusFiles);
                    RunEASLExitSummaries.numIncompleteSteps = missedStatusFiles.length;
                    RunEASLExitSummaries.missedStepsMessages = missedStepsMessages;
                    console.log(`EASL Process ${channelName} -- Last ChildProc onClose: Will communicate the following RunEASLExistSummaries:`, RunEASLExitSummaries);
                    respondToIPCRenderer(event, `${channelName}:childProcessHasClosed`, child.pid, code, RunEASLExitSummaries);
                }
                // Remove pids from local list
                if (pids.includes(child.pid)) {
                    pids.splice(pids.indexOf(child.pid), 1);
                }
                // Remove pids from global list
                if (GLOBAL_CHILD_PROCESSES.includes(child.pid)) {
                    GLOBAL_CHILD_PROCESSES.splice(GLOBAL_CHILD_PROCESSES.indexOf(child.pid), 1);
                }
            }));
            child.pid && pids.push(child.pid);
        }
        const result = {
            GUIMessage: {
                title: "Started ExploreASL Child Processes",
                messages: ["At minimum, the service has attempted a start"],
                severity: "success",
            },
            payload: {
                pids: pids,
                channelName: channelName,
            },
        };
        console.log("EASL Process", channelName, "-- result:", result);
        return result;
    });
}
//# sourceMappingURL=runExploreASL.js.map