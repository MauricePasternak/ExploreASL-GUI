import { describe, expect, it } from "vitest";

import type {
  MetadataGroup,
  ModalityAlias,
  PathPattern,
  SessionAlias,
  SubjectRow,
  TokenAssignment,
} from "../schemas/importSchemas";
import {
  assembleSourcestructure,
  assembleStudyPar,
  buildStagingMapping,
  decodePatternSignature,
  extractUniqueValues,
  generateFolderHierarchy,
  generateTokenOrdering,
} from "./tokenizerUtils";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ROOT = "/data/project/sourcedata";

/** BAR pattern: depth 3 — Subject/Date/ScanDir */
const BAR_PATTERN: PathPattern = {
  signature: "VARYING/VARYING/VARYING",
  samplePath: "BAR/05022026_01/sernum-0001_ser-AAHead_Scout",
  blocks: ["BAR", "05022026_01", "sernum-0001_ser-AAHead_Scout"],
  uniqueNames: {
    0: ["BAR"],
    1: ["05022026_01"],
    2: [
      "sernum-0001_ser-AAHead_Scout",
      "sernum-0018_ser-pcasl_3d_multiTI",
      "sernum-0024_ser-t1_mpr_tra_iso_neuronavigation",
    ],
  },
  count: 3,
  depth: 3,
};

/** FOO pattern: depth 4 — Subject/Date/DICOM/ScanDir */
const FOO_PATTERN: PathPattern = {
  signature: "VARYING/VARYING/DICOM/VARYING",
  samplePath: "FOO/05022026_01/DICOM/sernum-0001_ser-AAHead_Scout",
  blocks: ["FOO", "05022026_01", "DICOM", "sernum-0001_ser-AAHead_Scout"],
  uniqueNames: {
    0: ["FOO"],
    1: ["05022026_01"],
    2: ["DICOM"],
    3: [
      "sernum-0001_ser-AAHead_Scout",
      "sernum-0018_ser-pcasl_3d_multiTI",
      "sernum-0024_ser-t1_mpr_tra_iso_neuronavigation",
    ],
  },
  count: 3,
  depth: 4,
};

const BAR_PATHS = [
  `${ROOT}/BAR/05022026_01/sernum-0001_ser-AAHead_Scout`,
  `${ROOT}/BAR/05022026_01/sernum-0018_ser-pcasl_3d_multiTI`,
  `${ROOT}/BAR/05022026_01/sernum-0024_ser-t1_mpr_tra_iso_neuronavigation`,
];

// ---------------------------------------------------------------------------
// generateFolderHierarchy
// ---------------------------------------------------------------------------
describe("generateFolderHierarchy", () => {
  it("generates capture group for tagged blocks and no-capture for ignored", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Ignore" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, BAR_PATTERN);
    expect(result).toEqual(["^(.*)$", "^.*$", "^(.*)$"]);
  });

  it("generates no-capture for unassigned blocks", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      // blockIndex 1 has no assignment
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, BAR_PATTERN);
    expect(result).toEqual(["^(.*)$", "^.*$", "^(.*)$"]);
  });

  it("generates capture groups for all tagged blocks (depth 4)", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Ignore" },
      { blockIndex: 3, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, FOO_PATTERN);
    expect(result).toEqual(["^(.*)$", "^(.*)$", "^.*$", "^(.*)$"]);
  });

  it("handles sub-block assignments with multiple capture groups", () => {
    // Simulate a folder level like "M01_Visit1" where sub-blocks are
    // assigned to Subject (sub-block 0) and Session (sub-block 1)
    const pattern: PathPattern = {
      signature: "VARYING/VARYING",
      samplePath: "M01_Visit1/scan",
      blocks: ["M01_Visit1", "scan"],
      uniqueNames: { 0: ["M01_Visit1", "M02_Visit2"], 1: ["scan"] },
      count: 2,
      depth: 2,
    };

    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, pattern);
    expect(result[0]).toBe("^(.*)_(.*)$");
    expect(result[1]).toBe("^(.*)$");
  });

  it("handles sub-block with one ignored", () => {
    const pattern: PathPattern = {
      signature: "VARYING/VARYING",
      samplePath: "prefix-M01/scan",
      blocks: ["prefix-M01", "scan"],
      uniqueNames: { 0: ["prefix-M01", "prefix-M02"], 1: ["scan"] },
      count: 2,
      depth: 2,
    };

    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Ignore" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, pattern, ["_", "-"]);
    expect(result[0]).toBe("^.*-(.*)$");
  });

  it("defaults to underscore-only splitting when delimiters are omitted", () => {
    const pattern: PathPattern = {
      signature: "VARYING/VARYING",
      samplePath: "C9ORF059.12/scan",
      blocks: ["C9ORF059.12", "scan"],
      uniqueNames: { 0: ["C9ORF059.12"], 1: ["scan"] },
      count: 1,
      depth: 2,
    };

    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];

    const result = generateFolderHierarchy(assignments, pattern);
    expect(result).toEqual(["^(.*)$", "^(.*)$"]);
  });
});

// ---------------------------------------------------------------------------
// generateTokenOrdering
// ---------------------------------------------------------------------------
describe("generateTokenOrdering", () => {
  it("generates correct ordering for Subject + Modality only", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    const hierarchy = ["^(.*)$", "^.*$", "^(.*)$"];

    const result = generateTokenOrdering(assignments, hierarchy);
    // Subject=1, Visit(Session)=0, Session(Run)=0, Scan(Modality)=2
    expect(result).toEqual([1, 0, 0, 2]);
  });

  it("maps GUI terminology correctly to ExploreASL ordering", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Session" }, // GUI Session = ExploreASL Visit
      { blockIndex: 2, subBlockIndex: null, tag: "Run" },      // GUI Run = ExploreASL Session
      { blockIndex: 3, subBlockIndex: null, tag: "Modality" }, // GUI Modality = ExploreASL Scan
    ];
    const hierarchy = ["^(.*)$", "^(.*)$", "^(.*)$", "^(.*)$"];

    const result = generateTokenOrdering(assignments, hierarchy);
    // [Subject=1, Visit=2, Session=3, Scan=4]
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("handles non-sequential capture group indices", () => {
    // Subject at 0, ignored at 1, Session at 2, Modality at 3
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Ignore" },
      { blockIndex: 2, subBlockIndex: null, tag: "Session" },
      { blockIndex: 3, subBlockIndex: null, tag: "Modality" },
    ];
    const hierarchy = ["^(.*)$", "^.*$", "^(.*)$", "^(.*)$"];

    const result = generateTokenOrdering(assignments, hierarchy);
    // Subject=group 1, Session(Visit)=group 2, Modality(Scan)=group 3
    expect(result).toEqual([1, 2, 0, 3]);
  });

  it("handles sub-block assignments", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 0, tag: "Subject" },
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
    ];
    const hierarchy = ["^(.*)_(.*)$", "^(.*)$"];

    const result = generateTokenOrdering(assignments, hierarchy);
    // Subject=group 1, Session(Visit)=group 2, Modality(Scan)=group 3
    expect(result).toEqual([1, 2, 0, 3]);
  });
});

// ---------------------------------------------------------------------------
// extractUniqueValues
// ---------------------------------------------------------------------------
describe("extractUniqueValues", () => {
  it("extracts unique subjects", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = extractUniqueValues(
      BAR_PATHS,
      ROOT,
      assignments,
      "Subject",
      BAR_PATTERN,
    );
    expect(result).toEqual(["BAR"]);
  });

  it("extracts unique modalities", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = extractUniqueValues(
      BAR_PATHS,
      ROOT,
      assignments,
      "Modality",
      BAR_PATTERN,
    );
    expect(result).toHaveLength(3);
    expect(result).toContain("sernum-0001_ser-AAHead_Scout");
    expect(result).toContain("sernum-0018_ser-pcasl_3d_multiTI");
  });

  it("returns empty for unassigned tag", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
    ];

    const result = extractUniqueValues(
      BAR_PATHS,
      ROOT,
      assignments,
      "Session",
      BAR_PATTERN,
    );
    expect(result).toEqual([]);
  });

  it("skips paths that don't match pattern depth", () => {
    const mixedPaths = [
      ...BAR_PATHS,
      `${ROOT}/FOO/05022026_01/DICOM/sernum-0001_ser-AAHead_Scout`,
    ];

    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = extractUniqueValues(
      mixedPaths,
      ROOT,
      assignments,
      "Subject",
      BAR_PATTERN,
    );
    // Should only extract from depth-3 paths
    expect(result).toEqual(["BAR"]);
  });
});

// ---------------------------------------------------------------------------
// buildStagingMapping
// ---------------------------------------------------------------------------
describe("buildStagingMapping", () => {
  it("builds mapping with defaults for missing Session and Run", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: null, tag: "Ignore" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = buildStagingMapping(
      BAR_PATHS,
      ROOT,
      assignments,
      BAR_PATTERN,
      {},
      {},
      {
        "sernum-0001_ser-AAHead_Scout": "T1w",
        "sernum-0018_ser-pcasl_3d_multiTI": "ASL4D",
        "sernum-0024_ser-t1_mpr_tra_iso_neuronavigation": "T1w",
      },
    );

    expect(result).toHaveLength(3);
    for (const entry of result) {
      expect(entry.subject).toBe("BAR");
      expect(entry.session).toBe("01");
      expect(entry.run).toBe("01");
    }
  });

  it("applies subject renames", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = buildStagingMapping(
      BAR_PATHS.slice(0, 1),
      ROOT,
      assignments,
      BAR_PATTERN,
      { BAR: "sub-BAR" },
      {},
      { "sernum-0001_ser-AAHead_Scout": "T1w" },
    );

    expect(result[0].subject).toBe("sub-BAR");
  });

  it("skips modalities mapped to null (Ignored)", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = buildStagingMapping(
      BAR_PATHS,
      ROOT,
      assignments,
      BAR_PATTERN,
      {},
      {},
      {
        "sernum-0001_ser-AAHead_Scout": null,
        "sernum-0018_ser-pcasl_3d_multiTI": "ASL4D",
        "sernum-0024_ser-t1_mpr_tra_iso_neuronavigation": "T1w",
      },
    );

    // Should skip the ignored modality
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.modality !== null)).toBe(true);
  });

  it("returns empty when Subject assignment is missing", () => {
    const assignments: TokenAssignment[] = [
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = buildStagingMapping(
      BAR_PATHS,
      ROOT,
      assignments,
      BAR_PATTERN,
      {},
      {},
      { "sernum-0001_ser-AAHead_Scout": "T1w" },
    );

    expect(result).toEqual([]);
  });

  it("extracts sub-block tokens using hyphen delimiter", () => {
    const pattern: PathPattern = {
      signature: "VARYING/VARYING-VARYING/VARYING",
      samplePath: "C9ORF007/C9ORF007-01-MR00/ASL",
      blocks: ["C9ORF007", "C9ORF007-01-MR00", "ASL"],
      uniqueNames: {
        0: ["C9ORF007", "C9ORF059"],
        1: ["C9ORF007-01-MR00", "C9ORF059-11"],
        2: ["ASL", "T1"],
      },
      count: 4,
      depth: 3,
    };

    const paths = [
      "/data/C9ORF007/C9ORF007-01-MR00/ASL",
      "/data/C9ORF059/C9ORF059-11/T1",
    ];

    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];

    const result = buildStagingMapping(
      paths,
      "/data",
      assignments,
      pattern,
      {},
      {},
      { ASL: "ASL4D", T1: "T1w" },
      ["_", "-"],
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ subject: "C9ORF007", session: "01", modality: "ASL4D" });
    expect(result[1]).toMatchObject({ subject: "C9ORF059", session: "11", modality: "T1w" });
  });
});

// ---------------------------------------------------------------------------
// assembleSourcestructure
// ---------------------------------------------------------------------------
describe("assembleSourcestructure", () => {
  it("always produces 4-level hierarchy", () => {
    const result = assembleSourcestructure([], [], [], true);
    expect(result.folderHierarchy).toHaveLength(4);
    expect(result.folderHierarchy).toEqual([
      "^(.*)$",
      "^(.*)$",
      "^(.*)$",
      "^(.*)$",
    ]);
  });

  it("always produces tokenOrdering [1, 2, 3, 4]", () => {
    const result = assembleSourcestructure([], [], [], true);
    expect(result.tokenOrdering).toEqual([1, 2, 3, 4]);
  });

  it("always includes default session alias 01 → ASL_1", () => {
    const result = assembleSourcestructure([], [], [], true);
    expect(result.tokenSessionAliases).toContain("^01$");
    expect(result.tokenSessionAliases).toContain("ASL_1");
  });

  it("includes additional run aliases but excludes session aliases", () => {
    const sessionAliases: SessionAlias[] = [
      { captured: "visit_1", alias: "visit_1", index: 1 },
      { captured: "visit_2", alias: "visit_2", index: 2 },
    ];
    const runAliases: SessionAlias[] = [
      { captured: "run_a", alias: "ASL_1", index: 1 },
      { captured: "run_b", alias: "ASL_2", index: 2 },
    ];

    const result = assembleSourcestructure(sessionAliases, runAliases, [], true);
    expect(result.tokenSessionAliases).not.toContain("^visit_1$");
    expect(result.tokenSessionAliases).not.toContain("^visit_2$");
    expect(result.tokenSessionAliases).toContain("^run_a$");
    expect(result.tokenSessionAliases).toContain("ASL_2");
  });

  it("builds scan aliases from modality mappings", () => {
    const modalityAliases: ModalityAlias[] = [
      { captured: "t1_mpr", mapped: "T1w" },
      { captured: "pcasl_3d", mapped: "ASL4D" },
      { captured: "phoenix", mapped: null }, // Ignored
    ];

    const result = assembleSourcestructure([], [], modalityAliases, true);
    expect(result.tokenScanAliases).toContain("^T1w$");
    expect(result.tokenScanAliases).toContain("T1w");
    expect(result.tokenScanAliases).toContain("^ASL4D$");
    expect(result.tokenScanAliases).toContain("ASL4D");
    // Should NOT contain ignored modality
    expect(result.tokenScanAliases).not.toContain("phoenix");
  });

  it("deduplicates modality aliases with same mapped name", () => {
    const modalityAliases: ModalityAlias[] = [
      { captured: "t1_mpr_sag", mapped: "T1w" },
      { captured: "t1_mpr_tra", mapped: "T1w" }, // Same mapped name
    ];

    const result = assembleSourcestructure([], [], modalityAliases, true);
    // Count occurrences of "T1w" in scan aliases
    const t1wCount = result.tokenScanAliases.filter((a) => a === "T1w").length;
    expect(t1wCount).toBe(1);
  });

  it("passes through bMatchDirectories", () => {
    expect(assembleSourcestructure([], [], [], true).bMatchDirectories).toBe(true);
    expect(assembleSourcestructure([], [], [], false).bMatchDirectories).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assembleStudyPar
// ---------------------------------------------------------------------------
describe("assembleStudyPar", () => {
  it("emits explicit regex for single-group with all subjects", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global Defaults",
        bidsParams: { ArterialSpinLabelingType: "PCASL", MRAcquisitionType: "3D" },
      },
    ];
    const rows: SubjectRow[] = [
      { id: "SubjA/01", subject: "SubjA", session: "01", groupId: "global" },
      { id: "SubjB/01", subject: "SubjB", session: "01", groupId: "global" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(1);
    expect(result.StudyPars[0].ArterialSpinLabelingType).toBe("PCASL");
    expect(result.StudyPars[0].SubjectRegExp).toBe("^(SubjA|SubjB)$");
    expect(result.StudyPars[0].VisitRegExp).toBe("^(01)$");
  });

  it("emits separate blocks for override group", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global Defaults",
        bidsParams: { ArterialSpinLabelingType: "PCASL" },
      },
      {
        id: "bar-override",
        label: "BAR Override",
        bidsParams: { ArterialSpinLabelingType: "PASL" },
      },
    ];
    const rows: SubjectRow[] = [
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global" },
      { id: "BAR/01", subject: "BAR", session: "01", groupId: "bar-override" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(2);
    expect(result.StudyPars[0].SubjectRegExp).toBe("^(FOO)$");
    expect(result.StudyPars[0].ArterialSpinLabelingType).toBe("PCASL");
    expect(result.StudyPars[1].SubjectRegExp).toBe("^(BAR)$");
    expect(result.StudyPars[1].ArterialSpinLabelingType).toBe("PASL");
  });

  it("splits subjects with different session profiles within same group", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global",
        bidsParams: { MRAcquisitionType: "2D" },
      },
    ];
    const rows: SubjectRow[] = [
      { id: "SubjA/01", subject: "SubjA", session: "01", groupId: "global" },
      { id: "SubjA/02", subject: "SubjA", session: "02", groupId: "global" },
      { id: "SubjC/01", subject: "SubjC", session: "01", groupId: "global" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(2);

    // SubjA has sessions [01, 02]
    const subjABlock = result.StudyPars.find((b) => b.SubjectRegExp === "^(SubjA)$");
    expect(subjABlock).toBeDefined();
    expect(subjABlock!.VisitRegExp).toBe("^(01|02)$");

    // SubjC has sessions [01]
    const subjCBlock = result.StudyPars.find((b) => b.SubjectRegExp === "^(SubjC)$");
    expect(subjCBlock).toBeDefined();
    expect(subjCBlock!.VisitRegExp).toBe("^(01)$");
  });

  it("drops groups with zero assigned subjects", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global",
        bidsParams: { ArterialSpinLabelingType: "PCASL" },
      },
      {
        id: "empty",
        label: "Empty Group",
        bidsParams: { ArterialSpinLabelingType: "PASL" },
      },
    ];
    const rows: SubjectRow[] = [
      { id: "FOO/01", subject: "FOO", session: "01", groupId: "global" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(1);
    expect(result.StudyPars[0].SubjectRegExp).toBe("^(FOO)$");
  });

  it("produces at least one entry even with no groups and no rows", () => {
    const result = assembleStudyPar([], []);
    expect(result.StudyPars).toHaveLength(1);
  });

  it("compresses subjects with identical session profiles into one block", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global",
        bidsParams: {},
      },
    ];
    const rows: SubjectRow[] = [
      { id: "A/01", subject: "A", session: "01", groupId: "global" },
      { id: "A/02", subject: "A", session: "02", groupId: "global" },
      { id: "B/01", subject: "B", session: "01", groupId: "global" },
      { id: "B/02", subject: "B", session: "02", groupId: "global" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(1);
    expect(result.StudyPars[0].SubjectRegExp).toBe("^(A|B)$");
    expect(result.StudyPars[0].VisitRegExp).toBe("^(01|02)$");
  });

  it("escapes regex-special characters in subject and session names", () => {
    const groups: MetadataGroup[] = [
      {
        id: "global",
        label: "Global",
        bidsParams: {},
      },
    ];
    const rows: SubjectRow[] = [
      { id: "C9ORF059.12/01", subject: "C9ORF059.12", session: "01", groupId: "global" },
      { id: "FOO+BAR/01", subject: "FOO+BAR", session: "01", groupId: "global" },
    ];

    const result = assembleStudyPar(groups, rows);
    expect(result.StudyPars).toHaveLength(1);
    expect(result.StudyPars[0].SubjectRegExp).toBe("^(C9ORF059\\.12|FOO\\+BAR)$");
    expect(result.StudyPars[0].VisitRegExp).toBe("^(01)$");
  });
});

// ---------------------------------------------------------------------------
// decodePatternSignature
// ---------------------------------------------------------------------------
describe("decodePatternSignature", () => {
  it("translates a whole-level assignment", () => {
    const signature = "<TOKEN>/DICOM";
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
    ];
    const result = decodePatternSignature(signature, assignments);
    expect(result).toBe("<SUBJECT>/DICOM");
  });

  it("translates sub-block assignments in a multi-token level", () => {
    const signature = "<TOKEN>-<TOKEN>-<TOKEN>";
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 1, tag: "Session" },
    ];
    const result = decodePatternSignature(signature, assignments);
    expect(result).toBe("<TOKEN>-<SESSION>-<TOKEN>");
  });

  it("handles mixed whole-block, sub-block, and unassigned/fixed levels", () => {
    const signature = "<TOKEN>/<TOKEN>-<TOKEN>-<TOKEN>/<TOKEN>/DICOM";
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
      { blockIndex: 1, subBlockIndex: 1, tag: "Session" },
      { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
    ];
    const result = decodePatternSignature(signature, assignments);
    expect(result).toBe("<SUBJECT>/<TOKEN>-<SESSION>-<TOKEN>/<MODALITY>/DICOM");
  });

  it("leaves signature unchanged when there are no assignments", () => {
    const signature = "<TOKEN>/<TOKEN>-<TOKEN>/DICOM";
    const result = decodePatternSignature(signature, []);
    expect(result).toBe(signature);
  });

  it("translates Ignore tag to <IGNORE>", () => {
    const signature = "<TOKEN>/<TOKEN>-<TOKEN>";
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: null, tag: "Ignore" },
      { blockIndex: 1, subBlockIndex: 0, tag: "Ignore" },
      { blockIndex: 1, subBlockIndex: 1, tag: "Session" },
    ];
    const result = decodePatternSignature(signature, assignments);
    expect(result).toBe("<IGNORE>/<IGNORE>-<SESSION>");
  });

  it("supports custom sub-block delimiters", () => {
    const signature = "<TOKEN>_<TOKEN>#<TOKEN>";
    const assignments: TokenAssignment[] = [
      { blockIndex: 0, subBlockIndex: 1, tag: "Run" },
    ];
    // Custom subDelimiters including "_" and "#"
    const result = decodePatternSignature(signature, assignments, ["_", "#"]);
    expect(result).toBe("<TOKEN>_<RUN>#<TOKEN>");
  });
});

