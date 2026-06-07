import { z } from "zod";

import {
  PROJECT_FILE_NAME,
  PROJECT_PHASES,
  type ProjectFile,
  type ProjectPhase,
} from "../schemas/project";

const STORAGE_KEY = "exploreasl-gui:session-checkpoint";

export const SessionCheckpointSchema = z.object({
  easlPath: z.string().min(1),
  projectId: z.string().min(1),
  phase: z.enum(PROJECT_PHASES),
});

export type SessionCheckpoint = z.infer<typeof SessionCheckpointSchema>;

export function projectEaslPath(rootPath: string) {
  return `${rootPath}/${PROJECT_FILE_NAME}`;
}

export function readSessionCheckpoint(): SessionCheckpoint | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = SessionCheckpointSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeSessionCheckpoint(checkpoint: SessionCheckpoint) {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
}

export function clearSessionCheckpoint() {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.removeItem(STORAGE_KEY);
}

export function syncSessionCheckpointFromProject(project: ProjectFile, phase?: ProjectPhase) {
  writeSessionCheckpoint({
    easlPath: projectEaslPath(project.projectMeta.rootPath),
    projectId: project.projectMeta.id,
    phase: phase ?? project.projectMeta.currentPhase,
  });
}
