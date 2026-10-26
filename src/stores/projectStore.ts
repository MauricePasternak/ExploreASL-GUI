import { create } from "zustand";
import { showErrorNotification } from "../lib/errorNotifications";
import type {
  ProjectEdit_Deserialize as ProjectEdit,
  ProjectInspection_Serialize as ProjectInspection,
  ProjectSnapshot_Serialize as ProjectSnapshot,
  BidsReviewGroup_Serialize as BidsReviewGroup,
} from "../generated/bindings";
import type {
  ProjectFile,
  ProjectPhase,
  ManifestVerdict,
  ManifestFailReason,
} from "../schemas/project";
import { projectView } from "../schemas/project";
import {
  acceptProjectEdit,
  createNativeProject,
  currentProjectSnapshot,
  inspectProject,
  readProjectSnapshot,
  saveNativeProject,
  ProjectStorageError,
  projectStorageErrorMessage,
} from "../lib/projectPersistence";
import {
  commitBidsProjectMutations,
  preflightBidsProjectMutations,
  type SetupPlan,
} from "../lib/bids/setup";
import {
  captureProjectLease,
  isCurrentProjectLease,
  isProjectWorkAccepted,
  registerProjectTask,
} from "../lib/projectLifecycle";
import { closeProjectRuntime, transitionProjectRuntime } from "../lib/projectCoordinator";
import { useGlobalStore } from "./globalStore";
import { useImportStore } from "./importStore";

type EditFactory = (project: ProjectFile) => ProjectEdit;
type VerdictOptions = { reason?: ManifestFailReason; notes?: string; setAt?: number };

interface ProjectState {
  project: ProjectFile | null;
  loaded: boolean;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  pendingEdits: number;
  draftErrors: Record<string, string>;
  recoveredFromBackup: boolean;
  recovery: (ProjectInspection & { easlPath: string; copied: boolean }) | null;
  acceptSnapshot: (snapshot: ProjectSnapshot) => void;
  submitEdit: (edit: ProjectEdit | EditFactory) => Promise<void>;
  setDraftError: (field: string, error: string | null) => void;
  flushEdits: () => Promise<void>;
  cancelAutosave: () => void;
  refreshProject: () => Promise<void>;
  loadProject: (
    path: string,
    options?: { inspection?: ProjectInspection; copied?: boolean },
  ) => Promise<void>;
  attachCurrentProject: (id: string) => Promise<boolean>;
  confirmRecovery: () => Promise<void>;
  declineRecovery: () => void;
  createProject: (
    root: string,
    name: string,
    options: { dataSource: "dicom" | "bids"; planId?: string },
  ) => Promise<void>;
  preflightProjectSetup: (
    root: string,
    name: string,
    source: "dicom" | "bids",
  ) => Promise<SetupPlan>;
  saveProject: (options?: { allowClosedAdmission?: boolean }) => Promise<void>;
  closeProject: () => Promise<void>;
  setPhase: (phase: ProjectPhase) => Promise<void>;
  toggleNavbar: () => Promise<void>;
  addReviewer: () => Promise<void>;
  removeReviewer: (id: string) => Promise<void>;
  renameReviewer: (id: string, label: string) => Promise<void>;
  setActiveReviewerId: (id: string) => Promise<void>;
  setManifestVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    options?: VerdictOptions,
    reviewerId?: string,
  ) => Promise<void>;
  removeManifestVerdict: (subjectSession: string, reviewerId?: string) => Promise<void>;
  setResolvedVerdict: (
    subjectSession: string,
    status: "pass" | "fail",
    options?: VerdictOptions,
  ) => Promise<void>;
  removeResolvedVerdict: (subjectSession: string) => Promise<void>;
  confirmBidsReview: () => Promise<void>;
}

let submissions: Promise<void> = Promise.resolve();
let autosave: ReturnType<typeof setTimeout> | undefined;

function validProfile(): string {
  const global = useGlobalStore.getState();
  if (!global.hasValidProfile())
    throw new Error(
      "Cannot open or create a project without at least one valid execution profile. Fix a profile in Settings.",
    );
  return (
    global.settings.executionProfiles.find(
      (profile) => global.profileValidationState[profile.id]?.valid,
    )?.id ?? ""
  );
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verdict(status: "pass" | "fail", options: VerdictOptions = {}): ManifestVerdict {
  return { status, ...options, setAt: options.setAt ?? 0 };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  loaded: false,
  isDirty: false,
  saving: false,
  saveError: null,
  pendingEdits: 0,
  draftErrors: {},
  recovery: null,
  recoveredFromBackup: false,
  acceptSnapshot: (snapshot) => {
    const current = get().project;
    if (
      current &&
      (current.activationGeneration !== snapshot.activationGeneration ||
        current.acceptedRevision > snapshot.acceptedRevision ||
        (current.acceptedRevision === snapshot.acceptedRevision &&
          current.persistedRevision > snapshot.persistedRevision))
    )
      return;
    set({
      project: projectView(snapshot),
      loaded: true,
      recoveredFromBackup: snapshot.recoveredFromBackup,
      isDirty:
        snapshot.recoveredFromBackup ||
        snapshot.acceptedRevision > snapshot.persistedRevision ||
        get().pendingEdits > 0 ||
        Object.keys(get().draftErrors).length > 0,
    });
  },
  setDraftError: (field, error) => {
    const errors = { ...get().draftErrors };
    if (error) errors[field] = error;
    else delete errors[field];
    const project = get().project;
    set({
      draftErrors: errors,
      isDirty:
        Object.keys(errors).length > 0 ||
        get().pendingEdits > 0 ||
        Boolean(
          project &&
          (project.recoveredFromBackup || project.acceptedRevision > project.persistedRevision),
        ),
    });
  },
  cancelAutosave: () => {
    clearTimeout(autosave);
    autosave = undefined;
  },
  submitEdit: (edit) => {
    const lease = captureProjectLease();
    const project = get().project;
    if (!lease || !project || !isProjectWorkAccepted())
      return Promise.reject(new Error("Project transition is in progress; edit was not admitted."));
    const previous = submissions;
    set({ pendingEdits: get().pendingEdits + 1, isDirty: true });
    const operation = registerProjectTask(async () => {
      await previous.catch(() => undefined);
      if (!isCurrentProjectLease(lease)) return;
      try {
        const before = get().project!;
        const accepted = await acceptProjectEdit(
          project.activationGeneration,
          typeof edit === "function" ? edit(before) : edit,
        );
        if (!isCurrentProjectLease(lease)) return;
        get().acceptSnapshot(accepted);
        set({ saveError: null });
        if (
          accepted.acceptedRevision > before.acceptedRevision &&
          accepted.acceptedRevision > accepted.persistedRevision
        ) {
          get().cancelAutosave();
          autosave = setTimeout(() => {
            if (isCurrentProjectLease(lease) && isProjectWorkAccepted())
              void get()
                .saveProject()
                .catch(() => undefined);
          }, 2000);
        }
      } catch (error) {
        if (isCurrentProjectLease(lease)) set({ saveError: failure(error), isDirty: true });
        throw error;
      } finally {
        if (isCurrentProjectLease(lease)) {
          const pendingEdits = get().pendingEdits - 1;
          const current = get().project;
          set({
            pendingEdits,
            isDirty:
              pendingEdits > 0 ||
              Boolean(get().saveError) ||
              Object.keys(get().draftErrors).length > 0 ||
              Boolean(
                current &&
                (current.recoveredFromBackup ||
                  current.acceptedRevision > current.persistedRevision),
              ),
          });
        }
      }
    });
    submissions = operation;
    return operation;
  },
  flushEdits: async () => {
    let pending: Promise<void>;
    do {
      pending = submissions;
      await pending;
    } while (pending !== submissions);
    const state = get();
    if (Object.keys(state.draftErrors).length) throw new Error(Object.values(state.draftErrors)[0]);
  },
  saveProject: async (options) => {
    const lease = captureProjectLease();
    if (!get().project) return;
    if (lease && !isProjectWorkAccepted() && !options?.allowClosedAdmission)
      throw new Error("Project transition is in progress; save was not admitted.");
    get().cancelAutosave();
    set({ saving: true });
    try {
      await get().flushEdits();
      const project = get().project;
      if (!project || !lease || !isCurrentProjectLease(lease)) return;
      const saved = await saveNativeProject(project.activationGeneration);
      if (isCurrentProjectLease(lease)) {
        get().acceptSnapshot(saved);
        set({ saveError: null });
      }
    } catch (error) {
      if (lease && isCurrentProjectLease(lease)) {
        set({ saveError: failure(error), isDirty: true });
        showErrorNotification({
          id: `project-save:${lease.projectId}`,
          title: "Project not saved",
          message: "Project changes could not be saved.",
          details:
            error instanceof ProjectStorageError
              ? projectStorageErrorMessage(error)
              : "Correct any invalid fields, then try Save again. Keep the project open until saving succeeds.",
          error,
        });
      }
      throw error;
    } finally {
      if (isCurrentProjectLease(lease)) set({ saving: false });
    }
  },
  refreshProject: async () => {
    const lease = captureProjectLease();
    const project = get().project;
    if (!project) return;
    const snapshot = await readProjectSnapshot(project.activationGeneration);
    if (isCurrentProjectLease(lease)) get().acceptSnapshot(snapshot);
  },
  loadProject: async (path, options) => {
    validProfile();
    const inspection =
      options?.inspection ??
      (await inspectProject(path, useGlobalStore.getState().settings.recentProjects));
    if (inspection.recoveredFromBackup) {
      set({ recovery: { ...inspection, easlPath: path, copied: options?.copied ?? false } });
      return;
    }
    await transitionProjectRuntime(inspection, { copied: options?.copied ?? false });
  },
  attachCurrentProject: async (id) => {
    validProfile();
    const snapshot = await currentProjectSnapshot();
    if (!snapshot || snapshot.document.projectMeta.id !== id) return false;
    await transitionProjectRuntime(snapshot);
    return true;
  },
  confirmRecovery: async () => {
    const recovery = get().recovery;
    if (recovery)
      await transitionProjectRuntime(recovery, { confirmBackup: true, copied: recovery.copied });
  },
  declineRecovery: () => set({ recovery: null }),
  preflightProjectSetup: (root, name, source) =>
    preflightBidsProjectMutations(root, source, name, validProfile()),
  createProject: async (root, name, options) => {
    const profile = validProfile();
    if (!options?.dataSource) throw new Error("createProject requires options.dataSource");
    if (options.planId) {
      const result = await commitBidsProjectMutations(options.planId);
      if (!result.candidateId || !result.projectDocument || !result.projectPath)
        throw new Error("Setup repair cannot create a project.");
      await transitionProjectRuntime({
        candidateId: result.candidateId,
        projectId: result.projectDocument.projectMeta.id,
        name: result.projectDocument.projectMeta.name,
        rootPath: root,
        recoveredFromBackup: false,
        duplicatePath: null,
        movedFrom: null,
        setupRecovered: 0,
      });
    } else
      await transitionProjectRuntime(
        await createNativeProject(root, name, options.dataSource, profile),
      );
  },
  closeProject: () => closeProjectRuntime(),
  setPhase: (phase) => get().submitEdit({ kind: "phase", phase }),
  toggleNavbar: () =>
    get().submitEdit((project) => ({
      kind: "navbar",
      collapsed: !(project.uiState.navbarCollapsed ?? true),
    })),
  addReviewer: () => get().submitEdit({ kind: "addReviewer" }),
  removeReviewer: (id) => get().submitEdit({ kind: "removeReviewer", id }),
  renameReviewer: (id, label) => get().submitEdit({ kind: "renameReviewer", id, label }),
  setActiveReviewerId: (id) => get().submitEdit({ kind: "activeReviewer", id }),
  setManifestVerdict: (subjectSession, status, options, reviewerId) =>
    get().submitEdit({
      kind: "verdict",
      subjectSession,
      reviewerId: reviewerId ?? null,
      value: verdict(status, options),
    }),
  removeManifestVerdict: (subjectSession, reviewerId) =>
    get().submitEdit({
      kind: "verdict",
      subjectSession,
      reviewerId: reviewerId ?? null,
      value: null,
    }),
  setResolvedVerdict: (subjectSession, status, options) =>
    get().submitEdit({ kind: "resolution", subjectSession, value: verdict(status, options) }),
  removeResolvedVerdict: (subjectSession) =>
    get().submitEdit({ kind: "resolution", subjectSession, value: null }),
  confirmBidsReview: async () => {
    const review = useImportStore.getState().bidsReview;
    // Draft metadata may contain null/unknown JSON; native acceptance validates it.
    await get().submitEdit(() => {
      if (Object.keys(get().draftErrors).length)
        throw new Error(Object.values(get().draftErrors)[0]);
      return {
        kind: "confirmBids",
        groups: review.detectedGroups as unknown as BidsReviewGroup[],
        skipped: review.skippedSubjects,
      };
    });
  },
}));
