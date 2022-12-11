import { IsValidStudyRoot } from "../../utils/EASLFunctions";
import * as Yup from "yup";
import {
	BolusCutOffTechniqueType,
	ImportSchemaType,
	SourcedataFolderType,
} from "../../../common/types/ImportSchemaTypes";
import { YupTestReturnType } from "../../../common/types/validationSchemaTypes";
import { yupCreateError } from "../../utils/formFunctions";
import { uniq as lodashUniq } from "lodash";

const { api } = window;

export const ImportModule__SourcedataStructureTest = async (
	folderStruct: SourcedataFolderType[],
	helpers: Yup.TestContext<ImportSchemaType>
): Promise<YupTestReturnType> => {
	console.log("ImportSchema --- SourcedataStructure validation triggered: ", folderStruct);
	if (!folderStruct) return false;

	// Blank fields are not allowed
	if (folderStruct.some((folder) => folder === ""))
		return helpers.createError({
			path: helpers.path,
			message: "Blank fields are not allowed",
		});

	// Must contain "Subject" and "Scan" at minimum
	if (!folderStruct.includes("Subject") || !folderStruct.includes("Scan"))
		return helpers.createError({
			path: helpers.path,
			message: "At minimum Subject and Scan must be filled in",
		});

	// Depends on the validity of the study root path
	const studyRootPath: string = helpers.parent.StudyRootPath;
	const isValid = await IsValidStudyRoot(studyRootPath, helpers, ["sourcedata"]);
	if (!isValid || isValid instanceof Yup.ValidationError)
		return helpers.createError({
			path: helpers.path,
			message: "Cannot determine the validity of the folder structure when the Study Root Path is invalid",
		});

	// Assuming a valid root path, check for existence of filepaths at the given depth
	const globPattern = folderStruct.map(() => "*").join("/") + "/*"; // Extra * to match all files in the final folder level
	const fp = studyRootPath + "/sourcedata";

	console.log(
		`ImportSchema -- SourcedataStructure is validating the following:`,
		JSON.stringify({ folderStruct, globPattern, fp }, null, 2)
	);

	const dicomFiles = await api.path.glob(fp, globPattern, {
		onlyDirectories: false,
		onlyFiles: true,
	});

	if (dicomFiles.length === 0)
		return helpers.createError({
			path: helpers.path,
			message: "No DICOM files found under the indicated folder structure",
		});

	return true;
};

export const ImportModule__MappingScanAliasesTest = (
	mapping: ImportSchemaType["MappingScanAliases"],
	helpers: Yup.TestContext<ImportSchemaType>
): YupTestReturnType => {
	// At least one scan alias must be defined
	const scansNotIgnored = Object.values(mapping).filter((scan) => scan !== "Ignore");
	if (scansNotIgnored.length === 0)
		return helpers.createError({ path: helpers.path, message: "At least one scan alias must be defined" });
	return true;
};

export const ImportModule__MappingVisitAliasesTest = (
	mapping: ImportSchemaType["MappingVisitAliases"],
	helpers: Yup.TestContext<ImportSchemaType>
) => {
	const visitAliases = Object.values(mapping);
	const isAllNotBlank = visitAliases.every((alias) => alias !== "");
	return isAllNotBlank;
};

export const MappingSessionAliasesTest = (
	mapping: ImportSchemaType["MappingSessionAliases"],
	helpers: Yup.TestContext<ImportSchemaType>
) => {
	const sessionAliases = Object.values(mapping);
	const isAllUnique = lodashUniq(sessionAliases).length === sessionAliases.length;
	const isAllNotBlank = sessionAliases.every((alias) => alias !== "");
	return isAllUnique && isAllNotBlank;
};

export const ImportModule__M0PositionInASLTest = (
	m0Pos: number[],
	helpers: Yup.TestContext<ImportSchemaType>
): YupTestReturnType => {
	// There can't be M0 positions within the ASL series if the M0 was acquired separately
	const M0IsSeparate: boolean = helpers.parent.M0IsSeparate;
	if (m0Pos.length > 0 && M0IsSeparate)
		return helpers.createError({
			path: helpers.path,
			message: "M0 Position cannot be defined when M0 is separate",
		});

	// Short circuit if there are no M0 positions
	if (m0Pos.length === 0 && !M0IsSeparate) return true;

	// No M0 position is allowed to exceed the number of volumes
	const nVolumes: number = helpers.parent.NVolumes;
	if (m0Pos.some((pos) => pos > nVolumes))
		return helpers.createError({
			path: helpers.path,
			message: "At least one specified M0 position is greater than the number of volumes",
		});
	return true;
};

export const ImportModule__DummyPositionInASLTest = (
	dummyPositions: number[],
	helpers: Yup.TestContext<ImportSchemaType>
) => {
	if (dummyPositions.length === 0) return true;
	const nVolumes: number = helpers.parent.NVolumes;
	// No dummy position is allowed to exceed the number of volumes
	if (dummyPositions.some((pos) => pos > nVolumes))
		return helpers.createError({
			path: helpers.path,
			message: "At least one specified dummy position is greater than the number of volumes",
		});
	return true;
};

export const ImportModule__SingleContextPathsTest = async (
	paths: string[],
	helpers: Yup.TestContext<ImportSchemaType>
): Promise<YupTestReturnType> => {
	// For the global context, there should be no paths
	const isGlobal: boolean = helpers.parent.IsGlobal ?? true;

	console.log("SchemaImportDefineContext -- Subjects -- isGlobal: ", {
		isGlobal,
		paths,
	});

	if (isGlobal && paths.length === 0) return true;

	// Paths cannot be blank for the non-global context
	if (paths.length === 0)
		return helpers.createError({
			path: helpers.path,
			message: "At least one path is required when specifying an additional context",
		});

	// For any additional context, we should verify that the paths exist within the indicated level
	const studyRootPath: string = helpers.options.context.StudyRootPath;
	const SourcedataStructure: SourcedataFolderType[] = helpers.options.context.SourcedataStructure;
	console.log("SchemaImportDefineContext -- Subjects -- StudyRootPath: ", studyRootPath);

	// If the study root path is invalid, we cannot validate the paths
	if (!studyRootPath || !((await api.path.getFilepathType(`${studyRootPath}/sourcedata`)) === "dir"))
		return helpers.createError({
			path: helpers.path,
			message: "Cannot determine the validity of the folder structure when the Study Root Path is invalid",
		});

	// Each path must be validated: must exist and the level beyond "sourcedata" that its basename
	// occurs at must match the SourcedataStructure; forward slashe conversions required
	const sourcedataPathForwardSlash = `${studyRootPath.replace(/\\/gm, "/")}/sourcedata/`;
	for (const path of paths) {
		if (!(await api.path.filepathExists(path))) return false;

		const pathParts = path.replace(/\\/gm, "/").replace(sourcedataPathForwardSlash, "").split("/");
		const pathDepth = pathParts.length;
		const folderType = SourcedataStructure[pathDepth - 1];

		console.log("SchemaImportDefineContext -- Subjects -- pathParts: ", {
			path,
			sourcedataPathForwardSlash,
			pathParts,
			pathDepth,
			folderType,
		});

		if (!["Subject", "Visit", "Session"].includes(folderType))
			return helpers.createError({
				path: helpers.path,
				message: `Path ${path} was not found to be a Subject, Visit, or Session`,
			});
	}
	return true;
};

export const ImportModule__BolusCutOffDelayTimeTest = (
	value: unknown,
	helpers: Yup.TestContext<ImportSchemaType>
): YupTestReturnType => {
	const cutOffTechnique: BolusCutOffTechniqueType = helpers.parent.BolusCutOffTechnique;
	if (cutOffTechnique === "Q2TIPS") {
		if (!Array.isArray(value) || value.length !== 2) return yupCreateError(helpers, "Q2TIPS requires 2 values");
	} else {
		if (Array.isArray(value)) return yupCreateError(helpers, "Non-Q2TIPS requires a single value");
	}
	return true;
};

export const ImportModule__BackgroundSuppressionPulseTimeTest = (
	pulseTimes: number[],
	helpers: Yup.TestContext<ImportSchemaType>
): YupTestReturnType => {
	if (pulseTimes.length === 0) return true;
	return pulseTimes.length === helpers.parent.BackgroundSuppressionNumberPulses;
};
