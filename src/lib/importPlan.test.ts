import { describe, expect, it } from "vitest";

import { buildImportPlan, validateLocalStagingEntries } from "./importPlan";
import type { StagingEntry } from "../schemas/importSchemas";

const entry = (overrides: Partial<StagingEntry> = {}): StagingEntry => ({
  subject: "SUB1",
  session: "01",
  run: "01",
  runAlias: "ASL_1",
  modality: "ASL4D",
  originalSubject: "source-1",
  originalSession: "visit-1",
  originalRun: "run-1",
  sourcePath: "/source/one",
  ...overrides,
});

describe("import plan local validation", () => {
  it("keeps raw Run while validating separate Run alias and original provenance", () => {
    const issues = validateLocalStagingEntries([
      entry(),
      entry({
        originalSubject: "source-2",
        originalSession: "visit-2",
        originalRun: "run-2",
        subject: "sub-2",
        session: "02",
        run: "02",
        runAlias: "ASL_1",
        sourcePath: "/source/two",
      }),
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "subject", code: "INVALID_SUBJECT", entryIndex: 1 }),
        expect.objectContaining({
          field: "runAlias",
          code: "PORTABLE_COLLISION",
          entryIndex: 0,
          conflictingEntryIndex: 1,
        }),
        expect.objectContaining({
          field: "runAlias",
          code: "PORTABLE_COLLISION",
          entryIndex: 1,
          conflictingEntryIndex: 0,
        }),
      ]),
    );
  });

  it("reports every participant when distinct originals share a target", () => {
    const issues = validateLocalStagingEntries([
      entry(),
      entry({ originalSubject: "source-2", sourcePath: "/source/two" }),
    ]);
    expect(issues.filter((issue) => issue.field === "subject")).toEqual([
      expect.objectContaining({ entryIndex: 0, conflictingEntryIndex: 1 }),
      expect.objectContaining({ entryIndex: 1, conflictingEntryIndex: 0 }),
    ]);
  });

  it("rejects case and Unicode final spelling variants with matching provenance", () => {
    const caseIssues = validateLocalStagingEntries([
      entry(),
      entry({ subject: "sub1", sourcePath: "/source/two" }),
    ]).filter((issue) => issue.field === "destination");
    expect(caseIssues).toEqual([
      expect.objectContaining({ entryIndex: 0, conflictingEntryIndex: 1 }),
      expect.objectContaining({ entryIndex: 1, conflictingEntryIndex: 0 }),
    ]);

    const unicodeIssues = validateLocalStagingEntries([
      entry({ session: "Café" }),
      entry({ session: "CafÉ", sourcePath: "/source/two" }),
    ]).filter((issue) => issue.field === "destination");
    expect(unicodeIssues).toEqual([
      expect.objectContaining({ entryIndex: 0, conflictingEntryIndex: 1 }),
      expect.objectContaining({ entryIndex: 1, conflictingEntryIndex: 0 }),
    ]);
  });

  it("builds grouped mappings, flattened entries, and configuration together", () => {
    const plan = buildImportPlan({
      rawPaths: ["/source/SUB1/ASL"],
      sourceRoot: "/source",
      pathPatterns: [
        {
          signature: "VARYING/VARYING",
          samplePath: "SUB1/ASL",
          blocks: ["SUB1", "ASL"],
          uniqueNames: { 0: ["SUB1"], 1: ["ASL"] },
          count: 1,
          depth: 2,
        },
      ],
      tokenizerConfigs: {
        "VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 1, subBlockIndex: null, tag: "Modality" },
        ],
      },
      subjectRenames: [{ original: "SUB1", target: "SUB1" }],
      sessionAliases: [],
      runAliases: [],
      modalityAliases: [{ captured: "ASL", mapped: "ASL4D" }],
      tokenSubDelimiters: ["_"],
      bMatchDirectories: true,
      metadataGroups: [],
      subjectRows: [],
    });
    expect(plan.mappings[0].entries).toBe(plan.entries.length ? plan.mappings[0].entries : []);
    expect(plan.entries[0]).toMatchObject({ run: "01", runAlias: "ASL_1", originalRun: "01" });
    expect(plan.sourcestructureJson.folderHierarchy).toHaveLength(4);
    expect(plan.studyparJson.StudyPars).toHaveLength(1);
  });
});
