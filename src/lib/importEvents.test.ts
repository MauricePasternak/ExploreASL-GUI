import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  order: [] as string[],
}));
const { invoke, listeners } = mocks;
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import {
  attachImportRun,
  clearImportListeners,
  confirmImportWorkerStopped,
  getActiveImportRun,
  launchImportRun,
  reserveImportRun,
  setupImportDiscoveryListeners,
  setupImportListeners,
} from "./importEvents";
import { useImportStore } from "../stores/importStore";
import { activateProjectLease, resetProjectLifecycleForTests } from "./projectLifecycle";

const snapshot = (
  lifecycle: "preparing" | "running" | "finalizing" | "completed" = "preparing",
  updatedAtMs = 2,
) => ({
  runId: "import-run-1",
  lifecycle,
  ownershipGeneration: 1,
  profileId: "profile-1",
  selectedSubjects: ["ONE"],
  createdAtMs: 1,
  updatedAtMs,
  subjectOutcomes: [],
  confirmationRequired: false,
});

describe("import run protocol", () => {
  beforeEach(() => {
    invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockImplementation(
      async (name: string, callback: (event: { payload: unknown }) => void) => {
        mocks.listeners.set(name, callback);
        return () => mocks.listeners.delete(name);
      },
    );
    listeners.clear();
    mocks.order.length = 0;
    resetProjectLifecycleForTests();
    activateProjectLease("project-1", "/project");
    useImportStore.getState().resetImport();
  });
  it("uses native reservation snapshots", async () => {
    invoke.mockResolvedValue(snapshot());
    await expect(
      reserveImportRun({
        subjectList: ["ONE"],
        relocationPlanId: "plan",
        profileId: "profile-1",
        preserveStaging: false,
      }),
    ).resolves.toMatchObject({ runId: "import-run-1" });
    expect(invoke).toHaveBeenCalledWith("reserve_import_run", expect.any(Object));
  });
  it("rejects malformed snapshot wire data", async () => {
    invoke.mockResolvedValue({ ...snapshot(), pid: 4 });
    await expect(attachImportRun("import-run-1")).rejects.toThrow();
  });
  it("confirms only the exact interrupted import run", async () => {
    invoke.mockResolvedValue({
      ...snapshot("completed"),
      lifecycle: "interrupted",
      terminalResult: "interrupted",
      confirmationRequired: false,
    });

    await expect(confirmImportWorkerStopped("import-run-1")).resolves.toMatchObject({
      runId: "import-run-1",
      confirmationRequired: false,
    });
    expect(invoke).toHaveBeenCalledWith("confirm_import_worker_stopped", { runId: "import-run-1" });

    invoke.mockResolvedValue({
      ...snapshot("completed"),
      runId: "other-run",
      terminalResult: "completed",
    });
    await expect(confirmImportWorkerStopped("import-run-1")).rejects.toThrow("exact interrupted");
  });
  it("ignores parser completion and accepts matching authoritative snapshot", async () => {
    useImportStore.getState().bindImportRunSnapshot(snapshot("running"));
    const cleanup = await setupImportListeners("import-run-1");
    listeners.get("import-structured-event")?.({
      payload: { runId: "import-run-1", ownershipGeneration: 1, type: "import_complete" },
    });
    expect(useImportStore.getState().importPhase).toBe("running");
    cleanup();
  });
  it("rejects stale run and ownership-generation diagnostics", async () => {
    useImportStore.getState().bindImportRunSnapshot(snapshot("running"));
    await setupImportListeners("import-run-1");
    listeners.get("import-raw-event")?.({
      payload: { runId: "other", ownershipGeneration: 1, line: "foreign" },
    });
    listeners.get("import-raw-event")?.({
      payload: { runId: "import-run-1", ownershipGeneration: 2, line: "stale" },
    });
    listeners.get("import-raw-event")?.({
      payload: { runId: "import-run-1", ownershipGeneration: 1, line: "current" },
    });
    await vi.waitFor(() => expect(useImportStore.getState().importLog).toEqual(["current"]));
  });
  it("batches raw logs, flushes section dividers immediately, and flushes remaining lines on cleanup", async () => {
    useImportStore.getState().bindImportRunSnapshot(snapshot("running"));
    const cleanup = await setupImportListeners("import-run-1");
    const raw = listeners.get("import-raw-event")!;
    raw({ payload: { runId: "import-run-1", ownershipGeneration: 1, line: "first" } });
    raw({
      payload: {
        runId: "import-run-1",
        ownershipGeneration: 1,
        line: "[ ===== section",
      },
    });
    expect(useImportStore.getState().importLog).toEqual(["first", "[ ===== section"]);

    raw({ payload: { runId: "import-run-1", ownershipGeneration: 1, line: "last" } });
    cleanup();
    expect(useImportStore.getState().importLog).toEqual(["first", "[ ===== section", "last"]);
  });
  it("replaces listener sets and cleans partial registration failures", async () => {
    useImportStore.getState().bindImportRunSnapshot(snapshot("running"));
    const first = await setupImportListeners("import-run-1");
    expect(listeners.size).toBe(3);
    await setupImportListeners("import-run-1");
    expect(listeners.size).toBe(3);
    first();
    clearImportListeners();
    expect(listeners.size).toBe(0);

    const partialUnlisten = vi.fn();
    mocks.listen
      .mockImplementationOnce(async () => partialUnlisten)
      .mockRejectedValueOnce(new Error("listener denied"));
    await expect(setupImportListeners("import-run-1")).rejects.toThrow("listener denied");
    expect(partialUnlisten).toHaveBeenCalledOnce();
  });
  it("prevents duplicate listener ownership when setup calls resolve out of order", async () => {
    const registrations: Array<{
      name: string;
      resolve: (unlisten: () => void) => void;
      unlisten: () => void;
    }> = [];
    mocks.listen.mockImplementation(
      (name: string) =>
        new Promise<() => void>((resolve) => {
          registrations.push({ name, resolve, unlisten: vi.fn<() => void>() });
        }),
    );

    const first = setupImportListeners("import-run-1");
    await vi.waitFor(() => expect(registrations).toHaveLength(1));
    const second = setupImportListeners("import-run-1");
    await vi.waitFor(() => expect(registrations).toHaveLength(2));

    // Resolve second setup completely before allowing obsolete first setup to
    // continue. First's installed listener must self-retire.
    registrations[1].resolve(registrations[1].unlisten);
    await vi.waitFor(() => expect(registrations).toHaveLength(3));
    registrations[2].resolve(registrations[2].unlisten);
    await vi.waitFor(() => expect(registrations).toHaveLength(4));
    registrations[3].resolve(registrations[3].unlisten);
    const secondCleanup = await second;
    registrations[0].resolve(registrations[0].unlisten);
    await vi.waitFor(() => expect(registrations).toHaveLength(5));
    registrations[4].resolve(registrations[4].unlisten);
    await vi.waitFor(() => expect(registrations).toHaveLength(6));
    registrations[5].resolve(registrations[5].unlisten);
    await vi.waitFor(() => expect(registrations[0].unlisten).toHaveBeenCalledOnce());
    await first;
    secondCleanup();
    expect(registrations[1].unlisten).toHaveBeenCalledOnce();
    expect(registrations[2].unlisten).toHaveBeenCalledOnce();
    expect(registrations[3].unlisten).toHaveBeenCalledOnce();
    expect(registrations[4].unlisten).toHaveBeenCalledOnce();
    expect(registrations[5].unlisten).toHaveBeenCalledOnce();
  });
  it("uses reserve, attach, and launch commands without frontend finalization authority", async () => {
    invoke.mockResolvedValue(snapshot());
    await reserveImportRun({
      subjectList: ["ONE"],
      relocationPlanId: "plan-1",
      profileId: "profile-1",
      preserveStaging: false,
    });
    await attachImportRun("import-run-1");
    await launchImportRun({
      runId: "import-run-1",
      stagingEntries: [],
      sourcestructureJson: {},
      studyparJson: {},
      executionProfile: {} as never,
      subjectList: ["ONE"],
      relocationPlanId: "plan-1",
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "reserve_import_run",
      "attach_import_run",
      "launch_import_run",
    ]);
  });

  it("uses discover-listen-attach race closure and rejects delayed old snapshots", async () => {
    invoke.mockResolvedValue(snapshot("running"));
    const discovered = await getActiveImportRun();
    expect(discovered?.runId).toBe("import-run-1");
    useImportStore.getState().bindImportRunSnapshot(discovered!);
    const cleanup = await setupImportListeners(discovered!.runId);
    await attachImportRun(discovered!.runId);
    listeners.get("import-run-snapshot")?.({
      payload: { ...snapshot("completed"), runId: "old-run", terminalResult: "completed" },
    });
    expect(useImportStore.getState().importPhase).toBe("running");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "get_active_import_run",
      "attach_import_run",
    ]);
    expect(invoke.mock.calls.some(([command]) => /clean|move|post.?process/i.test(command))).toBe(
      false,
    );
    cleanup();
  });

  it("installs the full listener set before discovery and replays matching raced diagnostics", async () => {
    mocks.listen.mockImplementation(
      async (name: string, callback: (event: { payload: unknown }) => void) => {
        mocks.order.push(`listen:${name}`);
        mocks.listeners.set(name, callback);
        return () => mocks.listeners.delete(name);
      },
    );
    invoke.mockImplementation(async (command: string) => {
      mocks.order.push(command);
      return snapshot("running");
    });

    const controller = await setupImportDiscoveryListeners();
    listeners.get("import-raw-event")?.({
      payload: { runId: "import-run-1", ownershipGeneration: 1, line: "raced" },
    });
    const discovered = await getActiveImportRun();
    useImportStore.getState().bindImportRunSnapshot(discovered!);
    controller.bindRun(discovered!.runId);
    await attachImportRun(discovered!.runId);

    expect(mocks.order).toEqual([
      "listen:import-run-snapshot",
      "listen:import-raw-event",
      "listen:import-structured-event",
      "get_active_import_run",
      "attach_import_run",
    ]);
    await vi.waitFor(() => expect(useImportStore.getState().importLog).toEqual(["raced"]));
    controller.cleanup();
  });

  it("buffers setup-raced snapshots, rejects delayed old responses, and never invokes post-processing", async () => {
    mocks.listen.mockImplementation(
      async (name: string, callback: (event: { payload: unknown }) => void) => {
        mocks.order.push(`listen:${name}`);
        mocks.listeners.set(name, callback);
        return () => mocks.listeners.delete(name);
      },
    );
    const controller = await setupImportDiscoveryListeners();
    listeners.get("import-run-snapshot")?.({ payload: snapshot("running") });
    // A discovery response from a replaced run must not become bound merely
    // because it arrives after listeners have started buffering.
    const current = snapshot("running");
    useImportStore.getState().bindImportRunSnapshot(current);
    controller.bindRun(current.runId);
    listeners.get("import-run-snapshot")?.({
      payload: { ...snapshot("completed"), runId: "old-run", terminalResult: "completed" },
    });

    expect(useImportStore.getState()).toMatchObject({
      activeRunId: "import-run-1",
      importPhase: "running",
    });
    expect(
      invoke.mock.calls.some(([command]) => /clean|move|relocat|post.?process/i.test(command)),
    ).toBe(false);
    controller.cleanup();
  });

  it("replays process exit during setup and rejects delayed pre-exit attachment state", async () => {
    const controller = await setupImportDiscoveryListeners();
    const discovered = snapshot("running", 2);
    useImportStore.getState().bindImportRunSnapshot(discovered);
    listeners.get("import-run-snapshot")?.({ payload: snapshot("finalizing", 4) });
    controller.bindRun(discovered.runId);
    // Attachment response was produced before process exit but arrived later.
    useImportStore.getState().reconcileImportRunSnapshot(snapshot("running", 4));

    expect(useImportStore.getState()).toMatchObject({
      activeRunId: "import-run-1",
      importPhase: "finalizing",
      nativeSnapshotUpdatedAtMs: 4,
    });
    controller.cleanup();
  });
});
