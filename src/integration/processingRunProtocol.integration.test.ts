import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  attachRun,
  finalizeProcessingRun,
  reserveProcessingRun,
  runProcessingPipeline,
  setupProcessingListeners,
} from "../lib/processingEvents";
import { activateProjectLease, resetProjectLifecycleForTests } from "../lib/projectLifecycle";
import type { ExecutionProfile } from "../schemas/executionProfile";
import type { ProcessConfig, ProcessingRunSnapshot } from "../schemas/processingSchemas";
import { useProcessingStore } from "../stores/processingStore";

type Listener = (event: { payload: unknown }) => Promise<void> | void;

afterEach(() => {
  resetProjectLifecycleForTests();
  useProcessingStore.setState({
    activeRunId: null,
    processingPhase: "idle",
    workerPids: [],
    subjectStatuses: [],
  });
  vi.clearAllMocks();
});

describe("processing run protocol integration", () => {
  it("admits one concurrent start, exposes early Finalizing truth, and drops queued obsolete events", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "exploreasl-processing-protocol-"));
    const sentinel = join(projectRoot, "sentinel.txt");
    await writeFile(sentinel, "unchanged");
    const listeners = new Map<string, Listener>();
    const mutations: string[] = [];
    let acceptedReservations = 0;
    let nativeRun: ProcessingRunSnapshot | null = null;
    const snapshot = (
      runId: string,
      lifecycle: ProcessingRunSnapshot["lifecycle"],
      workers: number[],
      exitEvidence: ProcessingRunSnapshot["exitEvidence"] = [],
    ): ProcessingRunSnapshot => ({
      runId,
      lifecycle,
      projectRoot,
      selectedModules: ["structural"],
      selectedSubjectSessions: ["sub-001_01"],
      startTime: 1,
      workers,
      exitEvidence,
      watcherOwned: false,
      ...(lifecycle === "completed" ? { terminalResult: "completed" as const } : {}),
    });

    vi.mocked(listen).mockImplementation(async (event, callback) => {
      listeners.set(event, callback as Listener);
      return () => listeners.delete(event);
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const payload = (args ?? {}) as { runId?: string; outcome?: "completed" | "failed" };
      switch (command) {
        case "reserve_processing_run":
          if (
            nativeRun &&
            !["completed", "failed", "cancelled", "interrupted"].includes(nativeRun.lifecycle)
          ) {
            throw new Error("native reservation conflict");
          }
          acceptedReservations += 1;
          nativeRun = snapshot(`run-${acceptedReservations}`, "preparing", []);
          return nativeRun;
        case "run_pipeline":
          expect(payload.runId).toBe(nativeRun?.runId);
          mutations.push("winning-launch");
          // Native registration and final-worker supervisor exit happen before IPC responds.
          nativeRun = snapshot(payload.runId!, "finalizing", [], [{ pid: 4242, exitCode: 0 }]);
          return nativeRun;
        case "attach_run":
          expect(payload.runId).toBe(nativeRun?.runId);
          return nativeRun;
        case "finalize_processing_run":
          expect(payload.runId).toBe(nativeRun?.runId);
          nativeRun = snapshot(payload.runId!, payload.outcome!, []);
          return nativeRun;
        default:
          throw new Error(`unexpected native command: ${command}`);
      }
    });

    try {
      const before = await readFile(sentinel, "utf8");
      const starts = await Promise.allSettled([
        reserveProcessingRun(["structural"], ["sub-001_01"]),
        reserveProcessingRun(["structural"], ["sub-001_01"]),
      ]);
      const reservation = starts.find(
        (start): start is PromiseFulfilledResult<ProcessingRunSnapshot> =>
          start.status === "fulfilled",
      )!.value;
      expect(starts.filter((start) => start.status === "fulfilled")).toHaveLength(1);
      expect(acceptedReservations).toBe(1);
      expect(mutations).toEqual([]);
      expect(await readFile(sentinel, "utf8")).toBe(before);

      const config: ProcessConfig = {
        subjects: ["sub-001_01"],
        modules: ["structural"],
        selectedProfileId: "profile",
        workers: 1,
      };
      const profile: ExecutionProfile = {
        id: "profile",
        type: "matlab",
        label: "MATLAB",
        matlabPath: join(projectRoot, "matlab"),
        exploreAslPath: join(projectRoot, "ExploreASL"),
      };
      const launch = await runProcessingPipeline(reservation.runId, config, profile);
      expect(launch).toMatchObject({
        runId: reservation.runId,
        lifecycle: "finalizing",
        workers: [],
        exitEvidence: [{ pid: 4242, exitCode: 0 }],
      });
      await expect(attachRun(reservation.runId)).resolves.toMatchObject({
        lifecycle: "finalizing",
        workers: [],
      });

      activateProjectLease("project", projectRoot);
      useProcessingStore.getState().bindRunSnapshot(launch);
      const oldCleanup = await setupProcessingListeners(reservation.runId);
      const queuedOldStatus = listeners.get("StatusFileCreated")!;
      const queuedOldExit = listeners.get("WorkerExited")!;

      await finalizeProcessingRun(reservation.runId, "completed");
      const replacement = await reserveProcessingRun(["structural"], ["sub-001_01"]);
      useProcessingStore
        .getState()
        .bindRunSnapshot({ ...replacement, lifecycle: "running", workers: [99] });
      await setupProcessingListeners(replacement.runId);

      queuedOldStatus({
        payload: {
          runId: reservation.runId,
          module: "xASL_module_Structural",
          subjectSession: "sub-001_01",
          stepCode: "060_Segment_T1w",
        },
      });
      await queuedOldExit({ payload: { runId: reservation.runId, pid: 99, exitCode: 0 } });
      expect(useProcessingStore.getState()).toMatchObject({
        activeRunId: replacement.runId,
        processingPhase: "running",
        workerPids: [99],
        subjectStatuses: [],
      });
      oldCleanup();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
