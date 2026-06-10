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
import {
  clearSessionCheckpoint,
  projectEaslPath,
  syncSessionCheckpointFromProject,
} from "../lib/sessionCheckpoint";
import type { ImportState } from "./importStore";

interface ProjectState {
  project: ProjectFile | null;
  isDirty: boolean;
  loaded: boolean;
  loadProject: (easlPath: string) => Promise<void>;
  createProject: (rootPath: string, name: string) => Promise<void>;
  saveProject: () => Promise<void>;
  setPhase: (phase: ProjectMeta["currentPhase"]) => void;
  toggleNavbar: () => void;
  syncImportState: (importState: ImportState) => void;
  closeProject: () => void;
}

function getProjectFilePath(rootPath: string) {
  return projectEaslPath(rootPath);
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
    syncSessionCheckpointFromProject(hydratedProject);
  },

  createProject: async (rootPath, name) => {
    const project = DEFAULT_PROJECT_FILE(crypto.randomUUID(), name, rootPath);

    await writeTextFile(getProjectFilePath(rootPath), JSON.stringify(project, null, 2));

    set({
      project,
      isDirty: false,
      loaded: true,
    });
    syncSessionCheckpointFromProject(project);
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

      if (!canAccessPhase(state.project, phase)) {
        return state;
      }

      const nextProject = {
        ...state.project,
        projectMeta: {
          ...state.project.projectMeta,
          currentPhase: phase,
          lastOpened: new Date().toISOString(),
        },
      };

      syncSessionCheckpointFromProject(nextProject, phase);

      return {
        project: nextProject,
        isDirty: true,
      };
    });
  },

  toggleNavbar: () => {
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          uiState: {
            ...state.project.uiState,
            navbarCollapsed: !state.project.uiState.navbarCollapsed,
          },
        },
        isDirty: true,
      };
    });
  },

  closeProject: () => {
    clearSessionCheckpoint();
    set({
      project: null,
      isDirty: false,
      loaded: false,
    });
  },

  syncImportState: (importState) => {
    set((state) => {
      if (!state.project) return state;

      const {
        activeStep,
        importPhase,
        importCompleted,
        importLog,
        failedSubjects,
        importRunning,
        importProgress,
        importSummary,
        ...payload
      } = importState;

      if (
        JSON.stringify(state.project.mappingState) === JSON.stringify(payload) &&
        state.project.uiState.importActiveStep === activeStep &&
        state.project.uiState.importPhase === importPhase &&
        state.project.uiState.importCompleted === importCompleted
      ) {
        return state;
      }

      return {
        project: {
          ...state.project,
          mappingState: payload,
          uiState: {
            ...state.project.uiState,
            importActiveStep: activeStep,
            importPhase,
            importCompleted,
          },
        },
        isDirty: true,
      };
    });
  },
}));
