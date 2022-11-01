import {
  uniq as lodashUniq,
  isUndefined as lodashIsUndefined,
  pickBy as lodashPickBy,
  trim as lodashTrim,
} from "lodash";
import { escapeRegExp, stringArrToRegex } from "../../common/utilityFunctions/stringFunctions";
import {
  ImportContextSchemaType,
  ImportSchemaType,
  SourcedataFolderType,
  SourceStuctureJSONOutputSchemaType,
  StudyParJSONOutputSchemaType,
} from "../../common/types/ImportSchemaTypes";
const { api } = window;

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
      [scanDepth, visitDepth, sessionDepth].map(depth => {
        return api.path.getPathsAtNthLevel(datasetRootDir + "/sourcedata", depth, globOptions);
      })
    );
    if (scanPaths.length === 0) return false;

    // We only care about the basenames
    const scanBasenames = lodashUniq(scanPaths.map(p => p.basename));
    const visitBasenames = visitDepth > 0 ? lodashUniq(visitPaths.map(p => p.basename)) : [];
    const sessionBasenames = sessionDepth > 0 ? lodashUniq(sessionPaths.map(p => p.basename)) : [];

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

export async function buildSourceStructureJSON(
  importSchema: ImportSchemaType
): Promise<SourceStuctureJSONOutputSchemaType | false> {
  try {
    // Save to more wieldy named variables
    const pathSourcedata = api.path.asPath(importSchema.StudyRootPath, "sourcedata");
    const folderStructure = importSchema.SourcedataStructure;

    // Get the filepaths for each subject
    const subjectDepth = folderStructure.indexOf("Subject") + 1;
    const subjectPaths = await api.path.getPathsAtNthLevel(pathSourcedata.path, subjectDepth, {
      onlyDirectories: true,
    });

    // Clean up mappings for Scan, Visit, and Session
    const filteredScanMapping = lodashPickBy(
      importSchema.MappingScanAliases,
      alias => alias && !["Ignore", ""].includes(alias)
    );
    const filteredVisitMapping = lodashPickBy(importSchema.MappingVisitAliases, alias => alias && alias !== "");
    const filteredSessionMapping = lodashPickBy(importSchema.MappingSessionAliases, alias => alias && alias !== "");

    // Get the folderHierarchy
    const folderHierarchy = folderStructure.map(folderType => {
      switch (folderType) {
        case "Subject":
          return stringArrToRegex(subjectPaths.map(p => p.basename));
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

export async function buildStudyParJSON(importSchema: ImportSchemaType): Promise<StudyParJSONOutputSchemaType | false> {
  try {
    const result = [];

    for (const context of importSchema.ImportContexts) {
      const { ASLSeriesPattern, NVolumes, M0PositionInASL, SubjectRegExp, VisitRegExp, SessionRegExp } = context;
      const ASLContext = await getASLContext({ ASLSeriesPattern, NVolumes, M0PositionInASL });

      const temp = {
        SubjectRegExp: SubjectRegExp !== "" ? SubjectRegExp : undefined,
        VisitRegExp: VisitRegExp !== "" ? VisitRegExp : undefined,
        SessionRegExp: SessionRegExp !== "" ? SessionRegExp : undefined,
        ASLContext,
        M0: context.M0IsSeparate,
        Manufacturer: context.ASLManufacturer !== "" ? context.ASLManufacturer : undefined,
        ArterialSpinLabelingType: context.ASLSequence === "CASL" ? "PCASL" : context.ASLSequence,
        PostLabelingDelay: context.PostLabelingDelay,
        LabelingDuration: context.LabelingDuration,
        BolusCutOffFlag: context.BolusCutOffFlag,
        BolusCutOffTechnique: context.BolusCutOffTechnique,
        BolusCutOffDelayTime: context.BolusCutOffDelayTime,
        BackgroundSuppression: context.BackgroundSuppressionNumberPulses > 0 ? true : undefined,
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
    return result.length > 0 ? ({ StudyPars: result } as unknown as StudyParJSONOutputSchemaType) : false; // If result is empty, return false
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
    const folderStructure = importSchema.SourcedataStructure;
    const pathSourcedata = `${importSchema.StudyRootPath.replace(/\\/gm, "/")}/sourcedata/`;

    for (const context of importSchema.ImportContexts) {
      if (context.IsGlobal) continue;

      const subjectRegExp = [];
      const visitRegExp = [];
      const sessionRegExp = [];

      // Loop through each path, split into parts, and add the appropriate part to each regexp array
      // AFTER applying any alias mappings
      for (const path of context.Paths) {
        const pathParts = path.replace(/\\/g, "/").replace(pathSourcedata, "").split("/");

        const subjectIndex = folderStructure.indexOf("Subject");
        const visitIndex = folderStructure.indexOf("Visit");
        const sessionIndex = folderStructure.indexOf("Session");

        if (subjectIndex !== -1) {
          subjectRegExp.push(pathParts[subjectIndex]);
        }

        if (visitIndex !== -1) {
          const visit = pathParts[visitIndex];
          const visitAlias = importSchema.MappingVisitAliases[visit];
          visitAlias && visitRegExp.push(visitAlias);
        }

        if (sessionIndex !== -1) {
          const session = pathParts[sessionIndex];
          const sessionAlias = importSchema.MappingSessionAliases[session];
          sessionAlias && sessionRegExp.push(sessionAlias);
        }
      }

      // Before moving onto the next context, update the regexps
      subjectRegExp.length > 0 &&
        (context.SubjectRegExp = stringArrToRegex(subjectRegExp, { isCaptureGroup: false, isStartEndBound: false }));
      visitRegExp.length > 0 &&
        (context.VisitRegExp = stringArrToRegex(visitRegExp, { isCaptureGroup: false, isStartEndBound: false }));
      sessionRegExp.length > 0 &&
        (context.SessionRegExp = stringArrToRegex(sessionRegExp, { isCaptureGroup: false, isStartEndBound: false }));
    }

    return importSchema;
  } catch (error) {
    console.warn("Something went wrong in updateContextSpecificRegexps:", error);
    return false;
  }
}
