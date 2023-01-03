var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { uniq as lodashUniq } from "lodash";
import * as Yup from "yup";
import { IsValidStudyRoot } from "../../utils/EASLFunctions";
import { yupCreateError } from "../../utils/formFunctions";
import { makeForwardSlashes } from "../../utils/stringFunctions";
const { api } = window;
export const ImportModule__SourcedataStructureTest = (folderStruct, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    if (!folderStruct)
        return false;
    // Blank fields are not allowed
    if (folderStruct.some((folder) => folder === ""))
        return yupCreateError(helpers, "Blank fields are not allowed");
    // Must contain "Subject" and "Scan" at minimum
    if (!folderStruct.includes("Subject") || !folderStruct.includes("Scan"))
        return yupCreateError(helpers, "Must contain 'Subject' and 'Scan' at minimum");
    // Depends on the validity of the study root path
    const studyRootPath = helpers.parent.StudyRootPath;
    const isValid = yield IsValidStudyRoot(studyRootPath, helpers, ["sourcedata"]);
    if (!isValid || isValid instanceof Yup.ValidationError)
        return yupCreateError(helpers, "Cannot determine the validity of the folder structure when the Study Root Path is invalid");
    // Assuming a valid root path, check for existence of filepaths at the given depth
    const globPattern = folderStruct.map(() => "*").join("/") + "/*"; // Extra * to match all files in the final folder level
    const fp = studyRootPath + "/sourcedata";
    console.log(`🔎 Validating Import Module -- FolderStruct:`, { folderStruct, globPattern, fp });
    const dicomFiles = yield api.path.glob(fp, globPattern, {
        onlyDirectories: false,
        onlyFiles: true,
    });
    if (dicomFiles.length === 0)
        return yupCreateError(helpers, "No DICOM files found under the indicated folder structure");
    return true;
});
export const ImportModule__MappingScanAliasesTest = (mapping, helpers) => {
    // At least one scan alias must be defined
    const scansNotIgnored = Object.values(mapping).filter((scan) => scan !== "Ignore");
    if (scansNotIgnored.length === 0)
        return yupCreateError(helpers, "At least one scan alias must be defined");
    return true;
};
export const ImportModule__MappingVisitAliasesTest = (mapping, helpers) => {
    return Object.values(mapping).every((alias) => alias !== "");
};
export const MappingSessionAliasesTest = (mapping, helpers) => {
    const sessionAliases = Object.values(mapping);
    const isAllUnique = lodashUniq(sessionAliases).length === sessionAliases.length;
    const isAllNotBlank = sessionAliases.every((alias) => alias !== "");
    return isAllUnique && isAllNotBlank;
};
export const ImportModule__M0PositionInASLTest = (m0Pos, helpers) => {
    // No M0 position is allowed to exceed the number of volumes
    const nVolumes = helpers.parent.NVolumes;
    if (m0Pos.some((pos) => pos > nVolumes))
        return yupCreateError(helpers, "At least one specified M0 position is greater than the number of volumes");
    return true;
};
export const ImportModule__DummyPositionInASLTest = (dummyPositions, helpers) => {
    if (dummyPositions.length === 0)
        return true;
    const nVolumes = helpers.parent.NVolumes;
    // No dummy position is allowed to exceed the number of volumes
    if (dummyPositions.some((pos) => pos > nVolumes))
        return yupCreateError(helpers, "At least one specified dummy position is greater than the number of volumes");
    return true;
};
export const ImportModule__SingleContextPathsTest = (paths, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🔎 Validating Import Module -- Context.Paths:`, paths);
    // At least one path is required
    if (paths.length === 0)
        return yupCreateError(helpers, "At least one path is required when specifying an additional context");
    // Further validation depends on the validity of the study root path
    const studyRootPath = helpers.options.context.StudyRootPath;
    // If the study root path is invalid, we cannot validate the paths
    if (!studyRootPath || !((yield api.path.getFilepathType(`${studyRootPath}/sourcedata`)) === "dir"))
        return yupCreateError(helpers, "Cannot determine the validity of the folder structure when the Study Root Path is invalid");
    // Each path must be validated: must exist and the level beyond "sourcedata" that its basename
    // occurs at must match be a Subject, Visit, or Session; forward slashe conversions required
    const permissibleBasenameTypes = new Set(["Subject", "Visit", "Session"]);
    const SourcedataStructure = helpers.options.context.SourcedataStructure;
    const sourcedataPathForwardSlash = `${makeForwardSlashes(studyRootPath)}/sourcedata/`;
    for (const path of paths) {
        if (!(yield api.path.filepathExists(path)))
            return false;
        const pathParts = makeForwardSlashes(path).replace(sourcedataPathForwardSlash, "").split("/");
        const pathDepth = pathParts.length;
        const folderType = SourcedataStructure[pathDepth - 1];
        // console.log(`${path} is a ${folderType}`);
        if (!permissibleBasenameTypes.has(folderType))
            return yupCreateError(helpers, `Path ${path} was not found to be a Subject, Visit, or Session`);
    }
    // Finally, we should verify that there are no duplicate paths
    const allPaths = helpers.options.context.ImportContexts.flatMap((context) => context.Paths);
    if (lodashUniq(allPaths).length !== allPaths.length)
        return yupCreateError(helpers, "At least one duplicate path was found among all contexts. Paths must be unique.");
    return true;
});
export const ImportModule__BolusCutOffDelayTimeTest = (value, helpers) => {
    const cutOffTechnique = helpers.parent.BolusCutOffTechnique;
    if (cutOffTechnique === "Q2TIPS") {
        if (!Array.isArray(value) || value.length !== 2)
            return yupCreateError(helpers, "Q2TIPS requires 2 values");
    }
    else {
        if (Array.isArray(value))
            return yupCreateError(helpers, "Non-Q2TIPS requires a single value");
    }
    return true;
};
export const ImportModule__BackgroundSuppressionPulseTimeTest = (pulseTimes, helpers) => {
    console.log(`🔎 Validating Import Module -- Context.BackgroundSuppressionPulseTime:`, pulseTimes);
    return pulseTimes.length === helpers.parent.BackgroundSuppressionNumberPulses;
};
//# sourceMappingURL=ImportSchemaCustomTests.js.map