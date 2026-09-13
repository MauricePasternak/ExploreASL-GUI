import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import { ProcessingRunSnapshotSchema } from "../schemas/processingSchemas";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import { processingSnapshot } from "../test/processingFixtures";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";

describe("native processing projection", () => {
  beforeEach(async () => {
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("project-1", "Project", "/project") });
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
  it("invalidates previous Population metadata only on accepted native execution commit", () => {
    useProjectStore.getState().setPopulationCompleted(true);
    const store = useProcessingStore.getState();
    store.bindRunSnapshot(processingSnapshot({ selectedModules: ["population"] }));
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      true,
    );
    store.reconcileRunSnapshot(
      processingSnapshot({
        revision: 2,
        selectedModules: ["population"],
        populationExecutionCommitted: true,
        executionCommitted: true,
      }),
    );
    expect(useProjectStore.getState().project?.uiState.processing?.population?.completed).toBe(
      false,
    );
  });
});
