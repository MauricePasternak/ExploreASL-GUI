import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { activateProjectLease, resetProjectLifecycleForTests } from "./projectLifecycle";
import { transitionProjectRuntime } from "./projectCoordinator";

afterEach(() => {
  resetProjectLifecycleForTests();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
});

describe("project coordinator", () => {
  it("preserves project A when shutdown fails", async () => {
    const projectA = DEFAULT_PROJECT_FILE("a", "A", "/a");
    const projectB = DEFAULT_PROJECT_FILE("b", "B", "/b");
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: false });
    useImportStore.setState({ sourceDataPath: "/a/source", importLog: ["A"] });
    activateProjectLease("a", "/a");

    await expect(
      transitionProjectRuntime(projectB, false, {
        shutdownRuntime: async () => ({
          success: false,
          importProcess: { success: false, error: "cannot stop import" },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        }),
      }),
    ).rejects.toThrow(/cannot stop import/i);

    expect(useProjectStore.getState().project?.projectMeta.id).toBe("a");
    expect(useImportStore.getState()).toMatchObject({
      sourceDataPath: "/a/source",
      importLog: ["A"],
    });
  });

  it("stops, resets, then hydrates project B", async () => {
    const order: string[] = [];
    const projectA = DEFAULT_PROJECT_FILE("a", "A", "/a");
    const projectB = {
      ...DEFAULT_PROJECT_FILE("b", "B", "/b"),
      mappingState: { sourceDataPath: "./source" },
    };
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: false });
    useImportStore.setState({ importLog: ["A"] });
    activateProjectLease("a", "/a");
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (!state.project) order.push("reset");
      if (state.project?.projectMeta.id === "b") order.push("hydrate");
    });

    await transitionProjectRuntime(projectB, true, {
      shutdownRuntime: async () => {
        order.push("shutdown");
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      },
      cleanupListeners: () => order.push("listeners"),
    });
    unsubscribe();

    expect(order).toEqual(["shutdown", "listeners", "reset", "hydrate"]);
    expect(useProjectStore.getState()).toMatchObject({
      project: { projectMeta: { id: "b" } },
      isDirty: true,
    });
    expect(useImportStore.getState()).toMatchObject({ sourceDataPath: "./source", importLog: [] });
  });

  it("serializes concurrent replacements", async () => {
    const order: string[] = [];
    let release!: () => void;
    const projectB = DEFAULT_PROJECT_FILE("b", "B", "/b");
    const projectC = DEFAULT_PROJECT_FILE("c", "C", "/c");
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("a", "A", "/a"),
      loaded: true,
    });
    activateProjectLease("a", "/a");

    const first = transitionProjectRuntime(projectB, false, {
      shutdownRuntime: async () => {
        order.push("first-start");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        order.push("first-end");
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      },
    });
    const second = transitionProjectRuntime(projectC, false, {
      shutdownRuntime: async () => {
        order.push("second");
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      },
    });

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("c");
  });
});
