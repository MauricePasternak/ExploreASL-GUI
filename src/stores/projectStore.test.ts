import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_FILE_NAME } from "../schemas/project";
import { readSessionCheckpoint } from "../lib/sessionCheckpoint";
import { useImportStore } from "./importStore";
import { useProjectStore } from "./projectStore";

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
  });

  it("creates a new project file at the project root", async () => {
    await useProjectStore.getState().createProject("/tmp/demo-project", "Demo Project");

    expect(writeTextFile).toHaveBeenCalledWith(
      `/tmp/demo-project/${PROJECT_FILE_NAME}`,
      expect.stringContaining('"name": "Demo Project"'),
    );
    expect(useProjectStore.getState().project?.projectMeta.currentPhase).toBe("import");
    expect(readSessionCheckpoint()?.projectId).toBe(useProjectStore.getState().project?.projectMeta.id);
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
    await expect(useProjectStore.getState().loadProject("/tmp/loaded/custom-name.easl")).rejects.toThrow(
      /project\.easl/i,
    );
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
    it("syncs config to uiState.processingConfig", async () => {
      await useProjectStore.getState().createProject("/tmp/proc-project", "Proc Project");

      const config = {
        modules: { structural: true, asl: false, population: false },
        iterations: 1,
        skipIfDone: true,
      } as any;

      useProjectStore.getState().syncProcessingState({
        config,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processingConfig).toEqual(config);
      expect(project?.uiState.processingPhase).toBe("idle");
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it("syncs processingPhase to uiState.processingPhase", async () => {
      await useProjectStore.getState().createProject("/tmp/phase-project", "Phase Project");

      useProjectStore.getState().syncProcessingState({
        config: null,
        processingPhase: "running",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processingPhase).toBe("running");
      expect(project?.uiState.processingConfig).toBeUndefined();
    });

    it("handles null config without throwing", async () => {
      await useProjectStore.getState().createProject("/tmp/null-config", "Null Config");

      useProjectStore.getState().syncProcessingState({
        config: null as any,
        processingPhase: "idle",
      });

      const project = useProjectStore.getState().project;
      expect(project?.uiState.processingConfig).toBeUndefined();
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
});
