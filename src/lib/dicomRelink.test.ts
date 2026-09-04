import { describe, expect, it } from "vitest";

import { discoverPathPatterns } from "./pathUtils";
import { areDicomStructuresCompatible } from "./dicomRelink";

describe("DICOM relink structure compatibility", () => {
  it("matches exact normalized relative inventory and path-pattern signatures", () => {
    const savedPaths = ["sub-02\\ses-01\\ASL", "sub-01/ses-01/ASL"];
    const replacementPaths = ["sub-01/ses-01/ASL", "sub-02/ses-01/ASL"];
    const savedPatterns = discoverPathPatterns(savedPaths, "", ["_"]);
    const replacementPatterns = discoverPathPatterns(replacementPaths, "", ["_"]);

    expect(
      areDicomStructuresCompatible(
        savedPaths,
        savedPatterns,
        replacementPaths,
        replacementPatterns,
      ),
    ).toBe(true);
  });

  it("rejects changed relative inventory", () => {
    const savedPaths = ["sub-01/ses-01/ASL"];
    const replacementPaths = ["sub-01/ses-02/ASL"];

    expect(
      areDicomStructuresCompatible(
        savedPaths,
        discoverPathPatterns(savedPaths, "", ["_"]),
        replacementPaths,
        discoverPathPatterns(replacementPaths, "", ["_"]),
      ),
    ).toBe(false);
  });

  it("rejects matching inventory with changed pattern signatures", () => {
    const paths = ["sub-01/ses-01/ASL"];
    const patterns = discoverPathPatterns(paths, "", ["_"]);

    expect(
      areDicomStructuresCompatible(paths, patterns, paths, [
        { ...patterns[0], signature: "changed" },
      ]),
    ).toBe(false);
  });
});
