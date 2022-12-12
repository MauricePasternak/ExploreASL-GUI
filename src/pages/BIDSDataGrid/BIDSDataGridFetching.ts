import {
	isPlainObject as lodashIsPlainObject,
	pickBy as lodashPickBy,
	filter as lodashFilter,
	sortBy as lodashSortBy,
} from "lodash";
import { BIDSAllFieldsNameType, BIDSRow, isBIDSNonMiscField } from "./BIDSColumnDefs";
import { ValidationError } from "yup";
import { BIDSRowSchema } from "../../common/schemas/BIDSDataGridSchemas/BIDSDataGridSchemas";

const { api } = window;

type ParseDirtySuccess = {
	cleanedRow: BIDSRow;
	cols: BIDSAllFieldsNameType[];
	filename: string;
	result: "success";
};
type ParseDirtyFailure = {
	cleanedRow: BIDSRow | null;
	cols: null;
	filename: string;
	result: "invalidJSON" | "invalidBIDS";
};
type ParseDirtyResult = ParseDirtySuccess | ParseDirtyFailure;

/**
 * Parses an object into a BIDSRow
 * @param dirtyRow An item to be ascertained as a BIDSRow
 * @param rowIdx The index of the row for the ID column
 * @param filepath The filepath from the JSON file that the row came from
 * @param filename The basename of the JSON file that the row came from
 * @returns a {@link ParseDirtyResult} object that contains the cleaned row, the columns, and the result of the parsing
 */
async function parseDirtyBIDSRow(
	dirtyRow: unknown,
	rowIdx: number,
	filepath: string,
	filename: string
): Promise<ParseDirtyResult> {
	// Early exit if the row is not an object
	if (!dirtyRow || !lodashIsPlainObject(dirtyRow))
		return { cleanedRow: null, cols: null, filename, result: "invalidJSON" };

	try {
		const cols: BIDSAllFieldsNameType[] = ["ID", "Filepath", "Filename"];
		const validatedRow = await BIDSRowSchema.validate(dirtyRow, { abortEarly: true });

		// At this point, we know that of the BIDS fields that are in there, they are valid; we can pick them out
		const cleanedRow: Omit<BIDSRow, "ID" | "Filepath" | "Filename"> = lodashPickBy(validatedRow, (_, key) => {
			if (isBIDSNonMiscField(key)) {
				cols.push(key); // We update the columns as a side effect
				return true;
			}
			return false;
		});

		const newBIDSRow: BIDSRow = {
			ID: rowIdx,
			Filename: filename,
			Filepath: filepath,
			...cleanedRow,
		};

		return { cleanedRow: newBIDSRow, cols, filename, result: "success" };
	} catch (error) {
		if (!(error instanceof ValidationError)) throw error;
		console.log(`Error validating row ${rowIdx}: ${error.inner}`);
		return { cleanedRow: null, cols: null, filename, result: "invalidBIDS" };
	}
}

async function parseSingleBIDSJSONSidecar(
	jsonPath: string,
	basename: string,
	jsonIndex: number
): Promise<ParseDirtyResult> {
	const { error, payload } = await api.path.readJSONSafe(jsonPath);
	if (error || !payload || Array.isArray(payload) || !lodashIsPlainObject(payload))
		return {
			cleanedRow: null,
			cols: null,
			filename: basename,
			result: "invalidJSON",
		};
	return parseDirtyBIDSRow(payload, jsonIndex, jsonPath, basename);
}

type FetchBIDSDataResult = {
	BIDSRows: BIDSRow[];
	BIDSColumns: Set<BIDSAllFieldsNameType>;
	invalidFiles: string[];
};

/** Wrapper function around the  */
export async function fetchBIDSData(studyRootPath: string): Promise<FetchBIDSDataResult | null> {
	console.log(`Fetching BIDS data from ${studyRootPath}...`);
	// Get the ASL json files
	let jsonPaths = await api.path.glob(`${studyRootPath}/rawdata`, "/**/*asl.json", { onlyFiles: true });
	if (jsonPaths.length === 0) return null;
	jsonPaths = lodashSortBy(jsonPaths, "path"); // Globing order not guaranteed, so sort by path

	// Parse the JSON files
	const parsedRows: ParseDirtyResult[] = await Promise.all(
		jsonPaths.map((jsonPath, jsonIndex) => parseSingleBIDSJSONSidecar(jsonPath.path, jsonPath.basename, jsonIndex))
	);

	// Extract the valid results first; if there are none, return null
	const validResults = lodashFilter(parsedRows, (row) => row.result === "success");
	if (validResults.length === 0) return null;

	// Extract the valid rows and columns from the valid results
	const validRows = validResults.map((row) => row.cleanedRow!);
	const validColumns = new Set(validResults.map((row) => row.cols!).flat(1));

	// For possible future feedback, extract the invalid files
	const invalidFiles = lodashFilter(parsedRows, (row) => row.result !== "success").map((row) => row.filename);
	return { BIDSRows: validRows, BIDSColumns: validColumns, invalidFiles };
}
