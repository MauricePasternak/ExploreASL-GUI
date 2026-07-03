import { readTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../schemas/globalSettings";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
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
  },
  uiState: {},
  mappingState: {},
  dataPar: {},
};

describe("restoreProjectSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
    useGlobalStore.setState({ loaded: true, settings: DEFAULT_SETTINGS });
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
    useGlobalStore.setState({
      loaded: true,
      settings: {
        ...DEFAULT_SETTINGS,
        recentProjects: ["/tmp/other/project.easl", "/tmp/brain-study/project.easl"],
      },
    });

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);
    expect(readTextFile).toHaveBeenCalledWith("/tmp/brain-study/project.easl");
  });

  it("returns false when no checkpoint or recent project matches", async () => {
    await expect(tryRestoreProjectSession("missing-project")).resolves.toBe(false);
    expect(useProjectStore.getState().project).toBeNull();
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
