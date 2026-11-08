import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  activateProjectLease,
  captureProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import {
  attachRun,
  confirmProcessingWorkersStopped,
  getActiveRun,
  loadLockStatus,
  projectProcessingSnapshot,
  reserveProcessingRun,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
} from "./processingEvents";
import {
  processingProfile,
  processingReplay,
  processingSnapshot,
} from "../test/processingFixtures";
import { projectView } from "../schemas/project";
import { projectFixture } from "../test/projectFixtures";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));
const request = {
  requestId: "12345678-1234-4234-8234-123456789010",
  projectId: "project-1",
  selectedModules: ["structural"] as "structural"[],
  selectedSubjectSessions: ["sub-001_01"],
  executionProfile: processingProfile,
  dataPar: {},
  participants: { correction: false, subjectRows: [], metadataGroups: [] },
  workers: 1,
  rerunBids2legacy: false,
};

describe("processing native IPC", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.clearAllMocks();
    listeners.clear();
    resetProjectLifecycleForTests();
    await useProcessingStore.getState().resetProcessing();
    useProjectStore.setState({ project: projectView(projectFixture()) });
    activateProjectLease("project-1", "/project");
  });
  it("sends immutable request and admission and decodes current or historical reservations", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ kind: "current", snapshot: processingSnapshot() })
      .mockResolvedValueOnce({ kind: "historical", replay: processingReplay() });
    expect((await reserveProcessingRun(request, "/project")).kind).toBe("current");
    expect((await reserveProcessingRun(request, "/project")).kind).toBe("historical");
    expect(invoke).toHaveBeenCalledWith("reserve_processing_run", {
      request,
      admission: { projectRoot: "/project" },
    });
  });
  it("uses exact native run commands and nullable discovery", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processingSnapshot())
      .mockResolvedValueOnce(processingSnapshot())
      .mockResolvedValueOnce(processingSnapshot());
    expect(await getActiveRun()).toBeNull();
    await attachRun("run");
    await runProcessingPipeline("run");
    await stopProcessingPipeline("run");
    expect(invoke).toHaveBeenNthCalledWith(2, "attach_run", { runId: "run" });
    expect(invoke).toHaveBeenNthCalledWith(3, "run_pipeline", { runId: "run" });
    expect(invoke).toHaveBeenNthCalledWith(4, "kill_pipeline", { runId: "run" });
  });
  it("requires advancing exact stopped-worker confirmation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(processingSnapshot({ revision: 2 }));
    await expect(
      confirmProcessingWorkersStopped(processingSnapshot().runId, 1),
    ).resolves.toMatchObject({ revision: 2 });
  });
  it("drops confirmation snapshots from a stale project lease", async () => {
    const interrupted = processingSnapshot({
      lifecycle: "interrupted",
      revision: 2,
      availableAction: "confirmStopped",
    });
    useProcessingStore.getState().bindRunSnapshot(interrupted);
    const staleLease = activateProjectLease("project-1", "/project");
    activateProjectLease("project-2", "/other");

    await projectProcessingSnapshot(
      processingSnapshot({
        lifecycle: "cancelled",
        revision: 3,
        availableAction: "acknowledge",
        terminalRevision: 3,
        terminalResult: "cancelled",
      }),
      staleLease,
    );

    expect(useProcessingStore.getState().snapshot).toMatchObject({
      runId: interrupted.runId,
      revision: 2,
      availableAction: "confirmStopped",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("admits only exact-run status, lock, and increasing lifecycle events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = processingSnapshot({ lifecycle: "preparing", revision: 1 });
    useProcessingStore.getState().bindRunSnapshot(run);
    expect(useProcessingStore.getState().attachmentGeneration).toBe(
      captureProjectLease()?.generation,
    );
    const cleanup = await setupProcessingListeners(run.runId);
    for (const row of [
      {
        event: "StatusFileCreated",
        payload: {
          runId: run.runId,
          module: "xASL_module_ASL",
          subjectSession: "sub-001_01",
          run: "01",
          stepCode: "010",
        },
        assertion: () =>
          expect(useProcessingStore.getState().subjectStatuses[0]).toMatchObject({
            module: "asl",
            run: "1",
            status: "incomplete",
          }),
      },
      {
        event: "LockCreated",
        payload: {
          runId: run.runId,
          module: "xASL_module_ASL",
          subjectSession: "sub-001_01",
          run: "01",
        },
        assertion: () =>
          expect(useProcessingStore.getState().subjectStatuses[0]).toMatchObject({ locked: true }),
      },
      {
        event: "LockRemoved",
        payload: {
          runId: run.runId,
          module: "xASL_module_ASL",
          subjectSession: "sub-001_01",
          run: "01",
        },
        assertion: () =>
          expect(useProcessingStore.getState().subjectStatuses[0]).toMatchObject({ locked: false }),
      },
      {
        event: "LockCreated",
        payload: {
          runId: "other",
          module: "xASL_module_ASL",
          subjectSession: "sub-ignored_01",
          run: "01",
        },
        assertion: () => expect(useProcessingStore.getState().subjectStatuses).toHaveLength(1),
      },
      {
        event: "LockRemoved",
        payload: { module: "xASL_module_ASL", subjectSession: "sub-ignored_01", run: "01" },
        assertion: () => expect(useProcessingStore.getState().subjectStatuses).toHaveLength(1),
      },
    ]) {
      listeners.get(row.event)?.({ payload: row.payload });
      row.assertion();
    }
    listeners.get("ProcessingLifecycleSnapshot")?.({
      payload: processingSnapshot({ runId: run.runId, revision: 2, lifecycle: "running" }),
    });
    await vi.waitFor(() => expect(useProcessingStore.getState().processingPhase).toBe("running"));
    listeners.get("ProcessingLifecycleSnapshot")?.({
      payload: processingSnapshot({ runId: run.runId, revision: 1, lifecycle: "preparing" }),
    });
    expect(useProcessingStore.getState().snapshot?.revision).toBe(2);

    activateProjectLease("project-2", "/other");
    listeners.get("LockCreated")?.({
      payload: {
        runId: run.runId,
        module: "xASL_module_Structural",
        subjectSession: "sub-ignored_01",
      },
    });
    listeners.get("ProcessingLifecycleSnapshot")?.({
      payload: processingSnapshot({ runId: run.runId, revision: 3, lifecycle: "finalizing" }),
    });
    await Promise.resolve();
    expect(useProcessingStore.getState()).toMatchObject({
      processingPhase: "running",
      snapshot: { revision: 2 },
      subjectStatuses: [expect.objectContaining({ subjectSession: "sub-001_01" })],
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[processing] Malformed run event ignored",
      expect.objectContaining({ channel: "LockRemoved", runId: run.runId }),
    );
    cleanup();
  });
  it("normalizes lock scans", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        subjectSession: "sub-001_01",
        module: "xASL_module_ASL",
        run: "01",
        status: "pending",
        completedSteps: [],
        locked: true,
      },
    ]);
    await expect(loadLockStatus("/project")).resolves.toMatchObject([{ module: "asl", run: "1" }]);
  });
  it("warns once per malformed attached-run channel, never dumps payloads or warns on foreign/stale events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = processingSnapshot();
    useProcessingStore.getState().bindRunSnapshot(run);
    const cleanup = await setupProcessingListeners(run.runId);
    const malformed = { runId: run.runId, secret: "study data" };
    for (const channel of listeners.keys()) {
      listeners.get(channel)!({ payload: { ...malformed, runId: "foreign" } });
    }
    expect(warn).not.toHaveBeenCalled();
    for (const channel of listeners.keys()) {
      listeners.get(channel)!({ payload: malformed });
      listeners.get(channel)!({ payload: malformed });
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(
      "[processing] Malformed run event ignored",
      expect.objectContaining({
        runId: run.runId,
        projectGeneration: 1,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: expect.any(String), path: expect.any(Array) }),
        ]),
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("study data");
    cleanup();
    const nextCleanup = await setupProcessingListeners(run.runId);
    listeners.get("LockCreated")!({ payload: malformed });
    expect(warn).toHaveBeenCalledTimes(5);
    activateProjectLease("project-2", "/other");
    listeners.get("StatusFileCreated")!({ payload: malformed });
    expect(warn).toHaveBeenCalledTimes(5);
    nextCleanup();
  });
});
