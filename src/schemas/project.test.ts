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
      uiState: {
        datapar: {
          advancedVisibility: {
            showAdvancedSections: false,
            showAdvancedM0Params: false,
            showAdvancedQuantification: false,
            showAdvancedGeneralSettings: false,
            showAdvancedASLProcessing: false,
            showAdvancedAtlases: false,
          },
        },
      },
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

  it("parses import execution ui state", () => {
    const parsed = ProjectFileSchema.parse({
      ...DEFAULT_PROJECT_FILE("project-3", "Import State Project", "/tmp/import-state"),
      uiState: {
        import: {
          activeStep: 5,
          completed: true,
          currentPhase: "completed",
        },
      },
    });

    expect(parsed.uiState).toMatchObject({
      import: {
        activeStep: 5,
        completed: true,
        currentPhase: "completed",
      },
    });
  });

  it("parses processingConfig in uiState", () => {
    const parsed = ProjectFileSchema.parse({
      ...DEFAULT_PROJECT_FILE("project-pc", "PC Project", "/tmp/pc"),
      uiState: {
        processing: {
          config: {
            subjects: ["sub-01", "sub-02"],
            modules: ["asl"],
            matlabPath: "/usr/local/bin/matlab",
            exploreAslPath: "/opt/ExploreASL",
            workers: 4,
            subjectRegexp: ".*",
          },
        },
      },
    });
    expect(parsed.uiState.processing?.config).toMatchObject({
      subjects: ["sub-01", "sub-02"],
      modules: ["asl"],
      workers: 4,
    });
  });

  it("parses processingPhase in uiState", () => {
    const parsed = ProjectFileSchema.parse({
      ...DEFAULT_PROJECT_FILE("project-pp", "PP Project", "/tmp/pp"),
      uiState: {
        processing: {
          currentPhase: "running",
        },
      },
    });
    expect(parsed.uiState.processing?.currentPhase).toBe("running");
  });

  it("rejects invalid processingPhase values", () => {
    expect(() =>
      ProjectFileSchema.parse({
        ...DEFAULT_PROJECT_FILE("project-pp2", "PP2", "/tmp/pp2"),
        uiState: {
          processing: {
            currentPhase: "done",
          },
        },
      }),
    ).toThrow();
  });

  it("allows uiState without processingConfig or processingPhase", () => {
    const parsed = ProjectFileSchema.parse(
      DEFAULT_PROJECT_FILE("project-no-pc", "NoPC", "/tmp/nopc"),
    );
    expect(parsed.uiState.processing?.config).toBeUndefined();
    expect(parsed.uiState.processing?.currentPhase).toBeUndefined();
  });

  it("rejects invalid import execution phases", () => {
    expect(() =>
      ProjectFileSchema.parse({
        ...DEFAULT_PROJECT_FILE("project-4", "Invalid Import State", "/tmp/invalid"),
        uiState: {
          import: {
            currentPhase: "done",
          },
        },
      }),
    ).toThrow();
  });

  it("exposes the project persistence location constants", () => {
    expect(PROJECT_FILE_NAME).toBe("project.easl");
  });

  it("defaults showAdvancedSections to false in uiState", () => {
    const parsed = ProjectFileSchema.parse(
      DEFAULT_PROJECT_FILE("project-adv", "Adv Project", "/tmp/adv"),
    );
    expect(parsed.uiState.datapar?.advancedVisibility?.showAdvancedSections).toBe(false);
  });

  it("parses showAdvancedSections true in uiState", () => {
    const parsed = ProjectFileSchema.parse({
      ...DEFAULT_PROJECT_FILE("project-adv2", "Adv2", "/tmp/adv2"),
      uiState: {
        datapar: {
          advancedVisibility: {
            showAdvancedSections: true,
            showAdvancedM0Params: false,
            showAdvancedQuantification: false,
            showAdvancedGeneralSettings: false,
            showAdvancedASLProcessing: false,
            showAdvancedAtlases: false,
          },
        },
      },
    });
    expect(parsed.uiState.datapar?.advancedVisibility?.showAdvancedSections).toBe(true);
  });

  it("accepts empty dataPar object (backward compat)", () => {
    const parsed = ProjectFileSchema.parse({
      version: "0.1.0",
      projectMeta: {
        id: "bc-1", name: "BC", rootPath: "/tmp/bc",
        createdAt: "2026-01-01", lastOpened: "2026-01-01",
        currentPhase: "import",
      },
      exploreAslConfig: { dataPar: {} },
    });
    expect(parsed.exploreAslConfig.dataPar).toEqual({});
  });

  it("accepts dataPar with known fields", () => {
    const parsed = ProjectFileSchema.parse({
      version: "0.1.0",
      projectMeta: {
        id: "bc-2", name: "BC2", rootPath: "/tmp/bc2",
        createdAt: "2026-01-01", lastOpened: "2026-01-01",
        currentPhase: "import",
      },
      exploreAslConfig: {
        dataPar: {
          M0: "UseControlAsM0",
          motionCorrection: true,
          Quality: 0.5,
        },
      },
    });
    expect(parsed.exploreAslConfig.dataPar.M0).toBe("UseControlAsM0");
    expect(parsed.exploreAslConfig.dataPar.motionCorrection).toBe(true);
    expect(parsed.exploreAslConfig.dataPar.Quality).toBe(0.5);
  });

  it("accepts dataPar with unknown extra fields (passthrough)", () => {
    const parsed = ProjectFileSchema.parse({
      version: "0.1.0",
      projectMeta: {
        id: "bc-3", name: "BC3", rootPath: "/tmp/bc3",
        createdAt: "2026-01-01", lastOpened: "2026-01-01",
        currentPhase: "import",
      },
      exploreAslConfig: {
        dataPar: { someFutureField: 42 },
      },
    });
    expect((parsed.exploreAslConfig.dataPar as Record<string, unknown>).someFutureField).toBe(42);
  });

  it("rejects invalid dataPar field types", () => {
    expect(() =>
      ProjectFileSchema.parse({
        version: "0.1.0",
        projectMeta: {
          id: "bc-4", name: "BC4", rootPath: "/tmp/bc4",
          createdAt: "2026-01-01", lastOpened: "2026-01-01",
          currentPhase: "import",
        },
        exploreAslConfig: {
          dataPar: { M0: true },
        },
      }),
    ).toThrow();
  });
});
