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
import { exec } from "child_process";
import { difference as lodashDiff, pickBy as lodashPickBy, sum as lodashSum, uniq as lodashUniq } from "lodash";
import Path from "pathlib-js";
import { CreateRuntimeError } from "../common/errors/runExploreASLErrors";
import { promisify } from "util";
import { Regex } from "../common/utils/Regex";
import { REGEXSTATUSFULE } from "../common/GLOBALS";
export const asyncExec = promisify(exec);
/**
 * Gets the givens of the ExploreASL version.
 * **This is the backend version of the function. Do not use in frontend code.**
 * @param EASLPath The path to the ExploreASL directory.
 * @returns Ascertains the path to the ExploreASL version file as we all the MajorMinor combined number.
 */
export function getExploreASLVersion(EASLPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const EASLVersionRegex = new Regex("VERSION_(?<Major>\\d+)\\.(?<Minor>\\d+)\\.(?<Patch>\\d+)", "m");
        const EASLVersionPath = (yield new Path(EASLPath).glob("VERSION_*", { onlyFiles: true }))[0];
        if (!EASLVersionPath)
            return { EASLVersionPath: null, EASLVersionNumber: null };
        const EASLVersionMatch = EASLVersionRegex.search(EASLVersionPath.basename);
        if (!EASLVersionMatch)
            return { EASLVersionPath, EASLVersionNumber: null };
        const { Major, Minor } = EASLVersionMatch.groupsObject;
        const EASLVersionNumber = parseInt(`${Major}${Minor}`, 10);
        return { EASLVersionPath, EASLVersionNumber };
    });
}
/**
 * Ascertains the matlab executable filepath and version of the program and returns them.
 * Note that if multiple matlab versions are detected, it will proceed with the first glob result...
 * @returns An Object with properties:
 * - `matlabPath`: The path to the matlab executable
 * - `matlabVersion`: The version of the matlab executable
 * - `matlabIsOnPath`: Whether the matlab executable is on the system PATH variable
 * - `message`: A message to display to the user, usually in case of an
 */
export function getMATLABPathAndVersion() {
    var _a, e_1, _b, _c, _d, e_2, _e, _f, _g, e_3, _h, _j, _k, e_4, _l, _m, _o, e_5, _p, _q;
    return __awaiter(this, void 0, void 0, function* () {
        const whichCommand = process.platform === "win32" ? "where" : "which";
        const matlabVerRegex = new Regex("R(?<VERSIONNUMBER>\\d{4})[ab]");
        let matlabVersion = null;
        let matlabPath = null;
        let matlabIsOnPath = false;
        try {
            const { stdout } = yield asyncExec(`${whichCommand} matlab`, { windowsHide: true });
            matlabPath = stdout.trim();
            matlabIsOnPath = true;
            const match = matlabVerRegex.search(matlabPath);
            if (match) {
                /**
                 * Case: MATLAB is on PATH and the version is clearly specified in the path
                 */
                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                console.log(`MATLAB was found on PATH @ ${matlabPath} with version ${matlabVersion}`);
                return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
            }
            else {
                /**
                 * Case: MATLAB is on PATH but the version is not clearly specified in the path; we can determine the version
                 * by running MATLAB itself
                 */
                console.log(`MATLAB was found on PATH @ ${matlabPath} but the version is not clear; attempting to determine version`);
                try {
                    const { stdout } = yield asyncExec(`matlab -nosplash -nodesktop -batch "disp(version)"`, { windowsHide: true });
                    const matlabRawVersionString = stdout.trim();
                    const match = matlabVerRegex.search(matlabRawVersionString);
                    if (match) {
                        matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                    }
                    console.log(`MATLAB version ${matlabVersion} was determined`);
                    return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
                }
                catch (error) {
                    try {
                        // Might have failed because the version doesn't use the -batch flag; try again with -r flag
                        console.log(`MATLAB version could not be determined using -batch`, `...trying again with -r flag in case this is an older MATLAB`);
                        const { stdout } = yield asyncExec(`matlab -nosplash -nodesktop -r "disp(version)"`, { windowsHide: true });
                        const matlabRawVersionString = stdout.trim();
                        const match = matlabVerRegex.search(matlabRawVersionString);
                        if (match) {
                            matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                            console.log(`MATLAB version ${matlabVersion} was determined`);
                            return {
                                matlabPath,
                                matlabVersion,
                                matlabIsOnPath,
                                message: `Successfully found matlab path and version.`,
                            };
                        }
                        return {
                            matlabPath,
                            matlabVersion,
                            matlabIsOnPath,
                            message: `MATLAB path was found to be ${matlabPath} but the version could not be determined.`,
                        };
                    }
                    catch (error) {
                        // Out of options...return empty-handed
                        console.log(`MATLAB version could not be determined even though it was on PATH`);
                        return {
                            matlabPath,
                            matlabVersion,
                            matlabIsOnPath,
                            message: `MATLAB path was found to be ${matlabPath} but the version could not be determined.`,
                        };
                    }
                }
            }
        }
        catch (error) {
            console.log("Could not find MATLAB on PATH. Attempting backup methods...");
            matlabIsOnPath = false;
            /**
             * Case: MATLAB is not on PATH
             */
            // On MacOS, check Applications as the installation is typically /Applications/MATLAB_R20XXx.app/bin/matlab
            if (process.platform === "darwin") {
                const applicationsPath = new Path("/Applications");
                if (!(yield applicationsPath.exists()))
                    return {
                        matlabPath,
                        matlabVersion,
                        matlabIsOnPath,
                        message: `No MATLAB path found and could not search in the Applications folder as it did not exist`,
                    };
                console.log(`Looking for MATLAB in ${applicationsPath.path}...`);
                try {
                    try {
                        for (var _r = true, _s = __asyncValues(applicationsPath.globIter("MATLAB*/bin/matlab", { onlyFiles: true })), _t; _t = yield _s.next(), _a = _t.done, !_a;) {
                            _c = _t.value;
                            _r = false;
                            try {
                                const matlabCandidatePath = _c;
                                const match = matlabVerRegex.search(matlabCandidatePath.path);
                                if (!match)
                                    continue;
                                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                                matlabPath = matlabCandidatePath.path;
                                matlabIsOnPath = false;
                                console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
                                return {
                                    matlabPath,
                                    matlabVersion,
                                    matlabIsOnPath,
                                    message: `Successfully found matlab path and version in Applications.`,
                                };
                            }
                            finally {
                                _r = true;
                            }
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_r && !_a && (_b = _s.return)) yield _b.call(_s);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                }
                catch (error) {
                    if (error.code === "EACCESS" || error.code === "EPERM") {
                        return {
                            matlabPath,
                            matlabVersion,
                            matlabIsOnPath,
                            message: `Could not locate MATLAB as this application was not granted permission to search for it in Applications`,
                        };
                    }
                }
                return {
                    matlabPath,
                    matlabVersion,
                    matlabIsOnPath,
                    message: `No MATLAB path found in Applications`,
                }; // End of MacOS case
            }
            else if (process.platform === "win32") {
                // On Windows, we can check Program Files as the installation is typically C:\Program Files\MATLAB\R20XXx\bin\matlab.exe
                const programFilesPath = new Path("C:/Program Files");
                if (!(yield programFilesPath.exists()))
                    return {
                        matlabPath,
                        matlabVersion,
                        matlabIsOnPath,
                        message: `Could not find MATLAB as search location Program Files doesn't exist on this Windows operating system`,
                    };
                console.log(`Looking for MATLAB in ${programFilesPath.path}...`);
                try {
                    try {
                        for (var _u = true, _v = __asyncValues(programFilesPath.globIter("MATLAB/**/bin/matlab.exe", {
                            onlyFiles: true,
                        })), _w; _w = yield _v.next(), _d = _w.done, !_d;) {
                            _f = _w.value;
                            _u = false;
                            try {
                                const matlabCandidatePath = _f;
                                const match = matlabVerRegex.search(matlabCandidatePath.path);
                                if (!match)
                                    continue;
                                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                                matlabPath = matlabCandidatePath.path;
                                matlabIsOnPath = false;
                                console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
                                return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
                            }
                            finally {
                                _u = true;
                            }
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_u && !_d && (_e = _v.return)) yield _e.call(_v);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
                catch (error) {
                    // Passthrough silently since Program Files (x86) is a backup and the proper EACCESS error will be captured there
                }
                // Otherwise, check Program Files (x86) as the installation is typically C:\Program Files (x86)\MATLAB\R20XXx\bin\matlab.exe
                const programFilesX86Path = new Path("C:/Program Files (x86)");
                console.log(`Looking for MATLAB in ${programFilesX86Path.path}...`);
                if (!(yield programFilesX86Path.exists()))
                    return {
                        matlabPath,
                        matlabVersion,
                        matlabIsOnPath,
                        message: `Could not find MATLAB as search location Program Files (x86) doesn't exist on this Windows operating system`,
                    };
                try {
                    try {
                        for (var _x = true, _y = __asyncValues(programFilesX86Path.globIter("MATLAB/**/bin/matlab.exe", {
                            onlyFiles: true,
                        })), _z; _z = yield _y.next(), _g = _z.done, !_g;) {
                            _j = _z.value;
                            _x = false;
                            try {
                                const matlabCandidatePath = _j;
                                const match = matlabVerRegex.search(matlabCandidatePath.path);
                                if (!match)
                                    continue;
                                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                                matlabPath = matlabCandidatePath.path;
                                matlabIsOnPath = false;
                                console.log(`MATLAB was found @ ${matlabPath} with version ${matlabVersion}`);
                                return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
                            }
                            finally {
                                _x = true;
                            }
                        }
                    }
                    catch (e_3_1) { e_3 = { error: e_3_1 }; }
                    finally {
                        try {
                            if (!_x && !_g && (_h = _y.return)) yield _h.call(_y);
                        }
                        finally { if (e_3) throw e_3.error; }
                    }
                }
                catch (error) {
                    if (error.code === "EACCESS" || error.code === "EPERM") {
                        return {
                            matlabPath,
                            matlabVersion,
                            matlabIsOnPath,
                            message: `Could not locate MATLAB as this application was not granted permission to search for it`,
                        };
                    }
                }
                return {
                    matlabPath,
                    matlabVersion,
                    matlabIsOnPath,
                    message: `No MATLAB path found in Program Files (x86) or Program Files`,
                }; // End of Windows case
            }
            else {
                // On Linux, we can first try /usr/local as the installation is typically /usr/local/MATLAB/R20XXx/bin/matlab
                const usrLocalPath = new Path("/usr/local");
                if (!(yield usrLocalPath.exists()))
                    return {
                        matlabPath,
                        matlabVersion,
                        matlabIsOnPath,
                        message: `Could not find MATLAB as search location /usr/local doesn't exist on this Linux operating system`,
                    };
                console.log(`Looking for MATLAB in ${usrLocalPath.path}...`);
                try {
                    try {
                        for (var _0 = true, _1 = __asyncValues(usrLocalPath.globIter("MATLAB*/**/bin/matlab", { onlyFiles: true })), _2; _2 = yield _1.next(), _k = _2.done, !_k;) {
                            _m = _2.value;
                            _0 = false;
                            try {
                                const matlabCandidatePath = _m;
                                const match = matlabVerRegex.search(matlabCandidatePath.path);
                                if (!match)
                                    continue;
                                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                                matlabPath = matlabCandidatePath.path;
                                matlabIsOnPath = false;
                                return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
                            }
                            finally {
                                _0 = true;
                            }
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (!_0 && !_k && (_l = _1.return)) yield _l.call(_1);
                        }
                        finally { if (e_4) throw e_4.error; }
                    }
                }
                catch (error) {
                    // Passthrough silently since /home/<username> is a backup and the proper EACCESS error will be captured there
                }
                // Sometimes MATLAB can't be installed in /usr/local, so we can try /home/<username>/
                const homePath = Path.home();
                if (!(yield homePath.exists()))
                    return {
                        matlabPath,
                        matlabVersion,
                        matlabIsOnPath,
                        message: `Could not find MATLAB as search location /home/<username> doesn't exist on this Linux operating system`,
                    };
                console.log(`Looking for MATLAB in ${homePath.path}...`);
                try {
                    try {
                        for (var _3 = true, _4 = __asyncValues(homePath.globIter("**/bin/matlab", { onlyFiles: true })), _5; _5 = yield _4.next(), _o = _5.done, !_o;) {
                            _q = _5.value;
                            _3 = false;
                            try {
                                const matlabCandidatePath = _q;
                                const match = matlabVerRegex.search(matlabCandidatePath.path);
                                if (!match)
                                    continue;
                                matlabVersion = Number(match.groupsObject.VERSIONNUMBER);
                                matlabPath = matlabCandidatePath.path;
                                matlabIsOnPath = false;
                                return { matlabPath, matlabVersion, matlabIsOnPath, message: `Successfully found matlab path and version.` };
                            }
                            finally {
                                _3 = true;
                            }
                        }
                    }
                    catch (e_5_1) { e_5 = { error: e_5_1 }; }
                    finally {
                        try {
                            if (!_3 && !_o && (_p = _4.return)) yield _p.call(_4);
                        }
                        finally { if (e_5) throw e_5.error; }
                    }
                }
                catch (error) {
                    if (error.code === "EACCESS" || error.code === "EPERM") {
                        return {
                            matlabPath,
                            matlabVersion,
                            matlabIsOnPath,
                            message: `Could not locate MATLAB as this application was not granted permission to search for it in /home/<username>`,
                        };
                    }
                }
                return {
                    matlabPath,
                    matlabVersion,
                    matlabIsOnPath,
                    message: `No MATLAB path found in /home/<username> or /usr/local`,
                };
            } // End of else case (Linux)
        } // End of try/catch with matlab not being on PATH
    });
}
/**
 * Creates a NodeJS environment for the ExploreASL module to be run in.
 * @param EASLType The type of ExploreASL exectuable to run. Either "GitHub" or "Compiled"
 * @param EASLPath The path to the ExploreASL executable's main folder.
 * @param MATLABRuntimePath The path to the MATLAB Runtime folder (i.e. v96).
 * @returns The NodeJS Environment object to be put into `spawns` env variable.
 */
export function createRuntimeEnvironment(EASLType, EASLPath, MATLABRuntimePath) {
    return __awaiter(this, void 0, void 0, function* () {
        if (EASLType === "Github")
            return Object.assign(Object.assign({}, process.env), { MATLABPATH: EASLPath });
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
        const currentEnvMapping = allEnvMappings[process.platform];
        const currentPATH = currentEnvMapping.varname in process.env ? process.env[currentEnvMapping.varname] : "";
        try {
            const runtimePaths = yield new Path(MATLABRuntimePath).glob(`**/${currentEnvMapping.globItem}`, {
                onlyDirectories: true,
            });
            if (runtimePaths.length === 0)
                return new CreateRuntimeError(`Could not locate the expected executables for your operating system's MATLAB Runtime: ${currentEnvMapping.globItem}`);
            const updatedPaths = currentPATH
                ? currentPATH + currentEnvMapping.delimiter + runtimePaths.map((p) => p.path).join(currentEnvMapping.delimiter)
                : runtimePaths.map((p) => p.path).join(currentEnvMapping.delimiter);
            return Object.assign(Object.assign({}, process.env), { [currentEnvMapping.varname]: updatedPaths });
        }
        catch (error) {
            return new CreateRuntimeError(`Could not locate the expected executables for your operating system's MATLAB Runtime due to permission issues. Please ensure that your MATLAB Runtime is installed in an accessible location.`);
        }
    });
}
function getSubjectImagetypes(path, globMapping) {
    return __awaiter(this, void 0, void 0, function* () {
        return {
            hasFLAIR: !!(yield path.globIter(globMapping.GlobFLAIR, { onlyFiles: true }).next()).value,
            hasM0: !!(yield path.globIter(globMapping.GlobM0, { onlyFiles: true }).next()).value,
            hasASL: !!(yield path.globIter(globMapping.GlobASL, { onlyFiles: true }).next()).value,
        };
    });
}
function calculateStructuralWorkload(dataPar, workloadSubset) {
    var _a, e_6, _b, _c;
    var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    return __awaiter(this, void 0, void 0, function* () {
        const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
        const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
        const excludedSubjects = new Set(dataPar.x.dataset.exclusion
            .map((s) => {
            // Remove trailing "_#"
            const match = exclusionRegex.search(s);
            return match ? match.groupsObject.SUBJECT : null;
        })
            .filter((v) => v));
        console.log(`Excluded subjects: ${Array.from(excludedSubjects).join(", ")}`);
        const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
        const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
        const globMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };
        const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
        let DARTELCounter = 0; // Used to keep track of subjects that aren't filtered out
        const structuralWorkload = {
            anticipatedFilepaths: [],
            anticipatedWorkload: [],
        };
        try {
            for (var _p = true, _q = __asyncValues(pathRawData.readDirIter()), _r; _r = yield _q.next(), _a = _r.done, !_a;) {
                _c = _r.value;
                _p = false;
                try {
                    const subjectPath = _c;
                    console.log("Checking subject:", subjectPath.path);
                    // Skip non-indicated subjects, excluded subjects, default folders, and non-directories
                    if (!subjectRegexp.test(subjectPath.basename) ||
                        excludedSubjects.has(subjectPath.basename) ||
                        defaultFolders.has(subjectPath.basename) ||
                        !(yield subjectPath.isDirectory())) {
                        console.log("Skipping subject:", subjectPath.path);
                        continue;
                    }
                    // console.log(`${subjectPath.path} is a subject to check`);
                    // Behavior differs based on whether there are visits or not
                    const visitPaths = yield subjectPath.glob("ses-*", { onlyDirectories: true });
                    console.log(`${subjectPath.path} has ${visitPaths.length} visits`);
                    // ^ If there are no visits, the expected rawdata folder structure is along the lines of:
                    //   - subject
                    //   |- anat
                    //      |- T1.nii.gz
                    //   |- perf
                    //      |- ASL.nii.gz
                    if (visitPaths.length === 0) {
                        // Skip based on dataPar settings
                        const { hasFLAIR, hasM0, hasASL } = yield getSubjectImagetypes(subjectPath, globMapping);
                        if ((!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
                            (!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
                            (!hasASL && dataPar.x.settings.SkipIfNoASL)) {
                            continue;
                        }
                        // Add to DARTEL counter
                        DARTELCounter++;
                        // Get the path of the directory that will hold the .status files; creating it if necessary
                        const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_Structural", `${subjectPath.basename}_1`, "xASL_module_Structural");
                        if (!(yield lockDirPath.exists())) {
                            yield lockDirPath.makeDir();
                        }
                        // Determine the expected .status files from the version's workload
                        const filterSet = new Set(["Structural"]);
                        if (hasFLAIR)
                            filterSet.add("Structural_FLAIR");
                        const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));
                        // Determine the workload based on the .status files not already existing
                        const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
                        for (let index = 0; index < workloadMappingEntires.length; index++) {
                            const [statusBasename, info] = workloadMappingEntires[index];
                            const statusFilepath = new Path(lockDirPath.path, statusBasename);
                            if (yield statusFilepath.exists())
                                continue;
                            // console.log(
                            //   `${statusFilepath.path} has not been created...adding to anticipated workload and loadingBarValue of ${info.loadingBarValue}`
                            // );
                            structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
                            structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
                        }
                    } // End of: if (visitPaths.length === 0)
                    // ^ Otherwise, there are visits, and we must iterate over them
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
                            const { hasFLAIR, hasM0, hasASL } = yield getSubjectImagetypes(visitPath, globMapping);
                            if ((!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) ||
                                (!hasM0 && dataPar.x.settings.SkipIfNoM0) ||
                                (!hasASL && dataPar.x.settings.SkipIfNoASL)) {
                                continue;
                            }
                            // Add to DARTEL counter
                            DARTELCounter++;
                            // Get the path of the directory that will hold the structural module .status files; creating it if necessary
                            const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_Structural", `${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
                            "xASL_module_Structural");
                            // console.log(`Making lock dir: ${lockDirPath.path}`);
                            if (!(yield lockDirPath.exists())) {
                                yield lockDirPath.makeDir();
                            }
                            // If necessary, do the same for the Longitudinal Registration module
                            if (dataPar.x.modules.bRunLongReg && visitPaths.length > 1) {
                                const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_LongReg", `${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
                                "xASL_module_LongReg");
                                if (!(yield lockDirPath.exists())) {
                                    yield lockDirPath.makeDir();
                                }
                            }
                            // Determine the expected .status files from the version's workload
                            const filterSet = new Set(["Structural"]);
                            if (hasFLAIR)
                                filterSet.add("Structural_FLAIR");
                            if (dataPar.x.modules.bRunLongReg && visitIndex === 0)
                                filterSet.add("LongReg"); // Only the first visit gets the LongReg status files
                            const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));
                            // Determine the workload based on the .status files not already existing
                            const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
                            for (let index = 0; index < workloadMappingEntires.length; index++) {
                                const [statusBasename, info] = workloadMappingEntires[index];
                                const statusFilepath = new Path(lockDirPath.path, statusBasename);
                                if (yield statusFilepath.exists())
                                    continue;
                                structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
                                structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
                            }
                        }
                    } // End of visits.length > 0
                }
                finally {
                    _p = true;
                }
            } // End of for await (const subjectPath of pathRawData.readDirIter())
        }
        catch (e_6_1) { e_6 = { error: e_6_1 }; }
        finally {
            try {
                if (!_p && !_a && (_b = _q.return)) yield _b.call(_q);
            }
            finally { if (e_6) throw e_6.error; }
        }
        // ^ DARTEL status files are expected if there is more than 1 subject (DARTELCounter > 1) and the appropriate dataPar
        // ^ settings are set
        console.log(`DARTELCounter: ${DARTELCounter}`, (_e = (_d = dataPar.x) === null || _d === void 0 ? void 0 : _d.modules) === null || _e === void 0 ? void 0 : _e.bRunDARTEL, (_h = (_g = (_f = dataPar.x) === null || _f === void 0 ? void 0 : _f.modules) === null || _g === void 0 ? void 0 : _g.structural) === null || _h === void 0 ? void 0 : _h.bSegmentSPM12);
        if (DARTELCounter > 1 && (((_k = (_j = dataPar.x) === null || _j === void 0 ? void 0 : _j.modules) === null || _k === void 0 ? void 0 : _k.bRunDARTEL) || ((_o = (_m = (_l = dataPar.x) === null || _l === void 0 ? void 0 : _l.modules) === null || _m === void 0 ? void 0 : _m.structural) === null || _o === void 0 ? void 0 : _o.bSegmentSPM12))) {
            const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_DARTEL_T1", "xASL_module_DARTEL");
            if (!(yield lockDirPath.exists())) {
                yield lockDirPath.makeDir();
            }
            const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => v.module === "DARTEL_T1");
            // Determine the workload based on the .status files not already existing
            const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
            for (let index = 0; index < workloadMappingEntires.length; index++) {
                const [statusBasename, info] = workloadMappingEntires[index];
                const statusFilepath = new Path(lockDirPath.path, statusBasename);
                if (yield statusFilepath.exists())
                    continue;
                structuralWorkload.anticipatedFilepaths.push(statusFilepath.path);
                structuralWorkload.anticipatedWorkload.push(info.loadingBarValue);
            }
        }
        // console.log(`calculateStructuralWorkload -- Structural workload:`, JSON.stringify(structuralWorkload, null, 2));
        return structuralWorkload;
    });
}
function calculateASLWorkload(dataPar, workloadSubset) {
    var _a, e_7, _b, _c, _d, e_8, _e, _f, _g, e_9, _h, _j;
    return __awaiter(this, void 0, void 0, function* () {
        const subjectRegexp = new RegExp(dataPar.x.dataset.subjectRegexp);
        const exclusionRegex = new Regex(`(?<SUBJECT>.*?)(?:_\\d+)?$`);
        const excludedSubjects = new Set(dataPar.x.dataset.exclusion
            .map((s) => {
            // Remove trailing "_#"
            const match = exclusionRegex.search(s);
            return match ? match.groupsObject.SUBJECT : null;
        })
            .filter((v) => v));
        console.log(`Excluded subjects: ${Array.from(excludedSubjects).join(", ")}`);
        const defaultFolders = new Set(["Population", "log", "lock", "Logs"]);
        const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
        const pathRawData = new Path(dataPar.x.GUI.StudyRootPath, "rawdata");
        const globMapping = { GlobASL: "*/*_asl.nii*", GlobM0: "*/*_m0scan.nii", GlobFLAIR: "*FLAIR*.nii*" };
        const regexMultiSession = new Regex("run-(?<SessionName>[\\w_]+)_asl\\.json");
        // Determine the expected .status files from the version's workload
        const filterSet = new Set(["ASL"]);
        const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => filterSet.has(v.module));
        const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
        // console.log(`calculateASLWorkload -- Filtered workload mapping: ${JSON.stringify(filteredWorkloadMapping, null, 2)}`);
        const aslWorkload = {
            anticipatedFilepaths: [],
            anticipatedWorkload: [],
        };
        try {
            for (var _k = true, _l = __asyncValues(pathRawData.readDirIter()), _m; _m = yield _l.next(), _a = _m.done, !_a;) {
                _c = _m.value;
                _k = false;
                try {
                    const subjectPath = _c;
                    // Skip non-indicated subjects, excluded subjects, default folders, and non-directories
                    if (!subjectRegexp.test(subjectPath.basename) ||
                        excludedSubjects.has(subjectPath.basename) ||
                        defaultFolders.has(subjectPath.basename) ||
                        !(yield subjectPath.isDirectory())) {
                        continue;
                    }
                    // console.log(`calculateASLWorkload -- Processing subject ${subjectPath.basename}`);
                    // Skip based on dataPar settings
                    const { hasFLAIR } = yield getSubjectImagetypes(subjectPath, globMapping);
                    // Skip based on dataPar settings
                    if (!hasFLAIR && dataPar.x.settings.SkipIfNoFlair) {
                        continue;
                    }
                    // Behavior differs based on whether there are visits or not
                    const visitPaths = yield subjectPath.glob("ses-*", { onlyDirectories: true });
                    /**
                     * ^ MAIN SCENARIO A: Single visit
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
                         * ^ Scenario A1: Multiple sessions with only one visit
                         * EXPECTED BASENAMES: sub-<subject>_run-<session>_asl.json
                         */
                        const sessionPaths = yield subjectPath.glob("perf/*_run-*_asl.json", { onlyFiles: true });
                        /**
                         * ^ Scenario A2: Single session with only one visit
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
                            if (!(yield singleSessionPath.exists())) {
                                // console.log(`Skipping subject ${subjectPath.basename} because no ASL data found`);
                                continue;
                            }
                            sessionPaths.push(singleSessionPath); // convert to length-1 array in order to keep consistency
                        }
                        try {
                            // console.log(
                            //   `calculateASLWorkload -- Subject ${subjectPath.basename} sessionPaths`,
                            //   JSON.stringify(sessionPaths, null, 2)
                            // );
                            // Now iterate over the sessions within each subject
                            for (var _o = true, sessionPaths_1 = (e_8 = void 0, __asyncValues(sessionPaths)), sessionPaths_1_1; sessionPaths_1_1 = yield sessionPaths_1.next(), _d = sessionPaths_1_1.done, !_d;) {
                                _f = sessionPaths_1_1.value;
                                _o = false;
                                try {
                                    const sessionFilepath = _f;
                                    let sessionName;
                                    if (isMultiSession) {
                                        const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
                                        if (!sessionMatch) {
                                            console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
                                            continue;
                                        }
                                        sessionName = `ASL_${sessionMatch.groupsObject.SessionName}`;
                                    }
                                    else {
                                        sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
                                    }
                                    // Get the path of the directory that will hold the .status files; creating it if necessary
                                    const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_ASL", `${subjectPath.basename}_1`, // For a single default visit, append "_1"
                                    `xASL_module_ASL_${sessionName}`);
                                    if (!(yield lockDirPath.exists())) {
                                        yield lockDirPath.makeDir();
                                    }
                                    // console.log(`calculateASLWorkload -- Checking existing .status files in ${lockDirPath.path}`);
                                    // Determine the workload based on the .status files not already existing
                                    for (let index = 0; index < workloadMappingEntires.length; index++) {
                                        const [statusBasename, info] = workloadMappingEntires[index];
                                        const statusFilepath = new Path(lockDirPath.path, statusBasename);
                                        if (yield statusFilepath.exists())
                                            continue;
                                        aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
                                        aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
                                    }
                                }
                                finally {
                                    _o = true;
                                }
                            }
                        }
                        catch (e_8_1) { e_8 = { error: e_8_1 }; }
                        finally {
                            try {
                                if (!_o && !_d && (_e = sessionPaths_1.return)) yield _e.call(sessionPaths_1);
                            }
                            finally { if (e_8) throw e_8.error; }
                        }
                        /**
                         * ^ MAIN SCENARIO B: Multiple visits
                         * General rawdata folder structure:
                         *  - sub-<subject>
                         *      |- ses-<session>
                         *          |- anat
                         *          |- perf
                         *               |- sub-<subject>_ses-<visit>_run-<session>_asl.nii.gz
                         *               OR
                         *               |- sub-<subject>_ses-<visit>_asl.nii.gz
                         */
                    }
                    else {
                        // console.log(`Subject ${subjectPath.basename} has ${visitPaths.length} visits`);
                        for (let visitIndex = 0; visitIndex < visitPaths.length; visitIndex++) {
                            const visitPath = visitPaths[visitIndex];
                            // console.log(`Assessing visit ${visitPath.basename}`);
                            /**
                             * ^ Scenario B1: Multiple sessions and multiple visits
                             * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_run-<session>_asl.json
                             */
                            const aslJSONGlobPattern = `perf/${subjectPath.basename}_${visitPath.basename}_run-*_asl.json`;
                            let sessionPaths = yield visitPath.glob(aslJSONGlobPattern, {
                                onlyFiles: true,
                            });
                            /**
                             * ^ Scenario B2: Single session and multiple visits
                             * EXPECTED BASENAMES: sub-<subject>_ses-<visit>_asl.json
                             */
                            const isMultiSession = sessionPaths.length > 0;
                            if (!isMultiSession) {
                                const singleSessionBasename = `${subjectPath.basename}_${visitPath.basename}_asl.json`;
                                const singleSessionPath = visitPath.resolve(`perf/${singleSessionBasename}`);
                                if (!(yield singleSessionPath.exists())) {
                                    // console.log(
                                    //   `Could not find expected session file ${singleSessionBasename} for visit ${visitPath.basename}`
                                    // );
                                    continue;
                                }
                                sessionPaths = [singleSessionPath]; // convert to length-1 array in order to keep consistency
                            }
                            try {
                                // console.log(`Sessions found for visit ${visitPath.basename}: ${sessionPaths.map(p => p.path)}`);
                                // Now iterate over the sessions within each subject
                                for (var _p = true, sessionPaths_2 = (e_9 = void 0, __asyncValues(sessionPaths)), sessionPaths_2_1; sessionPaths_2_1 = yield sessionPaths_2.next(), _g = sessionPaths_2_1.done, !_g;) {
                                    _j = sessionPaths_2_1.value;
                                    _p = false;
                                    try {
                                        const sessionFilepath = _j;
                                        let sessionName;
                                        if (isMultiSession) {
                                            const sessionMatch = regexMultiSession.search(sessionFilepath.basename);
                                            if (!sessionMatch) {
                                                console.log(`calculateASLWorkload -- Could not match session name in ${sessionFilepath.basename}`);
                                                continue;
                                            }
                                            sessionName = `ASL_${sessionMatch.groupsObject.SessionName}`;
                                        }
                                        else {
                                            sessionName = "ASL_1"; // For single session, use a default session name of "ASL_1" from ExploreASL
                                        }
                                        // Get the path of the directory that will hold the .status files; creating it if necessary
                                        const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_ASL", `${subjectPath.basename}_${visitIndex + 1}`, // +1 to account for MATLAB indexing
                                        `xASL_module_ASL_${sessionName}`);
                                        if (!(yield lockDirPath.exists())) {
                                            yield lockDirPath.makeDir();
                                        }
                                        // Determine the workload based on the .status files not already existing
                                        for (let index = 0; index < workloadMappingEntires.length; index++) {
                                            const [statusBasename, info] = workloadMappingEntires[index];
                                            const statusFilepath = new Path(lockDirPath.path, statusBasename);
                                            if (yield statusFilepath.exists())
                                                continue;
                                            // console.log(`calculateASLWorkload -- Adding ${statusFilepath.path} to workload`);
                                            aslWorkload.anticipatedFilepaths.push(statusFilepath.path);
                                            aslWorkload.anticipatedWorkload.push(info.loadingBarValue);
                                        }
                                    }
                                    finally {
                                        _p = true;
                                    }
                                }
                            }
                            catch (e_9_1) { e_9 = { error: e_9_1 }; }
                            finally {
                                try {
                                    if (!_p && !_g && (_h = sessionPaths_2.return)) yield _h.call(sessionPaths_2);
                                }
                                finally { if (e_9) throw e_9.error; }
                            }
                        }
                    }
                }
                finally {
                    _k = true;
                }
            }
        }
        catch (e_7_1) { e_7 = { error: e_7_1 }; }
        finally {
            try {
                if (!_k && !_a && (_b = _l.return)) yield _b.call(_l);
            }
            finally { if (e_7) throw e_7.error; }
        }
        return aslWorkload;
    });
}
function calculatePopulationWorkload(dataPar, workloadSubset) {
    return __awaiter(this, void 0, void 0, function* () {
        const pathDerivativesEASL = new Path(dataPar.x.GUI.StudyRootPath, "derivatives", "ExploreASL");
        const populationWorkload = {
            anticipatedFilepaths: [],
            anticipatedWorkload: [],
        };
        // Get the path of the directory that will hold the .status files; creating it if necessary
        const lockDirPath = new Path(pathDerivativesEASL.path, "lock", "xASL_module_Population", "xASL_module_Population");
        if (!(yield lockDirPath.exists())) {
            yield lockDirPath.makeDir();
        }
        // Determine the expected .status files from the version's workload
        const filteredWorkloadMapping = lodashPickBy(workloadSubset, (v) => v.module === "Population");
        // Determine the workload based on the .status files not already existing
        const workloadMappingEntires = Object.entries(filteredWorkloadMapping);
        for (let index = 0; index < workloadMappingEntires.length; index++) {
            const [statusBasename, info] = workloadMappingEntires[index];
            const statusFilepath = new Path(lockDirPath.path, statusBasename);
            if (yield statusFilepath.exists())
                continue;
            populationWorkload.anticipatedFilepaths.push(statusFilepath.path);
            populationWorkload.anticipatedWorkload.push(info.loadingBarValue);
        }
        return populationWorkload;
    });
}
export function calculateWorkload(dataPar, studySetup, workloadMapping) {
    return __awaiter(this, void 0, void 0, function* () {
        let payload = {
            anticipatedFilepaths: [],
            anticipatedWorkload: 0,
        };
        // Calculate accordingly
        /************
         * Structural
         ***********/
        if (studySetup.whichModulesToRun === "Structural") {
            try {
                const { anticipatedWorkload: structuralWorkload, anticipatedFilepaths: structuralPaths } = yield calculateStructuralWorkload(dataPar, workloadMapping);
                payload = {
                    anticipatedFilepaths: structuralPaths,
                    anticipatedWorkload: lodashSum(structuralWorkload),
                };
            }
            catch (error) {
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
        }
        else if (studySetup.whichModulesToRun === "ASL") {
            try {
                const { anticipatedWorkload: aslWorkload, anticipatedFilepaths: aslPaths } = yield calculateASLWorkload(dataPar, workloadMapping);
                payload = {
                    anticipatedFilepaths: aslPaths,
                    anticipatedWorkload: lodashSum(aslWorkload),
                };
            }
            catch (error) {
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
        }
        else if (studySetup.whichModulesToRun === "Both") {
            // eslint-disable-next-line
            const [strucResult, aslResult] = yield Promise.all([
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
        }
        else if (studySetup.whichModulesToRun === "Population") {
            try {
                const { anticipatedWorkload: popWorkload, anticipatedFilepaths: popPaths } = yield calculatePopulationWorkload(dataPar, workloadMapping);
                payload = {
                    anticipatedFilepaths: popPaths,
                    anticipatedWorkload: lodashSum(popWorkload),
                };
            }
            catch (error) {
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
        }
        else {
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
        }
        else {
            return {
                GUIMessage: {
                    title: "Calculated Anticipated Workload",
                    messages: [`Anticipating the creation of ${payload.anticipatedFilepaths.length} ".status" files`],
                    severity: "success",
                },
                payload: payload,
            };
        }
    });
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
export function getExploreASLExitSummary(StudyDerivExploreASLDir, setOfAnticipatedFilepaths, workloadMapping) {
    return __awaiter(this, void 0, void 0, function* () {
        const allStatusFiles = yield StudyDerivExploreASLDir.resolve("lock").glob("**/*.status", {
            onlyFiles: true,
            onlyDirectories: false,
        });
        const missedStatusFiles = lodashDiff(Array.from(setOfAnticipatedFilepaths), lodashUniq(allStatusFiles.map((p) => p.path)));
        // Early exit if all is in order
        if (missedStatusFiles.length === 0)
            return { missedStatusFiles, missedStepsMessages: [] };
        const missedStepsMessages = [];
        const seenItems = new Set();
        for (const statusFP of missedStatusFiles) {
            const match = REGEXSTATUSFULE.search(statusFP);
            if (!match)
                continue;
            const { Module, Subject, Session, StatusBasename } = match.groupsObject;
            if (!(StatusBasename in workloadMapping))
                continue;
            // Population module is a special case, prompting an early return
            if (Module === "Population" || Module === "DARTEL_T1") {
                missedStepsMessages.push(`Module: ${Module} ...failed at earliest step: ${workloadMapping[StatusBasename].description}`);
                return { missedStatusFiles, missedStepsMessages };
            }
            if (seenItems.has(`${Subject}${Session}`) || !(StatusBasename in workloadMapping))
                continue;
            const item = Session
                ? `Module: ${Module}, Subject/Visit: ${Subject}, Session: ${Session}`
                : `Module: ${Module}, Subject/Visit: ${Subject}`;
            const description = `...failed at earliest step: ${workloadMapping[StatusBasename].description}`;
            const message = `${item} ${description}`;
            missedStepsMessages.push(message);
            seenItems.add(`${Subject}${Session}`);
        }
        return { missedStatusFiles, missedStepsMessages };
    });
}
/**
 * Removes lock directories associated with subjects that are anticipated to be run
 * @param BIDS2LegacyLockDir The directory containing the BIDS2Legacy lock files.
 * @param anticipatedFilepaths An array of string filepaths of the .status files that are anticipated to be created.
 * @returns void
 */
export function RemoveBIDS2LegacyLockDirs(BIDS2LegacyLockDir, anticipatedFilepaths) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield Promise.all(anticipatedFilepaths.map((filepath) => __awaiter(this, void 0, void 0, function* () {
            try {
                const match = REGEXSTATUSFULE.search(filepath);
                if (!match)
                    return;
                const { Subject } = match.groupsObject;
                if (!Subject)
                    return; // Population Module returns an empty string
                // Skip if the subject is not in the BIDS2LegacyLockDir
                const BIDS2LegacySubjectLockDir = BIDS2LegacyLockDir.resolve(Subject);
                if (!(yield BIDS2LegacySubjectLockDir.exists()))
                    return;
                yield BIDS2LegacySubjectLockDir.remove();
            }
            catch (error) {
                console.warn(`Failed to remove ${filepath}. Reason: ${error}`);
                return;
            }
        })));
    });
}
console.log("Foo");
//# sourceMappingURL=runExploreASLHelperFunctions.js.map