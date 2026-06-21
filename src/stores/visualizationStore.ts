import { create } from "zustand";

// Types from the schema
interface ContractSource {
  relativePath: string;
  fileHash: string;
}

interface Identifiers {
  subject: string;
  session: string;
  run: string;
}

interface AxisAssignment {
  x: string | null;
  y: string | null;
  colorBy: string | null;
}

interface DomainFilters {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

export type StepperStage = "selectFile" | "columnTypes" | "levelOrdering" | "visualize";

export interface ChartPoint {
  x: number | string;
  y: number;
  id: string;
  colorBy?: string;
  participantId: string;
  subject: string;
  session: string;
  run: string;
}

interface ViewerState {
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage?: string;
}

// Persisted fields (synced to uiState.dataVis)
interface PersistedState {
  contractSources: ContractSource[];
  columnTypes: Record<string, string>;
  identifiers: Identifiers | null;
  levelOrderings: Record<string, string[]>;
  axisAssignment: AxisAssignment;
  domainFilters: DomainFilters;
  stage: StepperStage;
  splitRatio: number;
  filtersExpanded: boolean;
}

// Ephemeral fields (not persisted)
interface EphemeralState {
  availableFiles: Array<{ fileName: string; relativePath: string; size: number; modified: string }>;
  inspection: {
    columns: Array<{
      name: string;
      units: string;
      inferredType: string;
      levels: string[];
      isIdentifier: boolean;
    }>;
    rowCount: number;
    fileHash: string;
  } | null;
  chartData: ChartPoint[];
  selectedPointId: string | null;
  viewerState: ViewerState;
  viewerError: string | null;
  webglAvailable: boolean;
  exclusionCount: { plotted: number; excluded: number };
}

interface VisualizationActions {
  // Persisted actions
  setContractSources: (sources: ContractSource[]) => void;
  setColumnType: (column: string, type: string) => void;
  setColumnTypes: (types: Record<string, string>) => void;
  setIdentifiers: (ids: Identifiers) => void;
  setLevelOrdering: (column: string, levels: string[]) => void;
  setLevelOrderings: (orderings: Record<string, string[]>) => void;
  setAxisAssignment: (axis: Partial<AxisAssignment>) => void;
  setDomainFilters: (filters: Partial<DomainFilters>) => void;
  setStage: (stage: StepperStage) => void;
  setSplitRatio: (ratio: number) => void;
  setFiltersExpanded: (expanded: boolean) => void;
  invalidateContract: () => void;

  // Ephemeral actions
  setAvailableFiles: (files: EphemeralState["availableFiles"]) => void;
  setInspection: (inspection: EphemeralState["inspection"]) => void;
  setChartData: (data: ChartPoint[]) => void;
  selectPoint: (id: string | null) => void;
  setViewerState: (state: ViewerState) => void;
  setViewerError: (error: string | null) => void;
  setWebglAvailable: (available: boolean) => void;
  setExclusionCount: (count: { plotted: number; excluded: number }) => void;
  reset: () => void;
}

type VisualizationState = PersistedState & EphemeralState & VisualizationActions;

const INITIAL_PERSISTED: PersistedState = {
  contractSources: [],
  columnTypes: {},
  identifiers: null,
  levelOrderings: {},
  axisAssignment: { x: null, y: null, colorBy: null },
  domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
  stage: "selectFile",
  splitRatio: 0.6,
  filtersExpanded: false,
};

const INITIAL_EPHEMERAL: EphemeralState = {
  availableFiles: [],
  inspection: null,
  chartData: [],
  selectedPointId: null,
  viewerState: { status: "idle" },
  viewerError: null,
  webglAvailable: false,
  exclusionCount: { plotted: 0, excluded: 0 },
};

export const useVisualizationStore = create<VisualizationState>((set) => ({
  ...INITIAL_PERSISTED,
  ...INITIAL_EPHEMERAL,

  // Persisted actions
  setContractSources: (sources) => set({ contractSources: sources }),
  setColumnType: (column, type) =>
    set((state) => ({
      columnTypes: { ...state.columnTypes, [column]: type },
    })),
  setColumnTypes: (types) => set({ columnTypes: types }),
  setIdentifiers: (ids) => set({ identifiers: ids }),
  setLevelOrdering: (column, levels) =>
    set((state) => ({
      levelOrderings: { ...state.levelOrderings, [column]: levels },
    })),
  setLevelOrderings: (orderings) => set({ levelOrderings: orderings }),
  setAxisAssignment: (axis) =>
    set((state) => ({
      axisAssignment: { ...state.axisAssignment, ...axis },
    })),
  setDomainFilters: (filters) =>
    set((state) => ({
      domainFilters: { ...state.domainFilters, ...filters },
    })),
  setStage: (stage) => set({ stage }),
  setSplitRatio: (ratio) => set({ splitRatio: ratio }),
  setFiltersExpanded: (expanded) => set({ filtersExpanded: expanded }),
  invalidateContract: () =>
    set({
      ...INITIAL_PERSISTED,
      stage: "selectFile",
    }),

  // Ephemeral actions
  setAvailableFiles: (files) => set({ availableFiles: files }),
  setInspection: (inspection) => set({ inspection }),
  setChartData: (data) => set({ chartData: data }),
  selectPoint: (id) => set({ selectedPointId: id }),
  setViewerState: (state) => set({ viewerState: state }),
  setViewerError: (error) => set({ viewerError: error }),
  setWebglAvailable: (available) => set({ webglAvailable: available }),
  setExclusionCount: (count) => set({ exclusionCount: count }),
  reset: () => set({ ...INITIAL_PERSISTED, ...INITIAL_EPHEMERAL }),
}));
