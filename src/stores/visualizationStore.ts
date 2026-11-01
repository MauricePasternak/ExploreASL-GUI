import { create } from "zustand";
import type {
  DataInspection_Serialize as DataInspection,
  StatsFileInfo,
  VisualizationConfig_Serialize as VisualizationConfig,
  QcbfSource,
  ExternalSource_Serialize as ExternalSource,
  JoinConfig_Serialize as JoinConfig,
  Identifiers,
  AxisAssignment_Serialize as AxisAssignment,
  DomainFilters_Serialize as DomainFilters,
} from "../generated/bindings";
export type { DataInspection_Serialize as DataInspection } from "../generated/bindings";
import type { ProjectFile } from "../schemas/project";
import { useProjectStore } from "./projectStore";
import { captureProjectLease, isCurrentProjectLease } from "../lib/projectLifecycle";

export type { ExternalSource, JoinConfig };

export type StepperStage = "selectData" | "columnTypes" | "levelOrdering" | "visualize";

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

// Ephemeral fields (not persisted)
interface EphemeralState {
  availableFiles: StatsFileInfo[];
  inspection: DataInspection | null;
  chartData: ChartPoint[];
  selectedPointId: string | null;
  viewerState: ViewerState;
  webglAvailable: boolean;
  exclusionCount: { plotted: number; excluded: number };
  _lastExtMtime: string | null;
  externalSourceAvailability: ExternalSourceAvailability;
}

export type ExternalSourceAvailability =
  | { status: "unconfigured" | "available"; savedPath: string | null; message: null }
  | { status: "missing" | "unreadable" | "changed"; savedPath: string; message: string };

interface VisualizationActions {
  // Persisted actions
  setQcbfSource: (source: QcbfSource | null) => void;
  setJoinConfig: (
    config: JoinConfig | null | ((current: JoinConfig | null) => JoinConfig | null),
  ) => void;
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
  setWebglAvailable: (available: boolean) => void;
  setExclusionCount: (count: { plotted: number; excluded: number }) => void;
  _setLastExtMtime: (mtime: string | null) => void;
  setExternalSourceAvailability: (availability: ExternalSourceAvailability) => void;
  relinkMatchingExternalSource: (source: ExternalSource) => void;
  relinkChangedExternalSource: (source: ExternalSource) => void;
  reset: () => void;
}

type VisualizationState = EphemeralState & VisualizationActions;

const INITIAL_PERSISTED: Required<VisualizationConfig> = {
  qcbfSource: null,
  joinConfig: null,
  columnTypes: {},
  identifiers: null,
  levelOrderings: {},
  axisAssignment: { x: null, y: null, colorBy: null },
  domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
  stage: "selectData",
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
  webglAvailable: false,
  exclusionCount: { plotted: 0, excluded: 0 },
  _lastExtMtime: null,
  externalSourceAvailability: { status: "unconfigured", savedPath: null, message: null },
};

function createInitialVisualizationState() {
  return {
    ...INITIAL_EPHEMERAL,
    availableFiles: [],
    chartData: [],
    viewerState: { status: "idle" as const },
    exclusionCount: { plotted: 0, excluded: 0 },
  };
}

/** Presentation defaults only; no editable persisted slice. */
export function visualizationSettings(project: ProjectFile | null) {
  return { ...INITIAL_PERSISTED, ...project?.uiState.dataVis };
}
export const acceptedVisualizationSettings = () =>
  visualizationSettings(useProjectStore.getState().project);

const EMPTY_CONFIG: VisualizationConfig = {
  qcbfSource: null,
  joinConfig: null,
  identifiers: null,
  xLegendOverride: null,
  yLegendOverride: null,
};
function editVisualization(
  update:
    | Partial<VisualizationConfig>
    | ((settings: Required<VisualizationConfig>) => Partial<VisualizationConfig>),
) {
  void useProjectStore
    .getState()
    .submitEdit((project) => ({
      kind: "visualization",
      config: {
        ...(project.uiState.dataVis ?? EMPTY_CONFIG),
        ...(typeof update === "function" ? update(visualizationSettings(project)) : update),
      },
    }))
    .catch(() => undefined);
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  ...INITIAL_EPHEMERAL,

  // Persisted actions
  setQcbfSource: (source) => editVisualization({ qcbfSource: source }),
  setJoinConfig: (config) =>
    editVisualization((state) => ({
      joinConfig: typeof config === "function" ? config(state.joinConfig) : config,
    })),
  setColumnType: (column, type) =>
    editVisualization((state) => ({
      columnTypes: { ...state.columnTypes, [column]: type },
    })),
  setColumnTypes: (types) => editVisualization({ columnTypes: types }),
  setIdentifiers: (ids) => editVisualization({ identifiers: ids }),
  setLevelOrdering: (column, levels) =>
    editVisualization((state) => ({
      levelOrderings: { ...state.levelOrderings, [column]: levels },
    })),
  setLevelOrderings: (orderings) => editVisualization({ levelOrderings: orderings }),
  setAxisAssignment: (axis) =>
    editVisualization((state) => ({
      axisAssignment: { ...state.axisAssignment, ...axis },
    })),
  setDomainFilters: (filters) =>
    editVisualization((state) => ({
      domainFilters: { ...state.domainFilters, ...filters },
    })),
  setStage: (stage) => editVisualization({ stage }),
  setSplitRatio: (ratio) => editVisualization({ splitRatio: ratio }),
  setFiltersExpanded: (expanded) => editVisualization({ filtersExpanded: expanded }),
  invalidateContract: () => {
    void useProjectStore
      .getState()
      .submitEdit({ kind: "visualization", config: EMPTY_CONFIG })
      .catch(() => undefined);
  },

  // New settings actions
  setPointSize: (size) => editVisualization({ pointSize: size }),
  setSwarmSpacing: (spacing) => editVisualization({ swarmSpacing: spacing }),
  setChartOpacity: (opacity) => editVisualization({ chartOpacity: opacity }),
  setShowGridX: (show) => editVisualization({ showGridX: show }),
  setShowGridY: (show) => editVisualization({ showGridY: show }),
  setNvRadiological: (val) => editVisualization({ nvRadiological: val }),
  setNvColorbar: (val) => editVisualization({ nvColorbar: val }),
  setNvCrosshair: (val) => editVisualization({ nvCrosshair: val }),
  setNvCornerOrientation: (val) => editVisualization({ nvCornerOrientation: val }),
  setNvColormap: (colormap) => editVisualization({ nvColormap: colormap }),
  setNvSliceType: (sliceType) => editVisualization({ nvSliceType: sliceType }),
  setNvBackColor: (color) => editVisualization({ nvBackColor: color }),

  setXTickSize: (val) => editVisualization({ xTickSize: val }),
  setXTickPadding: (val) => editVisualization({ xTickPadding: val }),
  setXTickRotation: (val) => editVisualization({ xTickRotation: val }),
  setXLegendOverride: (val) => editVisualization({ xLegendOverride: val }),
  setXLegendOffset: (val) => editVisualization({ xLegendOffset: val }),

  setYTickSize: (val) => editVisualization({ yTickSize: val }),
  setYTickPadding: (val) => editVisualization({ yTickPadding: val }),
  setYTickRotation: (val) => editVisualization({ yTickRotation: val }),
  setYLegendOverride: (val) => editVisualization({ yLegendOverride: val }),
  setYLegendOffset: (val) => editVisualization({ yLegendOffset: val }),

  // Ephemeral actions
  setAvailableFiles: (files) => set({ availableFiles: files }),
  setInspection: (inspection) => set({ inspection }),
  setChartData: (data) => set({ chartData: data }),
  selectPoint: (id) => set({ selectedPointId: id }),
  setViewerState: (state) => set({ viewerState: state }),
  setWebglAvailable: (available) => set({ webglAvailable: available }),
  setExclusionCount: (count) => set({ exclusionCount: count }),
  _setLastExtMtime: (mtime) => set({ _lastExtMtime: mtime }),
  setExternalSourceAvailability: (externalSourceAvailability) =>
    set({ externalSourceAvailability }),
  relinkMatchingExternalSource: (source) => {
    const lease = captureProjectLease();
    void useProjectStore
      .getState()
      .submitEdit({ kind: "relinkExternal", source, compatible: true })
      .then(() => {
        if (isCurrentProjectLease(lease))
          set({
            externalSourceAvailability: {
              status: "available",
              savedPath: source.absolutePath,
              message: null,
            },
          });
      })
      .catch(() => undefined);
  },
  relinkChangedExternalSource: (source) => {
    const lease = captureProjectLease();
    void useProjectStore
      .getState()
      .submitEdit({ kind: "relinkExternal", source, compatible: false })
      .then(() => {
        if (isCurrentProjectLease(lease))
          set({
            externalSourceAvailability: {
              status: "available",
              savedPath: source.absolutePath,
              message: null,
            },
            inspection: null,
            chartData: [],
            selectedPointId: null,
            viewerState: { status: "idle" },
            exclusionCount: { plotted: 0, excluded: 0 },
          });
      })
      .catch(() => undefined);
  },
  reset: () => set(createInitialVisualizationState()),
}));
