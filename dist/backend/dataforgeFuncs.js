var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
export function handleLoadDataframe(filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const asPath = new Path(filepath);
            if (!(yield asPath.exists()) || !(yield asPath.isFile()) || ![".csv", ".tsv"].includes(asPath.ext)) {
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
                errorMessages: [],
                data: (yield dataForge.readFile(filepath).parseCSV()).toCSV(),
            };
        }
        catch (error) {
            return {
                success: false,
                errorMessages: [`Failed to load. The following reason was given:`, `${error}`],
                data: null,
            };
        }
    });
}
//# sourceMappingURL=dataforgeFuncs.js.map