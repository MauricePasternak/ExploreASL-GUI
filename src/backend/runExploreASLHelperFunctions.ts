import { exec } from "child_process";
import {
  pickBy as lodashPickBy,
  sum as lodashSum,
  isEmpty as lodashIsEmpty,
  difference as lodashDiff,
  uniq as lodashUniq,
} from "lodash";
import Path from "pathlib-js";
import { Regex } from "../common/utilityFunctions/stringFunctions";
import { promisify } from "util";
import { DataParValuesType } from "../common/types/ExploreASLDataParTypes";
import { EASLWorkload } from "../common/types/ExploreASLTypes";
import { GUIMessageWithPayload } from "../common/types/GUIMessageTypes";
import { EASLType } from "../common/types/ImportSchemaTypes";
import { RunEASLStudySetupType } from "../common/types/ProcessStudiesTypes";
const asyncExec = promisify(exec);
/**
 * Ascertains the matlab executable filepath and version of the program and returns them.
 * @returns An Object with keys `matlabPath` and `matlabVersion`. Either of these can be a string or null`.
 */
export async function getMATLABPathAndVersion(): Promise<{ matlabPath: string | null; matlabVersion: string | null }> {
  const whichCommand = process.platform === "win32" ? "where" : "which";
  const matlabVerRegex = /R\d{4}[ab]/gm;
  let matlabVersion: string | null = null;
  let matlabPath: string | null = null;
  const { stdout } = await asyncExec(`${whichCommand} matlab`, { windowsHide: true });
  matlabPath = stdout.trim();

  if (matlabPath && matlabPath !== "" && (await new Path(matlabPath).exists())) {
    // Test for instant version match in the filepath of the executable
    if (matlabVerRegex.test(matlabPath)) {
      matlabVersion = matlabPath.match(matlabVerRegex)[0];
      console.log(`Success at finding version ${matlabVersion} from the executable's own filepath`);
      return { matlabPath, matlabVersion };
    }

    // If it's on PATH, we should be able to execute it for our benefit to get the version
    console.log("Found matlab on PATH but it did not have the version in the filepath. Getting it via execution.");
    const { stdout } = await asyncExec(`matlab -nosplash -nodesktop -batch "disp(version)"`, {
      windowsHide: true,
    });
    const rawMATLABVer = stdout.trim();
    matlabVersion = rawMATLABVer.match(matlabVerRegex)[0];
    console.log(`The following matlabVersion was determined from executing MATLAB: ${matlabVersion}`);
    return { matlabPath, matlabVersion };
  }

  // Exit if not Mac
  console.log("MATLAB was not on PATH");
  if (process.platform !== "darwin") return { matlabPath, matlabVersion };

  // Last try if on macOS...we can try to find it via Applications
  const applicationsPath = new Path("/Applications");
  if (!(await applicationsPath.exists())) return { matlabPath, matlabVersion }; // Early exit if no Applications folder

  for await (const path of applicationsPath.globIter("bin/matlab", { onlyFiles: true })) {
    if (matlabVerRegex.test(path.path)) {
      matlabPath = path.path;
      matlabVersion = path.path.match(matlabVerRegex)[0];
      return { matlabPath, matlabVersion };
    }
  }

  // No luck on MacOS either
  return { matlabPath, matlabVersion };
}

/**
 * Creates a NodeJS environment for the ExploreASL module to be run in.
 * @param EASLType The type of ExploreASL exectuable to run. Either "GitHub" or "Compiled"
 * @param EASLPath The path to the ExploreASL executable's main folder.
 * @param MATLABRuntimePath The path to the MATLAB Runtime folder (i.e. v96).
 * @returns The NodeJS Environment object to be put into `spawns` env variable.
 */
export async function createRuntimeEnvironment(
  EASLType: EASLType,
  EASLPath: string,
  MATLABRuntimePath: string
): Promise<NodeJS.ProcessEnv | false> {
  if (EASLType === "Github") return { ...process.env, MATLABPATH: EASLPath };

  const allEnvMappings = {
    win32: {
      varname: "PATH",
      delimiter: ";",
      globItem: "win64",
    },
    linux: {
      varname: "LD_LIBRARY_PATH",
      delimiter: ":",
      globItem: "glnxa64",
    },
    darwin: {
      varname: "DYLD_LIBRARY_PATH",
      delimiter: ":",
      globItem: "maci64",
    },
  };

  const currentEnvMapping = allEnvMappings[process.platform as keyof typeof allEnvMappings];
  const currentPATH = currentEnvMapping.varname in process.env ? process.env[currentEnvMapping.varname] : "";
  const runtimePaths = await new Path(MATLABRuntimePath).glob(`**/${currentEnvMapping.globItem}`, {
    onlyDirectories: true,
  });
  if (runtimePaths.length === 0) return false;
  const updatedPaths = currentPATH
    ? currentPATH + currentEnvMapping.delimiter + runtimePaths.map(p => p.path).join(currentEnvMapping.delimiter)
    : runtimePaths.map(p => p.path).join(currentEnvMapping.delimiter);
  return { ...process.env, [currentEnvMapping.varname]: updatedPaths };
}

interface GlobMapping {
  GlobASL: string;
  GlobFLAIR: string;
  GlobM0: string;
}

async function getSubjectImagetypes(path: Path, globMapping: GlobMapping) {
  return {
    hasFLAIR: !!(await path.globIter(globMapping.GlobFLAIR, { onlyFiles: true }).next()).value,
    hasM0: !!(await path.globIter(globMapping.GlobM0, { onlyFiles: true }).next()).value,
    hasASL: !!(await path.globIter(globMapping.GlobASL, { onlyFiles: true }).next()).value,
  };
}

async function calculateStructuralWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
  const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
  const excludedSubjects = new Set(dataPar.x.dataset.exclusion);
  const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
  const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
  const globMapping: GlobMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };

  const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");

  const structuralWorkload = {
    anticipatedFilepaths: [] as string[],
    anticipatedWorkload: [] as number[],
  };

  for await (const subjectPath of pathRawData.readDirIter()) {
    console.log("Checking subject:", subjectPath.path);

    // Skip non-indicated subjects, excluded subjects, defaults folders, and non-directories
    if (
      !subjectRegexp.test(subjectPath.basename) ||
      excludedSubjects.has(subjectPath.basename) ||
      defaultFolders.has(subjectPath.basename) ||
      !(await subjectPath.isDirectory())
    ) {
      console.log("Skipping subject:", subjectPath.path);
      continue;
    }

    // console.log(`${subjectPath.path} is a subject to check`);

    // Behavior differs based on whether there are visits or not
    const visitPaths = await subjectPath.glob("ses-*", { onlyDirectories: true });
    console.log(`${subjectPath.path} has ${visitPaths.length} visits`);

    // If there are no visits, the expected rawdata folder structure is along the lines of:
    //   - subject
    //   |- anat
    //      |- T1.nii.gz
    //   |- perf
    //      |- ASL.nii.gz
    if (visitPaths.length === 0) {
      // Skip based on dataPar settings
      const { hasFLAIR, hasM0, hasASL } = await getSubjectImagetypes(subjectPath, globMapping);
      if (
        (!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
        (!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
        (!hasASL && dataPar.x.settings.SkipIfNoASL)
      ) {
        continue;
      }

      // Get the path of the directory that will hold the .status files; creating it if necessary
      const lockDirPath = new Path(
        pathDerivativesEASL.path,
        "lock",
        "xASL_module_Structural",
        `${subjectPath.basename}_1`,
        "xASL_module_Structural"
      );
      if (!(await lockDirPath.exists())) {
        await lockDirPath.makeDir();
      }

      // Determine the expected .status files from the version's workload
      const filterSet = hasFLAIR ? new Set(["Structural"]) : new Set(["Structural", "Structural_FLAIR"]);
      const filteredWorkloadMapping = lodashPickBy(workloadSubset, v => filterSet.has(v.module));

      // Determine the workload based on the .status files not already existing
      const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
      for (let index = 0; index < workloadMappingEntires.length; index++) {
        const [statusBasename, info] = workloadMappingEntires[index];
        const statusFilepath = new Path(lockDirPath.path, statusBasename);
        if (await statusFilepath.exists()) continue;
        // console.log(
        //   `${statusFilepath.path} has not been created...adding to anticipated workload and loadingBarValue of ${info.loadingBarValue}`
        // );
        structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
        structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
      }
    } // End of: if (visitPaths.length === 0)
    // Otherwise, there are visits, and we must iterate over them
    //   - subject
    //   |- ses-1
    //       |- anat
    //          |- T1.nii.gz
    //       |- perf
    //          |- ASL.nii.gz
    //   |- ses-2
    //       |- anat
    //          |- T1.nii.gz
    //       |- perf
    //          |- ASL.nii.gz
    else {
      for (let visitIndex = 0; visitIndex < visitPaths.length; visitIndex++) {
        const visitPath = visitPaths[visitIndex];

        // Skip based on dataPar settings
        const { hasFLAIR, hasM0, hasASL } = await getSubjectImagetypes(visitPath, globMapping);
        if (
          (!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
          (!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
          (!hasASL && dataPar.x.settings.SkipIfNoASL)
        ) {
          continue;
        }

        // Get the path of the directory that will hold the .status files; creating it if necessary
        const lockDirPath = new Path(
          pathDerivativesEASL.path,
          "lock",
          "xASL_module_Structural",
          `${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
          "xASL_module_Structural"
        );
        // console.log(`Making lock dir: ${lockDirPath.path}`);
        if (!(await lockDirPath.exists())) {
          await lockDirPath.makeDir();
        }

        // Determine the expected .status files from the version's workload
        const filterSet = hasFLAIR ? new Set(["Structural"]) : new Set(["Structural", "Structural_FLAIR"]);
        const filteredWorkloadMapping = lodashPickBy(workloadSubset, v => filterSet.has(v.module));

        // Determine the workload based on the .status files not already existing
        const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
        for (let index = 0; index < workloadMappingEntires.length; index++) {
          const [statusBasename, info] = workloadMappingEntires[index];
          const statusFilepath = new Path(lockDirPath.path, statusBasename);
          if (await statusFilepath.exists()) continue;

          // console.log(
          //   `${statusFilepath.path} has not been created...adding to anticipated workload and loadingBarValue of ${info.loadingBarValue}`
          // );
          structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
          structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
        }
      }
    } // End of visits.length > 0
  } // End of for await (const subjectPath of pathRawData.readDirIter())

  // console.log(`calculateStructuralWorkload -- Structural workload:`, JSON.stringify(structuralWorkload, null, 2));
  return structuralWorkload;
}

async function calculateASLWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
  const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
  const excludedSubjects = new Set(dataPar.x.dataset.exclusion);
  const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
  const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
  const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
  const globMapping: GlobMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };
  const regexMultiSession = new Regex("run-(?<SessionName>[\\w_]+)_asl\\.json");

  // Determine the expected .status files from the version's workload
  const filterSet = new Set(["ASL"]);
  const filteredWorkloadMapping = lodashPickBy(workloadSubset, v => filterSet.has(v.module));
  const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
  // console.log(`calculateASLWorkload -- Filtered workload mapping: ${JSON.stringify(filteredWorkloadMapping, null, 2)}`);

  const aslWorkload = {
    anticipatedFilepaths: [] as string[],
    anticipatedWorkload: [] as number[],
  };

  for await (const subjectPath of pathRawData.readDirIter()) {
    // Skip non-indicated subjects, excluded subjects, defaults folders, and non-directories
    if (
      !subjectRegexp.test(subjectPath.basename) ||
      excludedSubjects.has(subjectPath.basename) ||
      defaultFolders.has(subjectPath.basename) ||
      !(await subjectPath.isDirectory())
    ) {
      continue;
    }

    // console.log(`calculateASLWorkload -- Processing subject ${subjectPath.basename}`);

    // Skip based on dataPar settings
    const { hasFLAIR } = await getSubjectImagetypes(subjectPath, globMapping);
    // Skip based on dataPar settings
    if (!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) {
      continue;
    }

    // Behavior differs based on whether there are visits or not
    const visitPaths = await subjectPath.glob("ses-*", { onlyDirectories: true });

    /**
     * MAIN SCENARIO A: Single visit
     * General rawdata folder structure:
     *  - sub-<subject>
     *     |- anat
     *     |- perf
     *          |- sub-<subject>_run-<session>_asl.nii.gz
     *          OR
     *          |- sub-<subject>_asl.nii.gz
     */
    if (visitPaths.length === 0) {
      // console.log(
      //   `calculateASLWorkload -- Subject ${subjectPath.basename} has no explicit visits; assuming single visit`
      // );
      /**
       * Scenario A1: Multiple sessions with only one visit
       * EXPECTED BASENAMES: sub-<subject>_run-<session>_asl.json
       */
      const sessionPaths = await subjectPath.glob("perf/*_run-*_asl.json", { onlyFiles: true });
      /**
       * Scenario A2: Single session with only one visit
       * EXPECTED BASENAMES: sub-<subject>_asl.json
       */
      const isMultiSession = sessionPaths.length > 0;

      // console.log(`calculateASLWorkload -- Subject ${subjectPath.basename} isMultiSession: ${isMultiSession}`);

      if (!isMultiSession) {
        // console.log(
        //   `calculateASLWorkload -- Subject ${subjectPath.basename} has no _run-*_asl.json files. Checking for _asl.json`
        // );

        const singleSessionBasename = `${subjectPath.basename}_asl.json`;
        const singleSessionPath = subjectPath.resolve(`perf/${singleSessionBasename}`);

        // console.log(`calculateASLWorkload -- Adding sessionPath: ${singleSessionPath.path}`);

        if (!(await singleSessionPath.exists())) {
          // console.log(`Skipping subject ${subjectPath.basename} because no ASL data found`);
          continue;
        }
        sessionPaths.push(singleSessionPath); // convert to length-1 array in order to keep consistency
      }

      // console.log(
      //   `calculateASLWorkload -- Subject ${subjectPath.basename} sessionPaths`,
      //   JSON.stringify(sessionPaths, null, 2)
      // );

      // Now iterate over the sessions within each subject
      for await (const sessionFilepath of sessionPaths) {
        let sessionName: string;
        if (isMultiSession) {
          const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
          if (!sessionMatch) {
            console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
            continue;
          }
          sessionName = sessionMatch.groupsObject.SessionName;
        } else {
          sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
        }

        // Get the path of the directory that will hold the .status files; creating it if necessary
        const lockDirPath = new Path(
          pathDerivativesEASL.path,
          "lock",
          "xASL_module_ASL",
          `${subjectPath.basename}_1`, // For a single default visit, append "_1"
          `xASL_module_ASL_${sessionName}`
        );
        if (!(await lockDirPath.exists())) {
          await lockDirPath.makeDir();
        }

        // console.log(`calculateASLWorkload -- Checking existing .status files in ${lockDirPath.path}`);

        // Determine the workload based on the .status files not already existing
        for (let index = 0; index < workloadMappingEntires.length; index++) {
          const [statusBasename, info] = workloadMappingEntires[index];
          const statusFilepath = new Path(lockDirPath.path, statusBasename);
          if (await statusFilepath.exists()) continue;
          aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
          aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
        }
      }
      /**
       * MAIN SCENARIO B: Multiple visits
       * General rawdata folder structure:
       *  - sub-<subject>
       *      |- ses-<session>
       *          |- anat
       *          |- perf
       *               |- sub-<subject>_ses-<visit>_run-<session>_asl.nii.gz
       *               OR
       *               |- sub-<subject>_ses-<visit>_asl.nii.gz
       */
    } else {
      // console.log(`Subject ${subjectPath.basename} has ${visitPaths.length} visits`);
      for (let visitIndex = 0; visitIndex < visitPaths.length; visitIndex++) {
        const visitPath = visitPaths[visitIndex];
        // console.log(`Assessing visit ${visitPath.basename}`);
        /**
         * Scenario B1: Multiple sessions and multiple visits
         * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_run-<session>_asl.json
         */
        const aslJSONGlobPattern = `perf/${subjectPath.basename}_${visitPath.basename}_run-*_asl.json`;
        let sessionPaths = await visitPath.glob(aslJSONGlobPattern, {
          onlyFiles: true,
        });
        /**
         * Scenario B2: Single session and multiple visits
         * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_asl.json
         */
        const isMultiSession = sessionPaths.length > 0;
        if (!isMultiSession) {
          const singleSessionBasename = `${subjectPath.basename}_${visitPath.basename}_asl.json`;
          const singleSessionPath = visitPath.resolve(`perf/${singleSessionBasename}`);
          if (!(await singleSessionPath.exists())) {
            // console.log(
            //   `Could not find expected session file ${singleSessionBasename} for visit ${visitPath.basename}`
            // );
            continue;
          }
          sessionPaths = [singleSessionPath]; // convert to length-1 array in order to keep consistency
        }

        // console.log(`Sessions found for visit ${visitPath.basename}: ${sessionPaths.map(p => p.path)}`);
        // Now iterate over the sessions within each subject
        for await (const sessionFilepath of sessionPaths) {
          let sessionName: string;
          if (isMultiSession) {
            const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
            if (!sessionMatch) {
              console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
              continue;
            }
            sessionName = sessionMatch.groupsObject.SessionName;
          } else {
            sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
          }

          // Get the path of the directory that will hold the .status files; creating it if necessary
          const lockDirPath = new Path(
            pathDerivativesEASL.path,
            "lock",
            "xASL_module_ASL",
            `${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
            `xASL_module_ASL_${sessionName}`
          );
          if (!(await lockDirPath.exists())) {
            await lockDirPath.makeDir();
          }

          // Determine the workload based on the .status files not already existing
          for (let index = 0; index < workloadMappingEntires.length; index++) {
            const [statusBasename, info] = workloadMappingEntires[index];
            const statusFilepath = new Path(lockDirPath.path, statusBasename);
            if (await statusFilepath.exists()) continue;
            // console.log(`calculateASLWorkload -- Adding ${statusFilepath.path} to workload`);
            aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
            aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
          }
        }
      }
    }
  }
  return aslWorkload;
}

async function calculatePopulationWorkload(dataPar: DataParValuesType, workloadSubset: EASLWorkload) {
  const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
  const populationWorkload = {
    anticipatedFilepaths: [] as string[],
    anticipatedWorkload: [] as number[],
  };

  // Get the path of the directory that will hold the .status files; creating it if necessary
  const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_Population", "xASL_module_Population");
  if (!(await lockDirPath.exists())) {
    await lockDirPath.makeDir();
  }

  // Determine the expected .status files from the version's workload
  const filteredWorkloadMapping = lodashPickBy(workloadSubset, v => v.module === "Population");

  // Determine the workload based on the .status files not already existing
  const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
  for (let index = 0; index < workloadMappingEntires.length; index++) {
    const [statusBasename, info] = workloadMappingEntires[index];
    const statusFilepath = new Path(lockDirPath.path, statusBasename);
    if (await statusFilepath.exists()) continue;
    populationWorkload.anticipatedFilepaths.push(statusFilepath.path);
    populationWorkload.anticipatedWorkload.push(info.loadingBarValue);
  }
  return populationWorkload;
}

export async function calculateWorkload(
  dataPar: DataParValuesType,
  studySetup: Omit<RunEASLStudySetupType, "currentStatus">,
  workloadMapping: EASLWorkload
): Promise<
  GUIMessageWithPayload<{
    anticipatedFilepaths: string[];
    anticipatedWorkload: number;
  }>
> {
  let payload = {
    anticipatedFilepaths: [] as string[],
    anticipatedWorkload: 0,
  };

  // Calculate accordingly
  /************
   * Structural
   ***********/
  if (studySetup.whichModulesToRun === "Structural") {
    try {
      const { anticipatedWorkload: structuralWorkload, anticipatedFilepaths: structuralPaths } =
        await calculateStructuralWorkload(dataPar, workloadMapping);
      payload = {
        anticipatedFilepaths: structuralPaths,
        anticipatedWorkload: lodashSum(structuralWorkload),
      };
    } catch (error) {
      return {
        GUIMessage: {
          title: "Failure to calculate the Structural Module Workload",
          messages: [
            "Something went wrong when trying to calculate the Structural Module Workload",
            `Nature of the error: ${error}`,
          ],
          severity: "error",
        },
        payload: payload,
      };
    }
    /*****
     * ASL
     ****/
  } else if (studySetup.whichModulesToRun === "ASL") {
    try {
      const { anticipatedWorkload: aslWorkload, anticipatedFilepaths: aslPaths } = await calculateASLWorkload(
        dataPar,
        workloadMapping
      );
      payload = {
        anticipatedFilepaths: aslPaths,
        anticipatedWorkload: lodashSum(aslWorkload),
      };
    } catch (error) {
      return {
        GUIMessage: {
          title: "Failure to calculate the ASL Module Workload",
          messages: [
            "Something went wrong when trying to calculate the ASL Module Workload",
            `Nature of the error: ${error}`,
          ],
          severity: "error",
        },
        payload: payload,
      };
    }
    /******
     * Both
     * ***/
  } else if (studySetup.whichModulesToRun === "Both") {
    // eslint-disable-next-line
    const [strucResult, aslResult] = await Promise.all([
      calculateStructuralWorkload(dataPar, workloadMapping),
      calculateASLWorkload(dataPar, workloadMapping),
    ]);
    payload = {
      anticipatedFilepaths: [...strucResult.anticipatedFilepaths, ...aslResult.anticipatedFilepaths],
      anticipatedWorkload: lodashSum([...strucResult.anticipatedWorkload, ...aslResult.anticipatedWorkload]),
    };
    /************
     * Population
     ***********/
  } else if (studySetup.whichModulesToRun === "Population") {
    try {
      const { anticipatedWorkload: popWorkload, anticipatedFilepaths: popPaths } = await calculatePopulationWorkload(
        dataPar,
        workloadMapping
      );
      payload = {
        anticipatedFilepaths: popPaths,
        anticipatedWorkload: lodashSum(popWorkload),
      };
    } catch (error) {
      return {
        GUIMessage: {
          title: "Failure to calculate the Population Module Workload",
          messages: [
            "Something went wrong when trying to calculate the Population Module Workload",
            `Nature of the error: ${error}`,
          ],
          severity: "error",
        },
        payload: payload,
      };
    }
    /*********************
     * Impossible scenario
     ********************/
  } else {
    throw new Error(`Impossible studySetup whichModuleToRun provided: ${studySetup.whichModulesToRun}`);
  }

  // console.log(`calculateWorkload -- payload.anticipatedWorkload: `, payload.anticipatedWorkload);
  // console.log(`calculateWorkload -- payload.anticipatedFilepaths: `, payload.anticipatedFilepaths);
  // console.log(`calculateWorkload -- payload.anticipatedFilepaths.length: `, payload.anticipatedFilepaths.length);

  if (payload.anticipatedFilepaths.length === 0) {
    return {
      GUIMessage: {
        title: "Study Already Ran",
        messages: [
          "All anticipated analysis steps already completed for this study.",
          `If you meant to re-run the study, please see the "Re-Run A Study" tab in this module`,
          `Alternatively, did you mean to select a different module than your current selection: ${studySetup.whichModulesToRun}`,
        ],
        severity: "info",
      },
      payload: payload,
    };
  } else {
    return {
      GUIMessage: {
        title: "Calculated Anticipated Workload",
        messages: [`Anticipating the creation of ${payload.anticipatedFilepaths.length} ".status" files`],
        severity: "success",
      },
      payload: payload,
    };
  }
}

/**
 * Prepares the messages to be displayed in the GUI regarding possibly missed .status files
 * @param StudyDerivExploreASLDir The derivatives/ExploreASL directory as a Path instance.
 * @param setOfAnticipatedFilepaths A set of filepaths that are anticipated to be created.
 * @param workloadMapping The workloadMapping for this study.
 * @returns An object with properties:
 * - missedStatusFiles: The filepaths that were anticipated but were not created.
 * - missedStepsMessages: The messages to display to the user for the missed steps.
 */
export async function getExploreASLExitSummary(
  StudyDerivExploreASLDir: Path,
  setOfAnticipatedFilepaths: Set<string>,
  workloadMapping: EASLWorkload
): Promise<{ missedStatusFiles: string[]; missedStepsMessages: string[] }> {
  const allStatusFiles = await StudyDerivExploreASLDir.resolve("lock").glob("**/*.status", {
    onlyFiles: true,
    onlyDirectories: false,
  });
  const missedStatusFiles = lodashDiff(
    Array.from(setOfAnticipatedFilepaths),
    lodashUniq(allStatusFiles.map(p => p.path))
  );
  // Early exit if all is in order
  if (missedStatusFiles.length === 0) return { missedStatusFiles, missedStepsMessages: [] };

  const missedStepsMessages: string[] = [];
  const regexStatusFile = new Regex(
    "lock\\/xASL_module_(?<Module>ASL|Structural|Population)\\/?(?<Subject>.*)?\\/xASL_module_(?:ASL|Structural|Population)_?(?<Session>.*)\\/(?<StatusBasename>(?<StatusCode>\\d{3}).*\\.status)$"
  );
  const seenItems = new Set<string>();
  for (const statusFP of missedStatusFiles) {
    const match = regexStatusFile.search(statusFP);
    if (!match) continue;
    const { Module, Subject, Session, StatusBasename } = match.groupsObject;
    if (!(StatusBasename in workloadMapping)) continue;

    // Population module is a special case, prompting an early return
    if (Module === "Population") {
      missedStepsMessages.push(
        `Module: ${Module} ...failed at earliest step: ${workloadMapping[StatusBasename].description}`
      );
      return { missedStatusFiles, missedStepsMessages };
    }

    if (seenItems.has(`${Subject}${Session}`) || !(StatusBasename in workloadMapping)) continue;

    const item = Session
      ? `Module: ${Module}, Subject/Visit: ${Subject}, Session: ${Session}`
      : `Module: ${Module}, Subject/Visit: ${Subject}`;
    const description = `...failed at earliest step: ${workloadMapping[StatusBasename].description}`;
    const message = `${item} ${description}`;
    missedStepsMessages.push(message);
    seenItems.add(`${Subject}${Session}`);
  }

  return { missedStatusFiles, missedStepsMessages };
}
