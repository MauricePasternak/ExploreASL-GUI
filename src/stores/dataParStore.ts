import { create } from "zustand";
import type { DataParState } from "../schemas/dataParSchema";
import type { AdvancedVisibility } from "../generated/project/AdvancedVisibility";
import { useProjectStore } from "./projectStore";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";

export type DataParametersAdvancedVisibility = AdvancedVisibility;
export const DEFAULT_ADVANCED_VISIBILITY: AdvancedVisibility = {
  showAdvancedSections: false,
  showAdvancedM0Params: false,
  showAdvancedQuantification: false,
  showAdvancedGeneralSettings: false,
  showAdvancedASLProcessing: false,
  showAdvancedAtlases: false,
};
const EMPTY: DataParState = {};
export const acceptedDataPar = () => useProjectStore.getState().project?.dataPar ?? EMPTY;

interface ParameterDrafts {
  drafts: Record<string, unknown>;
  setDataParField: (field: keyof DataParState, value: unknown) => Promise<void>;
  clearDataParField: (field: keyof DataParState) => Promise<void>;
  setAdvancedVisibility: (values: Partial<AdvancedVisibility>) => Promise<void>;
  resetDataPar: () => void;
}

export const useDataParStore = create<ParameterDrafts>((set, get) => ({
  drafts: {},
  resetDataPar: () => set({ drafts: {} }),
  setDataParField: async (field, value) => {
    const lease = captureProjectLease();
    const key = String(field);
    set({ drafts: { ...get().drafts, [key]: value } });
    useProjectStore.getState().setDraftError(`dataPar.${key}`, null);
    try {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error(`${key} requires a finite number`);
      await useProjectStore.getState().submitEdit((project) => {
        const values = { ...project.dataPar };
        if (value === undefined) delete values[key];
        else values[key] = value as DataParState[string];
        if (["Atlases", "TissueMasking", "TissueThreshold"].includes(key)) {
          if (key === "Atlases" && value === undefined) {
            delete values.TissueMasking;
            delete values.TissueThreshold;
          } else {
            const atlases = values.Atlases ?? ["Total", "DeepWM"];
            values.Atlases = atlases;
            values.TissueMasking = atlases.map(
              (atlas, index) => values.TissueMasking?.[index] ?? (atlas === "DeepWM" ? "WM" : "GM"),
            );
            values.TissueThreshold = atlases.map(
              (_, index) => values.TissueThreshold?.[index] ?? 0.7,
            );
          }
        }
        return {
          kind: "parameters",
          values,
          visibility: project.uiState.datapar?.advancedVisibility ?? DEFAULT_ADVANCED_VISIBILITY,
        };
      });
      if (isCurrentProjectLease(lease) && get().drafts[key] === value) {
        const drafts = { ...get().drafts };
        delete drafts[key];
        set({ drafts });
        useProjectStore.getState().setDraftError(`dataPar.${key}`, null);
      }
    } catch (error) {
      if (isCurrentProjectLease(lease))
        useProjectStore
          .getState()
          .setDraftError(`dataPar.${key}`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  },
  clearDataParField: (field) => get().setDataParField(field, undefined),
  setAdvancedVisibility: (visibility) =>
    useProjectStore.getState().submitEdit((project) => ({
      kind: "parameters",
      values: project.dataPar,
      visibility: {
        ...(project.uiState.datapar?.advancedVisibility ?? DEFAULT_ADVANCED_VISIBILITY),
        ...visibility,
      },
    })),
}));
