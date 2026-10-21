import { describe, expect, it } from "vitest";

import { buildImportPlan, selectImportEntries, validateLocalStagingEntries } from "./importPlan";
import type { StagingEntry, SubjectRow } from "../schemas/importSchemas";

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

  it("matches metadata to staged sessions without renaming normalized subjects again", () => {
    // Rows already use final subject names, even when a target is another source name.
    const subjectRows: SubjectRow[] = ["SUB1", "SUB2"].flatMap((subject) =>
      ["baseline", "followup1"].map((session) => ({
        id: `${subject}/${session}`,
        subject,
        session,
        groupId: subject === "SUB1" && session === "followup1" ? "override" : "global",
      })),
    );
    const originalRows = structuredClone(subjectRows);
    const plan = buildImportPlan({
      rawPaths: ["raw", "SUB1"].flatMap((subject) =>
        ["baseline", "followup1"].map((session) => `/source/${subject}/${session}/ASL`),
      ),
      sourceRoot: "/source",
      pathPatterns: [
        {
          signature: "VARYING/VARYING/VARYING",
          samplePath: "raw/baseline/ASL",
          blocks: ["raw", "baseline", "ASL"],
          uniqueNames: { 0: ["raw", "SUB1"], 1: ["baseline", "followup1"], 2: ["ASL"] },
          count: 4,
          depth: 3,
        },
      ],
      tokenizerConfigs: {
        "VARYING/VARYING/VARYING": [
          { blockIndex: 0, subBlockIndex: null, tag: "Subject" },
          { blockIndex: 1, subBlockIndex: null, tag: "Session" },
          { blockIndex: 2, subBlockIndex: null, tag: "Modality" },
        ],
      },
      subjectRenames: [
        { original: "raw", target: "SUB1" },
        { original: "SUB1", target: "SUB2" },
      ],
      sessionAliases: [
        { captured: "baseline", alias: "01", index: 1 },
        { captured: "followup1", alias: "02", index: 2 },
      ],
      runAliases: [],
      modalityAliases: [{ captured: "ASL", mapped: "ASL4D" }],
      tokenSubDelimiters: ["_"],
      bMatchDirectories: true,
      metadataGroups: [
        {
          id: "global",
          label: "Global Defaults",
          bidsParams: { BackgroundSuppression: false, BackgroundSuppressionNumberPulses: 0 },
        },
        { id: "override", label: "Followup override", bidsParams: { BackgroundSuppression: true } },
      ],
      subjectRows,
    });

    expect(plan.localIssues).toEqual([]);
    expect(plan.entries).toHaveLength(4);
    expect(plan.sourcestructureJson.tokenVisitAliases).toEqual(["01", "01", "02", "02"]);
    expect(plan.studyparJson.StudyPars).toHaveLength(3);
    expect(plan.studyparJson.StudyPars).toContainEqual({
      SubjectRegExp: "^(SUB2)$",
      VisitRegExp: "^(01|02)$",
      BackgroundSuppression: false,
      BackgroundSuppressionNumberPulses: 0,
    });
    for (const entry of plan.entries) {
      const blocks = plan.studyparJson.StudyPars.filter(
        (block) =>
          new RegExp(block.SubjectRegExp!).test(entry.subject) &&
          new RegExp(block.VisitRegExp!).test(entry.session),
      );
      expect(blocks).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(blocks[0]))).toMatchObject(
        entry.subject === "SUB1" && entry.session === "02"
          ? { BackgroundSuppression: true }
          : { BackgroundSuppression: false, BackgroundSuppressionNumberPulses: 0 },
      );
    }
    expect(plan.fingerprintInput.studyparJson).toBe(plan.studyparJson);
    expect(subjectRows).toEqual(originalRows);
  });
});

describe("import run entry selection", () => {
  it("uses portable case folding and Unicode normalization", () => {
    const entries = [
      entry({ subject: "subjecta" }),
      entry({ subject: "Straße", sourcePath: "/source/strasse" }),
      entry({ subject: "Café", sourcePath: "/source/cafe" }),
      entry({ subject: "OTHER", sourcePath: "/source/other" }),
    ];

    expect(selectImportEntries(entries, ["SUBJECTA", "STRASSE", "Cafe\u0301"])).toEqual(
      entries.slice(0, 3),
    );
  });
});
