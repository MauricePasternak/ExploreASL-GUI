import { create } from "zustand";

import type {
  ProcessConfig,
  ProcessingPhase,
  SubjectInfo,
  SubjectModuleStatus,
} from "../schemas/processingSchemas";
import { useProjectStore } from "./projectStore";
import { useDataParStore } from "./dataParStore";

// =============================================================================
// State Interface
// =============================================================================

export interface ProcessingState {
  processingPhase: ProcessingPhase;
  config: ProcessConfig | null;
  availableSubjects: SubjectInfo[];
  subjectStatuses: SubjectModuleStatus[];
  workerPids: number[];

  setConfig: (config: ProcessConfig) => void;
  startProcessing: () => Promise<void>;
  killProcessing: () => Promise<void>;
  updateSubjectStatus: (status: SubjectModuleStatus) => void;
  removeWorkerPid: (pid: number) => void;
  setPhase: (phase: ProcessingPhase) => void;
  setAvailableSubjects: (subjects: SubjectInfo[]) => void;
  scanAvailableSubjects: () => Promise<void>;
  loadLockFileStatus: () => Promise<void>;
  resetProcessing: () => void;
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
};

// =============================================================================
// Helpers
// =============================================================================

function generateSubjectRegexp(subjects: string[]): string {
  if (subjects.length === 0) return "^sub-.*$";
  const escaped = subjects.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(${escaped.join("|")})$`;
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

// =============================================================================
// Store
// =============================================================================

export const useProcessingStore = create<ProcessingState>((set) => ({
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

    const patched = modules.includes("population")
      ? { ...config, modules, workers: 1 }
      : { ...config, modules };
    const subjectRegexp = generateSubjectRegexp(patched.subjects);
    set({ config: { ...patched, subjectRegexp } });
  },

  startProcessing: async () => {
    const config = useProcessingStore.getState().config;
    if (!config) throw new Error("No config set");
    if (config.modules.length === 0) throw new Error("No modules selected");

    const available = useProcessingStore.getState().availableSubjects;
    for (const subj of config.subjects) {
      if (!/^sub-[^_\s]+_[^_\s]+$/.test(subj)) {
        throw new Error(
          `Subject session "${subj}" does not match BIDS syntax (sub-<subject>_<session>)`,
        );
      }
      if (!available.some((a) => a.subjectSession === subj)) {
        throw new Error(`Selected subject session "${subj}" is not present in the rawdata folder`);
      }
    }

    // Clear population completion flag when re-running Population
    if (config.modules.includes("population")) {
      useProjectStore.getState().setPopulationCompleted(false);
    }

    set({ processingPhase: "preparing", subjectStatuses: [] });

    const { watchLockDir, setupProcessingListeners, runProcessingPipeline } =
      await import("../lib/processingEvents");

    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) throw new Error("No project loaded");

    // Generate/update participants.tsv (always call to either add or strip the 'site' column)
    const dataPar = useDataParStore.getState().dataPar;
    const mappingState = useProjectStore.getState().project?.mappingState;
    const { ensureParticipantsFiles } = await import("../lib/participantsUtils");
    await ensureParticipantsFiles(
      projectRoot,
      config,
      mappingState,
      available,
      dataPar.enableMetadataGroupingCorrection ?? false,
    );

    await watchLockDir(projectRoot);

    const cleanup = await setupProcessingListeners();
    processingCleanup = cleanup;

    const { assembleDataPar } = await import("../lib/assembleDataPar");
    const dataParJson = assembleDataPar(dataPar);
    dataParJson.x.dataset = {
      subjectRegexp: config.subjectRegexp,
      ...(config.subjects.length > 0 && { ForceInclusionList: config.subjects }),
    };

    try {
      const pids = await runProcessingPipeline(config, dataParJson);
      set({ workerPids: pids, processingPhase: "running" });
    } catch (err) {
      clearProcessingListeners();
      const { stopWatcher: stopW } = await import("../lib/processingEvents");
      await stopW();
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
    set((state) => {
      const idx = state.subjectStatuses.findIndex(
        (s) =>
          s.subjectSession === status.subjectSession &&
          s.module === status.module &&
          (s.run ?? undefined) === (status.run ?? undefined),
      );
      if (idx >= 0) {
        const next = [...state.subjectStatuses];
        next[idx] = {
          ...status,
          run: status.run ?? undefined,
        };
        return { subjectStatuses: next };
      }
      return {
        subjectStatuses: [
          ...state.subjectStatuses,
          {
            ...status,
            run: status.run ?? undefined,
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
    set({ availableSubjects: subjects });
  },

  scanAvailableSubjects: async () => {
    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) throw new Error("No project loaded");
    const { loadSubjects } = await import("../lib/processingEvents");
    const subjects = await loadSubjects(projectRoot);
    set({ availableSubjects: subjects });
  },

  loadLockFileStatus: async () => {
    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) throw new Error("No project loaded");
    const { loadLockStatus } = await import("../lib/processingEvents");
    const statuses = await loadLockStatus(projectRoot);
    set({ subjectStatuses: statuses });
  },

  resetProcessing: () => {
    clearProcessingListeners();
    import("../lib/processingEvents").then(({ stopWatcher }) => {
      stopWatcher().catch(() => {});
    });
    set({ ...INITIAL_STATE });
  },
}));
