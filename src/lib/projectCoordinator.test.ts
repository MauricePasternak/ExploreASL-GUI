import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
import {
  activateProjectLease,
  isProjectWorkAccepted,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import { closeProjectRuntime, transitionProjectRuntime } from "./projectCoordinator";

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
      setActiveProject: async (root) => {
        order.push(`native:${root}`);
      },
    });
    unsubscribe();

    expect(order).toEqual(["shutdown", "listeners", "native:/b", "reset", "hydrate"]);
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

  it("keeps work admission closed when candidate native activation fails", async () => {
    const projectA = DEFAULT_PROJECT_FILE("a", "A", "/a");
    const projectB = DEFAULT_PROJECT_FILE("b", "B", "/b");
    useProjectStore.setState({ project: projectA, loaded: true });
    activateProjectLease("a", "/a");

    await expect(
      transitionProjectRuntime(projectB, false, {
        setActiveProject: async () => Promise.reject(new Error("native denied")),
      }),
    ).rejects.toThrow(/native denied/);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("a");
    expect(isProjectWorkAccepted()).toBe(false);
  });

  it("clears native root before resetting project stores", async () => {
    const order: string[] = [];
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("a", "A", "/a"), loaded: true });
    activateProjectLease("a", "/a");
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (!state.project) order.push("reset");
    });
    await closeProjectRuntime({
      shutdownRuntime: async () => ({
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      }),
      cleanupListeners: () => order.push("listeners"),
      clearActiveProject: async () => {
        order.push("native-clear");
      },
    });
    unsubscribe();
    expect(order).toEqual(["listeners", "native-clear", "reset"]);
  });

  it("keeps admission closed when native root clearing fails", async () => {
    useProjectStore.setState({ project: DEFAULT_PROJECT_FILE("a", "A", "/a"), loaded: true });
    activateProjectLease("a", "/a");
    await expect(
      closeProjectRuntime({
        clearActiveProject: async () => Promise.reject(new Error("clear denied")),
      }),
    ).rejects.toThrow(/clear denied/);
    expect(isProjectWorkAccepted()).toBe(false);
  });

  it("rejects startProcessing during project switch before native reservation", async () => {
    let releaseShutdown!: () => void;
    let shutdownStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      shutdownStarted = resolve;
    });
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("a", "A", "/a"),
      loaded: true,
    });
    activateProjectLease("a", "/a");
    useProcessingStore.setState({
      activeRunId: null,
      terminalRunId: null,
      processingPhase: "idle",
      workerPids: [],
    });

    const transition = transitionProjectRuntime(DEFAULT_PROJECT_FILE("b", "B", "/b"), false, {
      shutdownRuntime: async () => {
        shutdownStarted();
        await new Promise<void>((resolve) => {
          releaseShutdown = resolve;
        });
        return {
          success: true,
          importProcess: { success: true },
          processingWorkers: { success: true },
          lockWatcher: { success: true },
        };
      },
      cleanupListeners: () => undefined,
      setActiveProject: async () => undefined,
    });
    await started;

    expect(() => useProcessingStore.getState().startProcessing()).toThrow(/transition/i);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("reserve_processing_run", expect.anything());
    expect(useProcessingStore.getState()).toMatchObject({
      activeRunId: null,
      processingPhase: "idle",
    });

    releaseShutdown();
    await transition;
  });
});
