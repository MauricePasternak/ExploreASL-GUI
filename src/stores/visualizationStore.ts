import { create } from "zustand";

// Types from the schema
interface QcbfSource {
  relativePath: string;
  fileHash: string;
}

interface ExternalSource {
  absolutePath: string;
  fileHash: string;
  sheetName: string | null;
}

interface JoinConfig {
  externalSource: ExternalSource;
  keys: Array<{ left: string; right: string }>;
  dropRightOn: boolean;
  naTokens: string[];
  delimiter: string;
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

export type NvSliceType = "multiplanar" | "axial" | "coronal" | "sagittal" | "render";

export type NvBackColor = "black" | "white" | "gray";

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
  qcbfSource: QcbfSource | null;
  joinConfig: JoinConfig | null;
  columnTypes: Record<string, string>;
  identifiers: Identifiers | null;
  levelOrderings: Record<string, string[]>;
  axisAssignment: AxisAssignment;
  domainFilters: DomainFilters;
  stage: StepperStage;
  splitRatio: number;
  filtersExpanded: boolean;

  // Nivo Chart settings
  pointSize: number;
  swarmSpacing: number;
  chartOpacity: number;
  showGridX: boolean;
  showGridY: boolean;

  // NiiVue Options
  nvRadiological: boolean;
  nvColorbar: boolean;
  nvCrosshair: boolean;
  nvCornerOrientation: boolean;
  nvColormap: string;
  nvSliceType: NvSliceType;
  nvBackColor: NvBackColor;

  // Axis tick options
  xTickSize: number;
  xTickPadding: number;
  xTickRotation: number;
  xLegendOverride: string | null;
  xLegendOffset: number;

  yTickSize: number;
  yTickPadding: number;
  yTickRotation: number;
  yLegendOverride: string | null;
  yLegendOffset: number;
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
  setQcbfSource: (source: QcbfSource | null) => void;
  setJoinConfig: (config: JoinConfig | null) => void;
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

  // New settings actions
  setPointSize: (size: number) => void;
  setSwarmSpacing: (spacing: number) => void;
  setChartOpacity: (opacity: number) => void;
  setShowGridX: (show: boolean) => void;
  setShowGridY: (show: boolean) => void;
  setNvRadiological: (val: boolean) => void;
  setNvColorbar: (val: boolean) => void;
  setNvCrosshair: (val: boolean) => void;
  setNvCornerOrientation: (val: boolean) => void;
  setNvColormap: (colormap: string) => void;
  setNvSliceType: (sliceType: NvSliceType) => void;
  setNvBackColor: (color: NvBackColor) => void;

  setXTickSize: (val: number) => void;
  setXTickPadding: (val: number) => void;
  setXTickRotation: (val: number) => void;
  setXLegendOverride: (val: string | null) => void;
  setXLegendOffset: (val: number) => void;

  setYTickSize: (val: number) => void;
  setYTickPadding: (val: number) => void;
  setYTickRotation: (val: number) => void;
  setYLegendOverride: (val: string | null) => void;
  setYLegendOffset: (val: number) => void;

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
  qcbfSource: null,
  joinConfig: null,
  columnTypes: {},
  identifiers: null,
  levelOrderings: {},
  axisAssignment: { x: null, y: null, colorBy: null },
  domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
  stage: "selectFile",
  splitRatio: 0.6,
  filtersExpanded: false,

  pointSize: 10,
  swarmSpacing: 2,
  chartOpacity: 0.8,
  showGridX: true,
  showGridY: true,

  nvRadiological: false,
  nvColorbar: true,
  nvCrosshair: true,
  nvCornerOrientation: false,
  nvColormap: "gray",
  nvSliceType: "multiplanar",
  nvBackColor: "black",

  xTickSize: 5,
  xTickPadding: 5,
  xTickRotation: -20,
  xLegendOverride: null,
  xLegendOffset: 36,

  yTickSize: 5,
  yTickPadding: 5,
  yTickRotation: 0,
  yLegendOverride: null,
  yLegendOffset: -40,
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
  setQcbfSource: (source) => set({ qcbfSource: source }),
  setJoinConfig: (config) => set({ joinConfig: config }),
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

  // New settings actions
  setPointSize: (size) => set({ pointSize: size }),
  setSwarmSpacing: (spacing) => set({ swarmSpacing: spacing }),
  setChartOpacity: (opacity) => set({ chartOpacity: opacity }),
  setShowGridX: (show) => set({ showGridX: show }),
  setShowGridY: (show) => set({ showGridY: show }),
  setNvRadiological: (val) => set({ nvRadiological: val }),
  setNvColorbar: (val) => set({ nvColorbar: val }),
  setNvCrosshair: (val) => set({ nvCrosshair: val }),
  setNvCornerOrientation: (val) => set({ nvCornerOrientation: val }),
  setNvColormap: (colormap) => set({ nvColormap: colormap }),
  setNvSliceType: (sliceType) => set({ nvSliceType: sliceType }),
  setNvBackColor: (color) => set({ nvBackColor: color }),

  setXTickSize: (val) => set({ xTickSize: val }),
  setXTickPadding: (val) => set({ xTickPadding: val }),
  setXTickRotation: (val) => set({ xTickRotation: val }),
  setXLegendOverride: (val) => set({ xLegendOverride: val }),
  setXLegendOffset: (val) => set({ xLegendOffset: val }),

  setYTickSize: (val) => set({ yTickSize: val }),
  setYTickPadding: (val) => set({ yTickPadding: val }),
  setYTickRotation: (val) => set({ yTickRotation: val }),
  setYLegendOverride: (val) => set({ yLegendOverride: val }),
  setYLegendOffset: (val) => set({ yLegendOffset: val }),

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
