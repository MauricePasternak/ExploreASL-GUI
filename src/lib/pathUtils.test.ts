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
    expect(getRelativePath(`${ROOT}/BAR/05022026_01/scan`, ROOT)).toBe("BAR/05022026_01/scan");
  });

  it("handles root with trailing slash", () => {
    expect(getRelativePath(`${ROOT}/BAR/scan`, `${ROOT}/`)).toBe("BAR/scan");
  });

  it("returns full path if root does not match", () => {
    expect(getRelativePath("/other/path/file", ROOT)).toBe("/other/path/file");
  });

  it("normalizes and handles Windows backslashes", () => {
    expect(
      getRelativePath(
        "C:\\data\\project\\sourcedata\\BAR\\05022026_01\\scan",
        "C:\\data\\project\\sourcedata",
      ),
    ).toBe("BAR/05022026_01/scan");
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
  it("generates signature for BAR-like pattern with sub-block template", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["BAR"],
      1: ["05022026_01"],
      2: ["sernum-0001_ser-AAHead_Scout", "sernum-0018_ser-pcasl_3d_multiTI"],
    };
    const sampleBlocks = ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"];
    expect(computePatternSignature(uniqueNames, 3, sampleBlocks, ["_", "-"])).toBe(
      "BAR/05022026_01/<TOKEN>-<TOKEN>_<TOKEN>-<TOKEN>_<TOKEN>",
    );
  });

  it("generates signature for FOO-like pattern with DICOM fixed", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["FOO"],
      1: ["05022026_01"],
      2: ["DICOM"],
      3: ["sernum-0001_ser-AAHead_Scout", "sernum-0018_ser-pcasl_3d_multiTI"],
    };
    const sampleBlocks = ["FOO", "05022026_01", "DICOM", "sernum-0001_ser-AAHead_Scout"];
    expect(computePatternSignature(uniqueNames, 4, sampleBlocks, ["_", "-"])).toBe(
      "FOO/05022026_01/DICOM/<TOKEN>-<TOKEN>_<TOKEN>-<TOKEN>_<TOKEN>",
    );
  });

  it("shows VARYING for single-block varying positions", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["001", "002"],
      1: ["001-01-MR00", "001-11"],
      2: ["ASL", "T1", "T2"],
      3: ["DICOM"],
    };
    const sampleBlocks = ["001", "001-01-MR00", "ASL", "DICOM"];
    expect(computePatternSignature(uniqueNames, 4, sampleBlocks, ["_", "-"])).toBe(
      "<TOKEN>/<TOKEN>-<TOKEN>-<TOKEN>/<TOKEN>/DICOM",
    );
  });

  it("handles missing entries in uniqueNames", () => {
    const uniqueNames: Record<number, string[]> = {
      0: ["A", "B"],
    };
    const sampleBlocks = ["A", "B"];
    // Depth 2 but only index 0 has data — missing index gets empty array
    const result = computePatternSignature(uniqueNames, 2, sampleBlocks, ["_", "-"]);
    expect(result).toMatch(/^<TOKEN>\//); // first segment is VARYING
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
    expect(patterns[0].uniqueNames[0]!).toEqual(["BAR"]);
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

    expect(depth3.count).toBe(5);
    expect(depth4.count).toBe(5);
  });

  it("handles Windows backslashes in discoverPathPatterns", () => {
    const winRoot = "C:\\data\\project\\sourcedata";
    const winPaths = [
      "C:\\data\\project\\sourcedata\\BAR\\05022026_01\\sernum-0001_ser-AAHead_Scout",
      "C:\\data\\project\\sourcedata\\BAR\\05022026_01\\sernum-0002_ser-AAHead_Scout_MPR_sag",
      "C:\\data\\project\\sourcedata\\FOO\\05022026_01\\DICOM\\sernum-0001_ser-AAHead_Scout",
    ];
    const patterns = discoverPathPatterns(winPaths, winRoot);
    expect(patterns).toHaveLength(2);
    const depth3 = patterns.find((p) => p.depth === 3)!;
    const depth4 = patterns.find((p) => p.depth === 4)!;
    expect(depth3.count).toBe(2);
    expect(depth4.count).toBe(1);
    expect(depth3.uniqueNames[0]).toEqual(["BAR"]);
    expect(depth4.uniqueNames[2]).toEqual(["DICOM"]);
  });

  it("correctly identifies varying segments (scan names) at leaf level", () => {
    const patterns = discoverPathPatterns(BAR_PATHS, ROOT);
    const pattern = patterns[0];

    // Depth level 2 (0-indexed) should have multiple unique scan names
    expect(pattern.uniqueNames[2]!.length).toBe(BAR_PATHS.length);
  });

  it("correctly identifies fixed segment (DICOM) in FOO paths", () => {
    const patterns = discoverPathPatterns(FOO_PATHS, ROOT);
    const pattern = patterns[0];

    // Depth level 2 should be fixed "DICOM"
    expect(pattern.uniqueNames[2]).toEqual(["DICOM"]);
  });

  it("groups paths by sub-block shape, not by value cardinality", () => {
    // GENFI-style: paths with 3-sub-block vs 2-sub-block session names
    // should be separate patterns when delimiters include "-"
    const paths = [
      `${ROOT}/001/001-01-MR00/ASL/DICOM`,
      `${ROOT}/001/001-01-MR00/T1/DICOM`,
      `${ROOT}/001/001-11/ASL/DICOM`,
      `${ROOT}/001/001-11/T1/DICOM`,
    ];

    const patterns = discoverPathPatterns(paths, ROOT, ["_", "-"]);
    expect(patterns).toHaveLength(2);

    const sessionSubBlockCount = (pattern: (typeof patterns)[number]) =>
      splitBySubDelimiters(pattern.blocks[1] ?? "", ["_", "-"]).subBlocks.length;

    const threeSubBlock = patterns.find((p) => sessionSubBlockCount(p) === 3);
    const twoSubBlock = patterns.find((p) => sessionSubBlockCount(p) === 2);

    expect(threeSubBlock).toBeDefined();
    expect(twoSubBlock).toBeDefined();
    expect(threeSubBlock!.count).toBe(2);
    expect(twoSubBlock!.count).toBe(2);
  });

  it("groups all GENFI paths into correct 2 patterns by sub-block shape", () => {
    const genfiRoot = "/test/GENFI/sourcedata";
    const paths = [
      `${genfiRoot}/001/001-01-MR00/ASL/DICOM`,
      `${genfiRoot}/001/001-01-MR00/T1/DICOM`,
      `${genfiRoot}/001/001-01-MR00/T2/DICOM`,
      `${genfiRoot}/001/001-02-MR00/ASL/DICOM`,
      `${genfiRoot}/001/001-02-MR00/T1/DICOM`,
      `${genfiRoot}/001/001-02-MR00/T2/DICOM`,
      `${genfiRoot}/001/001-11/ASL/DICOM`,
      `${genfiRoot}/001/001-11/T1/DICOM`,
      `${genfiRoot}/001/001-11/T2/DICOM`,
      `${genfiRoot}/002/002-01-MR00/ASL/DICOM`,
      `${genfiRoot}/002/002-01-MR00/M0/DICOM`,
      `${genfiRoot}/002/002-01-MR00/T1/DICOM`,
      `${genfiRoot}/002/002-01-MR00/T2/DICOM`,
      `${genfiRoot}/002/002-02-MR00/ASL/DICOM`,
      `${genfiRoot}/002/002-02-MR00/M0/DICOM`,
      `${genfiRoot}/002/002-02-MR00/T1/DICOM`,
      `${genfiRoot}/002/002-02-MR00/T2/DICOM`,
      `${genfiRoot}/002/002-11/ASL/DICOM`,
      `${genfiRoot}/002/002-11/T1/DICOM`,
      `${genfiRoot}/002/002-11/T2/DICOM`,
      `${genfiRoot}/002/002-12-R1/ASL/DICOM`,
      `${genfiRoot}/002/002-12-R1/T1/DICOM`,
      `${genfiRoot}/002/002-12-R1/T2/DICOM`,
      `${genfiRoot}/002/002-13/ASL/DICOM`,
      `${genfiRoot}/002/002-13/T1/DICOM`,
      `${genfiRoot}/002/002-13/T2/DICOM`,
    ];

    const patterns = discoverPathPatterns(paths, genfiRoot, ["_", "-"]);
    expect(patterns).toHaveLength(2);

    const threeSubBlock = patterns.find((p) => p.signature.includes("<TOKEN>-<TOKEN>-<TOKEN>"));
    const twoSubBlock = patterns.find((p) => !p.signature.includes("<TOKEN>-<TOKEN>-<TOKEN>"));

    expect(threeSubBlock).toBeDefined();
    expect(twoSubBlock).toBeDefined();
    expect(threeSubBlock!.count).toBe(17); // all paths with XXX-XX-XXX pattern
    expect(twoSubBlock!.count).toBe(9); // all paths with XXX-XX pattern
    expect(threeSubBlock!.depth).toBe(4);
    expect(twoSubBlock!.depth).toBe(4);

    // Check unique names are correct
    expect(threeSubBlock!.uniqueNames[0]).toEqual(["001", "002"]);
    expect(threeSubBlock!.uniqueNames[3]).toEqual(["DICOM"]);
    expect(twoSubBlock!.uniqueNames[3]).toEqual(["DICOM"]);
  });

  it("merges all paths when no structural differences exist", () => {
    const paths = [`${ROOT}/A/1/x`, `${ROOT}/B/2/y`, `${ROOT}/C/3/z`];
    const patterns = discoverPathPatterns(paths, ROOT, ["_", "-"]);

    // All varying, same depth, same shape → one pattern
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

  it("uses underscore-only delimiters when specified", () => {
    // When only "_" is used as delimiter, "001-01-MR00" has 1 sub-block
    // (no "-" splitting), so all paths have the same shape
    const paths = [`${ROOT}/001/001-01-MR00/ASL/DICOM`, `${ROOT}/001/001-11/ASL/DICOM`];

    const patterns = discoverPathPatterns(paths, ROOT, ["_"]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// splitBySubDelimiters
// ---------------------------------------------------------------------------
describe("splitBySubDelimiters", () => {
  it("splits by underscore only", () => {
    const result = splitBySubDelimiters("sernum-0018_ser-pcasl_3d_multiTI");
    expect(result.subBlocks).toEqual(["sernum-0018", "ser-pcasl", "3d", "multiTI"]);
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
    const result = splitBySubDelimiters("002-12-R1", ["_", "-"]);
    expect(result.subBlocks).toEqual(["002", "12", "R1"]);
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
    const paths = ["BAR/05022026_01/scan", "FOO/05022026_01/scan"];

    const result = analyzeSubBlocks(paths, 1);
    expect(result[0]).toEqual(["05022026"]);
    expect(result[1]).toEqual(["01"]);
  });

  it("uses custom delimiters at the target block depth", () => {
    const paths = ["study/002-12-R1/scan", "study/002-13-R2/scan"];

    const result = analyzeSubBlocks(paths, 1, ["_", "-"]);
    expect(result[0]).toEqual(["002"]);
    expect(result[1]).toEqual(["12", "13"]);
    expect(result[2]).toEqual(["R1", "R2"]);
  });
});
