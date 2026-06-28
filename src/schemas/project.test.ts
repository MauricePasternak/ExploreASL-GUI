import { describe, it, expect } from "vitest";
import { PROJECT_PHASES, canAccessPhase, DEFAULT_PROJECT_FILE, ProjectFileSchema } from "./project";

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
    const project = { ...validProject, uiState: { population: { completed: true } } };
    expect(canAccessPhase(project, "visualization")).toBe(true);
  });

  it("denies visualization when population.completed is false", () => {
    const project = { ...validProject, uiState: { population: { completed: false } } };
    expect(canAccessPhase(project, "visualization")).toBe(false);
  });

  it("denies visualization when population.completed is undefined", () => {
    const project = { ...validProject, uiState: {} };
    expect(canAccessPhase(project, "visualization")).toBe(false);
  });

  it("canAccessPhase for processing still works after visualization was added", () => {
    const projectWithImport = {
      ...validProject,
      uiState: { import: { completed: true } },
    };
    expect(canAccessPhase(projectWithImport, "processing")).toBe(true);

    const projectWithoutImport = { ...validProject, uiState: {} };
    expect(canAccessPhase(projectWithoutImport, "processing")).toBe(false);
  });

  it("grants manifest when population.completed is true", () => {
    const project = { ...validProject, uiState: { population: { completed: true } } };
    expect(canAccessPhase(project, "manifest")).toBe(true);
  });

  it("denies manifest when population.completed is false", () => {
    const project = { ...validProject, uiState: { population: { completed: false } } };
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
        population: { completed: true },
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
    expect(parsed.uiState.manifest?.lastRunVersions).toBeUndefined();
    expect(parsed.uiState.manifest?.lastPopulationRunMtime).toBeUndefined();
  });
});
