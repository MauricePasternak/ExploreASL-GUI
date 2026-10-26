import { commands, unwrap } from "./ipc";
import type {
  ProjectRuntimeShutdown_Serialize as ProjectRuntimeShutdownResult,
  ProjectInspection_Serialize as ProjectInspection,
  ProjectSnapshot_Serialize as ProjectSnapshot,
} from "../generated/bindings";
export type { ProjectRuntimeShutdown_Serialize as ProjectRuntimeShutdownResult } from "../generated/bindings";
import { notifications } from "@mantine/notifications";
import { error as logError } from "@tauri-apps/plugin-log";
import { activateProject, readProjectSnapshot } from "./projectPersistence";
import { clearProcessingListeners, useProcessingStore } from "../stores/processingStore";
import { clearImportListeners } from "./importEvents";
import { reconcileImportRunForActivation } from "./importTerminalCoordinator";
import { resetProjectStores } from "../stores/projectStoreHydration";
import { useImportStore } from "../stores/importStore";
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

export interface TransitionDependencies {
  shutdownRuntime?: () => Promise<ProjectRuntimeShutdownResult>;
  cleanupListeners?: () => void;
  activateCandidate?: (
    candidate: ProjectInspection,
    confirmBackup: boolean,
    copied: boolean,
  ) => Promise<ProjectSnapshot>;
  clearActiveProject?: () => Promise<void>;
  reconcileImportRun?: () => Promise<unknown>;
  reconcileProcessingRun?: () => Promise<unknown>;
}
export const shutdownProjectRuntime = () => commands.shutdownProjectRuntime();

function cleanupListeners() {
  clearImportListeners();
  clearProcessingListeners();
}

async function settle(dependencies: TransitionDependencies): Promise<void> {
  closeProjectWorkAdmission();
  try {
    await useProjectStore.getState().saveProject({ allowClosedAdmission: true });
    await drainProjectTasks();
    if (useProjectStore.getState().project) {
      const result = await (dependencies.shutdownRuntime ?? shutdownProjectRuntime)();
      if (!result.success)
        throw new Error(
          `Project runtime shutdown failed: ${[
            result.importProcess,
            result.processingWorkers,
            result.lockWatcher,
          ]
            .filter((resource) => !resource.success)
            .map((resource) => resource.error ?? "resource did not stop")
            .join("; ")}`,
        );
      // Native shutdown persists results. Keep A's cache current if replacement/clear fails.
      await useProjectStore.getState().refreshProject();
    }
  } catch (error) {
    reopenProjectWorkAdmission();
    throw error;
  }
  useProjectStore.getState().cancelAutosave();
  (dependencies.cleanupListeners ?? cleanupListeners)();
}

export function transitionProjectRuntime(
  candidate: ProjectInspection | ProjectSnapshot,
  options: { confirmBackup?: boolean; copied?: boolean } = {},
  dependencies: TransitionDependencies = {},
): Promise<void> {
  return runProjectTransition(async () => {
    // Renderer reload attaches to accepted native state without stopping its run.
    if (!("document" in candidate)) await settle(dependencies);
    let snapshot: ProjectSnapshot;
    try {
      snapshot =
        "document" in candidate
          ? await readProjectSnapshot(candidate.activationGeneration)
          : await (dependencies.activateCandidate ?? activateProject)(
              candidate,
              options.confirmBackup ?? false,
              options.copied ?? false,
            );
    } catch (error) {
      reopenProjectWorkAdmission();
      throw error;
    }
    invalidateProjectLease();
    const recovery = snapshot.recovery;
    if (
      recovery &&
      (recovery.preservedSubjects.length ||
        recovery.restoredSubjects.length ||
        recovery.cleanupErrors.length)
    ) {
      if (recovery.cleanupErrors.length) {
        void logError(
          `[PROJECT] Import relocation cleanup failed: ${recovery.cleanupErrors.join("; ")}`,
        ).catch(() => undefined);
      }
      notifications.show({
        title: "Import relocation recovery completed",
        color: recovery.cleanupErrors.length ? "orange" : "blue",
        message: [
          recovery.preservedSubjects.length
            ? `Preserved: ${recovery.preservedSubjects.join(", ")}`
            : "",
          recovery.restoredSubjects.length
            ? `Restored: ${recovery.restoredSubjects.join(", ")}`
            : "",
          recovery.cleanupErrors.length
            ? "Some import cleanup remains pending. Check project directory access and free space, then reopen the project to retry. Consult the application log if this continues"
            : "",
        ]
          .filter(Boolean)
          .join(". "),
      });
    }
    resetProjectStores();
    useProjectStore.getState().acceptSnapshot(snapshot);
    activateProjectLease(snapshot.document.projectMeta.id, snapshot.rootPath);
    syncSessionCheckpointFromProject(useProjectStore.getState().project!);
    try {
      await useImportStore.getState().inspectSourceAvailability();
      await (dependencies.reconcileImportRun ?? reconcileImportRunForActivation)();
      await (
        dependencies.reconcileProcessingRun ??
        useProcessingStore.getState().synchronizeProcessingRun
      )();
    } catch (error) {
      closeProjectWorkAdmission();
      throw error;
    }
  });
}

export function closeProjectRuntime(dependencies: TransitionDependencies = {}): Promise<void> {
  return runProjectTransition(async () => {
    await settle(dependencies);
    try {
      await (dependencies.clearActiveProject ?? (() => unwrap(commands.clearActiveProject())))();
    } catch (error) {
      reopenProjectWorkAdmission();
      throw error;
    }
    invalidateProjectLease();
    resetProjectStores();
    clearSessionCheckpoint();
  });
}
