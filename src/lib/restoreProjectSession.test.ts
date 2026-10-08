import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { seedValidProfileGate } from "../test/landingProfileGate";
import { writeSessionCheckpoint } from "./sessionCheckpoint";
import { resolveRestoredPhase, tryRestoreProjectSession } from "./restoreProjectSession";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";
import { resetProjectLifecycleForTests } from "./projectLifecycle";

const snapshot = projectFixture("project-1", "Brain Study", "/tmp/brain-study");
const inspection = {
  candidateId: "candidate",
  projectId: "project-1",
  name: "Brain Study",
  rootPath: snapshot.rootPath,
  recoveredFromBackup: false,
  duplicatePath: null,
  movedFrom: null,
  setupRecovered: 0,
};

afterEach(() => {
  useProjectStore.getState().cancelAutosave();
  resetProjectLifecycleForTests();
});

describe("restoreProjectSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    seedValidProfileGate();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "inspect_project") return inspection;
      if (command === "activate_project") return snapshot;
      if (
        command === "current_project_snapshot" ||
        command === "get_active_import_run" ||
        command === "get_active_run"
      )
        return null;
      if (command === "read_import_status") return [];
      throw new Error(`Unexpected command ${command}`);
    });
  });

  it("prefers the session checkpoint for the route project id", async () => {
    writeSessionCheckpoint({
      easlPath: "/tmp/brain-study/project.easl",
      projectId: "project-1",
      phase: "import",
    });

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-1");
    expect(invoke).toHaveBeenCalledWith(
      "inspect_project",
      expect.objectContaining({ path: "/tmp/brain-study/project.easl" }),
    );
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("falls back to a matching recent project path", async () => {
    const profile = seedValidProfileGate();
    useGlobalStore.setState((state) => ({
      loaded: true,
      settings: {
        ...state.settings,
        recentProjects: [
          { path: "/tmp/other/project.easl", projectId: "other-project" },
          { path: "/tmp/brain-study/project.easl", projectId: "project-1" },
        ],
      },
      profileValidationState: {
        [profile.id]: { valid: true, errors: [] },
      },
    }));

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "inspect_project",
      expect.objectContaining({ path: "/tmp/brain-study/project.easl" }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "inspect_project",
      expect.objectContaining({ path: "/tmp/other/project.easl" }),
    );
  });

  it("fills project identity when restoring an unmatched legacy recent path", async () => {
    const profile = seedValidProfileGate();
    useGlobalStore.setState((state) => ({
      loaded: true,
      settings: {
        ...state.settings,
        recentProjects: [{ path: "/tmp/brain-study/project.easl" }],
      },
      profileValidationState: { [profile.id]: { valid: true, errors: [] } },
    }));

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);

    expect(useGlobalStore.getState().settings.recentProjects[0]).toEqual({
      path: "/tmp/brain-study/project.easl",
      projectId: "project-1",
    });
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
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "current_project_snapshot") return null;
      if (command === "inspect_project") return { ...inspection, recoveredFromBackup: true };
      throw new Error(`Unexpected command ${command}`);
    });

    await expect(tryRestoreProjectSession("project-1")).resolves.toBe(true);

    expect(useProjectStore.getState()).toMatchObject({
      project: null,
      loaded: false,
      recovery: {
        easlPath: "/tmp/brain-study/project.easl",
        projectId: "project-1",
      },
    });
    expect(invoke).not.toHaveBeenCalledWith("activate_project", expect.any(Object));
  });

  it("keeps the route phase when it is accessible", () => {
    const mockProject = projectView({
      ...snapshot,
      allowedPhases: ["import", "parameters", "processing"],
    });
    expect(resolveRestoredPhase("parameters", mockProject)).toBe("parameters");
  });

  it("falls back to the saved current phase for inaccessible routes", () => {
    const mockProject = projectView(snapshot);
    expect(resolveRestoredPhase("processing", mockProject)).toBe("import");
  });
});
