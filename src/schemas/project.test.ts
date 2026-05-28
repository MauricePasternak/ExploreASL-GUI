import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROJECT_FILE,
  PROJECT_FILE_NAME,
  ProjectFileSchema,
} from "./project";

describe("ProjectFileSchema", () => {
  it("creates a default project file rooted in the import phase", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T16:45:00.000Z"));

    const project = DEFAULT_PROJECT_FILE("project-1", "Test Project", "/tmp/project-root");

    expect(project).toMatchObject({
      version: "0.1.0",
      projectMeta: {
        id: "project-1",
        name: "Test Project",
        rootPath: "/tmp/project-root",
        currentPhase: "import",
      },
      uiState: {},
      mappingState: {},
      exploreAslConfig: {
        sourcestructure: {},
        studyPar: {},
        dataPar: {},
      },
    });
    expect(project.projectMeta.createdAt).toBe("2026-05-03T16:45:00.000Z");
    expect(project.projectMeta.lastOpened).toBe("2026-05-03T16:45:00.000Z");

    vi.useRealTimers();
  });

  it("parses a valid project file", () => {
    const parsed = ProjectFileSchema.parse(
      DEFAULT_PROJECT_FILE("project-2", "Another Project", "/tmp/another-project"),
    );

    expect(parsed.projectMeta.currentPhase).toBe("import");
  });

  it("exposes the project persistence location constants", () => {
    expect(PROJECT_FILE_NAME).toBe("project.easl");
  });
});
