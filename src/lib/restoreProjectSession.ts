import { canAccessPhase, PROJECT_PHASES, type ProjectPhase } from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { clearSessionCheckpoint, readSessionCheckpoint } from "./sessionCheckpoint";

function isProjectPhase(value: string | undefined): value is ProjectPhase {
  return PROJECT_PHASES.includes(value as ProjectPhase);
}

export function resolveRestoredPhase(
  routePhase: string | undefined,
  currentPhase: ProjectPhase,
): ProjectPhase {
  if (isProjectPhase(routePhase) && canAccessPhase(currentPhase, routePhase)) {
    return routePhase;
  }

  return currentPhase;
}

/**
 * Reloads in-memory project state after a full page refresh.
 * Returns true when the route project id is loaded; false when recovery failed.
 */
export async function tryRestoreProjectSession(routeProjectId: string): Promise<boolean> {
  const { loadProject, closeProject } = useProjectStore.getState();

  async function tryLoadFromPath(easlPath: string): Promise<boolean> {
    try {
      await loadProject(easlPath);
      const loaded = useProjectStore.getState().project;
      if (loaded?.projectMeta.id === routeProjectId) {
        return true;
      }
    } catch {
      // fall through to reset store
    }

    closeProject();
    return false;
  }

  const checkpoint = readSessionCheckpoint();
  if (checkpoint?.projectId === routeProjectId && (await tryLoadFromPath(checkpoint.easlPath))) {
    return true;
  }

  const globalState = useGlobalStore.getState();
  if (!globalState.loaded) {
    await globalState.loadSettings();
  }

  for (const easlPath of useGlobalStore.getState().settings.recentProjects) {
    if (await tryLoadFromPath(easlPath)) {
      return true;
    }
  }

  clearSessionCheckpoint();
  return false;
}
