import { create } from "zustand";
import type { DataParState } from "../schemas/dataPar";
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

const INITIAL_STATE: DataParState = {};

export const useDataParStore = create<DataParSlice>((set, get) => ({
  dataPar: { ...INITIAL_STATE },
  showAdvanced: false,

  setDataParField: (field, value) => {
    set((state) => ({
      dataPar: { ...state.dataPar, [field]: value },
    }));
  },

  clearDataParField: (field) => {
    set((state) => {
      const next = { ...state.dataPar };
      delete next[field];
      return { dataPar: next };
    });
  },

  setShowAdvanced: (value) => {
    set({ showAdvanced: value });
  },

  loadDataPar: (state) => {
    set({ dataPar: { ...state } });
  },

  resetDataPar: () => {
    set({ dataPar: { ...INITIAL_STATE }, showAdvanced: false });
  },

  saveToProject: () => {
    const { dataPar, showAdvanced } = get();
    const projectStore = useProjectStore.getState();
    const { project } = projectStore;
    if (!project) return;

    useProjectStore.setState({
      project: {
        ...project,
        uiState: {
          ...project.uiState,
          showAdvancedParameters: showAdvanced,
        },
        exploreAslConfig: {
          ...project.exploreAslConfig,
          dataPar,
        },
      },
      isDirty: true,
    });
  },
}));
