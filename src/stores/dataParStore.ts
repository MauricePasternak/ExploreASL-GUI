import { create } from "zustand";

import type { DataParState } from "../schemas/dataParSchema";
import { useProjectStore } from "./projectStore";

export interface DataParametersAdvancedVisibility {
  showAdvancedSections: boolean;
  showAdvancedM0Params: boolean;
  showAdvancedQuantification: boolean;
  showAdvancedGeneralSettings: boolean;
  showAdvancedASLProcessing: boolean;
  showAdvancedAtlases: boolean;
}

interface DataParSlice {
  dataPar: DataParState;
  advancedVisibility: DataParametersAdvancedVisibility;
  setDataParField: (field: keyof DataParState, value: unknown) => void;
  clearDataParField: (field: keyof DataParState) => void;
  setAdvancedVisibility: (visibility: Partial<DataParametersAdvancedVisibility>) => void;
  loadDataPar: (state: DataParState) => void;
  resetDataPar: () => void;
  saveToProject: () => void;
}

const DEFAULT_ADVANCED_VISIBILITY: DataParametersAdvancedVisibility = {
  showAdvancedSections: false,
  showAdvancedM0Params: false,
  showAdvancedQuantification: false,
  showAdvancedGeneralSettings: false,
  showAdvancedASLProcessing: false,
  showAdvancedAtlases: false,
};

function alignAtlasesFields(
  atlases?: string[],
  tissueMasking?: string[],
  tissueThreshold?: number[]
) {
  const finalAtlases = atlases ?? ["Total", "DeepWM"];
  const finalMasking = [...(tissueMasking ?? [])];
  const finalThreshold = [...(tissueThreshold ?? [])];

  if (finalMasking.length > finalAtlases.length) {
    finalMasking.length = finalAtlases.length;
  } else {
    while (finalMasking.length < finalAtlases.length) {
      const idx = finalMasking.length;
      const atlas = finalAtlases[idx];
      const defaultMask = atlas === "DeepWM" ? "WM" : "GM";
      finalMasking.push(defaultMask);
    }
  }

  if (finalThreshold.length > finalAtlases.length) {
    finalThreshold.length = finalAtlases.length;
  } else {
    while (finalThreshold.length < finalAtlases.length) {
      finalThreshold.push(0.7);
    }
  }

  return {
    Atlases: finalAtlases,
    TissueMasking: finalMasking,
    TissueThreshold: finalThreshold,
  };
}

export const useDataParStore = create<DataParSlice>((set, get) => ({
  dataPar: {
    Atlases: ["Total", "DeepWM"],
    TissueMasking: ["GM", "WM"],
    TissueThreshold: [0.7, 0.7],
  },
  advancedVisibility: { ...DEFAULT_ADVANCED_VISIBILITY },

  setDataParField: (field, value) => {
    set((state) => {
      const nextDataPar = { ...state.dataPar, [field]: value };
      if (field === "Atlases" || field === "TissueMasking" || field === "TissueThreshold") {
        const aligned = alignAtlasesFields(
          nextDataPar.Atlases,
          nextDataPar.TissueMasking as string[],
          nextDataPar.TissueThreshold as number[]
        );
        Object.assign(nextDataPar, aligned);
      }
      return { dataPar: nextDataPar };
    });
  },

  clearDataParField: (field) => {
    set((state) => {
      const nextDataPar = { ...state.dataPar, [field]: undefined };
      if (field === "Atlases" || field === "TissueMasking" || field === "TissueThreshold") {
        const aligned = alignAtlasesFields(
          nextDataPar.Atlases,
          nextDataPar.TissueMasking as string[],
          nextDataPar.TissueThreshold as number[]
        );
        Object.assign(nextDataPar, aligned);
      }
      return { dataPar: nextDataPar };
    });
  },

  setAdvancedVisibility: (visibility) => {
    set((state) => ({
      advancedVisibility: { ...state.advancedVisibility, ...visibility },
    }));
  },

  loadDataPar: (state) => {
    const aligned = alignAtlasesFields(
      state.Atlases,
      state.TissueMasking,
      state.TissueThreshold
    );
    set({
      dataPar: {
        ...state,
        ...aligned,
      },
    });
  },

  resetDataPar: () => {
    set({
      dataPar: {
        Atlases: ["Total", "DeepWM"],
        TissueMasking: ["GM", "WM"],
        TissueThreshold: [0.7, 0.7],
      },
      advancedVisibility: { ...DEFAULT_ADVANCED_VISIBILITY },
    });
  },

  saveToProject: () => {
    const { dataPar, advancedVisibility } = get();
    const projectState = useProjectStore.getState();
    if (!projectState.project) return;

    useProjectStore.setState((prev) => {
      if (!prev.project) return prev;
      return {
        project: {
          ...prev.project,
          exploreAslConfig: {
            ...prev.project.exploreAslConfig,
            dataPar,
          },
          uiState: {
            ...prev.project.uiState,
            datapar: {
              ...prev.project.uiState.datapar,
              advancedVisibility,
            },
          },
        },
        isDirty: true,
      };
    });
  },
}));
