import { create } from "zustand";

interface ManifestState {
  step: 0 | 1;
  filter: "all" | "neutral" | "pass" | "fail" | "no-info";
  staleVerdicts: Set<string>;
  setStep: (step: 0 | 1) => void;
  setFilter: (filter: ManifestState["filter"]) => void;
  recomputeStaleVerdicts: () => Promise<void>;
  resetStep: () => void;
}

export const useManifestStore = create<ManifestState>((set) => ({
  step: 0,
  filter: "all",
  staleVerdicts: new Set(),

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
}));
