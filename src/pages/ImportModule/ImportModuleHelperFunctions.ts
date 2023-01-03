import { isUndefined as lodashIsUndefined, pickBy as lodashPickBy, uniq as lodashUniq } from "lodash";
import { SchemaImportPar } from "../../common/schemas/ImportSchemas/ImportSchema";
import { YupValidate } from "../../common/utils/formFunctions";
import { GUIIMPORTFILE_BASENAME } from "../../common/GLOBALS";
import {
	ImportContextSchemaType,
	ImportSchemaType,
	SingleStudyParJSONOutputSchemaType,
	SourcedataFolderType,
	SourceStuctureJSONOutputSchemaType,
	StudyParJSONOutputSchemaType,
} from "../../common/types/ImportSchemaTypes";
import { ObjectEntries } from "../../common/utils/objectFunctions";
import { escapeRegExp, makeForwardSlashes, stringArrToRegex } from "../../common/utils/stringFunctions";
const { api } = window;

/**
 * Gets a number array representing the MATLAB index positions of Subject, Visit, Session, and Scan directories.
 * @param folderStructure The array of folder types detailing the structure of the study from sourcedata.
 * @returns The length-4 tuple of numbers representing the capture group indices of the folder structure.
 */
function getTokenOrdering(folderStructure: SourcedataFolderType[]): [number, number, number, number] {
	const filteredStructure = folderStructure.filter((folder) => folder !== "Ignore");
	const tokenOrdering = (["Subject", "Visit", "Session", "Scan"] as Exclude<SourcedataFolderType, "Ignore">[]).map(
		(v) => filteredStructure.indexOf(v) + 1 // +1 to account for MATLAB indexing
	);
	return tokenOrdering as [number, number, number, number];
}

/**
 * Gets the basenames for the scan, visit, and session levels of a study
 * @param datasetRootDir The root directory of the study. This is the folder that contains the "sourcedata" subfolder.
 * @param folderStructure The array of folder types detailing the structure of the study from sourcedata.
 * @returns Either false if something went wrong or an object of the requested basenames for each.
 */
export async function getAliasBasenames(datasetRootDir: string, folderStructure: string[]) {
	try {
		const globOptions = {
			onlyDirectories: true,
			onlyFiles: false,
		};
		// Get the depths first
		const scanDepth = folderStructure.indexOf("Scan") + 1;
		const visitDepth = folderStructure.indexOf("Visit") + 1;
		const sessionDepth = folderStructure.indexOf("Session") + 1;

		if (scanDepth === -1) return false; // Scans must be present; something went wrong otherwise.

		// Next get the paths concurrently
		const [scanPaths, visitPaths, sessionPaths] = await Promise.all(
			[scanDepth, visitDepth, sessionDepth].map((depth) => {
				return api.path.getPathsAtNthLevel(datasetRootDir + "/sourcedata", depth, globOptions);
			})
		);
		if (scanPaths.length === 0) return false;

		// We only care about the basenames
		const scanBasenames = lodashUniq(scanPaths.map((p) => p.basename));
		const visitBasenames = visitDepth > 0 ? lodashUniq(visitPaths.map((p) => p.basename)) : [];
		const sessionBasenames = sessionDepth > 0 ? lodashUniq(sessionPaths.map((p) => p.basename)) : [];

		// Sort in-place
		scanBasenames.sort();
		visitBasenames.sort();
		sessionBasenames.sort();

		return { scanBasenames, visitBasenames, sessionBasenames };
	} catch (error) {
		console.warn("Something went wrong in getAliasBasenames", error);
		return false;
	}
}

/**
 * Ascertains the ASLContext field based on the general pattern, number of volumes, and the M0 positions.
 * @returns The ASLContext field as a comma-delimited pattern.
 */
async function getASLContext({
	ASLSeriesPattern,
	NVolumes,
	M0PositionInASL,
	DummyPositionInASL,
}: Pick<ImportContextSchemaType, "ASLSeriesPattern" | "NVolumes" | "M0PositionInASL" | "DummyPositionInASL">) {
	console.log("getASLContext called with the following", {
		ASLSeriesPattern,
		NVolumes,
		M0PositionInASL,
		DummyPositionInASL,
	});

	// Short-circuit if there are no m0 nor dummies in the ASL series; ExploreASL will auto-expand when it detects
	// the number of volumes present
	if (M0PositionInASL.length === 0 && DummyPositionInASL.length === 0) {
		if (ASLSeriesPattern === "control-label") {
			return "control, label";
		} else if (ASLSeriesPattern === "label-control") {
			return "label, control";
		}
	}

	let currentVolumeType: "m0scan" | "cbf" | "control" | "label" | "deltam";
	const AdjustedM0Positions = M0PositionInASL.map((pos) => pos - 1); // Temporary adjustment to 0-based indexing
	const ASLContextArr: string[] = [];

	if (ASLSeriesPattern === "control-label") {
		currentVolumeType = "control";
		for (const index of [...Array(NVolumes).keys()]) {
			if (AdjustedM0Positions.includes(index)) {
				ASLContextArr.push("m0scan");
				continue;
			}
			ASLContextArr.push(currentVolumeType);
			currentVolumeType = currentVolumeType === "control" ? "label" : "control";
		}
	} else if (ASLSeriesPattern === "label-control") {
		currentVolumeType = "label";
		for (const index of [...Array(NVolumes).keys()]) {
			if (AdjustedM0Positions.includes(index)) {
				ASLContextArr.push("m0scan");
				continue;
			}
			ASLContextArr.push(currentVolumeType);
			currentVolumeType = currentVolumeType === "label" ? "control" : "label";
		}
	} else {
		currentVolumeType = ASLSeriesPattern;
		for (const index of [...Array(NVolumes).keys()]) {
			const scanType = AdjustedM0Positions.includes(index) ? "m0scan" : currentVolumeType;
			ASLContextArr.push(scanType);
		}
	}
	return ASLContextArr.join(", ");
}

export async function buildSourceStructureJSON(
	importSchema: ImportSchemaType
): Promise<SourceStuctureJSONOutputSchemaType | false> {
	console.log(`⚙️ buildSourceStructureJSON called with importSchema:`, importSchema);

	try {
		// Save to more wieldy named variables
		const pathSourcedata = api.path.asPath(importSchema.StudyRootPath, "sourcedata");
		const pathSourcedataForwardSlash = makeForwardSlashes(pathSourcedata.path) + "/";
		const folderStructure = importSchema.SourcedataStructure;

		// Get the filepaths for each subject from the importContexts rather than globbing anew!
		const subjectDepth = folderStructure.indexOf("Subject");
		const subjectNames = importSchema.ImportContexts.flatMap((context) =>
			context.Paths.map((path) => {
				const pathParts = makeForwardSlashes(path).replace(pathSourcedataForwardSlash, "").split("/");
				return pathParts[subjectDepth];
			})
		);
		// Clean up mappings for Scan, Visit, and Session
		const filteredScanMapping = lodashPickBy(
			importSchema.MappingScanAliases,
			(alias) => alias && !["Ignore", ""].includes(alias)
		);
		const filteredVisitMapping = lodashPickBy(importSchema.MappingVisitAliases, (alias) => alias && alias !== "");
		const filteredSessionMapping = lodashPickBy(importSchema.MappingSessionAliases, (alias) => alias && alias !== "");

		// Get the folderHierarchy
		const folderHierarchy = folderStructure.map((folderType) => {
			switch (folderType) {
				case "Subject":
					return stringArrToRegex(subjectNames);
				case "Visit":
					return stringArrToRegex(Object.keys(filteredVisitMapping));
				case "Session":
					return stringArrToRegex(Object.keys(filteredSessionMapping));
				case "Scan":
					return stringArrToRegex(Object.keys(filteredScanMapping));
				default:
					return ".*";
			}
		});

		const sourceStructureJSON = {
			bMatchDirectories: true,
			folderHierarchy,
			// Example [ 1 0 2 3],
			tokenOrdering: getTokenOrdering(folderStructure),

			// Example ["morning", "morning", "afternoon", "afternoon"]
			tokenVisitAliases: Object.entries(filteredVisitMapping).flatMap(([folderName, alias]) => [
				`${escapeRegExp(folderName)}`, // For whatever reason, ^$ are not allowed by ExploreASL in this field
				alias,
			]),

			// Example ["^1$", "ASL_1", "^2$", "ASL_2"],
			tokenSessionAliases: Object.entries(filteredSessionMapping).flatMap(([folderName, alias]) => [
				`^${escapeRegExp(folderName)}$`,
				alias,
			]),

			// Example [ "^PSEUDO_10_min$", "ASL4D", "^M0$", "M0", "^T1-weighted$", "T1"],
			tokenScanAliases: Object.entries(filteredScanMapping).flatMap(([folderName, scanAlias]) => [
				`^${escapeRegExp(folderName)}$`,
				scanAlias,
			]),
		};

		return sourceStructureJSON;
	} catch (error) {
		console.warn("Something went wrong in buildSourceStructureJSON", error);
		return false;
	}
}

export async function buildStudyParJSON(
	importSchema: ImportSchemaType
): Promise<StudyParJSONOutputSchemaType | SingleStudyParJSONOutputSchemaType | false> {
	console.log("⚙️ buildStudyParJSON called with importSchema:", importSchema);

	try {
		const result = [];

		for (const context of importSchema.ImportContexts) {
			const {
				ASLSeriesPattern,
				NVolumes,
				M0PositionInASL,
				SubjectRegExp,
				VisitRegExp,
				SessionRegExp,
				DummyPositionInASL,
			} = context;
			const ASLContext = await getASLContext({ ASLSeriesPattern, NVolumes, M0PositionInASL, DummyPositionInASL });

			// Construct the studyPar JSON output for a given context
			const temp: SingleStudyParJSONOutputSchemaType = {
				SubjectRegExp: SubjectRegExp !== "" ? SubjectRegExp : undefined,
				VisitRegExp: VisitRegExp !== "" ? VisitRegExp : undefined,
				SessionRegExp: SessionRegExp !== "" ? SessionRegExp : undefined,
				ASLContext,

				// M0 Info
				M0Type: context.M0Type,
				M0: context.M0Type === "Included" || context.M0Type === "Separate",
				M0Estimate: context.M0Type === "Estimate" ? context.M0Estimate : undefined,

				// MRI Info
				Manufacturer: context.Manufacturer,
				PulseSequenceType: context.PulseSequenceType,
				MRAcquisitionType: context.PulseSequenceType === "2D_EPI" ? "2D" : "3D",
				MagneticFieldStrength: context.MagneticFieldStrength,

				// ASL Info
				ArterialSpinLabelingType:
					context.ArterialSpinLabelingType === "CASL" ? "PCASL" : context.ArterialSpinLabelingType,
				PostLabelingDelay: context.PostLabelingDelay,

				// 2D Acquisition Info
				SliceReadoutTime: context.PulseSequenceType === "2D_EPI" ? context.SliceReadoutTime : undefined,

				// PCASL/CASL Specific Info
				LabelingDuration: context.LabelingDuration,

				// PASL Specific Info
				BolusCutOffFlag: context.BolusCutOffFlag,
				BolusCutOffTechnique: context.BolusCutOffTechnique !== "" ? context.BolusCutOffTechnique : undefined,
				BolusCutOffDelayTime: context.BolusCutOffDelayTime,

				// Background Suppression Info
				BackgroundSuppression: context.BackgroundSuppressionNumberPulses > 0 ? true : false,
				BackgroundSuppressionNumberPulses: context.BackgroundSuppressionNumberPulses,
				BackgroundSuppressionPulseTime: context.BackgroundSuppressionPulseTime,
			};

			// Cleanup undefined or incompatible fields based on BIDS
			lodashIsUndefined(temp.SubjectRegExp) && delete temp.SubjectRegExp;
			lodashIsUndefined(temp.VisitRegExp) && delete temp.VisitRegExp;
			lodashIsUndefined(temp.SessionRegExp) && delete temp.SessionRegExp;
			lodashIsUndefined(temp.Manufacturer) && delete temp.Manufacturer;
			lodashIsUndefined(temp.BackgroundSuppression) && delete temp.BackgroundSuppression;
			temp.PostLabelingDelay === 0 && delete temp.PostLabelingDelay;
			temp.M0Type !== "Estimate" && delete temp.M0Estimate;

			if (temp.ArterialSpinLabelingType === "PCASL") {
				delete temp.BolusCutOffFlag;
				delete temp.BolusCutOffTechnique;
				delete temp.BolusCutOffDelayTime;
			} else {
				// For PASL, LabelingDuration must be omitted
				delete temp.LabelingDuration;
				// And if BolusCutOffFlag is false, the other two fields must be omitted
				if (!temp.BolusCutOffFlag) {
					delete temp.BolusCutOffTechnique;
					delete temp.BolusCutOffDelayTime;
				}
			}

			// Save to result
			result.push(temp);
		}

		// Determine output type
		// If there are no contexts, return false, as an error occurred
		if (result.length === 0) {
			return false;
		}
		// If there is only one context, return a single object
		if (result.length === 1) {
			return result[0];
		}
		// If there are multiple contexts, return an array
		if (result.length > 1) {
			return { StudyPars: result } as StudyParJSONOutputSchemaType;
		}
	} catch (error) {
		console.warn("Something went wrong in buildStudyParJSON", error);
		return false;
	}
}

/**
 * Gets the Regex for each additional context.
 * @param importSchema The import schema at the end of `Define Contexts` step.
 * @returns A modified importSchema values with the SubjectRegexp, VisitRegexp, and SessionRegexp fields filled in per
 * context.
 */
export async function updateContextSpecificRegexps(importSchema: ImportSchemaType) {
	try {
		const pathSourcedata = `${makeForwardSlashes(importSchema.StudyRootPath)}/sourcedata/`;
		const newContexts = importSchema.ImportContexts.flatMap((context) =>
			expandImportContext(
				context,
				pathSourcedata, // We need to pass the path to the sourcedata folder to the function as a forward slash!
				importSchema.SourcedataStructure,
				importSchema.MappingVisitAliases,
				importSchema.MappingSessionAliases
			)
		);
		importSchema.ImportContexts = newContexts;
		return importSchema;
	} catch (error) {
		console.warn("Something went wrong in updateContextSpecificRegexps:", error);
		return false;
	}
}

interface InfoContainer {
	paths: string[];
	subjectRegExpList: string[];
	visitRegExpList: string[];
	sessionRegExpList: string[];
}

/**
 * Semi-clones & expands a single {@link ImportContextSchemaType} into multiple contexts that are more specific in terms
 * of the paths and regexps.
 *
 * @param singleContext The {@link ImportContextSchemaType} to expand into multiple contexts.
 * @param pathSourcedata A forward-slash path to the sourcedata folder.
 * @param folderStructure The current folder structure after the sourcedata folder.
 * @param MappingVisitAliases The mapping of visit folder names to their visit aliases.
 * @param MappingSessionAliases The mapping of session folder names to their session aliases.
 * @returns An array of semi-cloned {@link ImportContextSchemaType} objects, but the paths and regexps are allocated
 * to each more-specific context.
 */
export function expandImportContext(
	singleContext: ImportContextSchemaType,
	pathSourcedata: string,
	folderStructure: SourcedataFolderType[],
	MappingVisitAliases: Record<string, string>,
	MappingSessionAliases: Record<string, string>
) {
	//? An "infoType" being a concatentation of the types of info in a path, e.g. "SubjectVisitSession"
	const infoTypeToPathsMapping: Record<string, InfoContainer> = {};
	const subjectIndex = folderStructure.indexOf("Subject");
	const visitIndex = folderStructure.indexOf("Visit");
	const sessionIndex = folderStructure.indexOf("Session");

	// First for loop updates the infoTypeToPathsMapping object
	for (const path of singleContext.Paths) {
		const pathParts = makeForwardSlashes(path).replace(pathSourcedata, "").split("/");
		const pathInfo = new Set(
			pathParts
				.map((_, index) => {
					if (index === subjectIndex) return "Subject";
					if (index === visitIndex) return "Visit";
					if (index === sessionIndex) return "Session";
					return "";
				})
				.filter((part) => part !== "")
		);

		// Start by making a possibly-temporary container for the info types
		const infoTypeContainer: InfoContainer = {
			paths: [path],
			subjectRegExpList: [],
			visitRegExpList: [],
			sessionRegExpList: [],
		};

		if (pathInfo.has("Subject")) {
			infoTypeContainer.subjectRegExpList.push(pathParts[subjectIndex]);
		}

		if (pathInfo.has("Visit")) {
			const visit = pathParts[visitIndex];
			const visitAlias = MappingVisitAliases[visit];
			visitAlias && infoTypeContainer.visitRegExpList.push(visitAlias);
		}

		if (pathInfo.has("Session")) {
			const session = pathParts[sessionIndex];
			const sessionAlias = MappingSessionAliases[session];
			sessionAlias && infoTypeContainer.sessionRegExpList.push(sessionAlias);
		}

		const infoTypeString = [...pathInfo].sort().join("");

		// If the infoTypeString is already in the mapping, add the path to the existing container
		if (infoTypeString in infoTypeToPathsMapping) {
			infoTypeToPathsMapping[infoTypeString].paths.push(path);
			infoTypeToPathsMapping[infoTypeString].subjectRegExpList.push(...infoTypeContainer.subjectRegExpList);
			infoTypeToPathsMapping[infoTypeString].visitRegExpList.push(...infoTypeContainer.visitRegExpList);
			infoTypeToPathsMapping[infoTypeString].sessionRegExpList.push(...infoTypeContainer.sessionRegExpList);
		}
		// Otherwise, add the infoTypeString to the mapping
		else {
			infoTypeToPathsMapping[infoTypeString] = infoTypeContainer;
		}
	}

	console.log("🚀 ~ file: ImportModuleHelperFunctions.ts:395 ~ infoTypeToPathsMapping", infoTypeToPathsMapping);

	// Second for loop uses the infoTypeToPathsMapping object to create the new contexts
	const newContexts = ObjectEntries(infoTypeToPathsMapping).flatMap(([_, infoContainer]) => {
		const { Paths, SubjectRegExp, VisitRegExp, SessionRegExp, ...restOfContext } = singleContext;

		// Regexps need to be converted to strings
		const newSubjectRegExp =
			infoContainer.subjectRegExpList.length > 0
				? stringArrToRegex(lodashUniq(infoContainer.subjectRegExpList), {
						isCaptureGroup: false,
						isStartEndBound: false,
				  })
				: "";
		const newVisitRegExp =
			infoContainer.visitRegExpList.length > 0
				? stringArrToRegex(lodashUniq(infoContainer.visitRegExpList), { isCaptureGroup: false, isStartEndBound: false })
				: "";
		const newSessionRegExp =
			infoContainer.sessionRegExpList.length > 0
				? stringArrToRegex(lodashUniq(infoContainer.sessionRegExpList), {
						isCaptureGroup: false,
						isStartEndBound: false,
				  })
				: "";

		const newContext: ImportContextSchemaType = {
			Paths: infoContainer.paths,
			SubjectRegExp: newSubjectRegExp,
			VisitRegExp: newVisitRegExp,
			SessionRegExp: newSessionRegExp,
			...restOfContext,
		};

		return newContext;
	});

	return newContexts;
}

/**
 * Fetches & validates a JSON Object from the "EASLGUI_ImportPar.json" file in the study root
 * @param studyRootPath Absolute path to the study root
 * @returns Either false or the JSON object from the "EASLGUI_ImportPar.json" file
 */
export async function fetchGUIImportPar(studyRootPath: string) {
	try {
		const importParPath = api.path.asPath(studyRootPath, GUIIMPORTFILE_BASENAME);

		// If the file doesn't exist, return false
		if (!(await api.path.filepathExists(importParPath.path))) return false;

		// If the file exists, try to read it
		const { payload, error } = await api.path.readJSONSafe(importParPath.path);
		if (error) return false;

		// Validate the data
		const { errors, values } = await YupValidate(SchemaImportPar, payload as ImportSchemaType);
		if (Object.keys(errors).length > 0) {
			return false;
		}

		return values;
	} catch (error) {
		console.warn(`Error encountered in fetchGUIImportPar:`, error);
		return false;
	}
}
