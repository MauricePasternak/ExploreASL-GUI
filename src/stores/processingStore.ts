import { create } from "zustand";
import {
  ProcessingRequestSchema,
  type ProcessingPhase,
  type ProcessingRunSnapshot,
  type ProcessingAvailableAction,
  type SubjectInfo,
  type SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { useProjectStore } from "./projectStore";
import type { ProcessingConfig_Serialize as ProcessConfig } from "../generated/bindings";
import { useGlobalStore } from "./globalStore";
import { acceptedDataPar } from "./dataParStore";
import { aslRunsEqual, normalizeAslRunId } from "../lib/aslRun";
import { assembleDataPar } from "../lib/assembleDataPar";
import { hasMissingParameterSwitches, SWITCH_CONFIRMATION_GUIDANCE } from "../lib/dataParDefaults";
import {
  attachRun,
  confirmProcessingWorkersStopped,
  getActiveRun,
  loadLockStatus,
  loadSubjects,
  projectProcessingSnapshot,
  reserveProcessingRun,
  runProcessingPipeline,
  setupProcessingListeners,
  stopProcessingPipeline,
} from "../lib/processingEvents";
import {
  captureProjectLease,
  isCurrentProjectLease,
  registerProjectTask,
} from "../lib/projectLifecycle";

export interface ProcessingState {
  processingPhase: ProcessingPhase;
  availableSubjects: SubjectInfo[];
  subjectStatuses: SubjectModuleStatus[];
  activeRunId: string | null;
  terminalRunId: string | null;
  snapshot: ProcessingRunSnapshot | null;
  attachmentGeneration: number | null;
  availableAction: ProcessingAvailableAction;
  actionPending: boolean;
  processingError: string | null;
  bidsCompatibilityError: string | null;
  profileError: string | null;
  preparingMessage: string | null;
  setConfig: (
    update: ProcessConfig | ((current: ProcessConfig | undefined) => ProcessConfig),
  ) => Promise<void>;
  bindRunSnapshot: (snapshot: ProcessingRunSnapshot) => void;
  reconcileRunSnapshot: (snapshot: ProcessingRunSnapshot) => void;
  synchronizeProcessingRun: () => Promise<void>;
  startProcessing: () => Promise<void>;
  killProcessing: () => Promise<void>;
  confirmProcessingStopped: () => Promise<void>;
  updateSubjectStatus: (status: SubjectModuleStatus) => void;
  setPhase: (phase: ProcessingPhase) => void;
  setAvailableSubjects: (subjects: SubjectInfo[]) => void;
  scanAvailableSubjects: () => Promise<void>;
  loadLockFileStatus: () => Promise<void>;
  hydrateProcessing: () => void;
  resetProcessing: () => Promise<void>;
  clearBidsCompatibilityError: () => Promise<void>;
  clearProfileError: () => void;
}

function createInitialProcessingState() {
  return {
    processingPhase: "idle" as ProcessingPhase,
    availableSubjects: [] as SubjectInfo[],
    subjectStatuses: [] as SubjectModuleStatus[],
    activeRunId: null as string | null,
    terminalRunId: null as string | null,
    snapshot: null as ProcessingRunSnapshot | null,
    attachmentGeneration: null as number | null,
    availableAction: "none" as ProcessingAvailableAction,
    actionPending: false,
    processingError: null as string | null,
    bidsCompatibilityError: null as string | null,
    profileError: null as string | null,
    preparingMessage: null as string | null,
  };
}

let processingListeners: { runId: string; generation: number; cleanup: () => void } | null = null;
let attachment: { generation: number; runId: string; promise: Promise<void> } | null = null;
export function clearProcessingListeners(runId?: string) {
  if (!processingListeners || (runId && processingListeners.runId !== runId)) return;
  processingListeners.cleanup();
  processingListeners = null;
}

export function isActiveProcessingPhase(phase: ProcessingPhase): boolean {
  return ["preparing", "running", "finalizing", "cancelling"].includes(phase);
}

function ownsSnapshot(snapshot: ProcessingRunSnapshot): boolean {
  const lease = captureProjectLease();
  const project = useProjectStore.getState().project;
  return Boolean(
    lease &&
    isCurrentProjectLease(lease) &&
    project?.projectMeta.id === lease.projectId &&
    project.projectMeta.rootPath === lease.rootPath &&
    snapshot.projectRoot === lease.rootPath,
  );
}

function hasActiveProcessingProject(): boolean {
  const lease = captureProjectLease();
  const project = useProjectStore.getState().project;
  return Boolean(
    lease &&
    project &&
    isCurrentProjectLease(lease) &&
    project.projectMeta.id === lease.projectId &&
    project.projectMeta.rootPath === lease.rootPath,
  );
}

/** Listener readiness never gates native launch. Final attachment closes missed-event races. */
async function attachProcessingListeners(runId: string): Promise<void> {
  const lease = captureProjectLease();
  if (!lease) return;
  if (attachment?.generation === lease.generation && attachment.runId === runId)
    return attachment.promise;
  if (processingListeners?.generation === lease.generation && processingListeners.runId === runId)
    return;
  const promise = (async () => {
    const context = {
      operation: "setup_processing_listeners",
      runId,
      phase: useProcessingStore.getState().processingPhase,
      projectGeneration: lease.generation,
    };
    let snapshot: ProcessingRunSnapshot;
    try {
      const cleanup = await setupProcessingListeners(runId);
      const state = useProcessingStore.getState();
      if (
        !isCurrentProjectLease(lease) ||
        (state.activeRunId !== runId && state.terminalRunId !== runId)
      ) {
        cleanup();
        return;
      }
      clearProcessingListeners();
      processingListeners = { runId, generation: lease.generation, cleanup };
      context.operation = "attach_run";
      snapshot = await attachRun(runId);
    } catch (error) {
      console.error("[processing] Listener attachment failed", context, error);
      throw error;
    }
    await projectProcessingSnapshot(snapshot, lease);
  })();
  attachment = { generation: lease.generation, runId, promise };
  try {
    await promise;
  } finally {
    if (attachment?.promise === promise) attachment = null;
  }
}

export const useProcessingStore = create<ProcessingState>((set) => {
  const projectSnapshot = (snapshot: ProcessingRunSnapshot, bind: boolean) => {
    if (!ownsSnapshot(snapshot)) return;
    const lease = captureProjectLease()!;
    const state = useProcessingStore.getState();
    const sameRun =
      state.snapshot?.runId === snapshot.runId && state.attachmentGeneration === lease.generation;
    if (sameRun && snapshot.revision <= state.snapshot!.revision) return;
    if (
      !bind &&
      (!sameRun || (state.activeRunId !== snapshot.runId && state.terminalRunId !== snapshot.runId))
    )
      return;
    if (bind && !sameRun && (state.activeRunId || state.terminalRunId)) return;
    const active = isActiveProcessingPhase(snapshot.lifecycle);
    const statuses = snapshot.expectedTargets.map((target): SubjectModuleStatus => {
      const previous = sameRun
        ? state.subjectStatuses.find(
            (s) =>
              s.module === target.module &&
              s.subjectSession === (target.subjectSession ?? "") &&
              aslRunsEqual(s.run, target.run ?? undefined),
          )
        : undefined;
      return {
        subjectSession: target.subjectSession ?? "",
        module: target.module,
        run: target.run ?? undefined,
        status: target.complete
          ? "complete"
          : previous?.status === "incomplete"
            ? "incomplete"
            : "pending",
        completedSteps: previous?.completedSteps ?? [],
        locked: active && (previous?.locked ?? false),
      };
    });
    set({
      snapshot,
      attachmentGeneration: lease.generation,
      activeRunId: active ? snapshot.runId : null,
      terminalRunId: active ? null : snapshot.runId,
      processingPhase: snapshot.lifecycle,
      availableAction: snapshot.availableAction,
      preparingMessage: snapshot.lifecycle === "preparing" ? "Preparing processing..." : null,
      processingError: snapshot.error?.message ?? null,
      ...(snapshot.error?.code === "bidsCompatibility"
        ? { bidsCompatibilityError: snapshot.error.message }
        : {}),
      ...(snapshot.expectedTargets.length > 0 || snapshot.executionCommitted
        ? {
            // Population preparation leaves subject-module statuses untouched.
            subjectStatuses:
              snapshot.selectedModules.length === 1 && snapshot.selectedModules[0] === "population"
                ? [...state.subjectStatuses.filter((s) => s.module !== "population"), ...statuses]
                : statuses,
          }
        : {}),
    });
  };
  return {
    ...createInitialProcessingState(),
    setConfig: (update) =>
      useProjectStore.getState().submitEdit((project) => ({
        kind: "processing",
        config: typeof update === "function" ? update(project.uiState.processing?.config) : update,
      })),

    bindRunSnapshot: (snapshot) => projectSnapshot(snapshot, true),
    reconcileRunSnapshot: (snapshot) => projectSnapshot(snapshot, false),

    synchronizeProcessingRun: () =>
      registerProjectTask(async () => {
        const lease = captureProjectLease();
        if (!lease) return;
        const state = useProcessingStore.getState();
        const context = {
          operation: "get_active_run",
          runId: state.activeRunId ?? state.terminalRunId,
          phase: state.processingPhase,
          projectGeneration: lease.generation,
        };
        let active: ProcessingRunSnapshot | null;
        try {
          active = await getActiveRun();
        } catch (error) {
          console.error("[processing] Run discovery failed", context, error);
          throw error;
        }
        if (!isCurrentProjectLease(lease)) return;
        if (!active) {
          clearProcessingListeners();
          set((state) => ({
            activeRunId: null,
            terminalRunId: null,
            availableAction: "none",
            ...(isActiveProcessingPhase(state.processingPhase)
              ? { processingPhase: "idle", preparingMessage: null }
              : {}),
          }));
          return;
        }
        useProcessingStore.getState().bindRunSnapshot(active);
        console.info("[processing] Recovering run attachment", {
          operation: "synchronize_processing_run",
          runId: active.runId,
          phase: active.lifecycle,
          projectGeneration: lease.generation,
        });
        await useProjectStore.getState().refreshProject();
        if (!isCurrentProjectLease(lease)) return;
        await attachProcessingListeners(active.runId);
        await projectProcessingSnapshot(active, lease);
      }),

    startProcessing: () =>
      registerProjectTask(async () => {
        const lease = captureProjectLease();
        const state = useProcessingStore.getState();
        if (state.activeRunId || state.terminalRunId || state.actionPending) return;
        const context = {
          operation: "flush_edits",
          runId: null as string | null,
          phase: state.processingPhase,
          projectGeneration: lease?.generation,
        };
        console.info("[processing] Start requested", { ...context });
        set({ actionPending: true });
        try {
          await useProjectStore.getState().flushEdits();
          if (lease && !isCurrentProjectLease(lease)) return;
          context.operation = "validate_request";
          const config = useProjectStore.getState().project?.uiState.processing?.config;
          if (!config) throw new Error("No config set");
          if (!config.modules.length) throw new Error("No modules selected");
          const project = useProjectStore.getState().project;
          if (!project || !lease || !hasActiveProcessingProject())
            throw new Error("No project loaded");
          const global = useGlobalStore.getState();
          const profile = global.getProfileById(config.selectedProfileId);
          if (!profile) {
            console.warn("[processing] Start blocked: execution profile unavailable", {
              ...context,
            });
            set({
              profileError:
                "Selected profile was deleted or is invalid. Choose a valid profile before running.",
            });
            return;
          }
          const profileValidation = global.profileValidationState[profile.id];
          if (!profileValidation?.valid) {
            console.warn("[processing] Start blocked: execution profile invalid", { ...context });
            set({
              profileError: `Execution profile "${profile.label}" is invalid: ${profileValidation?.errors.join("; ") || "Fix it in Settings before running."}`,
            });
            return;
          }
          for (const subject of config.subjects) {
            if (!/^sub-[^\s]+_[^_\s]+$/.test(subject))
              throw new Error(
                `Subject session "${subject}" does not match BIDS syntax (sub-<subject>_<session>)`,
              );
            if (!state.availableSubjects.some((s) => s.subjectSession === subject))
              throw new Error(
                `Selected subject session "${subject}" is not present in the project`,
              );
          }
          const dataPar = acceptedDataPar();
          if (hasMissingParameterSwitches(dataPar)) throw new Error(SWITCH_CONFIRMATION_GUIDANCE);
          const mapping = project.mappingState;
          const request = ProcessingRequestSchema.parse({
            requestId: crypto.randomUUID(),
            projectId: lease.projectId,
            selectedModules: [...config.modules],
            selectedSubjectSessions: [...config.subjects],
            executionProfile: structuredClone(profile),
            dataPar: assembleDataPar(dataPar),
            participants: {
              correction: dataPar.enableMetadataGroupingCorrection!,
              subjectRows: (mapping?.subjectRows ?? []).map((row) => ({
                subject: row.subject,
                session: row.session,
                groupId: row.groupId ?? null,
              })),
              metadataGroups: (mapping?.metadataGroups ?? []).map((group) => ({
                id: group.id,
                label: group.label,
              })),
            },
            workers: config.subjects.length
              ? Math.min(config.workers, config.subjects.length)
              : config.workers,
            rerunBids2legacy: config.rerunBids2Legacy ?? false,
          });
          set({ profileError: null, processingError: null });
          context.operation = "save_project";
          await useProjectStore.getState().saveProject();
          if (!isCurrentProjectLease(lease)) return;
          context.operation = "reserve_processing_run";
          const reservation = await reserveProcessingRun(request, lease.rootPath);
          if (!isCurrentProjectLease(lease) || reservation.kind === "historical") return;
          const snapshot = reservation.snapshot;
          context.runId = snapshot.runId;
          context.phase = snapshot.lifecycle;
          console.info("[processing] Run reserved", { ...context });
          useProcessingStore.getState().bindRunSnapshot(snapshot);
          if (useProcessingStore.getState().snapshot?.runId !== snapshot.runId) return;
          const listening = attachProcessingListeners(snapshot.runId).catch((error) => {
            if (
              isCurrentProjectLease(lease) &&
              useProcessingStore.getState().activeRunId === snapshot.runId
            )
              set({ processingError: `Processing listener attachment failed: ${String(error)}` });
          });
          set({ actionPending: false });
          context.operation = "run_pipeline";
          const launched = await runProcessingPipeline(snapshot.runId);
          context.operation = "project_processing_snapshot";
          await projectProcessingSnapshot(launched, lease);
          void listening;
        } catch (error) {
          // Persistence/projection failures already have projectRequest diagnostics.
          if (
            !["flush_edits", "save_project", "project_processing_snapshot"].includes(
              context.operation,
            )
          )
            console.error("[processing] Start request failed", context, error);
          if (isCurrentProjectLease(lease))
            set({ processingError: error instanceof Error ? error.message : String(error) });
          throw error;
        } finally {
          if (isCurrentProjectLease(lease)) set({ actionPending: false });
        }
      }),

    killProcessing: () =>
      registerProjectTask(async () => {
        const lease = captureProjectLease();
        const state = useProcessingStore.getState();
        const runId = state.activeRunId;
        if (
          !lease ||
          !runId ||
          state.actionPending ||
          !["stop", "retryCleanup"].includes(state.availableAction)
        )
          return;
        const context = {
          operation: "kill_pipeline",
          runId,
          phase: state.processingPhase,
          projectGeneration: lease.generation,
        };
        console.info("[processing] Stop requested", {
          ...context,
          action: state.availableAction,
        });
        set({ actionPending: true });
        try {
          if (!isCurrentProjectLease(lease)) return;
          const snapshot = await stopProcessingPipeline(runId);
          context.operation = "project_processing_snapshot";
          await projectProcessingSnapshot(snapshot, lease);
        } catch (error) {
          if (context.operation !== "project_processing_snapshot")
            console.error("[processing] Stop request failed", context, error);
          if (
            isCurrentProjectLease(lease) &&
            useProcessingStore.getState().snapshot?.runId === runId
          )
            set({ processingError: String(error) });
          throw error;
        } finally {
          if (
            isCurrentProjectLease(lease) &&
            useProcessingStore.getState().snapshot?.runId === runId
          )
            set({ actionPending: false });
        }
      }),

    confirmProcessingStopped: () =>
      registerProjectTask(async () => {
        const lease = captureProjectLease();
        const snapshot = useProcessingStore.getState().snapshot;
        if (
          !lease ||
          !snapshot ||
          snapshot.availableAction !== "confirmStopped" ||
          useProcessingStore.getState().actionPending
        )
          return;
        const context = {
          operation: "confirm_processing_workers_stopped",
          runId: snapshot.runId,
          revision: snapshot.revision,
          phase: snapshot.lifecycle,
          projectGeneration: lease.generation,
        };
        console.info("[processing] External-stop confirmation requested", { ...context });
        set({ actionPending: true });
        try {
          const confirmed = await confirmProcessingWorkersStopped(
            snapshot.runId,
            snapshot.revision,
          );
          const current = useProcessingStore.getState();
          if (
            !isCurrentProjectLease(lease) ||
            current.snapshot?.runId !== snapshot.runId ||
            current.attachmentGeneration !== lease.generation
          )
            return;
          console.info("[processing] External-stop confirmation accepted", {
            ...context,
            phase: confirmed.lifecycle,
          });
          context.operation = "project_processing_snapshot";
          await projectProcessingSnapshot(confirmed, lease);
        } catch (error) {
          if (context.operation !== "project_processing_snapshot")
            console.error("[processing] External-stop confirmation failed", context, error);
          if (
            isCurrentProjectLease(lease) &&
            useProcessingStore.getState().snapshot?.runId === snapshot.runId
          )
            set({ processingError: error instanceof Error ? error.message : String(error) });
          throw error;
        } finally {
          if (
            isCurrentProjectLease(lease) &&
            useProcessingStore.getState().snapshot?.runId === snapshot.runId
          )
            set({ actionPending: false });
        }
      }),

    updateSubjectStatus: (status) => {
      const normalizedRun = status.run != null ? normalizeAslRunId(status.run) : undefined;
      const normalizedStatus = { ...status, run: normalizedRun };
      set((state) => {
        const idx = state.subjectStatuses.findIndex(
          (s) =>
            s.subjectSession === normalizedStatus.subjectSession &&
            s.module === normalizedStatus.module &&
            aslRunsEqual(s.run, normalizedStatus.run),
        );
        if (idx >= 0) {
          const next = [...state.subjectStatuses];
          next[idx] = {
            ...next[idx],
            ...normalizedStatus,
            run: normalizedRun,
          };
          return { subjectStatuses: next };
        }
        return {
          subjectStatuses: [
            ...state.subjectStatuses,
            {
              ...normalizedStatus,
              run: normalizedRun,
            },
          ],
        };
      });
    },

    setPhase: (phase) => {
      set({ processingPhase: phase });
    },

    setAvailableSubjects: (subjects) => {
      set({
        availableSubjects: subjects.map((s) => ({
          ...s,
          aslRuns: (s.aslRuns ?? []).map(normalizeAslRunId),
        })),
      });
    },

    scanAvailableSubjects: async () => {
      const lease = captureProjectLease();
      const project = useProjectStore.getState().project;
      const projectRoot = project?.projectMeta.rootPath;
      if (!projectRoot) throw new Error("No project loaded");
      const subjects = await loadSubjects(projectRoot, project.projectMeta.dataSource);
      if (lease && !isCurrentProjectLease(lease)) return;
      useProcessingStore.getState().setAvailableSubjects(subjects);
    },

    loadLockFileStatus: async () => {
      const lease = captureProjectLease();
      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (!projectRoot) throw new Error("No project loaded");
      const statuses = await loadLockStatus(projectRoot);
      if ((lease && !isCurrentProjectLease(lease)) || useProcessingStore.getState().activeRunId)
        return;
      set({ subjectStatuses: statuses });
    },

    hydrateProcessing: () => set(createInitialProcessingState()),
    resetProcessing: async () => {
      clearProcessingListeners();
      set(createInitialProcessingState());
    },
    clearBidsCompatibilityError: async () => {
      set({ bidsCompatibilityError: null });
    },
    clearProfileError: () => set({ profileError: null }),
  };
});
