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
export const Schema_StudyRootPathPreImport = SchemaMin_StudyRootPath.test(
	"IsValidStudyRoot",
	"Invalid Study Root filepath. Ensure it is an existent directory.",
	async (filepath, helpers) => {
		console.log("Validating Study Root Path");
		return await IsValidStudyRoot(filepath, helpers, ["sourcedata"]);
	}
);

/**
 * Schema for the study root path.
 * - Must be a valid directory
 * - Must contain the following subdirectories: sourcedata, rawdata, derivatives
 * The above conditions are fulfulled by the time the Import Module is completed.
 */
export const Schema_StudyRootPathPostImport = SchemaMin_StudyRootPath.test(
	"IsValidStudyRoot",
	"Invalid Study Root filepath. Ensure it is an existent directory.",
	async (filepath, helpers) => {
		console.log("Validating Study Root Path");
		return await IsValidStudyRoot(filepath, helpers, ["sourcedata", "rawdata", "derivatives"]);
	}
);

/**
 * Schema for the study root path.
 * - Must be a valid directory
 * - Must contain the following subdirectories: sourcedata, rawdata, derivatives, derivatives/ExploreASL/lock
 * - Must contain the dataPar.json file
 */
export const Schema_StudyRootPathPreProcess = SchemaMin_StudyRootPath.test(
	"IsValidStudyRoot",
	"Invalid Study Root filepath. Ensure it is an existent directory.",
	async (filepath, helpers) => {
		const { api } = window;

		// Check if the study root path is valid and contains the required subdirectories
		const result = await IsValidStudyRoot(filepath, helpers, [
			"sourcedata",
			"rawdata",
			"derivatives",
			"derivatives/ExploreASL/lock",
		]);
		if (result !== true) return result;

		// Must check if the studyRootPath also has the dataPar.json file
		const dataParFileStatus = await api.path.getFilepathType(`${filepath}/dataPar.json`);
		if (dataParFileStatus !== "file")
			return helpers.createError({
				path: helpers.path,
				message: "Study Root is missing the dataPar.json file. Have you run the 'Define Parameters' step?",
			});
		return true;
	}
);
