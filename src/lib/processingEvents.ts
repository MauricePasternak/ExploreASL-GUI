/**
 * Tauri event listener glue for the processing module.
 *
 * Bridges Rust backend events -> Zustand store actions.
 * Exposes thin wrappers around Tauri `invoke` for running/stopping the pipeline.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { ProcessConfig, SubjectInfo, SubjectModuleStatus } from "../schemas/processingSchemas";
import { modulesToBProcess, PROCESSING_MODULES } from "../schemas/processingSchemas";
import type { DataParJson } from "./assembleDataPar";
import { useProcessingStore, clearProcessingListeners } from "../stores/processingStore";
import { useProjectStore } from "../stores/projectStore";
import { generateSubjectRegexp } from "./subjectMatching";

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

export function mapModuleName(rustName: string): (typeof PROCESSING_MODULES)[number] | undefined {
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
  const { updateSubjectStatus, removeWorkerPid, setPhase } = useProcessingStore.getState();

  // 1. StatusFileCreated
  const unlistenStatus = await listen<StatusFileCreatedPayload>("StatusFileCreated", (event) => {
    const { subjectSession, stepCode, run } = event.payload;
    console.log(
      `[FRONTEND_WATCHER] StatusFileCreated: module=${event.payload.module} subjectSession=${subjectSession ?? "None"} stepCode=${stepCode} run=${run ?? "None"}`,
    );
    const module = mapModuleName(event.payload.module);
    if (!module) return;

    // ExploreASL's population QC pass may re-run steps (e.g. 100_VisualQC_Structural)
    // for subjects that have already completed the module. Ignore non-completion
    // events that would downgrade a "complete" subject back to "incomplete".
    const isComplete = stepCode === "999_ready";

    const store = useProcessingStore.getState();

    const existing = store.subjectStatuses.find(
      (s) =>
        s.subjectSession === (subjectSession ?? "") &&
        s.module === module &&
        s.run === (run ?? undefined),
    );

    if (existing?.status === "complete" && !isComplete) return;
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
  });

  // 2. LockCreated
  const unlistenLock = await listen<LockCreatedPayload>("LockCreated", (event) => {
    const { subjectSession, run } = event.payload;
    console.log(
      `[FRONTEND_WATCHER] LockCreated: module=${event.payload.module} subjectSession=${subjectSession ?? "None"} run=${run ?? "None"}`,
    );
    const module = mapModuleName(event.payload.module);
    if (!module) return;

    const store = useProcessingStore.getState();

    const existing = store.subjectStatuses.find(
      (s) =>
        s.subjectSession === (subjectSession ?? "") &&
        s.module === module &&
        s.run === (run ?? undefined),
    );

    // ExploreASL's population QC pass re-creates lock directories for subjects
    // that have already completed. Ignore these to prevent a phantom
    // "processing" icon (LockRemoved events are unreliable on Linux).
    if (existing?.status === "complete") return;

    updateSubjectStatus({
      subjectSession: subjectSession ?? "",
      module,
      run: run ?? undefined,
      status: existing?.status ?? "pending",
      completedSteps: existing?.completedSteps ?? [],
      locked: true,
    });
  });

  // 2b. LockRemoved
  const unlistenLockRemoved = await listen<LockRemovedPayload>("LockRemoved", (event) => {
    const { subjectSession, run } = event.payload;
    console.log(
      `[FRONTEND_WATCHER] LockRemoved: module=${event.payload.module} subjectSession=${subjectSession ?? "None"} run=${run ?? "None"}`,
    );
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
  });

  // 3. WorkerExited
  const unlistenWorker = await listen<WorkerExitedPayload>("WorkerExited", async (event) => {
    const { pid } = event.payload;
    console.log(`[FRONTEND_WATCHER] WorkerExited: pid=${pid} exitCode=${event.payload.exitCode}`);
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

      const allComplete =
        finalStatuses.length > 0 && finalStatuses.every((s) => s.status === "complete");
      setPhase(allComplete ? "completed" : "failed");

      if (allComplete) {
        const config = useProcessingStore.getState().config;
        if (config?.modules.includes("population")) {
          useProjectStore.getState().setPopulationCompleted(true);
          try {
            const mtime = await invoke<number | null>("read_population_ready_mtime", {
              projectRoot,
            });
            useProjectStore.getState().setLastPopulationRunMtime(mtime);
          } catch (err) {
            console.warn("[manifest] mtime read failed", err);
            useProjectStore.getState().setLastPopulationRunMtime(null);
          }
        }
      }
    } catch {
      setPhase("failed");
    } finally {
      clearProcessingListeners();
    }
  });

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

  const workers =
    config.subjects.length > 0 ? Math.min(config.workers, config.subjects.length) : config.workers;

  const pids = await invoke<number[]>("run_pipeline", {
    projectRoot,
    matlabPath: config.matlabPath,
    exploreAslPath: config.exploreAslPath,
    dataParJson: JSON.stringify(dataPar),
    bProcess,
    workers,
    subjectRegexp: generateSubjectRegexp(config.subjects),
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
  const mapped = raw
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
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return mapped as SubjectModuleStatus[];
}

/**
 * Invoke the Rust `watch_lock_dir` command.
 * Stops any existing watcher before starting a new one.
 */
export async function watchLockDir(projectRoot: string): Promise<void> {
  await invoke("stop_watch_lock_dir").catch((err) => {
    console.debug(
      "[processingEvents] stop_watch_lock_dir failed (this is normal if not running):",
      err,
    );
  });
  await invoke("watch_lock_dir", { projectRoot });
}

/**
 * Invoke the Rust `stop_watch_lock_dir` command.
 * Stops the file watcher if one is running.
 */
export async function stopWatcher(): Promise<void> {
  await invoke("stop_watch_lock_dir").catch((err) => {
    console.debug("[processingEvents] stopWatcher failed:", err);
  });
}
