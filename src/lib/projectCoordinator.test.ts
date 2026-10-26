import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { error as logError } from "@tauri-apps/plugin-log";

import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";
import {
  activateProjectLease,
  isProjectWorkAccepted,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import { closeProjectRuntime, transitionProjectRuntime } from "./projectCoordinator";

const candidate = {
  candidateId: "candidate",
  projectId: "b",
  name: "B",
  rootPath: "/b",
  recoveredFromBackup: false,
  duplicatePath: null,
  movedFrom: null,
  setupRecovered: 0,
};

beforeEach(() => {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "save_project" || command === "get_project_snapshot") {
      const project = useProjectStore.getState().project!;
      return {
        ...projectFixture(
          project.projectMeta.id,
          project.projectMeta.name,
          project.projectMeta.rootPath,
        ),
        activationGeneration: project.activationGeneration,
      };
    }
    if (command === "activate_project") return projectFixture("b", "B", "/b");
    if (command === "get_active_import_run" || command === "get_active_run") return null;
    if (command === "read_import_status") return [];
    if (command === "shutdown_project_runtime")
      return {
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      };
    throw new Error(`Unexpected command ${command}`);
  });
});

afterEach(() => {
  resetProjectLifecycleForTests();
  useProjectStore.getState().cancelAutosave();
  useImportStore.getState().resetImport();
  useProjectStore.setState({ project: null, loaded: false, isDirty: false });
  vi.mocked(notifications.show).mockClear();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "shutdown_project_runtime") {
      return {
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      };
    }
    return null;
  });
});

describe("project coordinator", () => {
  it("preserves project A when shutdown fails", async () => {
    const snapshotA = projectFixture("a", "A", "/a");
    snapshotA.document.mappingState.sourceDataPath = "/a/source";
    const projectA = projectView(snapshotA);
    vi.mocked(invoke).mockResolvedValueOnce(snapshotA);
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: false });
    useImportStore.setState({ importLog: ["A"] });
    activateProjectLease("a", "/a");

    await expect(
      transitionProjectRuntime(
        candidate,
        {},
        {
          shutdownRuntime: async () => ({
            success: false,
            importProcess: { success: false, error: "cannot stop import" },
            processingWorkers: { success: true },
            lockWatcher: { success: true },
          }),
        },
      ),
    ).rejects.toThrow(/cannot stop import/i);

    expect(useProjectStore.getState().project?.projectMeta.id).toBe("a");
    expect(useProjectStore.getState().project?.mappingState.sourceDataPath).toBe("/a/source");
    expect(useImportStore.getState()).toMatchObject({
      importLog: ["A"],
    });
    expect(isProjectWorkAccepted()).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("get_project_snapshot", expect.anything());
  });

  it("stops, resets, then hydrates project B", async () => {
    const order: string[] = [];
    const projectA = projectView(projectFixture("a", "A", "/a"));
    const projectB = projectFixture("b", "B", "/b");
    projectB.document.mappingState = { sourceDataPath: "./source" };
    useProjectStore.setState({ project: projectA, loaded: true, isDirty: false });
    useImportStore.setState({ importLog: ["A"] });
    activateProjectLease("a", "/a");
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (!state.project) order.push("reset");
      if (state.project?.projectMeta.id === "b") order.push("hydrate");
    });

    await transitionProjectRuntime(
      candidate,
      {},
      {
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
        activateCandidate: async () => {
          order.push("native:/b");
          return projectB;
        },
      },
    );
    unsubscribe();

    expect(order).toEqual(["shutdown", "listeners", "native:/b", "reset", "hydrate"]);
    expect(useProjectStore.getState()).toMatchObject({
      project: { projectMeta: { id: "b" } },
      isDirty: false,
    });
    expect(useProjectStore.getState().project?.mappingState.sourceDataPath).toBe("./source");
    expect(useImportStore.getState().importLog).toEqual([]);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "save_project",
      "get_project_snapshot",
      "inspect_source_path",
      "get_active_import_run",
      "read_import_status",
      "get_active_run",
    ]);
  });

  it("serializes concurrent replacements", async () => {
    const order: string[] = [];
    let release!: () => void;
    useProjectStore.setState({
      project: projectView(projectFixture("a", "A", "/a")),
      loaded: true,
    });
    activateProjectLease("a", "/a");

    const first = transitionProjectRuntime(
      candidate,
      {},
      {
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
      },
    );
    const second = transitionProjectRuntime(
      { ...candidate, candidateId: "c", projectId: "c", rootPath: "/c" },
      {},
      {
        activateCandidate: async () => projectFixture("c", "C", "/c"),
        shutdownRuntime: async () => {
          order.push("second");
          return {
            success: true,
            importProcess: { success: true },
            processingWorkers: { success: true },
            lockWatcher: { success: true },
          };
        },
      },
    );

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("c");
  });

  it("retains native-persisted A results and its lease when candidate activation fails", async () => {
    const before = projectFixture("a", "A", "/a");
    const settled = structuredClone(before);
    settled.acceptedRevision = settled.persistedRevision = 1;
    settled.document.uiState.import = { completed: true, mostRecentConfig: null };
    settled.document.uiState.processing = { population: { completed: true } };
    vi.mocked(invoke)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({
        success: true,
        importProcess: { success: true },
        processingWorkers: { success: true },
        lockWatcher: { success: true },
      })
      .mockResolvedValueOnce(settled);
    const projectA = projectView(before);
    useProjectStore.setState({ project: projectA, loaded: true });
    activateProjectLease("a", "/a");

    await expect(
      transitionProjectRuntime(
        candidate,
        {},
        {
          activateCandidate: async () => Promise.reject(new Error("native denied")),
        },
      ),
    ).rejects.toThrow(/native denied/);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("a");
    expect(useProjectStore.getState().project).toEqual(projectView(settled));
    expect(isProjectWorkAccepted()).toBe(true);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "save_project",
      "shutdown_project_runtime",
      "get_project_snapshot",
    ]);
  });

  it.each([{ cleanupErrors: [] }, { cleanupErrors: ["native cleanup diagnostic"] }])(
    "reports relocation recovery without exposing diagnostics: %j",
    async ({ cleanupErrors }) => {
      const order: string[] = [];
      await transitionProjectRuntime(
        candidate,
        {},
        {
          activateCandidate: async () => {
            order.push("native");
            return {
              ...projectFixture("b", "B", "/b"),
              recovery: {
                preservedSubjects: ["A"],
                restoredSubjects: ["B"],
                cleanedSubjects: ["A", "B"],
                cleanupErrors,
              },
            };
          },
        },
      );

      expect(order).toEqual(["native"]);
      expect(vi.mocked(notifications.show)).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Import relocation recovery completed",
          color: cleanupErrors.length ? "orange" : "blue",
          message: cleanupErrors.length
            ? "Preserved: A. Restored: B. Some import cleanup remains pending. Check project directory access and free space, then reopen the project to retry. Consult the application log if this continues"
            : "Preserved: A. Restored: B",
        }),
      );
      if (cleanupErrors.length) {
        expect(logError).toHaveBeenCalledWith(
          "[PROJECT] Import relocation cleanup failed: native cleanup diagnostic",
        );
      }
      expect(useProjectStore.getState().project?.projectMeta.id).toBe("b");
    },
  );

  it("hydrates only after native recovery then reconciles import authority", async () => {
    const order: string[] = [];
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.project?.projectMeta.id === "b") order.push("hydrate");
    });
    await transitionProjectRuntime(
      candidate,
      {},
      {
        activateCandidate: async () => {
          order.push("native-recovery");
          return projectFixture("b", "B", "/b");
        },
        reconcileImportRun: async () => {
          order.push("import-reconcile");
        },
      },
    );
    unsubscribe();
    expect(order).toEqual(["native-recovery", "hydrate", "import-reconcile"]);
  });

  it("clears native root before resetting project stores", async () => {
    const order: string[] = [];
    useProjectStore.setState({
      project: projectView(projectFixture("a", "A", "/a")),
      loaded: true,
    });
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
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "save_project",
      "get_project_snapshot",
    ]);
  });

  it("retains A and permits retry when native root clearing fails", async () => {
    useProjectStore.setState({
      project: projectView(projectFixture("a", "A", "/a")),
      loaded: true,
    });
    activateProjectLease("a", "/a");
    await expect(
      closeProjectRuntime({
        clearActiveProject: async () => Promise.reject(new Error("clear denied")),
      }),
    ).rejects.toThrow(/clear denied/);
    expect(isProjectWorkAccepted()).toBe(true);
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("a");
  });

  it("rejects an expired renderer attachment without replacing B", async () => {
    const b = { ...projectFixture("b", "B", "/b"), activationGeneration: 2 };
    useProjectStore.setState({ project: projectView(b), loaded: true });
    activateProjectLease("b", "/b");
    vi.mocked(invoke).mockReset().mockRejectedValueOnce({ message: "Project activation expired" });
    await expect(transitionProjectRuntime(projectFixture("a", "A", "/a"))).rejects.toThrow(
      "Project activation expired",
    );
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("b");
    expect(isProjectWorkAccepted()).toBe(true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_project_snapshot", { generation: 1 });
  });

  it("rejects startProcessing during project switch before native reservation", async () => {
    let releaseShutdown!: () => void;
    let shutdownStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      shutdownStarted = resolve;
    });
    useProjectStore.setState({
      project: projectView(projectFixture("a", "A", "/a")),
      loaded: true,
    });
    activateProjectLease("a", "/a");
    useProcessingStore.setState({
      activeRunId: null,
      terminalRunId: null,
      processingPhase: "idle",
    });

    const transition = transitionProjectRuntime(
      candidate,
      {},
      {
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
        activateCandidate: async () => projectFixture("b", "B", "/b"),
      },
    );
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
