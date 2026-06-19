import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";

describe("processing config round-trip persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
    useProcessingStore.getState().resetProcessing();

    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(readTextFile).mockResolvedValue("");
  });

  it("saves processing config to .easl and restores it on reload", async () => {
    // Create project
    await useProjectStore.getState().createProject("/tmp/roundtrip-project", "Roundtrip");

    // Sync processing config into project
    const config = {
      subjects: ["sub-001", "sub-002"],
      modules: ["structural", "asl"],
      matlabPath: "/usr/local/bin/matlab",
      exploreAslPath: "/opt/ExploreASL",
      workers: 4,
      subjectRegexp: "^(sub-001|sub-002)$",
    } as any;

    useProjectStore.getState().syncProcessingState({
      config,
      processingPhase: "idle",
    });

    // Save project — this serializes processingConfig into the .easl JSON
    await useProjectStore.getState().saveProject();

    // Capture the serialized JSON (last writeTextFile call = saveProject)
    const calls = vi.mocked(writeTextFile).mock.calls;
    const savedJson = calls[calls.length - 1][1] as string;
    const saved = JSON.parse(savedJson);

    expect(saved.uiState.processing?.config).toEqual(config);
    expect(saved.uiState.processing?.currentPhase).toBe("idle");

    // Simulate reload: load the saved JSON
    vi.mocked(readTextFile).mockResolvedValue(savedJson);

    useProjectStore.setState({ project: null, loaded: false, isDirty: false });
    await useProjectStore.getState().loadProject("/tmp/roundtrip-project/project.easl");

    const restored = useProjectStore.getState().project;
    expect(restored?.uiState.processing?.config).toEqual(config);
    expect(restored?.uiState.processing?.currentPhase).toBe("idle");
  });

  it("persists processingPhase transitions across save/reload", async () => {
    await useProjectStore.getState().createProject("/tmp/phase-roundtrip", "Phase Roundtrip");

    useProjectStore.getState().syncProcessingState({
      config: null,
      processingPhase: "running",
    });

    await useProjectStore.getState().saveProject();

    const calls = vi.mocked(writeTextFile).mock.calls;
    const reloadJson = calls[calls.length - 1][1] as string;
    const saved = JSON.parse(reloadJson);
    expect(saved.uiState.processing?.currentPhase).toBe("running");

    // Reload
    vi.mocked(readTextFile).mockResolvedValue(reloadJson);
    useProjectStore.setState({ project: null, loaded: false, isDirty: false });
    await useProjectStore.getState().loadProject("/tmp/phase-roundtrip/project.easl");

    expect(useProjectStore.getState().project?.uiState.processing?.currentPhase).toBe("running");
  });

  it("does not persist null config as null in JSON (omits field)", async () => {
    await useProjectStore.getState().createProject("/tmp/null-roundtrip", "Null Roundtrip");

    // Don't sync any processing state — processingConfig should be undefined
    await useProjectStore.getState().saveProject();

    const savedJson = vi.mocked(writeTextFile).mock.calls[0][1] as string;
    const saved = JSON.parse(savedJson);

    // processingConfig should not be present or be undefined
    expect(saved.uiState.processing?.config).toBeUndefined();
  });
});
