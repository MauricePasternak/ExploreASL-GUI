import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";

import { ensureBidsIgnore, isBidsProject } from "../lib/bids/validation";
import { compressSnapshot } from "../lib/snapshotCompression";
import { logAction } from "../lib/debug";
import {
  clearSessionCheckpoint,
  projectEaslPath,
  syncSessionCheckpointFromProject,
} from "../lib/sessionCheckpoint";
import type { DataParState } from "../schemas/dataParSchema";
import {
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  PROJECT_FILE_NAME,
  ProjectFileSchema,
  type ProjectFile,
  type ProjectMeta,
} from "../schemas/project";
import { flattenBidsGroupsToSubjectRows } from "../lib/bids/subjectRows";
import type { ImportSnapshot, MetadataGroup } from "../schemas/importSchemas";
import type { ManifestFailReason, ManifestVerdict } from "../schemas/project";
import type { ImportState } from "./importStore";
import type { ProcessingState } from "./processingStore";

type DataVisState = NonNullable<ProjectFile["uiState"]["dataVis"]>;
type DataParAdvancedVisibility = NonNullable<
  NonNullable<ProjectFile["uiState"]["datapar"]>["advancedVisibility"]
>;

interface ProjectState {
  project: ProjectFile | null;
  isDirty: boolean;
  loaded: boolean;
  loadProject: (easlPath: string) => Promise<void>;
  createProject: (
    rootPath: string,
    name: string,
    options: { dataSource: "dicom" | "bids" },
  ) => Promise<void>;
  saveProject: () => Promise<void>;
  setPhase: (phase: ProjectMeta["currentPhase"]) => void;
  toggleNavbar: () => void;
  syncImportState: (importState: ImportState) => void;
  syncProcessingState: (
    processingState: Pick<ProcessingState, "config" | "processingPhase">,
  ) => void;
  syncDataParState: (dataPar: DataParState, advancedVisibility: DataParAdvancedVisibility) => void;
  syncVisualizationState: (dataVis: DataVisState) => void;
  setPopulationCompleted: (value: boolean) => void;
  setManifestVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    opts: { reason?: ManifestFailReason; notes?: string; setAt?: number },
  ) => void;
  removeManifestVerdict: (subjectSession: string) => void;
  setLastRunProfileId: (
    module: "population" | "structural" | "asl",
    profileId: string,
    versions: {
      exploreASLVersion?: string;
      matlabVersion?: string;
      guiVersion?: string;
    },
  ) => void;
  setLastPopulationRunMtime: (mtime: number | null) => void;
  closeProject: () => void;
  confirmBidsReview: () => Promise<void>;
}

/** Incremented on every successful in-memory project mutation; used to guard saveProject. */
let projectRevision = 0;

/** Serializes concurrent saveProject calls so writes complete in order. */
let saveChain: Promise<void> = Promise.resolve();

function getProjectFilePath(rootPath: string) {
  return projectEaslPath(rootPath);
}

function isProjectFilePath(easlPath: string) {
  return easlPath.split(/[/\\]/).filter(Boolean).pop() === PROJECT_FILE_NAME;
}

function serializeProject(project: ProjectFile): string {
  return JSON.stringify(
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
}

type ProjectUpdater = (project: ProjectFile) => ProjectFile | null;

function updateProject(
  set: (partial: Partial<ProjectState> | ((state: ProjectState) => Partial<ProjectState>)) => void,
  updater: ProjectUpdater,
  options?: { syncCheckpoint?: boolean; phase?: ProjectMeta["currentPhase"] },
) {
  set((state) => {
    if (!state.project) return state;

    const nextProject = updater(state.project);
    if (!nextProject) return state;

    if (options?.syncCheckpoint) {
      syncSessionCheckpointFromProject(nextProject, options.phase);
    }

    projectRevision++;
    return {
      project: nextProject,
      isDirty: true,
    };
  });
}

function resetProjectRevision() {
  projectRevision = 0;
}

/** @internal Exposed for unit tests only. */
export function __getProjectRevisionForTests() {
  return projectRevision;
}

/** @internal Exposed for unit tests only. */
export function __resetProjectRevisionForTests() {
  projectRevision = 0;
  saveChain = Promise.resolve();
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

    resetProjectRevision();
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

  /**
   * Create a new project at the given root path.
   *
   * @param rootPath - Absolute path to the project root directory.
   * @param name - Human-readable project name.
   * @param options - Required. `dataSource` is immutable for the project lifetime;
   *   callers MUST NOT mutate it after creation.
   */
  createProject: async (rootPath, name, options) => {
    if (!options?.dataSource) {
      throw new Error("createProject requires options.dataSource");
    }

    const project = DEFAULT_PROJECT_FILE(crypto.randomUUID(), name, rootPath);
    project.projectMeta.dataSource = options.dataSource;

    await writeTextFile(getProjectFilePath(rootPath), JSON.stringify(project, null, 2));

    try {
      if (await isBidsProject(rootPath)) {
        await ensureBidsIgnore(rootPath);
      }
    } catch (e) {
      console.warn("Failed to check BIDS project status or write .bidsignore:", e);
    }

    resetProjectRevision();
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
    const runSave = async () => {
      const { project, isDirty } = get();
      if (!project || !isDirty) {
        return;
      }

      const revisionAtSaveStart = projectRevision;
      const projectIdAtSaveStart = project.projectMeta.id;
      const snapshot = project;
      const serialized = serializeProject(snapshot);

      await writeTextFile(getProjectFilePath(snapshot.projectMeta.rootPath), serialized);

      const current = get().project;
      if (
        current?.projectMeta.id === projectIdAtSaveStart &&
        projectRevision === revisionAtSaveStart
      ) {
        set({ isDirty: false });
      }
    };

    saveChain = saveChain.then(runSave, runSave);
    return saveChain;
  },

  setPhase: (phase) => {
    updateProject(
      set,
      (project) => {
        if (!canAccessPhase(project, phase)) {
          return null;
        }

        return {
          ...project,
          projectMeta: {
            ...project.projectMeta,
            currentPhase: phase,
            lastOpened: new Date().toISOString(),
          },
        };
      },
      { syncCheckpoint: true, phase },
    );
  },

  toggleNavbar: () => {
    updateProject(set, (project) => ({
      ...project,
      uiState: {
        ...project.uiState,
        navbarCollapsed: !project.uiState?.navbarCollapsed,
      },
    }));
  },

  closeProject: () => {
    clearSessionCheckpoint();
    logAction("project_close");
    resetProjectRevision();
    saveChain = Promise.resolve();
    set({
      project: null,
      isDirty: false,
      loaded: false,
    });
  },

  setPopulationCompleted: (value) => {
    updateProject(set, (project) => {
      if (project.uiState?.processing?.population?.completed === value) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          processing: {
            ...project.uiState?.processing,
            population: {
              ...project.uiState?.processing?.population,
              completed: value,
            },
          },
        },
      };
    });
  },

  setManifestVerdict: (subjectSession, status, opts) => {
    if (status === "fail" && !opts.reason) {
      throw new Error("reason is required when status is fail");
    }

    updateProject(set, (project) => {
      const fallbackMtime = project.uiState?.processing?.population?.lastRun?.Mtime ?? Date.now();
      const verdict: ManifestVerdict = {
        status,
        reason: opts.reason as ManifestFailReason | undefined,
        notes: opts.notes,
        setAt: opts.setAt ?? fallbackMtime,
      };
      const prev = project.uiState?.manifest?.verdicts?.[subjectSession];
      if (prev?.status === "pass" && status === "fail" && opts.notes === undefined) {
        verdict.notes = undefined;
      }

      const nextVerdicts = {
        ...(project.uiState?.manifest?.verdicts ?? {}),
        [subjectSession]: verdict,
      };

      if (JSON.stringify(prev) === JSON.stringify(verdict)) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...project.uiState?.manifest,
            verdicts: nextVerdicts,
          },
        },
      };
    });
  },

  removeManifestVerdict: (subjectSession) => {
    updateProject(set, (project) => {
      const prev = project.uiState?.manifest?.verdicts ?? {};
      if (!(subjectSession in prev)) return null;
      const { [subjectSession]: _, ...remaining } = prev;

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...project.uiState?.manifest,
            verdicts: remaining,
          },
        },
      };
    });
  },

  setLastRunProfileId: (module, profileId, versions) => {
    updateProject(set, (project) => {
      const currentLastRun = project.uiState?.processing?.[module]?.lastRun;
      if (
        currentLastRun?.profileId === profileId &&
        currentLastRun?.exploreASLVersion === versions.exploreASLVersion &&
        currentLastRun?.matlabVersion === versions.matlabVersion &&
        currentLastRun?.guiVersion === versions.guiVersion
      ) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          processing: {
            ...project.uiState?.processing,
            [module]: {
              ...project.uiState?.processing?.[module],
              lastRun: {
                ...currentLastRun,
                profileId,
                exploreASLVersion: versions.exploreASLVersion,
                matlabVersion: versions.matlabVersion,
                guiVersion: versions.guiVersion,
              },
            },
          },
        },
      };
    });
  },

  setLastPopulationRunMtime: (mtime) => {
    updateProject(set, (project) => {
      if (project.uiState?.processing?.population?.lastRun?.Mtime === mtime) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          processing: {
            ...project.uiState?.processing,
            population: {
              ...project.uiState?.processing?.population,
              lastRun: {
                profileId:
                  project.uiState?.processing?.population?.lastRun?.profileId ??
                  "00000000-0000-0000-0000-000000000000",
                ...project.uiState?.processing?.population?.lastRun,
                Mtime: mtime,
              },
            },
          },
        },
      };
    });
  },

  syncImportState: (importState) => {
    updateProject(set, (project) => {
      const {
        activeStep,
        importPhase,
        importCompleted,
        mostRecentConfig,
        selectedProfileId,
        ...payload
      } = importState;

      // Gate mappingState: BIDS-direct projects own mappingState after confirm;
      // DICOM sync must not clobber the 4-field mappingState written by
      // confirmBidsReview. We still allow uiState.import fields to sync.
      const bidsConfirmed = project.uiState?.import?.bidsReviewConfirmed === true;
      const mappingChanged =
        !bidsConfirmed && JSON.stringify(project.mappingState) !== JSON.stringify(payload);

      const nextSelectedProfileId =
        selectedProfileId ?? project.uiState?.import?.selectedProfileId ?? undefined;

      if (
        !mappingChanged &&
        project.uiState?.import?.activeStep === activeStep &&
        project.uiState?.import?.currentPhase === importPhase &&
        project.uiState?.import?.completed === importCompleted &&
        project.uiState?.import?.selectedProfileId === nextSelectedProfileId &&
        JSON.stringify(project.uiState?.import?.mostRecentConfig) ===
          JSON.stringify(mostRecentConfig ?? project.uiState?.import?.mostRecentConfig ?? null)
      ) {
        return null;
      }

      return {
        ...project,
        ...(bidsConfirmed ? {} : { mappingState: payload }),
        uiState: {
          ...project.uiState,
          import: {
            ...project.uiState?.import,
            activeStep,
            currentPhase: importPhase,
            completed: importCompleted,
            bidsReviewConfirmed: project.uiState?.import?.bidsReviewConfirmed ?? false,
            skippedSubjects: project.uiState?.import?.skippedSubjects ?? [],
            selectedProfileId: nextSelectedProfileId,
            mostRecentConfig: mostRecentConfig ?? project.uiState?.import?.mostRecentConfig ?? null,
          },
        },
      };
    });
  },

  syncProcessingState: ({ config, processingPhase }) => {
    updateProject(set, (project) => {
      const persistedConfig = config && config.modules.length > 0 ? config : undefined;

      if (
        JSON.stringify(project.uiState?.processing?.config) === JSON.stringify(persistedConfig) &&
        project.uiState?.processing?.currentPhase === processingPhase
      ) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          processing: {
            config: persistedConfig,
            currentPhase: processingPhase,
          },
        },
      };
    });
  },

  syncDataParState: (dataPar, advancedVisibility) => {
    updateProject(set, (project) => {
      if (
        JSON.stringify(project.dataPar) === JSON.stringify(dataPar) &&
        JSON.stringify(project.uiState?.datapar?.advancedVisibility) ===
          JSON.stringify(advancedVisibility)
      ) {
        return null;
      }

      return {
        ...project,
        dataPar,
        uiState: {
          ...project.uiState,
          datapar: {
            ...project.uiState?.datapar,
            advancedVisibility,
          },
        },
      };
    });
  },

  syncVisualizationState: (dataVis) => {
    updateProject(set, (project) => {
      if (JSON.stringify(project.uiState?.dataVis) === JSON.stringify(dataVis)) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          dataVis,
        },
      };
    });
  },

  /**
   * Confirm BIDS review: project importStore.detectedGroups into
   * project.mappingState, persist uiState, advance to "parameters" phase.
   *
   * The caller (BIDSReviewPanel in Phase 7) MUST navigate to
   * `/project/:id/parameters` via React Router after this action resolves.
   */
  confirmBidsReview: async () => {
    const { project } = get();
    if (!project) throw new Error("No project loaded");

    // Read from importStore (cross-store access)
    const { useImportStore: importStore } = await import("./importStore");
    const { detectedGroups, skippedSubjects } = importStore.getState().bidsReview;

    console.debug("[projectStore] confirmBidsReview:", {
      groups: detectedGroups.length,
      skipped: skippedSubjects.length,
    });

    if (detectedGroups.length === 0) {
      throw new Error(
        "Confirm requires at least one detected BIDS group — re-scan before confirming",
      );
    }

    // Validate labels: non-empty + unique (case-insensitive)
    const labels = detectedGroups.map((g) => g.label);
    for (const label of labels) {
      if (!label.trim()) {
        throw new Error("All group labels must be non-empty");
      }
    }
    const lower = labels.map((l) => l.toLowerCase());
    const seen = new Set<string>();
    for (const l of lower) {
      if (seen.has(l)) {
        throw new Error("Duplicate label detected — labels must be unique (case-insensitive)");
      }
      seen.add(l);
    }

    // Project detectedGroups to MetadataGroup[] (id, label, bidsParams only)
    const metadataGroups: MetadataGroup[] = detectedGroups.map((g) => ({
      id: g.id,
      label: g.label,
      bidsParams: g.bidsParams,
    }));

    // Flatten to SubjectRow[]
    const subjectRows = flattenBidsGroupsToSubjectRows(detectedGroups);

    // Write to mappingState (only 4 fields) + uiState + phase
    updateProject(
      set,
      (proj) => ({
        ...proj,
        mappingState: {
          metadataGroups,
          subjectRows,
          ingestionComplete: true,
          sourceDataPath: proj.projectMeta.rootPath,
        },
        uiState: {
          ...proj.uiState,
          import: {
            ...proj.uiState?.import,
            skippedSubjects,
            bidsReviewConfirmed: true,
          },
        },
        projectMeta: {
          ...proj.projectMeta,
          currentPhase: "parameters",
        },
      }),
      { syncCheckpoint: true, phase: "parameters" },
    );

    // Save project
    await get().saveProject();

    logAction("bids_review_confirmed", {
      groupCount: metadataGroups.length,
      subjectCount: subjectRows.length,
      skippedCount: skippedSubjects.length,
    });
  },
}));
