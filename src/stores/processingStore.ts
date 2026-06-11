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

// =============================================================================
// Store
// =============================================================================

export const useProcessingStore = create<ProcessingState>((set) => ({
  ...INITIAL_STATE,

  setConfig: (config) => {
    const patched = config.modules.includes("population")
      ? { ...config, workers: 1 }
      : config;
    const subjectRegexp = generateSubjectRegexp(patched.subjects);
    set({ config: { ...patched, subjectRegexp } });
  },

  startProcessing: async () => {
    const config = useProcessingStore.getState().config;
    if (!config) throw new Error("No config set");

    set({ processingPhase: "preparing" });

    const { watchLockDir, setupProcessingListeners, runProcessingPipeline } =
      await import("../lib/processingEvents");

    const projectRoot = useProjectStore.getState().project?.projectMeta.rootPath;
    if (!projectRoot) throw new Error("No project loaded");
    await watchLockDir(projectRoot);

    const cleanup = await setupProcessingListeners();
    processingCleanup = cleanup;

    const dataPar = useDataParStore.getState().dataPar;
    const { assembleDataPar } = await import("../lib/assembleDataPar");
    const dataParJson = assembleDataPar(dataPar);

    try {
      const pids = await runProcessingPipeline(config, dataParJson);
      set({ workerPids: pids, processingPhase: "running" });
    } catch (err) {
      if (processingCleanup) {
        processingCleanup();
        processingCleanup = null;
      }
      set({ ...INITIAL_STATE });
      throw err;
    }
  },

  killProcessing: async () => {
    const { stopProcessingPipeline } = await import("../lib/processingEvents");
    await stopProcessingPipeline();
    set({ processingPhase: "cancelled" });
  },

  updateSubjectStatus: (status) => {
    set((state) => {
      const idx = state.subjectStatuses.findIndex(
        (s) =>
          s.subjectSession === status.subjectSession &&
          s.module === status.module &&
          s.run === status.run,
      );
      if (idx >= 0) {
        const next = [...state.subjectStatuses];
        next[idx] = status;
        return { subjectStatuses: next };
      }
      return { subjectStatuses: [...state.subjectStatuses, status] };
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
    if (processingCleanup) {
      processingCleanup();
      processingCleanup = null;
    }
    set({ ...INITIAL_STATE });
  },
}));
