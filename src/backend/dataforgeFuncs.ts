import * as dataForge from "data-forge";
import "data-forge-fs";
import Path from "pathlib-js";
// import DataFrame from "dataframe-js";
// import Papa from "papaparse";

/**
 * Loads a datafrom from a CSV or TSV file into a CSV string which can be parsed on the frontend.
 * @param filepath The filepath to the dataframe to load. Must be a CSV or TSV file. Excel is not supported at the current time.
 * @param config dataforge.ICSVOptions for initially parsing the data from file.
 */
export async function handleLoadDataframe(filepath: string) {
  try {
    const asPath = new Path(filepath);
    if (!(await asPath.exists()) || !(await asPath.isFile()) || ![".csv", ".tsv"].includes(asPath.ext)) {
      return {
        success: false,
        errorMessages: [
          `Failed to load data from the filepath`,
          asPath.path,
          `The filepath either does not exist or is not a valid ".csv" or ".tsv" file`,
        ],
        data: null,
      };
    }

    return {
      success: true,
      errorMessages: [] as string[],
      data: (await dataForge.readFile(filepath).parseCSV()).toCSV(),
    };
  } catch (error) {
    return {
      success: false,
      errorMessages: [`Failed to load. The following reason was given:`, `${error}`],
      data: null,
    };
  }
}
