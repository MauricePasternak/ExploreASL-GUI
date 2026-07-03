import { describe, expect, it } from "vitest";

import { matchSubjectsInFailureDescription, generateSubjectRegexp } from "./subjectMatching";

describe("matchSubjectsInFailureDescription", () => {
  it("matches subject names embedded in NII2BIDS failure descriptions", () => {
    const description = "NII2BIDS failed for perfusion image of BADDIE_ses-01_run-1";

    expect(matchSubjectsInFailureDescription(description, ["BADDIE", "GOODIE"])).toEqual([
      "BADDIE",
    ]);
  });

  it("matches multiple subjects when both appear in the same line", () => {
    const description = "NII2BIDS failed for BADDIE and GOODIE scans";

    expect(matchSubjectsInFailureDescription(description, ["BADDIE", "GOODIE", "OTHER"])).toEqual([
      "BADDIE",
      "GOODIE",
    ]);
  });

  it("returns no matches when the description does not contain known subjects", () => {
    expect(
      matchSubjectsInFailureDescription("NII2BIDS failed for unknown scan", ["BADDIE"]),
    ).toEqual([]);
  });
});

describe("generateSubjectRegexp", () => {
  it("returns default pattern when subjects list is empty", () => {
    expect(generateSubjectRegexp([])).toBe("^sub-.*$");
  });

  it("escapes regex characters in subject names", () => {
    expect(generateSubjectRegexp(["sub.001", "sub+002"])).toBe("^(sub\\.001|sub\\+002)$");
  });

  it("creates alternation pattern for multiple subjects", () => {
    expect(generateSubjectRegexp(["sub-001", "sub-002"])).toBe("^(sub-001|sub-002)$");
  });
});
