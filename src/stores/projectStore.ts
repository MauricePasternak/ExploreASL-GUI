import { readTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";

import { ensureBidsIgnore, isBidsProject } from "../lib/bids/validation";
import { logAction } from "../lib/debug";
import {
  atomicWriteProject,
  cleanupProjectTemps,
  ProjectStorageError,
} from "../lib/projectPersistence";
import {
  clearSessionCheckpoint,
  projectEaslPath,
  syncSessionCheckpointFromProject,
} from "../lib/sessionCheckpoint";
import type { DataParState } from "../schemas/dataParSchema";
import {
  canAccessPhase,
  DEFAULT_PROJECT_FILE,
  ManifestVerdictSchema,
  PROJECT_FILE_NAME,
  parseProject,
  ProjectMalformedError,
  serializeProject,
  type ManifestUiState,
  type ProjectFile,
  type ProjectMeta,
  type Reviewer,
  type VersionedProjectFile,
} from "../schemas/project";
import { flattenBidsGroupsToSubjectRows } from "../lib/bids/subjectRows";
import type { MetadataGroup } from "../schemas/importSchemas";
import type { ManifestFailReason, ManifestVerdict } from "../schemas/project";
import { MAX_REVIEWERS } from "../schemas/manifestSchemas";
import { useImportStore, type ImportState } from "./importStore";
import type { ProcessingState } from "./processingStore";
import { useGlobalStore } from "./globalStore";

type DataVisState = NonNullable<ProjectFile["uiState"]["dataVis"]>;
type DataParAdvancedVisibility = NonNullable<
  NonNullable<ProjectFile["uiState"]["datapar"]>["advancedVisibility"]
>;
type ManifestVerdictOptions = {
  reason?: ManifestFailReason;
  notes?: string;
  setAt?: number;
};
type FlatManifestVerdicts = Record<string, ManifestVerdict>;
type NestedManifestVerdicts = Record<string, FlatManifestVerdicts>;

interface ProjectState {
  project: ProjectFile | null;
  isDirty: boolean;
  loaded: boolean;
  recovery: { easlPath: string; backupPath: string; projectId: string } | null;
  recoveredFromBackup: boolean;
  loadProject: (easlPath: string) => Promise<void>;
  confirmRecovery: () => Promise<void>;
  declineRecovery: () => void;
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
    opts?: ManifestVerdictOptions,
    reviewerId?: string,
  ) => void;
  removeManifestVerdict: (subjectSession: string, reviewerId?: string) => void;
  addReviewer: () => void;
  removeReviewer: (id: string) => void;
  renameReviewer: (id: string, label: string) => void;
  setActiveReviewerId: (id: string) => void;
  setResolvedVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    opts?: ManifestVerdictOptions,
  ) => void;
  removeResolvedVerdict: (subjectSession: string) => void;
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

/** Changes whenever the active project lifecycle changes; guards stale saves after reopen. */
let projectSession = 0;

function getProjectFilePath(rootPath: string) {
  return projectEaslPath(rootPath);
}

function isProjectFilePath(easlPath: string) {
  return easlPath.split(/[/\\]/).filter(Boolean).pop() === PROJECT_FILE_NAME;
}

/** Derive a parent path without assuming the host path separator in tests or restored paths. */
function projectRootFromEaslPath(easlPath: string) {
  const separatorIndex = Math.max(easlPath.lastIndexOf("/"), easlPath.lastIndexOf("\\"));
  if (separatorIndex < 0) return ".";
  if (separatorIndex === 0) return easlPath[0];

  const parent = easlPath.slice(0, separatorIndex);
  // A file directly under a Windows drive root has a parent of `C:\\`, not `C:`.
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${easlPath[separatorIndex]}` : parent;
}

function backupPathFor(easlPath: string) {
  return `${easlPath}.bak`;
}

function isMissingFileError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return true;
  }
  const message = errorMessage(error);
  return /(?:enoent|not found|does not exist|no such file)/i.test(message);
}

function isPermissionError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EACCES", "EPERM"].includes(String((error as { code?: unknown }).code))
  ) {
    return true;
  }
  const message = errorMessage(error);
  return /(?:permission denied|access denied|operation not permitted)/i.test(message);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return "";
}

function recoveryFailed(cause: unknown) {
  return Object.assign(
    new ProjectStorageError(
      "recovery",
      "Project recovery failed: backup is missing, malformed, or unsupported.",
    ),
    { cause },
  );
}

async function cleanupValidatedProjectTemps(easlPath: string) {
  try {
    await cleanupProjectTemps(easlPath);
  } catch (error) {
    console.warn("Failed to clean stale project temporary files:", error);
  }
}

/** Serialize and validate before entering the native filesystem-write boundary. */
function serializeForStorage(project: ProjectFile): string {
  try {
    return serializeProject(project as VersionedProjectFile);
  } catch (error) {
    throw Object.assign(
      new ProjectStorageError(
        "invalid_serialization",
        "Project data failed validation and was not written.",
      ),
      { cause: error },
    );
  }
}

function isManifestVerdict(value: unknown): value is ManifestVerdict {
  return ManifestVerdictSchema.safeParse(value).success;
}

function isManifestVerdictRecord(value: unknown): value is FlatManifestVerdicts {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isManifestVerdict)
  );
}

function isMultiReviewerMode(manifest: ManifestUiState | undefined) {
  return (manifest?.reviewers?.length ?? 0) > 1;
}

function flatManifestVerdicts(manifest: ManifestUiState | undefined): FlatManifestVerdicts {
  return isManifestVerdictRecord(manifest?.verdicts) ? { ...manifest.verdicts } : {};
}

function manifestResolvedVerdicts(manifest: ManifestUiState | undefined): FlatManifestVerdicts {
  return isManifestVerdictRecord(manifest?.resolvedVerdicts)
    ? { ...manifest.resolvedVerdicts }
    : {};
}

function nestedManifestVerdicts(manifest: ManifestUiState | undefined): NestedManifestVerdicts {
  const verdicts = manifest?.verdicts;
  if (typeof verdicts !== "object" || verdicts === null || Array.isArray(verdicts)) return {};

  return Object.entries(verdicts).reduce<NestedManifestVerdicts>((slices, [reviewerId, slice]) => {
    if (isManifestVerdictRecord(slice)) slices[reviewerId] = { ...slice };
    return slices;
  }, {});
}

function currentManifestMtime(project: ProjectFile) {
  return project.uiState?.processing?.population?.lastRun?.Mtime ?? Date.now();
}

function createManifestVerdict(
  status: "pass" | "fail",
  opts: ManifestVerdictOptions,
  fallbackMtime: number,
): ManifestVerdict {
  return ManifestVerdictSchema.parse({
    status,
    ...(opts.reason === undefined ? {} : { reason: opts.reason }),
    ...(opts.notes === undefined ? {} : { notes: opts.notes }),
    setAt: opts.setAt ?? fallbackMtime,
  });
}

function createReviewer(label: string): Reviewer {
  return {
    id: crypto.randomUUID(),
    label,
    createdAt: new Date().toISOString(),
  };
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

function startProjectSession() {
  projectSession++;
  resetProjectRevision();
}

/** @internal Exposed for unit tests only. */
export function __getProjectRevisionForTests() {
  return projectRevision;
}

/** @internal Exposed for unit tests only. */
export function __resetProjectRevisionForTests() {
  projectRevision = 0;
  projectSession = 0;
  saveChain = Promise.resolve();
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  isDirty: false,
  loaded: false,
  recovery: null,
  recoveredFromBackup: false,

  loadProject: async (easlPath) => {
    if (!useGlobalStore.getState().hasValidProfile()) {
      throw new Error(
        "Cannot open a project without at least one valid execution profile. Fix a profile in Settings.",
      );
    }

    if (!isProjectFilePath(easlPath)) {
      throw new Error(`Project files must be named ${PROJECT_FILE_NAME}.`);
    }

    let parsed: ProjectFile;
    try {
      parsed = parseProject(await readTextFile(easlPath));
    } catch (error) {
      if (!(error instanceof ProjectMalformedError) && !isMissingFileError(error)) {
        if (isPermissionError(error)) {
          throw new ProjectStorageError(
            "permission_denied",
            "Permission denied while reading the primary project file.",
          );
        }
        throw error;
      }

      const backupPath = backupPathFor(easlPath);
      let backup: ProjectFile;
      try {
        backup = parseProject(await readTextFile(backupPath));
      } catch (backupError) {
        console.warn("Project backup validation failed:", backupError);
        throw recoveryFailed(backupError);
      }
      // A recovery prompt cannot leave a previously opened project active.
      // Declining must return the store to an unloaded state without touching project files.
      startProjectSession();
      clearSessionCheckpoint();
      set({
        project: null,
        isDirty: false,
        loaded: false,
        recovery: { easlPath, backupPath, projectId: backup.projectMeta.id },
        recoveredFromBackup: false,
      });
      return;
    }
    await cleanupValidatedProjectTemps(easlPath);
    const hydratedProject: ProjectFile = {
      ...parsed,
      projectMeta: {
        ...parsed.projectMeta,
        rootPath: projectRootFromEaslPath(easlPath),
      },
    };

    const rootPath = hydratedProject.projectMeta.rootPath;
    try {
      if (await isBidsProject(rootPath)) {
        await ensureBidsIgnore(rootPath);
      }
    } catch (e) {
      console.warn("Failed to check BIDS project status or write .bidsignore:", e);
    }

    startProjectSession();
    set({
      project: hydratedProject,
      isDirty: false,
      loaded: true,
      recovery: null,
      recoveredFromBackup: false,
    });
    logAction("project_load", {
      name: hydratedProject.projectMeta.name,
      path: hydratedProject.projectMeta.rootPath,
    });
    syncSessionCheckpointFromProject(hydratedProject);
  },

  confirmRecovery: async () => {
    const recovery = get().recovery;
    if (!recovery) return;

    let parsed: ProjectFile;
    try {
      parsed = parseProject(await readTextFile(recovery.backupPath));
    } catch (error) {
      console.warn("Project backup recovery failed:", error);
      throw recoveryFailed(error);
    }
    await cleanupValidatedProjectTemps(recovery.easlPath);
    const hydratedProject: ProjectFile = {
      ...parsed,
      projectMeta: { ...parsed.projectMeta, rootPath: projectRootFromEaslPath(recovery.easlPath) },
    };
    startProjectSession();
    set({
      project: hydratedProject,
      isDirty: true,
      loaded: true,
      recovery: null,
      recoveredFromBackup: true,
    });
    syncSessionCheckpointFromProject(hydratedProject);
  },

  declineRecovery: () => {
    startProjectSession();
    clearSessionCheckpoint();
    set({
      project: null,
      isDirty: false,
      loaded: false,
      recovery: null,
      recoveredFromBackup: false,
    });
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

    const global = useGlobalStore.getState();
    if (!global.hasValidProfile()) {
      throw new Error(
        "Cannot create a project without at least one valid execution profile. Fix a profile in Settings.",
      );
    }

    const project = DEFAULT_PROJECT_FILE(crypto.randomUUID(), name, rootPath);
    project.projectMeta.dataSource = options.dataSource;

    const firstValidProfile = global.settings.executionProfiles.find(
      (profile) => global.profileValidationState[profile.id]?.valid === true,
    );
    if (firstValidProfile) {
      project.uiState = {
        ...project.uiState,
        import: {
          bidsReviewConfirmed: false,
          skippedSubjects: [],
          ...project.uiState.import,
          selectedProfileId: firstValidProfile.id,
        },
      };
    }

    await atomicWriteProject({
      projectPath: getProjectFilePath(rootPath),
      canonicalBytes: serializeForStorage(project),
      preserveBackup: false,
    });

    try {
      if (await isBidsProject(rootPath)) {
        await ensureBidsIgnore(rootPath);
      }
    } catch (e) {
      console.warn("Failed to check BIDS project status or write .bidsignore:", e);
    }

    startProjectSession();
    set({
      project,
      isDirty: false,
      loaded: true,
      recovery: null,
      recoveredFromBackup: false,
    });
    logAction("project_create", {
      name: project.projectMeta.name,
      path: project.projectMeta.rootPath,
    });
    syncSessionCheckpointFromProject(project);
  },

  saveProject: async () => {
    const runSave = async () => {
      const { project, isDirty, recoveredFromBackup } = get();
      if (!project || !isDirty) {
        return;
      }

      const revisionAtSaveStart = projectRevision;
      const sessionAtSaveStart = projectSession;
      const projectIdAtSaveStart = project.projectMeta.id;
      const snapshot = project;
      const serialized = serializeForStorage(snapshot);

      await atomicWriteProject({
        projectPath: getProjectFilePath(snapshot.projectMeta.rootPath),
        canonicalBytes: serialized,
        preserveBackup: recoveredFromBackup,
      });

      const current = get().project;
      if (
        current?.projectMeta.id === projectIdAtSaveStart &&
        projectSession === sessionAtSaveStart &&
        projectRevision === revisionAtSaveStart
      ) {
        set({ isDirty: false, recoveredFromBackup: false });
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
    startProjectSession();
    set({
      project: null,
      isDirty: false,
      loaded: false,
      recovery: null,
      recoveredFromBackup: false,
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

  addReviewer: () => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;
      const currentReviewers = manifest?.reviewers;

      if (!currentReviewers || currentReviewers.length === 0) {
        const firstReviewer = createReviewer("Reviewer 1");
        const secondReviewer = createReviewer("Reviewer 2");
        return {
          ...project,
          uiState: {
            ...project.uiState,
            manifest: {
              ...manifest,
              reviewers: [firstReviewer, secondReviewer],
              activeReviewerId: firstReviewer.id,
              verdicts: { [firstReviewer.id]: flatManifestVerdicts(manifest) },
            },
          },
        };
      }

      if (currentReviewers.length >= MAX_REVIEWERS) return null;

      const nextReviewer = createReviewer(`Reviewer ${currentReviewers.length + 1}`);
      const nextReviewers = [...currentReviewers, nextReviewer];

      if (currentReviewers.length === 1) {
        const firstReviewer = currentReviewers[0];
        return {
          ...project,
          uiState: {
            ...project.uiState,
            manifest: {
              ...manifest,
              reviewers: nextReviewers,
              activeReviewerId: firstReviewer.id,
              verdicts: { [firstReviewer.id]: flatManifestVerdicts(manifest) },
            },
          },
        };
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            reviewers: nextReviewers,
            verdicts: nestedManifestVerdicts(manifest),
          },
        },
      };
    });
  },

  removeReviewer: (id) => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;
      const currentReviewers = manifest?.reviewers;
      if (!currentReviewers || currentReviewers.length <= 1) return null;

      const remainingReviewers = currentReviewers.filter((reviewer) => reviewer.id !== id);
      if (remainingReviewers.length === currentReviewers.length) return null;

      const verdicts = nestedManifestVerdicts(manifest);
      const { [id]: _, ...remainingVerdicts } = verdicts;

      if (remainingReviewers.length === 1) {
        const remainingReviewer = remainingReviewers[0];
        const {
          reviewers: _reviewers,
          activeReviewerId: _activeReviewerId,
          resolvedVerdicts: _resolvedVerdicts,
          ...singleReviewerManifest
        } = manifest ?? {};
        return {
          ...project,
          uiState: {
            ...project.uiState,
            manifest: {
              ...singleReviewerManifest,
              verdicts: remainingVerdicts[remainingReviewer.id] ?? {},
            },
          },
        };
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            reviewers: remainingReviewers,
            activeReviewerId:
              manifest?.activeReviewerId === id
                ? remainingReviewers[0].id
                : manifest?.activeReviewerId,
            verdicts: remainingVerdicts,
          },
        },
      };
    });
  },

  renameReviewer: (id, label) => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;
      const reviewers = manifest?.reviewers;
      if (!reviewers || label.length === 0 || label.length > 100) return null;

      const reviewerIndex = reviewers.findIndex((reviewer) => reviewer.id === id);
      if (reviewerIndex === -1 || reviewers[reviewerIndex].label === label) return null;

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            reviewers: reviewers.map((reviewer) =>
              reviewer.id === id ? { ...reviewer, label } : reviewer,
            ),
          },
        },
      };
    });
  },

  setActiveReviewerId: (id) => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;
      if (
        !isMultiReviewerMode(manifest) ||
        manifest?.activeReviewerId === id ||
        !manifest?.reviewers?.some((reviewer) => reviewer.id === id)
      ) {
        return null;
      }

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            activeReviewerId: id,
          },
        },
      };
    });
  },

  setManifestVerdict: (subjectSession, status, opts = {}, reviewerId) => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;
      const verdict = createManifestVerdict(status, opts, currentManifestMtime(project));

      if (!isMultiReviewerMode(manifest)) {
        const verdicts = flatManifestVerdicts(manifest);
        const previous = verdicts[subjectSession];
        if (JSON.stringify(previous) === JSON.stringify(verdict)) return null;

        return {
          ...project,
          uiState: {
            ...project.uiState,
            manifest: {
              ...manifest,
              verdicts: { ...verdicts, [subjectSession]: verdict },
            },
          },
        };
      }

      const targetReviewerId = reviewerId ?? manifest?.activeReviewerId;
      if (
        !targetReviewerId ||
        !manifest?.reviewers?.some((reviewer) => reviewer.id === targetReviewerId)
      ) {
        return null;
      }

      const verdicts = nestedManifestVerdicts(manifest);
      const reviewerVerdicts = verdicts[targetReviewerId] ?? {};
      if (JSON.stringify(reviewerVerdicts[subjectSession]) === JSON.stringify(verdict)) return null;
      const resolvedVerdicts = manifestResolvedVerdicts(manifest);
      const { [subjectSession]: _, ...remainingResolvedVerdicts } = resolvedVerdicts;

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            verdicts: {
              ...verdicts,
              [targetReviewerId]: { ...reviewerVerdicts, [subjectSession]: verdict },
            },
            ...(subjectSession in resolvedVerdicts
              ? { resolvedVerdicts: remainingResolvedVerdicts }
              : {}),
          },
        },
      };
    });
  },

  removeManifestVerdict: (subjectSession, reviewerId) => {
    updateProject(set, (project) => {
      const manifest = project.uiState?.manifest;

      if (!isMultiReviewerMode(manifest)) {
        const verdicts = flatManifestVerdicts(manifest);
        if (!(subjectSession in verdicts)) return null;
        const { [subjectSession]: _, ...remaining } = verdicts;
        return {
          ...project,
          uiState: {
            ...project.uiState,
            manifest: { ...manifest, verdicts: remaining },
          },
        };
      }

      const targetReviewerId = reviewerId ?? manifest?.activeReviewerId;
      if (
        !targetReviewerId ||
        !manifest?.reviewers?.some((reviewer) => reviewer.id === targetReviewerId)
      ) {
        return null;
      }

      const verdicts = nestedManifestVerdicts(manifest);
      const reviewerVerdicts = verdicts[targetReviewerId];
      if (!reviewerVerdicts || !(subjectSession in reviewerVerdicts)) return null;
      const { [subjectSession]: _, ...remainingReviewerVerdicts } = reviewerVerdicts;
      const resolvedVerdicts = manifestResolvedVerdicts(manifest);
      const { [subjectSession]: _resolved, ...remainingResolvedVerdicts } = resolvedVerdicts;
      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...manifest,
            verdicts: { ...verdicts, [targetReviewerId]: remainingReviewerVerdicts },
            ...(subjectSession in resolvedVerdicts
              ? { resolvedVerdicts: remainingResolvedVerdicts }
              : {}),
          },
        },
      };
    });
  },

  setResolvedVerdict: (subjectSession, status, opts = {}) => {
    updateProject(set, (project) => {
      const resolvedVerdicts = manifestResolvedVerdicts(project.uiState?.manifest);
      const verdict = createManifestVerdict(status, opts, currentManifestMtime(project));
      if (JSON.stringify(resolvedVerdicts[subjectSession]) === JSON.stringify(verdict)) return null;

      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...project.uiState?.manifest,
            resolvedVerdicts: { ...resolvedVerdicts, [subjectSession]: verdict },
          },
        },
      };
    });
  },

  removeResolvedVerdict: (subjectSession) => {
    updateProject(set, (project) => {
      const resolvedVerdicts = manifestResolvedVerdicts(project.uiState?.manifest);
      if (!(subjectSession in resolvedVerdicts)) return null;
      const { [subjectSession]: _, ...remaining } = resolvedVerdicts;
      return {
        ...project,
        uiState: {
          ...project.uiState,
          manifest: {
            ...project.uiState?.manifest,
            resolvedVerdicts: remaining,
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
            ...project.uiState?.processing,
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
    const { detectedGroups, skippedSubjects } = useImportStore.getState().bidsReview;

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
