import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { seedValidProfileGate } from "../test/landingProfileGate";
import { writeSessionCheckpoint } from "./sessionCheckpoint";
import { resolveRestoredPhase, tryRestoreProjectSession } from "./restoreProjectSession";

const PROJECT_JSON = {
  version: "0.1.0",
  projectMeta: {
    id: "project-1",
    name: "Brain Study",
    rootPath: "/tmp/brain-study",
    createdAt: "2026-05-03T00:00:00.000Z",
    lastOpened: "2026-05-03T00:00:00.000Z",
    currentPhase: "import",
    dataSource: "dicom",
  },
  uiState: {},
  mappingState: {},
  dataPar: {},
};

describe("restoreProjectSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    seedValidProfileGate();
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(PROJECT_JSON));
  });

  it("prefers the session checkpoint for the route project id", async () => {
    writeSessionCheckpoint({
      easlPath: "/tmp/brain-study/project.easl",
      projectId: "project-1",
      phase: "import",
    });

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
    expect(readTextFile).toHaveBeenCalledWith("/tmp/brain-study/project.easl");
  });

  it("falls back to a matching recent project path", async () => {
    const profile = seedValidProfileGate();
    useGlobalStore.setState((state) => ({
      loaded: true,
      settings: {
        ...state.settings,
        recentProjects: ["/tmp/other/project.easl", "/tmp/brain-study/project.easl"],
      },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
    }));

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);
    expect(readTextFile).toHaveBeenCalledWith("/tmp/brain-study/project.easl");
  });

  it("returns false when no checkpoint or recent project matches", async () => {
    await expect(tryRestoreProjectSession("missing-project")).resolves.toBe(false);
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("keeps matching backup recovery pending for LandingPage confirmation", async () => {
    writeSessionCheckpoint({
      easlPath: "/tmp/brain-study/project.easl",
      projectId: "project-1",
      phase: "import",
    });
    vi.mocked(readTextFile)
      .mockResolvedValueOnce("{")
      .mockResolvedValueOnce("{")
      .mockResolvedValueOnce(
        JSON.stringify({ schemaVersion: 1, ...PROJECT_JSON, version: undefined }),
      );

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);

    expect(useProjectStore.getState()).toMatchObject({
      project: null,
      loaded: false,
      recovery: {
        easlPath: "/tmp/brain-study/project.easl",
        projectId: "project-1",
      },
    });
    expect(invoke).not.toHaveBeenCalledWith("atomic_write_project", expect.any(Object));
  });

  it("keeps the route phase when it is accessible", () => {
    const mockProject = {
      projectMeta: { currentPhase: "processing" },
      uiState: { import: { completed: true } },
    } as any;
    expect(resolveRestoredPhase("parameters", mockProject)).toBe("parameters");
  });

  it("falls back to the saved current phase for inaccessible routes", () => {
    const mockProject = {
      projectMeta: { currentPhase: "import" },
      uiState: { import: { completed: false } },
    } as any;
    expect(resolveRestoredPhase("processing", mockProject)).toBe("import");
  });
});
