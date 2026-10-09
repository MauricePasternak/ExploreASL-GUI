import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import type { ImportRunSnapshot } from "../schemas/importSchemas";
import { useImportStore } from "../stores/importStore";
import { useProjectStore } from "../stores/projectStore";
import { closeProjectRuntime } from "./projectCoordinator";
import {
  reconcileImportRunForActivation,
  reconcileImportTerminal,
} from "./importTerminalCoordinator";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";

const realSaveProject = useProjectStore.getState().saveProject;

const terminal = (
  runId = "import-run-1",
  lifecycle: "completed" | "failed" | "interrupted" = "completed",
): ImportRunSnapshot => ({
  runId,
  lifecycle,
  ownershipGeneration: 3,
  profileId: "profile-1",
  selectedSubjects: ["ONE"],
  createdAtMs: 1,
  updatedAtMs: 2,
  exitEvidence: { exitCode: 0, successful: true },
  subjectOutcomes: [
    {
      subject: "ONE",
      outcome: "committed",
      readyLockVerified: true,
      rawdataVerified: true,
      committed: true,
    },
  ],
  relocationOutcome: {
    planId: "plan-1",
    generation: 3,
    subjects: [{ subject: "ONE", status: "committed", phase: "committed", message: null }],
    stagingCleanupComplete: true,
  },
  terminalResult: lifecycle,
  confirmationRequired: false,
});

describe("import terminal coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectLifecycleForTests();
    useImportStore.getState().resetImport();
    const project = projectView(projectFixture());
    useProjectStore.setState({
      project,
      loaded: true,
      isDirty: false,
      saveProject: realSaveProject,
    });
    activateProjectLease("project-1", "/project");
    vi.mocked(invoke).mockResolvedValue(projectFixture());
    useImportStore.getState().bindImportRunSnapshot(terminal());
  });

  afterEach(() => {
    invalidateProjectLease();
  });

  it("retains replay and never acknowledges when revision-safe save fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));

    await expect(reconcileImportTerminal("import-run-1")).rejects.toThrow("disk full");

    expect(invoke).not.toHaveBeenCalledWith("acknowledge_import_run", expect.anything());
    expect(useImportStore.getState()).toMatchObject({
      terminalRunId: "import-run-1",
      importRunError: expect.stringContaining("terminal reconciliation"),
    });
  });

  it("retains replay, reports acknowledgement failure, and permits retry", async () => {
    useProjectStore.setState({ saveProject: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("ack denied"))
      .mockResolvedValueOnce(projectFixture());

    await expect(reconcileImportTerminal("import-run-1")).rejects.toThrow("ack denied");
    expect(useImportStore.getState().terminalRunId).toBe("import-run-1");
    expect(useImportStore.getState().importRunError).toContain("ack denied");
    await expect(reconcileImportTerminal("import-run-1")).resolves.toBeUndefined();
    expect(useImportStore.getState().terminalRunId).toBeNull();
  });

  it("ignores stale run IDs and expired project leases", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ saveProject });
    const staleLease = activateProjectLease("project-1", "/project");
    activateProjectLease("project-1", "/project");

    await reconcileImportTerminal("other-run");
    await reconcileImportTerminal("import-run-1", staleLease);

    expect(saveProject).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("blocks interrupted confirmation-required snapshots from live and activation reconciliation", async () => {
    const confirmationRequired = {
      ...terminal("interrupted-run", "interrupted"),
      confirmationRequired: true,
    };
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ saveProject });
    useImportStore.getState().bindImportRunSnapshot(confirmationRequired);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "get_active_import_run" ? confirmationRequired : undefined,
    );

    await reconcileImportTerminal(confirmationRequired.runId);
    await reconcileImportRunForActivation();

    expect(saveProject).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("acknowledge_import_run", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("reconcile_import_result", expect.anything());
    expect(useImportStore.getState().terminalRunId).toBe(confirmationRequired.runId);
  });

  it("project close waits for registered terminal save and acknowledgement", async () => {
    const order: string[] = [];
    let release!: () => void;
    useProjectStore.setState({
      saveProject: vi.fn(async () => {
        order.push("flush");
      }),
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "reconcile_import_result") {
        order.push("reconcile-start");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        order.push("reconcile-end");
        return projectFixture();
      }
      if (command === "get_project_snapshot") {
        order.push("refresh");
        return projectFixture();
      }
      return null;
    });

    const reconciliation = reconcileImportTerminal("import-run-1");
    const close = closeProjectRuntime({
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
      clearActiveProject: async () => {
        order.push("clear");
      },
    });
    await vi.waitFor(() => expect(order).toContain("reconcile-start"));
    release();
    await Promise.all([reconciliation, close]);

    expect(order.indexOf("reconcile-end")).toBeLessThan(order.indexOf("shutdown"));
    expect(order.slice(-4)).toEqual(["shutdown", "refresh", "listeners", "clear"]);
    expect(order.filter((step) => step === "flush")).toHaveLength(1);
  });

  it("activation replay reconciles, saves, then acknowledges without Step 5", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({ saveProject });
    useImportStore.getState().resetImport();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_active_import_run") return terminal("replayed-run");
      return projectFixture();
    });

    await expect(reconcileImportRunForActivation()).resolves.toMatchObject({
      runId: "replayed-run",
    });

    expect(saveProject).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("reconcile_import_result", {
      runId: "replayed-run",
      generation: 1,
    });
    expect(useImportStore.getState().terminalRunId).toBeNull();
  });

  it.each([
    ["completed", "completed"],
    ["failed", "failed"],
    ["interrupted", "interrupted"],
  ] as const)(
    "reconciles and acknowledges replayed %s authority after its matching save",
    async (lifecycle, result) => {
      const order: string[] = [];
      useProjectStore.setState({
        saveProject: vi.fn(async () => {
          order.push(`save:${result}`);
        }),
      });
      useImportStore.getState().resetImport();
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_active_import_run")
          return terminal(`replayed-${lifecycle}`, lifecycle);
        if (command === "reconcile_import_result") order.push(`reconcile:${result}`);
        return projectFixture();
      });

      await reconcileImportRunForActivation();

      expect(order).toEqual([`reconcile:${result}`]);
      expect(useImportStore.getState().terminalRunId).toBeNull();
      expect(useImportStore.getState().importPhase).toBe(lifecycle);
    },
  );

  it("never acknowledges a terminal result after project switch during save", async () => {
    let releaseSave!: () => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSave = () => resolve(projectFixture());
        }),
    );
    const reconciliation = reconcileImportTerminal("import-run-1");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const replacement = projectView(projectFixture("project-2", "Other", "/other"));
    useProjectStore.setState({ project: replacement });
    activateProjectLease("project-2", "/other");
    releaseSave();
    await reconciliation;
    expect(invoke).not.toHaveBeenCalledWith("acknowledge_import_run", expect.anything());
    expect(useImportStore.getState().terminalRunId).toBe("import-run-1");
    expect(useProjectStore.getState().project?.projectMeta.id).toBe("project-2");
  });
});
