import { sortBy as lodashSortBy, uniq as lodashUniq } from "lodash";
import { ArrToStringMapping, ParseNamedCaptureGroups } from "../types/utilityTypes";
// import { ArrToStringMapping, ParseCaptureGroup } from "../types/utilityTypes";

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
  return arrVal.filter(v => !!v);
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

  const modifiedStrArr = _options.isMetaCharsEscaped ? stringArr.map(s => escapeRegExp(s)) : stringArr;
  joinedStr = modifiedStrArr.join(_options.delimiter);
  joinedStr = _options.isCaptureGroup ? `(${joinedStr})` : joinedStr;
  joinedStr = _options.isStartEndBound ? `^${joinedStr}$` : joinedStr;
  return joinedStr;
};

/**
 * Retrieves an array of numbers from a string representation of them as delimited strings.
 * @param stringToParse The string to retrieve numerical values from.
 * @param delimiter The delimiter separating numerical values.
 * @param numberType Whether to attempt to parse integers or floats. Defaults to `integer`.
 * @returns An array of parsed numbers.
 */
export const getNumbersFromDelimitedString = (
  stringToParse: string,
  delimiter = ",",
  numberType: "integer" | "float" = "integer"
) => {
  console.log("getNumbersFromDelimitedString: delimiter:", delimiter);
  console.log("getNumbersFromDelimitedString: numberType:", numberType);
  console.log(`getNumbersFromDelimitedString: stringToParse = ${stringToParse}`);

  const retrievedNums = stringToParse
    .split(delimiter)
    .map(substring => {
      const trimmed = substring.trim();
      const parsed = numberType === "integer" ? parseInt(trimmed) : parseFloat(trimmed);
      if (trimmed && parsed != null && !isNaN(parsed)) return parsed;
    })
    .filter(val => val != null);

  console.log(`Retrieved numbers: ${retrievedNums}`);

  return lodashSortBy(lodashUniq(retrievedNums));
};

/**
 * Matches a Regex pattern containing named capture groups against a target string. Returns the groups as an object.
 * @param pattern String pattern coerced into a RegExp instance.
 * @param target String to be matched against.
 * @returns The "groups" Object with autocompletion of the keys names.
 */
export function getNamedRegexGroups<T extends string>(
  pattern: T,
  target: string
): ArrToStringMapping<ParseNamedCaptureGroups<T>> {
  const _pattern = new RegExp(pattern);
  const match = target.match(_pattern);
  return match?.groups;
}

export function regexFindAll(regex: string | RegExp, target: string, flags = "gm"): string[] | null {
  const _regex = typeof regex === "string" ? new RegExp(regex, flags) : regex;
  return target.match(_regex);
}

/**
 * Represents a valid regex match. Contains helpful properties and methods for easier handling:
 * - `groups` -- The capture groups as an array.
 * - `index` -- The index of the match in the target string.
 * - `groupsObject` -- The capture groups as an object. With keys as the capture group names and values as the capture group contents.
 * - `group(idx)` -- A helper method to retrieve the capture group at the given index. Default is to get the first group, which is guarenteed.
 */
export class RegexMatch<T extends string> {
  index: number;
  captureGroups: string[];
  originalPattern: T;
  groupsObject: ArrToStringMapping<ParseNamedCaptureGroups<T>>;
  wholeMatch: string;

  constructor(matchArray: RegExpMatchArray, origPattern?: T) {
    this.groupsObject = matchArray.groups;
    this.index = matchArray.index;
    [this.wholeMatch, ...this.captureGroups] = Array.from(matchArray);
    this.originalPattern = origPattern;
  }

  /**
   * Helper method for retieving a given match group. 0 corresponds to the whole match.
   * @param idx The index of the capture group to retrieve.
   * @returns If 0, returns the whole match. Otherwise, returns the capture group at the given index.
   */
  group(idx = 0): string {
    return idx === 0 ? this.wholeMatch : this.captureGroups[idx];
  }
}

/**
 * A modified RegExp that has some type inference of named capture groups and allows for easier use of repeated calls.
 */
export class Regex<T extends string> {
  pattern: RegExp;
  originalPattern: T;
  flags: string;

  constructor(pattern: T, flags = "gm") {
    this.originalPattern = pattern;
    this.pattern = new RegExp(pattern, flags);
    this.flags = flags;
  }

  /**
   * Searches for the first match of the regex in the target string.
   * @param target The string to match against.
   * @returns The first match of the regex as a {@link RegexMatch} object or `false` if not match was found.
   */
  search(target: string): RegexMatch<T> | false {
    // String.match fails to match capture groups when the global flag is
    if (this.flags.includes("g")) {
      return new Regex(this.originalPattern, this.flags.replace("g", "")).search(target);
    }
    const match = target.match(this.pattern);
    return match != null ? new RegexMatch(match, this.originalPattern) : false;
  }

  /**
   * Searches for all matches of the regex in the target string.
   * @param target The string to match against.
   * @returns An array of all matches of the regex as {@link RegexMatch} objects.
   */
  findAll(target: string): RegexMatch<T>[] {
    if (!this.flags.includes("g")) {
      return new Regex(this.originalPattern, this.flags + "g").findAll(target);
    }
    const matches = target.matchAll(this.pattern);
    const origMatchesArr = Array.from(matches);
    return origMatchesArr
      .map(match => (match == null ? false : new RegexMatch(match, this.originalPattern)))
      .filter(v => v instanceof RegexMatch) as RegexMatch<T>[];
  }

  /**
   * Splits the target string into an array of strings using the regex as a separator.
   * Note that capture groups will cause the delimiter to be included in the array.
   * @param separator The string to match against.
   * @param limit The maximum number of matches to return.
   * @returns An array of strings that were delimited by `separator`.
   */
  split(separator: string, limit?: number): string[] {
    return separator.split(this.pattern, limit);
  }

  /**
   * Replaces all matches of the regex with the given string.
   * @param sourceString The string to have a replacement applied to.
   * @param substitutionString The string to replace the matches with.
   * @returns The string with the matches replaced.
   */
  replace(sourceString: string, substitutionString: string): string {
    return sourceString.replace(this.pattern, substitutionString);
  }
}
