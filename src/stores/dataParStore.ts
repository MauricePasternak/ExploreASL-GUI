import { create } from "zustand";

import type { DataParState } from "../schemas/dataParSchema";
import { useProjectStore } from "./projectStore";

interface DataParSlice {
  dataPar: DataParState;
  showAdvanced: boolean;
  setDataParField: (field: keyof DataParState, value: unknown) => void;
  clearDataParField: (field: keyof DataParState) => void;
  setShowAdvanced: (value: boolean) => void;
  loadDataPar: (state: DataParState) => void;
  resetDataPar: () => void;
  saveToProject: () => void;
}

export const useDataParStore = create<DataParSlice>((set, get) => ({
  dataPar: {},
  showAdvanced: false,

  setDataParField: (field, value) => {
    set((state) => ({
      dataPar: { ...state.dataPar, [field]: value },
    }));
  },

  clearDataParField: (field) => {
    set((state) => ({
      dataPar: { ...state.dataPar, [field]: undefined },
    }));
  },

  setShowAdvanced: (value) => {
    set({ showAdvanced: value });
  },

  loadDataPar: (state) => {
    set({ dataPar: state });
  },

  resetDataPar: () => {
    set({ dataPar: {}, showAdvanced: false });
  },

  saveToProject: () => {
    const { dataPar, showAdvanced } = get();
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
            showAdvancedParameters: showAdvanced,
          },
        },
        isDirty: true,
      };
    });
  },
}));
