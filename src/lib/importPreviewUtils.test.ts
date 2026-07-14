import { describe, expect, it } from "vitest";
import type { ModalityAlias, PathPattern, TokenAssignment } from "../schemas/importSchemas";
import { buildAllStagingMappings } from "./importPreviewUtils";

const ROOT = "/data/sourcedata";

const PATTERN_3DASH: PathPattern = {
  signature: "VARYING/VARYING-VARYING-VARYING/VARYING/DICOM",
  samplePath: "001/001-01-MR00/ASL/DICOM",
  blocks: ["001", "001-01-MR00", "ASL", "DICOM"],
  uniqueNames: {
    0: ["001", "002"],
    1: ["001-01-MR00", "001-02-MR00", "002-01-MR00"],
    2: ["ASL", "M0", "T1"],
    3: ["DICOM"],
  },
  count: 9,
  depth: 4,
};

const PATTERN_2DASH: PathPattern = {
  signature: "VARYING/VARYING-VARYING/VARYING/DICOM",
  samplePath: "001/001-11/ASL/DICOM",
  blocks: ["001", "001-11", "ASL", "DICOM"],
  uniqueNames: {
    0: ["001", "002"],
    1: ["001-11", "002-11"],
    2: ["ASL", "T1"],
    3: ["DICOM"],
  },
  count: 6,
  depth: 4,
};

const RAW_PATHS = [
  `${ROOT}/001/001-01-MR00/ASL/DICOM`,
  `${ROOT}/001/001-01-MR00/T1/DICOM`,
  `${ROOT}/001/001-02-MR00/ASL/DICOM`,
  `${ROOT}/002/002-01-MR00/M0/DICOM`,
  `${ROOT}/001/001-11/ASL/DICOM`,
  `${ROOT}/001/001-11/T1/DICOM`,
  `${ROOT}/002/002-11/ASL/DICOM`,
];

const CONFIGS_3DASH: TokenAssignment[] = [
  { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
  { blockIndex: 1, subBlockIndex: 1, tag: "Session" },
  { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
];

const CONFIGS_2DASH: TokenAssignment[] = [
  { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
  { blockIndex: 1, subBlockIndex: 1, tag: "Session" },
  { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
];

const MODALITY_ALIASES: ModalityAlias[] = [
  { captured: "ASL", mapped: "ASL4D" },
  { captured: "T1", mapped: "T1w" },
  { captured: "M0", mapped: "M0" },
];

describe("buildAllStagingMappings", () => {
  it("returns one mapping per pattern", () => {
    const results = buildAllStagingMappings(
      RAW_PATHS,
      ROOT,
      [PATTERN_3DASH, PATTERN_2DASH],
      {
        [PATTERN_3DASH.signature]: CONFIGS_3DASH,
        [PATTERN_2DASH.signature]: CONFIGS_2DASH,
      },
      {},
      [],
      MODALITY_ALIASES,
      ["_", "-"],
    );

    expect(results).toHaveLength(2);
  });

  it("maps 3-dash pattern paths correctly (extracts session from compound name)", () => {
    const results = buildAllStagingMappings(
      RAW_PATHS,
      ROOT,
      [PATTERN_3DASH],
      { [PATTERN_3DASH.signature]: CONFIGS_3DASH },
      {},
      [],
      MODALITY_ALIASES,
      ["_", "-"],
    );

    const threeDash = results[0];
    expect(threeDash.entries.length).toBeGreaterThan(0);
    const aslEntry = threeDash.entries.find((e) => e.sourcePath.includes("001-01-MR00/ASL"));
    expect(aslEntry).toMatchObject({
      subject: "001",
      session: "01",
      run: "01",
      modality: "ASL4D",
    });
  });

  it("maps 2-dash pattern paths correctly (extracts session from compound name)", () => {
    const results = buildAllStagingMappings(
      RAW_PATHS,
      ROOT,
      [PATTERN_2DASH],
      { [PATTERN_2DASH.signature]: CONFIGS_2DASH },
      {},
      [],
      MODALITY_ALIASES,
      ["_", "-"],
    );

    const twoDash = results[0];
    const aslEntry = twoDash.entries.find((e) => e.sourcePath.includes("001-11/ASL"));
    expect(aslEntry).toMatchObject({
      subject: "001",
      session: "11",
      run: "01",
      modality: "ASL4D",
    });
  });

  it("skips ignored modalities", () => {
    const aliasesWithIgnore: ModalityAlias[] = [
      { captured: "ASL", mapped: "ASL4D" },
      { captured: "T1", mapped: null },
      { captured: "M0", mapped: "M0" },
    ];
    const results = buildAllStagingMappings(
      RAW_PATHS,
      ROOT,
      [PATTERN_3DASH],
      { [PATTERN_3DASH.signature]: CONFIGS_3DASH },
      {},
      [],
      aliasesWithIgnore,
      ["_", "-"],
    );

    const threeDash = results[0];
    const t1Entries = threeDash.entries.filter((e) => e.sourcePath.includes("/T1/"));
    expect(t1Entries).toHaveLength(0);
  });

  it("defaults session and run to 01 when not assigned", () => {
    const noSession: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    const simplePattern: PathPattern = {
      signature: "VARYING/VARYING",
      samplePath: "BAR/ASL",
      blocks: ["BAR", "ASL"],
      uniqueNames: { 0: ["BAR"], 1: ["ASL"] },
      count: 1,
      depth: 2,
    };

    const results = buildAllStagingMappings(
      [`${ROOT}/BAR/ASL`],
      ROOT,
      [simplePattern],
      { [simplePattern.signature]: noSession },
      {},
      [],
      [{ captured: "ASL", mapped: "ASL4D" }],
    );

    expect(results[0].entries[0]).toMatchObject({
      session: "01",
      run: "01",
    });
  });

  it("applies BIDS session aliases renaming to staging entry session field", () => {
    const results = buildAllStagingMappings(
      RAW_PATHS.slice(4, 5), // 001-11
      ROOT,
      [PATTERN_2DASH],
      { [PATTERN_2DASH.signature]: CONFIGS_2DASH },
      {},
      [{ captured: "11", alias: "visit_11", index: 1 }],
      MODALITY_ALIASES,
      ["_", "-"],
    );

    expect(results[0].entries[0].session).toBe("visit_11");
  });
});
