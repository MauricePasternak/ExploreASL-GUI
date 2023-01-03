var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { SUPPORTEDMATLABRUNTIMEVERSIONS } from "../GLOBALS";
import { EASLWorkloadMapping } from "../schemas/ExploreASLWorkloads/ExploreASLWorkloads";
import { Regex } from "./Regex";
const { api } = window;
/**
 * Wrapper for frontend retrieval of the ExploreASL version indicated.
 * @param filepath The filepath to the ExploreASL root directory.
 * @returns An Object with properties:
 * - `EASLVersioPath`: The path to the ExploreASL verison file as a `Path`.
 * - `EASLVersionNumber`: The version number as ### (i.e. 110 for 1.10) on the basis of Major and Minor version numbers.
 */
export function rendererGetEASLVersion(filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = {
            EASLVersionPath: null,
            EASLVersionNumber: null,
        };
        const EASLVersionRegex = new Regex("VERSION_(?<Major>\\d+)\\.(?<Minor>\\d+)\\.(?<Patch>\\d+)", "m");
        const [versionFile] = yield api.path.glob(filepath, "VERSION_*", { onlyFiles: true, onlyDirectories: false });
        if (!versionFile)
            return result;
        result.EASLVersionPath = versionFile;
        const match = EASLVersionRegex.search(versionFile.path);
        if (!match)
            return result;
        const { Major, Minor } = match.groupsObject;
        result.EASLVersionNumber = parseInt(`${Major}${Minor}`, 10);
        return result;
    });
}
/**
 * Function for determining whether a filepath for an ExploreASL directory is valid.
 * @param filepath The filepath to the ExploreASL directory.
 * @param easlType The type of EASL to be checked. Either "Github" or "Compiled".
 * @param helpers Helper context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export function IsValidEASLPath(filepath, easlType, helpers) {
    return __awaiter(this, void 0, void 0, function* () {
        // Filepath must be a valid string
        if (!filepath || typeof filepath !== "string")
            return false;
        const filePathType = yield api.path.getFilepathType(filepath);
        // Filepath must be a directory
        if (filePathType !== "dir")
            return false;
        // Version must exist and be in the currently-supported version list
        const { EASLVersionPath } = yield rendererGetEASLVersion(filepath);
        // Version file must exist and be in the current accepted mappings
        if (!EASLVersionPath) {
            return helpers.createError({ path: helpers.path, message: "Could not locate an ExploreASL Version File" });
        }
        if (!(EASLVersionPath.basename in EASLWorkloadMapping)) {
            return helpers.createError({
                path: helpers.path,
                message: `This GUI does not support ExploreASL version: ${EASLVersionPath.basename}`,
            });
        }
        // There must be an executable file in the directory
        const expectedBasename = easlType === "Compiled" ? (api.platform === "win32" ? "xASL_latest.exe" : "run_xASL_latest.sh") : "ExploreASL.m";
        const hasExecutable = !!(yield api.path.containsImmediateChild(filepath, expectedBasename));
        if (!hasExecutable) {
            return helpers.createError({
                path: helpers.path,
                message: `This folder was expected to contain a "${expectedBasename}" file.`,
            });
        }
        // Filepath is valid
        return true;
    });
}
/**
 * Function for detemrining whether a filepath for a MATLAB Runtime is valid for this GUI.
 * @param filepath The filepath to the proposed MATLAB Runtime directory.
 * @param helpers Helper context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export function IsValidMATLABRuntimePath(filepath, helpers) {
    return __awaiter(this, void 0, void 0, function* () {
        // Filepath must be a valid string
        if (!filepath || typeof filepath !== "string")
            return false;
        const filePathType = yield api.path.getFilepathType(filepath);
        // Filepath must be a directory
        if (filePathType !== "dir")
            return false;
        // Must contain a valid MATLAB Runtime version
        const asPath = api.path.asPath(filepath);
        if (!/^v\d{2,3}$/.test(asPath.basename)) {
            return helpers.createError({
                path: helpers.path,
                message: "Not a MATLAB Runtime folder. A MATLAB runtime folder has the format v9# (i.e. v97)",
            });
        }
        // The version must be supported by this GUI
        if (!SUPPORTEDMATLABRUNTIMEVERSIONS.includes(asPath.basename)) {
            return helpers.createError({
                path: helpers.path,
                message: "The MATLAB Runtime must be at least v96 (R2019a)",
            });
        }
        // Filepath is valid
        return true;
    });
}
/**
 * Function for determining whether a filepath is valid for being a study root directory.
 * @param filepath The filepath to be assessed
 * @param helpers Helper context & functions provided by Yup.
 * @param expectedChildren An array of expected child basenames.
 * @returns A boolean or a Yup.ValidationError.
 */
export function IsValidStudyRoot(filepath, helpers, expectedChildren = ["sourcedata"]) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("IsValidStudyRoot -- filepath: ", filepath);
        // Filepath must be a valid string
        if (!filepath)
            return false;
        const filePathType = yield api.path.getFilepathType(filepath);
        if (filePathType !== "dir")
            return false;
        const children = yield api.path.containsChildren(filepath, expectedChildren);
        if (!children.every(child => Boolean(child))) {
            return helpers.createError({
                path: helpers.path,
                message: `This folder was expected to contain the following ${expectedChildren.length === 1 ? "folder" : "folders"}: ${expectedChildren.join(", ")}`,
            });
        }
        return true;
    });
}
/**
 * Function for determining whether a series of basenames are valid for a given study root.
 * @param subjectBasenames An array of subject basenames.
 * @param helpers Helpers context & functions provided by Yup.
 * @returns A boolean or a Yup.ValidationError.
 */
export function AreValidSubjects(subjectBasenames, helpers) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!subjectBasenames || !Array.isArray(subjectBasenames) || !subjectBasenames.length) {
            return helpers.createError({
                path: helpers.path,
                message: "Invalid value provided for the listing of subjects",
            });
        }
        // Must first ascertain that
        const StudyRootPath = helpers.options.context.x.GUI.StudyRootPath;
        console.log(`AreValidSubjects -- StudyRootPath: ${StudyRootPath}`);
        if (!StudyRootPath || // Cannot be falsy
            typeof StudyRootPath !== "string" || // Must be a string
            (yield IsValidStudyRoot(StudyRootPath, helpers, ["sourcedata", "rawdata", "derivatives"])) !== true // Must be a valid study root
        ) {
            return helpers.createError({
                path: helpers.path,
                message: "Cannot validate the subjects because the Study Root Path itself is invalid",
            });
        }
        // Must all exist in rawdata
        const existenceChecks = yield api.path.getFilepathsType(subjectBasenames.map(subjectBasename => `${StudyRootPath}/rawdata/${subjectBasename}`));
        if (!existenceChecks.every(check => check === "dir")) {
            return helpers.createError({
                path: helpers.path,
                message: "One or more of the provided subjects do not exist in the rawdata folder",
            });
        }
        return true;
    });
}
//# sourceMappingURL=EASLFunctions.js.map