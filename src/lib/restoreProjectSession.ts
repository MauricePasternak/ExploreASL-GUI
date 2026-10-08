import {
  canAccessPhase,
  PROJECT_PHASES,
  type ProjectPhase,
  type ProjectFile,
} from "../schemas/project";
import { useGlobalStore } from "../stores/globalStore";
import { useProjectStore } from "../stores/projectStore";
import { inspectProject } from "./projectPersistence";
import { clearSessionCheckpoint, readSessionCheckpoint } from "./sessionCheckpoint";

export function resolveRestoredPhase(
  routePhase: string | undefined,
  project: ProjectFile,
): ProjectPhase {
  return PROJECT_PHASES.includes(routePhase as ProjectPhase) &&
    canAccessPhase(project, routePhase as ProjectPhase)
    ? (routePhase as ProjectPhase)
    : project.projectMeta.currentPhase;
}

export async function tryRestoreProjectSession(id: string): Promise<boolean> {
  const global = useGlobalStore.getState();
  if (!global.loaded) await global.loadSettings();
  if (!useGlobalStore.getState().hasValidProfile()) return false;
  if (await useProjectStore.getState().attachCurrentProject(id)) return true;
  const checkpoint = readSessionCheckpoint();
  const recent = useGlobalStore.getState().settings.recentProjects;
  const paths = [
    checkpoint?.projectId === id ? checkpoint.easlPath : null,
    ...recent
      .filter((project) => !project.projectId || project.projectId === id)
      .map((project) => project.path),
  ];
  for (const path of new Set(paths)) {
    if (!path) continue;
    try {
      const inspection = await inspectProject(path, recent);
      if (inspection.projectId !== id) continue;
      await useProjectStore.getState().loadProject(path, { inspection });
      if (!useProjectStore.getState().recovery)
        useGlobalStore.getState().addRecentProject(path, id);
      return true;
    } catch {
      /* Unavailable candidates do not replace the active project. */
    }
  }
  clearSessionCheckpoint();
  return false;
}
