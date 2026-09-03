import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  canAccessPhase,
  PROJECT_PHASES,
  type ProjectPhase,
  type ProjectFile,
  parseProject,
} from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { clearSessionCheckpoint, readSessionCheckpoint } from "./sessionCheckpoint";

function isProjectPhase(value: string | undefined): value is ProjectPhase {
  return PROJECT_PHASES.includes(value as ProjectPhase);
}

export function resolveRestoredPhase(
  routePhase: string | undefined,
  project: ProjectFile,
): ProjectPhase {
  if (isProjectPhase(routePhase) && canAccessPhase(project, routePhase)) {
    return routePhase;
  }

  return project.projectMeta.currentPhase;
}

/**
 * Reloads in-memory project state after a full page refresh.
 * Returns true when the route project id loaded or matching recovery is pending.
 */
export async function tryRestoreProjectSession(routeProjectId: string): Promise<boolean> {
  const { loadProject, closeProject } = useProjectStore.getState();

  async function tryLoadFromPath(easlPath: string): Promise<boolean> {
    try {
      const raw = await readTextFile(easlPath);
      const parsed = parseProject(raw);
      if (parsed.projectMeta.id === routeProjectId) {
        await loadProject(easlPath);
        return true;
      }
    } catch {
      // Let the store classify missing/malformed primary data and validate a
      // backup. A matched recovery remains pending for LandingPage to confirm.
      try {
        await loadProject(easlPath);
        const recovery = useProjectStore.getState().recovery;
        if (recovery?.projectId === routeProjectId) return true;
        if (recovery) useProjectStore.getState().declineRecovery();
      } catch {
        // Ignore unavailable, malformed, future-version, and permission failures.
      }
    }
    return false;
  }

  const globalState = useGlobalStore.getState();
  if (!globalState.loaded) {
    await globalState.loadSettings();
  }

  const checkpoint = readSessionCheckpoint();
  if (checkpoint?.projectId === routeProjectId && (await tryLoadFromPath(checkpoint.easlPath))) {
    return true;
  }

  for (const easlPath of useGlobalStore.getState().settings.recentProjects) {
    if (await tryLoadFromPath(easlPath)) {
      return true;
    }
  }

  closeProject();
  clearSessionCheckpoint();
  return false;
}
