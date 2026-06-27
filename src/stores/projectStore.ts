import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";

import { ensureBidsIgnore, isBidsProject } from "../lib/bidsUtils";
import { compressSnapshot } from "../lib/snapshotCompression";
import { logAction } from "../lib/debug";
import {
  clearSessionCheckpoint,
  projectEaslPath,
  syncSessionCheckpointFromProject,
} from "../lib/sessionCheckpoint";
import {
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  PROJECT_FILE_NAME,
  ProjectFileSchema,
  type ProjectFile,
  type ProjectMeta,
} from "../schemas/project";
import type { ImportSnapshot } from "../schemas/importSchemas";
import type { ManifestFailReason, ManifestVerdict } from "../schemas/project";
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
  setPopulationCompleted: (value: boolean) => void;
  setManifestVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    opts: { reason?: ManifestFailReason; notes?: string; setAt: number },
  ) => void;
  setLastRunVersions: (versions: { exploreASL?: string; matlab?: string; gui?: string }) => void;
  setLastPopulationRunMtime: (mtime: number | null) => void;
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
    logAction("project_load", {
      name: hydratedProject.projectMeta.name,
      path: hydratedProject.projectMeta.rootPath,
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
    logAction("project_create", {
      name: project.projectMeta.name,
      path: project.projectMeta.rootPath,
    });
    syncSessionCheckpointFromProject(project);
  },

  saveProject: async () => {
    const { project } = get();
    if (!project) {
      return;
    }

    const serialized = JSON.stringify(
      project,
      (key, value) => {
        if (
          key === "mostRecentConfig" &&
          value &&
          typeof value === "object" &&
          "sourceDataPath" in value
        ) {
          return compressSnapshot(value as ImportSnapshot);
        }
        return value;
      },
      2,
    );

    await writeTextFile(getProjectFilePath(project.projectMeta.rootPath), serialized);

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
    logAction("project_close");
    set({
      project: null,
      isDirty: false,
      loaded: false,
    });
  },

  setPopulationCompleted: (value) => {
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            uiState: {
              ...state.project.uiState,
              population: { completed: value },
            },
          }
        : null,
      isDirty: true,
    }));
  },

  setManifestVerdict: (subjectSession, status, opts) => {
    if (status === "fail" && !opts.reason) {
      throw new Error("reason is required when status is fail");
    }
    set((state) => {
      if (!state.project) return state;
      const verdict: ManifestVerdict = {
        status,
        reason: opts.reason as ManifestFailReason | undefined,
        notes: opts.notes,
        setAt: opts.setAt,
      };
      const prev = state.project.uiState?.manifest?.verdicts?.[subjectSession];
      if (prev?.status === "pass" && status === "fail" && opts.notes === undefined) {
        verdict.notes = undefined;
      }
      return {
        isDirty: true,
        project: {
          ...state.project,
          uiState: {
            ...state.project.uiState,
            manifest: {
              verdicts: {
                ...(state.project.uiState?.manifest?.verdicts ?? {}),
                [subjectSession]: verdict,
              },
              lastRunVersions: state.project.uiState?.manifest?.lastRunVersions ?? {},
              lastPopulationRunMtime:
                state.project.uiState?.manifest?.lastPopulationRunMtime ?? null,
            },
          },
        },
      };
    });
  },

  setLastRunVersions: (versions) => {
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            uiState: {
              ...state.project.uiState,
              manifest: {
                verdicts: state.project.uiState?.manifest?.verdicts ?? {},
                lastRunVersions: versions,
                lastPopulationRunMtime:
                  state.project.uiState?.manifest?.lastPopulationRunMtime ?? null,
              },
            },
          }
        : null,
      isDirty: true,
    }));
  },

  setLastPopulationRunMtime: (mtime) => {
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            uiState: {
              ...state.project.uiState,
              manifest: {
                verdicts: state.project.uiState?.manifest?.verdicts ?? {},
                lastRunVersions: state.project.uiState?.manifest?.lastRunVersions ?? {},
                lastPopulationRunMtime: mtime,
              },
            },
          }
        : null,
      isDirty: true,
    }));
  },

  syncImportState: (importState) => {
    set((state) => {
      if (!state.project) return state;

      const { activeStep, importPhase, importCompleted, mostRecentConfig, ...payload } =
        importState;

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

      const persistedConfig = config && config.modules.length > 0 ? config : undefined;

      if (
        JSON.stringify(state.project.uiState.processing?.config) ===
          JSON.stringify(persistedConfig) &&
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
              config: persistedConfig,
              currentPhase: processingPhase,
            },
          },
        },
        isDirty: true,
      };
    });
  },
}));
