import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { readSessionCheckpoint } from "../lib/sessionCheckpoint";
import { useImportStore } from "./importStore";
import { useProjectStore } from "./projectStore";
import { isBidsProject, ensureBidsIgnore } from "../lib/bidsUtils";

vi.mock("../lib/bidsUtils", () => ({
  isBidsProject: vi.fn(),
  ensureBidsIgnore: vi.fn(),
}));

describe("useProjectStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });

    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(readTextFile).mockResolvedValue("");
    vi.mocked(isBidsProject).mockReset();
    vi.mocked(ensureBidsIgnore).mockReset();
  });

  it("creates a new project file at the project root", async () => {
    await useProjectStore.getState().createProject("/tmp/demo-project", "Demo Project");

    expect(writeTextFile).toHaveBeenCalledWith(
      `/tmp/demo-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"name": "Demo Project"'),
    );
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("import");
    expect(readSessionCheckpoint()?.projectId).toBe(
      useProjectStore.getState().project?.projectMeta.id,
    );
  });

  it("loads a valid project file and clears the dirty flag", async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        version: "0.1.0",
        projectMeta: {
          id: "project-1",
          name: "Loaded Project",
          rootPath: "/tmp/loaded",
          createdAt: "2026-05-03T00:00:00.000Z",
          lastOpened: "2026-05-03T00:00:00.000Z",
          currentPhase: "parameters",
        },
        uiState: {},
        mappingState: {},
        exploreAslConfig: {
          sourcestructure: {},
          studyPar: {},
          dataPar: {},
        },
      }),
    );

    await useProjectStore.getState().loadProject("/tmp/loaded/project.easl");

    expect(useProjectStore.getState()).toMatchObject({
      loaded: true,
      isDirty: false,
      project: {
        projectMeta: {
          name: "Loaded Project",
          currentPhase: "parameters",
        },
      },
    });
    expect(readSessionCheckpoint()).toMatchObject({
      easlPath: `/tmp/loaded/${PROJECT_FILE_NAME}`,
      projectId: "project-1",
      phase: "parameters",
    });
  });

  it("rejects project files that are not named project.easl", async () => {
    await expect(
      useProjectStore.getState().loadProject("/tmp/loaded/custom-name.easl"),
    ).rejects.toThrow(/project\.easl/i);
  });

  it("marks the project dirty when switching to an accessible phase and persists on save", async () => {
    await useProjectStore.getState().createProject("/tmp/save-project", "Save Project");

    useProjectStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            projectMeta: {
              ...state.project.projectMeta,
              currentPhase: "processing",
            },
          }
        : null,
    }));

    useProjectStore.getState().setPhase("parameters");
    expect(useProjectStore.getState().isDirty).toBe(true);

    await useProjectStore.getState().saveProject();

    expect(writeTextFile).toHaveBeenLastCalledWith(
      `/tmp/save-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"currentPhase": "parameters"'),
    );
    expect(useProjectStore.getState().isDirty).toBe(false);
  });

  it("clears the current project when closed", async () => {
    await useProjectStore.getState().createProject("/tmp/close-project", "Close Project");

    useProjectStore.getState().closeProject();

    expect(useProjectStore.getState()).toMatchObject({
      project: null,
      isDirty: false,
      loaded: false,
    });
    expect(readSessionCheckpoint()).toBeNull();
  });

  describe("syncProcessingState", () => {
    it("syncs config to uiState.processing.config", async () => {
      await useProjectStore.getState().createProject("/tmp/proc-project", "Proc Project");

      const config = {
        subjects: ["sub-01_01"],
        modules: ["structural"],
        matlabPath: "/usr/local/MATLAB",
        exploreAslPath: "/opt/ExploreASL",
        workers: 1,
        subjectRegexp: "^sub-.*$",
      };

      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toEqual(config);
      expect(project?.uiState.processing?.currentPhase).toBe("idle");
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("syncs processingPhase to uiState.processing.currentPhase", async () => {
      await useProjectStore.getState().createProject("/tmp/phase-project", "Phase Project");

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "running",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.currentPhase).toBe("running");
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("handles null config without throwing", async () => {
      await useProjectStore.getState().createProject("/tmp/null-config", "Null Config");

      useProjectStore.getState().syncProcessingState({
        config: null as any,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("drops config when modules is empty", async () => {
      await useProjectStore.getState().createProject("/tmp/empty-mods", "Empty Mods");

      const config = {
        subjects: [] as string[],
        modules: [] as string[],
        matlabPath: "",
        exploreAslPath: "",
        workers: 1,
        subjectRegexp: "^sub-.*$",
      };

      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processing?.config).toBeUndefined();
    });

    it("skips update when values are equal (equality no-op guard)", async () => {
      await useProjectStore.getState().createProject("/tmp/noop-project", "Noop Project");

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "idle",
      });

      const stateBefore = useProjectStore.getState();
      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "idle",
      });

      expect(useProjectStore.getState()).toStrictEqual(stateBefore);
    });
  });

  it("syncs import completion state into project uiState", async () => {
    await useProjectStore.getState().createProject("/tmp/import-project", "Import Project");

    useProjectStore.getState().syncImportState({
      ...useImportStore.getState(),
      activeStep: 5,
      importPhase: "completed",
      importCompleted: true,
    });

    const project = useProjectStore.getState().project;
    expect(project?.uiState).toMatchObject({
      import: {
        activeStep: 5,
        currentPhase: "completed",
        completed: true,
      },
    });
    expect(project?.mappingState).not.toHaveProperty("importPhase");
    expect(project?.mappingState).not.toHaveProperty("importCompleted");
  });

  describe("BIDS project detection", () => {
    it("calls ensureBidsIgnore on createProject if it is a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(true);
      vi.mocked(ensureBidsIgnore).mockResolvedValue(undefined);

      await useProjectStore.getState().createProject("/tmp/bids-project", "BIDS Project");

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/bids-project");
      expect(ensureBidsIgnore).toHaveBeenCalledWith("/tmp/bids-project");
    });

    it("does not call ensureBidsIgnore on createProject if it is not a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(false);

      await useProjectStore.getState().createProject("/tmp/non-bids-project", "Non-BIDS Project");

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/non-bids-project");
      expect(ensureBidsIgnore).not.toHaveBeenCalled();
    });

    it("calls ensureBidsIgnore on loadProject if it is a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(true);
      vi.mocked(ensureBidsIgnore).mockResolvedValue(undefined);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "bids-project-id",
            name: "BIDS Project",
            rootPath: "/tmp/bids-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            sourcestructure: {},
            studyPar: {},
            dataPar: {},
          },
        }),
      );

      await useProjectStore.getState().loadProject("/tmp/bids-loaded/project.easl");

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/bids-loaded");
      expect(ensureBidsIgnore).toHaveBeenCalledWith("/tmp/bids-loaded");
    });

    it("does not call ensureBidsIgnore on loadProject if it is not a BIDS project", async () => {
      vi.mocked(isBidsProject).mockResolvedValue(false);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "non-bids-project-id",
            name: "Non-BIDS Project",
            rootPath: "/tmp/non-bids-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            sourcestructure: {},
            studyPar: {},
            dataPar: {},
          },
        }),
      );

      await useProjectStore.getState().loadProject("/tmp/non-bids-loaded/project.easl");

      expect(isBidsProject).toHaveBeenCalledWith("/tmp/non-bids-loaded");
      expect(ensureBidsIgnore).not.toHaveBeenCalled();
    });

    it("does not throw or block project loading if BIDS checking throws an error", async () => {
      vi.mocked(isBidsProject).mockRejectedValue(new Error("FS Error"));
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          version: "0.1.0",
          projectMeta: {
            id: "error-project-id",
            name: "Error Project",
            rootPath: "/tmp/error-loaded",
            createdAt: "2026-05-03T00:00:00.000Z",
            lastOpened: "2026-05-03T00:00:00.000Z",
            currentPhase: "import",
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: {
            sourcestructure: {},
            studyPar: {},
            dataPar: {},
          },
        }),
      );

      await expect(
        useProjectStore.getState().loadProject("/tmp/error-loaded/project.easl"),
      ).resolves.not.toThrow();

      expect(useProjectStore.getState().loaded).toBe(true);
    });
  });

  describe("setPopulationCompleted", () => {
    it("sets the flag", () => {
      useProjectStore.setState({
        project: {
          version: "0.1.0",
          projectMeta: {
            id: "test",
            name: "Test",
            rootPath: "/tmp",
            createdAt: new Date().toISOString(),
            lastOpened: new Date().toISOString(),
            currentPhase: "processing",
          },
          uiState: {},
          mappingState: {},
          exploreAslConfig: { sourcestructure: {}, studyPar: {}, dataPar: {} },
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(true);
      expect(useProjectStore.getState().project?.uiState.population?.completed).toBe(true);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("clears the flag", () => {
      useProjectStore.setState({
        project: {
          version: "0.1.0",
          projectMeta: {
            id: "test",
            name: "Test",
            rootPath: "/tmp",
            createdAt: new Date().toISOString(),
            lastOpened: new Date().toISOString(),
            currentPhase: "processing",
          },
          uiState: { population: { completed: true } },
          mappingState: {},
          exploreAslConfig: { sourcestructure: {}, studyPar: {}, dataPar: {} },
        },
        isDirty: false,
        loaded: true,
      });

      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(false);
      expect(useProjectStore.getState().project?.uiState.population?.completed).toBe(false);
    });

    it("is a no-op when project is null", () => {
      useProjectStore.setState({ project: null });
      const { setPopulationCompleted } = useProjectStore.getState();
      setPopulationCompleted(true);
      expect(useProjectStore.getState().project).toBeNull();
    });
  });
});
