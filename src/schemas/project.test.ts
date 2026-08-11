import { describe, it, expect } from "vitest";
import {
  PROJECT_PHASES,
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  ProjectFileSchema,
  ProjectMetaSchema,
  ImportUiStateSchema,
} from "./project";

const validProject = DEFAULT_PROJECT_FILE("test-id", "Test", "/tmp/test");

describe("PROJECT_PHASES", () => {
  it("includes visualization", () => {
    expect(PROJECT_PHASES).toContain("visualization");
  });

  it("includes manifest", () => {
    expect(PROJECT_PHASES).toContain("manifest");
  });
});

describe("canAccessPhase", () => {
  it("grants visualization when population.completed is true", () => {
    const project = {
      ...validProject,
      uiState: { processing: { population: { completed: true } } },
    };
    expect(canAccessPhase(project, "visualization")).toBe(true);
  });

  it("denies visualization when population.completed is false", () => {
    const project = {
      ...validProject,
      uiState: { processing: { population: { completed: false } } },
    };
    expect(canAccessPhase(project, "visualization")).toBe(false);
  });

  it("denies visualization when population.completed is undefined", () => {
    const project = { ...validProject, uiState: {} };
    expect(canAccessPhase(project, "visualization")).toBe(false);
  });

  it("canAccessPhase for processing still works after visualization was added", () => {
    const projectWithImport = {
      ...validProject,
      uiState: {
        import: { completed: true, bidsReviewConfirmed: false, skippedSubjects: [] as string[] },
      },
    };
    expect(canAccessPhase(projectWithImport, "processing")).toBe(true);

    const projectWithoutImport = { ...validProject, uiState: {} };
    expect(canAccessPhase(projectWithoutImport, "processing")).toBe(false);
  });

  it("grants manifest when population.completed is true", () => {
    const project = {
      ...validProject,
      uiState: { processing: { population: { completed: true } } },
    };
    expect(canAccessPhase(project, "manifest")).toBe(true);
  });

  it("denies manifest when population.completed is false", () => {
    const project = {
      ...validProject,
      uiState: { processing: { population: { completed: false } } },
    };
    expect(canAccessPhase(project, "manifest")).toBe(false);
  });

  it("denies manifest when population.completed is undefined", () => {
    const project = { ...validProject, uiState: {} };
    expect(canAccessPhase(project, "manifest")).toBe(false);
  });
});

describe("ProjectFileSchema", () => {
  it("parses project file with population and dataVis fields", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: { population: { completed: true } },
        dataVis: {
          qcbfSource: { relativePath: "test.tsv", fileHash: "abc123" },
          columnTypes: { GM_vol: "continuous" },
          stage: "selectData",
        },
      },
    };
    expect(() => ProjectFileSchema.parse(project)).not.toThrow();
  });

  it("parses project file with manifest.verdicts", () => {
    const project = {
      ...validProject,
      uiState: {
        manifest: {
          verdicts: {
            "sub-01_ses-01": { status: "pass", setAt: 1719000000000 },
            "sub-02_ses-01": {
              status: "fail",
              reason: "motion",
              notes: "Large motion artifacts",
              setAt: 1719000001000,
            },
          },
        },
      },
    };
    expect(() => ProjectFileSchema.parse(project)).not.toThrow();
  });

  it("rejects manifest verdict with status fail but no reason", () => {
    const project = {
      ...validProject,
      uiState: {
        manifest: {
          verdicts: {
            "sub-01_ses-01": { status: "fail", setAt: 1719000000000 },
          },
        },
      },
    };
    const result = ProjectFileSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it("rejects manifest verdict with unknown reason", () => {
    const project = {
      ...validProject,
      uiState: {
        manifest: {
          verdicts: {
            "sub-01_ses-01": { status: "fail", reason: "bogus", setAt: 1719000000000 },
          },
        },
      },
    };
    const result = ProjectFileSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it("rejects manifest verdict with notes exceeding 500 chars", () => {
    const project = {
      ...validProject,
      uiState: {
        manifest: {
          verdicts: {
            "sub-01_ses-01": {
              status: "fail",
              reason: "motion",
              notes: "a".repeat(501),
              setAt: 1719000000000,
            },
          },
        },
      },
    };
    const result = ProjectFileSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it("parses legacy file without manifest field", () => {
    expect(() => ProjectFileSchema.parse(validProject)).not.toThrow();
  });

  it("parses partial manifest slot with undefined fields", () => {
    const project = {
      ...validProject,
      uiState: {
        manifest: {
          verdicts: {
            "sub-A_01": { status: "pass", setAt: 1700000000000 },
          },
        },
      },
    };
    const parsed = ProjectFileSchema.parse(project);
    expect(parsed.uiState.manifest?.verdicts?.["sub-A_01"]).toBeDefined();
    expect(Reflect.get(parsed.uiState.manifest ?? {}, "lastRunVersions")).toBeUndefined();
    expect(Reflect.get(parsed.uiState.manifest ?? {}, "lastPopulationRunMtime")).toBeUndefined();
  });

  it("parses mappingState with invalid/wrong-typed properties using fallback defaults", () => {
    const project = {
      ...validProject,
      mappingState: {
        sourceDataPath: 12345,
        rawPaths: "not-an-array",
        runAliases: [{ captured: 123, alias: "alias" }],
      },
    };
    const parsed = ProjectFileSchema.parse(project);
    expect(parsed.mappingState.sourceDataPath).toBe("");
    expect(parsed.mappingState.rawPaths).toEqual([]);
    expect(parsed.mappingState.runAliases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task 1.1: dataSource on ProjectMetaSchema
// ---------------------------------------------------------------------------
describe("ProjectMetaSchema (dataSource)", () => {
  it("rejects projectMeta without dataSource", () => {
    const result = ProjectMetaSchema.safeParse({
      id: "test",
      name: "Test",
      rootPath: "/tmp",
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      currentPhase: "import",
    });
    expect(result.success).toBe(false);
  });

  it("accepts dataSource 'dicom'", () => {
    const result = ProjectMetaSchema.safeParse({
      id: "test",
      name: "Test",
      rootPath: "/tmp",
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      currentPhase: "import",
      dataSource: "dicom",
    });
    expect(result.success).toBe(true);
  });

  it("accepts dataSource 'bids'", () => {
    const result = ProjectMetaSchema.safeParse({
      id: "test",
      name: "Test",
      rootPath: "/tmp",
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      currentPhase: "import",
      dataSource: "bids",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid dataSource value", () => {
    const result = ProjectMetaSchema.safeParse({
      id: "test",
      name: "Test",
      rootPath: "/tmp",
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      currentPhase: "import",
      dataSource: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("DEFAULT_PROJECT_FILE includes dataSource 'dicom'", () => {
    const project = DEFAULT_PROJECT_FILE("id", "name", "/tmp");
    expect(project.projectMeta.dataSource).toBe("dicom");
  });
});

// ---------------------------------------------------------------------------
// Task 1.2: bidsReviewConfirmed and skippedSubjects on ImportUiStateSchema
// ---------------------------------------------------------------------------
describe("ImportUiStateSchema (BIDS review state)", () => {
  it("defaults bidsReviewConfirmed to false", () => {
    const result = ImportUiStateSchema.parse({});
    expect(result.bidsReviewConfirmed).toBe(false);
  });

  it("defaults skippedSubjects to empty array", () => {
    const result = ImportUiStateSchema.parse({});
    expect(result.skippedSubjects).toEqual([]);
  });

  it("accepts explicit bidsReviewConfirmed true", () => {
    const result = ImportUiStateSchema.parse({ bidsReviewConfirmed: true });
    expect(result.bidsReviewConfirmed).toBe(true);
  });

  it("accepts explicit skippedSubjects", () => {
    const result = ImportUiStateSchema.parse({ skippedSubjects: ["sub-01_1"] });
    expect(result.skippedSubjects).toEqual(["sub-01_1"]);
  });
});

// ---------------------------------------------------------------------------
// Task 1.3: canAccessPhase dispatches on dataSource for processing gate
// ---------------------------------------------------------------------------
describe("canAccessPhase (BIDS processing gate)", () => {
  it("DICOM project: processing gated on import.completed", () => {
    const project = {
      ...validProject,
      projectMeta: { ...validProject.projectMeta, dataSource: "dicom" as const },
      uiState: {
        import: { completed: true, bidsReviewConfirmed: false, skippedSubjects: [] as string[] },
      },
    };
    expect(canAccessPhase(project, "processing")).toBe(true);
  });

  it("DICOM project: processing blocked when import.completed is false", () => {
    const project = {
      ...validProject,
      projectMeta: { ...validProject.projectMeta, dataSource: "dicom" as const },
      uiState: {
        import: { completed: false, bidsReviewConfirmed: false, skippedSubjects: [] as string[] },
      },
    };
    expect(canAccessPhase(project, "processing")).toBe(false);
  });

  it("BIDS project: processing blocked when bidsReviewConfirmed is false", () => {
    const project = {
      ...validProject,
      projectMeta: { ...validProject.projectMeta, dataSource: "bids" as const },
      uiState: { import: { bidsReviewConfirmed: false, skippedSubjects: [] as string[] } },
    };
    expect(canAccessPhase(project, "processing")).toBe(false);
  });

  it("BIDS project: processing admitted when bidsReviewConfirmed is true", () => {
    const project = {
      ...validProject,
      projectMeta: { ...validProject.projectMeta, dataSource: "bids" as const },
      uiState: { import: { bidsReviewConfirmed: true, skippedSubjects: [] as string[] } },
    };
    expect(canAccessPhase(project, "processing")).toBe(true);
  });

  it("BIDS project: processing blocked when import.uiState is missing", () => {
    const project = {
      ...validProject,
      projectMeta: { ...validProject.projectMeta, dataSource: "bids" as const },
      uiState: {},
    };
    expect(canAccessPhase(project, "processing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task Group 4: execution profiles in ProjectFileSchema
// ---------------------------------------------------------------------------
describe("ImportUiStateSchema (selectedProfileId)", () => {
  it("selectedProfileId is optional and defaults to undefined", () => {
    const result = ImportUiStateSchema.parse({});
    expect(result.selectedProfileId).toBeUndefined();
  });

  it("accepts explicit selectedProfileId", () => {
    const result = ImportUiStateSchema.parse({
      selectedProfileId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.selectedProfileId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("ProjectFileSchema (execution profiles)", () => {
  it("parses population.lastRun with profileId", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: {
          population: {
            lastRun: {
              profileId: "550e8400-e29b-41d4-a716-446655440000",
              exploreASLVersion: "1.0.0",
              matlabVersion: "R2023b",
              guiVersion: "0.2.0",
              Mtime: 1719000000000,
            },
          },
        },
      },
    };
    const result = ProjectFileSchema.parse(project);
    expect(result.uiState.processing?.population?.lastRun?.profileId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result.uiState.processing?.population?.lastRun?.exploreASLVersion).toBe("1.0.0");
  });

  it("rejects population.lastRun without profileId", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: {
          population: {
            lastRun: {
              exploreASLVersion: "1.0.0",
              matlabVersion: "R2023b",
            },
          },
        },
      },
    };
    const result = ProjectFileSchema.safeParse(project);
    expect(result.success).toBe(false);
  });

  it("parses structural.lastRun with all fields", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: {
          structural: {
            completed: true,
            lastRun: {
              profileId: "550e8400-e29b-41d4-a716-446655440000",
              exploreASLVersion: "1.0.0",
              matlabVersion: "R2023b",
              guiVersion: "0.2.0",
              Mtime: 1719000000000,
            },
          },
        },
      },
    };
    const result = ProjectFileSchema.parse(project);
    expect(result.uiState.processing?.structural?.lastRun?.profileId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result.uiState.processing?.structural?.completed).toBe(true);
  });

  it("parses asl.lastRun with all fields", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: {
          asl: {
            completed: true,
            lastRun: {
              profileId: "550e8400-e29b-41d4-a716-446655440000",
              exploreASLVersion: "1.0.0",
              matlabVersion: "R2023b",
              guiVersion: "0.2.0",
              Mtime: 1719000000000,
            },
          },
        },
      },
    };
    const result = ProjectFileSchema.parse(project);
    expect(result.uiState.processing?.asl?.lastRun?.profileId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(result.uiState.processing?.asl?.completed).toBe(true);
  });

  it("parses processing config with selectedProfileId", () => {
    const project = {
      ...validProject,
      uiState: {
        processing: {
          config: {
            subjects: ["sub-01"],
            modules: ["asl"],
            selectedProfileId: "550e8400-e29b-41d4-a716-446655440000",
            workers: 2,
          },
        },
      },
    };
    const result = ProjectFileSchema.parse(project);
    expect(result.uiState.processing?.config?.selectedProfileId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

describe("ProjectFileSchema (multi-reviewer manifest compatibility)", () => {
  const reviewerOne = {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Reviewer 1",
    createdAt: "2026-08-08T12:00:00.000Z",
  };
  const reviewerTwo = {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Reviewer 2",
    createdAt: "2026-08-08T12:00:00.000Z",
  };

  it("parses a legacy manifest with no reviewer registry", () => {
    const parsed = ProjectFileSchema.parse({
      ...validProject,
      uiState: { manifest: { verdicts: { "sub-01_01": { status: "pass", setAt: 1 } } } },
    });

    expect(parsed.uiState.manifest?.reviewers).toBeUndefined();
    expect(parsed.uiState.manifest?.verdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 1 },
    });
  });

  it("parses flat verdicts with an explicit single-reviewer registry", () => {
    const parsed = ProjectFileSchema.parse({
      ...validProject,
      uiState: {
        manifest: {
          reviewers: [reviewerOne],
          verdicts: { "sub-01_01": { status: "pass", setAt: 1 } },
        },
      },
    });

    expect(parsed.uiState.manifest?.reviewers).toEqual([reviewerOne]);
    expect(parsed.uiState.manifest?.verdicts).toEqual({
      "sub-01_01": { status: "pass", setAt: 1 },
    });
  });

  it("parses nested verdicts with a multi-reviewer registry", () => {
    const verdicts = {
      [reviewerOne.id]: { "sub-01_01": { status: "pass", setAt: 1 } },
      [reviewerTwo.id]: {},
    };
    const parsed = ProjectFileSchema.parse({
      ...validProject,
      uiState: { manifest: { reviewers: [reviewerOne, reviewerTwo], verdicts } },
    });

    expect(parsed.uiState.manifest?.reviewers).toEqual([reviewerOne, reviewerTwo]);
    expect(parsed.uiState.manifest?.verdicts).toEqual(verdicts);
  });
});
