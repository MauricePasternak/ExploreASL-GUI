import { uniq as lodashUniq } from "lodash";
import * as Yup from "yup";
import { BolusCutOffTechniqueType, ImportSchemaType, SourcedataFolderType } from "../../types/ImportSchemaTypes";
import { YupTestReturnType } from "../../types/validationSchemaTypes";
import { IsValidStudyRoot } from "../../utils/EASLFunctions";
import { yupCreateError } from "../../utils/formFunctions";
import { makeForwardSlashes } from "../../utils/stringFunctions";

const { api } = window;

export const ImportModule__SourcedataStructureTest = async (
	folderStruct: SourcedataFolderType[],
	helpers: Yup.TestContext<ImportSchemaType>
): Promise<YupTestReturnType> => {
	if (!folderStruct) return false;

	// Blank fields are not allowed
	if (folderStruct.some((folder) => folder === "")) return yupCreateError(helpers, "Blank fields are not allowed");

	// Must contain "Subject" and "Scan" at minimum
	if (!folderStruct.includes("Subject") || !folderStruct.includes("Scan"))
		return yupCreateError(helpers, "Must contain 'Subject' and 'Scan' at minimum");

	// Depends on the validity of the study root path
	const studyRootPath: string = helpers.parent.StudyRootPath;
	const isValid = await IsValidStudyRoot(studyRootPath, helpers, ["sourcedata"]);
	if (!isValid || isValid instanceof Yup.ValidationError)
		return yupCreateError(
			helpers,
			"Cannot determine the validity of the folder structure when the Study Root Path is invalid"
		);

	// Assuming a valid root path, check for existence of filepaths at the given depth
	const globPattern = folderStruct.map(() => "*").join("/") + "/*"; // Extra * to match all files in the final folder level
	const fp = studyRootPath + "/sourcedata";

	console.log(`🔎 Validating Import Module -- FolderStruct:`, { folderStruct, globPattern, fp });

	const dicomFiles = await api.path.glob(fp, globPattern, {
		onlyDirectories: false,
		onlyFiles: true,
	});

	if (dicomFiles.length === 0)
		return yupCreateError(helpers, "No DICOM files found under the indicated folder structure");

	return true;
};

export const ImportModule__MappingScanAliasesTest = (
	mapping: ImportSchemaType["MappingScanAliases"],
	helpers: Yup.TestContext<ImportSchemaType>
): YupTestReturnType => {
	// At least one scan alias must be defined
	const scansNotIgnored = Object.values(mapping).filter((scan) => scan !== "Ignore");
	if (scansNotIgnored.length === 0) return yupCreateError(helpers, "At least one scan alias must be defined");
	return true;
};

export const ImportModule__MappingVisitAliasesTest = (
	mapping: ImportSchemaType["MappingVisitAliases"],
	helpers: Yup.TestContext<ImportSchemaType>
) => {
	return Object.values(mapping).every((alias) => alias !== "");
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
	// No M0 position is allowed to exceed the number of volumes
	const nVolumes: number = helpers.parent.NVolumes;
	if (m0Pos.some((pos) => pos > nVolumes))
		return yupCreateError(helpers, "At least one specified M0 position is greater than the number of volumes");
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
		return yupCreateError(helpers, "At least one specified dummy position is greater than the number of volumes");
	return true;
};

export const ImportModule__SingleContextPathsTest = async (
	paths: string[],
	helpers: Yup.TestContext<ImportSchemaType>
): Promise<YupTestReturnType> => {
	console.log(`🔎 Validating Import Module -- Context.Paths:`, paths);
	// At least one path is required
	if (paths.length === 0)
		return yupCreateError(helpers, "At least one path is required when specifying an additional context");

	// Further validation depends on the validity of the study root path
	const studyRootPath = helpers.options.context.StudyRootPath;
	// If the study root path is invalid, we cannot validate the paths
	if (!studyRootPath || !((await api.path.getFilepathType(`${studyRootPath}/sourcedata`)) === "dir"))
		return yupCreateError(
			helpers,
			"Cannot determine the validity of the folder structure when the Study Root Path is invalid"
		);

	// Each path must be validated: must exist and the level beyond "sourcedata" that its basename
	// occurs at must match be a Subject, Visit, or Session; forward slashe conversions required
	const permissibleBasenameTypes = new Set<SourcedataFolderType>(["Subject", "Visit", "Session"]);
	const SourcedataStructure = helpers.options.context.SourcedataStructure;
	const sourcedataPathForwardSlash = `${makeForwardSlashes(studyRootPath)}/sourcedata/`;
	for (const path of paths) {
		if (!(await api.path.filepathExists(path))) return false;

		const pathParts = makeForwardSlashes(path).replace(sourcedataPathForwardSlash, "").split("/");
		const pathDepth = pathParts.length;
		const folderType = SourcedataStructure[pathDepth - 1];
		if (!permissibleBasenameTypes.has(folderType))
			return yupCreateError(helpers, `Path ${path} was not found to be a Subject, Visit, or Session`);
	}

	// Finally, we should verify that there are no duplicate paths
	const allPaths = helpers.options.context.ImportContexts.flatMap((context) => context.Paths);
	if (lodashUniq(allPaths).length !== allPaths.length)
		return yupCreateError(helpers, "At least one duplicate path was found among all contexts. Paths must be unique.");

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
