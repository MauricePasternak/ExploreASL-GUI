import spawn from "cross-spawn";
import { ChildProcess } from "child_process";
import Path from "pathlib-js";
import { IpcMainInvokeEvent } from "electron";
import { matlabEscapeBlockChar } from "../common/utilityFunctions/stringFunctions";
import { respondToIPCRenderer } from "../communcations/MappingIPCRendererEvents";
import { GLOBAL_CHILD_PROCESSES } from "../common/GLOBALS";
import { GUIMessageWithPayload } from "../common/types/GUIMessageTypes";
import {
  createRuntimeEnvironment,
  getExploreASLVersion,
  getMATLABPathAndVersion,
} from "./runExploreASLHelperFunctions";
import { ImportSchemaType } from "../common/types/ImportSchemaTypes";
import { RunEASLStartupReturnType } from "../common/types/ExploreASLTypes";
import { EASLWorkloadMapping } from "../common/schemas/ExploreASLWorkloads";
import { createGUIMessage } from "../common/utilityFunctions/GUIMessageFunctions";
import { buildSourceStructureJSON, buildStudyParJSON } from "./runImportModuleHelperFunctions";
import { sleep } from "../common/utilityFunctions/sleepFunctions";
import { CreateRuntimeError } from "../common/errors/runExploreASLErrors";

export async function handleRunImportModule(
  event: IpcMainInvokeEvent,
  channelName: string,
  formData: ImportSchemaType,
  whichImportContext: number
): Promise<GUIMessageWithPayload<RunEASLStartupReturnType>> {
  // By default, we assume an error will occur
  const defaultPayload: RunEASLStartupReturnType = { pids: [-1], channelName };
  let MATLABGithubArgs = ["-nodesktop", "-nosplash", "-batch"];

  const ExploreASLPath = new Path(formData.EASLPath);
  const StudyRootPath = new Path(formData.StudyRootPath);

  /******************************************
   * Step 1: Determine the ExploreASL Version
   *****************************************/
  const { EASLVersionPath, EASLVersionNumber } = await getExploreASLVersion(ExploreASLPath.path);
  if (!EASLVersionPath || !EASLVersionNumber) {
    return {
      GUIMessage: {
        severity: "error",
        title: "No ExploreASL version found",
        messages: [
          "No valid ExploreASL version found in the provided ExploreASL folder:",
          `${ExploreASLPath.toString(true)}`,
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

  /***********************************************
   * Step 2: Determine the MATLAB Path and Version
   **********************************************/
  const { matlabPath, matlabVersion, message: getMatlabMessage } = await getMATLABPathAndVersion();

  // STEP 3: Ascertain the filepath of the executable to call (MATLAB or compile based)
  let executablePath = "";
  if (formData.EASLType === "Github") {
    // If things did not go successfully, return an error
    // For Github, we the MATLAB executable path & Versions is mandatory
    if (!matlabPath || !matlabVersion)
      return {
        GUIMessage: {
          severity: "error",
          title: "Unable to get MATLAB path and/or version",
          messages: [
            "Unable to determine the MATLAB path and/or version. Please ensure that MATLAB is installed and that the path to MATLAB is correctly configured.",
            "The following error was encountered while attempting to determine the MATLAB path and version:",
            " ",
            getMatlabMessage,
          ],
        },
        payload: defaultPayload,
      };
    executablePath = matlabPath;

    if (matlabVersion < 2016) {
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
    } else if (matlabVersion < 2019) {
      MATLABGithubArgs = ["-nosplash", "-nodisplay", "-r"];
    }
    // End of Github Case
    // For Compiled
  } else {
    const xASL_latest_dir = new Path(formData.EASLPath);
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
        payload: {
          pids: [-1],
          channelName: channelName,
        },
      };
    }
    executablePath = xASL_runnable.path;
  } // End of Compiled Case

  /*****************************************
   * Step 4: Prepare the runtime environment
   ****************************************/
  const EASLEnv = await createRuntimeEnvironment(formData.EASLType, formData.EASLPath, formData.MATLABRuntimePath);
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

  // TODO: There needs to be some sort of handling of "true re-runs" for the Import Module.
  // Discuss: Should there be an extra step between StepDefineContext and StepRunEASL where users can choose to get
  // rid of certain import progress?
  // At the current time, just re-run the entire process.

  /***************************************************************************************
   * Step 5: Delete the "locked" directories and/or the root lock if this is the first run
   **************************************************************************************/
  const StudyDerivExploreASLDir = StudyRootPath.resolve("derivatives", "ExploreASL");
  console.log(`EASL Import `, `Proceeding to delete locked dirs for: ${StudyDerivExploreASLDir.path}`);
  // For the very first task, we delete the root lock folders pertaining to the import Module
  if (formData.ImportContexts.length - 1 === whichImportContext) {
    const rootImportLockDir = StudyDerivExploreASLDir.resolve("lock/xASL_module_Import");
    const rootBIDS2LegacyLockDir = StudyDerivExploreASLDir.resolve("lock/xASL_module_BIDS2Legacy");
    (await rootImportLockDir.exists()) && (await rootImportLockDir.remove());
    (await rootBIDS2LegacyLockDir.exists()) && (await rootBIDS2LegacyLockDir.remove());
  }
  // Delete "locked" directories
  for await (const filepath of StudyDerivExploreASLDir.globIter("**/locked", { onlyDirectories: true })) {
    try {
      await filepath.remove();
    } catch (error) {
      console.warn(`An Error occurred while trying to delete filepath ${filepath.path}: ${error}`);
      continue;
    }
  }

  /*************************************************************************************
   * Step 6: Define the appropriate sourceStructure.json file and create it for this run
   ************************************************************************************/
  const sourceStructureJSON = await buildSourceStructureJSON(formData, whichImportContext);

  console.log(`EASL Import -- sourceStructureJSON:`, JSON.stringify(sourceStructureJSON, null, 2));

  if (!sourceStructureJSON) {
    return {
      GUIMessage: createGUIMessage("Could not create the sourceStructure.json file.", "Error", "error"),
      payload: defaultPayload,
    };
  }
  const sourceStructureJSONPath = await StudyRootPath.resolve("sourceStructure.json").writeJSON(sourceStructureJSON, {
    spaces: 2,
  });
  if (!(await sourceStructureJSONPath.exists())) {
    return {
      GUIMessage: createGUIMessage("Could not create the sourceStructure.json file.", "Error", "error"),
      payload: defaultPayload,
    };
  }

  /******************************************************************************
   * Step 7: Define the appropriate studyPar.json file and create it for this run
   *****************************************************************************/
  const studyParJSON = await buildStudyParJSON(formData, whichImportContext);

  console.log(`EASL Import -- studyParJSON:`, JSON.stringify(studyParJSON, null, 2));

  if (!studyParJSON) {
    return {
      GUIMessage: createGUIMessage("Could not create the studyPar.json file.", "Error", "error"),
      payload: defaultPayload,
    };
  }
  const studyParJSONPath = await StudyRootPath.resolve("studyPar.json").writeJSON(studyParJSON, { spaces: 2 });
  if (!(await studyParJSONPath.exists())) {
    return {
      GUIMessage: createGUIMessage("Could not create the studyPar.json file.", "Error", "error"),
      payload: defaultPayload,
    };
  }

  /***************************************
   * Step 8: Run the ExploreASL executable
   **************************************/
  let child: ChildProcess;
  const runImport = 1;
  const runEASLModules = 0;
  const bPause = 0;
  const iWorker = 1;
  const nWorkers = 1;

  if (formData.EASLType === "Github") {
    console.log(
      `EASL Process ${channelName} -- commandline input:\n`,
      `${executablePath}`,
      ...MATLABGithubArgs,
      `ExploreASL('${formData.StudyRootPath}', ${runImport}, ${runEASLModules}, ${bPause}, ${iWorker}, ${nWorkers})`
    );
    child = spawn(
      executablePath,
      [
        ...MATLABGithubArgs,
        `ExploreASL('${formData.StudyRootPath}', ${runImport}, ${runEASLModules}, ${bPause}, ${iWorker}, ${nWorkers})`,
      ],
      {
        cwd: formData.EASLPath,
        env: EASLEnv,
      }
    );
  } else {
    console.log(
      `EASL Process ${channelName} -- commandline input:\n`,
      `${executablePath}`,
      formData.MATLABRuntimePath,
      formData.StudyRootPath,
      `${runImport}`,
      `${runEASLModules}`,
      `${bPause} ${iWorker} ${nWorkers}`
    );
    child = spawn(
      executablePath,
      [
        formData.MATLABRuntimePath,
        formData.StudyRootPath,
        `${runImport}`,
        `${runEASLModules}`,
        `${bPause} ${iWorker} ${nWorkers}`,
      ],
      {
        cwd: formData.EASLPath,
        env: EASLEnv,
      }
    );
  }

  // On successful spawn, add to the globalChildProcesses and clear the corresponding text display
  child.on("spawn", () => {
    console.log("Import Module process has spawned with PID", child.pid);
    const contextName = whichImportContext === 0 ? "Global Context" : `Additional Context ${whichImportContext}`;

    GLOBAL_CHILD_PROCESSES.push(child.pid);
    respondToIPCRenderer(event, `${channelName}:childProcessHasSpawned`, child.pid);
    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, `Running ExploreASL Import for ${contextName}`, {
      size: "24px",
      bold: true,
    });
  });

  // Process STDOUT and forward it to the appropriate text display
  child.stdout.on("data", (data: Buffer) => {
    const asString = matlabEscapeBlockChar(data);
    // Skip MATLAB Processbars
    if (/((?:[\n\s]*)\d+%?|%)/gm.test(asString)) return;
    console.log(`STDOUT: ${asString}`);
    respondToIPCRenderer(event, `${channelName}:childProcessSTDOUT`, asString);
  });

  // Process STDERR and forward it to the appropriate text display
  child.stderr.on("data", data => {
    const asString = matlabEscapeBlockChar(data);
    console.error(`STDERR: ${data}`);
    let currentColor = "red";
    if (/^[Ww]arning/gm.test(asString)) currentColor = "orange";
    respondToIPCRenderer(event, `${channelName}:childProcessSTDERR`, asString, { color: currentColor, bold: true });
  });

  // On process closure, send the exit code to the frontend and remove from the list of processes
  child.on("close", (code, signal) => {
    console.log(`child process exited with code ${code} and signal ${signal}`);
    respondToIPCRenderer(event, `${channelName}:childProcessHasClosed`, child.pid, code);
    if (GLOBAL_CHILD_PROCESSES.includes(child.pid)) {
      GLOBAL_CHILD_PROCESSES.splice(GLOBAL_CHILD_PROCESSES.indexOf(child.pid), 1);
    }
  });

  return {
    GUIMessage: {
      title: "Started ExploreASL Import Module",
      messages: ["At minimum, the service has attempted a start"],
      severity: "success",
    },
    payload: {
      pids: [child.pid],
      channelName: channelName,
    },
  };
}
