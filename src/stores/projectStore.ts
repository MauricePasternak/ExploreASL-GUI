import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";

import {
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  PROJECT_FILE_NAME,
  type ProjectMeta,
  type ProjectPhase,
  ProjectFileSchema,
  type ProjectFile,
} from "../schemas/project";

interface ProjectState {
  project: ProjectFile | null;
  isDirty: boolean;
  loaded: boolean;
  loadProject: (easlPath: string) => Promise<void>;
  createProject: (rootPath: string, name: string) => Promise<void>;
  saveProject: () => Promise<void>;
  setPhase: (phase: ProjectMeta["currentPhase"]) => void;
  closeProject: () => void;
}

function getProjectFilePath(rootPath: string) {
  return `${rootPath}/${PROJECT_FILE_NAME}`;
}

function isProjectFilePath(easlPath: string) {
  return easlPath.split("/").filter(Boolean).pop() === PROJECT_FILE_NAME;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isDirty: false,
  loaded: false,

  loadProject: async (easlPath) => {
    if (!isProjectFilePath(easlPath)) {
      throw new Error(`Project files must be named ${PROJECT_FILE_NAME}.`);
    }

    const raw = await readTextFile(easlPath);
    const parsed = ProjectFileSchema.parse(JSON.parse(raw));
    const hydratedProject: ProjectFile = {
      ...parsed,
      projectMeta: {
        ...parsed.projectMeta,
        lastOpened: new Date().toISOString(),
      },
    };

    await writeTextFile(easlPath, JSON.stringify(hydratedProject, null, 2));

    set({
      project: hydratedProject,
      isDirty: false,
      loaded: true,
    });
  },

  createProject: async (rootPath, name) => {
    const project = DEFAULT_PROJECT_FILE(crypto.randomUUID(), name, rootPath);

    await writeTextFile(getProjectFilePath(rootPath), JSON.stringify(project, null, 2));

    set({
      project,
      isDirty: false,
      loaded: true,
    });
  },

  saveProject: async () => {
    const { project } = get();
    if (!project) {
      return;
    }

    await writeTextFile(
      getProjectFilePath(project.projectMeta.rootPath),
      JSON.stringify(project, null, 2),
    );

    set({ isDirty: false });
  },

  setPhase: (phase) => {
    set((state) => {
      if (!state.project) {
        return state;
      }

      const currentPhase = state.project.projectMeta.currentPhase as ProjectPhase;
      if (!canAccessPhase(currentPhase, phase)) {
        return state;
      }

      return {
        project: {
          ...state.project,
          projectMeta: {
            ...state.project.projectMeta,
            currentPhase: phase,
            lastOpened: new Date().toISOString(),
          },
        },
        isDirty: true,
      };
    });
  },

  closeProject: () => {
    set({
      project: null,
      isDirty: false,
      loaded: false,
    });
  },
}));
