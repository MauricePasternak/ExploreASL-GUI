import { sortBy as lodashSortBy, uniq as lodashUniq } from "lodash";
/**
 * Decodes buffer data coming from a MATLAB process. Data is decoded into a string with the block character removed.
 * @param data A Buffer, typically coming from STDERR or STDOUT from a MATLAB process.
 * @param encoding The expected encoding of the data.
 * @returns The decoded string
 */
export function matlabEscapeBlockChar(data, encoding = "utf-8") {
    return data.toString(encoding).trim().replace(new RegExp("\\\b", "g"), "");
}
/**
 * Returns a modified version of a string with any regular characters within escaped.
 * @param string The string with possible Regexp characters that need escaping.
 */
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
/**
 * Converts a regex string into an array of strings from the capture group contents.
 * @param regexString The regex string of syntax ^(content)$ to convert to an array of strings based on the content.
 * @param delimiter The assumed delimiter separating the content. Defaults to "|".
 */
export const parseRegexToStringArr = (regexString, delimiter = "|") => {
    const trimmedStr = regexString.replace(/^\^\(|\)\$$/gm, "").trim();
    const arrVal = trimmedStr.split(delimiter);
    // Remove empty strings
    return arrVal.filter((v) => !!v);
};
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
export const stringArrToRegex = (stringArr, options) => {
    const defaultOptions = {
        delimiter: "|",
        isMetaCharsEscaped: true,
        isCaptureGroup: true,
        isStartEndBound: true,
    };
    const _options = options ? Object.assign(defaultOptions, options) : defaultOptions;
    let joinedStr;
    const modifiedStrArr = _options.isMetaCharsEscaped ? stringArr.map((s) => escapeRegExp(s)) : stringArr;
    joinedStr = modifiedStrArr.join(_options.delimiter);
    joinedStr = _options.isCaptureGroup ? `(${joinedStr})` : joinedStr;
    joinedStr = _options.isStartEndBound ? `^${joinedStr}$` : joinedStr;
    return joinedStr;
};
/**
 * Retrieves an array of numbers from a string representation of them as delimited strings.
 * @param stringToParse The string to retrieve numerical values from.
 * @param options {@link NumbersFromDelimitedStringOptions}, which include:
 * - `delimiter` -- The delimiter separating the numbers. Defaults to `","`.
 * - `numberType` -- The type of number to retrieve. Defaults to `"float"`.
 * - `sort` -- Whether to sort the numbers. Defaults to `true`.
 * - `unique` -- Whether to remove duplicate numbers. Defaults to `true`.
 */
export const getNumbersFromDelimitedString = (stringToParse, options) => {
    const defaultOptions = {
        delimiter: ",",
        numberType: "float",
        sort: true,
        unique: true,
    };
    const _options = Object.assign(Object.assign({}, defaultOptions), options);
    const retrievedNums = stringToParse
        .split(_options.delimiter)
        .map((substring) => {
        const trimmed = substring.trim();
        const parsed = _options.numberType === "integer" ? parseInt(trimmed) : parseFloat(trimmed);
        if (trimmed && parsed != null && !isNaN(parsed))
            return parsed;
    })
        .filter((val) => val != null);
    if (_options.sort) {
        return _options.unique ? lodashUniq(lodashSortBy(retrievedNums)) : lodashSortBy(retrievedNums);
    }
    else {
        return _options.unique ? lodashUniq(retrievedNums) : retrievedNums;
    }
};
/** Replaces all backward slashes with forward ones. Used to keep filepaths consistent across situations and OS */
export const makeForwardSlashes = (path) => path.replace(/\\/g, "/");
//# sourceMappingURL=stringFunctions.js.map