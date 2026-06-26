import { describe, it, expect, beforeEach } from "vitest";
import { useVisualizationStore } from "./visualizationStore";

describe("visualizationStore", () => {
  beforeEach(() => {
    useVisualizationStore.getState().reset();
  });

  it("has qcbfSource null by default", () => {
    expect(useVisualizationStore.getState().qcbfSource).toBeNull();
  });

  it("has joinConfig null by default", () => {
    expect(useVisualizationStore.getState().joinConfig).toBeNull();
  });

  it("setQcbfSource updates the source", () => {
    useVisualizationStore.getState().setQcbfSource({ relativePath: "test.tsv", fileHash: "abc" });
    expect(useVisualizationStore.getState().qcbfSource).toEqual({
      relativePath: "test.tsv",
      fileHash: "abc",
    });
  });

  it("setQcbfSource accepts null", () => {
    useVisualizationStore.getState().setQcbfSource({ relativePath: "test.tsv", fileHash: "abc" });
    useVisualizationStore.getState().setQcbfSource(null);
    expect(useVisualizationStore.getState().qcbfSource).toBeNull();
  });

  it("setJoinConfig updates join config", () => {
    const config = {
      externalSource: { absolutePath: "/tmp/test.csv", fileHash: "def", sheetName: null },
      keys: [{ left: "participant_id", right: "SubjectID" }],
      dropRightOn: true,
      naTokens: ["", "NaN", "NA", "n/a", "<NA>"],
      delimiter: ",",
    };
    useVisualizationStore.getState().setJoinConfig(config);
    expect(useVisualizationStore.getState().joinConfig).toEqual(config);
  });

  it("setJoinConfig accepts null", () => {
    useVisualizationStore.getState().setJoinConfig({
      externalSource: { absolutePath: "/tmp/test.csv", fileHash: "def", sheetName: null },
      keys: [{ left: "participant_id", right: "SubjectID" }],
      dropRightOn: true,
      naTokens: ["", "NaN", "NA", "n/a", "<NA>"],
      delimiter: ",",
    });
    useVisualizationStore.getState().setJoinConfig(null);
    expect(useVisualizationStore.getState().joinConfig).toBeNull();
  });

  it("invalidateContract resets qcbfSource and joinConfig to null", () => {
    const store = useVisualizationStore.getState();
    store.setQcbfSource({ relativePath: "test.tsv", fileHash: "abc" });
    store.setJoinConfig({
      externalSource: { absolutePath: "/tmp/test.csv", fileHash: "def", sheetName: null },
      keys: [{ left: "participant_id", right: "SubjectID" }],
      dropRightOn: true,
      naTokens: ["", "NaN", "NA", "n/a", "<NA>"],
      delimiter: ",",
    });
    store.invalidateContract();
    expect(useVisualizationStore.getState().qcbfSource).toBeNull();
    expect(useVisualizationStore.getState().joinConfig).toBeNull();
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
    expect(useVisualizationStore.getState().stage).toBe("selectData");
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
    expect(useVisualizationStore.getState().stage).toBe("selectData");
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
