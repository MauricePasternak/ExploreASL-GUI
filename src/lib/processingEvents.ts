/** Tauri processing-run protocol clients and run-scoped event listeners. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { ExecutionProfile } from "../schemas/executionProfile";
import {
  LockCreatedPayloadSchema,
  LockRemovedPayloadSchema,
  ProcessingLifecycleSnapshotSchema,
  ProcessingRunSnapshotSchema,
  StatusFileCreatedPayloadSchema,
  WorkerExitedPayloadSchema,
  type LockCreatedPayload,
  type LockRemovedPayload,
  type ProcessConfig,
  type ProcessingRunSnapshot,
  type ProcessingTerminalResult,
  type StatusFileCreatedPayload,
  type SubjectInfo,
  type SubjectModuleStatus,
  type WorkerExitedPayload,
} from "../schemas/processingSchemas";
import { modulesToBProcess, PROCESSING_MODULES } from "../schemas/processingSchemas";
import type { DataParJson } from "./assembleDataPar";
import { aslRunsEqual, normalizeAslRunId } from "./aslRun";
import { captureProjectLease, isCurrentProjectLease } from "./projectLifecycle";
import { generateSubjectRegexp } from "./subjectMatching";
import { useProjectStore } from "../stores/projectStore";
import { useProcessingStore } from "../stores/processingStore";

export type {
  LockCreatedPayload,
  LockRemovedPayload,
  ProcessingRunSnapshot,
  StatusFileCreatedPayload,
  WorkerExitedPayload,
};

// Finalization can be requested by a WorkerExited callback and a launch/attach
// reconciliation racing across IPC. One native run gets one provisional flow.
const finalizingRunIds = new Set<string>();

const RUST_MODULE_MAP: Record<string, (typeof PROCESSING_MODULES)[number]> = {
  xASL_module_Structural: "structural",
  xASL_module_ASL: "asl",
  xASL_module_Population: "population",
};

export function mapModuleName(rustName: string): (typeof PROCESSING_MODULES)[number] | undefined {
  if (rustName in RUST_MODULE_MAP) return RUST_MODULE_MAP[rustName];
  if ((PROCESSING_MODULES as readonly string[]).includes(rustName)) {
    return rustName as (typeof PROCESSING_MODULES)[number];
  }
  return undefined;
}

function parseSnapshot(value: unknown): ProcessingRunSnapshot {
  return ProcessingRunSnapshotSchema.parse(value);
}

export async function reserveProcessingRun(
  selectedModules: string[],
  selectedSubjectSessions: string[],
): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(
    await invoke("reserve_processing_run", { selectedModules, selectedSubjectSessions }),
  );
}

export async function failProcessingRun(runId: string): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(await invoke("fail_processing_run", { runId }));
}

export async function finalizeProcessingRun(
  runId: string,
  outcome: Extract<ProcessingTerminalResult, "completed" | "failed">,
): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(await invoke("finalize_processing_run", { runId, outcome }));
}

export async function getActiveRun(): Promise<ProcessingRunSnapshot | null> {
  const response = await invoke<unknown>("get_active_run");
  return response === null ? null : parseSnapshot(response);
}

export async function attachRun(runId: string): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(await invoke("attach_run", { runId }));
}

export async function runProcessingPipeline(
  runId: string,
  config: ProcessConfig,
  profile: ExecutionProfile,
  dataPar: DataParJson = { x: {} },
): Promise<ProcessingRunSnapshot> {
  const workers =
    config.subjects.length > 0 ? Math.min(config.workers, config.subjects.length) : config.workers;
  return parseSnapshot(
    await invoke("run_pipeline", {
      runId,
      executionProfile: profile,
      dataParJson: JSON.stringify(dataPar),
      bProcess: modulesToBProcess(config.modules),
      workers,
      // Rust derives authority from reservation, but command compatibility still
      // requires this exact argument.
      subjectRegexp: generateSubjectRegexp(config.subjects),
      rerunBids2legacy: config.rerunBids2Legacy ?? false,
    }),
  );
}

export async function stopProcessingPipeline(runId: string): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(await invoke("kill_pipeline", { runId }));
}

export async function watchLockDir(runId: string): Promise<ProcessingRunSnapshot> {
  return parseSnapshot(await invoke("watch_lock_dir", { runId }));
}

export async function stopWatcher(runId: string): Promise<void> {
  await invoke("stop_watch_lock_dir", { runId });
}

export async function loadSubjects(
  projectRoot: string,
  dataSource?: "dicom" | "bids",
): Promise<SubjectInfo[]> {
  return invoke<SubjectInfo[]>("list_subjects", { projectRoot, dataSource: dataSource ?? null });
}

export async function clearStaleLocksForRun(runId: string): Promise<void> {
  await invoke("clear_stale_locks_for_run", { runId });
}

export async function loadLockStatus(projectRoot: string): Promise<SubjectModuleStatus[]> {
  const raw = await invoke<SubjectModuleStatus[]>("read_lock_status", { projectRoot });
  return raw
    .map((entry) => {
      const module = mapModuleName(entry.module as string);
      if (!module) return null;
      return {
        ...entry,
        subjectSession: entry.subjectSession ?? "",
        module,
        run: entry.run != null ? normalizeAslRunId(entry.run) : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null) as SubjectModuleStatus[];
}

function isAttachedRunCurrent(
  runId: string,
  lease: ReturnType<typeof captureProjectLease>,
): boolean {
  return (
    Boolean(lease && isCurrentProjectLease(lease)) &&
    useProcessingStore.getState().activeRunId === runId
  );
}

function isTerminalRunCurrent(
  runId: string,
  lease: ReturnType<typeof captureProjectLease>,
): boolean {
  return (
    Boolean(lease && isCurrentProjectLease(lease)) &&
    useProcessingStore.getState().terminalRunId === runId
  );
}

async function finalizeCurrentRun(
  runId: string,
  lease: ReturnType<typeof captureProjectLease>,
): Promise<void> {
  if (!isAttachedRunCurrent(runId, lease)) return;
  if (finalizingRunIds.has(runId)) return;
  finalizingRunIds.add(runId);
  try {
    const snapshot = await attachRun(runId);
    if (!isAttachedRunCurrent(runId, lease)) return;
    if (snapshot.runId !== runId) return;
    useProcessingStore.getState().reconcileRunSnapshot(snapshot);
    if (snapshot.lifecycle !== "finalizing") return;

    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) return;
    try {
      await stopWatcher(runId);
      if (!isAttachedRunCurrent(runId, lease)) return;
      await clearStaleLocksForRun(runId);
      if (!isAttachedRunCurrent(runId, lease)) return;
      const statuses = await loadLockStatus(projectRoot);
      if (!isAttachedRunCurrent(runId, lease)) return;
      useProcessingStore.setState({ subjectStatuses: statuses });
      const outcome =
        statuses.length > 0 && statuses.every((status) => status.status === "complete")
          ? "completed"
          : "failed";
      const terminal = await finalizeProcessingRun(runId, outcome);
      if (!isAttachedRunCurrent(runId, lease) || terminal.runId !== runId) return;
      useProcessingStore.getState().reconcileRunSnapshot(terminal);
      if (terminal.lifecycle === "completed" && terminal.selectedModules.includes("population")) {
        useProjectStore.getState().setPopulationCompleted(true);
        try {
          const mtime = await invoke<number | null>("read_population_ready_mtime_for_run", {
            runId,
          });
          if (isTerminalRunCurrent(runId, lease))
            useProjectStore.getState().setLastPopulationRunMtime(mtime);
        } catch (error) {
          if (isTerminalRunCurrent(runId, lease)) {
            console.warn("[manifest] mtime read failed", error);
            useProjectStore.getState().setLastPopulationRunMtime(null);
          }
        }
      }
    } catch (error) {
      // Native lifecycle remains authoritative. A local finalization error must not
      // invent a terminal phase.
      console.warn("[processing] finalization failed", error);
    }
  } finally {
    finalizingRunIds.delete(runId);
  }
}

/** Install callbacks bound to both one project lease and one native run. */
export async function setupProcessingListeners(runId: string): Promise<() => void> {
  if (!runId) throw new Error("Processing listeners require a run ID");
  const lease = captureProjectLease();
  const admitted = <T>(
    schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
    value: unknown,
  ): T | null => {
    const parsed = schema.safeParse(value);
    if (!parsed.success || !isAttachedRunCurrent(runId, lease)) return null;
    const payload = parsed.data! as T & { runId: string };
    return payload.runId === runId ? (payload as T) : null;
  };

  const unlistenStatus = await listen<unknown>("StatusFileCreated", (event) => {
    const payload = admitted(StatusFileCreatedPayloadSchema, event.payload);
    if (!payload) return;
    const module = mapModuleName(payload.module);
    if (!module) return;
    const normalizedRun = payload.run != null ? normalizeAslRunId(payload.run) : undefined;
    const store = useProcessingStore.getState();
    const existing = store.subjectStatuses.find(
      (status) =>
        status.subjectSession === (payload.subjectSession ?? "") &&
        status.module === module &&
        aslRunsEqual(status.run, normalizedRun),
    );
    const complete = payload.stepCode === "999_ready";
    if (existing?.status === "complete" && !complete) return;
    store.updateSubjectStatus({
      subjectSession: payload.subjectSession ?? "",
      module,
      run: normalizedRun,
      status: complete ? "complete" : "incomplete",
      completedSteps: existing
        ? complete
          ? existing.completedSteps
          : [...new Set([...existing.completedSteps, payload.stepCode])]
        : complete
          ? []
          : [payload.stepCode],
      locked: complete ? false : (existing?.locked ?? false),
    });
  });

  const updateLock =
    (schema: typeof LockCreatedPayloadSchema | typeof LockRemovedPayloadSchema, locked: boolean) =>
    (event: { payload: unknown }) => {
      const payload = admitted(schema, event.payload);
      if (!payload) return;
      const module = mapModuleName(payload.module);
      if (!module) return;
      const normalizedRun = payload.run != null ? normalizeAslRunId(payload.run) : undefined;
      const store = useProcessingStore.getState();
      const existing = store.subjectStatuses.find(
        (status) =>
          status.subjectSession === (payload.subjectSession ?? "") &&
          status.module === module &&
          aslRunsEqual(status.run, normalizedRun),
      );
      if (!existing && !locked) return;
      if (existing?.status === "complete" && locked) return;
      store.updateSubjectStatus({
        subjectSession: payload.subjectSession ?? "",
        module,
        run: normalizedRun,
        status: existing?.status ?? "pending",
        completedSteps: existing?.completedSteps ?? [],
        locked,
      });
    };
  const unlistenLock = await listen<unknown>(
    "LockCreated",
    updateLock(LockCreatedPayloadSchema, true),
  );
  const unlistenLockRemoved = await listen<unknown>(
    "LockRemoved",
    updateLock(LockRemovedPayloadSchema, false),
  );
  const unlistenWorker = await listen<unknown>("WorkerExited", async (event) => {
    const payload = admitted(WorkerExitedPayloadSchema, event.payload);
    if (!payload) return;
    const store = useProcessingStore.getState();
    // An event not in authoritative snapshot membership cannot choose another PID
    // to remove or independently trigger finalization.
    if (!store.workerPids.includes(payload.pid)) return;
    store.removeWorkerPid(payload.pid);
    if (useProcessingStore.getState().workerPids.length === 0) {
      await finalizeCurrentRun(runId, lease);
    }
  });
  const unlistenLifecycle = await listen<unknown>("ProcessingLifecycleSnapshot", (event) => {
    const payload = admitted(ProcessingLifecycleSnapshotSchema, event.payload);
    if (!payload) return;
    useProcessingStore.getState().reconcileRunSnapshot(payload);
  });

  return () => {
    unlistenStatus();
    unlistenLock();
    unlistenLockRemoved();
    unlistenWorker();
    unlistenLifecycle();
  };
}

/** Reconcile a returned launch/attach snapshot and finalise when workers already exited. */
export async function reconcileAndFinalizeIfNeeded(
  snapshot: ProcessingRunSnapshot,
  lease = captureProjectLease(),
): Promise<void> {
  if (!isAttachedRunCurrent(snapshot.runId, lease)) return;
  useProcessingStore.getState().reconcileRunSnapshot(snapshot);
  if (snapshot.lifecycle === "finalizing") await finalizeCurrentRun(snapshot.runId, lease);
}
