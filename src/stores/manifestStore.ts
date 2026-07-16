import { create } from "zustand";
import { readAllSubjectQcOutputs, type SubjectQcOutputs } from "../lib/manifestQc";
import { useProjectStore } from "./projectStore";
import { useProcessingStore } from "./processingStore";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

interface ManifestState {
  step: 0 | 1;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  staleVerdicts: Set<string>;
  priorModulesMtimes: Record<string, number | null>;
  qcData: Record<string, SubjectQcOutputs> | null;
  qcLoaded: boolean;
  qcLoading: boolean;
  dataPar: Record<string, string | number | boolean> | null;
  setStep: (step: 0 | 1) => void;
  setFilter: (filter: ManifestState["filter"]) => void;
  loadPriorModulesMtimes: () => Promise<void>;
  computeStaleVerdicts: () => void;
  resetStep: () => void;
  loadQcData: (projectRoot: string) => Promise<void>;
  loadDataPar: (projectRoot: string) => Promise<void>;
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  step: 0,
  filter: "all",
  staleVerdicts: new Set(),
  priorModulesMtimes: {},
  qcData: null,
  qcLoaded: false,
  qcLoading: false,
  dataPar: null,

  setStep: (step) => set({ step }),

  setFilter: (filter) => set({ filter }),

  resetStep: () => set({ step: 0 }),

  loadPriorModulesMtimes: async () => {
    const project = useProjectStore.getState().project;
    const projectRoot = project?.projectMeta.rootPath;
    if (!projectRoot) return;

    const verdicts = project?.uiState?.manifest?.verdicts ?? {};

    let subjects = useProcessingStore.getState().availableSubjects;
    if (subjects.length === 0) {
      await useProcessingStore
        .getState()
        .scanAvailableSubjects()
        .catch((err) => {
          console.warn("[manifestStore] scanAvailableSubjects failed during mtime load:", err);
        });
      subjects = useProcessingStore.getState().availableSubjects;
    }

    const subjectSessions = Array.from(
      new Set([...subjects.map((s) => s.subjectSession), ...Object.keys(verdicts)]),
    );

    if (subjectSessions.length === 0) {
      set({ staleVerdicts: new Set(), priorModulesMtimes: {} });
      return;
    }

    try {
      const mtimes = await invoke<Record<string, number | null>>("read_prior_modules_mtimes", {
        projectRoot,
        subjectSessions,
      });
      set({ priorModulesMtimes: mtimes });
      get().computeStaleVerdicts();
    } catch (err) {
      console.warn("[manifestStore] failed to read prior modules mtimes for staleness", err);
      set({ staleVerdicts: new Set() });
    }
  },

  computeStaleVerdicts: () => {
    const project = useProjectStore.getState().project;
    const verdicts = project?.uiState?.manifest?.verdicts ?? {};
    const priorModulesMtimes = get().priorModulesMtimes;

    const stale = new Set<string>();
    for (const [ss, v] of Object.entries(verdicts)) {
      // setAt: 0 means the mtime was unknown at capture time (race / missing
      // subject). Treat as unset rather than stale so the user's freshly-clicked
      // verdict isn't immediately flagged.
      if (v.setAt === 0) continue;
      const current = priorModulesMtimes[ss];
      if (current !== undefined && current !== null && v.setAt !== current) {
        stale.add(ss);
      }
    }
    set({ staleVerdicts: new Set(stale) });
  },

  loadQcData: async (projectRoot) => {
    if (get().qcLoading) return;
    set({ qcLoading: true });
    try {
      let subjects = useProcessingStore.getState().availableSubjects;
      if (subjects.length === 0) {
        await useProcessingStore
          .getState()
          .scanAvailableSubjects()
          .catch((err) => {
            console.warn("[manifestStore] scanAvailableSubjects failed during QC load:", err);
          });
        subjects = useProcessingStore.getState().availableSubjects;
      }

      const subjectSessions = subjects.map((s) => s.subjectSession);
      const data = await readAllSubjectQcOutputs(projectRoot, subjectSessions);
      set({ qcData: data, qcLoaded: true, qcLoading: false });
    } catch (err) {
      console.warn("[manifestStore] failed to load QC data", err);
      set({ qcData: null, qcLoaded: true, qcLoading: false });
    }
  },

  loadDataPar: async (projectRoot) => {
    const path = `${projectRoot}/derivatives/ExploreASL/dataPar.json`;
    try {
      if (await exists(path)) {
        const raw = await readTextFile(path);
        const parsed = JSON.parse(raw);
        set({ dataPar: parsed });
      } else {
        set({ dataPar: null });
      }
    } catch (err) {
      console.warn("[manifestStore] failed to load dataPar.json", err);
      set({ dataPar: null });
    }
  },
}));
