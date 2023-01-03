var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as Yup from "yup";
import { IsValidStudyRoot } from "../../utils/EASLFunctions";
/** Minimal schema for the study root path as a required text-based field */
const SchemaMin_StudyRootPath = Yup.string().typeError("This field must be text").required("This is a required field");
/**
 * Schema for the study root path.
 * - Must be a valid directory
 * - Must contain the following subdirectories: sourcedata
 * The above conditions should be fulfilled before the Import Module is started
 */
export const Schema_StudyRootPathPreImport = SchemaMin_StudyRootPath.test("IsValidStudyRoot", "Invalid Study Root filepath. Ensure it is an existent directory.", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Validating Study Root Path");
    return yield IsValidStudyRoot(filepath, helpers, ["sourcedata"]);
}));
/**
 * Schema for the study root path.
 * - Must be a valid directory
 * - Must contain the following subdirectories: sourcedata, rawdata, derivatives
 * The above conditions are fulfulled by the time the Import Module is completed.
 */
export const Schema_StudyRootPathPostImport = SchemaMin_StudyRootPath.test("IsValidStudyRoot", "Invalid Study Root filepath. Ensure it is an existent directory.", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Validating Study Root Path");
    return yield IsValidStudyRoot(filepath, helpers, ["sourcedata", "rawdata", "derivatives"]);
}));
/**
 * Schema for the study root path.
 * - Must be a valid directory
 * - Must contain the following subdirectories: sourcedata, rawdata, derivatives, derivatives/ExploreASL/lock
 * - Must contain the dataPar.json file
 */
export const Schema_StudyRootPathPreProcess = SchemaMin_StudyRootPath.test("IsValidStudyRoot", "Invalid Study Root filepath. Ensure it is an existent directory.", (filepath, helpers) => __awaiter(void 0, void 0, void 0, function* () {
    const { api } = window;
    // Check if the study root path is valid and contains the required subdirectories
    const result = yield IsValidStudyRoot(filepath, helpers, [
        "sourcedata",
        "rawdata",
        "derivatives",
        "derivatives/ExploreASL/lock",
    ]);
    if (result !== true)
        return result;
    // Must check if the studyRootPath also has the dataPar.json file
    const dataParFileStatus = yield api.path.getFilepathType(`${filepath}/dataPar.json`);
    if (dataParFileStatus !== "file")
        return helpers.createError({
            path: helpers.path,
            message: "Study Root is missing the dataPar.json file. Have you run the 'Define Parameters' step?",
        });
    return true;
}));
//# sourceMappingURL=EASLGUIPathsSchema.js.map