import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  attachRun,
  clearStaleLocksForRun,
  failProcessingRun,
  finalizeProcessingRun,
  getActiveRun,
  reserveProcessingRun,
  reconcileAndFinalizeIfNeeded,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
  stopWatcher,
  watchLockDir,
} from "./processingEvents";
import {
  activateProjectLease,
  invalidateProjectLease,
  resetProjectLifecycleForTests,
} from "./projectLifecycle";
import { useProcessingStore } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { DEFAULT_PROJECT_FILE } from "../schemas/project";
import type { ExecutionProfile } from "../schemas/executionProfile";
import type { ProcessConfig, ProcessingRunSnapshot } from "../schemas/processingSchemas";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const SNAPSHOT: ProcessingRunSnapshot = {
  runId: "processing-run-1",
  lifecycle: "running",
  projectRoot: "/test/project",
  selectedModules: ["structural"],
  selectedSubjectSessions: ["sub-001_01"],
  startTime: 1,
  workers: [100],
  exitEvidence: [],
  watcherOwned: false,
};
const CONFIG: ProcessConfig = {
  subjects: ["sub-001_01"],
  modules: ["structural"],
  selectedProfileId: "profile-1",
  workers: 2,
};
const PROFILE: ExecutionProfile = {
  id: "profile-1",
  type: "matlab",
  label: "MATLAB",
  matlabPath: "/usr/bin/matlab",
  exploreAslPath: "/opt/ExploreASL",
};

describe("processing run IPC clients", () => {
  beforeEach(() => vi.mocked(invoke).mockResolvedValue(SNAPSHOT));

  it("uses exact camelCase reservation and run-scoped control payloads", async () => {
    await reserveProcessingRun(["structural"], ["sub-001_01"]);
    await failProcessingRun("processing-run-1");
    await finalizeProcessingRun("processing-run-1", "completed");
    await stopProcessingPipeline("processing-run-1");
    await watchLockDir("processing-run-1");
    await stopWatcher("processing-run-1");
    await attachRun("processing-run-1");
    await clearStaleLocksForRun("processing-run-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "reserve_processing_run", {
      selectedModules: ["structural"],
      selectedSubjectSessions: ["sub-001_01"],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fail_processing_run", { runId: "processing-run-1" });
    expect(invoke).toHaveBeenNthCalledWith(3, "finalize_processing_run", {
      runId: "processing-run-1",
      outcome: "completed",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "kill_pipeline", { runId: "processing-run-1" });
    expect(invoke).toHaveBeenNthCalledWith(5, "watch_lock_dir", { runId: "processing-run-1" });
    expect(invoke).toHaveBeenNthCalledWith(6, "stop_watch_lock_dir", { runId: "processing-run-1" });
    expect(invoke).toHaveBeenNthCalledWith(7, "attach_run", { runId: "processing-run-1" });
    expect(invoke).toHaveBeenNthCalledWith(8, "clear_stale_locks_for_run", {
      runId: "processing-run-1",
    });
  });

  it("launches from run authority, never caller project root or PID array", async () => {
    await runProcessingPipeline("processing-run-1", CONFIG, PROFILE);
    expect(invoke).toHaveBeenCalledWith("run_pipeline", {
      runId: "processing-run-1",
      executionProfile: PROFILE,
      dataParJson: JSON.stringify({ x: {} }),
      bProcess: [true, false, false],
      workers: 1,
      subjectRegexp: "^(sub-001_01)$",
      rerunBids2legacy: false,
    });
  });

  it("parses nullable discovery and rejects malformed native snapshots", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(getActiveRun()).resolves.toBeNull();
    vi.mocked(invoke).mockResolvedValueOnce({ ...SNAPSHOT, runId: "" });
    await expect(attachRun("processing-run-1")).rejects.toThrow();
  });
});

describe("run and lease scoped processing listeners", () => {
  const listeners: Record<string, (event: { payload: unknown }) => Promise<void> | void> = {};
  beforeEach(() => {
    resetProjectLifecycleForTests();
    activateProjectLease("project-1", "/test/project");
    useProcessingStore.setState({
      activeRunId: "processing-run-1",
      processingPhase: "running",
      workerPids: [100],
      subjectStatuses: [],
    });
    vi.mocked(listen).mockImplementation(async (name, callback) => {
      listeners[name] = callback as (typeof listeners)[string];
      return () => {};
    });
    vi.mocked(invoke).mockResolvedValue(SNAPSHOT);
  });
  afterEach(() => {
    resetProjectLifecycleForTests();
    useProjectStore.setState({ project: null, loaded: false, isDirty: false });
    useProcessingStore.setState({
      activeRunId: null,
      processingPhase: "idle",
      workerPids: [],
      subjectStatuses: [],
    });
  });

  it("admits matching events and preserves GUI Run normalization", async () => {
    await setupProcessingListeners("processing-run-1");
    listeners.StatusFileCreated({
      payload: {
        runId: "processing-run-1",
        module: "xASL_module_ASL",
        subjectSession: "sub-001_01",
        stepCode: "060_Test",
        run: "ASL_01",
      },
    });
    expect(useProcessingStore.getState().subjectStatuses).toMatchObject([
      { module: "asl", run: "1" },
    ]);
  });

  it("fails closed for missing IDs, same-project old IDs, unknown workers, and queued old leases", async () => {
    await setupProcessingListeners("processing-run-1");
    listeners.StatusFileCreated({ payload: { module: "xASL_module_ASL", stepCode: "060_Test" } });
    listeners.StatusFileCreated({
      payload: { runId: "processing-run-old", module: "xASL_module_ASL", stepCode: "060_Test" },
    });
    await listeners.WorkerExited({ payload: { runId: "processing-run-1", pid: 999, exitCode: 0 } });
    expect(useProcessingStore.getState()).toMatchObject({ subjectStatuses: [], workerPids: [100] });

    invalidateProjectLease();
    activateProjectLease("project-1", "/test/project");
    listeners.StatusFileCreated({
      payload: { runId: "processing-run-1", module: "xASL_module_ASL", stepCode: "060_Test" },
    });
    expect(useProcessingStore.getState().subjectStatuses).toEqual([]);
  });

  it("renders native Cancelling immediately and rejects a stale lifecycle snapshot", async () => {
    await setupProcessingListeners("processing-run-1");
    listeners.ProcessingLifecycleSnapshot({
      payload: { ...SNAPSHOT, lifecycle: "cancelling" },
    });
    expect(useProcessingStore.getState()).toMatchObject({
      activeRunId: "processing-run-1",
      processingPhase: "cancelling",
    });

    listeners.ProcessingLifecycleSnapshot({
      payload: { ...SNAPSHOT, runId: "processing-run-old", lifecycle: "cancelled", workers: [] },
    });
    expect(useProcessingStore.getState().processingPhase).toBe("cancelling");
  });

  it("coalesces worker-event and launch-snapshot finalization into one provisional request", async () => {
    const finalizing = { ...SNAPSHOT, lifecycle: "finalizing" as const, workers: [] };
    const completed = {
      ...finalizing,
      lifecycle: "completed" as const,
      terminalResult: "completed" as const,
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/test/project"),
      loaded: true,
    });
    let releaseAttach!: () => void;
    const attachGate = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "attach_run") {
        await attachGate;
        return finalizing;
      }
      if (command === "read_lock_status") {
        return [
          {
            subjectSession: "sub-001_01",
            module: "xASL_module_Structural",
            status: "complete",
            completedSteps: [],
            locked: false,
          },
        ];
      }
      if (command === "finalize_processing_run") return completed;
      return null;
    });
    await setupProcessingListeners(SNAPSHOT.runId);
    const attachCallsBefore = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "attach_run").length;
    const finalizeCallsBefore = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "finalize_processing_run").length;

    const fromEvent = listeners.WorkerExited({
      payload: { runId: SNAPSHOT.runId, pid: 100, exitCode: 0 },
    });
    const fromLaunch = reconcileAndFinalizeIfNeeded(finalizing);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("attach_run", { runId: SNAPSHOT.runId }),
    );
    releaseAttach();
    await Promise.all([fromEvent, fromLaunch]);

    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "attach_run"),
    ).toHaveLength(attachCallsBefore + 1);
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "finalize_processing_run"),
    ).toHaveLength(finalizeCallsBefore + 1);
    expect(useProcessingStore.getState()).toMatchObject({
      activeRunId: null,
      terminalRunId: SNAPSHOT.runId,
      processingPhase: "completed",
      workerPids: [],
    });
  });

  it.each([
    ["missing", []],
    [
      "incomplete",
      [
        {
          subjectSession: "sub-001_01",
          module: "xASL_module_Structural",
          status: "incomplete",
          completedSteps: ["060_Segment_T1w"],
          locked: false,
        },
      ],
    ],
  ])("finalizes %s lock status as authoritative native Failed", async (_case, statuses) => {
    const finalizing = { ...SNAPSHOT, lifecycle: "finalizing" as const, workers: [] };
    const failed = {
      ...finalizing,
      lifecycle: "failed" as const,
      terminalResult: "failed" as const,
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/test/project"),
      loaded: true,
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "attach_run") return finalizing;
      if (command === "read_lock_status") return statuses;
      if (command === "finalize_processing_run") return failed;
      return null;
    });
    useProcessingStore.getState().bindRunSnapshot(finalizing);

    await reconcileAndFinalizeIfNeeded(finalizing);

    expect(invoke).toHaveBeenCalledWith("finalize_processing_run", {
      runId: SNAPSHOT.runId,
      outcome: "failed",
    });
    expect(useProcessingStore.getState()).toMatchObject({
      activeRunId: null,
      terminalRunId: SNAPSHOT.runId,
      processingPhase: "failed",
      workerPids: [],
    });
  });

  it("drops an obsolete finalization response and its terminal side effects", async () => {
    const populationFinalizing = {
      ...SNAPSHOT,
      lifecycle: "finalizing" as const,
      workers: [],
      selectedModules: ["population"],
    };
    const replacement = {
      ...SNAPSHOT,
      runId: "processing-run-2",
      workers: [200],
    };
    useProjectStore.setState({
      project: DEFAULT_PROJECT_FILE("project-1", "Project", "/test/project"),
      loaded: true,
    });
    let resolveFinalization!: (snapshot: ProcessingRunSnapshot) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "attach_run") return populationFinalizing;
      if (command === "read_lock_status") {
        return [
          {
            subjectSession: "",
            module: "xASL_module_Population",
            status: "complete",
            completedSteps: [],
            locked: false,
          },
        ];
      }
      if (command === "finalize_processing_run") {
        return new Promise((resolve) => {
          resolveFinalization = resolve;
        });
      }
      return null;
    });
    useProcessingStore.getState().bindRunSnapshot(populationFinalizing);
    const pending = reconcileAndFinalizeIfNeeded(populationFinalizing);
    await vi.waitFor(() => expect(resolveFinalization).toBeTypeOf("function"));

    useProcessingStore.getState().bindRunSnapshot(replacement);
    resolveFinalization({
      ...populationFinalizing,
      lifecycle: "completed",
      terminalResult: "completed",
    });
    await pending;

    expect(useProcessingStore.getState()).toMatchObject({
      activeRunId: replacement.runId,
      processingPhase: "running",
      workerPids: [200],
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "read_population_ready_mtime_for_run",
      expect.anything(),
    );
  });
});
