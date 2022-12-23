import { sortBy as lodashSortBy, uniq as lodashUniq } from "lodash";

/**
 * Decodes buffer data coming from a MATLAB process. Data is decoded into a string with the block character removed.
 * @param data A Buffer, typically coming from STDERR or STDOUT from a MATLAB process.
 * @param encoding The expected encoding of the data.
 * @returns The decoded string
 */
export function matlabEscapeBlockChar(data: Buffer, encoding: BufferEncoding = "utf-8") {
	return data.toString(encoding).trim().replace(new RegExp("\\\b", "g"), "");
}

/**
 * Returns a modified version of a string with any regular characters within escaped.
 * @param string The string with possible Regexp characters that need escaping.
 */
export function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

/**
 * Converts a regex string into an array of strings from the capture group contents.
 * @param regexString The regex string of syntax ^(content)$ to convert to an array of strings based on the content.
 * @param delimiter The assumed delimiter separating the content. Defaults to "|".
 */
export const parseRegexToStringArr = (regexString: string, delimiter = "|") => {
	const trimmedStr = regexString.replace(/^\^\(|\)\$$/gm, "").trim();
	const arrVal = trimmedStr.split(delimiter);
	// Remove empty strings
	return arrVal.filter((v) => !!v);
};

interface StringArrToRegexOptions {
	delimiter?: string;
	isMetaCharsEscaped?: boolean;
	isCaptureGroup?: boolean;
	isStartEndBound?: boolean;
}

/**
 * Converts an array of strings into a regex that should capture all of its contents.
 * @param stringArr The array of strings to be converted into its regex representation.
 * @param options Options controlling the behavior of the function. Keys include:
 * - `delimiter` -- The joining delimiter. Defaults to `"|"`
 * - `isMetaCharsEscaped` -- Whether preliminary meta characters like \ should be escaped. Defaults to `true`.
 * - `isCaptureGroup` -- Whether to encapsulate the string as a regex capture group. Defaults to `true`.
 * - `isStartEndBound` -- Whether to encapsulate the string with ^$ bounds. Defaults to `true`.
 * @example
 * ```ts
 * console.log(stringArrToRegex(["$d#", "%e", "^f"])); // ^(\$d#|%e|\^f)$
 * ```
 */
export const stringArrToRegex = (stringArr: string[], options?: StringArrToRegexOptions) => {
	const defaultOptions: StringArrToRegexOptions = {
		delimiter: "|",
		isMetaCharsEscaped: true,
		isCaptureGroup: true,
		isStartEndBound: true,
	};
	const _options = options ? Object.assign(defaultOptions, options) : defaultOptions;
	let joinedStr: string;

	const modifiedStrArr = _options.isMetaCharsEscaped ? stringArr.map((s) => escapeRegExp(s)) : stringArr;
	joinedStr = modifiedStrArr.join(_options.delimiter);
	joinedStr = _options.isCaptureGroup ? `(${joinedStr})` : joinedStr;
	joinedStr = _options.isStartEndBound ? `^${joinedStr}$` : joinedStr;
	return joinedStr;
};

/**
 * Retrieves an array of numbers from a string representation of them as delimited strings.
 * @param stringToParse The string to retrieve numerical values from.
 * @param delimiter The delimiter separating numerical values.
 * Defaults to `","`.
 * @param numberType Whether to attempt to parse integers or floats.
 * Defaults to `"float"`.
 * @returns An array of parsed numbers in ascending order.
 */
export const getNumbersFromDelimitedString = (
	stringToParse: string,
	delimiter = ",",
	numberType: "integer" | "float" = "float"
) => {
	const retrievedNums = stringToParse
		.split(delimiter)
		.map((substring) => {
			const trimmed = substring.trim();
			const parsed = numberType === "integer" ? parseInt(trimmed) : parseFloat(trimmed);
			if (trimmed && parsed != null && !isNaN(parsed)) return parsed;
		})
		.filter((val) => val != null);

	return lodashSortBy(lodashUniq(retrievedNums));
};

/** Replaces all backward slashes with forward ones. Used to keep filepaths consistent across situations and OS */
export const makeForwardSlashes = (path: string) => path.replace(/\\/g, "/");
