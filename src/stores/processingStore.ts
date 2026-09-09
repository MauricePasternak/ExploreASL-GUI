import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

import type {
  ProcessConfig,
  ProcessingPhase,
  ProcessingRunSnapshot,
  SubjectInfo,
  SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { useProjectStore } from "./projectStore";
import { useGlobalStore } from "./globalStore";
import { useDataParStore } from "./dataParStore";
import { aslRunsEqual, normalizeAslRunId } from "../lib/aslRun";
import { generateSubjectRegexp } from "../lib/subjectMatching";
import { assembleDataPar } from "../lib/assembleDataPar";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";
import { registerProjectTask } from "../lib/projectLifecycle";

// =============================================================================
// State Interface
// =============================================================================

export interface ProcessingState {
  processingPhase: ProcessingPhase;
  config: ProcessConfig | null;
  availableSubjects: SubjectInfo[];
  subjectStatuses: SubjectModuleStatus[];
  /** Session-only native attachment. Never project-file recovery truth. */
  activeRunId: string | null;
  /** Retained only while terminal Population metadata side effects settle. */
  terminalRunId: string | null;
  workerPids: number[];
  bidsCompatibilityError: string | null;
  profileError: string | null;
  preparingMessage: string | null;

  setConfig: (config: ProcessConfig) => void;
  bindRunSnapshot: (snapshot: import("../schemas/processingSchemas").ProcessingRunSnapshot) => void;
  reconcileRunSnapshot: (
    snapshot: import("../schemas/processingSchemas").ProcessingRunSnapshot,
  ) => void;
  synchronizeProcessingRun: () => Promise<void>;
  startProcessing: () => Promise<void>;
  killProcessing: () => Promise<void>;
  updateSubjectStatus: (status: SubjectModuleStatus) => void;
  removeWorkerPid: (pid: number) => void;
  setPhase: (phase: ProcessingPhase) => void;
  setAvailableSubjects: (subjects: SubjectInfo[]) => void;
  scanAvailableSubjects: () => Promise<void>;
  loadLockFileStatus: () => Promise<void>;
  hydrateProcessing: (persisted?: {
    config?: ProcessConfig;
    currentPhase?: ProcessingPhase;
  }) => void;
  resetProcessing: () => Promise<void>;
  clearBidsCompatibilityError: () => Promise<void>;
  clearProfileError: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const INITIAL_STATE = {
  processingPhase: "idle" as ProcessingPhase,
  config: null as ProcessConfig | null,
  availableSubjects: [] as SubjectInfo[],
  subjectStatuses: [] as SubjectModuleStatus[],
  activeRunId: null as string | null,
  terminalRunId: null as string | null,
  workerPids: [] as number[],
  bidsCompatibilityError: null as string | null,
  profileError: null as string | null,
  preparingMessage: null as string | null,
};

function createInitialProcessingState() {
  return {
    ...INITIAL_STATE,
    availableSubjects: [],
    subjectStatuses: [],
    activeRunId: null,
    terminalRunId: null,
    workerPids: [],
  };
}

// =============================================================================
// Cleanup ref
// =============================================================================

let processingCleanup: (() => void) | null = null;

export function clearProcessingListeners() {
  if (processingCleanup) {
    processingCleanup();
    processingCleanup = null;
  }
}

function replaceProcessingListeners(cleanup: () => void) {
  const previous = processingCleanup;
  // Publish new ownership before old asynchronous callbacks are released.
  processingCleanup = cleanup;
  previous?.();
}

const ACTIVE_PROCESSING_PHASES: ProcessingPhase[] = [
  "preparing",
  "running",
  "finalizing",
  "cancelling",
];

function isActiveProcessingPhase(phase: ProcessingPhase): boolean {
  return ACTIVE_PROCESSING_PHASES.includes(phase);
}

// =============================================================================
// Store
// =============================================================================

export const useProcessingStore = create<ProcessingState>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    setConfig: (config) => {
      const prevModules = useProcessingStore.getState().config?.modules ?? [];
      let modules = [...config.modules];

      const hasPop = modules.includes("population");
      const hasSubject = modules.includes("structural") || modules.includes("asl");

      if (hasPop && hasSubject) {
        const prevHasPop = prevModules.includes("population");
        if (prevHasPop) {
          modules = modules.filter((m) => m !== "population");
        } else {
          modules = ["population"];
        }
      }

      const needsBids2LegacyRerun = modules.includes("structural") || modules.includes("asl");
      const patched = {
        ...config,
        modules,
        ...(modules.includes("population") && { workers: 1 }),
        ...(!needsBids2LegacyRerun && { rerunBids2Legacy: false }),
      };
      set({ config: patched });
    },

    bindRunSnapshot: (snapshot: ProcessingRunSnapshot) => {
      set({
        activeRunId: isActiveProcessingPhase(snapshot.lifecycle) ? snapshot.runId : null,
        terminalRunId: isActiveProcessingPhase(snapshot.lifecycle) ? null : snapshot.runId,
        workerPids: snapshot.workers,
        processingPhase: snapshot.lifecycle,
        preparingMessage: snapshot.lifecycle === "preparing" ? "Initializing processing..." : null,
      });
    },

    reconcileRunSnapshot: (snapshot: ProcessingRunSnapshot) => {
      set((state) => {
        if (state.activeRunId !== snapshot.runId && state.terminalRunId !== snapshot.runId)
          return {};
        return {
          activeRunId: isActiveProcessingPhase(snapshot.lifecycle) ? snapshot.runId : null,
          terminalRunId: isActiveProcessingPhase(snapshot.lifecycle) ? null : snapshot.runId,
          workerPids: snapshot.workers,
          processingPhase: snapshot.lifecycle,
          preparingMessage: snapshot.lifecycle === "preparing" ? state.preparingMessage : null,
        };
      });
    },

    synchronizeProcessingRun: async () => {
      const lease = captureProjectLease();
      if (!lease) return;
      const { attachRun, getActiveRun, reconcileAndFinalizeIfNeeded, setupProcessingListeners } =
        await import("../lib/processingEvents");
      const active = await getActiveRun();
      if (!isCurrentProjectLease(lease)) return;
      if (!active) {
        set((state) =>
          isActiveProcessingPhase(state.processingPhase)
            ? { activeRunId: null, workerPids: [], processingPhase: "idle", preparingMessage: null }
            : {},
        );
        return;
      }
      if (useProcessingStore.getState().activeRunId === active.runId) {
        useProcessingStore.getState().reconcileRunSnapshot(active);
        await reconcileAndFinalizeIfNeeded(active, lease);
        return;
      }
      // Bind discovered identity, install every listener, then take the final
      // authoritative snapshot. A WorkerExited during listener setup is either
      // observed or reconciled from this second attach.
      useProcessingStore.getState().bindRunSnapshot(active);
      const cleanup = await setupProcessingListeners(active.runId);
      const snapshot = await attachRun(active.runId);
      if (
        !isCurrentProjectLease(lease) ||
        useProcessingStore.getState().activeRunId !== snapshot.runId
      ) {
        cleanup();
        set((state) =>
          state.activeRunId === active.runId
            ? { activeRunId: null, terminalRunId: null, workerPids: [], processingPhase: "idle" }
            : {},
        );
        return;
      }
      useProcessingStore.getState().reconcileRunSnapshot(snapshot);
      replaceProcessingListeners(cleanup);
      await reconcileAndFinalizeIfNeeded(snapshot, lease);
    },

    startProcessing: () =>
      registerProjectTask(async () => {
        const confirmedRunId: string | null = null;
        const lease = captureProjectLease();
        const isCurrent = () => !lease || isCurrentProjectLease(lease);
        const config = useProcessingStore.getState().config;
        if (!config) throw new Error("No config set");
        if (config.modules.length === 0) throw new Error("No modules selected");

        const global = useGlobalStore.getState();
        const profile = global.getProfileById(config.selectedProfileId);
        if (!profile) {
          set({
            profileError:
              "The selected execution profile could not be found. Choose a valid profile before running.",
          });
          return;
        }
        const validation = global.profileValidationState[profile.id];
        if (!validation || !validation.valid) {
          set({
            profileError: `Execution profile "${profile.label}" is invalid. Fix it in Settings before running.`,
          });
          return;
        }
        set({ profileError: null });

        const available = useProcessingStore.getState().availableSubjects;
        for (const subj of config.subjects) {
          if (!/^sub-[^_\s]+_[^_\s]+$/.test(subj)) {
            throw new Error(
              `Subject session "${subj}" does not match BIDS syntax (sub-<subject>_<session>)`,
            );
          }
          if (!available.some((a) => a.subjectSession === subj)) {
            throw new Error(
              `Selected subject session "${subj}" is not present in the ${
                useProjectStore.getState().project?.projectMeta.dataSource === "bids"
                  ? "project root"
                  : "rawdata folder"
              }`,
            );
          }
        }

        const { reserveProcessingRun } = await import("../lib/processingEvents");
        let runId: string | null = confirmedRunId;
        try {
          // Reservation is admission. Nothing filesystem-facing or project-facing
          // occurs before its authoritative Preparing snapshot wins.
          if (!runId) {
            const reservation = await reserveProcessingRun(config.modules, config.subjects);
            if (!isCurrent()) return;
            runId = reservation.runId;
            useProcessingStore.getState().bindRunSnapshot(reservation);
            set({ subjectStatuses: [], preparingMessage: "Initializing processing..." });
          }

          // Let React paint after native admission, before expensive preparation.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
          });
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;

          const {
            watchLockDir,
            setupProcessingListeners,
            runProcessingPipeline,
            reconcileAndFinalizeIfNeeded,
          } = await import("../lib/processingEvents");
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;

          const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
          if (!projectRoot) throw new Error("No project loaded");

          const dataSource = useProjectStore.getState().project?.projectMeta.dataSource ?? "dicom";

          if (dataSource === "bids") {
            set({ preparingMessage: "Verifying BIDS compatibility setup..." });
            try {
              await invoke("verify_bids_compatibility_for_run", { runId });
            } catch (error) {
              set({
                bidsCompatibilityError:
                  error instanceof Error
                    ? error.message
                    : "BIDS compatibility setup must be reviewed before processing.",
              });
              throw error;
            }
            if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
          }

          // Verification is the first post-reservation preparation step. In
          // particular, do not clear Population state or begin environment
          // probes until a BIDS source has passed its read-only check.
          let versionCapture: Promise<void> = Promise.resolve();
          if (config.modules.includes("population")) {
            useProjectStore.getState().setPopulationCompleted(false);

            const matlabPath = profile.type === "matlab" ? profile.matlabPath : "";
            const exploreAslPath = profile.type === "matlab" ? profile.exploreAslPath : "";
            const profileId = profile.id;

            versionCapture = (async () => {
              try {
                const versions = await invoke<{ explore_asl: string; matlab: string }>(
                  "capture_environment_versions_for_run",
                  { runId, exploreAslPath, matlabPath },
                );
                if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
                const gui =
                  import.meta.env.VITE_APP_VERSION ??
                  useProjectStore.getState().project?.version ??
                  "unknown";
                useProjectStore.getState().setLastRunProfileId("population", profileId, {
                  exploreASLVersion: versions.explore_asl,
                  matlabVersion: versions.matlab,
                  guiVersion: gui,
                });
              } catch (err) {
                if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
                console.warn("[manifest] version capture failed", err);
                useProjectStore.getState().setLastRunProfileId("population", profileId, {
                  exploreASLVersion: "unknown",
                  matlabVersion: "unknown",
                  guiVersion: useProjectStore.getState().project?.version ?? "unknown",
                });
              }
            })();
          }

          // Generate/update participants.tsv (always call to either add or strip the 'site' column)
          set({ preparingMessage: "Generating participants list..." });
          const dataPar = useDataParStore.getState().dataPar;
          const mappingState = useProjectStore.getState().project?.mappingState;
          const { ensureParticipantsFiles } = await import("../lib/participantsUtils");
          await ensureParticipantsFiles(
            projectRoot,
            config,
            mappingState,
            available,
            dataPar.enableMetadataGroupingCorrection ?? false,
            dataSource,
          );
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;

          set({ preparingMessage: "Configuring file watcher..." });
          set({ preparingMessage: "Setting up event listeners..." });
          const cleanup = await setupProcessingListeners(runId);
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) {
            cleanup();
            return;
          }
          replaceProcessingListeners(cleanup);

          set({ preparingMessage: "Configuring file watcher..." });
          const watcherSnapshot = await watchLockDir(runId);
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
          useProcessingStore.getState().reconcileRunSnapshot(watcherSnapshot);

          const dataParJson = assembleDataPar(dataPar);
          if (dataSource === "bids") {
            dataParJson.x.opts = {
              ...(dataParJson.x.opts ?? {}),
              subjectFolder: projectRoot,
            };
          }
          dataParJson.x.dataset = {
            subjectRegexp: generateSubjectRegexp(config.subjects),
            ...(config.subjects.length > 0 && { ForceInclusionList: config.subjects }),
          };

          set({ preparingMessage: "Starting processing pipeline..." });
          // Join version capture before launching workers so the manifest has versions.
          await versionCapture;
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
          const snapshot = await runProcessingPipeline(runId, config, profile, dataParJson);
          if (!isCurrent() || useProcessingStore.getState().activeRunId !== runId) return;
          useProcessingStore.getState().reconcileRunSnapshot(snapshot);
          await reconcileAndFinalizeIfNeeded(snapshot, lease);
        } catch (err) {
          if (!runId || !isCurrent() || useProcessingStore.getState().activeRunId !== runId)
            throw err;
          const failedRunId = runId;
          const { attachRun, failProcessingRun, reconcileAndFinalizeIfNeeded, stopWatcher } =
            await import("../lib/processingEvents");
          try {
            // A native launch error has already recorded its own failure state.
            // Attach first: a partial spawn leaves Running ownership plus
            // pending evidence, and reporting failure again must not overwrite
            // that evidence or turn a live run terminal.
            let observed = await attachRun(failedRunId).catch(() => null);
            if (isCurrent() && useProcessingStore.getState().activeRunId === failedRunId) {
              if (observed?.lifecycle === "preparing" || observed === null) {
                observed = await failProcessingRun(failedRunId);
              }
              if (
                isCurrent() &&
                useProcessingStore.getState().activeRunId === failedRunId &&
                observed.runId === failedRunId
              ) {
                useProcessingStore.getState().reconcileRunSnapshot(observed);
                if (isActiveProcessingPhase(observed.lifecycle)) {
                  await reconcileAndFinalizeIfNeeded(observed, lease);
                } else {
                  await stopWatcher(failedRunId).catch(() => undefined);
                  clearProcessingListeners();
                }
              }
            }
          } catch (failureError) {
            console.warn("[processingStore] failed to report preparation failure", failureError);
          }
          throw err;
        }
      }),

    killProcessing: async () => {
      const lease = captureProjectLease();
      const runId = useProcessingStore.getState().activeRunId;
      const phase = useProcessingStore.getState().processingPhase;
      if (!runId || phase !== "running") return;
      const { stopProcessingPipeline, stopWatcher } = await import("../lib/processingEvents");
      const snapshot = await stopProcessingPipeline(runId);
      if (
        (lease && !isCurrentProjectLease(lease)) ||
        useProcessingStore.getState().activeRunId !== runId
      )
        return;
      useProcessingStore.getState().reconcileRunSnapshot(snapshot);
      if (snapshot.lifecycle === "cancelled") {
        await stopWatcher(runId).catch(() => undefined);
        if (!lease || isCurrentProjectLease(lease)) clearProcessingListeners();
      }
    },

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

    removeWorkerPid: (pid) => {
      set((state) => ({
        workerPids: state.workerPids.filter((p) => p !== pid),
      }));
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
      const { loadSubjects } = await import("../lib/processingEvents");
      const subjects = await loadSubjects(projectRoot, project.projectMeta.dataSource);
      if (lease && !isCurrentProjectLease(lease)) return;
      useProcessingStore.getState().setAvailableSubjects(subjects);
    },

    loadLockFileStatus: async () => {
      const lease = captureProjectLease();
      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (!projectRoot) throw new Error("No project loaded");
      const { loadLockStatus } = await import("../lib/processingEvents");
      const statuses = await loadLockStatus(projectRoot);
      if (lease && !isCurrentProjectLease(lease)) return;
      set({ subjectStatuses: statuses });
    },

    hydrateProcessing: (persisted) => {
      const phase = persisted?.currentPhase;
      set({
        ...createInitialProcessingState(),
        config: persisted?.config ?? null,
        processingPhase: phase && !isActiveProcessingPhase(phase) ? phase : "idle",
      });
    },

    resetProcessing: async () => {
      const runId = useProcessingStore.getState().activeRunId;
      clearProcessingListeners();
      if (runId) {
        try {
          const { stopWatcher } = await import("../lib/processingEvents");
          await stopWatcher(runId);
        } catch (err) {
          console.warn("[processingStore] stopWatcher failed:", err);
        }
      }
      // A lock watcher can emit while its asynchronous shutdown is pending.
      // Reset after it has stopped so no status survives into the next project.
      set(createInitialProcessingState());
    },

    clearBidsCompatibilityError: async () => {
      const runId = useProcessingStore.getState().activeRunId;
      set({ bidsCompatibilityError: null, preparingMessage: null });
      if (!runId) return;
      const lease = captureProjectLease();
      const { failProcessingRun } = await import("../lib/processingEvents");
      const snapshot = await failProcessingRun(runId);
      if (
        lease &&
        isCurrentProjectLease(lease) &&
        useProcessingStore.getState().activeRunId === runId
      ) {
        useProcessingStore.getState().reconcileRunSnapshot(snapshot);
        clearProcessingListeners();
      }
    },

    clearProfileError: () => {
      set({ profileError: null });
    },
  })),
);
