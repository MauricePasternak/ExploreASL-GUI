import { pickBy as lodashPickBy } from "lodash";
import { ImportContextSchemaType, ImportSchemaType, SourcedataFolderType } from "../common/types/ImportSchemaTypes";
import { escapeRegExp } from "../common/utils/stringFunctions";

// /**
//  * Gets a number array representing the MATLAB index positions of Subject, Visit, Session, and Scan directories.
//  * @param folderStructure The array of folder types detailing the structure of the study from sourcedata.
//  * @returns The length-4 tuple of numbers representing the capture group indices of the folder structure.
//  */
// function getTokenOrdering(folderStructure: SourcedataFolderType[]): [number, number, number, number] {
//   const filteredStructure = folderStructure.filter(folder => folder !== "Ignore");
//   const tokenOrdering = (["Subject", "Visit", "Session", "Scan"] as Exclude<SourcedataFolderType, "Ignore">[]).map(
//     v => filteredStructure.indexOf(v) + 1 // +1 to account for MATLAB indexing
//   );
//   return tokenOrdering as [number, number, number, number];
// }


// /**
//  * Parses the form values into a format appropriate for conversion to sourceStructure.json
//  * @param formValues Form values coming after defining all necessary aliases, folderPaths, etc.
//  * @returns The JSON structure necessary to write a sourceStructure.json file.
//  */
// export async function buildSourceStructureJSON(formValues: ImportSchemaType, whichContext: number) {
//   try {
//     // First filter the Objects to remove folders associated with unneeded aliases
//     const filteredScanMapping = lodashPickBy(
//       formValues.MappingScanAliases,
//       alias => alias && !["Ignore", ""].includes(alias)
//     );
//     const filteredVisitMapping = lodashPickBy(formValues.MappingVisitAliases, alias => alias && alias !== "");
//     const filteredSessionMapping = lodashPickBy(formValues.MappingSessionAliases, alias => alias && alias !== "");

//     // console.log("filteredScanMapping", filteredScanMapping);
//     const sourceStructureJSON = {
//       bMatchDirectories: true,

//       folderHierarchy: formValues.ImportContexts[whichContext].folderHierarchy,

//       // Example [ 1 0 2 3],
//       tokenOrdering: getTokenOrdering(formValues.SourcedataStructure),

//       // Example ["morning", "morning", "afternoon", "afternoon"]
//       tokenVisitAliases: Object.entries(filteredVisitMapping).flatMap(([folderName, alias]) => [
//         `${escapeRegExp(folderName)}`, // For whatever reason, ^$ are not allowed by ExploreASL in this field
//         alias,
//       ]),

//       // Example ["^1$", "ASL_1", "^2$", "ASL_2"],
//       tokenSessionAliases: Object.entries(filteredSessionMapping).flatMap(([folderName, alias]) => [
//         `^${escapeRegExp(folderName)}$`,
//         alias,
//       ]),

//       // Example [ "^PSEUDO_10_min$", "ASL4D", "^M0$", "M0", "^T1-weighted$", "T1"],
//       tokenScanAliases: Object.entries(filteredScanMapping).flatMap(([folderName, scanAlias]) => [
//         `^${escapeRegExp(folderName)}$`,
//         scanAlias,
//       ]),
//     };
//     // console.log("sourceStructureJSON", sourceStructureJSON);
//     return sourceStructureJSON;
//   } catch (error) {
//     return false;
//   }
// }

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
      BackgroundSuppression: importContext.BackgroundSuppressionNumberPulses > 0,
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
