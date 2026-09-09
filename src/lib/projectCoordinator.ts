import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";

import type { ProjectFile } from "../schemas/project";
import { clearProcessingListeners } from "../stores/processingStore";
import { clearImportListeners } from "./importEvents";
import {
  reconcileImportRunAfterShutdown,
  reconcileImportRunForActivation,
} from "./importTerminalCoordinator";
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

export interface TransitionDependencies {
  shutdownRuntime?: () => Promise<ProjectRuntimeShutdownResult>;
  cleanupListeners?: () => void;
  setActiveProject?: (rootPath: string) => Promise<RelocationRecoverySummary | void>;
  clearActiveProject?: () => Promise<void>;
  reconcileImportRun?: () => Promise<unknown>;
  reconcileImportAfterShutdown?: () => Promise<void>;
}

export interface RelocationRecoverySummary {
  preservedSubjects: string[];
  restoredSubjects: string[];
  cleanedSubjects: string[];
  cleanupErrors: string[];
}

export async function shutdownProjectRuntime(): Promise<ProjectRuntimeShutdownResult> {
  return invoke<ProjectRuntimeShutdownResult>("shutdown_project_runtime");
}

function cleanupProjectListeners(): void {
  clearImportListeners();
  clearProcessingListeners();
}

async function setNativeActiveProject(rootPath: string): Promise<RelocationRecoverySummary> {
  return invoke<RelocationRecoverySummary>("set_active_project", { rootPath });
}

async function clearNativeActiveProject(): Promise<void> {
  await invoke("clear_active_project");
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
      await (dependencies.reconcileImportAfterShutdown ?? reconcileImportRunAfterShutdown)();
    }

    (dependencies.cleanupListeners ?? cleanupProjectListeners)();
    invalidateProjectLease();
    try {
      const recovery = await (dependencies.setActiveProject ?? setNativeActiveProject)(
        candidate.projectMeta.rootPath,
      );
      if (
        recovery &&
        (recovery.preservedSubjects.length > 0 ||
          recovery.restoredSubjects.length > 0 ||
          recovery.cleanupErrors.length > 0)
      ) {
        notifications.show({
          color: recovery.cleanupErrors.length > 0 ? "orange" : "blue",
          title: "Import relocation recovery completed",
          message: [
            recovery.preservedSubjects.length > 0
              ? `Preserved: ${recovery.preservedSubjects.join(", ")}`
              : "",
            recovery.restoredSubjects.length > 0
              ? `Restored: ${recovery.restoredSubjects.join(", ")}`
              : "",
            ...recovery.cleanupErrors,
          ]
            .filter(Boolean)
            .join(". "),
        });
      }
    } catch (error) {
      // Candidate native root was not admitted. Do not reactivate old frontend work.
      throw new Error(
        `Failed to activate native project root: ${error instanceof Error ? error.message : String(error)}`,
        // @ts-expect-error ErrorOptions is absent from the ES2020 target library.
        { cause: error },
      );
    }
    hydrateProjectStores(candidate, isDirty);
    activateProjectLease(candidate.projectMeta.id, candidate.projectMeta.rootPath);
    syncSessionCheckpointFromProject(candidate);
    try {
      await (dependencies.reconcileImportRun ?? reconcileImportRunForActivation)();
    } catch (error) {
      closeProjectWorkAdmission();
      throw new Error(
        `Failed to reconcile native import authority: ${error instanceof Error ? error.message : String(error)}`,
        // @ts-expect-error ErrorOptions is absent from the ES2020 target library.
        { cause: error },
      );
    }
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
      await (dependencies.reconcileImportAfterShutdown ?? reconcileImportRunAfterShutdown)();
    }

    (dependencies.cleanupListeners ?? cleanupProjectListeners)();
    invalidateProjectLease();
    try {
      await (dependencies.clearActiveProject ?? clearNativeActiveProject)();
    } catch (error) {
      // Keep admission closed: frontend root could no longer match native state.
      throw new Error(
        `Failed to clear native project root: ${error instanceof Error ? error.message : String(error)}`,
        // @ts-expect-error ErrorOptions is absent from the ES2020 target library.
        { cause: error },
      );
    }
    resetProjectStores();
    clearSessionCheckpoint();
  });
}
