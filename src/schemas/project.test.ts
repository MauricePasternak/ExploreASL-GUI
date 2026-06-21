import { describe, it, expect } from "vitest";
import { PROJECT_PHASES, canAccessPhase, DEFAULT_PROJECT_FILE, ProjectFileSchema } from "./project";

const validProject = DEFAULT_PROJECT_FILE("test-id", "Test", "/tmp/test");

describe("PROJECT_PHASES", () => {
  it("includes visualization", () => {
    expect(PROJECT_PHASES).toContain("visualization");
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
});

describe("ProjectFileSchema", () => {
  it("parses project file with population and dataVis fields", () => {
    const project = {
      ...validProject,
      uiState: {
        population: { completed: true },
        dataVis: {
          contractSources: [{ relativePath: "test.tsv", fileHash: "abc123" }],
          columnTypes: { GM_vol: "continuous" },
          stage: "visualize",
        },
      },
    };
    expect(() => ProjectFileSchema.parse(project)).not.toThrow();
  });
});
