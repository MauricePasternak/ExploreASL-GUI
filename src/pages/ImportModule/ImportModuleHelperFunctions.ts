import { uniq as lodashUniq } from "lodash";
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
