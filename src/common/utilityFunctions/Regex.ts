type RegExParseCaptureGroups<Re extends string> = Re extends ""
  ? {}
  : Re extends `(?<${infer CaptureGrpName}>${infer rest}`
  ? rest extends `${infer _})${infer rest}`
    ? rest extends `?${infer rest}` | `*${infer rest}`
      ? { [name in CaptureGrpName]?: string } & RegExParseCaptureGroups<rest>
      : { [name in CaptureGrpName]: string } & RegExParseCaptureGroups<rest>
    : never
  : Re extends `${infer _}(?<${infer rest}`
  ? RegExParseCaptureGroups<`(?<${rest}`>
  : {};

/**
 * Represents a valid regex match. Contains properties:
 * - `captureGroups` -- The capture groups as an array of strings. These DO NOT include the whole match.
 * - `wholeMatch` -- The whole match as a string.
 * - `groupsObject` -- The capture groups as an object. With keys as the capture group names and values as the capture group contents.
 */
export class RegexMatch<Re extends string> {
  index: number;
  captureGroups: string[];
  groupsObject: RegExParseCaptureGroups<Re>;
  wholeMatch: string;

  constructor(matchArray: RegExpMatchArray) {
    this.groupsObject = matchArray?.groups as any;
    this.index = matchArray.index as any;
    [this.wholeMatch, ...this.captureGroups] = Array.from(matchArray);
  }

  /**
   * Helper method for retieving a given match group. 0 corresponds to the whole match.
   * @param idx The index of the capture group to retrieve.
   * @returns If 0, returns the whole match. Otherwise, returns the capture group at the given index.
   */
  group(idx = 0): string {
    return idx === 0 ? this.wholeMatch : this.captureGroups[idx - 1];
  }
}

/**
 * A modified RegExp that has some type inference of named capture groups and allows for easier use of repeated calls.
 */
export class Regex<Re extends string> {
  pattern: RegExp;
  originalPattern: Re;
  flags: string;

  constructor(pattern: Re, flags = "gm") {
    this.originalPattern = pattern;
    this.pattern = new RegExp(pattern, flags);
    this.flags = flags;
  }

  /**
   * Searches for the **first** match of the regex in the target string.
   * @param target The string to match against.
   * @returns The first match of the regex as a {@link RegexMatch} object or `false` if not match was found.
   * @example
   * ```ts
   * const pat = `(?<FirstName>\\w+) (?<LastName>\\w+)`;
   * const str = "John Doe; Jane Doe";
   * console.log(new Regex(pat).search(str));
   *
   * >>> RegexMatch {
   *    groupsObject: [Object: null prototype] { FirstName: 'John', LastName: 'Doe' },
   *    index: 0,
   *    wholeMatch: 'John Doe',
   *    captureGroups: [ 'John', 'Doe' ]
   * }
   * ```
   */
  search(target: string): RegexMatch<Re> | false {
    // String.match fails to match capture groups when the global flag is "g"
    if (this.flags.includes("g")) {
      return new Regex(this.originalPattern, this.flags.replace("g", "")).search(target);
    }
    const match = target.match(this.pattern);
    return match != null ? new RegexMatch<Re>(match) : false;
  }

  /**
   * Searches for all matches of the regex in the target string.
   * @param target The string to match against.
   * @returns An array of all matches of the regex as {@link RegexMatch} objects.
   * @example
   * ```ts
   * const pat = `(?<FirstName>\\w+) (?<LastName>\\w+)`;
   * const str = "John Doe; Jane Doe";
   * console.log(new Regex(pat).findAll(str));
   *
   * >>> [
   *    RegexMatch {
   *      groupsObject: [Object: null prototype] { FirstName: 'John', LastName: 'Doe' },
   *      index: 0,
   *      wholeMatch: 'John Doe',
   *      captureGroups: [ 'John', 'Doe' ]
   *    },
   *    RegexMatch {
   *      groupsObject: [Object: null prototype] { FirstName: 'Jane', LastName: 'Doe' },
   *      index: 10,
   *      wholeMatch: 'Jane Doe',
   *      captureGroups: [ 'Jane', 'Doe' ]
   *    }
   * ]
   * ```
   */
  findAll(target: string): RegexMatch<Re>[] {
    if (!this.flags.includes("g")) {
      return new Regex(this.originalPattern, this.flags + "g").findAll(target);
    }
    const matches = target.matchAll(this.pattern);
    const origMatchesArr = Array.from(matches);
    return Array.from(origMatchesArr)
      .filter(m => !!m)
      .map(m => new RegexMatch<Re>(m));
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
