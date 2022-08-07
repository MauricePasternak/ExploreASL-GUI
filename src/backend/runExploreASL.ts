import { ChildProcess } from "child_process";
import { watch } from "chokidar";
import spawn from "cross-spawn";
import { IpcMainInvokeEvent } from "electron";
import { difference as lodashDiff, range as lodashRange, uniq as lodashUniq } from "lodash";
import Path from "pathlib-js";
import { GLOBAL_CHILD_PROCESSES } from "../common/GLOBALS";
import { EASLWorkloadMapping } from "../common/schemas/ExploreASLWorkloads";
import { DataParValuesType } from "../common/types/ExploreASLDataParTypes";
import { RunEASLChildProcSummary, RunEASLStartupReturnType } from "../common/types/ExploreASLTypes";
import { GUIMessageWithPayload } from "../common/types/GUIMessageTypes";
import { RunEASLStudySetupType } from "../common/types/ProcessStudiesTypes";
import { calculatePercent } from "../common/utilityFunctions/numberFunctions";
import { sleep } from "../common/utilityFunctions/sleepFunctions";
import { matlabEscapeBlockChar } from "../common/utilityFunctions/stringFunctions";
import { Lock } from "../common/utilityFunctions/threadingFunctions";
import { respondToIPCRenderer } from "../communcations/MappingIPCRendererEvents";
import {
  calculateWorkload,
  createRuntimeEnvironment,
  getMATLABPathAndVersion,
} from "./runExploreASLHelperFunctions";

export async function handleRunExploreASL(
  event: IpcMainInvokeEvent,
  channelName: string,
  dataPar: DataParValuesType,
  studySetup: Omit<RunEASLStudySetupType, "currentStatus">
): Promise<GUIMessageWithPayload<RunEASLStartupReturnType>> {
  // console.debug(`EASLProcess ${channelName} -- dataPar:`, dataPar);
  const defaultPayload = { pids: [-1], channelName };
  let MATLABGithubArgs = ["-nodesktop", "-nosplash", "-batch"];

  /******************************************************************
   * STEP 1: get the ExploreASL Program version and the Workload type
   *****************************************************************/
  const EASLVerionFile = (await new Path(dataPar.x.GUI.EASLPath).glob("VERSION_*", { onlyFiles: true }))[0];
  if (!(EASLVerionFile.basename in EASLWorkloadMapping)) {
    return {
      GUIMessage: {
        title: "ExploreASL Executable Version Incompatible",
        severity: "error",
        messages: ["ExploreASL must be at least version 1.9.0 in order to be executed."],
      },
      payload: {
        pids: [-1],
        channelName: channelName,
      },
    };
  }
  const workloadMapping = EASLWorkloadMapping[EASLVerionFile.basename as keyof typeof EASLWorkloadMapping];

  /************************************************************************
   * STEP 2: Get the MATLAB Versions and Calculate the anticipated Workload
   ***********************************************************************/
  const [{ matlabPath, matlabVersion }, getWorkloadResult] = await Promise.all([
    getMATLABPathAndVersion(),
    calculateWorkload(dataPar, studySetup, workloadMapping),
  ]);

  console.debug(`EASL Process ${channelName} -- getMATLABResult`, { matlabPath, matlabVersion });
  console.debug(`EASL Process ${channelName} -- getWorkloadResult`, getWorkloadResult);
  let executablePath = "";

  /************************************************************************************
   * STEP 3: Ascertain the filepath of the executable to call (MATLAB or compile based)
   ***********************************************************************************/
  if (dataPar.x.GUI.EASLType === "Github") {
    if (!matlabPath || !matlabVersion) {
      return {
        GUIMessage: {
          title: "Could not locate MATLAB",
          severity: "error",
          messages: [
            "Could not locate MATLAB or determine its version.",
            "Please ensure that it is installed and that it is in the PATH.",
          ],
        },
        payload: defaultPayload,
      };
    }
    executablePath = matlabPath;
    const matlabVersionNumber = Number(/\d{4}/gm.exec(matlabVersion)[0]);

    if (matlabVersionNumber < 2016) {
      return {
        GUIMessage: {
          title: "MATLAB Version Incompatible",
          severity: "error",
          messages: [
            "MATLAB must be at least version 2016b in order to be executed.",
            "Please contact your system's administrator about upgrading.",
          ],
        },
        payload: defaultPayload,
      };
    } else if (matlabVersionNumber < 2019) {
      MATLABGithubArgs = ["-nosplash", "-nodisplay", "-r"];
    }
    // For compiled
  } else {
    const xASL_latest_dir = new Path(dataPar.x.GUI.EASLPath);
    const xASL_latest_basename = process.platform === "win32" ? "xASL_latest.exe" : "run_xASL_latest.sh";
    const xASL_runnable = await xASL_latest_dir.containsImmediateChild(xASL_latest_basename);
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
  console.debug(`EASL Process ${channelName} -- executablePath`, executablePath);

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
  const EASLEnv = await createRuntimeEnvironment(
    dataPar.x.GUI.EASLType,
    dataPar.x.GUI.EASLPath,
    dataPar.x.GUI.MATLABRuntimePath
  );
  if (!EASLEnv)
    return {
      GUIMessage: {
        title: "Could not create the ExploreASL Runtime Environment",
        severity: "error",
        messages: [
          "An Error occurred while trying to create the ExploreASL Runtime Environment.",
          "Ensure that you have the following environmental variables set depending on your operating system:",
          "- for Windows, PATH",
          "- for Mac, DYLD_LIBRARY_PATH",
          "- for Linux, LD_LIBRARY_PATH",
          "Contact your system's administrator about setting these variables.",
        ],
      },
      payload: defaultPayload,
    };
  // console.debug(`EASL Process ${channelName} -- EASLEnv`, EASLEnv);

  /********************************************
   * STEP 6: Delete any folders called "locked"
   *******************************************/
  const StudyDerivExploreASLDir = new Path(dataPar.x.GUI.StudyRootPath).resolve("derivatives", "ExploreASL");
  console.debug(`EASL Process ${channelName} -- Proceeding to delete locked dirs for: ${StudyDerivExploreASLDir.path}`);
  for await (const filepath of StudyDerivExploreASLDir.globIter("**/locked", { onlyDirectories: true })) {
    try {
      await filepath.remove();
    } catch (error) {
      console.warn(`An Error occurred while trying to delete filepath ${filepath.path}: ${error}`);
      continue;
    }
  }

  /*****************************************************
   * STEP 7: Define the behavior of the filepath watcher
   ****************************************************/

  // First define all the regexes, and translator mappings
  const regexLockDir =
    /lock\/xASL_module_(?<Module>ASL|Structural|Population)\/?(?<Subject>.*)?\/xASL_module_(?:ASL|Structural|Population)_?(?<Session>.*)\/locked$/m;
  const regexStatusFile =
    /lock\/xASL_module_(?<Module>ASL|Structural|Population)\/?(?<Subject>.*)?\/xASL_module_(?:ASL|Structural|Population)_?(?<Session>.*)\/.*\.status$/m;
  const regexImageFile =
    /(?<Axis>Cor|Tra)_(?<ImageType>Reg_rT1|Seg_rT1|Reg_noSmooth_M0|noSmooth_M0|Reg_qCBF|qCBF)(?!.*Contour)_(?<Target>[\w-]+?_\d?)_?.*\.jpe?g$/m;

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

  const SentImages = new Set();

  const studyFilepathWatcher = watch(
    [StudyDerivExploreASLDir.resolve("lock").path, StudyDerivExploreASLDir.resolve("Population").path],
    {
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
        // `${StudyDerivExploreASLDir.resolve("Population").path}/*`,
        `${StudyDerivExploreASLDir.resolve("Logs").path}/*`,
      ],
    }
  );

  // When ready, should be responsible for clearing the processbar
  studyFilepathWatcher.on("ready", () => {
    console.debug(`Watcher for channel ${channelName} is ready`);
    respondToIPCRenderer(event, `${channelName}:progressBarReset`);
  });

  // Handler for directories
  studyFilepathWatcher.on("addDir", async (path, stats) => {
    // Early Exit. Event fires twice; ignore the first time (no stats is provided)
    if (!stats) return;

    console.debug(`Watcher's "addDir" event got path: ${path}`);
    const asPath = new Path(path);
    if (regexImageFile.test(asPath.basename)) {
      // THIS IS AN IMAGE FILE
      console.debug("This is an image file");

      // Get the data for the given image file
      const { Axis, ImageType, Target } = regexImageFile.exec(asPath.basename)["groups"];
      const whichImageType = ImageTypeMapping[ImageType as keyof typeof ImageTypeMapping];
      const whichAxis = AxisTypeMapping[Axis as keyof typeof AxisTypeMapping];
      const statement = `Processed a ${whichAxis} ${whichImageType} image for ${Target}`;
      console.log(statement);

      // Acquire lock, Respond to frontend, release lock
      const unlock = (await lock.lock()) as () => void | Promise<() => void>;
      await sleep(300);
      console.log(`Sleeping for 300ms before sending image file ${asPath.path}`);
      respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, statement, { bold: true });
      respondToIPCRenderer(event, `${channelName}:childProcessRequestsMediaDisplay`, asPath.path);

      await unlock();
      return; // END OF IMAGE FILE SCENARIO
    }

    // Acquire lock, Respond to frontend, release lock
    const { Module, Subject, Session } = regexLockDir.exec(asPath.path)["groups"];
    const unlock = (await lock.lock()) as () => void | Promise<() => void>;
    if (Module === "ASL") {
      respondToIPCRenderer(
        event,
        `${channelName}:childProcessSTDOUT`,
        `Starting ASL Module for Subject: ${Subject} -- Session: ${Session}`
      );
    } else if (Module === "Structural") {
      respondToIPCRenderer(
        event,
        `${channelName}:childProcessSTDOUT`,
        `Starting Structural Module for Subject: ${Subject}`
      );
    } else if (Module === "Population") {
      respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, "Starting Population Module");
    }
    await unlock();
  });

  // Handler for files
  studyFilepathWatcher.on("add", async (path, stats) => {
    // Early Exit. Event fires twice; ignore the first time (no stats is provided)
    if (!stats) return;

    console.debug(`Watcher's "add" event got path: ${path}`);
    const asPath = new Path(path);

    // Decide whether this is a status file or an image file
    if (regexStatusFile.test(asPath.path)) {
      // THIS IS A STATUS FILE
      console.log("This is a status file");

      // Early Exit. Not one of the anticipated status files
      if (!setOfAnticipatedFilepaths.has(asPath.path)) return;

      // Get the data for the given status file
      const { Module, Subject, Session } = regexStatusFile.exec(asPath.path)["groups"];
      const statusFileCriteria = workloadMapping[asPath.basename];

      // Increment associated progressbar
      const progressbarIncrementAmount =
        calculatePercent(statusFileCriteria.loadingBarValue, anticipatedWorkload, 4) * 100;
      debugCounter += statusFileCriteria.loadingBarValue;
      console.debug(
        `Incrementing progressbar by ${progressbarIncrementAmount}`,
        `based on a value of ${statusFileCriteria.loadingBarValue} `,
        `from a total of ${anticipatedWorkload}`
      );
      console.debug(`The debug Counter post-addition is: ${debugCounter}`);
      respondToIPCRenderer(event, `${channelName}:progressBarIncrement`, progressbarIncrementAmount);

      // Acquire lock, Respond to frontend, release lock
      const unlock = (await lock.lock()) as () => void | Promise<() => void>;
      if (Module === "ASL") {
        respondToIPCRenderer(
          event,
          `${channelName}:childProcessSTDOUT`,
          `Completed step in ${Module} Module for:\n\tSubject: ${Subject}\n\tSession: ${Session}\n\tDescription: ${statusFileCriteria.description}`
        );
      } else if (Module === "Structural") {
        respondToIPCRenderer(
          event,
          `${channelName}:childProcessSTDOUT`,
          `Completed step in ${Module} Module for:\n\tSubject: ${Subject}\n\tDescription: ${statusFileCriteria.description}`
        );
      } else if (Module === "Population") {
        respondToIPCRenderer(
          event,
          `${channelName}:childProcessSTDOUT`,
          `Completed step in ${Module} Module\n\tDescription: ${statusFileCriteria.description}`
        );
      }
      await unlock();
      return; // END OF STATUS FILE SCENARIO
    } else if (regexImageFile.test(asPath.basename)) {
      // THIS IS AN IMAGE FILE
      console.debug("This is an image file");

      // Get the data for the given image file
      const { Axis, ImageType, Target } = regexImageFile.exec(asPath.basename)["groups"];
      const whichImageType = ImageTypeMapping[ImageType as keyof typeof ImageTypeMapping];
      const whichAxis = AxisTypeMapping[Axis as keyof typeof AxisTypeMapping];
      const statement = `Processed a ${whichAxis} ${whichImageType} image for ${Target}:`;
      console.log(statement);

      // Acquire lock, Respond to frontend, release lock
      SentImages.add(asPath.path);
      const unlock = (await lock.lock()) as () => void | Promise<() => void>;
      await sleep(100);
      console.log(`Sleeping for 100ms before sending image file ${asPath.path}`);
      respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, statement, { bold: true });
      respondToIPCRenderer(event, `${channelName}:childProcessRequestsMediaDisplay`, asPath.path);

      await unlock();
      return; // END OF IMAGE FILE SCENARIO
    }
    return;
  });

  // Handler for changed files
  studyFilepathWatcher.on("change", async (path, stats) => {
    // Early Exit. Event fires twice; ignore the first time (no stats is provided)
    if (!stats) return;

    const asPath = new Path(path);
    if (!regexImageFile.test(asPath.basename) || SentImages.has(asPath.path)) return;

    // THIS IS AN IMAGE FILE
    console.debug("This is an image file");

    // Get the data for the given image file
    const { Axis, ImageType, Target } = regexImageFile.exec(asPath.basename)["groups"];
    const whichImageType = ImageTypeMapping[ImageType as keyof typeof ImageTypeMapping];
    const whichAxis = AxisTypeMapping[Axis as keyof typeof AxisTypeMapping];
    const statement = `Processed a ${whichAxis} ${whichImageType} for ${Target}:`;
    console.log(statement);

    // Acquire lock, Respond to frontend, release lock
    SentImages.add(asPath.path);
    const unlock = (await lock.lock()) as () => Promise<unknown>;

    // Currently this setup works...many need to implement a SetInterval & Queue alternative to Locks & Sleeps
    // if users report issues with this
    console.log(`Sleeping for 200ms before sending image file ${asPath.path}`);
    await sleep(200); // This works to prevent premature cancellation of image render for some reason???
    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, statement, { bold: true });
    respondToIPCRenderer(event, `${channelName}:childProcessRequestsMediaDisplay`, asPath.path);
    await unlock();
    return; // END OF IMAGE FILE SCENARIO
  });

  /****************************************************************************************
   * STEP 8: Spawn the child processs for the given module and define its callback behavior
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
  const pids: number[] = [];
  const RunEASLExitSummaries: RunEASLChildProcSummary = {
    exitSummaries: [],
    numIncompleteSteps: 0,
  };

  for (let index = 0; index < rangeArg.length; index++) {
    const iWorker = rangeArg[index] + 1; // +1 due to MATLAB indexing rules
    console.debug(
      `EASL Process ${channelName} -- ExploreASL-specific command:`,
      `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`
    );
    let child: ChildProcess;

    if (dataPar.x.GUI.EASLType === "Github") {
      console.debug(
        `EASL Process ${channelName} -- commandline input:\n`,
        `${executablePath}`,
        ...MATLABGithubArgs,
        `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`
      );
      child = spawn(
        executablePath,
        [
          ...MATLABGithubArgs,
          `ExploreASL('${dataPar.x.GUI.StudyRootPath}', ${runImport}, ${whichModule}, ${bPause}, ${iWorker}, ${nWorkers})`,
        ],
        {
          cwd: dataPar.x.GUI.EASLPath,
          env: EASLEnv,
        }
      );
    } else {
      console.debug(
        `EASL Process ${channelName} -- commandline input:\n`,
        `${executablePath}`,
        dataPar.x.GUI.MATLABRuntimePath,
        dataPar.x.GUI.StudyRootPath,
        `${runImport}`,
        `${whichModule}`,
        `${bPause} ${iWorker} ${nWorkers}`
      );
      child = spawn(
        executablePath,
        [
          dataPar.x.GUI.MATLABRuntimePath,
          dataPar.x.GUI.StudyRootPath,
          `${runImport}`,
          `${whichModule}`,
          `${bPause} ${iWorker} ${nWorkers}`,
        ],
        {
          cwd: dataPar.x.GUI.EASLPath,
          env: EASLEnv,
        }
      );
    }

    // On failed spawn inform the frontend
    child.on("error", err => {
      console.warn(`Child process with ID: ${child.pid} has failed to spawn due to ERROR: ${err}`);
      respondToIPCRenderer(event, `${channelName}:childProcessHasErrored`, child.pid, err);
    });

    // On successful spawn, add to the globalChildProcesses and clear the corresponding text display
    child.on("spawn", () => {
      console.debug("ExploreASL process has spawned with PID", child.pid);
      GLOBAL_CHILD_PROCESSES.push(child.pid);
      respondToIPCRenderer(event, `${channelName}:childProcessHasSpawned`, child.pid);
      respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, "STARTING UP MATLAB ExploreASL", { bold: true });
    });

    child.stdout.on("data", data => {
      const asString = matlabEscapeBlockChar(data);
      console.error(`STDOUT: ${asString}`);
    });

    // Process STDERR and forward it to the appropriate text display
    child.stderr.on("data", data => {
      const asString = matlabEscapeBlockChar(data);
      console.error(`STDERR: ${data}`);
      const currentColor = /^[Ww]arning/gm.test(asString) ? "orange" : "red";
      respondToIPCRenderer(event, `${channelName}:childProcessSTDERR`, asString, { color: currentColor, bold: true });
    });

    // On process closure, the following needs to happen:
    // The studyFilepathWatcher needs to be closed (last pid only)
    // The frontend needs to be informed of the end result (last pid only)
    // Local and Global pids need to be removed from their respective lists
    child.on("close", async (code, signal) => {
      console.debug(`child process exited with code ${code} and signal ${signal}`);
      RunEASLExitSummaries.exitSummaries.push({ pid: child.pid, exitCode: code });

      // The last child on its responsibilities go here
      if (pids.length === 1 && pids.includes(child.pid)) {
        studyFilepathWatcher && (await studyFilepathWatcher.close());

        const allStatusFiles = await StudyDerivExploreASLDir.resolve("lock").glob("**/*.status", {
          onlyFiles: true,
          onlyDirectories: false,
        });
        const incompleteSteps = lodashDiff(
          Array.from(setOfAnticipatedFilepaths),
          lodashUniq(allStatusFiles.map(p => p.path))
        );

        console.debug("Incomplete Steps", incompleteSteps);

        RunEASLExitSummaries.numIncompleteSteps = incompleteSteps.length;
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
    });

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

  console.debug("EASL Process", channelName, "-- result:", result);
  return result as GUIMessageWithPayload;
}
