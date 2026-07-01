import { create } from "zustand";
import type { SubjectQcOutputs } from "../lib/manifestQc";

interface ManifestState {
  step: 0 | 1;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  staleVerdicts: Set<string>;
  qcData: Record<string, SubjectQcOutputs> | null;
  qcLoaded: boolean;
  qcLoading: boolean;
  dataPar: Record<string, string | number | boolean> | null;
  setStep: (step: 0 | 1) => void;
  setFilter: (filter: ManifestState["filter"]) => void;
  recomputeStaleVerdicts: () => Promise<void>;
  resetStep: () => void;
  loadQcData: (projectRoot: string) => Promise<void>;
  loadDataPar: (projectRoot: string) => Promise<void>;
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  step: 0,
  filter: "all",
  staleVerdicts: new Set(),
  qcData: null,
  qcLoaded: false,
  qcLoading: false,
  dataPar: null,

  setStep: (step) => set({ step }),

  setFilter: (filter) => set({ filter }),

  resetStep: () => set({ step: 0 }),

  recomputeStaleVerdicts: async () => {
    const { useProjectStore } = await import("./projectStore");
    const { invoke } = await import("@tauri-apps/api/core");

    const project = useProjectStore.getState().project;
    const projectRoot = project?.projectMeta.rootPath;
    if (!projectRoot) return;

    const verdicts = project?.uiState?.manifest?.verdicts ?? {};
    if (Object.keys(verdicts).length === 0) {
      set({ staleVerdicts: new Set() });
      return;
    }

    try {
      const current = await invoke<number | null>("read_population_ready_mtime", {
        projectRoot,
      });
      // If current is null (ready status file missing unexpectedly post-Population),
      // we treat the verdicts as fresh (no file -> fresh is intentional).
      const stale = new Set<string>();
      for (const [ss, v] of Object.entries(verdicts)) {
        if (current !== null && v.setAt !== current) {
          stale.add(ss);
        }
      }
      set({ staleVerdicts: new Set(stale) });
    } catch (err) {
      console.warn("[manifestStore] failed to read population mtime for staleness", err);
      set({ staleVerdicts: new Set() });
    }
  },

  loadQcData: async (projectRoot) => {
    if (get().qcLoading) return;
    set({ qcLoading: true });
    try {
      const { readAllSubjectQcOutputs } = await import("../lib/manifestQc");
      const { useProcessingStore } = await import("./processingStore");

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
    const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
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
