import { describe, expect, it } from "vitest";

import {
  analyzeSubBlocks,
  classifySegment,
  computePatternSignature,
  discoverPathPatterns,
  getRelativePath,
  labelSegment,
  splitBySubDelimiters,
} from "./pathUtils";

// ---------------------------------------------------------------------------
// Test data matching real test/test_project_root/sourcedata/ structure
// ---------------------------------------------------------------------------

const ROOT = "/data/project/sourcedata";

// BAR paths: depth 3 (subject/date/scan)
const BAR_PATHS = [
  `${ROOT}/BAR/05022026_01/sernum-0001_ser-AAHead_Scout`,
  `${ROOT}/BAR/05022026_01/sernum-0002_ser-AAHead_Scout_MPR_sag`,
  `${ROOT}/BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI`,
  `${ROOT}/BAR/05022026_01/sernum-0024_ser-t1_mpr_tra_iso_neuronavigation`,
  `${ROOT}/BAR/05022026_01/sernum-0099_ser-PhoenixZIPReport`,
];

// FOO paths: depth 4 (subject/date/DICOM/scan)
const FOO_PATHS = [
  `${ROOT}/FOO/05022026_01/DICOM/sernum-0001_ser-AAHead_Scout`,
  `${ROOT}/FOO/05022026_01/DICOM/sernum-0002_ser-AAHead_Scout_MPR_sag`,
  `${ROOT}/FOO/05022026_01/DICOM/sernum-0018_ser-pcasl_3d_multiTI`,
  `${ROOT}/FOO/05022026_01/DICOM/sernum-0024_ser-t1_mpr_tra_iso_neuronavigation`,
  `${ROOT}/FOO/05022026_01/DICOM/sernum-0099_ser-PhoenixZIPReport`,
];

const ALL_PATHS = [...BAR_PATHS, ...FOO_PATHS];

// ---------------------------------------------------------------------------
// getRelativePath
// ---------------------------------------------------------------------------
describe("getRelativePath", () => {
  it("strips root prefix", () => {
    expect(getRelativePath(`${ROOT}/BAR/05022026_01/scan`, ROOT)).toBe(
      "BAR/05022026_01/scan",
    );
  });

  it("handles root with trailing slash", () => {
    expect(getRelativePath(`${ROOT}/BAR/scan`, `${ROOT}/`)).toBe("BAR/scan");
  });

  it("returns full path if root does not match", () => {
    expect(getRelativePath("/other/path/file", ROOT)).toBe("/other/path/file");
  });
});

// ---------------------------------------------------------------------------
// classifySegment
// ---------------------------------------------------------------------------
describe("classifySegment", () => {
  it("classifies single unique value as fixed", () => {
    expect(classifySegment(["DICOM", "DICOM", "DICOM"])).toBe("fixed");
  });

  it("classifies multiple unique values as varying", () => {
    expect(classifySegment(["BAR", "FOO"])).toBe("varying");
  });

  it("classifies empty array as fixed", () => {
    expect(classifySegment([])).toBe("fixed");
  });

  it("classifies single element as fixed", () => {
    expect(classifySegment(["BAR"])).toBe("fixed");
  });
});

// ---------------------------------------------------------------------------
// labelSegment
// ---------------------------------------------------------------------------
describe("labelSegment", () => {
  it("returns literal for fixed segment", () => {
    expect(labelSegment(["DICOM"])).toBe("DICOM");
  });

  it("returns NUMBER for all-numeric varying", () => {
    expect(labelSegment(["001", "002", "003"])).toBe("NUMBER");
  });

  it("returns VARYING for mixed varying", () => {
    expect(labelSegment(["BAR", "FOO"])).toBe("VARYING");
  });
});

// ---------------------------------------------------------------------------
// computePatternSignature
// ---------------------------------------------------------------------------
describe("computePatternSignature", () => {
  it("generates signature for BAR-like pattern", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["BAR"],
      1: ["05022026_01"],
      2: ["sernum-0001_ser-AAHead_Scout", "sernum-0018_ser-pcasl_3d_multiTI"],
    };
    expect(computePatternSignature(uniqueNames, 3)).toBe(
      "BAR/05022026_01/VARYING",
    );
  });

  it("generates signature for FOO-like pattern with DICOM fixed", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["FOO"],
      1: ["05022026_01"],
      2: ["DICOM"],
      3: ["sernum-0001_ser-AAHead_Scout", "sernum-0018_ser-pcasl_3d_multiTI"],
    };
    expect(computePatternSignature(uniqueNames, 4)).toBe(
      "FOO/05022026_01/DICOM/VARYING",
    );
  });

  it("handles missing entries in uniqueNames", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["A", "B"],
    };
    // Depth 2 but only index 0 has data — missing index gets empty array
    // which labelSegment treats as a single unique value (edge case)
    const result = computePatternSignature(uniqueNames, 2);
    expect(result).toMatch(/^VARYING\//); // first segment is VARYING
  });
});

// ---------------------------------------------------------------------------
// discoverPathPatterns
// ---------------------------------------------------------------------------
describe("discoverPathPatterns", () => {
  it("returns empty array for empty input", () => {
    expect(discoverPathPatterns([], ROOT)).toEqual([]);
  });

  it("handles single path", () => {
    const patterns = discoverPathPatterns([BAR_PATHS[0]], ROOT);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(1);
    expect(patterns[0].depth).toBe(3);
  });

  it("groups BAR paths into one depth-3 pattern", () => {
    const patterns = discoverPathPatterns(BAR_PATHS, ROOT);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].depth).toBe(3);
    expect(patterns[0].count).toBe(BAR_PATHS.length);
    expect(patterns[0].uniqueNames[0]).toEqual(["BAR"]);
  });

  it("groups FOO paths into one depth-4 pattern", () => {
    const patterns = discoverPathPatterns(FOO_PATHS, ROOT);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].depth).toBe(4);
    expect(patterns[0].count).toBe(FOO_PATHS.length);
    expect(patterns[0].uniqueNames[2]).toEqual(["DICOM"]);
  });

  it("discovers 2 distinct patterns for BAR + FOO combined", () => {
    const patterns = discoverPathPatterns(ALL_PATHS, ROOT);
    expect(patterns).toHaveLength(2);

    const depths = patterns.map((p) => p.depth).sort();
    expect(depths).toEqual([3, 4]);

    const depth3 = patterns.find((p) => p.depth === 3)!;
    const depth4 = patterns.find((p) => p.depth === 4)!;

    expect(depth3.count).toBe(BAR_PATHS.length);
    expect(depth4.count).toBe(FOO_PATHS.length);
  });

  it("correctly identifies varying segments (scan names) at leaf level", () => {
    const patterns = discoverPathPatterns(BAR_PATHS, ROOT);
    const pattern = patterns[0];

    // Depth level 2 (0-indexed) should have multiple unique scan names
    expect(pattern.uniqueNames[2].length).toBe(BAR_PATHS.length);
  });

  it("correctly identifies fixed segment (DICOM) in FOO paths", () => {
    const patterns = discoverPathPatterns(FOO_PATHS, ROOT);
    const pattern = patterns[0];

    // Depth level 2 should be fixed "DICOM"
    expect(pattern.uniqueNames[2]).toEqual(["DICOM"]);
  });

  it("separates patterns when fixed segments differ at same depth", () => {
    // Two groups at depth 3 with different fixed middle segments
    // Each group has 3+ paths so the algorithm can distinguish fixed vs varying
    const pathsA = [
      `${ROOT}/X/FIXED_A/scan1`,
      `${ROOT}/Y/FIXED_A/scan2`,
      `${ROOT}/Z/FIXED_A/scan3`,
    ];
    const pathsB = [
      `${ROOT}/X/FIXED_B/scan4`,
      `${ROOT}/Y/FIXED_B/scan5`,
      `${ROOT}/Z/FIXED_B/scan6`,
    ];
    const patterns = discoverPathPatterns([...pathsA, ...pathsB], ROOT);

    // Should produce 2 patterns because the middle segment differs
    expect(patterns).toHaveLength(2);
    const fixedValues = patterns.map(
      (p) => p.uniqueNames[1][0],
    ).sort();
    expect(fixedValues).toEqual(["FIXED_A", "FIXED_B"]);
  });

  it("merges all paths when no fixed segments differ", () => {
    const paths = [
      `${ROOT}/A/1/x`,
      `${ROOT}/B/2/y`,
      `${ROOT}/C/3/z`,
    ];
    const patterns = discoverPathPatterns(paths, ROOT);

    // All varying, same depth → one pattern
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(3);
  });

  it("provides correct sample path", () => {
    const patterns = discoverPathPatterns(BAR_PATHS, ROOT);
    // Sample path should be a valid relative path
    expect(patterns[0].samplePath).not.toContain(ROOT);
    expect(patterns[0].samplePath.split("/")).toHaveLength(3);
  });

  it("provides correctly sorted unique names", () => {
    const patterns = discoverPathPatterns(ALL_PATHS, ROOT);
    for (const pattern of patterns) {
      for (const values of Object.values(pattern.uniqueNames)) {
        const sorted = [...values].sort();
        expect(values).toEqual(sorted);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// splitBySubDelimiters
// ---------------------------------------------------------------------------
describe("splitBySubDelimiters", () => {
  it("splits by underscore only", () => {
    const result = splitBySubDelimiters("sernum-0018_ser-pcasl_3d_multiTI");
    expect(result.subBlocks).toEqual([
      "sernum-0018",
      "ser-pcasl",
      "3d",
      "multiTI",
    ]);
    expect(result.delimiters).toEqual(["_", "_", "_"]);
  });

  it("handles no delimiters", () => {
    const result = splitBySubDelimiters("DICOM");
    expect(result.subBlocks).toEqual(["DICOM"]);
    expect(result.delimiters).toEqual([]);
  });

  it("handles consecutive delimiters", () => {
    const result = splitBySubDelimiters("a-_b");
    expect(result.subBlocks).toEqual(["a-", "b"]);
    expect(result.delimiters).toEqual(["_"]);
  });

  it("handles leading delimiter", () => {
    const result = splitBySubDelimiters("-test");
    expect(result.subBlocks).toEqual(["-test"]);
    expect(result.delimiters).toEqual([]);
  });

  it("handles trailing delimiter", () => {
    const result = splitBySubDelimiters("test_");
    expect(result.subBlocks).toEqual(["test", ""]);
    expect(result.delimiters).toEqual(["_"]);
  });

  it("supports explicit delimiter arrays", () => {
    const result = splitBySubDelimiters("C9ORF059-12-R1", ["_", "-"]);
    expect(result.subBlocks).toEqual(["C9ORF059", "12", "R1"]);
    expect(result.delimiters).toEqual(["-", "-"]);
  });
});

// ---------------------------------------------------------------------------
// analyzeSubBlocks
// ---------------------------------------------------------------------------
describe("analyzeSubBlocks", () => {
  it("returns unique sub-block values at specified depth", () => {
    const paths = [
      "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
      "BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI",
    ];

    // Analyze depth 2 (scan names)
    const result = analyzeSubBlocks(paths, 2);

    // Sub-block 0 keeps the hyphenated prefix together when splitting by underscore.
    expect(result[0]).toEqual(["sernum-0001", "sernum-0018"]);

    // Sub-block 1 reflects the second underscore-separated token.
    expect(result[1]).toEqual(["ser-AAHead", "ser-pcasl"]);
  });

  it("handles paths without enough depth", () => {
    const paths = ["A/B"];
    const result = analyzeSubBlocks(paths, 5);
    expect(result).toEqual({});
  });

  it("returns unique sub-block values for date-like folders", () => {
    const paths = [
      "BAR/05022026_01/scan",
      "FOO/05022026_01/scan",
    ];

    const result = analyzeSubBlocks(paths, 1);
    expect(result[0]).toEqual(["05022026"]);
    expect(result[1]).toEqual(["01"]);
  });

  it("uses custom delimiters at the target block depth", () => {
    const paths = [
      "study/C9ORF059-12-R1/scan",
      "study/C9ORF059-13-R2/scan",
    ];

    const result = analyzeSubBlocks(paths, 1, ["_", "-"]);
    expect(result[0]).toEqual(["C9ORF059"]);
    expect(result[1]).toEqual(["12", "13"]);
    expect(result[2]).toEqual(["R1", "R2"]);
  });
});
