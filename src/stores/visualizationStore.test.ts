import { describe, it, expect, beforeEach } from "vitest";
import { useVisualizationStore } from "./visualizationStore";

describe("visualizationStore", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
      contractSources: [],
      columnTypes: {},
      identifiers: null,
      levelOrderings: {},
      axisAssignment: { x: null, y: null, colorBy: null },
      domainFilters: { xMin: null, xMax: null, yMin: null, yMax: null },
      stage: "selectFile",
      splitRatio: 0.6,
      filtersExpanded: false,
      availableFiles: [],
      inspection: null,
      chartData: [],
      selectedPointId: null,
      viewerState: { status: "idle" },
      viewerError: null,
      webglAvailable: false,
      exclusionCount: { plotted: 0, excluded: 0 },
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
    });
  });

  it("setStage updates the stepper stage", () => {
    const { setStage } = useVisualizationStore.getState();
    setStage("columnTypes");
    expect(useVisualizationStore.getState().stage).toBe("columnTypes");
  });

  it("selectPoint sets selectedPointId", () => {
    const { selectPoint } = useVisualizationStore.getState();
    selectPoint("sub-X_01_ASL_1");
    expect(useVisualizationStore.getState().selectedPointId).toBe("sub-X_01_ASL_1");
  });

  it("invalidateContract resets contract fields", () => {
    const store = useVisualizationStore.getState();
    store.setColumnType("GM_vol", "continuous");
    store.invalidateContract();
    expect(useVisualizationStore.getState().columnTypes).toEqual({});
    expect(useVisualizationStore.getState().stage).toBe("selectFile");
  });

  it("setAxisAssignment merges with existing", () => {
    const { setAxisAssignment } = useVisualizationStore.getState();
    setAxisAssignment({ x: "GM_vol" });
    setAxisAssignment({ y: "Total_GM_B" });
    const { axisAssignment } = useVisualizationStore.getState();
    expect(axisAssignment.x).toBe("GM_vol");
    expect(axisAssignment.y).toBe("Total_GM_B");
    expect(axisAssignment.colorBy).toBeNull();
  });

  it("reset clears all state", () => {
    const store = useVisualizationStore.getState();
    store.setStage("visualize");
    store.setPointSize(12);
    store.setNvColormap("hot");
    store.setChartData([
      { id: "test", x: 1, y: 2, participantId: "p", subject: "s", session: "01", run: "ASL_1" },
    ]);
    store.reset();
    expect(useVisualizationStore.getState().stage).toBe("selectFile");
    expect(useVisualizationStore.getState().chartData).toEqual([]);
    expect(useVisualizationStore.getState().pointSize).toBe(10);
    expect(useVisualizationStore.getState().nvColormap).toBe("gray");
  });

  it("sets new Nivo and NiiVue parameters", () => {
    const store = useVisualizationStore.getState();
    store.setPointSize(10);
    store.setSwarmSpacing(5);
    store.setChartOpacity(0.5);
    store.setShowGridX(false);
    store.setNvRadiological(true);
    store.setNvBackColor("white");

    const state = useVisualizationStore.getState();
    expect(state.pointSize).toBe(10);
    expect(state.swarmSpacing).toBe(5);
    expect(state.chartOpacity).toBe(0.5);
    expect(state.showGridX).toBe(false);
    expect(state.nvRadiological).toBe(true);
    expect(state.nvBackColor).toBe("white");
  });
});
