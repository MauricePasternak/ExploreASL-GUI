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
    store.setChartData([
      { id: "test", x: 1, y: 2, participantId: "p", subject: "s", session: "01", run: "ASL_1" },
    ]);
    store.reset();
    expect(useVisualizationStore.getState().stage).toBe("selectFile");
    expect(useVisualizationStore.getState().chartData).toEqual([]);
  });
});
