import { describe, it, expect, beforeEach } from "vitest";
import { useVisualizationStore } from "../stores/visualizationStore";
import { useProjectStore } from "../stores/projectStore";
import { renderHook } from "@testing-library/react";
import { useVisualizationSync } from "./useVisualizationSync";

describe("useVisualizationSync", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
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
      availableFiles: [],
      inspection: null,
      chartData: [],
      selectedPointId: null,
      viewerState: { status: "idle" },
      viewerError: null,
      webglAvailable: false,
      exclusionCount: { plotted: 0, excluded: 0 },
    });
    useProjectStore.setState({ project: null, isDirty: false, loaded: false });
  });

  it("hydrates from project.uiState.dataVis on mount", () => {
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "test",
          name: "Test",
          rootPath: "/tmp",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
        },
        uiState: {
          dataVis: {
            qcbfSource: { relativePath: "test.tsv", fileHash: "abc" },
            columnTypes: { GM_vol: "continuous" },
            stage: "columnTypes",
            pointSize: 15,
            nvColormap: "warm",
          },
        },
        mappingState: {},
        exploreAslConfig: { sourcestructure: {}, studyPar: {}, dataPar: {} },
      },
      isDirty: false,
      loaded: true,
    });

    renderHook(() => useVisualizationSync());

    const state = useVisualizationStore.getState();
    expect(state.qcbfSource).toEqual({ relativePath: "test.tsv", fileHash: "abc" });
    expect(state.columnTypes).toEqual({ GM_vol: "continuous" });
    expect(state.stage).toBe("columnTypes");
    expect(state.pointSize).toBe(15);
    expect(state.nvColormap).toBe("warm");
  });
});
