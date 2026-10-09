import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { ProjectInspection } from "../generated/project/ProjectInspection";
import type { ProjectSnapshot } from "../generated/project/ProjectSnapshot";
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

export interface ProjectRuntimeShutdownResult {
  success: boolean;
  importProcess: { success: boolean; error?: string };
  processingWorkers: { success: boolean; error?: string };
  lockWatcher: { success: boolean; error?: string };
}
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
export const shutdownProjectRuntime = () =>
  invoke<ProjectRuntimeShutdownResult>("shutdown_project_runtime");

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
          ...recovery.cleanupErrors,
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
      await (dependencies.clearActiveProject ?? (() => invoke("clear_active_project")))();
    } catch (error) {
      reopenProjectWorkAdmission();
      throw error;
    }
    invalidateProjectLease();
    resetProjectStores();
    clearSessionCheckpoint();
  });
}
