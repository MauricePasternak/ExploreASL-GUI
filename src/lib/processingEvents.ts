/**
 * Tauri event listener glue for the processing module.
 *
 * Bridges Rust backend events -> Zustand store actions.
 * Exposes thin wrappers around Tauri `invoke` for running/stopping the pipeline.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  ProcessConfig,
  SubjectInfo,
  SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { modulesToBProcess, PROCESSING_MODULES } from "../schemas/processingSchemas";
import type { DataParJson } from "./assembleDataPar";
import { useProcessingStore, clearProcessingListeners } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";

// =============================================================================
// Event Payload Types (matching Rust event shapes)
// =============================================================================

export interface StatusFileCreatedPayload {
  module: string;
  subjectSession: string;
  stepCode: string;
  run?: string;
}

export interface LockCreatedPayload {
  module: string;
  subjectSession: string;
  run?: string;
}

export interface LockRemovedPayload {
  module: string;
  subjectSession: string;
  run?: string;
}

export interface WorkerExitedPayload {
  pid: number;
  exitCode: number;
}

// =============================================================================
// Module Name Mapping (Rust → TypeScript)
// =============================================================================

const RUST_MODULE_MAP: Record<string, (typeof PROCESSING_MODULES)[number]> = {
  xASL_module_Structural: "structural",
  xASL_module_ASL: "asl",
  xASL_module_Population: "population",
};

export function mapModuleName(
  rustName: string,
): (typeof PROCESSING_MODULES)[number] | undefined {
  if (rustName in RUST_MODULE_MAP) return RUST_MODULE_MAP[rustName];
  if ((PROCESSING_MODULES as readonly string[]).includes(rustName))
    return rustName as (typeof PROCESSING_MODULES)[number];
  return undefined;
}

// =============================================================================
// Public API — Event Listeners
// =============================================================================

/**
 * Set up all Tauri event listeners for the processing pipeline.
 *
 * Returns a cleanup function that removes every listener.
 */
export async function setupProcessingListeners(): Promise<() => void> {
  const {
    updateSubjectStatus,
    removeWorkerPid,
    setPhase,
  } = useProcessingStore.getState();

  // 1. StatusFileCreated
  const unlistenStatus = await listen<StatusFileCreatedPayload>(
    "StatusFileCreated",
    (event) => {
      const { subjectSession, stepCode, run } = event.payload;
      console.log(`[${new Date().toISOString()}] [FRONTEND_WATCHER] StatusFileCreated event:`, event.payload);
      const module = mapModuleName(event.payload.module);
      if (!module) return;

      const store = useProcessingStore.getState();

      const existing = store.subjectStatuses.find(
        (s) =>
          s.subjectSession === (subjectSession ?? "") &&
          s.module === module &&
          s.run === (run ?? undefined),
      );

      const isComplete = stepCode === "999_ready";
      const completedSteps = existing
        ? isComplete
          ? existing.completedSteps
          : [...new Set([...existing.completedSteps, stepCode])]
        : isComplete
          ? []
          : [stepCode];

      updateSubjectStatus({
        subjectSession: subjectSession ?? "",
        module,
        run: run ?? undefined,
        status: isComplete ? "complete" : "incomplete",
        completedSteps,
        locked: isComplete ? false : (existing?.locked ?? false),
      });
    },
  );

  // 2. LockCreated
  const unlistenLock = await listen<LockCreatedPayload>(
    "LockCreated",
    (event) => {
      const { subjectSession, run } = event.payload;
      console.log(`[${new Date().toISOString()}] [FRONTEND_WATCHER] LockCreated event:`, event.payload);
      const module = mapModuleName(event.payload.module);
      if (!module) return;

      const store = useProcessingStore.getState();

      const existing = store.subjectStatuses.find(
        (s) =>
          s.subjectSession === (subjectSession ?? "") &&
          s.module === module &&
          s.run === (run ?? undefined),
      );

      updateSubjectStatus({
        subjectSession: subjectSession ?? "",
        module,
        run: run ?? undefined,
        status: existing?.status ?? "pending",
        completedSteps: existing?.completedSteps ?? [],
        locked: true,
      });
    },
  );

  // 2b. LockRemoved
  const unlistenLockRemoved = await listen<LockRemovedPayload>(
    "LockRemoved",
    (event) => {
      const { subjectSession, run } = event.payload;
      console.log(`[${new Date().toISOString()}] [FRONTEND_WATCHER] LockRemoved event:`, event.payload);
      const module = mapModuleName(event.payload.module);
      if (!module) return;

      const store = useProcessingStore.getState();

      const existing = store.subjectStatuses.find(
        (s) =>
          s.subjectSession === (subjectSession ?? "") &&
          s.module === module &&
          s.run === (run ?? undefined),
      );

      if (existing) {
        updateSubjectStatus({
          ...existing,
          locked: false,
        });
      }
    },
  );

  // 3. WorkerExited
  const unlistenWorker = await listen<WorkerExitedPayload>(
    "WorkerExited",
    async (event) => {
      const { pid } = event.payload;
      console.log(`[${new Date().toISOString()}] [FRONTEND_WATCHER] WorkerExited event:`, event.payload);
      removeWorkerPid(pid);

      const remaining = useProcessingStore.getState().workerPids;
      if (remaining.length > 0) return;

      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (!projectRoot) return;

      const currentPhase = useProcessingStore.getState().processingPhase;
      if (currentPhase === "cancelled") return;

      try {
        await stopWatcher();
        await clearStaleLocks(projectRoot);
        const finalStatuses = await loadLockStatus(projectRoot);
        useProcessingStore.setState({ subjectStatuses: finalStatuses });

        const allComplete = finalStatuses.length > 0 &&
          finalStatuses.every((s) => s.status === "complete");
        setPhase(allComplete ? "completed" : "failed");
      } catch {
        setPhase("failed");
      } finally {
        clearProcessingListeners();
      }
    },
  );

  // Return cleanup function
  return () => {
    unlistenStatus();
    unlistenLock();
    unlistenLockRemoved();
    unlistenWorker();
  };
}

// =============================================================================
// Public API — Pipeline Actions
// =============================================================================

/**
 * Invoke the Rust `run_pipeline` command.
 *
 * Returns the PIDs of the spawned worker processes.
 */
export async function runProcessingPipeline(
  config: ProcessConfig,
  dataPar: DataParJson = { x: {} },
): Promise<number[]> {
  const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
  if (!projectRoot) throw new Error("No project loaded");

  const bProcess = modulesToBProcess(config.modules);

  const pids = await invoke<number[]>("run_pipeline", {
    projectRoot,
    matlabPath: config.matlabPath,
    exploreAslPath: config.exploreAslPath,
    dataParJson: JSON.stringify(dataPar),
    bProcess,
    workers: config.workers,
    subjectRegexp: config.subjectRegexp,
  });

  return pids;
}

/**
 * Invoke the Rust `kill_pipeline` command.
 */
export async function stopProcessingPipeline(): Promise<void> {
  await invoke("kill_pipeline");
}

/**
 * Invoke the Rust `list_subjects` command.
 */
export async function loadSubjects(projectRoot: string): Promise<SubjectInfo[]> {
  return await invoke<SubjectInfo[]>("list_subjects", { projectRoot });
}

/**
 * Invoke the Rust `clear_stale_locks` command.
 * Removes all `locked` directories under the lock folder.
 */
export async function clearStaleLocks(projectRoot: string): Promise<void> {
  await invoke("clear_stale_locks", { projectRoot });
}

/**
 * Invoke the Rust `read_lock_status` command.
 */
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
        run: entry.run ?? undefined,
      };
    })
    .filter((entry): entry is SubjectModuleStatus => entry !== null);
}

/**
 * Invoke the Rust `watch_lock_dir` command.
 * Stops any existing watcher before starting a new one.
 */
export async function watchLockDir(projectRoot: string): Promise<void> {
  await invoke("stop_watch_lock_dir").catch(() => {});
  await invoke("watch_lock_dir", { projectRoot });
}

/**
 * Invoke the Rust `stop_watch_lock_dir` command.
 * Stops the file watcher if one is running.
 */
export async function stopWatcher(): Promise<void> {
  await invoke("stop_watch_lock_dir").catch(() => {});
}
