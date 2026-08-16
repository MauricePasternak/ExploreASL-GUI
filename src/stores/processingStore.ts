import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

import type {
  ProcessConfig,
  ProcessingPhase,
  SubjectInfo,
  SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { useProjectStore } from "./projectStore";
import { useGlobalStore } from "./globalStore";
import { useDataParStore } from "./dataParStore";
import { aslRunsEqual, normalizeAslRunId } from "../lib/aslRun";
import { generateSubjectRegexp } from "../lib/subjectMatching";
import { assembleDataPar } from "../lib/assembleDataPar";

// =============================================================================
// State Interface
// =============================================================================

export interface ProcessingState {
  processingPhase: ProcessingPhase;
  config: ProcessConfig | null;
  availableSubjects: SubjectInfo[];
  subjectStatuses: SubjectModuleStatus[];
  workerPids: number[];
  pendingRawdataWarning: string | null;
  profileError: string | null;
  preparingMessage: string | null;

  setConfig: (config: ProcessConfig) => void;
  startProcessing: (explicitConfirm?: boolean) => Promise<void>;
  killProcessing: () => Promise<void>;
  updateSubjectStatus: (status: SubjectModuleStatus) => void;
  removeWorkerPid: (pid: number) => void;
  setPhase: (phase: ProcessingPhase) => void;
  setAvailableSubjects: (subjects: SubjectInfo[]) => void;
  scanAvailableSubjects: () => Promise<void>;
  loadLockFileStatus: () => Promise<void>;
  resetProcessing: () => Promise<void>;
  clearPendingRawdataWarning: () => void;
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
  workerPids: [] as number[],
  pendingRawdataWarning: null as string | null,
  profileError: null as string | null,
  preparingMessage: null as string | null,
};

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

    startProcessing: async (explicitConfirm = false) => {
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

      set({
        processingPhase: "preparing",
        subjectStatuses: [],
        preparingMessage: "Initializing processing...",
      });

      // Let React commit + the browser paint/promote the spinner animation before
      // any heavy IPC (especially MATLAB version probing) can contend for the UI.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 0);
          });
        });
      });

      try {
        // Kick off version capture in parallel with the rest of prep so a slow
        // MATLAB probe (older laptops) does not serialize behind / freeze the
        // preparing UI. We only join before the pipeline actually starts.
        let versionCapture: Promise<void> = Promise.resolve();
        if (config.modules.includes("population")) {
          useProjectStore.getState().setPopulationCompleted(false);

          const matlabPath = profile.type === "matlab" ? profile.matlabPath : "";
          const exploreAslPath = profile.type === "matlab" ? profile.exploreAslPath : "";
          const profileId = profile.id;

          versionCapture = (async () => {
            try {
              const versions = await invoke<{ explore_asl: string; matlab: string }>(
                "capture_environment_versions",
                {
                  exploreAslPath,
                  matlabPath,
                },
              );
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
              console.warn("[manifest] version capture failed", err);
              useProjectStore.getState().setLastRunProfileId("population", profileId, {
                exploreASLVersion: "unknown",
                matlabVersion: "unknown",
                guiVersion: useProjectStore.getState().project?.version ?? "unknown",
              });
            }
          })();
        }

        const { watchLockDir, setupProcessingListeners, runProcessingPipeline } =
          await import("../lib/processingEvents");

        const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
        if (!projectRoot) throw new Error("No project loaded");

        const dataSource = useProjectStore.getState().project?.projectMeta.dataSource ?? "dicom";

        if (dataSource === "bids") {
          set({ preparingMessage: "Checking dataset rawdata..." });
          if (!explicitConfirm) {
            const result = await invoke<{
              warning: string | null;
              created: boolean;
              bidsignoreUpdated: boolean;
            }>("ensure_rawdata_dir", { rootPath: projectRoot });
            if (result.warning) {
              set({ pendingRawdataWarning: result.warning, preparingMessage: null });
              // Let version capture finish in the background; do not block the warning modal.
              void versionCapture;
              return;
            }
          } else {
            // Clear warning state when proceeding after confirmation
            set({ pendingRawdataWarning: null });
          }
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

        set({ preparingMessage: "Configuring file watcher..." });
        await watchLockDir(projectRoot);

        set({ preparingMessage: "Setting up event listeners..." });
        const cleanup = await setupProcessingListeners();
        processingCleanup = cleanup;

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
        const pids = await runProcessingPipeline(config, profile, dataParJson);
        set({ workerPids: pids, processingPhase: "running", preparingMessage: null });
      } catch (err) {
        clearProcessingListeners();
        try {
          const { stopWatcher: stopW } = await import("../lib/processingEvents");
          await stopW();
        } catch (watchErr) {
          console.warn("[processingStore] stopWatcher failed in catch:", watchErr);
        }
        set({ ...INITIAL_STATE });
        throw err;
      }
    },

    killProcessing: async () => {
      const { stopProcessingPipeline, clearStaleLocks, loadLockStatus, stopWatcher } =
        await import("../lib/processingEvents");

      clearProcessingListeners();

      await stopWatcher();
      await stopProcessingPipeline();

      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (projectRoot) {
        try {
          await clearStaleLocks(projectRoot);
          const statuses = await loadLockStatus(projectRoot);
          set({ processingPhase: "cancelled", subjectStatuses: statuses });
        } catch {
          set({ processingPhase: "cancelled" });
        }
      } else {
        set({ processingPhase: "cancelled" });
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
      const project = useProjectStore.getState().project;
      const projectRoot = project?.projectMeta.rootPath;
      if (!projectRoot) throw new Error("No project loaded");
      const { loadSubjects } = await import("../lib/processingEvents");
      const subjects = await loadSubjects(projectRoot, project.projectMeta.dataSource);
      useProcessingStore.getState().setAvailableSubjects(subjects);
    },

    loadLockFileStatus: async () => {
      const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
      if (!projectRoot) throw new Error("No project loaded");
      const { loadLockStatus } = await import("../lib/processingEvents");
      const statuses = await loadLockStatus(projectRoot);
      set({ subjectStatuses: statuses });
    },

    resetProcessing: async () => {
      clearProcessingListeners();
      try {
        const { stopWatcher } = await import("../lib/processingEvents");
        await stopWatcher();
      } catch (err) {
        console.warn("[processingStore] stopWatcher failed:", err);
      }
      // A lock watcher can emit while its asynchronous shutdown is pending.
      // Reset after it has stopped so no status survives into the next project.
      set({ ...INITIAL_STATE });
    },

    clearPendingRawdataWarning: () => {
      // Clear the warning AND reset the preparing phase that was set just before
      // ensure_rawdata_dir was invoked. Without the phase reset the Start button
      // would remain permanently disabled after the user cancels the warning.
      set((state) => ({
        pendingRawdataWarning: null,
        preparingMessage: null,
        processingPhase:
          state.processingPhase === "preparing"
            ? ("idle" as ProcessingPhase)
            : state.processingPhase,
      }));
    },

    clearProfileError: () => {
      set({ profileError: null });
    },
  })),
);
