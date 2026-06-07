import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import {
  clearSessionCheckpoint,
  projectEaslPath,
  readSessionCheckpoint,
  syncSessionCheckpointFromProject,
  writeSessionCheckpoint,
} from "./sessionCheckpoint";

describe("sessionCheckpoint", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a valid checkpoint", () => {
    writeSessionCheckpoint({
      easlPath: "/tmp/study/project.easl",
      projectId: "abc",
      phase: "import",
    });

    expect(readSessionCheckpoint()).toEqual({
      easlPath: "/tmp/study/project.easl",
      projectId: "abc",
      phase: "import",
    });
  });

  it("clears invalid checkpoint data", () => {
    sessionStorage.setItem("exploreasl-gui:session-checkpoint", JSON.stringify({ bad: true }));
    expect(readSessionCheckpoint()).toBeNull();
  });

  it("syncs from a loaded project file", () => {
    const project = DEFAULT_PROJECT_FILE("project-1", "Brain Study", "/tmp/brain-study");
    project.projectMeta.currentPhase = "parameters";

    syncSessionCheckpointFromProject(project, "import");

    expect(readSessionCheckpoint()).toEqual({
      easlPath: projectEaslPath("/tmp/brain-study"),
      projectId: "project-1",
      phase: "import",
    });
  });

  it("removes the checkpoint when cleared", () => {
    writeSessionCheckpoint({
      easlPath: "/tmp/study/project.easl",
      projectId: "abc",
      phase: "processing",
    });

    clearSessionCheckpoint();
    expect(readSessionCheckpoint()).toBeNull();
  });
});
