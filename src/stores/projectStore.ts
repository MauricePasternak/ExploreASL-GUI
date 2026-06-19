import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";

import {
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  PROJECT_FILE_NAME,
  type ProjectMeta,
  ProjectFileSchema,
  type ProjectFile,
} from "../schemas/project";
import {
  clearSessionCheckpoint,
  projectEaslPath,
  syncSessionCheckpointFromProject,
} from "../lib/sessionCheckpoint";
import { isBidsProject, ensureBidsIgnore } from "../lib/bidsUtils";
import type { ImportState } from "./importStore";
import type { ProcessingState } from "./processingStore";

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
  syncProcessingState: (
    processingState: Pick<ProcessingState, "config" | "processingPhase">,
  ) => void;
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

    const rootPath = hydratedProject.projectMeta.rootPath;
    try {
      if (await isBidsProject(rootPath)) {
        await ensureBidsIgnore(rootPath);
      }
    } catch (e) {
      console.warn("Failed to check BIDS project status or write .bidsignore:", e);
    }

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

    try {
      if (await isBidsProject(rootPath)) {
        await ensureBidsIgnore(rootPath);
      }
    } catch (e) {
      console.warn("Failed to check BIDS project status or write .bidsignore:", e);
    }

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
        mostRecentConfig,
        ...payload
      } = importState;

      if (
        JSON.stringify(state.project.mappingState) === JSON.stringify(payload) &&
        state.project.uiState.import?.activeStep === activeStep &&
        state.project.uiState.import?.currentPhase === importPhase &&
        state.project.uiState.import?.completed === importCompleted
      ) {
        return state;
      }

      return {
        project: {
          ...state.project,
          mappingState: payload,
          uiState: {
            ...state.project.uiState,
            import: {
              ...state.project.uiState.import,
              activeStep,
              currentPhase: importPhase,
              completed: importCompleted,
              mostRecentConfig:
                mostRecentConfig ?? state.project.uiState.import?.mostRecentConfig ?? null,
            },
          },
        },
        isDirty: true,
      };
    });
  },

  syncProcessingState: ({ config, processingPhase }) => {
    set((state) => {
      if (!state.project) return state;

      if (
        JSON.stringify(state.project.uiState.processing?.config) === JSON.stringify(config) &&
        state.project.uiState.processing?.currentPhase === processingPhase
      ) {
        return state;
      }

      return {
        project: {
          ...state.project,
          uiState: {
            ...state.project.uiState,
            processing: {
              config: config ?? undefined,
              currentPhase: processingPhase,
            },
          },
        },
        isDirty: true,
      };
    });
  },
}));
