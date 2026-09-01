import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seedValidProfileGate } from "../test/landingProfileGate";
import { useProcessingStore } from "./processingStore";
import { __resetProjectRevisionForTests, useProjectStore } from "./projectStore";

function lastAtomicProjectBytes() {
  const writes = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "atomic_write_project");
  const write = writes[writes.length - 1];
  const bytes = (write?.[1] as { canonicalBytes?: string } | undefined)?.canonicalBytes;
  if (typeof bytes !== "string") throw new Error("atomic project write was not invoked");
  return bytes;
}

describe("processing config round-trip persistence", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    __resetProjectRevisionForTests();
    seedValidProfileGate();
    useProjectStore.setState({
      project: null,
      isDirty: false,
      loaded: false,
    });
    await useProcessingStore.getState().resetProcessing();

    vi.mocked(readTextFile).mockResolvedValue("");
  });

  it("saves processing config to .easl and restores it on reload", async () => {
    // Create project
    await useProjectStore
      .getState()
      .createProject("/tmp/roundtrip-project", "Roundtrip", { dataSource: "dicom" });

    // Sync processing config into project
    const config = {
      subjects: ["sub-001", "sub-002"],
      modules: ["structural", "asl"],
      selectedProfileId: "profile-1",
      workers: 4,
    } as any;

    useProjectStore.getState().syncProcessingState({
      config,
      processingPhase: "idle",
    });

    // Save project — this serializes processingConfig into the .easl JSON
    await useProjectStore.getState().saveProject();

    const savedJson = lastAtomicProjectBytes();
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
    await useProjectStore
      .getState()
      .createProject("/tmp/phase-roundtrip", "Phase Roundtrip", { dataSource: "dicom" });

    useProjectStore.getState().syncProcessingState({
      config: null,
      processingPhase: "running",
    });

    await useProjectStore.getState().saveProject();

    const reloadJson = lastAtomicProjectBytes();
    const saved = JSON.parse(reloadJson);
    expect(saved.uiState.processing?.currentPhase).toBe("running");

    // Reload
    vi.mocked(readTextFile).mockResolvedValue(reloadJson);
    useProjectStore.setState({ project: null, loaded: false, isDirty: false });
    await useProjectStore.getState().loadProject("/tmp/phase-roundtrip/project.easl");

    expect(useProjectStore.getState().project?.uiState.processing?.currentPhase).toBe("running");
  });

  it("does not persist null config as null in JSON (omits field)", async () => {
    await useProjectStore
      .getState()
      .createProject("/tmp/null-roundtrip", "Null Roundtrip", { dataSource: "dicom" });

    // Don't sync any processing state — processingConfig should be undefined
    await useProjectStore.getState().saveProject();

    const savedJson = lastAtomicProjectBytes();
    const saved = JSON.parse(savedJson);

    // processingConfig should not be present or be undefined
    expect(saved.uiState.processing?.config).toBeUndefined();
  });
});
