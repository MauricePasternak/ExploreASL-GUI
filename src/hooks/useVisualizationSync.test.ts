import { describe, it, expect, beforeEach, vi } from "vitest";
import { useVisualizationStore } from "../stores/visualizationStore";
import { __resetProjectRevisionForTests, useProjectStore } from "../stores/projectStore";
import { renderHook, act } from "@testing-library/react";
import { useVisualizationSync } from "./useVisualizationSync";

describe("useVisualizationSync", () => {
  beforeEach(() => {
    __resetProjectRevisionForTests();
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
        dataPar: {},
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

  it("syncs visualization changes to top-level isDirty without nesting isDirty on project", () => {
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
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
    });

    renderHook(() => useVisualizationSync());

    act(() => {
      useVisualizationStore.getState().setPointSize(22);
    });

    const project = useProjectStore.getState().project!;
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(project.uiState.dataVis?.pointSize).toBe(22);
    expect("isDirty" in project).toBe(false);
  });

  it("does not autosave a different project after a stale timer fires", () => {
    vi.useFakeTimers();
    const saveProject = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-a",
          name: "Project A",
          rootPath: "/tmp/project-a",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: false,
      loaded: true,
      saveProject,
    });

    renderHook(() => useVisualizationSync());

    act(() => {
      useVisualizationStore.getState().setPointSize(22);
    });

    useProjectStore.setState({
      project: {
        version: "0.1.0",
        projectMeta: {
          id: "project-b",
          name: "Project B",
          rootPath: "/tmp/project-b",
          createdAt: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          currentPhase: "visualization",
        },
        uiState: {},
        mappingState: {},
        dataPar: {},
      },
      isDirty: true,
      loaded: true,
      saveProject,
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(saveProject).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
