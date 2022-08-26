import { uniq as lodashUniq, cloneDeep as lodashCloneDeep, trim as lodashTrim } from "lodash";
import { stringArrToRegex } from "../../common/utilityFunctions/stringFunctions";
import { ImportSchemaType, SourcedataFolderType } from "../../common/types/ImportSchemaTypes";
const { api } = window;

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
 * Updates the "folderHierarchy" fields based on Paths of each import context.
 * @param importSchema The formValues at the end of the third step "Define Contexts"
 * @returns The same formValues but with the "folderHierarchy" field updated to be a regex.
 */
export async function updateFolderHierarchyPerContext(importSchema: ImportSchemaType) {
  try {
    const pathSourcedata = api.path.asPath(importSchema.StudyRootPath, "sourcedata");
    const folderStructure = importSchema.SourcedataStructure;

    const validVisitBasenames = Object.entries(importSchema.MappingVisitAliases)
      .map(([key, value]) => (!!value ? key : ""))
      .filter(v => v);

    const validSessionBasenames = Object.entries(importSchema.MappingSessionAliases)
      .map(([key, value]) => (!!value ? key : ""))
      .filter(v => v);

    const validScanBasenames = Object.entries(importSchema.MappingScanAliases)
      .map(([basename, value]) => (value === "Ignore" ? "" : basename))
      .filter(v => v);

    const subjectDepth = folderStructure.indexOf("Subject") + 1;
    const subjectPaths = await api.path.getPathsAtNthLevel(pathSourcedata.path, subjectDepth, {
      onlyDirectories: true,
    });

    // Loop backwards through each context; global will be the last loop
    for (let contextIndex = importSchema.ImportContexts.length - 1; contextIndex >= 0; contextIndex--) {
      const context = importSchema.ImportContexts[contextIndex];

      // For global context, we just use the collective; leave it up to ExploreASL to deal with skipping/overwriting
      // already-imported instances
      if (context.IsGlobal) {
        context.folderHierarchy = folderStructure.map(folderType => {
          if (folderType === "Subject") {
            return stringArrToRegex(subjectPaths.map(p => p.basename));
          } else if (folderType === "Scan") {
            return stringArrToRegex(validScanBasenames);
          } else if (folderType === "Visit") {
            return stringArrToRegex(validVisitBasenames);
          } else if (folderType === "Session") {
            return stringArrToRegex(validSessionBasenames);
          } else {
            return ".*";
          }
        });

        // For non-global contexts, we need to use the basenames in the Paths field
      } else {
        // Create an array of string arrays; each element is a collection of basenames to make the regex for that
        // folder level
        const regexTemp = context.Paths.reduce(
          (acc, path) => {
            // Remove the sourcedata/ prefix and split into basenames
            const pathParts = path.replace(/\\/g, "/").replace(`${pathSourcedata.path}/`, "").split("/");
            for (let folderStructIndex = 0; folderStructIndex < folderStructure.length; folderStructIndex++) {
              const basename = pathParts[folderStructIndex];
              if (!basename) break; // Undefined basename means we've finished with this path
              acc[folderStructIndex].push(basename);
            }
            return acc;
          },
          folderStructure.map(() => [] as string[])
        );

        context.folderHierarchy = folderStructure.map((folderType, index) => {
          if (folderType === "Scan") return stringArrToRegex(validScanBasenames);
          const values = regexTemp[index];
          // Undefined values means we allow all basenames onwards
          return values.length > 0 ? stringArrToRegex(values) : "^(.*)$";
        });
      } // End non-global context
    } // End loop through contexts
    return importSchema; // Return the updated schema
  } catch (error) {
    console.warn("Something went wrong in pathsTofolderHierarchys", error);
    return false;
  }
}
