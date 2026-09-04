import { invoke } from "@tauri-apps/api/core";

import type { ProjectFile } from "../schemas/project";
import { clearProcessingListeners } from "../stores/processingStore";
import { hydrateProjectStores, resetProjectStores } from "../stores/projectStoreHydration";
import { useProjectStore } from "../stores/projectStore";
import { clearSessionCheckpoint, syncSessionCheckpointFromProject } from "./sessionCheckpoint";
import {
  activateProjectLease,
  closeProjectWorkAdmission,
  drainProjectTasks,
  invalidateProjectLease,
  reopenProjectWorkAdmission,
  runProjectTransition,
} from "./projectLifecycle";

export interface RuntimeResourceShutdown {
  success: boolean;
  error?: string;
}

export interface ProjectRuntimeShutdownResult {
  success: boolean;
  importProcess: RuntimeResourceShutdown;
  processingWorkers: RuntimeResourceShutdown;
  lockWatcher: RuntimeResourceShutdown;
}

interface TransitionDependencies {
  shutdownRuntime?: () => Promise<ProjectRuntimeShutdownResult>;
  cleanupListeners?: () => void;
}

export async function shutdownProjectRuntime(): Promise<ProjectRuntimeShutdownResult> {
  return invoke<ProjectRuntimeShutdownResult>("shutdown_project_runtime");
}

function cleanupProjectListeners(): void {
  if (typeof window !== "undefined" && window.__IMPORT_CLEANUP__) {
    window.__IMPORT_CLEANUP__();
    window.__IMPORT_CLEANUP__ = undefined;
  }
  clearProcessingListeners();
}

function shutdownError(result: ProjectRuntimeShutdownResult): Error {
  const failures = [
    ["import process", result.importProcess],
    ["processing workers", result.processingWorkers],
    ["lock watcher", result.lockWatcher],
  ]
    .filter(([, resource]) => !(resource as RuntimeResourceShutdown).success)
    .map(([label, resource]) => {
      const error = (resource as RuntimeResourceShutdown).error;
      return error ? `${label}: ${error}` : String(label);
    });
  return new Error(
    failures.length > 0
      ? `Project runtime shutdown failed (${failures.join("; ")}). Retry after stopping project work.`
      : "Project runtime shutdown failed. Retry after stopping project work.",
  );
}

export function transitionProjectRuntime(
  candidate: ProjectFile,
  isDirty: boolean,
  dependencies: TransitionDependencies = {},
): Promise<void> {
  return runProjectTransition(async () => {
    const currentProject = useProjectStore.getState().project;
    closeProjectWorkAdmission();
    await drainProjectTasks();

    if (currentProject) {
      const result = await (dependencies.shutdownRuntime ?? shutdownProjectRuntime)();
      if (!result.success) {
        reopenProjectWorkAdmission();
        throw shutdownError(result);
      }
    }

    (dependencies.cleanupListeners ?? cleanupProjectListeners)();
    invalidateProjectLease();
    hydrateProjectStores(candidate, isDirty);
    activateProjectLease(candidate.projectMeta.id, candidate.projectMeta.rootPath);
    syncSessionCheckpointFromProject(candidate);
  });
}

export function closeProjectRuntime(dependencies: TransitionDependencies = {}): Promise<void> {
  return runProjectTransition(async () => {
    const currentProject = useProjectStore.getState().project;
    closeProjectWorkAdmission();
    await drainProjectTasks();

    if (currentProject) {
      const result = await (dependencies.shutdownRuntime ?? shutdownProjectRuntime)();
      if (!result.success) {
        reopenProjectWorkAdmission();
        throw shutdownError(result);
      }
    }

    (dependencies.cleanupListeners ?? cleanupProjectListeners)();
    invalidateProjectLease();
    resetProjectStores();
    clearSessionCheckpoint();
  });
}
