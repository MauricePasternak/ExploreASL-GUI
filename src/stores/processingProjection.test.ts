import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { ProcessingRunSnapshotSchema } from "../schemas/processingSchemas";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { processingSnapshot } from "../test/processingFixtures";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";
import { projectProcessingSnapshot } from "../lib/processingEvents";

describe("native processing projection", () => {
  beforeEach(async () => {
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    vi.clearAllMocks();
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
  });
  afterEach(() => resetProjectLifecycleForTests());

  it("accepts exact native snapshot without renderer worker or watcher authority", () => {
    expect(ProcessingRunSnapshotSchema.safeParse(processingSnapshot()).success).toBe(true);
  });
  it("rejects same-run stale revisions and foreign roots", () => {
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ lifecycle: "running", revision: 3 }));
    store.reconcileRunSnapshot(processingSnapshot({ revision: 2 }));
    expect(useProcessingStore.getState().processingPhase).toBe("running");
    store.reconcileRunSnapshot(
      processingSnapshot({ revision: 4, projectRoot: "/other", lifecycle: "cancelling" }),
    );
    expect(useProcessingStore.getState().processingPhase).toBe("running");
  });
  it("refreshes native Population metadata only on accepted execution commit, not progress", async () => {
    const accepted = projectFixture();
    accepted.document.uiState.processing = { population: { completed: true } };
    useProjectStore.getState().acceptSnapshot(accepted);
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ selectedModules: ["population"] }));
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      true,
    );
    await projectProcessingSnapshot(processingSnapshot({ revision: 2 }));
    expect(invoke).not.toHaveBeenCalled();
    const committed = projectFixture();
    committed.acceptedRevision = 1;
    committed.document.uiState.processing = { population: { completed: false } };
    vi.mocked(invoke).mockResolvedValueOnce(committed);
    await projectProcessingSnapshot(
      processingSnapshot({
        revision: 3,
        selectedModules: ["population"],
        populationExecutionCommitted: true,
        executionCommitted: true,
      }),
    );
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      false,
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("get_project_snapshot", { generation: 1 });
  });
});
