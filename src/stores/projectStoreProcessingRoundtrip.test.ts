import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFixture } from "../test/projectFixtures";
import { projectView } from "../schemas/project";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { useProcessingStore } from "./processingStore";
import { useProjectStore } from "./projectStore";

describe("processing config round-trip persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectLifecycleForTests();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
  });
  afterEach(() => {
    useProjectStore.getState().cancelAutosave();
    resetProjectLifecycleForTests();
  });

  it("submits selections and reads accepted config without a feature mirror", async () => {
    const config = {
      subjects: ["sub-001_01", "sub-002_01"],
      modules: ["structural", "asl"] as ("structural" | "asl")[],
      selectedProfileId: "profile-1",
      workers: 4,
    };
    const accepted = {
      ...projectFixture("project-1", "Project", "/project", {
        uiState: { processing: { config, currentPhase: "completed" } },
      }),
      acceptedRevision: 1,
    };
    const project = useProjectStore.getState().project!;
    project.uiState.processing = { config: { ...config, modules: [] } };
    const second = structuredClone(accepted);
    second.document.uiState.processing!.config!.workers = 2;
    second.acceptedRevision = 2;
    const third = structuredClone(second);
    third.document.uiState.processing!.config!.modules = ["structural"];
    third.acceptedRevision = 3;
    let release!: (value: typeof accepted) => void;
    vi.mocked(invoke)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third)
      .mockResolvedValueOnce({ ...third, persistedRevision: 3 });
    const { setConfig } = useProcessingStore.getState();
    const edits = [
      setConfig(config),
      setConfig((latest) => ({ ...latest!, workers: 2 })),
      setConfig((latest) => ({
        ...latest!,
        modules: latest!.modules.includes("asl")
          ? latest!.modules.filter((m) => m !== "asl")
          : [...latest!.modules, "asl"],
      })),
    ];
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    release(accepted);
    await Promise.all(edits);
    expect(vi.mocked(invoke).mock.calls[1]![1]).toMatchObject({
      edit: { config: second.document.uiState.processing!.config },
    });
    expect(vi.mocked(invoke).mock.calls[2]![1]).toMatchObject({
      edit: { config: third.document.uiState.processing!.config },
    });
    await useProjectStore.getState().saveProject();
    expect(useProjectStore.getState().project?.uiState.processing).toEqual({
      config: { ...config, modules: ["structural"], workers: 2 },
      currentPhase: "completed",
    });
    expect(invoke).toHaveBeenLastCalledWith("save_project", { generation: 1 });
    expect(useProcessingStore.getState()).not.toHaveProperty("config");
  });
});
