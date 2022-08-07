import Path from "pathlib-js";
import { ImportContextSchemaType, ImportSchemaType, SourcedataFolderType } from "../common/types/ImportSchemaTypes";
import { pickBy as lodashPickBy, uniq as lodashUniq, range as lodashRange } from "lodash";
import { escapeRegExp, stringArrToRegex } from "../common/utilityFunctions/stringFunctions";

/**
 * Gets a number array representing the MATLAB index positions of Subject, Visit, Session, and Scan directories.
 * @param folderStructure The array of folder types detailing the structure of the study from sourcedata.
 * @returns The length-4 tuple of numbers representing the capture group indices of the folder structure.
 */
function getTokenOrdering(folderStructure: SourcedataFolderType[]): [number, number, number, number] {
  const filteredStructure = folderStructure.filter(folder => folder !== "Ignore");
  const tokenOrdering = (["Subject", "Visit", "Session", "Scan"] as Exclude<SourcedataFolderType, "Ignore">[]).map(
    v => filteredStructure.indexOf(v) + 1 // +1 to account for MATLAB indexing
  );
  return tokenOrdering as [number, number, number, number];
}

/**
 * Retrieves the regexes corresponding to each level of an indicated folder Structure.
 * @param rootFolder The directory from which globbing at the Nth level away will take place.
 * @param folderStructure An array of strings signifying what is present at a particular directory.
 * Example ["Subject", "Scan", "Ignore"]
 * @param validVisitFolders An array of strings of basenames to keep w.r.t all basenames found at the level of "Visit".
 * Example ["morning", "afternoon", "evening"]
 * @param validSessionFolders An array of strings of basenames to keep w.r.t all basenames found at the level of "Session".
 * Example ["ASL_1", "ASL_2", "ASL_3"]
 * @param validScanFolders An array of strings of basenames to keep w.r.t all basenames found at the level of "Scan".
 * Example ["ASL", "T1-weighted", "LowFLAIR"]
 * @param whichContext A number indicating
 * @returns An array of strings, each of which is a regex corresponding to a level indicated in the folderStructure argument.
 * Example ["^(sub001|sub002)$", "^(ASL|T1-weighted|LowFLAIR)$", ".*"]
 */
async function getFolderHierarchy(
  rootFolder: string,
  folderStructure: SourcedataFolderType[],
  validVisitFolders: string[],
  validSessionFolders: string[],
  validScanFolders: string[],
  importContext: ImportContextSchemaType
) {
  const setVisitFolders = new Set(validVisitFolders);
  const setSessionFolders = new Set(validSessionFolders);
  const setScanFolders = new Set(validScanFolders);

  const globOptions = {
    onlyDirectories: true,
    onlyFiles: false,
  };
  const folderHierarchyArray = [];
  for (let index = 0; index < folderStructure.length; index++) {
    const level = folderStructure[index];

    // Push universal regex for Ignore levels
    if (level === "Ignore") {
      folderHierarchyArray.push(".*");
      continue;
    }

    // Get non-global contexts & the Subject level, we just use the subject filepaths
    if (level === "Subject" && !importContext.IsGlobal) {
      const basenames = importContext.Subjects.map(p => new Path(p).basename);
      const regexSubjects = stringArrToRegex(basenames);
      folderHierarchyArray.push(regexSubjects);
      continue;
    }

    // Get paths for the indicated levels
    const globStar = lodashRange(index + 1)
      .map(() => "*")
      .join("/");
    console.log(`globStar for level ${level}: ${globStar}`);
    const paths = await new Path(rootFolder, "sourcedata").glob(globStar, globOptions);
    const basenames = lodashUniq(paths.map(p => p.basename));
    console.log(`Basenames for level: ${level}`, basenames);

    // Convert the valid foldernames to a single regex string like ^(sub001|sub002|sub003)$
    // and add it to the folderHierarchy array
    if (level === "Subject") {
      const regexSubjects = stringArrToRegex(basenames);
      folderHierarchyArray.push(regexSubjects);
      continue;
    } else if (level === "Visit") {
      const regexVisits = stringArrToRegex(basenames.filter(b => setVisitFolders.has(b)));
      folderHierarchyArray.push(regexVisits);
    } else if (level === "Session") {
      const regexSessions = stringArrToRegex(basenames.filter(b => setSessionFolders.has(b)));
      folderHierarchyArray.push(regexSessions);
    } else if (level === "Scan") {
      const regexScans = stringArrToRegex(basenames.filter(b => setScanFolders.has(b)));

      folderHierarchyArray.push(regexScans);
    } else {
      throw new Error(
        "Impossible value contained within the provided folder structure. A level must be one of Subject, Visit, Session, Scan, or Ignore."
      );
    }
  }
  return folderHierarchyArray;
}

/**
 * Parses the form values into a format appropriate for conversion to sourceStructure.json
 * @param formValues Form values coming after defining all necessary aliases, folderPaths, etc.
 * @returns The JSON structure necessary to write a sourceStructure.json file.
 */
export async function buildSourceStructureJSON(formValues: ImportSchemaType, whichContext: number) {
  try {
    // First filter the Objects to remove folders associated with unneeded aliases
    const filteredScanMapping = lodashPickBy(
      formValues.MappingScanAliases,
      alias => alias && !["Ignore", ""].includes(alias)
    );
    const filteredVisitMapping = lodashPickBy(formValues.MappingVisitAliases, alias => alias && alias !== "");
    const filteredSessionMapping = lodashPickBy(formValues.MappingSessionAliases, alias => alias && alias !== "");

    // console.log("filteredScanMapping", filteredScanMapping);

    const sourceStructureJSON = {
      bMatchDirectories: true,
      folderHierarchy: await getFolderHierarchy(
        formValues.StudyRootPath, // rootFolder
        formValues.SourcedataStructure, // folderStructure
        Object.keys(filteredVisitMapping), // validVisitFolders
        Object.keys(filteredSessionMapping), // validSessionFolders
        Object.keys(filteredScanMapping), // validScanFolders
        formValues.ImportContexts[whichContext]
      ),

      // Example [ 1 0 2 3],
      tokenOrdering: getTokenOrdering(formValues.SourcedataStructure),

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
    // console.log("sourceStructureJSON", sourceStructureJSON);
    return sourceStructureJSON;
  } catch (error) {
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
}: Pick<ImportContextSchemaType, "ASLSeriesPattern" | "NVolumes" | "M0PositionInASL">) {
  let currentVolumeType: "m0scan" | "cbf" | "control" | "label" | "deltam";
  const AdjustedM0Positions = M0PositionInASL.map(pos => pos - 1); // Temporary adjustment to 0-based indexing
  const ASLContextArr: string[] = [];
  if (ASLSeriesPattern === "") throw new Error("ASLSeriesPattern is empty");

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

/**
 * Creates the JSON object to be written to studyPar.json
 */
export async function buildStudyParJSON(formValues: ImportSchemaType, whichContext: number) {
  try {
    const importContext = formValues.ImportContexts[whichContext];
    const { ASLSeriesPattern, NVolumes, M0PositionInASL } = importContext;
    const ASLContext = await getASLContext({ ASLSeriesPattern, NVolumes, M0PositionInASL });

    const initialStudyParJSON = {
      ASLContext: ASLContext,
      Manufacturer: importContext.ASLManufacturer !== "" ? importContext.ASLManufacturer : undefined,
      LabelingType: importContext.ASLSequence === "CASL" ? "PCASL" : importContext.ASLSequence,
      M0: importContext.M0IsSeparate,
      PostLabelingDelay: importContext.PostLabelingDelay,
      LabelingDuration: importContext.LabelingDuration,
      BackgroundSuppression: importContext.BackgroundSuppression,
      BackgroundSuppressionNumberPulses: importContext.BackgroundSuppressionNumberPulses,
      BackgroundSuppressionPulseTime: importContext.BackgroundSuppressionPulseTime,
    };

    // Cleanup undefined or unnecessary fields
    if (initialStudyParJSON.Manufacturer === undefined) {
      delete initialStudyParJSON.Manufacturer;
    }
    if (initialStudyParJSON.LabelingDuration === 0) {
      delete initialStudyParJSON.LabelingDuration;
    }
    if (initialStudyParJSON.PostLabelingDelay === 0) {
      delete initialStudyParJSON.PostLabelingDelay;
    }
    return initialStudyParJSON;
  } catch (error) {
    return false;
  }
}
